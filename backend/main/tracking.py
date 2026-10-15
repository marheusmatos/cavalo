"""Poller: busca os reports da tag de cada cavalo e grava os plausíveis.

Só chegam pontos quando um Android passa perto do cavalo, então a trilha tem
buracos; o poller não tenta "completar" nada, só registra o que veio.
"""

import asyncio
import logging
import math
import random
import time
from itertools import pairwise

from sqlalchemy import select

from main import findhub
from main.database import SessionLocal
from main.models import Horse, Position
from main.settings import settings

log = logging.getLogger(__name__)

# Tag simulada: pasto (qualquer ponto rural serve) e chance, por ciclo, de
# chegar um report que os filtros da ingestão devem barrar.
DEMO_TAG = 'demo'
PASTO = (-21.9500, -47.9500)
P_GPS_RUIM = 0.15
P_SALTO = 0.1

# Última consulta por cavalo: o front mostra, p/ monitorar a lib não oficial.
last_poll: dict[int, dict] = {}


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(a))


def inside_fence(horse, pos):
    """True/False; None se o cavalo não tem cerca completa."""
    fence = (horse.fence_lat, horse.fence_lon, horse.fence_radius_m)
    if None in fence:
        return None
    return haversine_m(fence[0], fence[1], pos.lat, pos.lon) <= fence[2]


def track_stats(pts):
    """Distância (m), velocidade média e máxima (km/h) e aceleração (m/s²).

    Pelas posições da tag, em ordem de tempo. A aceleração é a variação média
    da velocidade entre trechos seguidos: com reports de 10 em 10 min é uma
    média grosseira, não o tranco de um galope (isso é o acelerômetro).
    """
    # ponytail: soma crua; com o cavalo parado o erro de 10–30 m do report
    # infla a distância. Suavizar (média móvel) se isso pesar na análise.
    segs = [
        (haversine_m(a.lat, a.lon, b.lat, b.lon), b.ts - a.ts, (a.ts + b.ts) / 2)
        for a, b in pairwise(pts)
        if b.ts > a.ts
    ]
    dist = sum(d for d, _, _ in segs)
    span = pts[-1].ts - pts[0].ts if pts else 0
    speeds = [(d / dt, mid) for d, dt, mid in segs]  # m/s no meio do trecho
    accel = [
        abs(v2 - v1) / (m2 - m1)
        for (v1, m1), (v2, m2) in pairwise(speeds)
        if m2 > m1
    ]
    return {
        'distance_m': dist,
        'avg_speed_kmh': dist / span * 3.6 if span else 0,
        'max_speed_kmh': max((v for v, _ in speeds), default=0) * 3.6,
        'accel_ms2': sum(accel) / len(accel) if accel else None,
    }


def last_position(session, horse_id, until=None):
    q = select(Position).where(Position.horse_id == horse_id)
    if until is not None:
        q = q.where(Position.ts <= until)
    return session.scalars(q.order_by(Position.ts.desc()).limit(1)).first()


def ingest(session, horse_id, reports):
    """Grava reports novos e plausíveis; devolve quantos entraram."""
    saved = 0
    for r in sorted(reports, key=lambda r: r['ts']):
        if r['accuracy'] > settings.MAX_ACCURACY_M:
            log.info('descartado (accuracy %.0f m): %s', r['accuracy'], r)
            continue
        # Compara com o ponto anterior no tempo: report atrasado também vale.
        prev = last_position(session, horse_id, until=r['ts'])
        if prev and prev.ts == r['ts']:
            continue  # o Google repetiu o último ponto
        if prev:
            dist = haversine_m(prev.lat, prev.lon, r['lat'], r['lon'])
            kmh = dist / (r['ts'] - prev.ts) * 3.6
            if kmh > settings.MAX_SPEED_KMH:
                log.info('descartado (%.0f km/h): %s', kmh, r)
                continue
        session.add(Position(horse_id=horse_id, **r))
        session.flush()  # o próximo report precisa enxergar este
        saved += 1
    session.commit()
    return saved


def demo_reports(last, now, center=PASTO):
    """Imita a rede Find Hub: buracos, ponto repetido e report ruim."""
    lat, lon = (last.lat, last.lon) if last else center
    reports = []
    if last:  # o Google devolve de novo o último ponto que já temos
        reports.append({
            'ts': last.ts,
            'lat': lat,
            'lon': lon,
            'accuracy': last.accuracy,
        })
    # Reports novos caem na janela desde o último ciclo; 0 = nenhum Android
    # passou perto do cavalo.
    start = max(last.ts if last else 0, now - settings.POLL_INTERVAL_SECONDS)
    k = min(random.choice([0, 1, 1, 2, 3]), now - start)
    for ts in sorted(random.sample(range(start + 1, now + 1), k)):
        # Passeia, mas é puxado de volta ao pasto.
        lat += (center[0] - lat) * 0.2 + random.gauss(0, 0.0004)
        lon += (center[1] - lon) * 0.2 + random.gauss(0, 0.0004)
        reports.append({
            'ts': ts,
            'lat': lat,
            'lon': lon,
            'accuracy': round(random.uniform(8, 40), 1),
        })
    if reports:  # lixo que os filtros da ingestão devem barrar
        good = reports[-1]
        if random.random() < P_GPS_RUIM:  # celular com GPS ruim
            reports.append({**good, 'ts': good['ts'] + 30, 'accuracy': 250})
        if random.random() < P_SALTO:  # salto de ~5 km em 40 s
            reports.append({
                **good,
                'ts': good['ts'] + 40,
                'lat': good['lat'] + 0.05,
            })
    return reports


def poll_horse(session, horse, now):
    if horse.tag_id == DEMO_TAG:
        center = (
            (horse.fence_lat, horse.fence_lon)
            if horse.fence_lat is not None
            else PASTO
        )
        reports = demo_reports(last_position(session, horse.id), now, center)
    else:
        reports = findhub.locate(horse.tag_id)
    return ingest(session, horse.id, reports)


def poll_safe(session, horse, now=None):
    """poll_horse que registra o erro em vez de propagar (monitoramento)."""
    horse_id, now = horse.id, now or int(time.time())
    try:
        saved, error = poll_horse(session, horse, now), None
    except (Exception, SystemExit) as e:  # a lib chama exit() em alguns erros
        session.rollback()
        log.exception('poll do cavalo %s falhou', horse_id)
        saved, error = 0, findhub.describe(e)
    last_poll[horse_id] = {'at': now, 'saved': saved, 'error': error}
    return last_poll[horse_id]


def poll_all():
    with SessionLocal() as session:
        for horse in session.scalars(
            select(Horse).where(Horse.tag_id.is_not(None))
        ).all():
            poll_safe(session, horse)


async def poll_forever():
    while True:
        try:
            await asyncio.to_thread(poll_all)
        except Exception:  # ex.: banco travado; sem isto o poller morre calado
            log.exception('ciclo do poller falhou')
        await asyncio.sleep(settings.POLL_INTERVAL_SECONDS)


def seed_demo():
    """Banco vazio: cria o Cavalo Teste (tag simulada) com 24 h de trilha."""
    with SessionLocal() as session:
        if session.scalar(select(Horse.id).limit(1)) is not None:
            return
        horse = Horse(
            name='Cavalo Teste',
            tag_id=DEMO_TAG,
            fence_lat=PASTO[0],
            fence_lon=PASTO[1],
            fence_radius_m=150,
        )
        session.add(horse)
        session.commit()
        now = int(time.time())
        for t in range(now - 86_400, now, 600):
            poll_horse(session, horse, t)

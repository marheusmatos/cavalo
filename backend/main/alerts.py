"""Alertas do sensor: limites por cavalo e e-mail ao veterinário.

Quem decide se uma leitura passou do limite é o ESP32 (para piscar o LED na
hora, sem esperar o próximo contato). Os limites são editados no portal e
viajam para o cartão SD como /alertas.txt; aqui só se monta esse arquivo,
registra o alerta que o ESP32 manda e avisa o veterinário.
"""

import logging
import smtplib
import time
from datetime import datetime
from email.message import EmailMessage

from sqlalchemy import select

from main import tracking
from main.models import SensorAlert
from main.settings import settings

log = logging.getLogger(__name__)

# chave no /alertas.txt -> coluna do cavalo
FILE_KEYS = {
    'bpm_min': 'alert_bpm_min',
    'bpm_max': 'alert_bpm_max',
    'temp_min': 'alert_temp_min',
    'temp_max': 'alert_temp_max',
    'mov_max': 'alert_mov_max',
}
# tipo -> (nome, unidade, casas decimais)
KINDS = {
    'H': ('Batimentos', 'bpm', 0),
    'T': ('Temperatura', '°C', 1),
    'A': ('Intensidade do movimento', 'g', 2),
    'C': ('Cerca virtual', 'm', 0),
}


def limits(horse):
    out = {key: getattr(horse, col) for key, col in FILE_KEYS.items()}
    return {**out, 'ver': horse.alert_ver}


def set_limits(horse, data):
    """Grava os limites e troca a versão (o ESP32 baixa no próximo contato)."""
    for key, col in FILE_KEYS.items():
        setattr(horse, col, data.get(key))
    horse.alert_ver = max(horse.alert_ver + 1, int(time.time()))


def alert_file(horse):
    """Conteúdo do /alertas.txt do cartão."""
    lines = [
        '# Limites de alerta, baixados do servidor (portal > cavalo).',
        '# Nao edite: o ESP32 troca este arquivo quando eles mudam.',
        f'versao={horse.alert_ver}',
    ]
    for key, col in FILE_KEYS.items():
        value = getattr(horse, col)
        if value is not None:
            lines.append(f'{key}={value:g}')
    return '\n'.join(lines) + '\n'


def fence_out(session, horse):
    """(distância do centro, raio) em m se a última posição está fora da cerca."""
    pos = tracking.last_position(session, horse.id)
    if pos is None or tracking.inside_fence(horse, pos) is not False:
        return None
    dist = tracking.haversine_m(horse.fence_lat, horse.fence_lon, pos.lat, pos.lon)
    return round(dist), round(horse.fence_radius_m)


def describe(kind, value, limit):
    if kind == 'C':
        return f'Fora da cerca virtual: {value:.0f} m do centro (raio {limit:g} m)'
    name, unit, digits = KINDS[kind]
    side = 'acima do máximo' if value > limit else 'abaixo do mínimo'
    return f'{name} {value:.{digits}f} {unit}, {side} de {limit:g} {unit}'


def _send_email(to, subject, text):
    if not settings.SMTP_HOST:
        log.warning('alerta sem e-mail: SMTP_HOST não configurado')
        return False
    msg = EmailMessage()
    msg['From'] = settings.SMTP_FROM or settings.SMTP_USER
    msg['To'] = to
    msg['Subject'] = subject
    msg.set_content(text)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as smtp:
            smtp.starttls()
            if settings.SMTP_USER:
                smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as e:
        log.warning('e-mail de alerta para %s falhou: %s', to, e)
        return False
    return True


def record(session, horse, alert):
    """Guarda o alerta e manda o e-mail (um por intervalo, por sinal)."""
    now = int(time.time())
    row = SensorAlert(
        horse_id=horse.id,
        ts=now,
        kind=alert.kind,
        value=alert.value,
        limit=alert.limit,
        email=alert.vet,
        emailed=False,
    )
    recent = session.scalar(
        select(SensorAlert.id).where(
            SensorAlert.horse_id == horse.id,
            SensorAlert.kind == alert.kind,
            SensorAlert.emailed.is_(True),
            SensorAlert.ts > now - settings.ALERT_EMAIL_INTERVAL_S,
        )
    )
    if alert.vet and not recent:
        what = describe(alert.kind, alert.value, alert.limit)
        when = datetime.fromtimestamp(now).strftime('%d/%m/%Y %H:%M')
        row.emailed = _send_email(
            alert.vet,
            f'Alerta: {horse.name} - {KINDS[alert.kind][0].lower()}',
            f'{horse.name}: {what}.\n\n'
            f'Medido pelo sensor {horse.sensor_id} em {when}.\n'
            'O LED do sensor fica piscando até alguém apertar o botão.\n',
        )
    session.add(row)
    session.commit()
    return {'emailed': row.emailed}

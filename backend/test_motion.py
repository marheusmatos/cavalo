"""Testes dos padrões de movimento (modelo do sensor). `cd backend && pytest`.

Mesmo esquema de banco temporário de test_sensor.py.
"""

import math
import os
import random
import tempfile
import time
from pathlib import Path

TMP = Path(tempfile.mkdtemp())
os.environ.setdefault('DATABASE_URL', f'sqlite:///{(TMP / "test.db").as_posix()}')
os.environ.setdefault('GFMT_DIR', str(TMP / 'GoogleFindMyTools'))
os.environ.update(
    AUTH_USERNAME='admin', AUTH_PASSWORD='admin', RATE_LIMIT_REQUESTS='100000'
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import motion  # noqa: E402
from main.app import app  # noqa: E402
from main.database import Base, engine  # noqa: E402
from main.settings import settings  # noqa: E402
from sim_sensor import header, record  # noqa: E402

Base.metadata.create_all(engine)
client = TestClient(app, client=('127.0.0.1', 50001))
MAC = '0a0b0c0d0e20'


@pytest.fixture(scope='module')
def auth():
    r = client.post('/auth/token', data={'username': 'admin', 'password': 'admin'})
    return {'Authorization': f'Bearer {r.json()["access_token"]}'}


def walk(n, seed=1):
    """Caminhada: oscilação suave em torno de 1 g em Z."""
    rng = random.Random(seed)
    xs, ys, zs = [], [], []
    for i in range(n):
        t = i / motion.HZ
        xs.append(0.1 * math.sin(2 * math.pi * 1.5 * t) + rng.gauss(0, 0.02))
        ys.append(0.05 * math.cos(2 * math.pi * 1.5 * t) + rng.gauss(0, 0.02))
        zs.append(1 + 0.15 * math.sin(2 * math.pi * 3 * t) + rng.gauss(0, 0.02))
    return xs, ys, zs


def jump(xs, ys, zs, i):
    """0,3 s de queda livre e o impacto de 3 g caindo."""
    for j in range(15):
        xs[i + j], ys[i + j], zs[i + j] = 0.02, 0.0, 0.05
    for j in range(15, 25):
        zs[i + j] = 3.0 - (j - 15) * 0.2


# --- características ---------------------------------------------------------
def test_caracteristicas_nao_dependem_da_calibracao():
    xs, ys, zs = walk(100)
    base = motion.features(xs, ys, zs)
    assert len(base) == motion.N_FEATURES
    # desvio de zero em cada eixo: as dos eixos não mudam
    shifted = motion.features([v + 0.3 for v in xs], [v - 0.2 for v in ys], zs)
    assert shifted[: 3 * motion.PER_AXIS] == pytest.approx(base[: 3 * motion.PER_AXIS])
    # erro de escala: as do módulo não mudam
    scaled = motion.features(*[[v * 1.1 for v in a] for a in (xs, ys, zs)])
    assert scaled[3 * motion.PER_AXIS :] == pytest.approx(base[3 * motion.PER_AXIS :])


def test_padrao_so_usa_os_eixos_marcados():
    assert motion.allowed('z') == [12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
    assert motion.allowed('xz')[:6] == [0, 1, 2, 3, 4, 5]


def test_treino_separa_pulo_de_caminhada_e_volta_igual_do_arquivo():
    xs, ys, zs = walk(motion.HZ * 3600)
    labels = []
    for k in range(10):
        i = motion.HZ * (30 + k * 300)
        jump(xs, ys, zs, i)
        labels.append((1, i * 20 - 300, i * 20 + 1200, 'z'))
    d = motion.train_pattern(labels, lambda _h: [(0, xs, ys, zs)])
    assert d['axes'] == 'z'
    assert d['metrics']['recall'] == 1.0
    assert d['metrics']['false_per_h'] < 1

    blob = motion.pack(9, [{**d, 'code': 11, 'alert_n': 3, 'alert_min': 5}])
    back = motion.unpack(blob)
    assert (back['ver'], back['hz'], back['feat_ver']) == (9, 50, motion.FEAT_VER)
    det = back['detectors'][0]
    assert (det['code'], det['axes'], det['win'], det['alert_n']) == (11, 'z', d['win'], 3)
    w = d['win']
    i = motion.HZ * 30 - 10
    in_jump = motion.features(xs[i : i + w], ys[i : i + w], zs[i : i + w])
    calm = motion.features(xs[1000 : 1000 + w], ys[1000 : 1000 + w], zs[1000 : 1000 + w])
    assert motion.predict(det['trees'], in_jump) == pytest.approx(motion.predict(d['trees'], in_jump), abs=1e-4)
    assert motion.predict(det['trees'], in_jump) >= motion.THRESHOLD
    assert motion.predict(det['trees'], calm) < motion.THRESHOLD


def test_contagem_espera_uma_janela():
    # depois de uma detecção, a próxima só vale uma janela depois
    assert motion.count([0.9, 0.9, 0.9, 0.9], win=2, step=1) == 2
    assert motion.count([0.9, 0.1, 0.1, 0.9], win=4, step=1) == 1


# --- API ---------------------------------------------------------------------
def test_marcar_treinar_e_o_sensor_baixar(auth):
    horse = client.post('/api/v1/horses/', headers=auth, json={'name': 'Saltador', 'sensor_id': MAC}).json()
    dev = {'X-Sensor-Id': MAC, 'X-Sensor-Key': settings.SENSOR_KEY}

    # 20 min de caminhada com 6 pulos, em blocos de 1 min como o ESP32 manda
    xs, ys, zs = walk(motion.HZ * 1200, seed=2)
    for k in range(6):
        jump(xs, ys, zs, motion.HZ * (40 + k * 190))
    raw = [round(v * 4096) for t in zip(xs, ys, zs) for v in t]
    per = motion.HZ * 60 * 3
    body = header(5) + b''.join(
        record('A', (b + 1) * 60_000, 60_000, raw[b * per : (b + 1) * per], ch=3) for b in range(20)
    ) + record('E', 1_100_000, 0, [12]) + record('E', 1_150_000, 0, [12])
    assert client.post('/api/v1/device/upload', params={'boot': 5, 'uptime_ms': 1_200_000},
                       content=body, headers=dev).status_code == 200

    pats = client.get('/api/v1/motion/patterns', headers=auth).json()['patterns']
    if not pats:  # banco dos testes nasce sem a migração que cria Pulo e Volta
        for name in ('Pulo', 'Volta'):
            client.post('/api/v1/motion/patterns', headers=auth, json={'name': name})
        pats = client.get('/api/v1/motion/patterns', headers=auth).json()['patterns']
    pulo = next(p for p in pats if p['name'] == 'Pulo')
    dup = client.post('/api/v1/motion/patterns', headers=auth, json={'name': 'pulo'})
    assert dup.status_code == 409
    half = client.put(f'/api/v1/motion/patterns/{pulo["id"]}', headers=auth, json={'name': 'Pulo', 'alert_n': 3})
    assert half.status_code == 422
    client.put(f'/api/v1/motion/patterns/{pulo["id"]}', headers=auth,
               json={'name': 'Pulo', 'alert_n': 3, 'alert_min': 10})

    # sem marcação não treina; o sensor não tem o que baixar
    if client.get('/api/v1/motion/model', headers=auth).json()['model'] is None:
        assert client.get('/api/v1/device/model', params={'ver': 0}, headers=dev).status_code == 204

    t0 = client.get(f'/api/v1/horses/{horse["id"]}/sensor/series', headers=auth,
                    params={'kind': 'A'}).json()['points'][0]['ts'] * 1000
    bad = {'pattern_id': pulo['id'], 'horse_id': horse['id'], 'from_ms': t0, 'to_ms': t0 + 100, 'axes': 'z'}
    assert client.post('/api/v1/motion/labels', headers=auth, json=bad).status_code == 422
    assert client.post('/api/v1/motion/labels', headers=auth, json={**bad, 'to_ms': t0 + 1000, 'axes': 'zz'}).status_code == 422
    for k in range(6):
        start = t0 + (40 + k * 190) * 1000
        r = client.post('/api/v1/motion/labels', headers=auth, json={
            'pattern_id': pulo['id'], 'horse_id': horse['id'],
            'from_ms': start - 300, 'to_ms': start + 1200, 'axes': 'zy',
        })
        assert (r.status_code, r.json()['axes']) == (201, 'yz')
    labels = client.get('/api/v1/motion/labels', headers=auth, params={'horse_id': horse['id']}).json()['labels']
    assert len(labels) == 6

    t = time.time()
    r = client.post('/api/v1/motion/train', headers=auth)
    assert r.status_code == 200, r.text
    assert time.time() - t < 30
    model = r.json()
    m = model['metrics'][str(pulo['id'])]
    assert (m['labels'], m['axes'], m['recall']) == (6, 'yz', 1.0)

    blob = client.get('/api/v1/device/model', params={'ver': 0}, headers=dev)
    assert blob.status_code == 200
    back = motion.unpack(blob.content)
    assert back['ver'] == model['ver']
    assert (back['detectors'][0]['code'], back['detectors'][0]['name']) == (pulo['code'], 'Pulo')
    assert (back['detectors'][0]['alert_n'], back['detectors'][0]['alert_min']) == (3, 10)
    assert client.get('/api/v1/device/model', params={'ver': model['ver']}, headers=dev).status_code == 204

    # detecções que o sensor mandou como eventos (código 12 = padrão 2)
    det = client.get(f'/api/v1/horses/{horse["id"]}/sensor/detections', headers=auth,
                     params={'from': 0, 'to': int(time.time()) + 60}).json()
    counts = {c['name']: c['n'] for c in det['counts']}
    assert counts['Volta'] == 2
    assert counts['Pulo'] == 0
    assert [e['name'] for e in det['events']] == ['Volta', 'Volta']

    # alerta de padrão: o sino mostra o nome dele
    alert = {'kind': 'P', 'code': pulo['code'], 'value': 3, 'limit': 3}
    assert client.post('/api/v1/device/alert', json=alert, headers=dev).status_code == 200
    bell = client.get('/api/v1/alerts/', headers=auth).json()['alerts']
    mine = [a for a in bell if a['horse_id'] == horse['id']]
    assert mine[0]['desc'].startswith('Pulo: 3 vezes')
    assert mine[0]['to'] == 'atividade'

    # apagar o cavalo leva as marcações junto
    assert client.delete(f'/api/v1/horses/{horse["id"]}', headers=auth).status_code in (200, 204)
    left = client.get('/api/v1/motion/labels', headers=auth, params={'horse_id': horse['id']}).json()['labels']
    assert left == []

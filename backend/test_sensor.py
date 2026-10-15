"""Testes do sensor (ESP32). Rodar: `cd backend && pytest -v`.

Banco em pasta temporária. Junto com test_horse.py vale o banco de lá: ele é
importado antes e o `settings` já está criado quando este arquivo roda.
"""

import os
import tempfile
import time
from pathlib import Path

TMP = Path(tempfile.mkdtemp())
os.environ.update(
    DATABASE_URL=f'sqlite:///{(TMP / "test.db").as_posix()}',
    GFMT_DIR=str(TMP / 'GoogleFindMyTools'),
    AUTH_USERNAME='admin',
    AUTH_PASSWORD='admin',
    RATE_LIMIT_REQUESTS='100000',
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from main import alerts, sensor  # noqa: E402
from main.app import app  # noqa: E402
from main.database import Base, SessionLocal, engine  # noqa: E402
from main.models import Horse, Position, SensorBlock  # noqa: E402
from main.settings import settings  # noqa: E402
from sim_sensor import header, record  # noqa: E402

Base.metadata.create_all(engine)
client = TestClient(app, client=('127.0.0.1', 50000))

MAC = 'f42dc9719d30'
T0 = 1_800_000_000_000  # um "agora" fixo (epoch ms) para os testes de relógio


@pytest.fixture(scope='module')
def auth():
    r = client.post(
        '/auth/token', data={'username': 'admin', 'password': 'admin'}
    )
    return {'Authorization': f'Bearer {r.json()["access_token"]}'}


def send(body, boot, uptime_ms, mac=MAC, key=None):
    return client.post(
        '/api/v1/device/upload',
        params={'boot': boot, 'uptime_ms': uptime_ms},
        content=body,
        headers={
            'X-Sensor-Id': mac,
            'X-Sensor-Key': key or settings.SENSOR_KEY,
        },
    )


def accel(uptime_ms, dur_ms, n=3000):
    """Bloco 'A' parado: 1 g em X."""
    return record('A', uptime_ms, dur_ms, [4096, 0, 0] * n, ch=3)


def blocks_of(horse_id, kind='A'):
    with SessionLocal() as s:
        q = select(SensorBlock).where(
            SensorBlock.horse_id == horse_id, SensorBlock.kind == kind
        )
        return s.scalars(q.order_by(SensorBlock.ts_ms)).all()


# --- Formato -----------------------------------------------------------------
def test_parse_e_resumo_por_tipo():
    body = header(7) + b''.join([
        # parado (1 g), 2 g em Z e 0,5 g em Y: intensidades 0, 1 e 0,5
        record('A', 1000, 60, [4096, 0, 0, 0, 0, 8192, 0, 2048, 0], ch=3),
        record('H', 1000, 0, [1500, 1000, 0]),  # 40 e 60 bpm; 0 = sem leitura
        record('T', 1000, 0, [3712, 3750]),
        record('E', 1000, 0, [1, 2]),
    ])
    boot, blocks = sensor.parse(body)
    assert boot == 7
    got = {
        b['kind']: sensor.summary(b['kind'], b['values'], b['ch'], b['scale'])
        for b in blocks
    }
    assert got['A'] == pytest.approx((0, 1, 0.5))
    assert got['H'] == pytest.approx((40, 60, 50))
    assert got['T'] == pytest.approx((37.12, 37.5, 37.31))
    assert got['E'] == (None, None, None)
    assert [(b['n'], b['ch']) for b in blocks] == [
        (3, 3),
        (3, 1),
        (2, 1),
        (2, 1),
    ]


INVALID = {
    'vazio': b'',
    'formato_antigo': b'CAV1' + header(7)[4:],
    'leituras_cortadas': header(7) + accel(60_000, 60_000, n=5)[:-1],
    'registro_cortado': header(7) + b'\x00' * 8,
    'tipo_desconhecido': header(7)
    + sensor.RECORD.pack(ord('Z'), 0, 0, 1000, 0),
    'antes_do_boot': header(7) + accel(1000, 60_000, n=1),
    'sem_tres_eixos': header(7, channels=2)
    + record('A', 1000, 60, [1, 2], ch=2),
}


@pytest.mark.parametrize('body', INVALID.values(), ids=INVALID.keys())
def test_parse_recusa_corpo_invalido(body):
    with pytest.raises(ValueError):  # noqa: PT011
        sensor.parse(body)


# --- API ---------------------------------------------------------------------
def test_envio_exige_chave_e_cavalo(auth):
    body = header(1) + accel(60_000, 60_000, n=50)
    assert send(body, 1, 70_000, key='errada').status_code == 401
    assert send(body, 1, 70_000, mac='nao-e-mac').status_code == 422
    no_headers = client.post(
        '/api/v1/device/upload',
        params={'boot': 1, 'uptime_ms': 70_000},
        content=body,
    )
    assert no_headers.status_code == 422

    mac = 'aabbccddeeff'  # ninguém vinculou
    assert send(body, 1, 70_000, mac=mac).status_code == 409
    assert client.get('/api/v1/sensors/').status_code == 401
    sensors = client.get('/api/v1/sensors/', headers=auth).json()['sensors']
    mine = next(s for s in sensors if s['id'] == mac)
    assert (mine['horse_id'], mine['horse_name']) == (None, None)
    assert mine['contact']['error'] == 'Sensor não vinculado a um cavalo'
    assert mine['contact']['boot'] == 1


def test_envio_grava_e_reenvio_nao_duplica(auth, monkeypatch):
    horse = client.post(
        '/api/v1/horses/',
        headers=auth,
        json={'name': 'Sensorado', 'sensor_id': 'F4:2D:C9:71:9D:30'},
    ).json()
    assert horse['sensor_id'] == MAC
    url = f'/api/v1/horses/{horse["id"]}'

    moving = [4096, 0, 0, 0, 0, 8192] * 1500  # metade parado, metade a 2 g
    records = [
        accel(60_000, 60_000),
        record('A', 120_000, 60_000, moving, ch=3),
        record('T', 120_000, 0, [3712]),
        record('E', 90_000, 0, [1]),
    ]
    body = header(7) + b''.join(records)
    now = time.time() * 1000
    r = send(body, 7, 130_000)
    assert (r.status_code, r.json()) == (
        200,
        {'stored': 4, 'duplicates': 0, 'undated': 0},
    )

    first, second = blocks_of(horse['id'])
    # O 1º bloco começou no boot, 130 s antes do envio.
    assert first.ts_ms == pytest.approx(now - 130_000, abs=3000)
    assert second.ts_ms == first.ts_ms + first.dur_ms == first.ts_ms + 60_000
    assert (first.n, first.ch, first.boot, first.uptime_ms) == (
        3000,
        3,
        7,
        60_000,
    )
    assert first.scale == pytest.approx(1 / 4096)
    assert (first.v_min, first.v_max, first.v_avg) == (0, 0, 0)
    assert (second.v_min, second.v_max, second.v_avg) == pytest.approx((
        0,
        1,
        0.5,
    ))
    assert list(sensor.decode(second)) == moving  # nenhuma leitura se perde
    assert len(second.data) < len(moving) * 2  # e fica compactado
    assert blocks_of(horse['id'], 'T')[0].v_avg == pytest.approx(37.12)
    assert blocks_of(horse['id'], 'E')[0].v_avg is None

    # A resposta se perdeu e o ESP32 mandou de novo, já com mais um minuto.
    assert send(body, 7, 135_000).json() == {
        'stored': 0,
        'duplicates': 4,
        'undated': 0,
    }
    more = body + accel(180_000, 60_000)
    assert send(more, 7, 190_000).json() == {
        'stored': 1,
        'duplicates': 4,
        'undated': 0,
    }
    assert len(blocks_of(horse['id'])) == 3

    sensors = client.get('/api/v1/sensors/', headers=auth).json()['sensors']
    mine = next(s for s in sensors if s['id'] == MAC)
    assert (mine['horse_id'], mine['horse_name']) == (
        horse['id'],
        'Sensorado',
    )
    assert (mine['contact']['stored'], mine['contact']['error']) == (1, None)

    assert send(b'lixo', 7, 200_000).status_code == 422
    future = header(7) + accel(999_000, 60_000, n=1)
    assert send(future, 7, 200_000).status_code == 422
    monkeypatch.setattr(settings, 'SENSOR_MAX_UPLOAD_BYTES', 100)
    assert send(body, 7, 200_000).status_code == 413
    monkeypatch.undo()

    # Um sensor, um cavalo.
    other = {'name': 'Outro', 'sensor_id': MAC}
    assert (
        client.post('/api/v1/horses/', headers=auth, json=other).status_code
        == 409
    )
    outro = client.post(
        '/api/v1/horses/', headers=auth, json={'name': 'Outro'}
    ).json()
    assert (
        client.patch(
            f'/api/v1/horses/{outro["id"]}',
            headers=auth,
            json={'sensor_id': MAC},
        ).status_code
        == 409
    )
    assert (
        client.patch(url, headers=auth, json={'sensor_id': MAC}).status_code
        == 200
    )  # regravar o próprio não é conflito
    assert (
        client.patch(url, headers=auth, json={'sensor_id': 'xyz'}).status_code
        == 422
    )
    client.delete(f'/api/v1/horses/{outro["id"]}', headers=auth)

    # Desvinculado, o envio volta a ser recusado; removido, os blocos somem.
    client.patch(url, headers=auth, json={'sensor_id': None})
    assert send(more, 7, 200_000).status_code == 409
    assert client.delete(url, headers=auth).status_code == 204
    assert blocks_of(horse['id']) == []


# --- Relógio -----------------------------------------------------------------
def test_relogio_emenda_contatos_e_tira_a_deriva():
    with SessionLocal() as s:
        h = Horse(name='Relógio')
        s.add(h)
        s.commit()
        horse_id = h.id

        def ingest(boot, cur_boot, uptime_ms, records, now_ms):
            contact = sensor.Contact(cur_boot, uptime_ms, now_ms)
            body = header(boot) + b''.join(records)
            return sensor.ingest(s, horse_id, contact, body)

        # 1º contato do boot 9: sem referência anterior, vale o "agora".
        first = [accel(60_000 * k, 60_000, n=2) for k in range(1, 11)]
        assert ingest(9, 9, 600_000, first, T0)['stored'] == 10

        # 10 min reais depois o ESP32 contou só 594 s (relógio 1% lento).
        late = [accel(600_000 + 59_400 * k, 59_400, n=2) for k in range(1, 11)]
        assert ingest(9, 9, 1_194_000, late, T0 + 600_000)['stored'] == 10

        # Deriva absurda (o relógio do servidor saltou): não tenta corrigir.
        jump = [accel(1_195_000, 1000, n=2)]
        assert ingest(9, 9, 1_195_000, jump, T0 + 9_000_000)['stored'] == 1

        # O ESP32 reiniciou (boot 10) e ainda tinha um minuto do boot 9.
        left = [accel(1_255_000, 60_000, n=2)]
        assert ingest(9, 10, 5000, left, T0 + 9_100_000)['stored'] == 1

        # Boot 11 morreu sem nunca falar com o servidor: não dá para datar.
        lost = [accel(60_000, 60_000, n=2)]
        assert ingest(11, 12, 5000, lost, T0 + 9_200_000) == {
            'stored': 0,
            'duplicates': 0,
            'undated': 1,
        }

    rows = blocks_of(horse_id)
    assert len(rows) == 22
    ends = [r.ts_ms + r.dur_ms for r in rows]
    # 1º contato: o boot foi 600 s antes de T0.
    assert rows[0].ts_ms == T0 - 600_000
    assert ends[9] == T0
    # 2º contato: emenda no bloco anterior, estica 59,4 s para 60 s e termina
    # exatamente no "agora" daquele envio.
    assert [r.ts_ms for r in rows[10:20]] == ends[9:19]
    assert {r.dur_ms for r in rows[10:20]} == {60_000}
    assert ends[19] == T0 + 600_000
    # Salto: datado só pelo "agora" do envio.
    assert (rows[20].ts_ms, rows[20].dur_ms) == (T0 + 9_000_000 - 1000, 1000)
    # Sobra do boot 9: continua do último bloco datado daquele boot.
    assert (rows[21].ts_ms, rows[21].dur_ms) == (ends[20], 60_000)

    with SessionLocal() as s:
        s.query(SensorBlock).filter_by(horse_id=horse_id).delete()
        s.delete(s.get(Horse, horse_id))
        s.commit()


# --- Leitura -----------------------------------------------------------------
def test_leitura_series_e_raw(auth):
    r = client.post('/api/v1/horses/', json={'name': 'Leitura'}, headers=auth)
    horse_id = r.json()['id']
    mac = 'aabbccddee77'
    client.patch(
        f'/api/v1/horses/{horse_id}', json={'sensor_id': mac}, headers=auth
    )
    # 2 min: o 1º parado (1 g em X), o 2º com 2 g em Z (intensidade 1)
    body = header(9) + b''.join([
        accel(60_000, 60_000),
        record('A', 120_000, 60_000, [0, 0, 8192] * 3000, ch=3),
        record('T', 120_000, 0, [3750]),
    ])
    assert send(body, 9, 120_000, mac=mac).json()['stored'] == 3
    now = int(time.time())
    url = f'/api/v1/horses/{horse_id}/sensor'

    r = client.get(f'{url}/series', params={'from': now - 300}, headers=auth)
    pts = r.json()['points']
    assert [round(p['avg'], 3) for p in pts] == [0, 1]
    assert [p['dur'] for p in pts] == [60, 60]
    assert abs(pts[0]['ts'] - (now - 120)) <= 2
    assert abs(r.json()['last_ts'] - now) <= 2
    # fora da janela não vem ponto, mas last_ts continua
    r = client.get(f'{url}/series', params={'from': now + 60}, headers=auth)
    assert r.json()['points'] == []
    assert r.json()['last_ts']
    r = client.get(f'{url}/series', params={'kind': 'T'}, headers=auth)
    assert [p['avg'] for p in r.json()['points']] == [37.5]
    r = client.get(f'{url}/series', params={'kind': 'H'}, headers=auth)
    assert r.json() == {'points': [], 'last_ts': None}

    # raw: janela de 4 min; só os intervalos com dados aparecem
    last = pts[1]['ts'] + 60
    r = client.get(
        f'{url}/raw',
        params={'from': last - 180, 'to': last + 60, 'points': 10},
        headers=auth,
    )
    raw = r.json()
    assert (raw['x'][0], raw['z'][0]) == (1, 0)
    assert (raw['x'][-1], raw['z'][-1]) == (0, 2)
    assert len(raw['t']) in {5, 6}  # 2 min de dados em intervalos de 24 s

    assert client.get(f'{url}/series').status_code == 401
    r = client.get(f'{url}/raw', params={'from': 0, 'to': 26 * 3600}, headers=auth)
    assert r.status_code == 422
    r = client.get('/api/v1/horses/99999/sensor/series', headers=auth)
    assert r.status_code == 404


def test_estaticos_sao_revalidados():
    r = client.get('/static/app.js')
    assert r.status_code == 200
    assert r.headers['cache-control'] == 'no-cache'
    # o index aponta para o app.js pelo hash do conteúdo
    index = client.get('/')
    assert index.headers['cache-control'] == 'no-cache'
    assert 'static/app.js?v=' in index.text
    assert 'static/theme.css?v=' in index.text


# --- Alertas -----------------------------------------------------------------
def test_limites_de_alerta_vao_para_o_cartao_e_alerta_manda_email(
    auth, monkeypatch
):
    mac = '0a0b0c0d0e0f'
    horse = client.post(
        '/api/v1/horses/', headers=auth, json={'name': 'Alertado', 'sensor_id': mac}
    ).json()
    url = f'/api/v1/horses/{horse["id"]}/sensor/alerts'
    dev = {'X-Sensor-Id': mac, 'X-Sensor-Key': settings.SENSOR_KEY}

    assert client.get(url, headers=auth).json() == {
        'bpm_min': None, 'bpm_max': None, 'temp_min': None,
        'temp_max': None, 'mov_max': None, 'ver': 0,
    }
    # Sem limites ainda: o cartão (versao 0) já está em dia.
    r = client.get('/api/v1/device/alerts', params={'ver': 0}, headers=dev)
    assert r.status_code == 204

    bad = client.put(url, headers=auth, json={'bpm_min': 80, 'bpm_max': 40})
    assert bad.status_code == 422
    saved = client.put(
        url, headers=auth, json={'bpm_min': 25, 'bpm_max': 60, 'temp_max': 39.5}
    ).json()
    assert saved['ver'] > 0
    assert (saved['bpm_max'], saved['mov_max']) == (60, None)

    r = client.get('/api/v1/device/alerts', params={'ver': 0}, headers=dev)
    assert r.status_code == 200
    lines = r.text.splitlines()
    assert f'versao={saved["ver"]}' in lines
    assert {'bpm_min=25', 'bpm_max=60', 'temp_max=39.5'} <= set(lines)
    assert not any(line.startswith('mov_max') for line in lines)
    r = client.get(
        '/api/v1/device/alerts', params={'ver': saved['ver']}, headers=dev
    )
    assert r.status_code == 204
    # Salvar de novo (mesmo no mesmo segundo) muda a versão.
    again = client.put(url, headers=auth, json={'bpm_max': 60}).json()
    assert again['ver'] > saved['ver']

    sent = []
    monkeypatch.setattr(
        'main.alerts._send_email', lambda *a: sent.append(a) or True
    )
    alert = {'kind': 'H', 'value': 72.4, 'limit': 60, 'vet': 'vet@exemplo.com'}
    r = client.post('/api/v1/device/alert', json=alert, headers=dev)
    assert (r.status_code, r.json()) == (200, {'emailed': True})
    to, subject, text = sent[0]
    assert to == 'vet@exemplo.com'
    assert 'Alertado' in subject
    assert 'Batimentos 72 bpm, acima do máximo de 60 bpm' in text
    # Logo depois, o mesmo sinal não manda outro e-mail.
    r = client.post('/api/v1/device/alert', json=alert, headers=dev)
    assert r.json() == {'emailed': False}
    assert len(sent) == 1

    bad = {**alert, 'vet': 'nao-e-email'}
    assert client.post('/api/v1/device/alert', json=bad, headers=dev).status_code == 422
    other = {'X-Sensor-Id': 'ffeeddccbbaa', 'X-Sensor-Key': settings.SENSOR_KEY}
    assert client.post('/api/v1/device/alert', json=alert, headers=other).status_code == 409

    bell = client.get('/api/v1/alerts/', headers=auth).json()['alerts']
    mine = [a for a in bell if a['horse_id'] == horse['id']]
    assert len(mine) == 1  # os dois alertas de bpm viram um item
    assert mine[0]['status'] == 'crit'
    assert mine[0]['to'] == 'biometria'


def test_fora_da_cerca_vai_no_cabecalho_para_o_esp32(auth):
    mac = '0a0b0c0d0e10'
    horse = client.post(
        '/api/v1/horses/',
        headers=auth,
        json={
            'name': 'Cercado',
            'sensor_id': mac,
            'fence_lat': -22.0,
            'fence_lon': -47.0,
            'fence_radius_m': 150,
        },
    ).json()
    dev = {'X-Sensor-Id': mac, 'X-Sensor-Key': settings.SENSOR_KEY}
    r = client.get('/api/v1/device/alerts', params={'ver': 0}, headers=dev)
    assert 'x-cerca' not in r.headers  # sem posição ainda

    with SessionLocal() as s:
        s.add(Position(horse_id=horse['id'], ts=int(time.time()), lat=-22.0, lon=-47.0, accuracy=10))
        s.commit()
    r = client.get('/api/v1/device/alerts', params={'ver': 0}, headers=dev)
    assert 'x-cerca' not in r.headers  # dentro

    with SessionLocal() as s:
        # ~555 m ao norte do centro
        s.add(Position(horse_id=horse['id'], ts=int(time.time()) + 1, lat=-21.995, lon=-47.0, accuracy=10))
        s.commit()
    r = client.get('/api/v1/device/alerts', params={'ver': 0}, headers=dev)
    assert r.status_code == 204
    dist, raio = map(int, r.headers['x-cerca'].split('/'))
    assert (raio, 540 < dist < 570) == (150, True)
    assert alerts.describe('C', dist, raio).startswith('Fora da cerca virtual')

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

from main import sensor  # noqa: E402
from main.app import app  # noqa: E402
from main.database import Base, SessionLocal, engine  # noqa: E402
from main.models import Horse, SensorBlock  # noqa: E402
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

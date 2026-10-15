"""Testes do rastreamento. Rodar: `cd backend && pytest -v`.

Os testes rodam em ordem (o de upload conecta a conta usada pelos seguintes)
e usam banco e GoogleFindMyTools em pasta temporária: não tocam no horse.db
nem no secrets.json de verdade. `test_baixa_lib_do_github` precisa de rede.
"""

import asyncio
import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import types
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

from main import findhub, tracking  # noqa: E402
from main.app import app  # noqa: E402
from main.database import Base, SessionLocal, engine  # noqa: E402
from main.models import Horse, Meal, Position  # noqa: E402
from main.settings import settings  # noqa: E402

Base.metadata.create_all(engine)
# Sem `with`: não sobe o poller nem o seed. IP real: o fastapi-guard barra
# o host fictício 'testclient'.
client = TestClient(app, client=('127.0.0.1', 50000))


@pytest.fixture(scope='module')
def auth():
    r = client.post(
        '/auth/token', data={'username': 'admin', 'password': 'admin'}
    )
    return {'Authorization': f'Bearer {r.json()["access_token"]}'}


def _speeds(pts):
    return [
        tracking.haversine_m(a.lat, a.lon, b.lat, b.lon) / (b.ts - a.ts) * 3.6
        for a, b in zip(pts, pts[1:])
    ]


# --- Poller / filtros --------------------------------------------------------
def test_seed_demo_cria_cavalo_com_trilha_filtrada():
    tracking.seed_demo()
    tracking.seed_demo()  # idempotente: banco não está mais vazio
    with SessionLocal() as s:
        horses = s.scalars(select(Horse)).all()
        assert [(h.name, h.tag_id) for h in horses] == [
            ('Cavalo Teste', 'demo')
        ]
        pts = s.scalars(select(Position).order_by(Position.ts)).all()
    assert len(pts) > 50  # 24 h com buracos, ~1,4 ponto a cada 10 min
    assert max(p.accuracy for p in pts) <= settings.MAX_ACCURACY_M
    assert max(_speeds(pts)) <= settings.MAX_SPEED_KMH
    assert pts[-1].ts > time.time() - 7200  # a trilha chega até agora


def test_poller_sobrevive_a_erro(monkeypatch):
    calls = []

    def flaky():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError('database is locked')

    async def run():
        task = asyncio.create_task(tracking.poll_forever())
        while len(calls) < 2:
            await asyncio.sleep(0.01)
        task.cancel()

    monkeypatch.setattr(tracking, 'poll_all', flaky)
    monkeypatch.setattr(settings, 'POLL_INTERVAL_SECONDS', 0)
    asyncio.run(asyncio.wait_for(run(), timeout=5))
    assert len(calls) >= 2  # o 1º ciclo falhou e o loop seguiu


def test_haversine():
    assert tracking.haversine_m(0, 0, 1, 0) == pytest.approx(111_195, abs=1)
    assert tracking.haversine_m(-21.95, -47.95, -21.95, -47.95) == 0


def test_ingest_filtra_e_deduplica():
    with SessionLocal() as s:
        h = Horse(name='Filtro')
        s.add(h)
        s.commit()
        t0 = 1_000_000
        base = {'lat': -21.95, 'lon': -47.95, 'accuracy': 20}
        reports = [
            {
                **base,
                'ts': t0 + 600,
                'lat': -21.951,
            },  # fora de ordem: 111 m/10 min
            {**base, 'ts': t0},
            {**base, 'ts': t0},  # o Google repetiu o ponto
            {**base, 'ts': t0 + 60, 'accuracy': 500},  # erro grande demais
            {**base, 'ts': t0 + 120, 'lat': -21.90},  # 5,5 km em 2 min
        ]
        assert tracking.ingest(s, h.id, reports) == 2
        assert tracking.ingest(s, h.id, reports) == 0  # poll repetido
        late = {**base, 'ts': t0 + 300, 'lat': -21.9505}  # chegou atrasado
        assert tracking.ingest(s, h.id, [late]) == 1
        q = (
            select(Position.ts)
            .where(Position.horse_id == h.id)
            .order_by(Position.ts)
        )
        assert s.scalars(q).all() == [t0, t0 + 300, t0 + 600]


# --- API ---------------------------------------------------------------------
def test_api_exige_login():
    assert client.get('/api/v1/horses/').status_code == 401
    assert client.get('/api/v1/findhub/status').status_code == 401


def test_api_trajeto_distancia_e_cerca(auth):
    r = client.post(
        '/api/v1/horses/',
        headers=auth,
        json={
            'name': 'Pé de Pano',
            'tag_id': 'demo',
            'fence_lat': -21.95,
            'fence_lon': -47.95,
            'fence_radius_m': 150,
        },
    )
    assert r.status_code == 201
    url = f'/api/v1/horses/{r.json()["id"]}'
    assert (
        client.get(f'{url}/positions/latest', headers=auth).status_code == 404
    )

    t0 = int(time.time()) - 3600
    with SessionLocal() as s:
        tracking.ingest(
            s,
            r.json()['id'],
            [
                {'ts': t0, 'lat': -21.950, 'lon': -47.95, 'accuracy': 10},
                {
                    'ts': t0 + 600,
                    'lat': -21.951,
                    'lon': -47.95,
                    'accuracy': 10,
                },
                {
                    'ts': t0 + 1200,
                    'lat': -21.953,
                    'lon': -47.95,
                    'accuracy': 10,
                },
            ],
        )

    track = client.get(f'{url}/positions', headers=auth).json()
    assert len(track['positions']) == 3
    assert track['distance_m'] == pytest.approx(333.6, abs=0.5)  # 111 + 222 m
    assert track['avg_speed_kmh'] == pytest.approx(
        333.6 / 1200 * 3.6, abs=0.01
    )

    part = client.get(
        f'{url}/positions',
        params={'from': t0 + 1, 'to': t0 + 600},
        headers=auth,
    ).json()
    assert [p['ts'] for p in part['positions']] == [t0 + 600]
    assert part['distance_m'] == 0

    stats = client.get(
        f'{url}/positions/stats',
        params={'from': t0, 'to': t0 + 1200},
        headers=auth,
    ).json()
    assert stats['points'] == 3
    assert stats['distance_m'] == pytest.approx(333.6, abs=0.5)
    assert stats['max_speed_kmh'] == pytest.approx(222.4 / 600 * 3.6, abs=0.01)
    # 111 m e depois 222 m em 10 min: a velocidade subiu 0,185 m/s em 600 s
    assert stats['accel_ms2'] == pytest.approx(111.2 / 600 / 600, rel=0.01)
    assert stats['intensity_g'] is None  # sem sensor
    bad = client.get(
        f'{url}/positions/stats', params={'from': t0, 'to': t0}, headers=auth
    )
    assert bad.status_code == 422

    latest = client.get(f'{url}/positions/latest', headers=auth).json()
    assert latest['ts'] == t0 + 1200
    assert latest['inside_fence'] is False  # 333 m do centro, cerca de 150 m

    assert (
        client.patch(
            url, headers=auth, json={'fence_radius_m': 500}
        ).status_code
        == 200
    )
    latest = client.get(f'{url}/positions/latest', headers=auth).json()
    assert latest['inside_fence'] is True

    assert (
        client.patch(url, headers=auth, json={'name': None}).status_code == 422
    )
    assert (
        client.patch(url, headers=auth, json={'fence_lat': 91}).status_code
        == 422
    )

    poll = client.post(f'{url}/poll', headers=auth).json()
    assert poll['error'] is None

    assert client.delete(url, headers=auth).status_code == 204
    assert client.get(f'{url}/positions', headers=auth).status_code == 404
    with SessionLocal() as s:
        q = select(Position).where(Position.horse_id == r.json()['id'])
        assert s.scalars(q).all() == []


def test_nutricao_recorrencia_e_clonagem(auth):
    base = '/api/v1/horses'
    src = client.post(
        f'{base}/',
        headers=auth,
        json={
            'name': 'Quíron',
            'breed': 'Brasileiro de Hipismo',
            'weight_kg': 540,
            'sex': 'C',
            'birth_date': '2015-09-20',
            'coat': 'Castanho',
            'height_cm': 168,
            'girth_cm': 195.5,
            'fence_lat': -21.95,
            'fence_lon': -47.95,
            'fence_radius_m': 120,
        },
    ).json()
    assert (src['sex'], src['birth_date']) == ('C', '2015-09-20')
    assert (src['coat'], src['height_cm']) == ('Castanho', 168)
    assert (src['girth_cm'], src['cannon_cm']) == (195.5, None)
    for bad in ({'sex': 'X'}, {'height_cm': 0}, {'birth_date': '2999-01-01'}):
        r = client.post(f'{base}/', headers=auth, json={'name': 'Z', **bad})
        assert r.status_code == 422
    meals = f'{base}/{src["id"]}/meals'
    manha = {'shift': 'M', 'time': '06:30', 'kg': 3, 'x': 40, 'y': 35, 'z': 25}

    def put(**kw):
        return client.put(meals, headers=auth, json={**manha, **kw})

    assert len(put(weekdays=list(range(7))).json()['meals']) == 7  # diário
    tarde = {'shift': 'T', 'time': '13:00', 'kg': 2.5}
    assert len(put(weekdays=[0, 1, 2, 3, 4], **tarde).json()['meals']) == 12
    assert put(weekdays=[0], x=50).status_code == 422  # soma 110%
    assert put(weekdays=[0], time='25:00').status_code == 422
    assert put(weekdays=[7]).status_code == 422
    assert put(weekdays=[0], shift='X').status_code == 422
    assert put(weekdays=[]).status_code == 422

    got = put(weekdays=[0], kg=4).json()['meals']  # edita, não duplica
    assert len(got) == 12
    seg_manha = [m for m in got if (m['weekday'], m['shift']) == (0, 'M')]
    assert seg_manha[0]['kg'] == 4

    assert client.delete(f'{meals}/0/M', headers=auth).status_code == 204
    assert len(client.get(meals, headers=auth).json()['meals']) == 11

    clone = client.post(
        f'{base}/',
        params={'clone_from': src['id']},
        headers=auth,
        json={'name': 'Lua', 'weight_kg': 510},
    ).json()
    assert (clone['fence_lat'], clone['fence_radius_m']) == (-21.95, 120)
    assert clone['breed'] is None
    assert (clone['sex'], clone['height_cm']) == (None, None)
    assert clone['weight_kg'] == 510
    clone_meals = client.get(f'{base}/{clone["id"]}/meals', headers=auth)
    assert len(clone_meals.json()['meals']) == 11
    assert client.get(f'{base}/{src["id"]}', headers=auth).json()['breed'] == (
        'Brasileiro de Hipismo'
    )
    missing = client.post(
        f'{base}/',
        params={'clone_from': 9999},
        headers=auth,
        json={'name': 'X'},
    )
    assert missing.status_code == 404

    client.delete(f'{base}/{src["id"]}', headers=auth)
    assert client.get(meals, headers=auth).status_code == 404
    with SessionLocal() as s:
        assert (
            s.scalars(select(Meal).where(Meal.horse_id == src['id'])).all()
            == []
        )
    assert (
        len(
            client.get(f'{base}/{clone["id"]}/meals', headers=auth).json()[
                'meals'
            ]
        )
        == 11
    )
    client.delete(f'{base}/{clone["id"]}', headers=auth)


def test_alertas(auth):
    now = int(time.time())
    fence = {'fence_lat': -21.95, 'fence_lon': -47.95, 'fence_radius_m': 100}
    ids = {}
    for name, tag, extra in [
        ('Fujão', 'a1', fence),
        ('Sumido', 'a2', {}),
        ('Novo', 'a3', {}),
        ('Com erro', 'a4', {}),
        ('Sem tag', None, fence),
    ]:
        body = {'name': name, 'tag_id': tag, **extra}
        ids[name] = client.post(
            '/api/v1/horses/', headers=auth, json=body
        ).json()['id']
    with SessionLocal() as s:
        far = {'lat': -21.9545, 'lon': -47.95, 'accuracy': 10}  # ~500 m
        tracking.ingest(s, ids['Fujão'], [{**far, 'ts': now - 60}])
        tracking.ingest(s, ids['Sumido'], [{**far, 'ts': now - 7 * 3600}])
        tracking.ingest(s, ids['Com erro'], [{**far, 'ts': now - 120}])
        tracking.ingest(s, ids['Sem tag'], [{**far, 'ts': now - 60}])
    tracking.last_poll[ids['Com erro']] = {
        'at': now,
        'saved': 0,
        'error': 'RuntimeError: Conta Google não conectada.',
    }

    alerts = client.get('/api/v1/alerts/', headers=auth).json()['alerts']
    mine = [
        (a['name'], a['status'], a['desc'], a['to'])
        for a in alerts
        if a['horse_id'] in ids.values()
    ]
    assert mine == [  # mais recentes primeiro; "Sem tag" não é monitorado
        (
            'Com erro',
            'warn',
            'Falha ao consultar a tag: RuntimeError: Conta '
            'Google não conectada.',
            'google',
        ),
        ('Fujão', 'crit', 'Saiu da cerca virtual', 'localizacao'),
        ('Sumido', 'warn', 'Sem sinal da tag há 7 h', 'localizacao'),
        ('Novo', 'warn', 'Nenhuma posição recebida ainda', 'localizacao'),
    ]
    for horse_id in ids.values():
        client.delete(f'/api/v1/horses/{horse_id}', headers=auth)
    assert ids['Com erro'] not in tracking.last_poll


# --- Conta Google (GoogleFindMyTools) ---------------------------------------
def test_sem_login_nada_quebra(auth):
    st = client.get('/api/v1/findhub/status', headers=auth).json()
    assert (st['repo'], st['logged_in'], st['running']) == (
        False,
        False,
        False,
    )
    assert (
        client.get('/api/v1/findhub/trackers', headers=auth).status_code == 409
    )
    with SessionLocal() as s:
        h = Horse(name='SeekTag', tag_id='canonic-123')
        s.add(h)
        s.commit()
        result = tracking.poll_safe(s, h)  # o poller registra, não explode
    assert result['saved'] == 0
    assert 'não conectada' in result['error']


def test_baixa_lib_do_github():
    findhub.ensure_repo()
    assert (findhub.DIR / 'main.py').exists()
    assert (findhub.DIR / 'Auth' / 'token_cache.py').exists()
    findhub.ensure_repo()  # já existe: não baixa de novo


def test_upload_secrets_valida_e_conecta(auth):
    def up(raw):
        files = {'file': ('secrets.json', raw, 'application/json')}
        return client.post(
            '/api/v1/findhub/secrets', files=files, headers=auth
        )

    assert up(b'{isto nao e json').status_code == 400
    assert up(json.dumps(['lista']).encode()).status_code == 400
    assert up(json.dumps({'aas_token': 'x'}).encode()).status_code == 400
    ok = up(
        json.dumps({
            'aas_token': 'aas',
            'owner_key': 'ab' * 32,
            'username': 'dono@gmail.com',
        }).encode()
    )
    assert ok.status_code == 200
    assert ok.json()['logged_in'] is True
    assert ok.json()['email'] == 'dono@gmail.com'
    assert findhub.SECRETS.exists()


def _fake_update(key, t0):
    """DeviceUpdate como o Google devolve: report do celular do dono, report
    semântico e report de um Android qualquer, cifrados com a cripto da lib."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from FMDNCrypto.eid_generator import generate_eid
    from FMDNCrypto.foreign_tracker_cryptor import encrypt
    from ProtoDecoders import Common_pb2, DeviceUpdate_pb2

    def location(lat, lon):
        p = DeviceUpdate_pb2.Location(
            latitude=round(lat * 1e7), longitude=round(lon * 1e7)
        )
        return p.SerializeToString()

    update = DeviceUpdate_pb2.DeviceUpdate()
    info = update.deviceMetadata.information
    locs = info.locationInformation.reports.recentLocationAndNetworkLocations

    own = locs.networkLocations.add()  # AES-GCM com sha256(identity key)
    own.status = Common_pb2.Status.LAST_KNOWN
    iv = os.urandom(12)
    own.geoLocation.encryptedReport.encryptedLocation = iv + AESGCM(
        hashlib.sha256(key).digest()
    ).encrypt(iv, location(-21.95, -47.95), None)
    own.geoLocation.accuracy = 12.5
    locs.networkLocationTimestamps.add().seconds = t0

    semantic = locs.networkLocations.add()  # "Casa": sem lat/lon
    semantic.status = Common_pb2.Status.SEMANTIC
    semantic.semanticLocation.locationName = 'Casa'
    locs.networkLocationTimestamps.add().seconds = t0 + 60

    offset = 1_234_567  # ECDH SECP160r1 + AES-EAX com a EID do momento
    enc, sx = encrypt(
        location(-21.951, -47.951), os.urandom(20), generate_eid(key, offset)
    )
    geo = locs.recentLocation.geoLocation
    locs.recentLocation.status = Common_pb2.Status.CROWDSOURCED
    geo.encryptedReport.encryptedLocation = enc
    geo.encryptedReport.publicKeyRandom = sx
    geo.deviceTimeOffset = offset
    geo.accuracy = 30
    locs.recentLocationTimestamp.seconds = t0 + 600
    return update


EXPECTED = [
    {'ts': 1_700_000_000, 'lat': -21.95, 'lon': -47.95, 'accuracy': 12.5},
    {'ts': 1_700_000_600, 'lat': -21.951, 'lon': -47.951, 'accuracy': 30},
]


@pytest.fixture
def identity_key(monkeypatch):
    findhub._gfmt()
    from NovaApi.ExecuteAction.LocateTracker import decrypt_locations

    key = os.urandom(32)
    # Em produção vem de owner_key + registro da tag; aqui, uma chave fixa.
    monkeypatch.setattr(
        decrypt_locations, 'retrieve_identity_key', lambda reg: key
    )
    return key


def test_decifra_reports_com_a_cripto_da_lib(identity_key):
    got = findhub._decrypt(_fake_update(identity_key, 1_700_000_000))
    assert got == [pytest.approx(e) for e in EXPECTED]


def test_locate_espera_push_fcm_e_grava(identity_key, monkeypatch):
    import Auth.fcm_receiver
    import NovaApi.nova_request
    from ProtoDecoders import DeviceUpdate_pb2

    class FakeFcm:
        location_update_callbacks = []

        def register_for_location_updates(self, cb):
            self.location_update_callbacks.append(cb)
            return 'fcm-token'

    def fake_nova(scope, hex_payload):
        # A resposta real chega depois, por push; inclui uma de outro pedido.
        req = DeviceUpdate_pb2.ExecuteActionRequest()
        req.ParseFromString(bytes.fromhex(hex_payload))
        assert req.scope.device.canonicId.id == 'canonic-123'
        other = DeviceUpdate_pb2.DeviceUpdate()
        other.fcmMetadata.requestUuid = 'outro-pedido'
        mine = _fake_update(identity_key, 1_700_000_000)
        mine.fcmMetadata.requestUuid = req.requestMetadata.requestUuid

        def push():
            for upd in (other, mine):
                for cb in list(FakeFcm.location_update_callbacks):
                    cb(upd.SerializeToString().hex())

        threading.Timer(0.1, push).start()
        return ''

    monkeypatch.setattr(Auth.fcm_receiver, 'FcmReceiver', FakeFcm)
    monkeypatch.setattr(NovaApi.nova_request, 'nova_request', fake_nova)

    with SessionLocal() as s:
        h = s.scalars(select(Horse).where(Horse.tag_id == 'canonic-123')).one()
        assert tracking.poll_safe(s, h) == {
            'at': pytest.approx(time.time(), abs=5),
            'saved': 2,
            'error': None,
        }
        assert tracking.poll_safe(s, h)['saved'] == 0  # mesmo ponto de novo
    assert FakeFcm.location_update_callbacks == []  # callbacks não vazam


def test_um_login_por_vez(auth, monkeypatch):
    gate = threading.Event()

    def slow_login():
        gate.wait(5)
        findhub._login_lock.release()

    monkeypatch.setattr(findhub, '_login', slow_login)
    assert (
        client.post('/api/v1/findhub/login', headers=auth).status_code == 202
    )
    assert (
        client.post('/api/v1/findhub/login', headers=auth).status_code == 409
    )
    assert (
        client.get('/api/v1/findhub/status', headers=auth).json()['running']
        is True
    )
    gate.set()
    with findhub._login_lock:  # espera a thread terminar
        pass


def test_erro_no_login_aparece_no_status(monkeypatch):
    def lib_exits():
        raise SystemExit(1)  # a lib chama exit() quando as chaves não batem

    monkeypatch.setattr(findhub, '_gfmt', lib_exits)
    assert findhub.start_login()
    with findhub._login_lock:
        pass
    st = findhub.status()
    assert st['running'] is False
    assert st['error'].startswith('SystemExit')


def test_erro_do_selenium_vira_uma_linha():
    from selenium.common.exceptions import InvalidSessionIdException

    # Mensagem real de quando o usuário fecha a janela antes de logar.
    e = InvalidSessionIdException(
        'invalid session id: session deleted as the browser has closed the '
        'connection\nfrom disconnected: not connected to DevTools',
        stacktrace=['GetHandleVerifier [0xd21c73+4e33]'],
    )
    assert findhub.describe(e) == (
        'InvalidSessionIdException: Message: invalid session id: session '
        'deleted as the browser has closed the connection'
    )
    assert findhub.describe(SystemExit(1)) == 'SystemExit: 1'
    assert findhub.describe(TimeoutError()) == 'TimeoutError: '


def test_chrome_com_update_pendente_usa_versao_do_binario(monkeypatch):
    import undetected_chromedriver as uc
    from selenium.common.exceptions import SessionNotCreatedException

    calls = []

    def fake_chrome(options, version_main=None):
        calls.append(version_main)
        if version_main is None:
            raise SessionNotCreatedException(
                'This version of ChromeDriver only supports Chrome '
                'version 154\n'
                'Current browser version is 153.0.8010.54'
            )
        return 'driver'

    monkeypatch.setattr(uc, 'Chrome', fake_chrome)
    monkeypatch.setitem(
        sys.modules,
        'chrome_driver',
        types.SimpleNamespace(get_options=lambda: None),
    )
    assert findhub._chrome() == 'driver'
    assert calls == [None, 153]

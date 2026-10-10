"""Ponte para o GoogleFindMyTools (lib não oficial, engenharia reversa).

Sem secrets.json, o fluxo é: baixa o repo do GitHub (commit fixo) → abre um
Chrome controlado NA MÁQUINA DO SERVIDOR para o usuário entrar na conta (2x:
login e PIN do Android, que libera as chaves E2EE) → a lib grava tudo em
<GFMT_DIR>/Auth/secrets.json.

O login não dá para ser feito dentro do nosso front: o Google responde
X-Frame-Options: DENY (sem iframe) e o token sai de um cookie de
accounts.google.com que o nosso domínio não lê, nem com redirect. Servidor
sem tela: faça o login numa máquina com Chrome e envie o secrets.json.
"""

# ruff: noqa: PLC0415 — a lib só é importável depois de baixada (runtime).

import hashlib
import io
import json
import logging
import queue
import re
import sys
import threading
import zipfile
from pathlib import Path

import httpx

from main.settings import settings

log = logging.getLogger(__name__)

DIR = Path(settings.GFMT_DIR)
SECRETS = DIR / 'Auth' / 'secrets.json'
ZIP_URL = 'https://codeload.github.com/leonboe1/GoogleFindMyTools/zip/{}'
REQUIRED = ('aas_token', 'owner_key', 'username')

# Progresso do login em andamento, lido pelo front via /status.
state = {'step': '', 'error': ''}
_login_lock = threading.Lock()


def describe(e: BaseException) -> str:
    """Erro em uma linha (o do Selenium traz o stacktrace inteiro)."""
    first = (str(e).strip().splitlines() or [''])[0]
    return f'{type(e).__name__}: {first}'


def secrets() -> dict:
    try:
        data = json.loads(SECRETS.read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def ready() -> bool:
    s = secrets()
    return all(s.get(k) for k in REQUIRED)


def status() -> dict:
    return {
        'repo': (DIR / 'main.py').exists(),
        'commit': settings.GFMT_COMMIT[:7],
        'logged_in': ready(),
        'email': secrets().get('username', ''),
        'running': _login_lock.locked(),
        **state,
    }


def ensure_repo():
    """Baixa o GoogleFindMyTools do GitHub no commit fixo, se faltar."""
    if (DIR / 'main.py').exists():
        return
    url = ZIP_URL.format(settings.GFMT_COMMIT)
    res = httpx.get(url, follow_redirects=True, timeout=120)
    res.raise_for_status()
    DIR.parent.mkdir(parents=True, exist_ok=True)
    zipfile.ZipFile(io.BytesIO(res.content)).extractall(DIR.parent)
    (DIR.parent / f'GoogleFindMyTools-{settings.GFMT_COMMIT}').rename(DIR)


def _chrome():
    """create_driver da lib, sem o `taskkill chrome.exe` dela (fecharia o
    Chrome do usuário, com o nosso front junto)."""
    import undetected_chromedriver as uc
    from chrome_driver import get_options
    from selenium.common.exceptions import SessionNotCreatedException

    try:
        return uc.Chrome(options=get_options())
    except SessionNotCreatedException as e:
        # Chrome com update pendente roda a versão anterior à do driver.
        m = re.search(r'Current browser version is (\d+)', e.msg or '')
        if not m:
            raise
        return uc.Chrome(options=get_options(), version_main=int(m[1]))


def _gfmt():
    """Deixa a lib importável e tira dela o que só funciona em terminal."""
    ensure_repo()
    if str(DIR) not in sys.path:
        sys.path.append(str(DIR))  # append: main/config nossos têm prioridade
    import Auth.auth_flow
    import KeyBackup.shared_key_flow
    import KeyBackup.shared_key_retrieval

    def no_prompt(*_):  # a lib espera um "Enter" no terminal
        return ''

    Auth.auth_flow.input = no_prompt
    KeyBackup.shared_key_retrieval.input = no_prompt
    Auth.auth_flow.create_driver = _chrome
    KeyBackup.shared_key_flow.create_driver = _chrome


def start_login() -> bool:
    if not _login_lock.acquire(blocking=False):
        return False  # já tem um login em andamento
    state.update(step='Baixando o GoogleFindMyTools do GitHub...', error='')
    threading.Thread(target=_login, daemon=True).start()
    return True


def _login():
    try:
        _login_steps()
    except (Exception, SystemExit) as e:  # a lib chama exit() em alguns erros
        log.exception('login no Google falhou')
        state.update(step='', error=describe(e))
    finally:
        _login_lock.release()


def _login_steps():
    _gfmt()
    from Auth.aas_token_retrieval import get_aas_token
    from SpotApi.GetEidInfoForE2eeDevices.get_owner_key import get_owner_key

    state['step'] = (
        'Chrome aberto na máquina do servidor: entre na sua conta '
        'Google (1/2).'
    )
    get_aas_token()
    state['step'] = (
        'Chrome aberto de novo: entre outra vez e digite o PIN/padrão de '
        'desbloqueio do seu Android (2/2).'
    )
    get_owner_key()
    state['step'] = 'Conta conectada.'


def save_secrets(raw: bytes):
    """Instala um secrets.json gerado pelo login em outra máquina."""
    try:
        data = json.loads(raw)
    except ValueError:
        raise ValueError('Arquivo não é um JSON válido.')
    if not isinstance(data, dict) or not all(
        isinstance(data.get(k), str) and data[k] for k in REQUIRED
    ):
        raise ValueError(
            f'secrets.json incompleto: precisa de {", ".join(REQUIRED)} '
            '(faça as 2 etapas do login antes de exportar).'
        )
    ensure_repo()
    SECRETS.write_text(json.dumps(data))


def trackers() -> list[dict]:
    """Rastreadores da conta: [{name, id}] (id = canonic id)."""
    _gfmt()
    from NovaApi.ListDevices.nbe_list_devices import request_device_list
    from ProtoDecoders.decoder import (
        get_canonic_ids,
        parse_device_list_protobuf,
    )

    hex_ = request_device_list()
    if not hex_:
        raise RuntimeError('O Google recusou a listagem (veja o log).')
    devices = parse_device_list_protobuf(hex_)
    return [{'name': n, 'id': i} for n, i in get_canonic_ids(devices)]


def locate(canonic_id: str, timeout: int = 60) -> list[dict]:
    """Pede a localização ao Google e decifra os reports que voltarem."""
    if not ready():
        raise RuntimeError('Conta Google não conectada.')
    _gfmt()
    from Auth.fcm_receiver import FcmReceiver
    from NovaApi.ExecuteAction.LocateTracker.location_request import (
        create_location_request,
    )
    from NovaApi.nova_request import nova_request
    from NovaApi.scopes import NOVA_ACTION_API_SCOPE
    from NovaApi.util import generate_random_uuid
    from ProtoDecoders.decoder import parse_device_update_protobuf

    request_uuid = generate_random_uuid()
    answers = queue.Queue()

    def on_update(hex_):
        update = parse_device_update_protobuf(hex_)
        if update.fcmMetadata.requestUuid == request_uuid:
            answers.put(update)

    fcm = FcmReceiver()
    token = fcm.register_for_location_updates(on_update)
    try:
        payload = create_location_request(canonic_id, token, request_uuid)
        if nova_request(NOVA_ACTION_API_SCOPE, payload) is None:
            raise RuntimeError('O Google recusou o pedido (veja o log).')
        # A resposta não vem no HTTP: chega depois, por push (FCM).
        update = answers.get(timeout=timeout)
    except queue.Empty:
        raise RuntimeError(f'Sem resposta do Google em {timeout} s.')
    finally:
        fcm.location_update_callbacks.remove(on_update)
    return _decrypt(update)


def _decrypt(update) -> list[dict]:
    """decrypt_location_response_locations da lib, devolvendo em vez de
    imprimir. Pula reports "semânticos" (ex.: "Casa"), que não têm lat/lon."""
    from FMDNCrypto.foreign_tracker_cryptor import decrypt
    from KeyBackup.cloud_key_decryptor import decrypt_aes_gcm
    from NovaApi.ExecuteAction.LocateTracker.decrypt_locations import (
        is_mcu_tracker,
        retrieve_identity_key,
    )
    from ProtoDecoders import Common_pb2, DeviceUpdate_pb2

    info = update.deviceMetadata.information
    reg = info.deviceRegistration
    key = retrieve_identity_key(reg)
    locs = info.locationInformation.reports.recentLocationAndNetworkLocations
    pairs = list(zip(locs.networkLocations, locs.networkLocationTimestamps))
    if locs.HasField('recentLocation'):
        pairs.append((locs.recentLocation, locs.recentLocationTimestamp))

    reports = []
    for loc, t in pairs:
        if loc.status == Common_pb2.Status.SEMANTIC:
            continue
        enc = loc.geoLocation.encryptedReport
        if enc.publicKeyRandom == b'':  # report do próprio celular do dono
            raw = decrypt_aes_gcm(
                hashlib.sha256(key).digest(), enc.encryptedLocation
            )
        else:
            offset = (
                0 if is_mcu_tracker(reg) else loc.geoLocation.deviceTimeOffset
            )
            raw = decrypt(
                key, enc.encryptedLocation, enc.publicKeyRandom, offset
            )
        p = DeviceUpdate_pb2.Location()
        p.ParseFromString(raw)
        reports.append({
            'ts': int(t.seconds),
            'lat': p.latitude / 1e7,
            'lon': p.longitude / 1e7,
            'accuracy': float(loc.geoLocation.accuracy),
        })
    return reports

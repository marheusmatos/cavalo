import hmac
import logging
import time
from typing import Literal, Optional

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from main import alerts, sensor
from main.database import get_session
from main.models import Horse, SensorBlock
from main.schemas import (
    AlertLimits,
    AlertLimitsPublic,
    DeviceAlert,
    norm_sensor_id,
)
from main.security import get_current_user
from main.settings import settings

log = logging.getLogger(__name__)

# Chamado pelo ESP32: sem JWT (expira em 1 h); a chave vai em X-Sensor-Key.
device_router = APIRouter(prefix='/api/v1/device', tags=['device'])
sensors_router = APIRouter(
    prefix='/api/v1/sensors',
    tags=['sensors'],
    dependencies=[Depends(get_current_user)],
)
readings_router = APIRouter(
    prefix='/api/v1/horses/{horse_id}/sensor',
    tags=['sensors'],
    dependencies=[Depends(get_current_user)],
)

# Janela máxima de /raw: 1 h a 50 Hz são 180 mil leituras para descompactar.
RAW_MAX_S = 3600


def get_sensor_id(
    x_sensor_id: str = Header(description='MAC do ESP32'),
    x_sensor_key: str = Header(description='SENSOR_KEY do servidor'),
) -> str:
    """Dependência: confere a chave do ESP32 e devolve o id normalizado."""
    if not hmac.compare_digest(
        x_sensor_key.encode(), settings.SENSOR_KEY.encode()
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, 'Chave inválida')
    try:
        return norm_sensor_id(x_sensor_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))


async def _body(request, limit):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE,
                f'Envio maior que {limit} bytes',
            )
        chunks.append(chunk)
    return b''.join(chunks)


def _store(session, sensor_id, ip, contact, body):
    horse = session.scalars(
        select(Horse).where(Horse.sensor_id == sensor_id)
    ).first()
    last = {
        'at': contact.now_ms // 1000,
        'ip': ip,
        'boot': contact.boot,
        'error': None,
    }
    sensor.seen[sensor_id] = last
    if not horse:
        last['error'] = 'Sensor não vinculado a um cavalo'
        raise HTTPException(status.HTTP_409_CONFLICT, last['error'])
    try:
        result = sensor.ingest(session, horse.id, contact, body)
    except ValueError as e:
        log.warning('envio inválido do sensor %s: %s', sensor_id, e)
        last['error'] = f'Envio inválido: {e}'
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, last['error']
        )
    last.update(result)
    return result


@device_router.post('/upload')
async def upload(
    request: Request,
    boot: int = Query(ge=0, description='id do boot atual do ESP32'),
    uptime_ms: int = Query(ge=0, description='ms desde o boot, agora'),
    sensor_id: str = Depends(get_sensor_id),
    session: Session = Depends(get_session),
):
    """Recebe um trecho do arquivo do cartão SD (cabeçalho CAV2 + registros).

    200: o ESP32 avança o marcador (`duplicates` = trecho que já tinha vindo).
    409: sensor sem cavalo; tenta de novo no próximo contato.
    422: trecho corrompido; o ESP32 pula (continua no cartão).
    """
    contact = sensor.Contact(boot, uptime_ms, int(time.time() * 1000))
    body = await _body(request, settings.SENSOR_MAX_UPLOAD_BYTES)
    ip = request.client.host if request.client else None
    # SQLAlchemy síncrono: fora do event loop, como as rotas `def`.
    return await run_in_threadpool(
        _store, session, sensor_id, ip, contact, body
    )


def _bound_horse(session, sensor_id):
    horse = session.scalars(
        select(Horse).where(Horse.sensor_id == sensor_id)
    ).first()
    if not horse:
        raise HTTPException(
            status.HTTP_409_CONFLICT, 'Sensor não vinculado a um cavalo'
        )
    return horse


@device_router.get('/alerts')
def device_limits(
    ver: int = Query(0, ge=0, description='versao= do /alertas.txt do cartão'),
    sensor_id: str = Depends(get_sensor_id),
    session: Session = Depends(get_session),
):
    """/alertas.txt do cartão. 204 se o ESP32 já tem esta versão."""
    horse = _bound_horse(session, sensor_id)
    if horse.alert_ver == ver:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return Response(alerts.alert_file(horse), media_type='text/plain')


@device_router.post('/alert')
def device_alert(
    alert: DeviceAlert,
    sensor_id: str = Depends(get_sensor_id),
    session: Session = Depends(get_session),
):
    """O ESP32 viu uma leitura fora dos limites: registra e avisa o vet."""
    horse = _bound_horse(session, sensor_id)
    log.warning(
        'alerta de %s: %s',
        horse.name,
        alerts.describe(alert.kind, alert.value, alert.limit),
    )
    return alerts.record(session, horse, alert)


@sensors_router.get('/')
def list_sensors(session: Session = Depends(get_session)):
    """Sensores vinculados e os que fizeram contato desde que o app subiu."""
    q = select(Horse).where(Horse.sensor_id.is_not(None))
    bound = {h.sensor_id: h for h in session.scalars(q)}
    sensors = []
    for sensor_id in sorted(set(bound) | set(sensor.seen)):
        horse = bound.get(sensor_id)
        sensors.append({
            'id': sensor_id,
            'horse_id': horse.id if horse else None,
            'horse_name': horse.name if horse else None,
            'contact': sensor.seen.get(sensor_id),
        })
    return {'sensors': sensors}


def _check_horse(session, horse_id):
    if not session.get(Horse, horse_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Cavalo não encontrado')


@readings_router.get('/series')
def series(
    horse_id: int,
    kind: Literal['A', 'H', 'T'] = Query('A', description='sinal'),
    from_: int = Query(0, alias='from', description='epoch (s)'),
    to: Optional[int] = Query(None, description='epoch (s)'),
    session: Session = Depends(get_session),
):
    """Resumo de cada bloco (~1 min) do sinal: mínimo, máximo e média.

    A: intensidade do movimento em g (0 = parado); H: bpm; T: °C.
    `last_ts` é o fim do último bloco do sinal, dentro ou fora da janela.
    """
    _check_horse(session, horse_id)
    own = (SensorBlock.horse_id == horse_id, SensorBlock.kind == kind)
    q = select(
        SensorBlock.ts_ms,
        SensorBlock.dur_ms,
        SensorBlock.v_min,
        SensorBlock.v_max,
        SensorBlock.v_avg,
    ).where(
        *own, SensorBlock.ts_ms >= from_ * 1000, SensorBlock.v_avg.is_not(None)
    )
    if to is not None:
        q = q.where(SensorBlock.ts_ms < to * 1000)
    last = session.scalar(
        select(func.max(SensorBlock.ts_ms + SensorBlock.dur_ms)).where(*own)
    )
    return {
        'points': [
            {
                'ts': r.ts_ms // 1000,
                'dur': r.dur_ms // 1000,
                'min': r.v_min,
                'max': r.v_max,
                'avg': r.v_avg,
            }
            for r in session.execute(q.order_by(SensorBlock.ts_ms))
        ],
        'last_ts': last // 1000 if last else None,
    }


@readings_router.get('/raw')
def raw(
    horse_id: int,
    from_: int = Query(alias='from', description='epoch (s)'),
    to: int = Query(description='epoch (s)'),
    points: int = Query(600, ge=10, le=2000),
    session: Session = Depends(get_session),
):
    """Leituras do acelerômetro (x, y, z em g) numa janela de até 1 h.

    A janela é cortada em `points` intervalos e cada um traz a média das
    leituras; `t` é em epoch ms.
    """
    _check_horse(session, horse_id)
    if not 0 < to - from_ <= RAW_MAX_S:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f'Janela de 1 a {RAW_MAX_S} s',
        )
    q = select(SensorBlock).where(
        SensorBlock.horse_id == horse_id,
        SensorBlock.kind == 'A',
        SensorBlock.ts_ms < to * 1000,
        SensorBlock.ts_ms + SensorBlock.dur_ms > from_ * 1000,
    )
    blocks = session.scalars(q.order_by(SensorBlock.ts_ms)).all()
    return sensor.buckets(blocks, from_ * 1000, to * 1000, points)


@readings_router.get('/alerts', response_model=AlertLimitsPublic)
def get_limits(horse_id: int, session: Session = Depends(get_session)):
    """Limites de alerta do cavalo (None = sem limite)."""
    _check_horse(session, horse_id)
    return alerts.limits(session.get(Horse, horse_id))


@readings_router.put('/alerts', response_model=AlertLimitsPublic)
def put_limits(
    horse_id: int,
    data: AlertLimits,
    session: Session = Depends(get_session),
):
    """Troca os limites; o ESP32 baixa no próximo contato com o servidor."""
    _check_horse(session, horse_id)
    horse = session.get(Horse, horse_id)
    alerts.set_limits(horse, data.model_dump())
    session.commit()
    return alerts.limits(horse)

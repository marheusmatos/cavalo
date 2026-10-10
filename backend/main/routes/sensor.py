import hmac
import logging
import time

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from main import sensor
from main.database import get_session
from main.models import Horse
from main.schemas import norm_sensor_id
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

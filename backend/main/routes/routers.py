import time
from itertools import pairwise
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from main import alerts as sensor_alerts
from main import tracking
from main.database import get_session
from main.models import Horse, Meal, Position, SensorAlert, SensorBlock
from main.schemas import (
    HorseList,
    HorsePublic,
    HorseSchema,
    HorseUpdate,
    Latest,
    MealList,
    MealUpsert,
    Track,
)
from main.security import get_current_user
from main.tracking import haversine_m

horse_router = APIRouter(
    prefix='/api/v1/horses',
    tags=['horses'],
    dependencies=[Depends(get_current_user)],
)
alerts_router = APIRouter(
    prefix='/api/v1/alerts',
    tags=['alerts'],
    dependencies=[Depends(get_current_user)],
)

# Rede crowdsourced: buracos de horas são normais no pasto; 6 h já merece
# uma olhada.
SEM_SINAL_S = 6 * 3600
MEAL_FIELDS = ('weekday', 'shift', 'time', 'kg', 'x', 'y', 'z')


def _horse(session, horse_id):
    horse = session.get(Horse, horse_id)
    if not horse:
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Cavalo não encontrado')
    return horse


def _meals(session, horse_id):
    q = select(Meal).where(Meal.horse_id == horse_id)
    return session.scalars(q.order_by(Meal.weekday, Meal.shift)).all()


def _sensor_free(session, sensor_id, horse_id=None):
    """Um sensor manda os dados de um cavalo só."""
    if sensor_id is None:
        return
    q = select(Horse.name).where(Horse.sensor_id == sensor_id)
    if horse_id is not None:
        q = q.where(Horse.id != horse_id)
    other = session.scalars(q).first()
    if other:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f'Sensor já vinculado a {other}'
        )


@horse_router.get('/', response_model=HorseList)
def list_horses(session: Session = Depends(get_session)):
    return {'horses': session.scalars(select(Horse).order_by(Horse.id)).all()}


@horse_router.post(
    '/', response_model=HorsePublic, status_code=status.HTTP_201_CREATED
)
def create_horse(
    horse: HorseSchema,
    clone_from: Optional[int] = Query(
        None, description='copia a cerca e o plano de nutrição deste cavalo'
    ),
    session: Session = Depends(get_session),
):
    data = horse.model_dump()
    _sensor_free(session, data['sensor_id'])
    src = _horse(session, clone_from) if clone_from is not None else None
    if src:
        data.update(
            fence_lat=src.fence_lat,
            fence_lon=src.fence_lon,
            fence_radius_m=src.fence_radius_m,
        )
    new = Horse(**data)
    session.add(new)
    session.flush()
    for meal in _meals(session, src.id) if src else []:
        fields = {f: getattr(meal, f) for f in MEAL_FIELDS}
        session.add(Meal(horse_id=new.id, **fields))
    session.commit()
    session.refresh(new)
    return new


@horse_router.get('/{horse_id}', response_model=HorsePublic)
def get_horse(horse_id: int, session: Session = Depends(get_session)):
    return _horse(session, horse_id)


@horse_router.patch('/{horse_id}', response_model=HorsePublic)
def update_horse(
    horse_id: int, data: HorseUpdate, session: Session = Depends(get_session)
):
    horse = _horse(session, horse_id)
    changes = data.model_dump(exclude_unset=True)
    _sensor_free(session, changes.get('sensor_id'), horse_id)
    for field, value in changes.items():
        setattr(horse, field, value)
    session.commit()
    session.refresh(horse)
    return horse


@horse_router.delete('/{horse_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_horse(horse_id: int, session: Session = Depends(get_session)):
    horse = _horse(session, horse_id)
    session.execute(delete(Position).where(Position.horse_id == horse_id))
    session.execute(delete(Meal).where(Meal.horse_id == horse_id))
    session.execute(
        delete(SensorBlock).where(SensorBlock.horse_id == horse_id)
    )
    session.delete(horse)
    session.commit()
    tracking.last_poll.pop(horse_id, None)


@horse_router.get('/{horse_id}/positions', response_model=Track)
def get_track(
    horse_id: int,
    from_: int = Query(0, alias='from', description='epoch (s)'),
    to: Optional[int] = Query(None, description='epoch (s)'),
    session: Session = Depends(get_session),
):
    _horse(session, horse_id)
    q = select(Position).where(
        Position.horse_id == horse_id, Position.ts >= from_
    )
    if to is not None:
        q = q.where(Position.ts <= to)
    pts = session.scalars(q.order_by(Position.ts)).all()
    # ponytail: soma crua; com o cavalo parado o erro de 10–30 m do report
    # infla a distância. Suavizar (média móvel) se isso pesar na análise.
    dist = sum(
        haversine_m(a.lat, a.lon, b.lat, b.lon) for a, b in pairwise(pts)
    )
    span = pts[-1].ts - pts[0].ts if pts else 0
    return {
        'positions': pts,
        'distance_m': dist,
        'avg_speed_kmh': dist / span * 3.6 if span else 0,
    }


@horse_router.get('/{horse_id}/positions/latest', response_model=Latest)
def get_latest(horse_id: int, session: Session = Depends(get_session)):
    horse = _horse(session, horse_id)
    pos = tracking.last_position(session, horse_id)
    if not pos:
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Nenhuma posição ainda')
    return {
        'ts': pos.ts,
        'lat': pos.lat,
        'lon': pos.lon,
        'accuracy': pos.accuracy,
        'inside_fence': tracking.inside_fence(horse, pos),
    }


@horse_router.post('/{horse_id}/poll')
def poll_now(horse_id: int, session: Session = Depends(get_session)):
    """Consulta a tag agora, sem esperar o poller. Devolve {saved, error}."""
    horse = _horse(session, horse_id)
    if not horse.tag_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'Cavalo sem tag')
    return tracking.poll_safe(session, horse)


# --- Nutrição ----------------------------------------------------------------
@horse_router.get('/{horse_id}/meals', response_model=MealList)
def list_meals(horse_id: int, session: Session = Depends(get_session)):
    _horse(session, horse_id)
    return {'meals': _meals(session, horse_id)}


@horse_router.put('/{horse_id}/meals', response_model=MealList)
def upsert_meals(
    horse_id: int, data: MealUpsert, session: Session = Depends(get_session)
):
    """Grava a refeição do turno em cada dia de `weekdays` (recorrência)."""
    _horse(session, horse_id)
    fields = data.model_dump(exclude={'weekdays'})
    for day in set(data.weekdays):
        q = select(Meal).where(
            Meal.horse_id == horse_id,
            Meal.weekday == day,
            Meal.shift == data.shift,
        )
        meal = session.scalars(q).first() or Meal(horse_id=horse_id)
        for field, value in {**fields, 'weekday': day}.items():
            setattr(meal, field, value)
        session.add(meal)
    session.commit()
    return {'meals': _meals(session, horse_id)}


@horse_router.delete(
    '/{horse_id}/meals/{weekday}/{shift}',
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_meal(
    horse_id: int,
    weekday: int,
    shift: Literal['M', 'T', 'N'],
    session: Session = Depends(get_session),
):
    session.execute(
        delete(Meal).where(
            Meal.horse_id == horse_id,
            Meal.weekday == weekday,
            Meal.shift == shift,
        )
    )
    session.commit()


# --- Alertas (calculados na hora a partir do que já está no banco) -----------
@alerts_router.get('/')
def list_alerts(session: Session = Depends(get_session)):
    now = time.time()
    alerts = []

    def add(horse, level, desc, ts, to):
        alerts.append({
            'horse_id': horse.id,
            'name': horse.name,
            'status': level,
            'desc': desc,
            'ts': ts,
            'to': to,
        })

    q = select(Horse).where(Horse.tag_id.is_not(None)).order_by(Horse.id)
    for horse in session.scalars(q):
        poll = tracking.last_poll.get(horse.id) or {}
        if poll.get('error'):
            add(
                horse,
                'warn',
                f'Falha ao consultar a tag: {poll["error"]}',
                poll['at'],
                'google',
            )
        pos = tracking.last_position(session, horse.id)
        if pos is None:
            add(
                horse,
                'warn',
                'Nenhuma posição recebida ainda',
                None,
                'localizacao',
            )
        elif tracking.inside_fence(horse, pos) is False:
            add(horse, 'crit', 'Saiu da cerca virtual', pos.ts, 'localizacao')
        elif now - pos.ts > SEM_SINAL_S:
            hours = int((now - pos.ts) // 3600)
            add(
                horse,
                'warn',
                f'Sem sinal da tag há {hours} h',
                pos.ts,
                'localizacao',
            )
    # Sensor: o último alerta de cada sinal nas últimas 24 h.
    q = (
        select(SensorAlert, Horse)
        .join(Horse, Horse.id == SensorAlert.horse_id)
        .where(SensorAlert.ts > now - 24 * 3600, SensorAlert.kind != 'C')
        .order_by(SensorAlert.ts.desc())
    )
    shown = set()
    for row, horse in session.execute(q):
        if (horse.id, row.kind) in shown:
            continue
        shown.add((horse.id, row.kind))
        add(
            horse,
            'crit',
            sensor_alerts.describe(row.kind, row.value, row.limit),
            row.ts,
            'atividade' if row.kind == 'A' else 'biometria',
        )
    alerts.sort(key=lambda a: a['ts'] or 0, reverse=True)
    return {'alerts': alerts}

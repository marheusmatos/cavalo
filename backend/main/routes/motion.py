"""Padrões de movimento: marcações do veterinário, treino e o modelo do sensor."""

import json
import time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from main import motion, sensor
from main.database import get_session
from main.models import Horse, MotionModel, Pattern, PatternLabel, SensorBlock
from main.schemas import LabelIn, PatternIn
from main.security import get_current_user

motion_router = APIRouter(
    prefix='/api/v1/motion',
    tags=['motion'],
    dependencies=[Depends(get_current_user)],
)


def _pattern_out(p, labels=0):
    return {
        'id': p.id,
        'name': p.name,
        'code': p.code,
        'alert_n': p.alert_n,
        'alert_min': p.alert_min,
        'labels': labels,
    }


def _pattern(session, pattern_id):
    p = session.get(Pattern, pattern_id)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Padrão não encontrado')
    return p


def _name_free(session, name, pattern_id=None):
    q = select(Pattern.id).where(func.lower(Pattern.name) == name.lower())
    other = session.scalar(q)
    if other is not None and other != pattern_id:
        raise HTTPException(status.HTTP_409_CONFLICT, 'Já existe um padrão com este nome')


@motion_router.get('/patterns')
def list_patterns(session: Session = Depends(get_session)):
    counts = dict(
        session.execute(
            select(PatternLabel.pattern_id, func.count()).group_by(
                PatternLabel.pattern_id
            )
        ).all()
    )
    return {
        'patterns': [
            _pattern_out(p, counts.get(p.id, 0))
            for p in session.scalars(select(Pattern).order_by(Pattern.id))
        ]
    }


@motion_router.post('/patterns', status_code=status.HTTP_201_CREATED)
def create_pattern(data: PatternIn, session: Session = Depends(get_session)):
    _name_free(session, data.name)
    p = Pattern(**data.model_dump())
    session.add(p)
    session.commit()
    return _pattern_out(p)


@motion_router.put('/patterns/{pattern_id}')
def update_pattern(
    pattern_id: int, data: PatternIn, session: Session = Depends(get_session)
):
    """Nome e alerta. O alerta vai para o sensor no próximo treino."""
    p = _pattern(session, pattern_id)
    _name_free(session, data.name, pattern_id)
    for k, v in data.model_dump().items():
        setattr(p, k, v)
    session.commit()
    return _pattern_out(p)


@motion_router.delete('/patterns/{pattern_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_pattern(pattern_id: int, session: Session = Depends(get_session)):
    p = _pattern(session, pattern_id)
    session.execute(delete(PatternLabel).where(PatternLabel.pattern_id == pattern_id))
    session.delete(p)
    session.commit()


def _label_out(lab):
    return {
        'id': lab.id,
        'pattern_id': lab.pattern_id,
        'horse_id': lab.horse_id,
        'from_ms': lab.from_ms,
        'to_ms': lab.to_ms,
        'axes': lab.axes,
    }


@motion_router.get('/labels')
def list_labels(
    horse_id: int = Query(description='cavalo'),
    session: Session = Depends(get_session),
):
    q = select(PatternLabel).where(PatternLabel.horse_id == horse_id)
    return {'labels': [_label_out(lab) for lab in session.scalars(q.order_by(PatternLabel.from_ms))]}


@motion_router.post('/labels', status_code=status.HTTP_201_CREATED)
def create_label(data: LabelIn, session: Session = Depends(get_session)):
    _pattern(session, data.pattern_id)
    if not session.get(Horse, data.horse_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Cavalo não encontrado')
    lab = PatternLabel(**data.model_dump())
    session.add(lab)
    session.commit()
    return _label_out(lab)


@motion_router.delete('/labels/{label_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_label(label_id: int, session: Session = Depends(get_session)):
    lab = session.get(PatternLabel, label_id)
    if not lab:
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Marcação não encontrada')
    session.delete(lab)
    session.commit()


def latest_model(session):
    return session.scalars(
        select(MotionModel).order_by(MotionModel.ver.desc()).limit(1)
    ).first()


def _model_out(m):
    if not m:
        return None
    return {'ver': m.ver, 'created': m.created, 'metrics': json.loads(m.metrics)}


@motion_router.get('/model')
def get_model(session: Session = Depends(get_session)):
    """Último treino (None = nunca treinou)."""
    return {'model': _model_out(latest_model(session))}


def _segments(session, labels):
    """Leituras de cada cavalo perto das marcações dele (cache por cavalo)."""
    cache = {}

    def segs_of(horse_id):
        if horse_id not in cache:
            mine = [lab for lab in labels if lab.horse_id == horse_id]
            lo = min(lab.from_ms for lab in mine) - motion.NEG_MARGIN_MS
            hi = max(lab.to_ms for lab in mine) + motion.NEG_MARGIN_MS
            blocks = session.scalars(
                select(SensorBlock).where(
                    SensorBlock.horse_id == horse_id,
                    SensorBlock.kind == 'A',
                    SensorBlock.ts_ms < hi,
                    SensorBlock.ts_ms + SensorBlock.dur_ms > lo,
                )
            ).all()
            cache[horse_id] = motion.segments(blocks, sensor.decode)
        return cache[horse_id]

    return segs_of


@motion_router.post('/train')
def train(session: Session = Depends(get_session)):
    """Treina um detector por padrão marcado e guarda o /modelo.bin novo."""
    labels = session.scalars(select(PatternLabel)).all()
    segs_of = _segments(session, labels)
    detectors, metrics = [], {}
    for p in session.scalars(select(Pattern).order_by(Pattern.id)):
        mine = [
            (lab.horse_id, lab.from_ms, lab.to_ms, lab.axes)
            for lab in labels
            if lab.pattern_id == p.id
        ]
        if not mine:
            continue
        d = motion.train_pattern(mine, segs_of)
        if d is None:
            metrics[p.id] = {'name': p.name, 'error': 'Sem leituras do sensor nos trechos marcados'}
            continue
        detectors.append({
            **d, 'code': p.code, 'name': p.name,
            'alert_n': p.alert_n, 'alert_min': p.alert_min,
        })
        metrics[p.id] = {
            'name': p.name,
            'axes': d['axes'],
            'win_s': d['win'] / motion.HZ,
            **d['metrics'],
        }
    if not detectors:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            'Marque ao menos um trecho com leituras do sensor antes de treinar',
        )
    last = latest_model(session)
    ver = max((last.ver + 1) if last else 1, int(time.time()))
    m = MotionModel(
        ver=ver,
        created=int(time.time()),
        metrics=json.dumps(metrics),
        blob=motion.pack(ver, detectors),
    )
    session.add(m)
    session.commit()
    return _model_out(m)

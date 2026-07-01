from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import guard
from main.database import get_session
from main.models import Car
from main.schemas import *
from main.security import get_current_user
from main.settings import settings

car_router = APIRouter(prefix='/api/v1/cars', tags=['cars'])


@car_router.post(
    '/', response_model=CarPublic, status_code=status.HTTP_201_CREATED
)
@guard.rate_limit(
    requests=settings.RATE_LIMIT_REQUESTS, window=settings.RATE_LIMIT_WINDOW
)
async def create_car(
    request: Request,
    car: CarSchema,
    session: Session = Depends(get_session),
    current_user: str = Depends(get_current_user),
):
    car = Car(**car.model_dump())
    session.add(car)
    session.commit()
    session.refresh(car)
    return car


@car_router.get('/', response_model=CarList)
@guard.rate_limit(
    requests=settings.RATE_LIMIT_REQUESTS, window=settings.RATE_LIMIT_WINDOW
)
async def list_cars(
    request: Request,
    session: Session = Depends(get_session),
    current_user: str = Depends(get_current_user),
    offset: int = 0,
    limit: int = 100,
):
    query = session.scalars(select(Car).offset(offset).limit(limit))
    result = query.all()
    return {'cars': result}

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from main.schemas import *
from main.database import get_session
from main.models import Car

router = APIRouter(prefix='/api/v1/cars', tags=['cars'])



@router.post(
    '/', response_model=CarPublic, status_code=status.HTTP_201_CREATED
)
def create_car(
    car: CarSchema,
    session: Session = Depends(get_session),
):
    car = Car(**car.model_dump())
    session.add(car)
    session.commit()
    session.refresh(car)
    return car

@router.get('/', response_model=CarList)
def list_cars(
    session: Session = Depends(get_session),
    offset: int = 0,
    limit: int = 100,
):
    query = session.scalars(select(Car).offset(offset).limit(limit))
    cars = query.all()
    return {'cars': cars}

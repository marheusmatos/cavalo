from typing import Optional

from pydantic import BaseModel


class CarSchema(BaseModel):
    brand: str
    model: str
    color: Optional[str] = None
    year: int = None
    price: float = None

class CarPublic(BaseModel):
    id: int
    brand: str
    model: str
    color: str
    year: int
    price: float


class CarList(BaseModel):
    cars: list[CarPublic]

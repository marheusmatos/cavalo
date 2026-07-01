from sqlalchemy import Column, Float, Integer, String

from main.database import Base


class Car(Base):
    __tablename__ = "cars"

    id = Column(Integer, primary_key=True, index=True)
    color = Column(String(100), nullable=True) 
    brand = Column(String(100), nullable=False)
    model = Column(String(100), nullable=False)
    year = Column(Integer, nullable=False)
    price = Column(Float, nullable=False)

    def __repr__(self):
        return f"<Car(id={self.id}, brand='{self.brand}', model='{self.model}')>"

from sqlalchemy import (
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from main.database import Base


class Horse(Base):
    __tablename__ = 'horses'

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    breed = Column(String(100), nullable=True)
    weight_kg = Column(Float, nullable=True)
    # canonic id do rastreador no Find Hub; 'demo' = tag simulada.
    tag_id = Column(String(200), nullable=True)
    # Geofence circular (opcional).
    fence_lat = Column(Float, nullable=True)
    fence_lon = Column(Float, nullable=True)
    fence_radius_m = Column(Float, nullable=True)

    def __repr__(self):
        return f"<Horse(id={self.id}, name='{self.name}')>"


class Position(Base):
    __tablename__ = 'positions'
    # O Google repete o último report: mesmo (cavalo, timestamp) = mesmo ponto.
    # O índice desta constraint também serve às buscas por cavalo/tempo.
    __table_args__ = (UniqueConstraint('horse_id', 'ts'),)

    id = Column(Integer, primary_key=True)
    horse_id = Column(Integer, ForeignKey('horses.id'), nullable=False)
    # epoch (s) em que o celular viu a tag
    ts = Column(Integer, nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    accuracy = Column(Float, nullable=False)  # metros


class Meal(Base):
    """Plano semanal: uma refeição por (cavalo, dia da semana, turno)."""

    __tablename__ = 'meals'
    __table_args__ = (UniqueConstraint('horse_id', 'weekday', 'shift'),)

    id = Column(Integer, primary_key=True)
    horse_id = Column(Integer, ForeignKey('horses.id'), nullable=False)
    weekday = Column(Integer, nullable=False)  # 0 = segunda … 6 = domingo
    shift = Column(String(1), nullable=False)  # M(anhã), T(arde), N(oite)
    time = Column(String(5), nullable=False)  # HH:MM
    kg = Column(Float, nullable=False)
    # Composição em % das rações X, Y e Z (soma 100).
    x = Column(Integer, nullable=False)
    y = Column(Integer, nullable=False)
    z = Column(Integer, nullable=False)

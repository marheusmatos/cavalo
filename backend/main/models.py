from sqlalchemy import (
    BigInteger,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
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
    # MAC do ESP32 (12 hex) que manda biometria/atividade deste cavalo.
    sensor_id = Column(String(12), nullable=True, unique=True, index=True)
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


class SensorBlock(Base):
    """Um bloco (~1 min) de leituras de um sinal do sensor do cavalo.

    Os gráficos leem só o resumo (v_min/v_max/v_avg); `data` guarda todas as
    leituras do bloco, para o zoom e para treinar o classificador.
    """

    __tablename__ = 'sensor_blocks'
    __table_args__ = (
        # Identidade do bloco no ESP32: reenviar o mesmo trecho não duplica.
        # O índice também acha o último bloco de um boot (acerto do relógio).
        UniqueConstraint('horse_id', 'boot', 'uptime_ms', 'kind'),
        Index('ix_sensor_blocks_series', 'horse_id', 'kind', 'ts_ms'),
    )

    id = Column(Integer, primary_key=True)
    horse_id = Column(Integer, ForeignKey('horses.id'), nullable=False)
    # A(celerômetro), H (intervalo entre batimentos), T(emperatura), E(vento)
    kind = Column(String(1), nullable=False)
    boot = Column(BigInteger, nullable=False)  # id aleatório do boot do ESP32
    uptime_ms = Column(BigInteger, nullable=False)  # fim do bloco, do boot
    ts_ms = Column(BigInteger, nullable=False)  # início do bloco, epoch (ms)
    dur_ms = Column(Integer, nullable=False)
    n = Column(Integer, nullable=False)  # leituras no bloco
    ch = Column(Integer, nullable=False)  # valores por leitura (acel.: 3)
    scale = Column(Float, nullable=False)  # valor real = bruto * scale
    # Resumo na unidade do gráfico: intensidade do movimento (g), bpm ou °C.
    v_min = Column(Float, nullable=True)
    v_max = Column(Float, nullable=True)
    v_avg = Column(Float, nullable=True)
    # Por último: blob grande vai para páginas à parte e o resumo lê rápido.
    data = Column(LargeBinary, nullable=False)  # zlib das leituras brutas


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

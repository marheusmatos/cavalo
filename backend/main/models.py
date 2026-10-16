from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)

from main.database import Base


class Horse(Base):
    __tablename__ = 'horses'

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    breed = Column(String(100), nullable=True)
    weight_kg = Column(Float, nullable=True)
    # Características: sexo M(acho), F(êmea) ou C(astrado).
    sex = Column(String(1), nullable=True)
    birth_date = Column(Date, nullable=True)
    coat = Column(String(50), nullable=True)  # pelagem
    notes = Column(String(500), nullable=True)  # marcas e observações
    # Dimensões (cm): cernelha, perímetro torácico, corpo e canela.
    height_cm = Column(Float, nullable=True)
    girth_cm = Column(Float, nullable=True)
    length_cm = Column(Float, nullable=True)
    cannon_cm = Column(Float, nullable=True)
    # canonic id do rastreador no Find Hub; 'demo' = tag simulada.
    tag_id = Column(String(200), nullable=True)
    # MAC do ESP32 (12 hex) que manda biometria/atividade deste cavalo.
    sensor_id = Column(String(12), nullable=True, unique=True, index=True)
    # Geofence circular (opcional).
    fence_lat = Column(Float, nullable=True)
    fence_lon = Column(Float, nullable=True)
    fence_radius_m = Column(Float, nullable=True)
    # Limites de alerta do sensor (None = sem limite): bpm, °C e intensidade
    # do movimento (g, média de 10 s). alert_ver muda a cada alteração: o
    # ESP32 compara com a do /alertas.txt do cartão e baixa de novo.
    alert_bpm_min = Column(Float, nullable=True)
    alert_bpm_max = Column(Float, nullable=True)
    alert_temp_min = Column(Float, nullable=True)
    alert_temp_max = Column(Float, nullable=True)
    alert_mov_max = Column(Float, nullable=True)
    alert_ver = Column(Integer, nullable=False, default=0, server_default='0')
    # Ajustes do sensor pelo portal (None = vale o config.txt do cartão). Vão
    # no mesmo /alertas.txt, com a mesma versão (alert_ver).
    sensor_accel_hz = Column(Integer, nullable=True)
    sensor_upload_s = Column(Integer, nullable=True)
    sensor_temp_s = Column(Integer, nullable=True)
    sensor_temp_offset = Column(Float, nullable=True)  # °C somados à leitura
    sensor_bpm_offset = Column(Float, nullable=True)  # bpm somados à leitura
    # Fator da intensidade do movimento: vale no alerta do ESP32 e nos
    # gráficos (aplicado na leitura; os dados brutos não mudam).
    sensor_mov_gain = Column(Float, nullable=True)
    # Orientação: matriz 3x3 (9 números, linha a linha) que o ESP32 aplica às
    # leituras para o Z ficar na gravidade. rot_at/rot_ver: quando ela mudou
    # e em que versão do arquivo; sent_at/sent_ver: quando o ESP32 baixou o
    # arquivo pela última vez e qual versão (dali em diante as leituras já
    # chegam giradas).
    sensor_rot = Column(String(200), nullable=True)
    sensor_rot_at = Column(Integer, nullable=True)
    sensor_rot_ver = Column(Integer, nullable=True)
    sensor_sent_at = Column(Integer, nullable=True)
    sensor_sent_ver = Column(Integer, nullable=True)

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


class SensorAlert(Base):
    """Um alerta que o ESP32 disparou (leitura fora dos limites do cavalo)."""

    __tablename__ = 'sensor_alerts'
    __table_args__ = (Index('ix_sensor_alerts_horse_ts', 'horse_id', 'ts'),)

    id = Column(Integer, primary_key=True)
    horse_id = Column(Integer, ForeignKey('horses.id'), nullable=False)
    ts = Column(Integer, nullable=False)  # epoch (s) em que chegou
    kind = Column(String(1), nullable=False)  # H (bpm), T (°C), A (movimento)
    value = Column(Float, nullable=False)
    limit = Column(Float, nullable=False)  # o limite que foi passado
    code = Column(Integer, nullable=True)  # P: código do padrão de movimento
    email = Column(String(254), nullable=True)  # veterinário avisado
    emailed = Column(Boolean, nullable=False, default=False)


class Pattern(Base):
    """Padrão de movimento que o modelo do sensor aprende (Pulo, Volta…).

    O ESP32 registra cada detecção como evento de código 10 + id. Alerta
    opcional: alert_n detecções em alert_min minutos.
    """

    __tablename__ = 'patterns'

    id = Column(Integer, primary_key=True)
    name = Column(String(40), nullable=False, unique=True)
    alert_n = Column(Integer, nullable=True)
    alert_min = Column(Integer, nullable=True)

    @property
    def code(self):
        return 10 + self.id


class PatternLabel(Base):
    """Trecho do acelerômetro que o veterinário marcou como um padrão."""

    __tablename__ = 'pattern_labels'

    id = Column(Integer, primary_key=True)
    pattern_id = Column(Integer, ForeignKey('patterns.id'), nullable=False)
    horse_id = Column(Integer, ForeignKey('horses.id'), nullable=False)
    from_ms = Column(BigInteger, nullable=False)  # epoch
    to_ms = Column(BigInteger, nullable=False)
    axes = Column(String(3), nullable=False)  # eixos em que o padrão aparece


class MotionModel(Base):
    """Cada treino: o /modelo.bin que vai para os sensores (o maior ver vale)."""

    __tablename__ = 'motion_models'

    id = Column(Integer, primary_key=True)
    ver = Column(Integer, nullable=False, unique=True)
    created = Column(Integer, nullable=False)  # epoch (s)
    metrics = Column(Text, nullable=False)  # JSON, por padrão
    blob = Column(LargeBinary, nullable=False)

import re
from datetime import date
from typing import Annotated, Literal, Optional

from pydantic import (
    BaseModel,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)


def norm_sensor_id(value: str) -> str:
    """MAC do ESP32 em 12 hex minúsculos ('F4:2D:…' -> 'f42d…')."""
    mac = re.sub(r'[:\-\s]', '', value).lower()
    if not re.fullmatch(r'[0-9a-f]{12}', mac):
        raise ValueError('Sensor inválido: informe o MAC do ESP32 (12 hex)')
    return mac


class HorseSchema(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    breed: Optional[str] = Field(default=None, max_length=100)
    weight_kg: Optional[float] = Field(default=None, gt=0, le=2000)
    sex: Optional[Literal['M', 'F', 'C']] = None
    birth_date: Optional[date] = None
    coat: Optional[str] = Field(default=None, max_length=50)
    notes: Optional[str] = Field(default=None, max_length=500)
    height_cm: Optional[float] = Field(default=None, gt=0, le=250)
    girth_cm: Optional[float] = Field(default=None, gt=0, le=400)
    length_cm: Optional[float] = Field(default=None, gt=0, le=400)
    cannon_cm: Optional[float] = Field(default=None, gt=0, le=60)
    tag_id: Optional[str] = Field(default=None, max_length=200)
    sensor_id: Optional[str] = None
    fence_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    fence_lon: Optional[float] = Field(default=None, ge=-180, le=180)
    fence_radius_m: Optional[float] = Field(default=None, gt=0)
    # Intensidade do treino (o dono do cavalo muda).
    training_level: Optional[Literal['easy', 'medium', 'hard']] = None

    @field_validator('sensor_id')
    @classmethod
    def _mac(cls, value):
        return value if value is None else norm_sensor_id(value)

    @field_validator('birth_date')
    @classmethod
    def _nascido(cls, value):
        if value and value > date.today():
            raise ValueError('A data de nascimento não pode estar no futuro')
        return value


class HorseUpdate(HorseSchema):
    # `str` com default None: omitir mantém o nome; mandar null dá 422.
    name: str = Field(default=None, min_length=1, max_length=100)


class HorsePublic(HorseSchema):
    id: int


class HorseList(BaseModel):
    horses: list[HorsePublic]


class PositionPublic(BaseModel):
    ts: int
    lat: float
    lon: float
    accuracy: float


class Track(BaseModel):
    positions: list[PositionPublic]
    distance_m: float
    avg_speed_kmh: float


class Latest(PositionPublic):
    inside_fence: Optional[bool]  # None = cavalo sem cerca


# --- Nutrição ----------------------------------------------------------------
class MealBase(BaseModel):
    shift: Literal['M', 'T', 'N']
    time: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    kg: float = Field(gt=0, le=50)
    x: int = Field(ge=0, le=100)
    y: int = Field(ge=0, le=100)
    z: int = Field(ge=0, le=100)

    @model_validator(mode='after')
    def _soma_100(self):
        if self.x + self.y + self.z != 100:  # noqa: PLR2004
            raise ValueError('A composição da ração precisa somar 100%')
        return self


class MealUpsert(MealBase):
    # Recorrência: o front manda [dia], os 7 dias ou seg–sex.
    weekdays: list[Annotated[int, Field(ge=0, le=6)]] = Field(min_length=1)


class MealPublic(MealBase):
    weekday: int


class MealList(BaseModel):
    meals: list[MealPublic]


# --- Alertas do sensor -------------------------------------------------------
class AlertLimits(BaseModel):
    """Limites de um cavalo; None = aquele lado não alerta."""

    bpm_min: Optional[float] = Field(default=None, ge=10, le=300)
    bpm_max: Optional[float] = Field(default=None, ge=10, le=300)
    temp_min: Optional[float] = Field(default=None, ge=20, le=45)
    temp_max: Optional[float] = Field(default=None, ge=20, le=45)
    mov_max: Optional[float] = Field(default=None, gt=0, le=8)

    @model_validator(mode='after')
    def _faixa(self):
        for lo, hi, name in (
            (self.bpm_min, self.bpm_max, 'batimentos'),
            (self.temp_min, self.temp_max, 'temperatura'),
        ):
            if lo is not None and hi is not None and lo >= hi:
                raise ValueError(f'Em {name}, o mínimo precisa ser menor que o máximo')
        return self


class SensorSettings(BaseModel):
    """Ajustes do sensor pelo portal; None = vale o config.txt do cartão.

    accel_hz é a frequência de obtenção dos dados: o acelerômetro lê nela e a
    temperatura também, até o limite do sensor (1 a cada 2 s); os batimentos
    seguem em 25 leituras/s, o mínimo para achar o pulso. Só os campos
    enviados mudam.
    """

    accel_hz: Optional[int] = None
    upload_s: Optional[int] = Field(default=None, ge=60, le=3600)
    temp_s: Optional[int] = Field(default=None, ge=2, le=3600)
    temp_offset: Optional[float] = Field(default=None, ge=-10, le=10)
    bpm_offset: Optional[float] = Field(default=None, ge=-60, le=60)
    mov_gain: Optional[float] = Field(default=None, gt=0, le=10)

    @field_validator('accel_hz')
    @classmethod
    def _hz(cls, value):
        # O MPU6050 divide 1 kHz por um inteiro e o FIFO aguenta até 50/s.
        if value is not None and value not in (10, 20, 25, 40, 50):
            raise ValueError('Use 10, 20, 25, 40 ou 50 leituras por segundo')
        return value


class SensorSettingsPublic(SensorSettings):
    ver: int
    rot: Optional[list[float]]  # None = sem calibração de orientação
    rot_at: Optional[int]
    rot_pending: bool  # calibrada, mas o sensor ainda não baixou


class AlertLimitsPublic(AlertLimits):
    ver: int  # muda a cada alteração; o ESP32 baixa de novo quando muda


class DeviceAlert(BaseModel):
    """O que o ESP32 manda quando uma leitura sai dos limites."""

    # bpm, °C, movimento (g), C(erca): distância do centro (m) e o raio,
    # P(adrão de movimento): detecções seguidas e o N do alerta
    kind: Literal['H', 'T', 'A', 'C', 'P']
    code: Optional[int] = Field(default=None, ge=0, le=255)  # P: qual padrão
    value: float
    limit: float
    vet: Optional[EmailStr] = None  # vet_email do config.txt do cartão


# --- Padrões de movimento (modelo do sensor) --------------------------------
class PatternIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    # Alerta: alert_n detecções em alert_min minutos (os dois ou nenhum).
    alert_n: Optional[int] = Field(default=None, ge=1, le=255)
    alert_min: Optional[int] = Field(default=None, ge=1, le=1440)

    @model_validator(mode='after')
    def _par(self):
        if (self.alert_n is None) != (self.alert_min is None):
            raise ValueError('Informe as detecções e os minutos do alerta, ou nenhum')
        return self


class LabelIn(BaseModel):
    pattern_id: int
    horse_id: int
    from_ms: int = Field(ge=0)
    to_ms: int = Field(ge=0)
    axes: str = Field(pattern=r'^[xyz]{1,3}$')  # 1 a 3 eixos

    @model_validator(mode='after')
    def _trecho(self):
        if not 300 <= self.to_ms - self.from_ms <= 30_000:  # noqa: PLR2004
            raise ValueError('O trecho marcado precisa ter de 0,3 a 30 s')
        if len(set(self.axes)) != len(self.axes):
            raise ValueError('Eixo repetido')
        self.axes = ''.join(a for a in 'xyz' if a in self.axes)
        return self


# --- Autenticação (resposta do login, não é tabela) ------------------------
class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    role: str = 'admin'  # admin, veterinario ou dono

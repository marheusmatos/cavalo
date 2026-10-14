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


class AlertLimitsPublic(AlertLimits):
    ver: int  # muda a cada alteração; o ESP32 baixa de novo quando muda


class DeviceAlert(BaseModel):
    """O que o ESP32 manda quando uma leitura sai dos limites."""

    # bpm, °C, movimento (g), C(erca): distância do centro (m) e o raio
    kind: Literal['H', 'T', 'A', 'C']
    value: float
    limit: float
    vet: Optional[EmailStr] = None  # vet_email do config.txt do cartão


# --- Autenticação (resposta do login, não é tabela) ------------------------
class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'

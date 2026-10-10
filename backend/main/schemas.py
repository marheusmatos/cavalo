from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class HorseSchema(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    breed: Optional[str] = Field(default=None, max_length=100)
    weight_kg: Optional[float] = Field(default=None, gt=0, le=2000)
    tag_id: Optional[str] = Field(default=None, max_length=200)
    fence_lat: Optional[float] = Field(default=None, ge=-90, le=90)
    fence_lon: Optional[float] = Field(default=None, ge=-180, le=180)
    fence_radius_m: Optional[float] = Field(default=None, gt=0)


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


# --- Autenticação (resposta do login, não é tabela) ------------------------
class Token(BaseModel):
    access_token: str
    token_type: str = 'bearer'

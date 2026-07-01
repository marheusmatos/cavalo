from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Raiz do backend (pasta que contém main/, .env, cars.db).
BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Caminho absoluto para o .env f
        env_file=str(BACKEND_DIR / '.env'),
        env_file_encoding='utf-8',
        extra='ignore',
    )

    DATABASE_URL: str = 'sqlite:///cars.db'

    # Diretório do frontend
    # No Docker é montado via env; localmente aponta para ../frontend.
    FRONTEND_DIR: str = str(BACKEND_DIR.parent / 'frontend')

    @field_validator('DATABASE_URL')
    @classmethod
    def _resolve_sqlite_path(cls, value: str) -> str:
        # SQLite com caminho relativo depende do diretório de trabalho.
        # Ancoramos em backend/ para o mesmo banco ser usado de qualquer lugar.
        prefix = 'sqlite:///'
        if value.startswith(prefix):
            db_path = value[len(prefix):]
            # Ignora caminhos absolutos (ex.: sqlite:////app/data/cars.db).
            if db_path and not Path(db_path).is_absolute():
                abs_path = (BACKEND_DIR / db_path).resolve()
                return f'{prefix}{abs_path.as_posix()}'
        return value


settings = Settings()

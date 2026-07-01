from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        extra='ignore',
    )

    DATABASE_URL: str = 'sqlite:///cars.db'

    # Diretório do frontend (contém index.html e a pasta static/).
    # No Docker é montado via env; localmente aponta para ../frontend.
    FRONTEND_DIR: str = str(
        (Path(__file__).resolve().parent.parent.parent / 'frontend')
    )


settings = Settings()

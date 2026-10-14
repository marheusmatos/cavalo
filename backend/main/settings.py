from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Raiz do backend (pasta que contém main/, .env, horse.db).
BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Caminho absoluto para o .env f
        env_file=str(BACKEND_DIR / '.env'),
        env_file_encoding='utf-8',
        extra='ignore',
    )

    DATABASE_URL: str = 'sqlite:///horse.db'

    # Diretório do frontend
    # No Docker é montado via env; localmente aponta para ../frontend.
    FRONTEND_DIR: str = str(BACKEND_DIR.parent / 'frontend')

    # --- Autenticação usuário/senha (login JWT em /auth/token) -------------
    AUTH_USERNAME: str = 'admin'
    AUTH_PASSWORD: str = 'admin'
    # Segredo para assinar/verificar o JWT. TROQUE em produção (>= 32 bytes).
    JWT_SECRET_KEY: str = 'change-me-in-production-please-32b!'
    JWT_ALGORITHM: str = 'HS256'
    JWT_EXPIRE_MINUTES: int = 60

    # --- Login com Google (OAuth2, fluxo pelo backend) --------------------
    GOOGLE_CLIENT_ID: str = ''
    GOOGLE_CLIENT_SECRET: str = ''
    # Só e-mails deste domínio podem entrar via Google (senão 403).
    ALLOWED_EMAIL_DOMAIN: str = 'shopee.com'
    # Segredo da sessão (usada pelo Authlib p/ o state anti-CSRF do OAuth).
    SESSION_SECRET_KEY: str = 'change-me-session-secret-32-bytes!'
    # Para onde o callback redireciona após emitir o JWT.
    FRONTEND_URL: str = 'http://localhost:8000/'

    # --- Rate limit (fastapi-guard, sem Redis) ----------------------------
    # O front é SPA: cada tela faz ~6 requisições (fragmento + API).
    RATE_LIMIT_REQUESTS: int = 300
    RATE_LIMIT_WINDOW: int = 60

    # --- Rastreamento (tag BLE na rede Google Find Hub) --------------------
    # GoogleFindMyTools (não oficial): baixado do GitHub neste commit fixo
    # para uma mudança upstream não quebrar o app sem aviso.
    GFMT_COMMIT: str = 'd46e9528578015b51d3b84dd91bf8f16e9ab850f'
    # Pasta do clone; o login grava Auth/secrets.json dentro dela.
    GFMT_DIR: str = str(BACKEND_DIR / 'vendor' / 'GoogleFindMyTools')
    # 5–15 min: consultar mais que isso arrisca bloqueio da conta.
    POLL_INTERVAL_SECONDS: int = 600
    # Filtros de ingestão: report com erro maior ou que implica velocidade
    # impossível para um cavalo é descartado.
    MAX_ACCURACY_M: float = 100
    MAX_SPEED_KMH: float = 60
    # true: banco vazio ganha o "Cavalo Teste" com tag simulada (testar sem
    # tag real). Desligado: o app começa pelo login no Google.
    DEMO_SEED: bool = False

    # --- Sensor no cavalo (ESP32) ------------------------------------------
    # Chave que o ESP32 manda em X-Sensor-Key (a mesma do config.txt no
    # cartão SD). TROQUE em produção.
    SENSOR_KEY: str = 'change-me-sensor-key'
    # Um contato normal (10 min de acelerômetro a 50 Hz) tem ~180 kB.
    SENSOR_MAX_UPLOAD_BYTES: int = 512_000

    # --- E-mail de alerta ao veterinário (SMTP) ----------------------------
    # Gmail: smtp.gmail.com, 587, a conta e uma "senha de app" (não a senha
    # normal). Sem SMTP_HOST o alerta fica só no portal.
    SMTP_HOST: str = ''
    SMTP_PORT: int = 587
    SMTP_USER: str = ''
    SMTP_PASSWORD: str = ''
    SMTP_FROM: str = ''  # vazio = SMTP_USER
    # Mesmo cavalo e mesmo sinal: no máximo um e-mail neste intervalo.
    ALERT_EMAIL_INTERVAL_S: int = 1800

    @field_validator('DATABASE_URL')
    @classmethod
    def _resolve_sqlite_path(cls, value: str) -> str:
        # SQLite com caminho relativo depende do diretório de trabalho.
        # Ancoramos em backend/ para o mesmo banco ser usado de qualquer lugar.
        prefix = 'sqlite:///'
        if value.startswith(prefix):
            db_path = value[len(prefix) :]
            # Ignora caminhos absolutos (ex.: sqlite:////app/data/horse.db).
            if db_path and not Path(db_path).is_absolute():
                abs_path = (BACKEND_DIR / db_path).resolve()
                return f'{prefix}{abs_path.as_posix()}'
        return value


settings = Settings()

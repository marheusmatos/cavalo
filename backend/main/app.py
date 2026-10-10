import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from guard import SecurityMiddleware
from starlette.middleware.sessions import SessionMiddleware

from config import guard, security_config
from main import tracking
from main.routes.auth import auth_router
from main.routes.findhub import findhub_router
from main.routes.routers import alerts_router, horse_router
from main.routes.sensor import (
    device_router,
    readings_router,
    sensors_router,
)
from main.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.DEMO_SEED:
        tracking.seed_demo()
    poller = asyncio.create_task(tracking.poll_forever())
    yield
    poller.cancel()


app = FastAPI(
    title='Cavalo',
    description='Localização de cavalos via tag BLE na rede Google Find Hub',
    version='0.1.0',
    lifespan=lifespan,
)

# --- Middleware de segurança (fastapi-guard) -------------------------------
# Rate limit global + suporte aos decorators por rota. Sem Redis.
app.add_middleware(SecurityMiddleware, config=security_config)
# Sessão usada pelo Authlib para guardar o state anti-CSRF do OAuth Google.
app.add_middleware(SessionMiddleware, secret_key=settings.SESSION_SECRET_KEY)
# Liga o SecurityDecorator ao app para o middleware resolver a config por rota
# (require_auth / rate_limit definidos nos routers). Sem isto os decorators
# não são aplicados.
app.state.guard_decorator = guard

app.include_router(auth_router)
app.include_router(horse_router)
app.include_router(findhub_router)
app.include_router(alerts_router)
app.include_router(device_router)
app.include_router(sensors_router)
app.include_router(readings_router)

FRONTEND_DIR = Path(settings.FRONTEND_DIR)


@app.get('/health')
def health():
    return {'status': 'ok'}


# Serve o frontend (index.html + arquivos estáticos) se o diretório existir.
if FRONTEND_DIR.is_dir():
    static_dir = FRONTEND_DIR / 'static'
    if static_dir.is_dir():
        app.mount('/static', StaticFiles(directory=static_dir), name='static')

    @app.get('/')
    def read_root():
        return FileResponse(FRONTEND_DIR / 'index.html')

else:

    @app.get('/')
    def read_root():
        return {'status': 'ok'}

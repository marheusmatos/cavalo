from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from guard import SecurityMiddleware
from starlette.middleware.sessions import SessionMiddleware

from config import guard, security_config
from main.routes.auth import auth_router
from main.routes.routers import car_router
from main.settings import settings

app = FastAPI(title='Fast API Template', description='Template', version='0.1.0')

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
app.include_router(car_router)

FRONTEND_DIR = Path(settings.FRONTEND_DIR)


@app.get('/health')
def health():
    return {'status': 'ok'}


# Serve o frontend (index.html + arquivos estáticos) se o diretório existir.
if FRONTEND_DIR.is_dir():
    static_dir = FRONTEND_DIR / 'static'
    if static_dir.is_dir():
        app.mount(
            '/static', StaticFiles(directory=static_dir), name='static'
        )

    @app.get('/')
    def read_root():
        return FileResponse(FRONTEND_DIR / 'index.html')
else:

    @app.get('/')
    def read_root():
        return {'status': 'ok'}

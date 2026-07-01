from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from main.routers import router as car_router
from main.settings import settings

app = FastAPI(title='Fast API Template', description='Template', version='0.1.0')

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

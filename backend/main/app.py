from fastapi import FastAPI

from main.routers import router as car_router

app = FastAPI(title='Fast API Template', description='Template', version='0.1.0')

app.include_router(car_router)


@app.get('/')
def read_root():
    return {'status': 'ok'}

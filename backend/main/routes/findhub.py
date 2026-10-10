from fastapi import APIRouter, Depends, HTTPException, UploadFile, status

from main import findhub, tracking
from main.security import get_current_user

findhub_router = APIRouter(
    prefix='/api/v1/findhub',
    tags=['findhub'],
    dependencies=[Depends(get_current_user)],
)


@findhub_router.get('/status')
def get_status():
    return {**findhub.status(), 'poll': tracking.last_poll}


@findhub_router.post('/login', status_code=status.HTTP_202_ACCEPTED)
def login():
    """Abre o Chrome na máquina do servidor; acompanhe por /status."""
    if not findhub.start_login():
        raise HTTPException(status.HTTP_409_CONFLICT, 'Login já em andamento.')
    return findhub.status()


@findhub_router.post('/secrets')
def upload_secrets(file: UploadFile):
    """Alternativa ao login para servidor sem tela."""
    try:
        findhub.save_secrets(file.file.read(1_000_000))
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return findhub.status()


@findhub_router.get('/trackers')
def list_trackers():
    if not findhub.ready():
        raise HTTPException(
            status.HTTP_409_CONFLICT, 'Conecte a conta Google primeiro.'
        )
    try:
        return {'trackers': findhub.trackers()}
    except (Exception, SystemExit) as e:  # a lib chama exit() em alguns erros
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, findhub.describe(e))

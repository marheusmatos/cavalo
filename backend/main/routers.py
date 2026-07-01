from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import guard
from main.database import get_session
from main.models import Car
from main.oauth import google_enabled, oauth
from main.schemas import *
from main.security import (
    create_access_token,
    get_current_user,
    verify_credentials,
)
from main.settings import settings

router = APIRouter(prefix='/api/v1/cars', tags=['cars'])
auth_router = APIRouter(prefix='/auth', tags=['auth'])


@auth_router.post('/token', response_model=Token)
@guard.rate_limit(
    requests=settings.RATE_LIMIT_REQUESTS, window=settings.RATE_LIMIT_WINDOW
)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
):
    """Login OAuth2: valida usuário/senha e devolve um JWT assinado.

    Recebe form (username/password), formato usado pelo botão "Authorize" do
    Swagger. Rate limit aplicado pelo fastapi-guard.
    """
    if not verify_credentials(form_data.username, form_data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Usuário ou senha inválidos',
        )
    token = create_access_token(form_data.username)
    return {'access_token': token, 'token_type': 'bearer'}


@auth_router.get('/google/login')
async def google_login(request: Request):
    """Inicia o login com Google (redireciona para a tela de consentimento)."""
    if not google_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Login com Google não configurado (defina GOOGLE_CLIENT_ID).',
        )
    redirect_uri = request.url_for('google_callback')
    return await oauth.google.authorize_redirect(request, redirect_uri)


@auth_router.get('/google/callback', name='google_callback')
async def google_callback(request: Request):
    """Callback do Google: valida o domínio do e-mail e emite o JWT.

    Em caso de sucesso, redireciona para o frontend com o token no fragmento
    da URL (#token=...), que o JS lê e guarda na sessão.
    """
    if not google_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Login com Google não configurado.',
        )
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='Falha na autenticação com o Google.',
        )

    userinfo = token.get('userinfo') or {}
    email = userinfo.get('email', '')
    email_verified = userinfo.get('email_verified', False)

    domain = settings.ALLOWED_EMAIL_DOMAIN.lower()
    if (
        not email
        or not email_verified
        or not email.lower().endswith('@' + domain)
    ):
        # Redireciona ao front sinalizando acesso negado (403 lógico).
        params = urlencode({'error': f'Apenas contas @{domain} são permitidas.'})
        return RedirectResponse(url=f'{settings.FRONTEND_URL}#{params}')

    jwt_token = create_access_token(email)
    params = urlencode({'token': jwt_token})
    return RedirectResponse(url=f'{settings.FRONTEND_URL}#{params}')


@router.post(
    '/', response_model=CarPublic, status_code=status.HTTP_201_CREATED
)
@guard.rate_limit(
    requests=settings.RATE_LIMIT_REQUESTS, window=settings.RATE_LIMIT_WINDOW
)
async def create_car(
    request: Request,
    car: CarSchema,
    session: Session = Depends(get_session),
    current_user: str = Depends(get_current_user),
):
    car = Car(**car.model_dump())
    session.add(car)
    session.commit()
    session.refresh(car)
    return car


@router.get('/', response_model=CarList)
@guard.rate_limit(
    requests=settings.RATE_LIMIT_REQUESTS, window=settings.RATE_LIMIT_WINDOW
)
async def list_cars(
    request: Request,
    session: Session = Depends(get_session),
    current_user: str = Depends(get_current_user),
    offset: int = 0,
    limit: int = 100,
):
    query = session.scalars(select(Car).offset(offset).limit(limit))
    cars = query.all()
    return {'cars': cars}

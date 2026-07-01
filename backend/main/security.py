"""Validação real de autenticação por JWT.

O fastapi-guard só garante que o header Authorization existe e tem o formato
certo (começa com "Bearer "). A verificação de verdade — assinatura e
expiração do JWT — é feita aqui.

Usamos OAuth2PasswordBearer para que o Swagger (/docs) exiba o botão
"Authorize" no canto superior direito, permitindo autenticar e testar as
rotas protegidas direto na documentação.
"""

import hmac
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from main.settings import settings

# tokenUrl = rota de login; é o que o botão "Authorize" do Swagger usa.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl='auth/token')

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail='Not authenticated',
    headers={'WWW-Authenticate': 'Bearer'},
)


def create_access_token(username: str) -> str:
    """Gera um JWT assinado para o usuário autenticado no login."""
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_EXPIRE_MINUTES
    )
    payload = {'sub': username, 'exp': expire}
    return jwt.encode(
        payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )


def verify_credentials(username: str, password: str) -> bool:
    """Confere usuário/senha contra os valores fixos (comparação constante)."""
    user_ok = hmac.compare_digest(username, settings.AUTH_USERNAME)
    pass_ok = hmac.compare_digest(password, settings.AUTH_PASSWORD)
    return user_ok and pass_ok


def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    """Dependência: valida o Bearer JWT e retorna o usuário.

    Levanta 401 se o token estiver ausente, inválido ou expirado.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.PyJWTError:
        raise _UNAUTHORIZED
    username = payload.get('sub')
    if not username:
        raise _UNAUTHORIZED
    return username

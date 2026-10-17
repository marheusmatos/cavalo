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
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer

from main.settings import settings

# tokenUrl = rota de login; é o que o botão "Authorize" do Swagger usa.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl='auth/token')

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail='Not authenticated',
    headers={'WWW-Authenticate': 'Bearer'},
)


# Papéis: o admin (dono do haras) muda tudo; os outros veem tudo e só mudam
# o que está em WRITES (método, rota). Os campos do cavalo que cada um pode
# mudar ficam em HORSE_FIELDS (conferidos no PATCH do cavalo).
WRITES = {
    'veterinario': {
        ('PATCH', '/api/v1/horses/{horse_id}'),
        ('PUT', '/api/v1/horses/{horse_id}/meals'),
        ('DELETE', '/api/v1/horses/{horse_id}/meals/{weekday}/{shift}'),
        ('POST', '/api/v1/horses/{horse_id}/poll'),
    },
    'dono': {
        ('PATCH', '/api/v1/horses/{horse_id}'),
        ('POST', '/api/v1/horses/{horse_id}/poll'),
    },
}
HORSE_FIELDS = {
    'veterinario': {
        'name', 'breed', 'weight_kg', 'sex', 'birth_date', 'coat', 'notes',
        'height_cm', 'girth_cm', 'length_cm', 'cannon_cm',
    },
    'dono': {'training_level'},
}


def _users() -> dict:
    """usuário -> (senha, papel)."""
    return {
        'veterinario': (settings.VET_PASSWORD, 'veterinario'),
        'dono': (settings.DONO_PASSWORD, 'dono'),
        settings.AUTH_USERNAME: (settings.AUTH_PASSWORD, 'admin'),
    }


def create_access_token(username: str, role: str = 'admin') -> str:
    """Gera um JWT assinado para o usuário autenticado no login."""
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_EXPIRE_MINUTES
    )
    payload = {'sub': username, 'role': role, 'exp': expire}
    return jwt.encode(
        payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )


def verify_credentials(username: str, password: str) -> str | None:
    """Papel do usuário se a senha confere (comparação constante), senão None."""
    found = None
    for user, (pwd, role) in _users().items():
        user_ok = hmac.compare_digest(username, user)
        pass_ok = hmac.compare_digest(password, pwd)
        if user_ok and pass_ok:
            found = role
    return found


def get_role(token: str = Depends(oauth2_scheme)) -> str:
    """Papel do usuário do Bearer JWT (401 se ausente, inválido ou expirado)."""
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.PyJWTError:
        raise _UNAUTHORIZED
    if not payload.get('sub'):
        raise _UNAUTHORIZED
    return payload.get('role', 'admin')  # login com Google: admin


def get_current_user(request: Request, role: str = Depends(get_role)) -> str:
    """Dependência das rotas do portal: confere o login e se o papel pode
    mudar esta rota (403 senão). Ler vale para todos. Devolve o papel."""
    path = getattr(request.scope.get('route'), 'path', '')
    method = request.method
    if (
        method not in ('GET', 'HEAD', 'OPTIONS')
        and role != 'admin'
        and (method, path) not in WRITES.get(role, ())
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, 'Seu acesso não permite esta alteração'
        )
    return role

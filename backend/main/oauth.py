"""Cliente OAuth2 do Google (login pelo backend, via Authlib).

O registro usa o documento de descoberta OpenID Connect do Google, que já
traz os endpoints de autorização/token e as chaves para validar o id_token.
"""

from authlib.integrations.starlette_client import OAuth

from main.settings import settings

GOOGLE_CONF_URL = 'https://accounts.google.com/.well-known/openid-configuration'

oauth = OAuth()

# Só registra o provider se as credenciais existirem, para o app subir mesmo
# sem Google configurado (o login usuário/senha continua funcionando).
if settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
    oauth.register(
        name='google',
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        server_metadata_url=GOOGLE_CONF_URL,
        client_kwargs={'scope': 'openid email profile'},
    )


def google_enabled() -> bool:
    return 'google' in oauth._clients

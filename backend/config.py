"""Configuração do middleware de segurança fastapi-guard.

Referências:
  - https://rennf93.github.io/fastapi-guard
  - .../tutorial/decorators/authentication/
  - .../tutorial/decorators/rate-limiting/

O rate limit roda em memória (sem Redis, enable_redis=False). Os valores
de limite e janela vêm do .env via main.settings.
"""

from guard import SecurityConfig, SecurityDecorator

from main.settings import settings

# SecurityConfig — configuração global do middleware.
security_config = SecurityConfig(
    # Rate limiting global (aplicado a todas as rotas pelo middleware) e
    # também base para os decorators @guard.rate_limit por rota.
    enable_rate_limiting=True,
    rate_limit=settings.RATE_LIMIT_REQUESTS,
    rate_limit_window=settings.RATE_LIMIT_WINDOW,
    # Sem Redis: usa contagem em memória no próprio processo.
    enable_redis=False,
    # Sem banimento automático de IP nem detecção de penetração, para não
    # bloquear tráfego local/legítimo em desenvolvimento.
    enable_ip_banning=False,
    enable_penetration_detection=False,
    # Não forçamos HTTPS aqui (dev roda em http). Ative em produção.
    enforce_https=False,
    custom_error_responses={
        401: 'Authentication required',
        429: 'Rate limit exceeded. Please try again later.',
    },
)

# Decorator usado nas rotas (@guard.require_auth, @guard.rate_limit, ...).
guard = SecurityDecorator(security_config)

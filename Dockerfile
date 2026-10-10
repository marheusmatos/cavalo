# Cavalo — imagem do backend FastAPI.
# Build context = RAIZ do repo: a imagem inclui backend/ (código) e frontend/
# (index.html + estáticos), porque o backend serve o frontend.
#   docker build -t cavalo .
# Sem Chrome na imagem: conecte a conta Google enviando pelo front o
# secrets.json gerado num login feito em máquina com Chrome.
FROM python:3.12-slim

WORKDIR /app

# 1) Dependências primeiro (camada cacheável)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 2) Código do backend (vira /app/main) e o frontend. O .dockerignore deixa
#    de fora backend/vendor (secrets.json!) e os .db locais.
COPY backend/ /app/
COPY frontend/ /app/frontend/

# Configuração via ambiente (ver main/settings.py). GFMT_DIR no volume: a lib
# baixada e o secrets.json sobrevivem ao redeploy.
ENV DATABASE_URL=sqlite:////app/data/horse.db \
    GFMT_DIR=/app/data/GoogleFindMyTools \
    FRONTEND_DIR=/app/frontend

# Usuário não-root (segurança) + diretório de dados gravável
RUN useradd -m appuser \
    && mkdir -p /app/data \
    && chown -R appuser /app/data
USER appuser

EXPOSE 8000

# 1 worker: o poller roda dentro do processo (2 workers = 2 pollers).
CMD ["sh", "-c", "alembic upgrade head && uvicorn main.app:app --host 0.0.0.0 --port 8000 --workers 1"]

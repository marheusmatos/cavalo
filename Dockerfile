# Portal PMO Prefat — imagem do backend FastAPI (server-rendered Jinja).
# Build context = RAIZ do repo: a imagem inclui backend/ (código) e frontend/
# (templates + estáticos), porque o backend renderiza o frontend.
#   docker build -t pmoserver .
FROM python:3.12-slim

WORKDIR /app

# 1) Dependências primeiro (camada cacheável)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 2) Código do backend (vira /app/main, /app/run.py) e o frontend
COPY backend/ /app/
COPY frontend/ /app/frontend/

# Onde o app acha templates/estáticos e dados/segredos (montar volume em /app/data).
ENV PMO_FRONTEND_DIR=/app/frontend \
    PMO_BASE_DIR=/app/data

# Usuário não-root (segurança) + diretório de dados gravável
RUN useradd -m appuser \
    && mkdir -p /app/data \
    && chown -R appuser /app/data
USER appuser

EXPOSE 8000

# 1 worker de propósito: estado em memória (jobs/semáforos/pool SMTP) é
# compartilhado no processo; handlers síncronos rodam no threadpool do Starlette.
CMD ["uvicorn", "main.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

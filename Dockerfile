# Cars API — imagem do backend FastAPI.
# Build context = RAIZ do repo: a imagem inclui backend/ (código) e frontend/
# (index.html + estáticos), porque o backend serve o frontend.
#   docker build -t cars-api .
FROM python:3.12-slim

WORKDIR /app

# 1) Dependências primeiro (camada cacheável)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 2) Código do backend (vira /app/main) e o frontend
COPY backend/ /app/
COPY frontend/ /app/frontend/

# Configuração via ambiente (ver backend/.env.example).
ENV DATABASE_URL=sqlite:////app/data/cars.db \
    FRONTEND_DIR=/app/frontend

# Usuário não-root (segurança) + diretório de dados gravável
RUN useradd -m appuser \
    && mkdir -p /app/data \
    && chown -R appuser /app/data
USER appuser

EXPOSE 8000

CMD ["uvicorn", "main.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

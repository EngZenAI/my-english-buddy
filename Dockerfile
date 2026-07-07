# syntax=docker/dockerfile:1

# ── 1단계: 프론트엔드(React/Vite) 빌드 ─────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # → /app/frontend/dist 생성

# ── 2단계: 백엔드(FastAPI) 이미지 ─────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# 파이썬 의존성 먼저 설치 (레이어 캐시 활용)
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# 백엔드 소스 + alembic 설정
COPY backend/ backend/
COPY alembic.ini alembic.ini

# 1단계에서 빌드된 프론트 결과물을 backend가 서빙하는 경로로 복사
COPY --from=frontend /app/frontend/dist frontend/dist

ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# 시작 시 DB 마이그레이션 적용 후 서버 기동.
# --proxy-headers: Railway HTTPS 프록시 뒤에서 https/도메인을 올바로 인식(OAuth 콜백에 필수)
CMD alembic upgrade head && \
    uvicorn backend.main:app \
        --host 0.0.0.0 --port $PORT \
        --proxy-headers --forwarded-allow-ips="*"

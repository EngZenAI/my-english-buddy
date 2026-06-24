from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.database import create_db_schema, init_db
from backend.routers.api import router as api_router
from backend.routers.auth import router as auth_router

# 빌드된 React 정적 파일 경로 (frontend/dist)
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await create_db_schema()
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

# ── CORS (개발 중 Vite dev 서버: localhost:5173) ───────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 라우터 ─────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(api_router)


# ── React 정적 서빙 ────────────────────────────────────────
if FRONTEND_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="assets",
    )

    @app.get("/")
    async def index():
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

else:

    @app.get("/")
    async def root():
        # frontend/dist 가 없음 → 빌드 안내
        return JSONResponse(
            status_code=503,
            content={
                "message": "프론트엔드가 아직 빌드되지 않았습니다. frontend 폴더에서 `npm run build` 를 실행하세요.",
            },
        )

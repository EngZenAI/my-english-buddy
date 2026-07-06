from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.db.logging import enable_sql_logging
from backend.routers.api import router as api_router
from backend.routers.auth import router as auth_router

enable_sql_logging()

# 빌드된 React 정적 파일 경로 (frontend/dist)
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


OPENAPI_TAGS = [
    {"name": "auth", "description": "회원가입, 로그인, OAuth, 비밀번호 재설정 API입니다."},
    {"name": "users", "description": "사용자 기본 관리 API입니다."},
    {"name": "search", "description": "비회원도 사용할 수 있는 단어 검색, 번역, 발음 API입니다."},
    {"name": "labels", "description": "단어장 태그 생성, 이름 변경, 삭제, 단어 수 조회 API입니다."},
    {"name": "wordbook", "description": "저장 단어 조회, 저장, 편집, 삭제, 정렬, 파일 가져오기 API입니다."},
    {"name": "quiz", "description": "단어장 기반 퀴즈 생성, 채점, 통계 API입니다."},
    {"name": "roleplay", "description": "AI 롤플레잉 대화 API입니다."},
    {"name": "slang", "description": "AI가 단어의 뉘앙스와 슬랭 용법을 설명하는 API입니다."},
    {"name": "articles", "description": "뉴스 리딩 학습과 기사 세션 관리 API입니다."},
    {"name": "agent", "description": "AI 학습 에이전트 API입니다."},
    {"name": "account", "description": "마이페이지, 계정 상태, 비밀번호, OAuth 연결 관리 API입니다."},
    {"name": "admin", "description": "운영자 전용 학습자, 사용량, 뉴스 콘텐츠 관리 API입니다."},
]

app = FastAPI(
    title="English Buddy API",
    description="English Buddy FastAPI REST API",
    openapi_tags=OPENAPI_TAGS,
)

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

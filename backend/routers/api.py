"""Aggregate REST API router for the React frontend."""

from fastapi import APIRouter

from backend.routers.account import router as account_router
from backend.routers.agent import router as agent_router
from backend.routers.admin import router as admin_router
from backend.routers.articles import router as articles_router
from backend.routers.quiz import router as quiz_router
from backend.routers.roleplay import router as roleplay_router
from backend.routers.search import router as search_router
from backend.routers.slang import router as slang_router
from backend.routers.wordbook import router as wordbook_router

router = APIRouter(prefix="/api", tags=["api"])
router.include_router(account_router)
router.include_router(agent_router)
router.include_router(admin_router)
router.include_router(articles_router)
router.include_router(quiz_router)
router.include_router(roleplay_router)
router.include_router(search_router)
router.include_router(slang_router)
router.include_router(wordbook_router)

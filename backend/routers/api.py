"""React 프론트엔드가 사용하는 REST API 라우터를 한 곳에서 조립한다.

각 기능 도메인은 개별 router 파일로 분리하고, 여기서는 공통 prefix(`/api`)만 부여한다.
새 기능을 추가할 때는 이 파일에 엔드포인트를 직접 만들지 말고 도메인별 router를 include한다.
"""

from fastapi import APIRouter

from backend.routers.account import router as account_router
from backend.routers.admin import router as admin_router
from backend.routers.agent import router as agent_router
from backend.routers.articles import router as articles_router
from backend.routers.labels import router as labels_router
from backend.routers.media import router as media_router
from backend.routers.quiz import router as quiz_router
from backend.routers.roleplay import router as roleplay_router
from backend.routers.search import router as search_router
from backend.routers.slang import router as slang_router
from backend.routers.wordbook import router as wordbook_router

router = APIRouter(prefix="/api")
router.include_router(account_router)
router.include_router(agent_router)
router.include_router(admin_router)
router.include_router(articles_router)
router.include_router(labels_router)
router.include_router(quiz_router)
router.include_router(roleplay_router)
router.include_router(search_router)
router.include_router(slang_router)
router.include_router(wordbook_router)
router.include_router(media_router)

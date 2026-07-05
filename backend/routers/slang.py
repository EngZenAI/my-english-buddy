from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from backend.api_usage import start_usage_capture
from backend.db.dependencies import SessionDep
from backend.llm import explain_slang
from backend.routers.common import CurrentUserDep, safe_persist_usage_capture
from backend.schemas.slang import SlangIn

router = APIRouter(tags=["slang"])


@router.post(
    "/slang",
    summary="AI 슬랭 설명",
    description=(
        "검색한 단어의 뉘앙스, 실제 회화에서의 쓰임, 슬랭 가능성을 AI가 한국어로 설명합니다. "
        "회원 전용 API입니다."
    ),
)
async def slang(payload: SlangIn, session: SessionDep, _user: CurrentUserDep):
    word = payload.word.strip()
    if not word:
        return {"explanation": "단어를 먼저 검색해주세요."}
    usage_token = start_usage_capture()
    try:
        return {
            "explanation": await run_in_threadpool(
                explain_slang,
                word,
                payload.korean.strip(),
            )
        }
    finally:
        await safe_persist_usage_capture(usage_token, _user)

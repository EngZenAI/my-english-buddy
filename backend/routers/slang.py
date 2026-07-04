from fastapi import APIRouter
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from backend.api_usage import start_usage_capture
from backend.db.dependencies import SessionDep
from backend.llm import explain_slang
from backend.routers.common import CurrentUserDep, safe_persist_usage_capture

router = APIRouter(tags=["slang"])


class SlangIn(BaseModel):
    word: str
    korean: str = ""


@router.post("/slang")
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

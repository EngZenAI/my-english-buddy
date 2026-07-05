from fastapi import APIRouter, BackgroundTasks, Request
from starlette.concurrency import run_in_threadpool

from backend.api_usage import start_usage_capture
from backend.auth.users import get_current_user_from_cookie
from backend.db.dependencies import SessionDep
from backend.routers.common import defer_usage_capture
from backend.services import search_from_english, search_from_korean, synthesize_tts

router = APIRouter(tags=["search"])


@router.get(
    "/me",
    summary="현재 로그인 사용자 확인",
    description="쿠키 인증 상태를 확인해서 로그인한 사용자 정보를 반환합니다. 비회원이면 user가 비어 있습니다.",
)
async def me(request: Request, session: SessionDep):
    user = await get_current_user_from_cookie(request, session)
    return {"user": user}


@router.get(
    "/search/english",
    summary="영어 단어 검색",
    description=(
        "영어 단어를 입력받아 사전 뜻, 한국어 번역, 예문, 발음 정보를 조합해 반환합니다. "
        "비회원도 사용할 수 있습니다."
    ),
)
async def search_english(
    word: str = "",
    *,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDep,
):
    user = await get_current_user_from_cookie(request, session)
    usage_token = start_usage_capture()
    try:
        return await run_in_threadpool(search_from_english, word)
    finally:
        defer_usage_capture(background_tasks, usage_token, user)


@router.get(
    "/search/korean",
    summary="한국어 표현 검색",
    description=(
        "한국어 표현을 영어로 번역하고, 학습용 단어 검색 결과 형태로 반환합니다. "
        "비회원도 사용할 수 있습니다."
    ),
)
async def search_korean(
    word: str = "",
    *,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDep,
):
    user = await get_current_user_from_cookie(request, session)
    usage_token = start_usage_capture()
    try:
        return await run_in_threadpool(search_from_korean, word)
    finally:
        defer_usage_capture(background_tasks, usage_token, user)


@router.get(
    "/tts",
    summary="발음 오디오 생성",
    description="입력한 단어나 문장을 TTS로 읽은 뒤 base64 오디오 문자열로 반환합니다.",
)
async def tts(
    word: str = "",
    lang: str = "en",
    *,
    request: Request,
    background_tasks: BackgroundTasks,
    session: SessionDep,
):
    user = await get_current_user_from_cookie(request, session)
    usage_token = start_usage_capture()
    try:
        audio_b64 = await run_in_threadpool(synthesize_tts, word, lang)
        return {"audio": audio_b64}
    finally:
        defer_usage_capture(background_tasks, usage_token, user)

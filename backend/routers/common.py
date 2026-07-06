import logging
from typing import Annotated

from fastapi import BackgroundTasks, Depends, HTTPException, Request

from backend.auth.users import get_current_user_from_cookie
from backend.db.dependencies import SessionDep
from backend.db.repositories import record_api_usage_events
from backend.exceptions import SQLALCHEMY_ERRORS, log_exception
from backend.usage.tracking import stop_usage_capture

logger = logging.getLogger(__name__)


async def require_user(request: Request, session: SessionDep) -> dict:
    """로그인(쿠키) 안 돼 있으면 401. 회원 전용 엔드포인트 보호용."""
    user = await get_current_user_from_cookie(request, session)
    if not user:
        raise HTTPException(status_code=401, detail="회원 전용 기능입니다.")
    return user


CurrentUserDep = Annotated[dict, Depends(require_user)]


def require_admin_user(user: dict) -> None:
    if user.get("is_superuser"):
        return
    raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다.")


async def persist_usage_capture(token, user: dict | None) -> None:
    events = stop_usage_capture(token)
    await record_api_usage_events(user.get("id") if user else None, events)


async def safe_persist_usage_capture(token, user: dict | None) -> None:
    try:
        await persist_usage_capture(token, user)
    except SQLALCHEMY_ERRORS:
        log_exception(logger, "Failed to persist API usage events")


def defer_usage_capture(
    background_tasks: BackgroundTasks,
    token,
    user: dict | None,
) -> None:
    events = stop_usage_capture(token)
    user_id = user.get("id") if user else None
    if user_id and events:
        background_tasks.add_task(record_api_usage_events, user_id, events)


def needs_translation(value: str) -> bool:
    """LLM/외부 API 결과가 비어 있거나 실패값이면 번역 보강 대상으로 본다."""
    text = (value or "").strip()
    return not text or text in {"번역 실패", "translation failed"}

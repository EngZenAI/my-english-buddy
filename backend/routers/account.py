from fastapi import APIRouter, HTTPException

from backend.auth.password_reset import PasswordResetError, validate_reset_password
from backend.auth.users import password_helper
from backend.db.dependencies import SessionDep
from backend.db.repositories import (
    disconnect_oauth_account,
    get_account_status,
    get_activity_summary,
    get_mypage_learning,
    get_mypage_overview,
    get_user_password_hash,
    update_user_password_hash,
)
from backend.routers.common import CurrentUserDep
from backend.schemas.account import AccountPasswordIn

router = APIRouter(tags=["account"])


@router.get("/mypage/overview")
async def mypage_overview(session: SessionDep, _user: CurrentUserDep):
    return await get_mypage_overview(session, _user["id"])


@router.get("/mypage/learning")
async def mypage_learning(session: SessionDep, _user: CurrentUserDep):
    return await get_mypage_learning(session, _user["id"])


@router.get("/mypage/activity")
async def mypage_activity(session: SessionDep, _user: CurrentUserDep):
    return await get_activity_summary(session, _user["id"])


@router.get("/account/status")
async def account_status(session: SessionDep, _user: CurrentUserDep):
    return await get_account_status(session, _user["id"])


@router.post("/account/password")
async def update_account_password(
    payload: AccountPasswordIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    try:
        new_password = validate_reset_password(payload.new_password)
    except PasswordResetError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    current_hash = await get_user_password_hash(session, _user["id"])
    if current_hash:
        if not payload.current_password:
            raise HTTPException(status_code=400, detail="현재 비밀번호를 입력해주세요.")
        verified, _updated_hash = password_helper.verify_and_update(
            payload.current_password,
            current_hash,
        )
        if not verified:
            raise HTTPException(status_code=400, detail="현재 비밀번호가 일치하지 않습니다.")

    await update_user_password_hash(
        session,
        _user["id"],
        password_helper.hash(new_password),
    )
    return {"ok": True, "has_password": True}


@router.delete("/account/oauth/{provider}")
async def disconnect_account_oauth(
    provider: str,
    session: SessionDep,
    _user: CurrentUserDep,
):
    provider = provider.strip().lower()
    if provider != "google":
        raise HTTPException(status_code=400, detail="지원하지 않는 연결입니다.")

    status = await get_account_status(session, _user["id"])
    if not status.get("google_connected"):
        return {"ok": True, "deleted": 0}
    if not status.get("has_password"):
        raise HTTPException(
            status_code=400,
            detail="비밀번호를 먼저 설정한 뒤 Google 연결을 해제할 수 있습니다.",
        )

    deleted = await disconnect_oauth_account(session, _user["id"], provider)
    return {"ok": True, "deleted": deleted}

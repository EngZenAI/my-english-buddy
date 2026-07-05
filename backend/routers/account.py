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


@router.get(
    "/mypage/overview",
    summary="마이페이지 요약 조회",
    description="현재 사용자의 학습 현황 요약과 계정 개요를 반환합니다.",
)
async def mypage_overview(session: SessionDep, _user: CurrentUserDep):
    return await get_mypage_overview(session, _user["id"])


@router.get(
    "/mypage/learning",
    summary="마이페이지 학습 정보 조회",
    description="현재 사용자의 단어장, 퀴즈, 롤플레잉 등 학습 관련 지표를 반환합니다.",
)
async def mypage_learning(session: SessionDep, _user: CurrentUserDep):
    return await get_mypage_learning(session, _user["id"])


@router.get(
    "/mypage/activity",
    summary="마이페이지 활동 요약 조회",
    description="현재 사용자의 최근 학습 활동과 사용 기록 요약을 반환합니다.",
)
async def mypage_activity(session: SessionDep, _user: CurrentUserDep):
    return await get_activity_summary(session, _user["id"])


@router.get(
    "/account/status",
    summary="계정 연결 상태 조회",
    description="비밀번호 설정 여부와 Google OAuth 연결 상태를 확인합니다.",
)
async def account_status(session: SessionDep, _user: CurrentUserDep):
    return await get_account_status(session, _user["id"])


@router.post(
    "/account/password",
    summary="계정 비밀번호 설정 또는 변경",
    description=(
        "이메일/비밀번호 로그인을 위해 비밀번호를 설정하거나 기존 비밀번호를 검증한 뒤 변경합니다."
    ),
)
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


@router.delete(
    "/account/oauth/{provider}",
    summary="OAuth 계정 연결 해제",
    description="현재는 Google 연결 해제만 지원하며, 비밀번호가 설정된 계정에서만 해제할 수 있습니다.",
)
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

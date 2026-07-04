from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi_users.router.oauth import (
    CSRF_TOKEN_COOKIE_NAME,
    CSRF_TOKEN_KEY,
    generate_csrf_token,
    generate_state_token,
)
from sqlalchemy import func, select

from backend.auth.cookies import clear_auth_cookie
from backend.auth.models import User
from backend.auth.password_reset import (
    PasswordResetError,
)
from backend.auth.password_reset import (
    confirm_password_reset as confirm_password_reset_service,
)
from backend.auth.password_reset import (
    request_password_reset as request_password_reset_service,
)
from backend.auth.password_reset import (
    verify_password_reset as verify_password_reset_service,
)
from backend.auth.users import (
    auth_backend,
    fastapi_users,
    google_oauth_client,
    oauth_auth_backend,
)
from backend.config import settings
from backend.db.dependencies import SessionDep
from backend.schemas.auth import (
    PasswordResetConfirm,
    PasswordResetRequest,
    PasswordResetVerify,
)
from backend.schemas.users import UserCreate, UserRead, UserUpdate

router = APIRouter()


def password_reset_http_exception(exc: PasswordResetError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/auth/google/login", include_in_schema=False)
async def google_oauth_login(request: Request):
    callback_route_name = (
        f"oauth:{google_oauth_client.name}.{oauth_auth_backend.name}.callback"
    )
    redirect_uri = str(request.url_for(callback_route_name))
    csrf_token = generate_csrf_token()
    state = generate_state_token({CSRF_TOKEN_KEY: csrf_token}, settings.auth_secret)
    authorization_url = await google_oauth_client.get_authorization_url(
        redirect_uri,
        state,
    )
    response = RedirectResponse(authorization_url)
    response.set_cookie(
        CSRF_TOKEN_COOKIE_NAME,
        csrf_token,
        max_age=3600,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/auth/logout", include_in_schema=False)
async def logout():
    response = RedirectResponse("/", status_code=303)
    return clear_auth_cookie(response)


@router.post("/auth/logout", include_in_schema=False)
async def logout_json():
    response = JSONResponse({"ok": True})
    return clear_auth_cookie(response)


@router.post("/auth/password-reset/request", include_in_schema=False)
async def request_password_reset(payload: PasswordResetRequest, session: SessionDep):
    try:
        delivery = await request_password_reset_service(session, payload.email)
    except PasswordResetError as exc:
        raise password_reset_http_exception(exc) from exc

    response = {"ok": True}
    if delivery:
        response["delivery"] = delivery
    return response


@router.post("/auth/password-reset/confirm", include_in_schema=False)
async def confirm_password_reset(payload: PasswordResetConfirm, session: SessionDep):
    try:
        await confirm_password_reset_service(
            session,
            payload.email,
            payload.code,
            payload.password,
        )
    except PasswordResetError as exc:
        raise password_reset_http_exception(exc) from exc

    return {"ok": True}


@router.post("/auth/password-reset/verify", include_in_schema=False)
async def verify_password_reset_code(payload: PasswordResetVerify, session: SessionDep):
    try:
        await verify_password_reset_service(session, payload.email, payload.code)
    except PasswordResetError as exc:
        raise password_reset_http_exception(exc) from exc

    return {"ok": True}


@router.get("/auth/email-exists", include_in_schema=False)
async def email_exists(session: SessionDep, email: str = ""):
    normalized = email.strip().lower()
    if not normalized:
        return {"exists": False}

    result = await session.execute(
        select(User.id)
        .where(func.lower(User.email) == normalized)
        .limit(1)
    )
    return {"exists": result.scalar_one_or_none() is not None}


router.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth/cookie",
    tags=["auth"],
)
router.include_router(
    fastapi_users.get_oauth_router(
        google_oauth_client,
        oauth_auth_backend,
        settings.auth_secret,
        associate_by_email=True,
        is_verified_by_default=True,
    ),
    prefix="/auth/google",
    tags=["auth"],
)
router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
)
router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)

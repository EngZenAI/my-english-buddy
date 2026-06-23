from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from fastapi_users.router.oauth import generate_state_token

from backend.auth.users import (
    auth_backend,
    fastapi_users,
    google_oauth_client,
    oauth_auth_backend,
)
from backend.config import settings
from backend.schemas.users import UserCreate, UserRead, UserUpdate

router = APIRouter()


@router.get("/auth/google/login", include_in_schema=False)
async def google_oauth_login(request: Request):
    callback_route_name = (
        f"oauth:{google_oauth_client.name}.{oauth_auth_backend.name}.callback"
    )
    redirect_uri = str(request.url_for(callback_route_name))
    state = generate_state_token({}, settings.auth_secret)
    authorization_url = await google_oauth_client.get_authorization_url(
        redirect_uri,
        state,
    )
    return RedirectResponse(authorization_url)


@router.get("/auth/logout", include_in_schema=False)
async def logout():
    response = RedirectResponse("/app", status_code=303)
    response.set_cookie(
        settings.auth_cookie_name,
        "",
        max_age=0,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response


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

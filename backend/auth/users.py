import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import AuthenticationBackend, CookieTransport
from fastapi_users.authentication.strategy.db import DatabaseStrategy
from fastapi_users.password import PasswordHelper
from httpx_oauth.clients.google import GoogleOAuth2
from pwdlib import PasswordHash
from sqlalchemy import select

from backend.auth.dependencies import AccessTokenDatabaseDep, UserDatabaseDep
from backend.auth.models import AccessToken, User
from backend.auth.transports import OAuthCookieTransport
from backend.config import settings
from backend.database import SessionFactory

logger = logging.getLogger(__name__)
password_helper = PasswordHelper(PasswordHash.recommended())
google_oauth_client = GoogleOAuth2(
    settings.google_oauth_client_id,
    settings.google_oauth_client_secret,
)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    verification_token_secret = settings.auth_secret

    async def on_after_register(
        self, user: User, request: Optional[Request] = None
    ):
        logger.info("User %s has registered.", user.id)


async def get_user_manager(user_db: UserDatabaseDep):
    yield UserManager(user_db, password_helper)


cookie_transport = CookieTransport(
    cookie_name=settings.auth_cookie_name,
    cookie_max_age=settings.auth_cookie_max_age,
    cookie_secure=settings.auth_cookie_secure,
)
oauth_cookie_transport = OAuthCookieTransport(
    cookie_name=settings.auth_cookie_name,
    cookie_max_age=settings.auth_cookie_max_age,
    cookie_secure=settings.auth_cookie_secure,
)


def get_database_strategy(
    access_token_db: AccessTokenDatabaseDep,
) -> DatabaseStrategy:
    return DatabaseStrategy(
        access_token_db,
        lifetime_seconds=settings.auth_cookie_max_age,
    )


auth_backend = AuthenticationBackend(
    name="cookie",
    transport=cookie_transport,
    get_strategy=get_database_strategy,
)
oauth_auth_backend = AuthenticationBackend(
    name="oauth-cookie",
    transport=oauth_cookie_transport,
    get_strategy=get_database_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])
current_active_user = fastapi_users.current_user(active=True)


async def get_current_user_from_token(token: str) -> dict[str, str] | None:
    async with SessionFactory() as session:
        result = await session.execute(
            select(User.id, User.email).join(
                AccessToken, User.id == AccessToken.user_id
            ).where(
                AccessToken.token == token,
                AccessToken.created_at
                > datetime.now(timezone.utc)
                - timedelta(seconds=settings.auth_cookie_max_age),
                User.is_active.is_(True),
            )
        )
        user = result.one_or_none()
    return {"id": str(user.id), "email": user.email} if user else None


async def get_current_user_id_from_token(token: str) -> str | None:
    user = await get_current_user_from_token(token)
    return user["id"] if user else None


async def get_current_user_from_cookie(request: Request) -> dict[str, str] | None:
    token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        return None

    return await get_current_user_from_token(token)


async def get_current_user_id_from_cookie(request: Request) -> str | None:
    user = await get_current_user_from_cookie(request)
    return user["id"] if user else None

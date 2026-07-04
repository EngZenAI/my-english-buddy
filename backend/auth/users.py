import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import AuthenticationBackend, CookieTransport
from fastapi_users.authentication.strategy.db import DatabaseStrategy
from fastapi_users.password import PasswordHelper
from httpx_oauth.clients.google import GoogleOAuth2
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import AccessTokenDatabaseDep, UserDatabaseDep
from backend.auth.models import AccessToken, User
from backend.auth.transports import OAuthCookieTransport
from backend.config import settings

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

    async def oauth_callback(
        self,
        oauth_name: str,
        access_token: str,
        account_id: str,
        account_email: str,
        expires_at: int | None = None,
        refresh_token: str | None = None,
        request: Optional[Request] = None,
        *,
        associate_by_email: bool = False,
        is_verified_by_default: bool = False,
    ) -> User:
        user = await super().oauth_callback(
            oauth_name,
            access_token,
            account_id,
            account_email,
            expires_at,
            refresh_token,
            request,
            associate_by_email=associate_by_email,
            is_verified_by_default=is_verified_by_default,
        )
        await self._sync_google_avatar(user, oauth_name, access_token)
        return user

    async def oauth_associate_callback(
        self,
        user: User,
        oauth_name: str,
        access_token: str,
        account_id: str,
        account_email: str,
        expires_at: int | None = None,
        refresh_token: str | None = None,
        request: Optional[Request] = None,
    ) -> User:
        user = await super().oauth_associate_callback(
            user,
            oauth_name,
            access_token,
            account_id,
            account_email,
            expires_at,
            refresh_token,
            request,
        )
        await self._sync_google_avatar(user, oauth_name, access_token)
        return user

    async def _sync_google_avatar(
        self,
        user: User,
        oauth_name: str,
        access_token: str,
    ) -> None:
        if oauth_name != "google" or not access_token:
            return

        try:
            avatar_url = await fetch_google_avatar_url(access_token)
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            logger.warning("Failed to fetch Google avatar for user %s", user.id, exc_info=True)
            return

        if not avatar_url or avatar_url == getattr(user, "avatar_url", None):
            return

        await self.user_db.update(user, {"avatar_url": avatar_url})


async def fetch_google_avatar_url(access_token: str) -> str | None:
    async with httpx.AsyncClient(timeout=5) as client:
        response = await client.get(
            "https://people.googleapis.com/v1/people/me",
            params={"personFields": "photos"},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    response.raise_for_status()
    data = response.json()
    photos = data.get("photos") or []
    for photo in photos:
        url = photo.get("url")
        if url and photo.get("metadata", {}).get("primary", True):
            return str(url)
    return str(photos[0].get("url")) if photos and photos[0].get("url") else None


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


async def get_current_user_from_token(
    session: AsyncSession,
    token: str,
) -> dict[str, str | bool] | None:
    result = await session.execute(
        select(User.id, User.email, User.is_superuser, User.avatar_url)
        .join(AccessToken, User.id == AccessToken.user_id)
        .where(
            AccessToken.token == token,
            AccessToken.created_at
            > datetime.now(timezone.utc)
            - timedelta(seconds=settings.auth_cookie_max_age),
            User.is_active.is_(True),
        )
    )
    user = result.one_or_none()
    return {
        "id": str(user.id),
        "email": user.email,
        "is_superuser": bool(user.is_superuser),
        "avatar_url": user.avatar_url,
    } if user else None


async def get_current_user_id_from_token(
    session: AsyncSession,
    token: str,
) -> str | None:
    user = await get_current_user_from_token(session, token)
    return user["id"] if user else None


async def get_current_user_from_cookie(
    request: Request,
    session: AsyncSession,
) -> dict[str, str | bool] | None:
    token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        return None

    return await get_current_user_from_token(session, token)


async def get_current_user_id_from_cookie(
    request: Request,
    session: AsyncSession,
) -> str | None:
    user = await get_current_user_from_cookie(request, session)
    return user["id"] if user else None

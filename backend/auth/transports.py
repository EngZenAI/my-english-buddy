from fastapi import Response
from fastapi.responses import RedirectResponse
from fastapi_users.authentication import CookieTransport

from backend.config import settings


def build_public_url(path: str) -> str:
    return f"{settings.app_public_url.rstrip('/')}/{path.lstrip('/')}"


class OAuthCookieTransport(CookieTransport):
    async def get_login_response(self, token: str) -> Response:
        redirect_url = settings.oauth_success_redirect_url
        if redirect_url.startswith("/"):
            redirect_url = build_public_url(redirect_url)
        response = RedirectResponse(
            url=redirect_url,
            status_code=303,
        )
        return self._set_login_cookie(response, token)

from fastapi import Response

from backend.config import settings


def clear_auth_cookie(response: Response) -> Response:
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

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi_users.password import PasswordHelper
from pwdlib import PasswordHash
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.models import PasswordResetCode, User
from backend.auth.email import (
    EmailSendError,
    get_smtp_sender,
    log_password_reset_code,
    send_password_reset_code_email,
)
from backend.config import settings

password_helper = PasswordHelper(PasswordHash.recommended())
RESET_CODE_LENGTH = 8
RESET_CODE_GROUP_LENGTH = 4
RESET_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"


class PasswordResetError(Exception):
    status_code = 400
    detail = "비밀번호 재설정 요청을 처리하지 못했습니다."


class PasswordResetUnavailable(PasswordResetError):
    status_code = 503
    detail = "PASSWORD_RESET_UNAVAILABLE"


class PasswordResetEmailDeliveryFailed(PasswordResetError):
    status_code = 502
    detail = "인증 코드 메일 발송에 실패했습니다. SMTP 발신자 설정을 확인해주세요."


class PasswordResetEmailRequired(PasswordResetError):
    detail = "이메일을 입력해주세요."


class PasswordResetRequiredFieldsMissing(PasswordResetError):
    detail = "필수 입력값을 확인해주세요."


class PasswordResetInvalidCodeFormat(PasswordResetError):
    detail = "8자리 인증 코드를 입력해주세요."


class PasswordResetPasswordTooShort(PasswordResetError):
    detail = "비밀번호는 8자 이상이어야 합니다."


class PasswordResetCodeExpired(PasswordResetError):
    detail = "인증 코드가 만료되었습니다."


class PasswordResetAttemptsExceeded(PasswordResetError):
    detail = "인증 시도 횟수를 초과했습니다."


class PasswordResetCodeMismatch(PasswordResetError):
    detail = "인증 코드가 일치하지 않습니다."


class PasswordResetAccountNotFound(PasswordResetError):
    detail = "계정을 찾을 수 없습니다."


def is_reset_delivery_available() -> bool:
    return settings.password_reset_debug_code or bool(
        settings.smtp_host
        and settings.smtp_username
        and settings.smtp_password
        and get_smtp_sender()
    )


def normalize_email(email: str) -> str:
    return email.strip().lower()


def format_reset_code(code: str) -> str:
    return "-".join(
        code[index : index + RESET_CODE_GROUP_LENGTH]
        for index in range(0, len(code), RESET_CODE_GROUP_LENGTH)
    )


def normalize_reset_code(code: str) -> str:
    return "".join(char for char in code.strip().upper() if char.isalnum())


def hash_reset_code(email: str, code: str) -> str:
    message = f"{email}:{code}".encode()
    secret = settings.auth_secret.encode()
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def validate_reset_code(code: str) -> str:
    code = normalize_reset_code(code)
    if not code:
        raise PasswordResetRequiredFieldsMissing()
    if len(code) != RESET_CODE_LENGTH or any(
        char not in RESET_CODE_ALPHABET for char in code
    ):
        raise PasswordResetInvalidCodeFormat()
    return code


def validate_reset_email(email: str) -> str:
    email = normalize_email(email)
    if not email:
        raise PasswordResetEmailRequired()
    return email


def validate_reset_password(password: str) -> str:
    if not password:
        raise PasswordResetRequiredFieldsMissing()
    if len(password) < 8:
        raise PasswordResetPasswordTooShort()
    return password


async def request_password_reset(session: AsyncSession, email: str) -> str | None:
    if not is_reset_delivery_available():
        raise PasswordResetUnavailable()

    email = validate_reset_email(email)
    code = await create_reset_code(session, email)
    if not code:
        return None

    return await deliver_reset_code(email, code)


async def verify_password_reset(session: AsyncSession, email: str, code: str) -> None:
    email = validate_reset_email(email)
    code = validate_reset_code(code)
    await get_valid_reset_code(session, email, code)


async def confirm_password_reset(
    session: AsyncSession,
    email: str,
    code: str,
    password: str,
) -> None:
    email = validate_reset_email(email)
    code = validate_reset_code(code)
    password = validate_reset_password(password)
    await update_password_with_code(session, email, code, password)


async def create_reset_code(session: AsyncSession, email: str) -> str | None:
    result = await session.execute(
        select(User.id).where(func.lower(User.email) == email)
    )
    user_id = result.scalar_one_or_none()
    if not user_id:
        return None

    now = datetime.now(timezone.utc)
    code = "".join(secrets.choice(RESET_CODE_ALPHABET) for _ in range(RESET_CODE_LENGTH))
    expires_at = now + timedelta(
        seconds=settings.password_reset_code_lifetime_seconds
    )
    await session.execute(
        update(PasswordResetCode)
        .where(
            PasswordResetCode.user_id == user_id,
            PasswordResetCode.used_at.is_(None),
        )
        .values(used_at=now)
    )
    session.add(
        PasswordResetCode(
            user_id=user_id,
            email=email,
            code_hash=hash_reset_code(email, code),
            created_at=now,
            expires_at=expires_at,
        )
    )
    await session.commit()
    return code


async def deliver_reset_code(email: str, code: str) -> str:
    formatted_code = format_reset_code(code)
    if settings.password_reset_debug_code:
        log_password_reset_code(email, formatted_code)
        return "debug"

    try:
        await send_password_reset_code_email(email, formatted_code)
    except EmailSendError as exc:
        raise PasswordResetEmailDeliveryFailed() from exc
    return "email"


async def get_valid_reset_code(
    session: AsyncSession, email: str, code: str
) -> PasswordResetCode:
    now = datetime.now(timezone.utc)
    result = await session.execute(
        select(PasswordResetCode)
        .where(
            PasswordResetCode.email == email,
            PasswordResetCode.used_at.is_(None),
            PasswordResetCode.expires_at > now,
        )
        .order_by(PasswordResetCode.created_at.desc())
    )
    reset_code = result.scalars().first()
    if not reset_code:
        raise PasswordResetCodeExpired()

    if reset_code.attempts >= 5:
        reset_code.used_at = now
        await session.commit()
        raise PasswordResetAttemptsExceeded()

    expected_hash = hash_reset_code(email, code)
    if not hmac.compare_digest(reset_code.code_hash, expected_hash):
        reset_code.attempts += 1
        await session.commit()
        raise PasswordResetCodeMismatch()

    return reset_code


async def update_password_with_code(
    session: AsyncSession, email: str, code: str, password: str
) -> None:
    now = datetime.now(timezone.utc)
    reset_code = await get_valid_reset_code(session, email, code)

    user_result = await session.execute(
        update(User)
        .where(User.id == reset_code.user_id)
        .values(hashed_password=password_helper.hash(password))
    )
    if user_result.rowcount != 1:
        raise PasswordResetAccountNotFound()

    reset_code.used_at = now
    await session.commit()

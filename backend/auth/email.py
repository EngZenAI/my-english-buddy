import asyncio
import logging
import smtplib
from email.message import EmailMessage

from backend.config import settings
from backend.exceptions import EMAIL_SEND_ERRORS

logger = logging.getLogger(__name__)


class EmailSendError(RuntimeError):
    pass


def get_smtp_sender() -> str:
    return settings.smtp_from or settings.smtp_username


def log_password_reset_code(to_email: str, code: str) -> None:
    logger.warning(
        "Password reset debug code for %s: %s",
        to_email,
        code,
    )


def _send_email_sync(to_email: str, subject: str, body: str) -> None:
    smtp_sender = get_smtp_sender()
    if not settings.smtp_host or not smtp_sender:
        logger.warning(
            "Password reset email not sent because SMTP is not configured. "
            "Recipient=%s",
            to_email,
        )
        return

    message = EmailMessage()
    message["From"] = smtp_sender
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except EMAIL_SEND_ERRORS as exc:
        raise EmailSendError(str(exc)) from exc


async def send_password_reset_code_email(to_email: str, code: str) -> None:
    if settings.password_reset_debug_code:
        log_password_reset_code(to_email, code)
        return

    subject = "EngZen 비밀번호 재설정 인증 코드"
    body = (
        "비밀번호 재설정을 요청하셨습니다.\n\n"
        f"인증 코드: {code}\n\n"
        "코드는 그대로 복사해 붙여넣을 수 있습니다.\n"
        "이 코드는 10분 동안 사용할 수 있습니다.\n"
    )
    await asyncio.to_thread(_send_email_sync, to_email, subject, body)

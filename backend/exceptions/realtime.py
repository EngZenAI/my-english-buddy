from __future__ import annotations


class RealtimeUpstreamError(RuntimeError):
    """Sanitized OpenAI Realtime bootstrap failure."""

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        retryable: bool,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.retryable = retryable
        self.request_id = request_id

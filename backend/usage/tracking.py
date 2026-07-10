from __future__ import annotations

from contextvars import ContextVar
from dataclasses import asdict, dataclass
from typing import Any

from backend.exceptions import DATA_COERCION_ERRORS


@dataclass
class ApiUsageRecord:
    feature: str
    operation: str
    provider: str
    model: str = ""
    units: int = 1
    input_chars: int = 0
    output_chars: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    usage_group_id: str | None = None
    success: bool = True
    error_message: str = ""


_usage_events: ContextVar[list[ApiUsageRecord] | None] = ContextVar(
    "api_usage_events",
    default=None,
)


def start_usage_capture():
    return _usage_events.set([])


def stop_usage_capture(token) -> list[dict[str, Any]]:
    events = _usage_events.get() or []
    _usage_events.reset(token)
    return [asdict(event) for event in events]


def count_chars(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, str):
        return len(value)
    if isinstance(value, bytes):
        return len(value)
    to_string = getattr(value, "to_string", None)
    if callable(to_string):
        return len(to_string())
    content = getattr(value, "content", None)
    if isinstance(content, str):
        return len(content)
    if hasattr(value, "model_dump_json"):
        return len(value.model_dump_json())
    return len(str(value))


def _usage_value(usage: Any, *keys: str) -> int | None:
    for key in keys:
        if isinstance(usage, dict) and usage.get(key) is not None:
            try:
                return int(usage.get(key))
            except DATA_COERCION_ERRORS:
                return None
        value = getattr(usage, key, None)
        if value is not None:
            try:
                return int(value)
            except DATA_COERCION_ERRORS:
                return None
    return None


def extract_token_usage(response: Any) -> dict[str, int | None]:
    usage = getattr(response, "usage_metadata", None)
    metadata = getattr(response, "response_metadata", None) or {}
    if not usage and isinstance(metadata, dict):
        usage = metadata.get("token_usage") or metadata.get("usage")

    input_tokens = _usage_value(
        usage,
        "input_tokens",
        "prompt_tokens",
        "input_token_count",
        "prompt_eval_count",
    )
    output_tokens = _usage_value(
        usage,
        "output_tokens",
        "completion_tokens",
        "generated_token_count",
        "eval_count",
    )
    total_tokens = _usage_value(usage, "total_tokens")
    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


def split_model_name(model_name: str) -> tuple[str, str]:
    if not model_name:
        return "llm", ""
    if model_name.startswith("watsonx:"):
        return "watsonx", model_name.removeprefix("watsonx:")
    if model_name in {"qwen", "exaone"}:
        return "ollama", model_name
    return "llm", model_name


def emit_usage(record: ApiUsageRecord) -> None:
    events = _usage_events.get()
    if events is not None:
        events.append(record)


def _clean_error_message(error_message: str | None, limit: int = 1000) -> str:
    text = " ".join(str(error_message or "").split())
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def mark_latest_usage_failed(
    *,
    feature: str,
    operation: str,
    error_message: str | None,
) -> bool:
    events = _usage_events.get()
    if not events:
        return False

    clean_message = _clean_error_message(error_message)
    for event in reversed(events):
        if event.feature == feature and event.operation == operation:
            event.success = False
            event.error_message = clean_message
            return True
    return False


def track_llm_usage(
    *,
    feature: str,
    operation: str,
    model_name: str,
    input_value: Any = None,
    response: Any = None,
    output_value: Any = None,
    success: bool = True,
    error_message: str | None = None,
) -> None:
    provider, model = split_model_name(model_name)
    usage = extract_token_usage(response)
    emit_usage(
        ApiUsageRecord(
            feature=feature,
            operation=operation,
            provider=provider,
            model=model,
            input_chars=count_chars(input_value),
            output_chars=count_chars(output_value if output_value is not None else response),
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            total_tokens=usage["total_tokens"],
            success=success,
            error_message=_clean_error_message(error_message),
        )
    )


def track_external_usage(
    *,
    feature: str,
    operation: str,
    provider: str,
    model: str = "",
    input_value: Any = None,
    output_value: Any = None,
    units: int = 1,
    success: bool = True,
    error_message: str | None = None,
) -> None:
    emit_usage(
        ApiUsageRecord(
            feature=feature,
            operation=operation,
            provider=provider,
            model=model,
            units=max(1, int(units or 1)),
            input_chars=count_chars(input_value),
            output_chars=count_chars(output_value),
            success=success,
            error_message=_clean_error_message(error_message),
        )
    )

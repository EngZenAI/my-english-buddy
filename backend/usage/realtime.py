from __future__ import annotations

from typing import Any

from backend.usage.tracking import ApiUsageRecord

REALTIME_OPERATIONS = {
    "realtime",
    "realtime_transcription",
    "realtime_transcription_error",
    "realtime_error",
    "realtime_connection",
}
TRANSCRIPTION_OPERATIONS = {
    "realtime_transcription",
    "realtime_transcription_error",
}


def _token_value(usage: dict, *keys: str) -> int | None:
    for key in keys:
        value = usage.get(key)
        if value is None:
            continue
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return None
    return None


def _usage_detail_value(usage: dict, detail_key: str, token_key: str) -> int:
    details = usage.get(detail_key)
    if not isinstance(details, dict):
        return 0
    return _token_value(details, token_key) or 0


def _cached_detail_value(usage: dict, token_key: str) -> int:
    details = usage.get("input_token_details")
    if not isinstance(details, dict):
        return 0
    cached_details = details.get("cached_tokens_details")
    if not isinstance(cached_details, dict):
        return 0
    return _token_value(cached_details, token_key) or 0


def _usage_event_dict(
    *,
    operation: str,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    usage_group_id: str | None = None,
    units: int = 1,
    success: bool = True,
    error_message: str = "",
) -> dict[str, Any]:
    total_tokens = input_tokens + output_tokens
    return ApiUsageRecord(
        feature="roleplay",
        operation=operation,
        provider="openai",
        model=model,
        units=units,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens if total_tokens else None,
        usage_group_id=usage_group_id,
        success=success,
        error_message=error_message,
    ).__dict__


def build_realtime_usage_records(
    payload: Any,
    *,
    realtime_model: str,
    transcription_model: str,
) -> list[dict[str, Any]]:
    usage = payload.usage or {}
    operation = (payload.operation or "realtime").strip() or "realtime"
    if operation not in REALTIME_OPERATIONS:
        operation = "realtime"
    model = transcription_model if operation in TRANSCRIPTION_OPERATIONS else realtime_model
    usage_group_id = (payload.usage_group_id or "").strip()[:200] or None
    success = bool(payload.success)
    error_message = " ".join((payload.error_message or "").split())[:1000]

    if operation in TRANSCRIPTION_OPERATIONS:
        return [
            _usage_event_dict(
                operation=operation,
                model=model,
                input_tokens=_token_value(usage, "input_tokens", "prompt_tokens") or 0,
                output_tokens=_token_value(usage, "output_tokens", "completion_tokens") or 0,
                usage_group_id=usage_group_id,
                success=success,
                error_message=error_message,
            )
        ]

    records = []
    for modality in ("text", "audio", "image"):
        token_key = f"{modality}_tokens"
        input_tokens = _usage_detail_value(usage, "input_token_details", token_key)
        cached_tokens = min(input_tokens, _cached_detail_value(usage, token_key))
        output_tokens = _usage_detail_value(usage, "output_token_details", token_key)
        uncached_input_tokens = max(0, input_tokens - cached_tokens)
        if uncached_input_tokens or output_tokens:
            records.append(
                _usage_event_dict(
                    operation=operation,
                    model=f"{model}:{modality}",
                    input_tokens=uncached_input_tokens,
                    output_tokens=output_tokens,
                    usage_group_id=usage_group_id,
                    success=success,
                    error_message=error_message,
                )
            )
        if cached_tokens:
            records.append(
                _usage_event_dict(
                    operation=operation,
                    model=f"{model}:{modality}_cached",
                    input_tokens=cached_tokens,
                    usage_group_id=usage_group_id,
                    success=success,
                    error_message=error_message,
                )
            )

    if records:
        for index, record in enumerate(records):
            record["units"] = 1 if index == 0 else 0
        return records
    return [
        _usage_event_dict(
            operation=operation,
            model=model,
            input_tokens=_token_value(usage, "input_tokens", "prompt_tokens") or 0,
            output_tokens=_token_value(usage, "output_tokens", "completion_tokens") or 0,
            usage_group_id=usage_group_id,
            success=success,
            error_message=error_message,
        )
    ]

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.action_types import (
    ADD_LABEL,
    AUTO_SAFE_TOOL_TYPES,
    DESTRUCTIVE_TOOL_TYPES,
    PROPOSE_BULK_WORD_UPDATE,
    PROPOSE_DELETE_WORDS,
    PROPOSE_RENAME_LABEL,
    SAVE_AGENT_MEMORY,
    SAVE_WORDS,
)
from backend.agents.schemas import AgentAction
from backend.db.repositories import (
    add_label,
    bulk_delete_words,
    bulk_update_words,
    insert_words,
    rename_label,
    upsert_agent_memory,
)

ActionHandler = Callable[[AsyncSession, str, dict[str, Any]], Awaitable[dict[str, Any]]]


def normalize_action(raw: dict[str, Any], index: int = 0) -> AgentAction | None:
    if not isinstance(raw, dict):
        return None
    action_type = (raw.get("type") or "").strip()
    label = (raw.get("label") or "").strip()
    if not action_type or not label:
        return None

    requires_confirmation = bool(raw.get("requires_confirmation", True))
    destructive = bool(raw.get("destructive", False))
    if action_type not in AUTO_SAFE_TOOL_TYPES:
        requires_confirmation = True
    if action_type in DESTRUCTIVE_TOOL_TYPES:
        destructive = True
        requires_confirmation = True

    return AgentAction(
        id=(raw.get("id") or f"agent-action-{index}"),
        type=action_type,
        label=label,
        payload=raw.get("payload") if isinstance(raw.get("payload"), dict) else {},
        requires_confirmation=requires_confirmation,
        destructive=destructive,
    )


def _word_items_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    items = payload.get("items")
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        return []

    clean_items = []
    for item in items[:50]:
        if not isinstance(item, dict):
            continue
        word = str(item.get("word") or "").strip()
        if not word:
            continue
        clean_items.append({
            "word": word,
            "korean": str(item.get("korean") or ""),
            "korean_detail": str(item.get("korean_detail") or ""),
            "english_def": str(item.get("english_def") or ""),
            "example": str(item.get("example") or ""),
            "tag": str(item.get("tag") or "미지정"),
        })
    return clean_items


async def _add_label(session: AsyncSession, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    labels, ok = await add_label(session, user_id, str(payload.get("name") or ""))
    return {"type": ADD_LABEL, "ok": ok, "labels": labels}


async def _save_words(session: AsyncSession, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    clean_items = _word_items_from_payload(payload)
    if not clean_items:
        return {"type": SAVE_WORDS, "ok": False, "message": "저장할 단어가 없습니다."}
    result = await insert_words(session, user_id, clean_items)
    return {"type": SAVE_WORDS, "ok": True, **result}


async def _save_agent_memory(session: AsyncSession, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    key = str(payload.get("key") or "").strip()
    value = payload.get("value")
    return {"type": SAVE_AGENT_MEMORY, **await upsert_agent_memory(session, user_id, key, value)}


async def _bulk_word_update(session: AsyncSession, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    return {"type": PROPOSE_BULK_WORD_UPDATE, "ok": True, **await bulk_update_words(session, user_id, items)}


async def _delete_words(session: AsyncSession, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    ids = payload.get("ids") if isinstance(payload.get("ids"), list) else []
    deleted = await bulk_delete_words(session, user_id, ids)
    return {"type": PROPOSE_DELETE_WORDS, "ok": True, "deleted": deleted}


async def _rename_label(session: AsyncSession, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    labels, ok, message = await rename_label(
        session,
        user_id,
        str(payload.get("old_name") or ""),
        str(payload.get("new_name") or ""),
    )
    return {"type": PROPOSE_RENAME_LABEL, "ok": ok, "message": message, "labels": labels}


ACTION_HANDLERS: dict[str, ActionHandler] = {
    ADD_LABEL: _add_label,
    SAVE_WORDS: _save_words,
    SAVE_AGENT_MEMORY: _save_agent_memory,
    PROPOSE_BULK_WORD_UPDATE: _bulk_word_update,
    PROPOSE_DELETE_WORDS: _delete_words,
    PROPOSE_RENAME_LABEL: _rename_label,
}


async def execute_agent_action(
    session: AsyncSession,
    user_id: str,
    action: AgentAction,
) -> dict[str, Any]:
    handler = ACTION_HANDLERS.get(action.type)
    if not handler:
        return {"type": action.type, "ok": False, "message": "지원하지 않는 Agent 액션입니다."}
    return await handler(session, user_id, action.payload or {})


async def execute_auto_safe_actions(
    session: AsyncSession,
    user_id: str,
    actions: list[AgentAction],
) -> tuple[list[AgentAction], list[dict[str, Any]]]:
    kept: list[AgentAction] = []
    results: list[dict[str, Any]] = []
    for action in actions:
        if action.type in AUTO_SAFE_TOOL_TYPES and not action.requires_confirmation:
            results.append(await execute_agent_action(session, user_id, action))
        else:
            kept.append(action)
    return kept, results

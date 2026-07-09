from __future__ import annotations

from typing import Any

from backend.agents.action_types import (
    OPEN_TAB,
    START_QUIZ_WITH_GOAL,
    START_ROLEPLAY_WITH_SITUATION,
)
from backend.agents.schemas import AgentAction

PASSIVE_TABS = {"search", "wordbook", "articles", "media"}


def _context_labels(context: dict[str, Any]) -> set[str]:
    return {str(item) for item in (context.get("labels") or []) if str(item).strip()}


def _context_tags_with_words(context: dict[str, Any]) -> set[str]:
    tags: set[str] = set()
    for item in context.get("tag_counts") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        count = int(item.get("count") or 0)
        if name and count > 0:
            tags.add(name)
    return tags


def _is_contextual_quiz_action(action: AgentAction, context: dict[str, Any]) -> bool:
    payload = action.payload or {}
    labels = _context_labels(context)
    if payload.get("scope_due") is True:
        return True
    tag = str(payload.get("tag") or "").strip()
    if tag and tag in labels:
        return True
    scope_tags = payload.get("scope_tags")
    if isinstance(scope_tags, list) and scope_tags:
        return all(str(item).strip() in labels for item in scope_tags)
    return False


def _is_contextual_roleplay_action(action: AgentAction, context: dict[str, Any]) -> bool:
    payload = action.payload or {}
    scenario = str(payload.get("scenario") or "").strip()
    if scenario in {"general", "opic"}:
        situation = str(payload.get("situation") or "").strip()
        return 10 <= len(situation) <= 1200
    if scenario != "tag":
        return False
    tag = str(payload.get("tag") or "").strip()
    return bool(tag and tag in _context_tags_with_words(context))


def _normalize_roleplay_action(action: AgentAction, context: dict[str, Any]) -> AgentAction | None:
    payload = dict(action.payload or {})
    scenario = str(payload.get("scenario") or "").strip()
    situation = str(payload.get("situation") or "").strip()
    has_situation = 10 <= len(situation) <= 1200

    if scenario == "tag":
        tag = str(payload.get("tag") or "").strip()
        if tag and tag in _context_tags_with_words(context):
            return action
        if has_situation:
            payload["scenario"] = "general"
            payload["tag"] = None
            action.payload = payload
            return action
        return None

    if scenario in {"general", "opic"}:
        return action if has_situation else None

    if has_situation:
        payload["scenario"] = "general"
        payload["tag"] = None
        action.payload = payload
        return action
    return None


def _is_safe_client_action(action: AgentAction, context: dict[str, Any]) -> bool:
    if action.type == OPEN_TAB:
        return str((action.payload or {}).get("tab") or "").strip() in PASSIVE_TABS
    if action.type == START_QUIZ_WITH_GOAL:
        return _is_contextual_quiz_action(action, context)
    if action.type == START_ROLEPLAY_WITH_SITUATION:
        return _is_contextual_roleplay_action(action, context)
    return True


def filter_agent_actions(
    actions: list[AgentAction],
    context: dict[str, Any],
) -> tuple[list[AgentAction], list[dict[str, Any]]]:
    kept: list[AgentAction] = []
    filtered: list[dict[str, Any]] = []
    for action in actions:
        label = action.label
        if action.type == START_ROLEPLAY_WITH_SITUATION:
            action = _normalize_roleplay_action(action, context)
            if action is None:
                filtered.append({
                    "type": START_ROLEPLAY_WITH_SITUATION,
                    "label": label,
                    "reason": "client_action_policy",
                })
                continue
        if _is_safe_client_action(action, context):
            kept.append(action)
            continue
        filtered.append({
            "type": action.type,
            "label": action.label,
            "reason": "client_action_policy",
        })
    return kept, filtered

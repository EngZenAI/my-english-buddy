from __future__ import annotations

import json
import re
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from backend.agents.action_types import ALLOWED_ACTION_PROMPT_LINES, START_QUIZ_WITH_GOAL
from backend.agents.context import build_agent_context
from backend.agents.safety.policy import filter_agent_actions
from backend.agents.schemas import AgentCard, AgentResponse
from backend.agents.tools import execute_auto_safe_actions, normalize_action
from backend.exceptions import AGENT_PLAN_ERRORS, JSON_PARSE_ERRORS
from backend.llm import _invoke_tracked_llm
from backend.prompts.agent import build_agent_prompt


class AgentState(TypedDict, total=False):
    session: AsyncSession
    user_id: str
    message: str
    current_tab: str
    recent_messages: list[dict[str, Any]]
    context: dict[str, Any]
    raw_plan: dict[str, Any]
    actions: list
    policy_results: list[dict[str, Any]]
    response: AgentResponse


def _compact_recent_messages(items: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    compact: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return compact

    for item in items[-6:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        if role not in {"user", "agent"}:
            continue
        content = str(item.get("content") or item.get("message") or "").strip()
        if not content:
            continue

        clean: dict[str, Any] = {
            "role": role,
            "content": content[:700],
        }
        actions = item.get("actions") if isinstance(item.get("actions"), list) else []
        clean_actions = []
        for action in actions[:4]:
            if not isinstance(action, dict):
                continue
            clean_actions.append({
                "type": str(action.get("type") or "")[:80],
                "label": str(action.get("label") or "")[:120],
                "payload": action.get("payload") if isinstance(action.get("payload"), dict) else {},
            })
        if clean_actions:
            clean["actions"] = clean_actions

        compact.append(clean)
    return compact


def _json_from_text(text: str) -> dict[str, Any]:
    source = (text or "").strip()
    if not source:
        return {}
    fenced = re.search(r"```(?:json)?\s*(.*?)```", source, re.S)
    if fenced:
        source = fenced.group(1).strip()
    if not source.startswith("{"):
        start = source.find("{")
        end = source.rfind("}")
        if start >= 0 and end > start:
            source = source[start : end + 1]
    try:
        data = json.loads(source)
        return data if isinstance(data, dict) else {}
    except JSON_PARSE_ERRORS:
        return {}


def _action_dict(action: Any) -> dict[str, Any]:
    if hasattr(action, "model_dump"):
        return action.model_dump()
    if hasattr(action, "dict"):
        return action.dict()
    return {}


async def _load_context(state: AgentState) -> AgentState:
    state["context"] = await build_agent_context(
        state["session"],
        state["user_id"],
        state.get("current_tab") or "search",
    )
    return state


async def _plan(state: AgentState) -> AgentState:
    fallback_plan = {
        "message": "요청을 이해했지만 실행 계획을 만들지 못했어요. 조금 더 구체적으로 말해 주세요.",
        "cards": [],
        "actions": [],
    }
    context_json = json.dumps(state.get("context") or {}, ensure_ascii=False, default=str)
    recent_messages_json = json.dumps(
        _compact_recent_messages(state.get("recent_messages")),
        ensure_ascii=False,
        default=str,
    )
    prompt_value = build_agent_prompt(
        allowed_action_prompt_lines=ALLOWED_ACTION_PROMPT_LINES,
        example_action_type=START_QUIZ_WITH_GOAL,
        context_json=context_json,
        recent_messages_json=recent_messages_json,
        message=state.get("message") or "",
    )
    try:
        raw = await run_in_threadpool(_invoke_tracked_llm, "agent", "chat", prompt_value)
        data = _json_from_text(raw)
    except AGENT_PLAN_ERRORS:
        data = fallback_plan
    if not data:
        data = fallback_plan
    state["raw_plan"] = data
    return state


async def _policy_filter(state: AgentState) -> AgentState:
    raw_plan = state.get("raw_plan") or {}
    raw_actions = raw_plan.get("actions") if isinstance(raw_plan.get("actions"), list) else []
    actions = [
        action
        for action in (normalize_action(item, index) for index, item in enumerate(raw_actions))
        if action is not None
    ][:6]
    state["actions"], state["policy_results"] = filter_agent_actions(
        actions,
        state.get("context") or {},
    )
    return state


async def _execute_safe_tools(state: AgentState) -> AgentState:
    raw_plan = state.get("raw_plan") or {}
    actions = state.get("actions") or []
    kept_actions, tool_results = await execute_auto_safe_actions(
        state["session"],
        state["user_id"],
        actions,
    )
    kept_actions_by_id = {action.id: action for action in kept_actions if getattr(action, "id", "")}

    cards = []
    for index, item in enumerate(raw_plan.get("cards") or []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
        action = kept_actions_by_id.get(f"agent-action-{index}")
        if action:
            payload = {**payload, "action": _action_dict(action)}
        cards.append(AgentCard(
            title=title[:80],
            body=str(item.get("body") or "")[:300],
            kind=str(item.get("kind") or "info")[:40],
            payload=payload,
        ))

    message = str(raw_plan.get("message") or "").strip()
    if tool_results:
        ok_count = sum(1 for item in tool_results if item.get("ok", True))
        message = f"{message}\n\n자동 처리 가능한 작업 {ok_count}개를 완료했어요.".strip()

    state["response"] = AgentResponse(
        message=message or "확인했어요. 다음 액션을 골라 주세요.",
        cards=cards[:4],
        actions=kept_actions,
        tool_results=tool_results,
    )
    return state


_workflow = StateGraph(AgentState)
_workflow.add_node("load_context", _load_context)
_workflow.add_node("plan", _plan)
_workflow.add_node("policy_filter", _policy_filter)
_workflow.add_node("execute_safe_tools", _execute_safe_tools)
_workflow.set_entry_point("load_context")
_workflow.add_edge("load_context", "plan")
_workflow.add_edge("plan", "policy_filter")
_workflow.add_edge("policy_filter", "execute_safe_tools")
_workflow.add_edge("execute_safe_tools", END)
agent_app = _workflow.compile()


async def run_buddy_agent(
    session: AsyncSession,
    user_id: str,
    message: str,
    current_tab: str = "search",
    recent_messages: list[dict[str, Any]] | None = None,
) -> AgentResponse:
    result = await agent_app.ainvoke({
        "session": session,
        "user_id": user_id,
        "message": message,
        "current_tab": current_tab,
        "recent_messages": recent_messages or [],
    })
    return result["response"]

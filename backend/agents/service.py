from __future__ import annotations

from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.action_types import START_AGENT_JOB
from backend.agents.context import build_agent_context, build_rule_based_suggestions
from backend.agents.graph import run_buddy_agent
from backend.agents.jobs import create_wordbook_audit_job, run_wordbook_audit_job
from backend.agents.schemas import AgentAction, AgentResponse, AgentSuggestionResponse
from backend.agents.tools import execute_agent_action
from backend.db.repositories import get_agent_job


class UnsupportedAgentJob(ValueError):
    pass


async def get_agent_suggestions(
    session: AsyncSession,
    user_id: str,
    tab: str = "search",
) -> AgentSuggestionResponse:
    context = await build_agent_context(session, user_id, tab)
    return AgentSuggestionResponse(**build_rule_based_suggestions(context))


async def run_agent_chat(
    session: AsyncSession,
    user_id: str,
    message: str,
    current_tab: str = "search",
    recent_messages: list[dict] | None = None,
) -> AgentResponse:
    clean = message.strip()
    if not clean:
        return AgentResponse(message="무엇을 도와드릴까요?")
    return await run_buddy_agent(session, user_id, clean, current_tab, recent_messages)


async def confirm_agent_action(
    session: AsyncSession,
    user_id: str,
    action: AgentAction,
    background_tasks: BackgroundTasks,
) -> AgentResponse:
    if action.type == START_AGENT_JOB:
        job_type = (action.payload or {}).get("job_type") or "wordbook_audit"
        if job_type != "wordbook_audit":
            raise UnsupportedAgentJob("지원하지 않는 Agent 작업입니다.")
        job_id = await create_wordbook_audit_job(user_id)
        background_tasks.add_task(run_wordbook_audit_job, user_id, job_id)
        return AgentResponse(
            message="단어장 점검을 시작했어요. 진행률은 패널에서 확인할 수 있습니다.",
            job_id=job_id,
        )

    result = await execute_agent_action(session, user_id, action)
    return AgentResponse(
        message=result.get("message") or ("작업을 완료했어요." if result.get("ok", True) else "작업을 완료하지 못했어요."),
        tool_results=[result],
    )


async def get_agent_job_status(
    session: AsyncSession,
    user_id: str,
    job_id: str,
) -> dict | None:
    return await get_agent_job(session, user_id, job_id)

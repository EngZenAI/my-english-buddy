from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend.agents.schemas import AgentActionConfirmIn, AgentChatIn
from backend.agents.service import (
    UnsupportedAgentJob,
    confirm_agent_action,
    get_agent_job_status,
    get_agent_suggestions,
    run_agent_chat,
)
from backend.api_usage import start_usage_capture
from backend.db.dependencies import SessionDep
from backend.routers.common import CurrentUserDep, safe_persist_usage_capture

router = APIRouter(tags=["agent"])


@router.get("/agent/suggestions")
async def agent_suggestions(
    session: SessionDep,
    _user: CurrentUserDep,
    tab: str = "search",
):
    response = await get_agent_suggestions(session, _user["id"], tab)
    return response.model_dump()


@router.post("/agent/chat")
async def agent_chat(payload: AgentChatIn, session: SessionDep, _user: CurrentUserDep):
    usage_token = start_usage_capture()
    try:
        response = await run_agent_chat(
            session,
            _user["id"],
            payload.message,
            payload.current_tab,
            payload.recent_messages,
        )
        return response.model_dump()
    finally:
        await safe_persist_usage_capture(usage_token, _user)


@router.post("/agent/actions/confirm")
async def agent_action_confirm(
    payload: AgentActionConfirmIn,
    background_tasks: BackgroundTasks,
    session: SessionDep,
    _user: CurrentUserDep,
):
    action = payload.action
    try:
        response = await confirm_agent_action(session, _user["id"], action, background_tasks)
    except UnsupportedAgentJob as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return response.model_dump()


@router.get("/agent/jobs/{job_id}")
async def agent_job_status(job_id: str, session: SessionDep, _user: CurrentUserDep):
    job = await get_agent_job_status(session, _user["id"], job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Agent 작업을 찾을 수 없습니다.")
    return {"job": job}

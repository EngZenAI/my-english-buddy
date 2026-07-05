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


@router.get(
    "/agent/suggestions",
    summary="AI 에이전트 제안 조회",
    description="현재 탭과 사용자 학습 상태를 바탕으로 에이전트가 추천할 다음 행동을 조회합니다.",
)
async def agent_suggestions(
    session: SessionDep,
    _user: CurrentUserDep,
    tab: str = "search",
):
    response = await get_agent_suggestions(session, _user["id"], tab)
    return response.model_dump()


@router.post(
    "/agent/chat",
    summary="AI 에이전트 채팅",
    description="사용자 메시지와 현재 탭 맥락을 바탕으로 학습 에이전트 답변을 생성합니다.",
)
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


@router.post(
    "/agent/actions/confirm",
    summary="AI 에이전트 작업 확정",
    description="에이전트가 제안한 작업을 사용자가 확정하면 실제 백그라운드 작업으로 실행합니다.",
)
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


@router.get(
    "/agent/jobs/{job_id}",
    summary="AI 에이전트 작업 상태 조회",
    description="백그라운드로 실행 중인 에이전트 작업의 진행 상태와 결과를 조회합니다.",
)
async def agent_job_status(job_id: str, session: SessionDep, _user: CurrentUserDep):
    job = await get_agent_job_status(session, _user["id"], job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Agent 작업을 찾을 수 없습니다.")
    return {"job": job}

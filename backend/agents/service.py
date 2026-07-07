from __future__ import annotations

from collections import Counter

from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.action_types import START_AGENT_JOB, START_QUIZ_WITH_GOAL
from backend.agents.context import build_agent_context, build_rule_based_suggestions
from backend.agents.graph import run_buddy_agent
from backend.agents.jobs import create_wordbook_audit_job, run_wordbook_audit_job
from backend.agents.schemas import AgentAction, AgentCard, AgentResponse, AgentSuggestionResponse
from backend.agents.tools import execute_agent_action
from backend.db.repositories import get_agent_job


class UnsupportedAgentJob(ValueError):
    pass


def _is_weakness_request(message: str) -> bool:
    clean = (message or "").strip()
    return "약점" in clean and any(token in clean for token in ("분석", "알려", "찾아", "뭐", "체크"))


def _percent(value: float) -> str:
    return f"{round(max(0, min(1, value)) * 100)}%"


def _weakness_quiz_action(weak_words: list[dict], due_count: int) -> AgentAction:
    tags = [
        str(item.get("tag") or "").strip()
        for item in weak_words
        if str(item.get("tag") or "").strip() and str(item.get("tag") or "").strip() != "미지정"
    ]
    top_tags = [name for name, _count in Counter(tags).most_common(2)]
    word_names = [str(item.get("word") or "").strip() for item in weak_words if str(item.get("word") or "").strip()]
    payload = {
        "question_count": min(10, max(5, len(word_names) or due_count or 5)),
        "instruction": (
            "취약 단어와 최근 오답 패턴을 우선 점검해 주세요. "
            f"우선 단어: {', '.join(word_names[:8]) or '최근 오답 단어'}"
        ),
    }
    if top_tags:
        payload.update({"scope_all": False, "scope_tags": top_tags})
    elif due_count > 0:
        payload.update({"scope_all": False, "scope_due": True})
    else:
        payload.update({"scope_all": True})
    return AgentAction(
        type=START_QUIZ_WITH_GOAL,
        label="약점 보완 퀴즈 설정",
        payload=payload,
        requires_confirmation=True,
    )


def _weakness_response(context: dict) -> AgentResponse:
    learning = context.get("learning") or {}
    weak_words = learning.get("weak_words") or []
    weak_types = learning.get("weak_question_types") or []
    recent_incorrect = learning.get("recent_incorrect") or []
    due_count = int(learning.get("due_review_count") or 0)
    attempt_count = int(learning.get("quiz_attempt_count") or 0)
    accuracy = float(learning.get("quiz_accuracy") or 0)
    incorrect_count = int(learning.get("quiz_incorrect_count") or 0)

    if attempt_count <= 0:
        action = AgentAction(
            type=START_QUIZ_WITH_GOAL,
            label="진단 퀴즈 설정",
            payload={
                "scope_all": True,
                "question_count": 10,
                "instruction": "약점 분석을 위한 진단 퀴즈로, 뜻/문맥/콜로케이션/문장 사용을 고르게 확인해 주세요.",
            },
            requires_confirmation=True,
        )
        return AgentResponse(
            message="아직 채점된 퀴즈 기록이 없어서 약점을 계산할 수 없습니다. 먼저 진단 퀴즈를 한 번 풀면 오답 단어와 유형을 기준으로 분석할 수 있어요.",
            cards=[
                AgentCard(
                    title="분석 데이터 부족",
                    body="퀴즈 채점 기록이 생기면 취약 단어, 오답률, 취약 문제 유형을 보여줄 수 있습니다.",
                    kind="weakness",
                    payload={"action": action.model_dump()},
                )
            ],
            actions=[action],
        )

    weak_word_text = ", ".join(
        f"{item.get('word')}({ _percent(float(item.get('incorrect_rate') or 0))} 오답)"
        for item in weak_words[:5]
        if item.get("word")
    )
    weak_type_text = ", ".join(
        f"{item.get('question_type') or '유형 미상'} {int(item.get('incorrect_count') or 0)}회"
        for item in weak_types[:3]
    )
    recent_text = ", ".join(
        str(item.get("word") or item.get("target_word") or "").strip()
        for item in recent_incorrect[:5]
        if str(item.get("word") or item.get("target_word") or "").strip()
    )
    action = _weakness_quiz_action(weak_words, due_count)
    cards = [
        AgentCard(
            title="퀴즈 현황",
            body=f"{attempt_count}문항 풀이, 정답률 {_percent(accuracy)}, 오답 {incorrect_count}개입니다.",
            kind="weakness_summary",
        ),
        AgentCard(
            title="취약 단어",
            body=weak_word_text or "반복 오답 단어는 아직 뚜렷하지 않습니다.",
            kind="weak_words",
        ),
        AgentCard(
            title="개선 방향",
            body=(
                f"취약 유형: {weak_type_text}. 최근 오답: {recent_text}."
                if weak_type_text or recent_text
                else "다음 퀴즈에서는 뜻 맞히기보다 문맥, 사용법, 짧은 영작 문제를 섞어 확인하는 편이 좋습니다."
            ),
            kind="weakness_plan",
            payload={"action": action.model_dump()},
        ),
    ]
    return AgentResponse(
        message="퀴즈 기록 기준으로 약점을 정리했습니다. 바로 이동하지 않고, 아래 상태를 먼저 확인한 뒤 약점 보완 퀴즈를 선택할 수 있습니다.",
        cards=cards,
        actions=[action],
    )


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
    if _is_weakness_request(clean):
        context = await build_agent_context(session, user_id, current_tab)
        return _weakness_response(context)
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

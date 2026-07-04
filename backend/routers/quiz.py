from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException

from backend.api_usage import start_usage_capture
from backend.db.dependencies import SessionDep
from backend.db.repositories import get_quiz_session_detail, get_quiz_stats, get_words_for_quiz
from backend.quiz.schemas import QuizGenerateIn, QuizGradeIn, QuizReviewScheduleApplyIn
from backend.quiz.service import apply_review_schedule, generate_assignment, grade_assignment
from backend.routers.common import CurrentUserDep, safe_persist_usage_capture

router = APIRouter(tags=["quiz"])

MAX_QUIZ_STATS_RANGE_DAYS = 366


@router.post("/quiz/generate")
async def quiz_generate(payload: QuizGenerateIn, session: SessionDep, _user: CurrentUserDep):
    # TODO: 복습 스케줄 기반 출제로 되돌릴 때 get_words_for_quiz에 next_review 조건을 추가한다.
    type_total = sum(
        max(0, int(value or 0))
        for value in (payload.question_type_counts or {}).values()
    )
    question_count = max(1, min(int(type_total or payload.question_count or 10), 20))
    words = await get_words_for_quiz(
        session,
        _user["id"],
        mode=payload.mode,
        tag=payload.tag.strip(),
        scope_all=payload.scope_all,
        scope_tags=payload.scope_tags,
        scope_saved_date=payload.scope_saved_date,
        scope_due=payload.scope_due,
        saved_from=payload.saved_from.strip(),
        saved_to=payload.saved_to.strip(),
        limit=question_count * 3,
    )
    usage_token = start_usage_capture()
    try:
        return await generate_assignment(session, _user["id"], words, payload)
    finally:
        await safe_persist_usage_capture(usage_token, _user)


@router.post("/quiz/grade")
async def quiz_grade(payload: QuizGradeIn, session: SessionDep, _user: CurrentUserDep):
    usage_token = start_usage_capture()
    try:
        return await grade_assignment(
            session,
            _user["id"],
            payload.answer_token,
            [answer.model_dump() for answer in payload.answers],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await safe_persist_usage_capture(usage_token, _user)


@router.post("/quiz/review-schedule/apply")
async def quiz_review_schedule_apply(
    payload: QuizReviewScheduleApplyIn,
    session: SessionDep,
    _user: CurrentUserDep,
):
    result = await apply_review_schedule(
        session,
        _user["id"],
        payload.session_id,
        payload.incorrect_interval,
    )
    if not result.ok:
        raise HTTPException(status_code=404, detail=result.message)
    return result


def _parse_quiz_stats_date(value: str):
    value = (value or "").strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="날짜 형식은 YYYY-MM-DD 이어야 합니다.")


def _safe_quiz_stats_range(start_date: str, end_date: str) -> tuple[str, str]:
    start = _parse_quiz_stats_date(start_date)
    end = _parse_quiz_stats_date(end_date)
    if not start and not end:
        return "", ""
    if start and not end:
        end = datetime.now().date()
    elif end and not start:
        start = end - timedelta(days=6)
    if start > end:
        start, end = end, start
    if (end - start).days + 1 > MAX_QUIZ_STATS_RANGE_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"퀴즈 통계 조회 기간은 최대 {MAX_QUIZ_STATS_RANGE_DAYS}일입니다.",
        )
    return start.isoformat(), end.isoformat()


@router.get("/quiz/stats")
async def quiz_stats(
    session: SessionDep,
    _user: CurrentUserDep,
    start_date: str = "",
    end_date: str = "",
):
    safe_start_date, safe_end_date = _safe_quiz_stats_range(start_date, end_date)
    return await get_quiz_stats(session, _user["id"], start_date=safe_start_date, end_date=safe_end_date)


@router.get("/quiz/sessions/{session_id}")
async def quiz_session_detail(session_id: int, session: SessionDep, _user: CurrentUserDep):
    detail = await get_quiz_session_detail(session, _user["id"], session_id)
    if not detail:
        raise HTTPException(status_code=404, detail="완료된 퀴즈 기록을 찾을 수 없습니다.")
    return detail

import json
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import Integer, bindparam, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.repositories.common import _rows

MAX_QUIZ_STATS_RANGE_DAYS = 366


async def get_words_for_quiz(
    session: AsyncSession,
    user_id: str,
    mode: str = "random",
    tag: str = "",
    scope_all: bool = True,
    scope_tags: list[str] | None = None,
    scope_saved_date: bool = False,
    scope_due: bool = False,
    saved_from: str = "",
    saved_to: str = "",
    limit: int = 50,
):
    mode = (mode or "random").strip()
    limit = max(1, min(int(limit or 50), 100))
    clauses = ["user_id = :user_id"]
    params: dict[str, Any] = {"user_id": user_id, "limit": limit}

    tags = [item.strip() for item in (scope_tags or []) if item and item.strip()]
    if not tags and mode == "tag" and tag:
        tags = [tag.strip()]
    use_saved_date = bool(scope_saved_date or mode == "saved_date")
    use_due = bool(scope_due)
    has_explicit_scope = bool(tags or use_saved_date or use_due)
    include_all = bool(not has_explicit_scope and (scope_all or mode == "random"))

    scope_clauses: list[str] = []
    if tags:
        tag_placeholders = []
        for index, value in enumerate(tags):
            key = f"tag_{index}"
            tag_placeholders.append(f":{key}")
            params[key] = value
        scope_clauses.append(f"tag IN ({', '.join(tag_placeholders)})")
    if use_saved_date:
        date_parts = []
        if saved_from:
            date_parts.append("created_at::date >= :saved_from")
            params["saved_from"] = saved_from
        if saved_to:
            date_parts.append("created_at::date <= :saved_to")
            params["saved_to"] = saved_to
        if date_parts:
            scope_clauses.append(f"({' AND '.join(date_parts)})")
    if use_due:
        scope_clauses.append("next_review <= NOW()")
    if not include_all:
        if scope_clauses:
            clauses.append(f"({' OR '.join(scope_clauses)})")
        else:
            clauses.append("FALSE")

    order_by = "RANDOM()" if mode == "random" else "sort_order ASC NULLS LAST, created_at DESC"
    result = await session.execute(
        text(
            f"""SELECT id, word, korean, korean_detail, english_def, example,
                       tag, created_at, next_review, sort_order
                FROM words
                WHERE {' AND '.join(clauses)}
                ORDER BY {order_by}
                LIMIT :limit"""
        ),
        params,
    )
    return _rows(result)


async def create_quiz_session(
    session: AsyncSession,
    user_id: str,
    goal: dict,
    question_count: int,
    questions_payload: list[dict[str, Any]] | None = None,
) -> int:
    result = await session.execute(
        text(
            """INSERT INTO quiz_sessions
                   (user_id, mode, tag, saved_from, saved_to, instruction, question_count, questions_json)
               VALUES (:user_id, :mode, :tag, CAST(NULLIF(:saved_from, '') AS date),
                       CAST(NULLIF(:saved_to, '') AS date), :instruction, :question_count,
                       CAST(:questions_json AS jsonb))
               RETURNING id"""
        ),
        {
            "user_id": user_id,
            "mode": goal.get("mode") or "random",
            "tag": goal.get("tag") or "",
            "saved_from": goal.get("saved_from") or "",
            "saved_to": goal.get("saved_to") or "",
            "instruction": goal.get("instruction") or "",
            "question_count": question_count,
            "questions_json": json.dumps(questions_payload or [], ensure_ascii=False),
        },
    )
    await session.commit()
    return int(result.scalar_one())


async def complete_quiz_session(
    session: AsyncSession,
    user_id: str,
    session_id: int,
    score: float,
    total: int,
) -> None:
    await session.execute(
        text(
            """UPDATE quiz_sessions
               SET score = :score, total_questions = :total, completed_at = NOW()
               WHERE id = :session_id AND user_id = :user_id"""
        ),
        {"score": score, "total": total, "session_id": session_id, "user_id": user_id},
    )
    await session.commit()


def _quiz_question_result_params(
    user_id: str,
    session_id: int,
    results: list[dict],
) -> list[dict[str, Any]]:
    params: list[dict[str, Any]] = []
    for result in results:
        params.append(
            {
                "session_id": session_id,
                "user_id": user_id,
                "word_id": result.get("word_id"),
                "source_word_id": result.get("source_word_id"),
                "source_word": result.get("source_word") or "",
                "question_id": result.get("question_id") or "",
                "target_word": result.get("target_word") or "",
                "question_type": result.get("question_type") or "",
                "difficulty": result.get("difficulty") or "",
                "prompt": result.get("prompt") or "",
                "user_answer": result.get("user_answer") or "",
                "correct_answer": result.get("correct_answer") or "",
                "selected_choice_id": result.get("selected_choice_id") or "",
                "correct_choice_id": result.get("correct_choice_id") or "",
                "status": result.get("status") or "",
                "correct": result.get("correct"),
                "score": result.get("score", 0),
                "confidence": result.get("confidence", 1),
                "feedback": result.get("feedback") or "",
                "is_derived": result.get("is_derived", False),
                "derived_from_word_id": result.get("derived_from_word_id"),
                "suggested_word": result.get("suggested_word") or "",
                "suggested_korean": result.get("suggested_korean") or "",
                "suggested_english_def": result.get("suggested_english_def") or "",
                "suggested_example": result.get("suggested_example") or "",
                "suggested_tag": result.get("suggested_tag") or "미지정",
            }
        )
    return params


async def _insert_quiz_question_results(
    session: AsyncSession,
    params: list[dict[str, Any]],
) -> None:
    if not params:
        return
    await session.execute(
        text(
            """INSERT INTO quiz_question_results
                (session_id, user_id, word_id, source_word_id, source_word,
                 question_id, target_word, question_type, difficulty, prompt, user_answer,
                 correct_answer, selected_choice_id, correct_choice_id, status, correct, score, confidence, feedback,
                 is_derived, derived_from_word_id, suggested_word,
                 suggested_korean, suggested_english_def, suggested_example, suggested_tag)
               VALUES
                (:session_id, :user_id, :word_id, :source_word_id, :source_word,
                 :question_id, :target_word, :question_type, :difficulty, :prompt, :user_answer,
                 :correct_answer, :selected_choice_id, :correct_choice_id, :status, :correct, :score, :confidence, :feedback,
                 :is_derived, :derived_from_word_id, :suggested_word,
                 :suggested_korean, :suggested_english_def, :suggested_example, :suggested_tag)"""
        ),
        params,
    )


async def save_quiz_question_results(
    session: AsyncSession,
    user_id: str,
    session_id: int,
    results: list[dict],
) -> None:
    params = _quiz_question_result_params(user_id, session_id, results)
    if not params:
        return
    await _insert_quiz_question_results(session, params)
    await session.commit()


async def save_results_and_complete_session(
    session: AsyncSession,
    user_id: str,
    session_id: int,
    results: list[dict],
    score: float,
    total: int,
) -> None:
    try:
        params = _quiz_question_result_params(user_id, session_id, results)
        await _insert_quiz_question_results(session, params)
        await session.execute(
            text(
                """UPDATE quiz_sessions
                   SET score = :score, total_questions = :total, completed_at = NOW()
                   WHERE id = :session_id AND user_id = :user_id"""
            ),
            {
                "score": score,
                "total": total,
                "session_id": session_id,
                "user_id": user_id,
            },
        )
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        raise


def _date_param(value: str | date | None) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _quiz_stats_date_clause(alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    return (
        f" AND (CAST(:start_date AS date) IS NULL OR {prefix}created_at::date >= CAST(:start_date AS date))"
        f" AND (CAST(:end_date AS date) IS NULL OR {prefix}created_at::date <= CAST(:end_date AS date))"
    )


async def get_quiz_stats(
    session: AsyncSession,
    user_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict:
    start_date = _date_param(start_date)
    end_date = _date_param(end_date)
    if start_date and end_date and start_date > end_date:
        start_date, end_date = end_date, start_date
    if start_date and not end_date:
        end_date = date.today()
    elif end_date and not start_date:
        start_date = end_date - timedelta(days=6)
    if start_date and end_date and (end_date - start_date).days + 1 > MAX_QUIZ_STATS_RANGE_DAYS:
        start_date = end_date - timedelta(days=MAX_QUIZ_STATS_RANGE_DAYS - 1)
    params = {"user_id": user_id, "start_date": start_date, "end_date": end_date}
    result_date_clause = _quiz_stats_date_clause()
    q_date_clause = _quiz_stats_date_clause("q")

    result = await session.execute(
        text(
            f"""SELECT
                   COUNT(*)::int AS attempt_count,
                   COALESCE(SUM(score), 0)::float AS total_score,
                   COUNT(*) FILTER (WHERE status = 'correct')::int AS correct_count,
                   COUNT(*) FILTER (WHERE status = 'partial')::int AS partial_count,
                   COUNT(*) FILTER (WHERE status = 'incorrect')::int AS incorrect_count,
                   COUNT(DISTINCT COALESCE(source_word_id, word_id)) FILTER (
                       WHERE status = 'incorrect'
                   )::int AS incorrect_word_count,
                   MAX(created_at) AS last_quiz_at
               FROM quiz_question_results
               WHERE user_id = :user_id{result_date_clause}"""
        ),
        params,
    )
    summary = dict(result.mappings().first() or {})

    result = await session.execute(
        text(
            f"""SELECT
                   COALESCE(q.source_word_id, q.word_id)::int AS word_id,
                   COALESCE(
                       MAX(NULLIF(q.source_word, '')),
                       MAX(NULLIF(q.target_word, '')),
                       MAX(w.word),
                       ''
                   ) AS word,
                   COALESCE(MAX(w.korean), '') AS korean,
                   COALESCE(MAX(w.tag), '') AS tag,
                   COUNT(*)::int AS attempt_count,
                   COALESCE(SUM(q.score), 0)::float AS total_score,
                   COUNT(*) FILTER (WHERE q.status = 'correct')::int AS correct_count,
                   COUNT(*) FILTER (WHERE q.status = 'partial')::int AS partial_count,
                   COUNT(*) FILTER (WHERE q.status = 'incorrect')::int AS incorrect_count,
                   MAX(q.created_at) AS last_quiz_at
               FROM quiz_question_results q
               LEFT JOIN words w
                    ON w.user_id = q.user_id
                   AND w.id = COALESCE(q.source_word_id, q.word_id)
               WHERE q.user_id = :user_id
                 AND COALESCE(q.source_word_id, q.word_id) IS NOT NULL{q_date_clause}
               GROUP BY COALESCE(q.source_word_id, q.word_id)
               ORDER BY incorrect_count DESC, attempt_count DESC, last_quiz_at DESC
               LIMIT 50"""
        ),
        params,
    )
    word_stats = _rows(result)

    result = await session.execute(
        text(
            f"""SELECT
                   question_type,
                   COUNT(*)::int AS attempt_count,
                   COALESCE(SUM(score), 0)::float AS total_score,
                   COUNT(*) FILTER (WHERE status = 'incorrect')::int AS incorrect_count
               FROM quiz_question_results
               WHERE user_id = :user_id{result_date_clause}
               GROUP BY question_type
               ORDER BY attempt_count DESC"""
        ),
        params,
    )
    type_stats = _rows(result)

    result = await session.execute(
        text(
            f"""SELECT
                   COALESCE(q.source_word_id, q.word_id)::int AS word_id,
                   COALESCE(NULLIF(q.source_word, ''), NULLIF(q.target_word, ''), w.word, '') AS word,
                   COALESCE(w.korean, '') AS korean,
                   COALESCE(w.tag, '') AS tag,
                   q.target_word,
                   q.question_type,
                   q.prompt,
                   q.user_answer,
                   q.correct_answer,
                   q.feedback,
                   q.created_at
               FROM quiz_question_results q
               LEFT JOIN words w
                    ON w.user_id = q.user_id
                   AND w.id = COALESCE(q.source_word_id, q.word_id)
               WHERE q.user_id = :user_id AND q.status = 'incorrect'{q_date_clause}
               ORDER BY q.created_at DESC
               LIMIT 10"""
        ),
        params,
    )
    recent_incorrect = _rows(result)

    result = await session.execute(
        text(
            f"""WITH result_summary AS (
                   SELECT
                       session_id,
                       COUNT(*)::int AS result_count,
                       MAX(created_at) AS last_result_at,
                       COALESCE(SUM(score), 0)::float AS result_score
                   FROM quiz_question_results
                   WHERE user_id = :user_id{result_date_clause}
                   GROUP BY session_id
               )
               SELECT
                   s.id,
                   s.mode,
                   s.tag,
                   s.question_count,
                   COALESCE(NULLIF(s.total_questions, 0), r.result_count, 0)::int AS total_questions,
                   COALESCE(NULLIF(s.score, 0), r.result_score, 0)::float AS score,
                   s.created_at,
                   COALESCE(s.completed_at, r.last_result_at) AS completed_at
               FROM quiz_sessions s
               JOIN result_summary r ON r.session_id = s.id
               WHERE s.user_id = :user_id
               ORDER BY COALESCE(s.completed_at, r.last_result_at) DESC
               LIMIT 6"""
        ),
        params,
    )
    recent_sessions = _rows(result)

    result = await session.execute(
        text(
            """WITH days AS (
                   SELECT generate_series(
                       COALESCE(CAST(:start_date AS date), (CURRENT_DATE - INTERVAL '6 days')::date),
                       COALESCE(CAST(:end_date AS date), CURRENT_DATE),
                       INTERVAL '1 day'
                   )::date AS day
               )
               SELECT
                   days.day::text AS date,
                   COUNT(q.id)::int AS attempt_count,
                   COALESCE(SUM(q.score), 0)::float AS total_score,
                   COUNT(q.id) FILTER (WHERE q.status = 'correct')::int AS correct_count,
                   COUNT(q.id) FILTER (WHERE q.status = 'partial')::int AS partial_count,
                   COUNT(q.id) FILTER (WHERE q.status = 'incorrect')::int AS incorrect_count
               FROM days
               LEFT JOIN quiz_question_results q
                    ON q.user_id = :user_id
                   AND q.created_at::date = days.day
               GROUP BY days.day
               ORDER BY days.day"""
        ),
        params,
    )
    daily_stats = _rows(result)

    attempt_count = int(summary.get("attempt_count") or 0)
    total_score = float(summary.get("total_score") or 0)
    incorrect_count = int(summary.get("incorrect_count") or 0)
    summary["accuracy"] = round(total_score / attempt_count, 3) if attempt_count else 0
    summary["incorrect_rate"] = round(incorrect_count / attempt_count, 3) if attempt_count else 0

    for item in word_stats:
        attempts = int(item.get("attempt_count") or 0)
        item["accuracy"] = round(float(item.get("total_score") or 0) / attempts, 3) if attempts else 0
        item["incorrect_rate"] = round(int(item.get("incorrect_count") or 0) / attempts, 3) if attempts else 0

    for item in type_stats:
        attempts = int(item.get("attempt_count") or 0)
        item["accuracy"] = round(float(item.get("total_score") or 0) / attempts, 3) if attempts else 0
        item["incorrect_rate"] = round(int(item.get("incorrect_count") or 0) / attempts, 3) if attempts else 0

    for item in daily_stats:
        attempts = int(item.get("attempt_count") or 0)
        item["accuracy"] = round(float(item.get("total_score") or 0) / attempts, 3) if attempts else 0

    return {
        "range": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
        },
        "summary": summary,
        "word_stats": word_stats,
        "type_stats": type_stats,
        "recent_incorrect": recent_incorrect,
        "recent_sessions": recent_sessions,
        "daily_stats": daily_stats,
    }


def _json_payload(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []
    return []


def _choice_text_by_id(choices: list[dict[str, Any]], choice_id: str) -> str:
    for choice in choices:
        if (choice.get("id") or "") == choice_id:
            return choice.get("text") or ""
    return ""


def _public_stored_question(raw: dict[str, Any], fallback: dict[str, Any], index: int) -> dict[str, Any]:
    choices = [
        {"id": choice.get("id") or "", "text": choice.get("text") or ""}
        for choice in (raw.get("choices") or [])
        if isinstance(choice, dict)
    ]
    question_id = raw.get("id") or fallback.get("question_id") or f"q{index + 1}"
    source_word_id = raw.get("source_word_id") or raw.get("word_id") or fallback.get("source_word_id") or fallback.get("word_id")
    return {
        "id": question_id,
        "word_id": int(raw.get("word_id") or fallback.get("word_id") or source_word_id or 0),
        "word": raw.get("source_word") or fallback.get("source_word") or "",
        "source_word_id": source_word_id,
        "source_word": raw.get("source_word") or fallback.get("source_word") or "",
        "target_word": raw.get("target_word") or fallback.get("target_word") or "",
        "question_type": raw.get("question_type") or fallback.get("question_type") or "meaning_choice",
        "difficulty": raw.get("difficulty") or fallback.get("difficulty") or "easy",
        "prompt": raw.get("prompt") or fallback.get("prompt") or "",
        "passage": raw.get("passage") or "",
        "choices": choices,
        "answer_format": raw.get("answer_format") or ("choice" if choices else "text"),
        "is_derived": bool(raw.get("is_derived") or fallback.get("is_derived")),
        "is_related": bool(raw.get("is_related")),
        "relation_type": raw.get("relation_type") or "",
        "derived_from_word_id": raw.get("derived_from_word_id") or fallback.get("derived_from_word_id"),
    }


def _stored_result(row: dict[str, Any], question: dict[str, Any]) -> dict[str, Any]:
    choices = question.get("choices") or []
    selected_choice_id = row.get("selected_choice_id") or ""
    if not selected_choice_id and choices:
        user_answer = row.get("user_answer") or ""
        selected_choice_id = next(
            (choice.get("id") for choice in choices if choice.get("text") == user_answer),
            "",
        )
    correct_choice_id = row.get("correct_choice_id") or question.get("correct_choice_id") or ""
    correct_text = row.get("correct_answer") or _choice_text_by_id(choices, correct_choice_id)
    return {
        "question_id": question["id"],
        "word_id": question.get("word_id") or row.get("word_id") or 0,
        "word": question.get("source_word") or row.get("source_word") or "",
        "source_word_id": question.get("source_word_id") or row.get("source_word_id"),
        "source_word": question.get("source_word") or row.get("source_word") or "",
        "target_word": question.get("target_word") or row.get("target_word") or "",
        "question_type": question.get("question_type") or row.get("question_type") or "",
        "difficulty": question.get("difficulty") or row.get("difficulty") or "",
        "prompt": question.get("prompt") or row.get("prompt") or "",
        "selected_choice_id": selected_choice_id,
        "selected_text": _choice_text_by_id(choices, selected_choice_id),
        "text_answer": "" if selected_choice_id else (row.get("user_answer") or ""),
        "correct_choice_id": correct_choice_id,
        "correct_text": correct_text,
        "acceptable_answers": question.get("acceptable_answers") or [],
        "status": row.get("status") or "incorrect",
        "correct": bool(row.get("correct")),
        "score": float(row.get("score") or 0),
        "confidence": float(row.get("confidence") or 1),
        "explanation": row.get("feedback") or question.get("explanation") or "",
        "answer_explanation": question.get("answer_explanation") or question.get("explanation") or "",
        "choice_explanations": question.get("choice_explanations") or {},
        "study_note": question.get("study_note") or "",
        "is_derived": bool(row.get("is_derived") or question.get("is_derived")),
        "is_related": bool(question.get("is_related")),
        "relation_type": question.get("relation_type") or "",
        "derived_from_word_id": row.get("derived_from_word_id") or question.get("derived_from_word_id"),
        "suggested_word": row.get("suggested_word") or "",
        "suggested_korean": row.get("suggested_korean") or "",
        "suggested_english_def": row.get("suggested_english_def") or "",
        "suggested_example": row.get("suggested_example") or "",
        "suggested_tag": row.get("suggested_tag") or "미지정",
        "can_add_to_wordbook": False,
    }


async def get_quiz_session_detail(session: AsyncSession, user_id: str, session_id: int) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            """SELECT
                   id, mode, tag, question_count, total_questions,
                   COALESCE(score, 0)::float AS score,
                   created_at, completed_at, review_applied_at,
                   COALESCE(questions_json, '[]'::jsonb) AS questions_json
               FROM quiz_sessions
               WHERE id = :session_id AND user_id = :user_id"""
        ),
        {"session_id": session_id, "user_id": user_id},
    )
    session_row = dict(result.mappings().first() or {})
    if not session_row:
        return None

    result = await session.execute(
        text(
            """SELECT
                   id, question_id, word_id, source_word_id, source_word,
                   target_word, question_type, difficulty, prompt, user_answer,
                   correct_answer, selected_choice_id, correct_choice_id,
                   status, correct, COALESCE(score, 0)::float AS score,
                   COALESCE(confidence, 1)::float AS confidence, feedback,
                   is_derived, derived_from_word_id, suggested_word,
                   suggested_korean, suggested_english_def, suggested_example,
                   suggested_tag, created_at
               FROM quiz_question_results
               WHERE session_id = :session_id AND user_id = :user_id
               ORDER BY id ASC"""
        ),
        {"session_id": session_id, "user_id": user_id},
    )
    rows = _rows(result)
    if not rows:
        return None

    stored_questions = _json_payload(session_row.get("questions_json"))
    questions_by_id = {item.get("id"): item for item in stored_questions if item.get("id")}
    questions = []
    answers: dict[str, dict[str, str]] = {}
    results = []

    for index, row in enumerate(rows):
        raw_question = questions_by_id.get(row.get("question_id")) or (
            stored_questions[index] if index < len(stored_questions) else {}
        )
        question = _public_stored_question(raw_question, row, index)
        result_item = _stored_result(row, {**raw_question, **question})
        questions.append(question)
        results.append(result_item)
        answers[question["id"]] = {
            "choice_id": result_item.get("selected_choice_id") or "",
            "text_answer": result_item.get("text_answer") or "",
        }

    total = int(session_row.get("total_questions") or len(results))
    score = float(session_row.get("score") or sum(float(item.get("score") or 0) for item in results))
    return {
        "session": {
            **session_row,
            "total_questions": total,
            "score": score,
            "questions_json": None,
        },
        "questions": questions,
        "answers": answers,
        "grade_result": {
            "ok": True,
            "session_id": session_id,
            "score": score,
            "total": total,
            "feedback": f"{total}문제 중 {score:.1f}점을 획득했습니다.",
            "type_stats": {},
            "review_schedule_preview": [],
            "review_schedule_applied": bool(session_row.get("review_applied_at")),
            "results": results,
        },
    }


def _review_schedule_preview_from_rows(rows) -> list[dict]:
    buckets: dict[int, dict] = {}
    for row in rows:
        try:
            word_id = int(row["word_id"])
        except (TypeError, ValueError):
            continue
        bucket = buckets.setdefault(
            word_id,
            {"word_id": word_id, "word": "", "score": 0.0, "total": 0},
        )
        if not bucket["word"]:
            bucket["word"] = row.get("source_word") or row.get("target_word") or ""
        bucket["score"] += float(row.get("score") or 0)
        bucket["total"] += 1

    now = datetime.now()
    preview = []
    for bucket in buckets.values():
        average = bucket["score"] / bucket["total"] if bucket["total"] else 0
        if average >= 0.8:
            continue
        days = 1
        preview.append(
            {
                "word_id": bucket["word_id"],
                "word": bucket["word"],
                "result": "incorrect",
                "proposed_next_review": (now + timedelta(days=days)).date().isoformat(),
                "interval_days": days,
            }
        )
    return preview


async def get_quiz_review_schedule_preview(
    session: AsyncSession,
    user_id: str,
    session_id: int,
) -> list[dict]:
    result = await session.execute(
        text(
            """SELECT COALESCE(source_word_id, word_id) AS word_id,
                      source_word, target_word, score
               FROM quiz_question_results
               WHERE user_id = :user_id AND session_id = :session_id
                     AND COALESCE(source_word_id, word_id) IS NOT NULL"""
        ),
        {"user_id": user_id, "session_id": session_id},
    )
    return _review_schedule_preview_from_rows(_rows(result))


def _interval_days(interval_code: str) -> int:
    return {
        "1d": 1,
        "1w": 7,
        "1m": 30,
        "3m": 90,
    }.get((interval_code or "").strip(), 1)


async def apply_quiz_review_schedule(
    session: AsyncSession,
    user_id: str,
    session_id: int,
    incorrect_interval: str = "1d",
) -> dict:
    interval_days = _interval_days(incorrect_interval)
    result = await session.execute(
        text(
            """SELECT id, review_applied_at
               FROM quiz_sessions
               WHERE id = :session_id AND user_id = :user_id
               FOR UPDATE"""
        ),
        {"session_id": session_id, "user_id": user_id},
    )
    quiz_session = result.mappings().first()
    if not quiz_session:
        return {
            "ok": False,
            "session_id": session_id,
            "updated": 0,
            "already_applied": False,
            "message": "퀴즈 세션을 찾을 수 없습니다.",
            "review_schedule_preview": [],
        }

    result = await session.execute(
        text(
            """SELECT COALESCE(source_word_id, word_id) AS word_id,
                      source_word, target_word, score
               FROM quiz_question_results
               WHERE user_id = :user_id AND session_id = :session_id
                     AND COALESCE(source_word_id, word_id) IS NOT NULL"""
        ),
        {"user_id": user_id, "session_id": session_id},
    )
    preview = _review_schedule_preview_from_rows(_rows(result))
    for item in preview:
        item["interval_days"] = interval_days
        item["proposed_next_review"] = (
            datetime.now() + timedelta(days=interval_days)
        ).date().isoformat()

    if quiz_session["review_applied_at"]:
        return {
            "ok": True,
            "session_id": session_id,
            "updated": 0,
            "already_applied": True,
            "message": "이미 복습일 조정이 적용된 퀴즈입니다.",
            "review_schedule_preview": preview,
        }

    updated = 0
    for item in preview:
        result = await session.execute(
            text(
                """UPDATE words
                   SET next_review = NOW() + (:days * INTERVAL '1 day')
                   WHERE id = :word_id AND user_id = :user_id"""
            ).bindparams(bindparam("days", type_=Integer)),
            {"days": item["interval_days"], "word_id": item["word_id"], "user_id": user_id},
        )
        if result.rowcount:
            updated += result.rowcount
            await session.execute(
                text(
                    """INSERT INTO quiz_history (user_id, word_id, result)
                       VALUES (:user_id, :word_id, :result)"""
                ),
                {
                    "user_id": user_id,
                    "word_id": item["word_id"],
                    "result": item["result"] == "correct",
                },
            )
    await session.execute(
        text(
            """UPDATE quiz_sessions
               SET review_applied_at = NOW()
               WHERE id = :session_id AND user_id = :user_id"""
        ),
        {"session_id": session_id, "user_id": user_id},
    )
    await session.commit()
    return {
        "ok": True,
        "session_id": session_id,
        "updated": updated,
        "already_applied": False,
        "message": f"{updated}개 단어의 다음 복습일을 조정했습니다.",
        "review_schedule_preview": preview,
    }

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.repositories.common import (
    FEATURE_LABELS,
    _feature_label,
    _operation_label,
    _rows,
)
from backend.db.session import SessionFactory
from backend.exceptions import SQLALCHEMY_ERRORS
from backend.usage.pricing import estimate_llm_cost_usd

logger = logging.getLogger(__name__)


def _nonnegative_int(value: Any, *, nullable: bool = False) -> int | None:
    if value is None and nullable:
        return None
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return None if nullable else 0


async def record_api_usage_events(
    user_id: str | None,
    events: list[dict[str, Any]],
) -> bool:
    if not user_id or not events:
        return True

    rows = []
    for event in events:
        raw_units = event.get("units")
        rows.append(
            {
                "user_id": user_id,
                "feature": event.get("feature") or "unknown",
                "operation": event.get("operation") or "unknown",
                "provider": event.get("provider") or "",
                "model": event.get("model") or "",
                "units": max(0, int(1 if raw_units is None else raw_units)),
                "input_chars": max(0, int(event.get("input_chars") or 0)),
                "output_chars": max(0, int(event.get("output_chars") or 0)),
                "input_tokens": _nonnegative_int(event.get("input_tokens"), nullable=True),
                "output_tokens": _nonnegative_int(event.get("output_tokens"), nullable=True),
                "total_tokens": _nonnegative_int(event.get("total_tokens"), nullable=True),
                "usage_group_id": (str(event.get("usage_group_id") or "").strip()[:200] or None),
                "success": bool(event.get("success", True)),
                "error_message": event.get("error_message") or "",
            }
        )

    try:
        async with SessionFactory.begin() as session:
            await session.execute(
                text(
                    """INSERT INTO api_usage_events
                           (user_id, feature, operation, provider, model, units,
                           input_chars, output_chars, input_tokens, output_tokens,
                            total_tokens, usage_group_id, success, error_message)
                       VALUES
                           (:user_id, :feature, :operation, :provider, :model, :units,
                            :input_chars, :output_chars, :input_tokens, :output_tokens,
                            :total_tokens, :usage_group_id, :success, :error_message)
                       ON CONFLICT DO NOTHING"""
                ),
                rows,
            )
        return True
    except SQLALCHEMY_ERRORS as exc:
        logger.warning("Failed to record API usage events: %s", exc)
        return False


async def get_admin_api_usage(
    session: AsyncSession,
    date_value,
    group_by: str = "hour",
    range_key: str = "day",
    start_date_value=None,
    end_date_value=None,
) -> dict:
    """Admin aggregate for the usage/cost screen.

    Costs use the shared token pricing profiles in backend.usage.pricing.
    They are returned as estimated_cost_usd because provider invoices remain
    the final billing source.
    """
    range_key = (range_key or "day").strip().lower()
    if range_key not in {"day", "week", "month", "year", "custom"}:
        range_key = "day"
    requested_date = date_value
    if start_date_value and end_date_value:
        start_date = min(start_date_value, end_date_value)
        inclusive_end_date = max(start_date_value, end_date_value)
        end_date = inclusive_end_date + timedelta(days=1)
        range_key = "custom"
    else:
        range_days = {
            "day": 1,
            "week": 7,
            "month": 30,
            "year": 365,
            "custom": 1,
        }[range_key]
        end_date = date_value + timedelta(days=1)
        start_date = end_date - timedelta(days=range_days)
        inclusive_end_date = date_value

    span_days = max(1, (end_date - start_date).days)
    default_group_unit = "hour" if span_days <= 1 else "month" if span_days > 120 else "day"
    group_unit = group_by if group_by in {"hour", "day", "month"} else default_group_unit
    if span_days > 1 and group_unit == "hour":
        group_unit = default_group_unit
    date_result = await session.execute(
        text(
            """SELECT COUNT(*)::int AS requested_count,
                      MAX(created_at)::date AS latest_date
               FROM api_usage_events
               WHERE created_at >= CAST(:start_date AS date)
                 AND created_at < CAST(:end_date AS date)"""
        ),
        {"start_date": start_date, "end_date": end_date},
    )
    date_info = dict(date_result.mappings().first() or {})
    requested_count = int(date_info.get("requested_count") or 0)
    latest_date = date_info.get("latest_date")
    if requested_count == 0 and range_key == "day" and not start_date_value and not end_date_value:
        latest_result = await session.execute(
            text("SELECT MAX(created_at)::date AS latest_date FROM api_usage_events")
        )
        latest_date = (latest_result.mappings().first() or {}).get("latest_date")
        if latest_date:
            date_value = latest_date
            end_date = date_value + timedelta(days=1)
            start_date = date_value
            inclusive_end_date = date_value

    result = await session.execute(
        text(
            f"""SELECT to_char(date_trunc('{group_unit}', created_at), 'YYYY-MM-DD HH24:MI') AS bucket,
                      feature,
                      COALESCE(SUM(units), 0)::int AS request_count,
                      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
                      COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                      COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                      COALESCE(SUM(input_chars), 0)::int AS input_chars,
                      COALESCE(SUM(output_chars), 0)::int AS output_chars,
                      COALESCE(SUM(CASE WHEN success THEN 0 ELSE units END), 0)::int AS failed_count
               FROM api_usage_events
               WHERE created_at >= CAST(:start_date AS date)
                 AND created_at < CAST(:end_date AS date)
               GROUP BY bucket, feature
               ORDER BY bucket ASC, feature ASC"""
        ),
        {"start_date": start_date, "end_date": end_date},
    )
    hourly = [
        {**item, "label": _feature_label(item.get("feature") or "")}
        for item in _rows(result)
    ]

    result = await session.execute(
        text(
            """SELECT feature, operation, provider, model,
                      (
                          COUNT(DISTINCT usage_group_id)
                              FILTER (WHERE usage_group_id IS NOT NULL)
                          + COALESCE(SUM(units) FILTER (WHERE usage_group_id IS NULL), 0)
                      )::int AS request_count,
                      COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                      COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
                      COALESCE(SUM(input_chars), 0)::int AS input_chars,
                      COALESCE(SUM(output_chars), 0)::int AS output_chars,
                      (
                          COUNT(DISTINCT usage_group_id)
                              FILTER (WHERE usage_group_id IS NOT NULL AND success = FALSE)
                          + COALESCE(
                              SUM(units) FILTER (
                                  WHERE usage_group_id IS NULL AND success = FALSE
                              ),
                              0
                          )
                      )::int AS failed_count,
                      MAX(created_at) AS last_used_at
               FROM api_usage_events
               WHERE created_at >= CAST(:start_date AS date)
                 AND created_at < CAST(:end_date AS date)
               GROUP BY feature, operation, provider, model
               ORDER BY request_count DESC, last_used_at DESC"""
        ),
        {"start_date": start_date, "end_date": end_date},
    )
    usage_rows = []
    for item in _rows(result):
        request_count = int(item.get("request_count") or 0)
        failed_count = int(item.get("failed_count") or 0)
        estimated_cost = estimate_llm_cost_usd(item)
        usage_rows.append({
            **item,
            "label": _operation_label(item.get("feature") or "", item.get("operation") or ""),
            "failure_rate": round(failed_count / request_count, 4) if request_count else 0,
            "estimated_cost_usd": estimated_cost,
        })

    result = await session.execute(
        text(
            """SELECT COALESCE(NULLIF(provider, ''), 'internal') AS provider,
                      COALESCE(SUM(units), 0)::int AS request_count,
                      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
                      COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                      COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                      COALESCE(SUM(CASE WHEN success THEN 0 ELSE units END), 0)::int AS failed_count
               FROM api_usage_events
               WHERE created_at >= CAST(:start_date AS date)
                 AND created_at < CAST(:end_date AS date)
               GROUP BY COALESCE(NULLIF(provider, ''), 'internal')
               ORDER BY request_count DESC"""
        ),
        {"start_date": start_date, "end_date": end_date},
    )
    providers = []
    for item in _rows(result):
        provider_key = item.get("provider")
        provider_cost = sum(
            float(row.get("estimated_cost_usd") or 0)
            for row in usage_rows
            if (row.get("provider") or "internal") == provider_key
        )
        providers.append({
            **item,
            "estimated_cost_usd": round(provider_cost, 6),
        })

    result = await session.execute(
        text(
            """SELECT feature, operation, provider, model,
                      COALESCE(SUM(units), 0)::int AS request_count,
                      COALESCE(SUM(CASE WHEN success THEN 0 ELSE units END), 0)::int AS failed_count,
                      MAX(created_at) AS last_seen_at,
                      (array_remove(array_agg(NULLIF(error_message, '') ORDER BY created_at DESC), NULL))[1]
                          AS error_message
               FROM api_usage_events
               WHERE created_at >= CAST(:start_date AS date)
                 AND created_at < CAST(:end_date AS date)
                 AND success = FALSE
               GROUP BY feature, operation, provider, model
               ORDER BY failed_count DESC, request_count DESC
               LIMIT 8"""
        ),
        {"start_date": start_date, "end_date": end_date},
    )
    anomalies = [
        {
            **item,
            "label": _operation_label(item.get("feature") or "", item.get("operation") or ""),
            "severity": "주의",
        }
        for item in _rows(result)
    ]

    return {
        "date": str(date_value),
        "requested_date": str(requested_date),
        "range": range_key,
        "start_date": str(start_date),
        "end_date": str(end_date),
        "end_date_inclusive": str(inclusive_end_date),
        "used_latest_available": requested_count == 0 and bool(latest_date),
        "group_by": group_unit,
        "hourly": hourly,
        "rows": usage_rows,
        "providers": providers,
        "anomalies": anomalies,
        "summary": {
            "request_count": sum(int(item.get("request_count") or 0) for item in hourly),
            "failed_count": sum(int(item.get("failed_count") or 0) for item in hourly),
            "estimated_cost_usd": round(sum(float(item.get("estimated_cost_usd") or 0) for item in usage_rows), 4),
        },
    }


async def list_admin_learners(
    session: AsyncSession,
    q: str = "",
    status: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict:
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 20), 100))
    q = (q or "").strip()
    status = (status or "").strip()

    clauses = ["TRUE"]
    params: dict[str, Any] = {"limit": page_size, "offset": (page - 1) * page_size}
    if q:
        clauses.append("u.email ILIKE :q")
        params["q"] = f"%{q}%"
    if status == "review_overdue":
        clauses.append("COALESCE(u.due_review_count, 0) > 0")
    elif status == "quiz_down":
        clauses.append("COALESCE(u.latest_quiz_score, 100) < 70")
    elif status == "roleplay_inactive":
        clauses.append("COALESCE(u.roleplay_turns, 0) = 0")
    elif status == "new":
        clauses.append("u.first_seen_at >= NOW() - INTERVAL '7 days'")

    where_sql = " AND ".join(clauses)
    base_sql = """
        WITH word_stats AS (
            SELECT user_id,
                   COUNT(*)::int AS word_count,
                   COUNT(*) FILTER (WHERE next_review <= NOW())::int AS due_review_count,
                   COUNT(*) FILTER (WHERE next_review <= NOW() - INTERVAL '1 day')::int AS overdue_review_count
            FROM words
            GROUP BY user_id
        ),
        label_stats AS (
            SELECT user_id, COUNT(*)::int AS tag_count
            FROM labels
            GROUP BY user_id
        ),
        quiz_stats AS (
            SELECT user_id,
                   COUNT(*)::int AS quiz_attempts,
                   ROUND(AVG(score)::numeric, 1) AS avg_quiz_score,
                   (array_agg(score ORDER BY completed_at DESC NULLS LAST, created_at DESC))[1] AS latest_quiz_score,
                   MAX(COALESCE(completed_at, created_at)) AS last_quiz_at
            FROM quiz_sessions
            GROUP BY user_id
        ),
        roleplay_stats AS (
            SELECT user_id,
                   COUNT(*)::int AS roleplay_sessions,
                   COALESCE(SUM(turns), 0)::int AS roleplay_turns,
                   MAX(created_at) AS last_roleplay_at
            FROM roleplay_sessions
            GROUP BY user_id
        ),
        article_stats AS (
            SELECT user_id,
                   COUNT(*)::int AS article_sessions,
                   COUNT(*) FILTER (WHERE status = 'completed')::int AS article_completed,
                   MAX(updated_at) AS last_article_at
            FROM article_sessions
            GROUP BY user_id
        ),
        usage_stats AS (
            SELECT user_id,
                   COALESCE(SUM(units), 0)::int AS total_api_calls,
                   COALESCE(SUM(units) FILTER (WHERE created_at::date = CURRENT_DATE), 0)::int AS today_api_calls,
                   COALESCE(SUM(units) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::int AS week_api_calls,
                   MAX(created_at) AS last_api_at
            FROM api_usage_events
            GROUP BY user_id
        ),
        activity_points AS (
            SELECT user_id, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
            FROM words
            GROUP BY user_id
            UNION ALL
            SELECT user_id, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
            FROM api_usage_events
            GROUP BY user_id
            UNION ALL
            SELECT user_id, MIN(created_at) AS first_seen_at, MAX(COALESCE(completed_at, created_at)) AS last_seen_at
            FROM quiz_sessions
            GROUP BY user_id
            UNION ALL
            SELECT user_id, MIN(created_at) AS first_seen_at, MAX(created_at) AS last_seen_at
            FROM roleplay_sessions
            GROUP BY user_id
            UNION ALL
            SELECT user_id, MIN(created_at) AS first_seen_at, MAX(updated_at) AS last_seen_at
            FROM article_sessions
            GROUP BY user_id
        ),
        activity AS (
            SELECT user_id,
                   MIN(first_seen_at) AS first_seen_at,
                   MAX(last_seen_at) AS last_seen_at
            FROM activity_points
            GROUP BY user_id
        ),
        learner_rows AS (
            SELECT u.id AS internal_user_id,
                   md5(CAST(u.id AS text)) AS learner_ref,
                   u.email, u.is_active, u.is_superuser,
                   activity.first_seen_at, NULLIF(activity.last_seen_at, TIMESTAMP 'epoch') AS last_seen_at,
                   COALESCE(w.word_count, 0)::int AS word_count,
                   COALESCE(w.due_review_count, 0)::int AS due_review_count,
                   COALESCE(w.overdue_review_count, 0)::int AS overdue_review_count,
                   COALESCE(l.tag_count, 0)::int AS tag_count,
                   COALESCE(qz.quiz_attempts, 0)::int AS quiz_attempts,
                   COALESCE(qz.avg_quiz_score, 0)::float AS avg_quiz_score,
                   COALESCE(qz.latest_quiz_score, 0)::float AS latest_quiz_score,
                   qz.last_quiz_at,
                   COALESCE(rp.roleplay_sessions, 0)::int AS roleplay_sessions,
                   COALESCE(rp.roleplay_turns, 0)::int AS roleplay_turns,
                   rp.last_roleplay_at,
                   COALESCE(ar.article_sessions, 0)::int AS article_sessions,
                   COALESCE(ar.article_completed, 0)::int AS article_completed,
                   ar.last_article_at,
                   COALESCE(us.total_api_calls, 0)::int AS total_api_calls,
                   COALESCE(us.today_api_calls, 0)::int AS today_api_calls,
                   COALESCE(us.week_api_calls, 0)::int AS week_api_calls,
                   us.last_api_at
            FROM users u
            LEFT JOIN word_stats w ON w.user_id = u.id
            LEFT JOIN label_stats l ON l.user_id = u.id
            LEFT JOIN quiz_stats qz ON qz.user_id = u.id
            LEFT JOIN roleplay_stats rp ON rp.user_id = u.id
            LEFT JOIN article_stats ar ON ar.user_id = u.id
            LEFT JOIN usage_stats us ON us.user_id = u.id
            LEFT JOIN activity ON activity.user_id = u.id
        )
    """
    result = await session.execute(
        text(
            base_sql
            + f"""SELECT learner_ref, email, is_active, is_superuser,
                         first_seen_at, last_seen_at,
                         word_count, due_review_count, overdue_review_count, tag_count,
                         quiz_attempts, avg_quiz_score, latest_quiz_score, last_quiz_at,
                         roleplay_sessions, roleplay_turns, last_roleplay_at,
                         article_sessions, article_completed, last_article_at,
                         total_api_calls, today_api_calls, week_api_calls, last_api_at
                  FROM learner_rows u
                  WHERE {where_sql}
                  ORDER BY last_seen_at DESC NULLS LAST, email ASC
                  LIMIT :limit OFFSET :offset"""
        ),
        params,
    )
    learners = _rows(result)
    count_result = await session.execute(
        text(base_sql + f"SELECT COUNT(*)::int FROM learner_rows u WHERE {where_sql}"),
        {k: v for k, v in params.items() if k not in {"limit", "offset"}},
    )
    summary_result = await session.execute(
        text(
            base_sql
            + """SELECT COUNT(*)::int AS total_count,
                        COUNT(*) FILTER (WHERE COALESCE(due_review_count, 0) > 0)::int AS review_overdue_count,
                        COUNT(*) FILTER (WHERE COALESCE(latest_quiz_score, 100) < 70)::int AS quiz_down_count,
                        COUNT(*) FILTER (WHERE COALESCE(roleplay_turns, 0) = 0)::int AS roleplay_inactive_count,
                        COUNT(*) FILTER (WHERE first_seen_at >= NOW() - INTERVAL '7 days')::int AS new_count
                 FROM learner_rows"""
        )
    )
    return {
        "learners": learners,
        "page": page,
        "page_size": page_size,
        "total": int(count_result.scalar_one()),
        "summary": dict(summary_result.mappings().first() or {}),
    }


async def get_admin_learner_detail(session: AsyncSession, learner_ref: str) -> dict | None:
    result = await session.execute(
        text(
            """SELECT id, md5(CAST(id AS text)) AS learner_ref, email, is_active, is_superuser
               FROM users
               WHERE md5(CAST(id AS text)) = :learner_ref"""
        ),
        {"learner_ref": (learner_ref or "").strip()},
    )
    user = dict(result.mappings().first() or {})
    if not user:
        return None
    user_uuid = user["id"]
    public_user = {
        "learner_ref": user.get("learner_ref"),
        "email": user.get("email"),
        "is_active": user.get("is_active"),
        "is_superuser": user.get("is_superuser"),
    }

    result = await session.execute(
        text(
            """SELECT tag, COUNT(*)::int AS count,
                      COUNT(*) FILTER (WHERE next_review <= NOW())::int AS due_count
               FROM words
               WHERE user_id = :user_id
               GROUP BY tag
               ORDER BY count DESC, tag ASC"""
        ),
        {"user_id": user_uuid},
    )
    tags = _rows(result)

    result = await session.execute(
        text(
            """SELECT '단어 저장' AS type, word AS title, tag AS detail, created_at
               FROM words
               WHERE user_id = :user_id
               UNION ALL
               SELECT '퀴즈 완료' AS type, mode AS title, CONCAT(score, '점') AS detail,
                      COALESCE(completed_at, created_at) AS created_at
               FROM quiz_sessions
               WHERE user_id = :user_id
               UNION ALL
               SELECT '롤플레잉 요약' AS type, COALESCE(title, scenario) AS title,
                      CONCAT(turns, '턴') AS detail, created_at
               FROM roleplay_sessions
               WHERE user_id = :user_id
               UNION ALL
               SELECT '뉴스 리딩' AS type, a.title AS title, s.status AS detail, s.updated_at AS created_at
               FROM article_sessions s
               JOIN articles a ON a.id = s.article_id
               WHERE s.user_id = :user_id
               UNION ALL
               SELECT _operation_label AS type, operation AS title,
                      COALESCE(provider, feature) AS detail, created_at
               FROM (
                   SELECT feature, operation, provider, created_at,
                          feature AS _operation_label
                   FROM api_usage_events
                   WHERE user_id = :user_id
               ) usage_events
               ORDER BY created_at DESC
               LIMIT 20"""
        ),
        {"user_id": user_uuid},
    )
    events = [
        {
            **item,
            "type": _operation_label(item.get("type") or "", item.get("title") or "")
            if item.get("type") in FEATURE_LABELS
            else item.get("type"),
        }
        for item in _rows(result)
    ]

    result = await session.execute(
        text(
            """SELECT id, mode, tag, question_count, total_questions, score,
                      created_at, completed_at
               FROM quiz_sessions
               WHERE user_id = :user_id
               ORDER BY COALESCE(completed_at, created_at) DESC
               LIMIT 5"""
        ),
        {"user_id": user_uuid},
    )
    quizzes = _rows(result)

    result = await session.execute(
        text(
            """SELECT id, level, scenario, tag, title, turns, summary, created_at
               FROM roleplay_sessions
               WHERE user_id = :user_id
               ORDER BY created_at DESC
               LIMIT 5"""
        ),
        {"user_id": user_uuid},
    )
    roleplays = _rows(result)

    result = await session.execute(
        text(
            """SELECT s.id, s.status, s.created_at, s.updated_at,
                      a.title, a.source, a.topic, a.level
               FROM article_sessions s
               JOIN articles a ON a.id = s.article_id
               WHERE s.user_id = :user_id
               ORDER BY s.updated_at DESC
               LIMIT 5"""
        ),
        {"user_id": user_uuid},
    )
    articles = _rows(result)

    result = await session.execute(
        text(
            """SELECT
                   COALESCE(SUM(units) FILTER (WHERE created_at::date = CURRENT_DATE), 0)::int AS today_count,
                   COALESCE(SUM(units) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::int AS week_count,
                   COALESCE(SUM(units) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::int AS month_count,
                   MAX(created_at) AS last_used_at
               FROM api_usage_events
               WHERE user_id = :user_id"""
        ),
        {"user_id": user_uuid},
    )
    api_usage_summary = dict(result.mappings().first() or {})

    result = await session.execute(
        text(
            """SELECT feature,
                      COALESCE(SUM(units), 0)::int AS request_count,
                      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
                      MAX(created_at) AS last_used_at
               FROM api_usage_events
               WHERE user_id = :user_id
                 AND created_at >= NOW() - INTERVAL '30 days'
               GROUP BY feature
               ORDER BY request_count DESC, last_used_at DESC"""
        ),
        {"user_id": user_uuid},
    )
    api_usage_by_feature = [
        {**item, "label": _feature_label(item.get("feature") or "")}
        for item in _rows(result)
    ]

    return {
        "user": public_user,
        "tags": tags,
        "events": events,
        "quizzes": quizzes,
        "roleplays": roleplays,
        "articles": articles,
        "api_usage": {
            "summary": {
                "today_count": int(api_usage_summary.get("today_count") or 0),
                "week_count": int(api_usage_summary.get("week_count") or 0),
                "month_count": int(api_usage_summary.get("month_count") or 0),
                "last_used_at": api_usage_summary.get("last_used_at"),
            },
            "by_feature": api_usage_by_feature,
        },
    }

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.models import OAuthAccount, User
from backend.db.models import Word
from backend.db.repositories.common import _feature_label, _operation_label, _rows, _uuid
from backend.db.repositories.labels import get_labels
from backend.db.repositories.quiz import get_quiz_stats


async def get_activity_summary(session: AsyncSession, user_id: str) -> dict:
    result = await session.execute(
        text(
            """SELECT
                   COALESCE(SUM(units) FILTER (WHERE created_at::date = CURRENT_DATE), 0)::int
                       AS today_count,
                   COALESCE(SUM(units) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)::int
                       AS week_count,
                   COALESCE(SUM(units) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::int
                       AS month_count,
                   MAX(created_at) AS last_used_at
               FROM api_usage_events
               WHERE user_id = :user_id"""
        ),
        {"user_id": user_id},
    )
    summary = dict(result.mappings().first() or {})

    result = await session.execute(
        text(
            """SELECT feature,
                      COUNT(*)::int AS count,
                      COALESCE(SUM(units), 0)::int AS total_count,
                      MAX(created_at) AS last_used_at
               FROM api_usage_events
               WHERE user_id = :user_id
                     AND created_at >= NOW() - INTERVAL '30 days'
               GROUP BY feature
               ORDER BY total_count DESC, last_used_at DESC"""
        ),
        {"user_id": user_id},
    )
    by_feature = [
        {**item, "label": _feature_label(item.get("feature") or "")}
        for item in _rows(result)
    ]

    result = await session.execute(
        text(
            """SELECT feature, operation, units AS count, created_at
               FROM api_usage_events
               WHERE user_id = :user_id
               ORDER BY created_at DESC, id DESC
               LIMIT 10"""
        ),
        {"user_id": user_id},
    )

    return {
        "summary": {
            "today_count": int(summary.get("today_count") or 0),
            "week_count": int(summary.get("week_count") or 0),
            "month_count": int(summary.get("month_count") or 0),
            "last_used_at": summary.get("last_used_at"),
        },
        "by_feature": by_feature,
        "recent": [
            {
                **item,
                "label": _operation_label(
                    item.get("feature") or "",
                    item.get("operation") or "",
                ),
            }
            for item in _rows(result)
        ],
    }


async def get_account_status(session: AsyncSession, user_id: str) -> dict:
    user_uuid = _uuid(user_id)
    user_result = await session.execute(
        select(
            User.email,
            User.hashed_password,
            User.is_active,
            User.is_verified,
            User.buddy_icon,
        ).where(User.id == user_uuid)
    )
    user = dict(user_result.mappings().first() or {})
    has_password = bool((user.get("hashed_password") or "").strip())

    oauth_result = await session.execute(
        select(
            OAuthAccount.oauth_name,
            OAuthAccount.account_email,
        )
        .where(OAuthAccount.user_id == user_uuid)
        .order_by(OAuthAccount.oauth_name.asc(), OAuthAccount.account_email.asc())
    )
    oauth_accounts = [
        {
            "provider": item.get("oauth_name") or "unknown",
            "email": item.get("account_email") or "",
            "connected": True,
        }
        for item in _rows(oauth_result)
    ]
    providers = {item["provider"] for item in oauth_accounts}
    login_methods = []
    if has_password:
        login_methods.append("password")
    login_methods.extend(sorted(providers))

    google_connected = "google" in providers
    return {
        "email": user.get("email") or "",
        "is_active": bool(user.get("is_active", True)),
        "is_verified": bool(user.get("is_verified", False)),
        "buddy_icon": user.get("buddy_icon") or "cat",
        "has_password": has_password,
        "login_methods": login_methods,
        "oauth_accounts": oauth_accounts,
        "google_connected": google_connected,
        "can_disconnect_google": bool(google_connected and has_password),
    }


async def get_user_password_hash(session: AsyncSession, user_id: str) -> str:
    result = await session.execute(
        select(User.hashed_password).where(User.id == _uuid(user_id))
    )
    return result.scalar_one_or_none() or ""


async def update_user_password_hash(
    session: AsyncSession,
    user_id: str,
    hashed_password: str,
) -> None:
    result = await session.execute(
        update(User)
        .where(User.id == _uuid(user_id))
        .values(hashed_password=hashed_password)
    )
    if result.rowcount != 1:
        await session.rollback()
        raise ValueError("Account not found")
    await session.commit()


async def update_user_buddy_icon(
    session: AsyncSession,
    user_id: str,
    buddy_icon: str,
) -> str:
    clean_icon = (buddy_icon or "cat").strip().lower()
    result = await session.execute(
        update(User)
        .where(User.id == _uuid(user_id))
        .values(buddy_icon=clean_icon)
    )
    if result.rowcount != 1:
        await session.rollback()
        raise ValueError("Account not found")
    await session.commit()
    return clean_icon


async def disconnect_oauth_account(
    session: AsyncSession,
    user_id: str,
    provider: str,
) -> int:
    result = await session.execute(
        delete(OAuthAccount).where(
            OAuthAccount.user_id == _uuid(user_id),
            OAuthAccount.oauth_name == provider,
        )
    )
    await session.commit()
    return int(result.rowcount or 0)


async def get_mypage_overview(session: AsyncSession, user_id: str) -> dict:
    user_uuid = _uuid(user_id)
    result = await session.execute(
        select(
            func.count(Word.id).label("word_count"),
            func.count(Word.id)
            .filter(Word.next_review <= func.now())
            .label("due_review_count"),
        ).where(Word.user_id == user_uuid)
    )
    word_summary = dict(result.mappings().first() or {})

    result = await session.execute(
        text(
            """SELECT
                   COALESCE(SUM(units) FILTER (WHERE created_at::date = CURRENT_DATE), 0)::int
                       AS today_activity_count,
                   COALESCE(SUM(units) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::int
                       AS month_activity_count
               FROM api_usage_events
               WHERE user_id = :user_id"""
        ),
        {"user_id": user_id},
    )
    activity_summary = dict(result.mappings().first() or {})

    result = await session.execute(
        text(
            """SELECT COUNT(*)::int AS roleplay_session_count
               FROM roleplay_sessions
               WHERE user_id = :user_id"""
        ),
        {"user_id": user_id},
    )
    roleplay_summary = dict(result.mappings().first() or {})

    return {
        "word_count": int(word_summary.get("word_count") or 0),
        "due_review_count": int(word_summary.get("due_review_count") or 0),
        "today_activity_count": int(activity_summary.get("today_activity_count") or 0),
        "month_activity_count": int(activity_summary.get("month_activity_count") or 0),
        "roleplay_session_count": int(
            roleplay_summary.get("roleplay_session_count") or 0
        ),
    }


async def get_mypage_learning(session: AsyncSession, user_id: str) -> dict:
    user_uuid = _uuid(user_id)
    result = await session.execute(
        select(
            func.count(Word.id).label("word_count"),
            func.count(Word.id)
            .filter(Word.next_review <= func.now())
            .label("due_review_count"),
        ).where(Word.user_id == user_uuid)
    )
    word_summary = dict(result.mappings().first() or {})

    labels = await get_labels(session, user_id)
    quiz_stats = await get_quiz_stats(session, user_id)
    quiz_summary = quiz_stats.get("summary", {})
    weak_words = [
        item
        for item in quiz_stats.get("word_stats", [])
        if int(item.get("incorrect_count") or 0) > 0
        or float(item.get("accuracy") or 0) < 0.8
    ][:5]
    weak_question_types = [
        item
        for item in quiz_stats.get("type_stats", [])
        if int(item.get("incorrect_count") or 0) > 0
    ][:5]

    result = await session.execute(
        text(
            """SELECT COUNT(*)::int AS roleplay_session_count
               FROM roleplay_sessions
               WHERE user_id = :user_id"""
        ),
        {"user_id": user_id},
    )
    roleplay_summary = dict(result.mappings().first() or {})

    result = await session.execute(
        text(
            """SELECT id, level, scenario, tag, situation, title, turns, summary,
                      expressions, vocab, created_at
               FROM roleplay_sessions
               WHERE user_id = :user_id
               ORDER BY created_at DESC, id DESC
               LIMIT 3"""
        ),
        {"user_id": user_id},
    )

    return {
        "word_count": int(word_summary.get("word_count") or 0),
        "label_count": len(labels),
        "due_review_count": int(word_summary.get("due_review_count") or 0),
        "quiz_attempt_count": int(quiz_summary.get("attempt_count") or 0),
        "quiz_accuracy": float(quiz_summary.get("accuracy") or 0),
        "quiz_incorrect_count": int(quiz_summary.get("incorrect_count") or 0),
        "weak_question_types": weak_question_types,
        "recent_incorrect": quiz_stats.get("recent_incorrect", [])[:5],
        "roleplay_session_count": int(
            roleplay_summary.get("roleplay_session_count") or 0
        ),
        "weak_words": weak_words,
        "recent_roleplay_sessions": _rows(result),
    }

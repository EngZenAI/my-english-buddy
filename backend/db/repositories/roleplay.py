import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.repositories.common import _rows


async def save_roleplay_session(
    session: AsyncSession,
    user_id,
    level,
    scenario,
    tag,
    situation,
    title,
    turns,
    summary,
    expressions,
    vocab,
) -> int:
    result = await session.execute(
        text(
            """INSERT INTO roleplay_sessions
                   (user_id, level, scenario, tag, situation, title, turns,
                    summary, expressions, vocab)
               VALUES (:user_id, :level, :scenario, :tag, :situation, :title, :turns,
                       :summary, CAST(:expressions AS jsonb), CAST(:vocab AS jsonb))
               RETURNING id"""
        ),
        {
            "user_id": user_id,
            "level": level,
            "scenario": scenario,
            "tag": tag,
            "situation": situation,
            "title": title,
            "turns": turns,
            "summary": summary,
            "expressions": json.dumps(expressions or [], ensure_ascii=False),
            "vocab": json.dumps(vocab or [], ensure_ascii=False),
        },
    )
    await session.commit()
    return int(result.scalar_one())


async def get_roleplay_sessions(session: AsyncSession, user_id):
    result = await session.execute(
        text(
            """SELECT id, level, scenario, tag, situation, title, turns, summary,
                      expressions, vocab, created_at
               FROM roleplay_sessions
               WHERE user_id = :user_id
               ORDER BY created_at DESC, id DESC"""
        ),
        {"user_id": user_id},
    )
    return _rows(result)


async def delete_roleplay_session(
    session: AsyncSession,
    user_id,
    session_id,
) -> bool:
    result = await session.execute(
        text(
            """DELETE FROM roleplay_sessions
               WHERE user_id = :user_id AND id = :session_id"""
        ),
        {"user_id": user_id, "session_id": session_id},
    )
    await session.commit()
    return bool(result.rowcount)

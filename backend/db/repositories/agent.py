import json
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_agent_memories(session: AsyncSession, user_id: str) -> dict[str, Any]:
    result = await session.execute(
        text(
            """SELECT key, value_json
               FROM agent_memories
               WHERE user_id = :user_id
               ORDER BY updated_at DESC"""
        ),
        {"user_id": user_id},
    )
    return {row["key"]: row["value_json"] for row in result.mappings().all()}


async def upsert_agent_memory(
    session: AsyncSession,
    user_id: str,
    key: str,
    value: Any,
) -> dict[str, Any]:
    clean_key = (key or "").strip()[:80]
    if not clean_key:
        return {"ok": False, "message": "메모리 key가 비어 있습니다."}
    await session.execute(
        text(
            """INSERT INTO agent_memories (user_id, key, value_json, updated_at)
               VALUES (:user_id, :key, CAST(:value_json AS jsonb), NOW())
               ON CONFLICT (user_id, key)
               DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()"""
        ),
        {
            "user_id": user_id,
            "key": clean_key,
            "value_json": json.dumps(value if value is not None else {}, ensure_ascii=False),
        },
    )
    await session.commit()
    return {"ok": True, "key": clean_key}


async def create_agent_job(
    session: AsyncSession,
    user_id: str,
    job_type: str,
    message: str = "",
    progress_total: int = 0,
) -> str:
    job_id = str(uuid4())
    await session.execute(
        text(
            """INSERT INTO agent_jobs
                  (id, user_id, type, status, progress_current, progress_total, message, result_json)
               VALUES
                  (:id, :user_id, :type, 'queued', 0, :progress_total, :message, '{}'::jsonb)"""
        ),
        {
            "id": job_id,
            "user_id": user_id,
            "type": (job_type or "agent_job").strip()[:80],
            "progress_total": max(0, int(progress_total or 0)),
            "message": message,
        },
    )
    await session.commit()
    return job_id


async def update_agent_job(
    session: AsyncSession,
    user_id: str,
    job_id: str,
    *,
    status: str | None = None,
    progress_current: int | None = None,
    progress_total: int | None = None,
    message: str | None = None,
    result: Any | None = None,
    error: str | None = None,
) -> bool:
    updates = ["updated_at = NOW()"]
    params: dict[str, Any] = {"id": job_id, "user_id": user_id}
    if status is not None:
        updates.append("status = :status")
        params["status"] = status
    if progress_current is not None:
        updates.append("progress_current = :progress_current")
        params["progress_current"] = max(0, int(progress_current))
    if progress_total is not None:
        updates.append("progress_total = :progress_total")
        params["progress_total"] = max(0, int(progress_total))
    if message is not None:
        updates.append("message = :message")
        params["message"] = message
    if result is not None:
        updates.append("result_json = CAST(:result_json AS jsonb)")
        params["result_json"] = json.dumps(result, ensure_ascii=False)
    if error is not None:
        updates.append("error = :error")
        params["error"] = error
    result_obj = await session.execute(
        text(
            f"""UPDATE agent_jobs
                SET {', '.join(updates)}
                WHERE id = :id AND user_id = :user_id"""
        ),
        params,
    )
    await session.commit()
    return bool(result_obj.rowcount)


async def get_agent_job(
    session: AsyncSession,
    user_id: str,
    job_id: str,
) -> dict[str, Any] | None:
    result = await session.execute(
        text(
            """SELECT id, type, status, progress_current, progress_total,
                      message, result_json, error, created_at, updated_at
               FROM agent_jobs
               WHERE id = :id AND user_id = :user_id"""
        ),
        {"id": job_id, "user_id": user_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None

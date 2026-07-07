import json
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.articles.chunking import estimate_tokens, split_article_text
from backend.db.repositories.common import _rows


def _parse_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


async def upsert_article_with_chunks(
    session: AsyncSession,
    article: dict,
    chunks: list[dict],
    extracted_text: str = "",
    extraction_status: str = "",
    publish: bool | None = None,
) -> int:
    """Create/update canonical article metadata and replace its ordered chunks."""
    result = await session.execute(
        text(
            """INSERT INTO articles
                   (source_key, source, title, url, image_url, published_at, topic,
                    level, is_published, description, content_snippet,
                    extracted_text, extraction_status, feed_entry_id, license_status,
                    collection_method, updated_at)
               VALUES (:source_key, :source, :title, :url, :image_url, :published_at, :topic,
                       :level, :is_published, :description,
                       :content_snippet, :extracted_text, :extraction_status,
                       :feed_entry_id, :license_status, :collection_method, NOW())
               ON CONFLICT (url) DO UPDATE SET
                   source_key = EXCLUDED.source_key,
                   source = EXCLUDED.source,
                   title = EXCLUDED.title,
                   image_url = EXCLUDED.image_url,
                   published_at = EXCLUDED.published_at,
                   topic = EXCLUDED.topic,
                   level = EXCLUDED.level,
                   is_published = CASE
                       WHEN :publish_provided THEN EXCLUDED.is_published
                       ELSE articles.is_published
                   END,
                   description = EXCLUDED.description,
                   content_snippet = EXCLUDED.content_snippet,
                   extracted_text = EXCLUDED.extracted_text,
                   extraction_status = EXCLUDED.extraction_status,
                   feed_entry_id = EXCLUDED.feed_entry_id,
                   license_status = EXCLUDED.license_status,
                   collection_method = EXCLUDED.collection_method,
                   updated_at = NOW()
               RETURNING id"""
        ),
        {
            "source_key": (article.get("source_key") or "").strip(),
            "source": (article.get("source") or "").strip(),
            "title": (article.get("title") or "").strip(),
            "url": (article.get("url") or "").strip(),
            "image_url": (article.get("image_url") or "").strip(),
            "published_at": _parse_datetime(article.get("published_at")),
            "topic": (article.get("topic") or "").strip(),
            "level": (article.get("level") or "medium").strip(),
            "is_published": bool(publish) if publish is not None else bool(article.get("is_published")),
            "publish_provided": publish is not None,
            "description": (article.get("description") or "").strip(),
            "content_snippet": (article.get("content") or article.get("content_snippet") or "").strip(),
            "extracted_text": extracted_text or "",
            "extraction_status": extraction_status or "",
            "feed_entry_id": (article.get("feed_entry_id") or "").strip(),
            "license_status": (article.get("license_status") or "pending").strip(),
            "collection_method": (article.get("collection_method") or "manual").strip(),
        },
    )
    article_id = int(result.scalar_one())
    await session.execute(
        text("DELETE FROM article_chunks WHERE article_id = :article_id"),
        {"article_id": article_id},
    )
    if chunks:
        await session.execute(
            text(
                """INSERT INTO article_chunks
                       (article_id, chunk_index, text, token_count)
                   VALUES (:article_id, :chunk_index, :text, :token_count)"""
            ),
            [
                {
                    "article_id": article_id,
                    "chunk_index": int(chunk.get("chunk_index") or idx),
                    "text": chunk.get("text") or "",
                    "token_count": int(chunk.get("token_count") or 0),
                }
                for idx, chunk in enumerate(chunks)
                if (chunk.get("text") or "").strip()
            ],
        )
    await session.commit()
    return article_id


async def list_article_sources(session: AsyncSession) -> list[dict]:
    result = await session.execute(
        text(
            """SELECT key, name, domains, default_topic, fallback_image_url,
                      feed_url, site_url, license_status, is_active
               FROM article_sources
               WHERE is_active = TRUE
               ORDER BY name ASC"""
        )
    )
    return _rows(result)


async def upsert_feed_articles(
    session: AsyncSession,
    entries: list[dict],
    publish: bool = True,
) -> dict:
    saved = skipped = 0
    article_ids: list[int] = []
    for entry in entries:
        lead = (entry.get("content_snippet") or entry.get("description") or "").strip()
        if not lead:
            skipped += 1
            continue
        chunks = [
            {"chunk_index": index, "text": text, "token_count": estimate_tokens(text)}
            for index, text in enumerate(split_article_text(lead, max_chars=700))
        ]
        article_id = await upsert_article_with_chunks(
            session,
            entry,
            chunks,
            extracted_text="",
            extraction_status="rss_lead",
            publish=publish,
        )
        article_ids.append(article_id)
        saved += 1
    return {"saved": saved, "skipped": skipped, "article_ids": article_ids}


async def list_published_articles(
    session: AsyncSession,
    topic: str = "",
    level: str = "",
    q: str = "",
    page: int = 1,
    page_size: int = 12,
) -> dict:
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 12), 30))
    clauses = [
        "is_published = TRUE",
        "LOWER(COALESCE(topic, '')) <> 'opinion'",
        """(
            (collection_method = 'manual' AND license_status = 'approved')
            OR EXISTS (
                SELECT 1 FROM article_sources src
                WHERE src.key = articles.source_key
                  AND src.is_active = TRUE
                  AND src.license_status = 'approved'
            )
        )""",
    ]
    params: dict[str, Any] = {
        "limit": page_size,
        "offset": (page - 1) * page_size,
    }
    if topic:
        clauses.append("topic = :topic")
        params["topic"] = topic
    if level:
        clauses.append("level = :level")
        params["level"] = level
    if q:
        clauses.append("(title ILIKE :q OR description ILIKE :q OR source ILIKE :q)")
        params["q"] = f"%{q}%"
    where_sql = " AND ".join(clauses)
    result = await session.execute(
        text(
            f"""SELECT id, source_key, source, title, url, image_url, published_at,
                      topic, level, description, extraction_status,
                      feed_entry_id, license_status, collection_method, created_at, updated_at
               FROM articles
               WHERE {where_sql}
               ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC
               LIMIT :limit OFFSET :offset"""
        ),
        params,
    )
    rows = _rows(result)
    count_result = await session.execute(
        text(f"SELECT COUNT(*)::int FROM articles WHERE {where_sql}"),
        {k: v for k, v in params.items() if k not in {"limit", "offset"}},
    )
    return {"articles": rows, "page": page, "page_size": page_size, "total": int(count_result.scalar_one())}


async def list_admin_articles(
    session: AsyncSession,
    page: int = 1,
    page_size: int = 30,
    q: str = "",
) -> dict:
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 30), 100))
    clauses = ["LOWER(COALESCE(topic, '')) <> 'opinion'"]
    params: dict[str, Any] = {"limit": page_size, "offset": (page - 1) * page_size}
    if q:
        clauses.append(
            "(title ILIKE :q OR description ILIKE :q OR source ILIKE :q OR url ILIKE :q OR topic ILIKE :q)"
        )
        params["q"] = f"%{q}%"
    where_sql = " AND ".join(clauses)
    result = await session.execute(
        text(
            f"""SELECT id, source_key, source, title, url, image_url, published_at,
                      topic, level, is_published, description,
                      extraction_status, feed_entry_id, license_status, collection_method,
                      created_at, updated_at
               FROM articles
               WHERE {where_sql}
               ORDER BY COALESCE(published_at, updated_at, created_at) DESC, id DESC
               LIMIT :limit OFFSET :offset"""
        ),
        params,
    )
    rows = _rows(result)
    count_result = await session.execute(
        text(f"SELECT COUNT(*)::int FROM articles WHERE {where_sql}"),
        {k: v for k, v in params.items() if k not in {"limit", "offset"}},
    )
    return {
        "articles": rows,
        "page": page,
        "page_size": page_size,
        "total": int(count_result.scalar_one()),
    }


def _iso_or_none(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None and value.utcoffset() == timedelta(0):
            return value.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
        return value.isoformat(timespec="seconds")
    return str(value)


def _article_refresh_job(row) -> dict | None:
    if not row:
        return None
    data = dict(row)
    data["results"] = data.get("results") or []
    for key in ("created_at", "started_at", "finished_at", "updated_at"):
        data[key] = _iso_or_none(data.get(key))
    return data


async def create_article_refresh_job(session: AsyncSession, job: dict) -> dict:
    result = await session.execute(
        text(
            """INSERT INTO article_refresh_jobs
                   (job_id, status, ok, source_key, total_sources, completed_sources,
                    current_source, saved, skipped, results, error, message)
               VALUES
                   (:job_id, :status, :ok, :source_key, :total_sources, :completed_sources,
                    :current_source, :saved, :skipped, CAST(:results AS jsonb), :error, :message)
               RETURNING job_id, status, ok, source_key, total_sources, completed_sources,
                         current_source, saved, skipped, results, error, message,
                         created_at, started_at, finished_at, updated_at"""
        ),
        {
            "job_id": job.get("job_id"),
            "status": job.get("status") or "queued",
            "ok": bool(job.get("ok", False)),
            "source_key": job.get("source_key") or "",
            "total_sources": int(job.get("total_sources") or 0),
            "completed_sources": int(job.get("completed_sources") or 0),
            "current_source": job.get("current_source") or "",
            "saved": int(job.get("saved") or 0),
            "skipped": int(job.get("skipped") or 0),
            "results": json.dumps(job.get("results") or [], ensure_ascii=False),
            "error": job.get("error") or "",
            "message": job.get("message") or "",
        },
    )
    await session.commit()
    return _article_refresh_job(result.mappings().first()) or {}


async def get_article_refresh_job(session: AsyncSession, job_id: str) -> dict | None:
    result = await session.execute(
        text(
            """SELECT job_id, status, ok, source_key, total_sources, completed_sources,
                      current_source, saved, skipped, results, error, message,
                      created_at, started_at, finished_at, updated_at
               FROM article_refresh_jobs
               WHERE job_id = :job_id"""
        ),
        {"job_id": job_id},
    )
    return _article_refresh_job(result.mappings().first())


async def update_article_refresh_job(session: AsyncSession, job_id: str, **values) -> dict | None:
    allowed = {
        "status",
        "ok",
        "source_key",
        "total_sources",
        "completed_sources",
        "current_source",
        "saved",
        "skipped",
        "results",
        "error",
        "message",
        "started_at",
        "finished_at",
    }
    updates = {key: value for key, value in values.items() if key in allowed}
    if not updates:
        return await get_article_refresh_job(session, job_id)

    assignments = []
    params: dict[str, Any] = {"job_id": job_id}
    for key, value in updates.items():
        if key == "results":
            assignments.append("results = CAST(:results AS jsonb)")
            params[key] = json.dumps(value or [], ensure_ascii=False)
        elif key in {"started_at", "finished_at"}:
            assignments.append(f"{key} = NOW()")
        else:
            assignments.append(f"{key} = :{key}")
            params[key] = value
    assignments.append("updated_at = NOW()")

    result = await session.execute(
        text(
            f"""UPDATE article_refresh_jobs
                SET {', '.join(assignments)}
                WHERE job_id = :job_id
                RETURNING job_id, status, ok, source_key, total_sources, completed_sources,
                          current_source, saved, skipped, results, error, message,
                          created_at, started_at, finished_at, updated_at"""
        ),
        params,
    )
    await session.commit()
    return _article_refresh_job(result.mappings().first())


async def trim_article_refresh_jobs(session: AsyncSession, keep_count: int) -> None:
    await session.execute(
        text(
            """WITH removable AS (
                   SELECT job_id
                   FROM article_refresh_jobs
                   WHERE status IN ('completed', 'failed')
                   ORDER BY created_at DESC, job_id DESC
                   OFFSET :keep_count
               )
               DELETE FROM article_refresh_jobs
               WHERE job_id IN (SELECT job_id FROM removable)"""
        ),
        {"keep_count": max(0, int(keep_count or 0))},
    )
    await session.commit()


async def get_article_catalog_item(
    session: AsyncSession,
    article_id: int,
    include_unpublished: bool = False,
) -> dict | None:
    clauses = ["id = :article_id"]
    if not include_unpublished:
        clauses.append("is_published = TRUE")
        clauses.append("LOWER(COALESCE(topic, '')) <> 'opinion'")
        clauses.append(
            """(
                (collection_method = 'manual' AND license_status = 'approved')
                OR EXISTS (
                    SELECT 1 FROM article_sources src
                    WHERE src.key = articles.source_key
                      AND src.is_active = TRUE
                      AND src.license_status = 'approved'
                )
            )"""
        )
    result = await session.execute(
        text(
            f"""SELECT id, source_key, source, title, url, image_url, published_at,
                      topic, level, is_published, description,
                      content_snippet, extraction_status, feed_entry_id, license_status,
                      collection_method, created_at, updated_at
               FROM articles
               WHERE {' AND '.join(clauses)}"""
        ),
        {"article_id": article_id},
    )
    row = result.mappings().first()
    if not row:
        return None
    data = dict(row)
    data["chunks"] = await get_article_chunks(session, article_id)
    return data


async def update_admin_article(
    session: AsyncSession,
    article_id: int,
    article: dict,
    content: str,
) -> bool:
    content = (content or "").strip()
    result = await session.execute(
        text(
            """UPDATE articles
               SET source_key = :source_key,
                   source = :source,
                   title = :title,
                   url = :url,
                   image_url = :image_url,
                   topic = :topic,
                   level = :level,
                   description = :description,
                   content_snippet = :content_snippet,
                   extracted_text = :extracted_text,
                   extraction_status = 'manual',
                   license_status = 'approved',
                   collection_method = 'manual',
                   is_published = :is_published,
                   updated_at = NOW()
               WHERE id = :article_id"""
        ),
        {
            "article_id": int(article_id),
            "source_key": (article.get("source_key") or "").strip(),
            "source": (article.get("source") or "").strip(),
            "title": (article.get("title") or "").strip(),
            "url": (article.get("url") or "").strip(),
            "image_url": (article.get("image_url") or "").strip(),
            "topic": (article.get("topic") or "General").strip(),
            "level": (article.get("level") or "B1").strip(),
            "description": (article.get("description") or content[:280]).strip(),
            "content_snippet": content[:700],
            "extracted_text": content,
            "is_published": bool(article.get("is_published")),
        },
    )
    if not result.rowcount:
        await session.rollback()
        return False
    chunk_rows = [
        {
            "article_id": int(article_id),
            "chunk_index": index,
            "text": chunk_text,
            "token_count": estimate_tokens(chunk_text),
        }
        for index, chunk_text in enumerate(split_article_text(content))
    ]
    await session.execute(
        text("DELETE FROM article_chunks WHERE article_id = :article_id"),
        {"article_id": int(article_id)},
    )
    if chunk_rows:
        await session.execute(
            text(
                """INSERT INTO article_chunks (article_id, chunk_index, text, token_count)
                   VALUES (:article_id, :chunk_index, :text, :token_count)"""
            ),
            chunk_rows,
        )
    await session.commit()
    return True


async def delete_admin_article(session: AsyncSession, article_id: int) -> bool:
    await session.execute(
        text("DELETE FROM article_sessions WHERE article_id = :article_id"),
        {"article_id": int(article_id)},
    )
    await session.execute(
        text("DELETE FROM article_chunks WHERE article_id = :article_id"),
        {"article_id": int(article_id)},
    )
    result = await session.execute(
        text("DELETE FROM articles WHERE id = :article_id"),
        {"article_id": int(article_id)},
    )
    await session.commit()
    return bool(result.rowcount)


async def publish_article(
    session: AsyncSession,
    article_id: int,
    is_published: bool = True,
) -> bool:
    result = await session.execute(
        text(
            """UPDATE articles
               SET is_published = :is_published, updated_at = NOW()
               WHERE id = :article_id
                 AND EXISTS (
                     SELECT 1 FROM article_chunks
                     WHERE article_chunks.article_id = articles.id
                 )"""
        ),
        {"article_id": article_id, "is_published": is_published},
    )
    await session.commit()
    return bool(result.rowcount)


async def create_article_session(
    session: AsyncSession,
    user_id: str,
    article_id: int,
) -> int:
    result = await session.execute(
        text(
            """INSERT INTO article_sessions (user_id, article_id)
               VALUES (:user_id, :article_id)
               RETURNING id"""
        ),
        {"user_id": user_id, "article_id": article_id},
    )
    await session.commit()
    return int(result.scalar_one())


async def get_article_chunks(session: AsyncSession, article_id: int) -> list[dict]:
    result = await session.execute(
        text(
            """SELECT id, article_id, chunk_index, text, token_count
               FROM article_chunks
               WHERE article_id = :article_id
               ORDER BY chunk_index ASC"""
        ),
        {"article_id": article_id},
    )
    return _rows(result)


async def get_article_session(session: AsyncSession, user_id: str, session_id: int) -> dict | None:
    result = await session.execute(
        text(
            """SELECT s.id, s.user_id, s.article_id, s.status, s.current_chunk,
                      s.study_json, s.completion_json, s.created_at, s.updated_at,
                      a.source_key, a.source, a.title, a.url, a.image_url, a.published_at,
                      a.topic, a.level, a.description,
                      a.content_snippet, a.extraction_status, a.feed_entry_id,
                      a.license_status, a.collection_method
               FROM article_sessions s
               JOIN articles a ON a.id = s.article_id
               WHERE s.user_id = :user_id
                 AND s.id = :session_id
                 AND a.is_published = TRUE
                 AND LOWER(COALESCE(a.topic, '')) <> 'opinion'
                 AND (
                     (a.collection_method = 'manual' AND a.license_status = 'approved')
                     OR EXISTS (
                         SELECT 1 FROM article_sources src
                         WHERE src.key = a.source_key
                           AND src.is_active = TRUE
                           AND src.license_status = 'approved'
                     )
                 )"""
        ),
        {"user_id": user_id, "session_id": session_id},
    )
    row = result.mappings().first()
    if not row:
        return None
    data = dict(row)
    data["chunks"] = await get_article_chunks(session, int(data["article_id"]))
    return data


async def get_article_sessions(session: AsyncSession, user_id: str) -> list[dict]:
    result = await session.execute(
        text(
            """SELECT s.id, s.article_id, s.status, s.current_chunk,
                      s.study_json, s.completion_json, s.created_at, s.updated_at,
                      a.source_key, a.source, a.title, a.url, a.image_url, a.published_at,
                      a.topic, a.level, a.description,
                      a.extraction_status, a.feed_entry_id, a.license_status,
                      a.collection_method
               FROM article_sessions s
               JOIN articles a ON a.id = s.article_id
               WHERE s.user_id = :user_id
                 AND a.is_published = TRUE
                 AND LOWER(COALESCE(a.topic, '')) <> 'opinion'
                 AND (
                     (a.collection_method = 'manual' AND a.license_status = 'approved')
                     OR EXISTS (
                         SELECT 1 FROM article_sources src
                         WHERE src.key = a.source_key
                           AND src.is_active = TRUE
                           AND src.license_status = 'approved'
                     )
                 )
               ORDER BY s.created_at DESC, s.id DESC
               LIMIT 50"""
        ),
        {"user_id": user_id},
    )
    return _rows(result)


async def update_article_study(
    session: AsyncSession,
    user_id: str,
    session_id: int,
    study: dict,
) -> bool:
    result = await session.execute(
        text(
            """UPDATE article_sessions
               SET study_json = CAST(:study AS jsonb),
                   status = 'studying',
                   updated_at = NOW()
               WHERE user_id = :user_id AND id = :session_id"""
        ),
        {
            "user_id": user_id,
            "session_id": session_id,
            "study": json.dumps(study or {}, ensure_ascii=False),
        },
    )
    await session.commit()
    return bool(result.rowcount)


async def update_article_completion(
    session: AsyncSession,
    user_id: str,
    session_id: int,
    completion: dict,
) -> bool:
    result = await session.execute(
        text(
            """UPDATE article_sessions
               SET completion_json = CAST(:completion AS jsonb),
                   status = 'completed',
                   updated_at = NOW()
               WHERE user_id = :user_id AND id = :session_id"""
        ),
        {
            "user_id": user_id,
            "session_id": session_id,
            "completion": json.dumps(completion or {}, ensure_ascii=False),
        },
    )
    await session.commit()
    return bool(result.rowcount)


async def delete_article_session(
    session: AsyncSession,
    user_id: str,
    session_id: int,
) -> bool:
    result = await session.execute(
        text(
            """DELETE FROM article_sessions
               WHERE user_id = :user_id AND id = :session_id"""
        ),
        {"user_id": user_id, "session_id": session_id},
    )
    await session.commit()
    return bool(result.rowcount)

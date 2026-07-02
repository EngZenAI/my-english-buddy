import json
import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import Integer, bindparam, delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY, insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.models import OAuthAccount, User
from backend.articles.sources import source_payloads
from backend.db.models import Label, QuizHistory, Word
from backend.db.session import SessionFactory, engine

logger = logging.getLogger(__name__)
DEFAULT_LABELS = ["미지정", "여행", "비즈니스", "일상", "IT·코딩", "학업"]
MAX_LABELS = 20


def _rows(result) -> list[dict[str, Any]]:
    return [dict(row) for row in result.mappings().all()]


def _uuid(value: str) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


async def _exec_driver_statements(conn, statements: tuple[str, ...]) -> None:
    for statement in statements:
        await conn.exec_driver_sql(statement)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.exec_driver_sql("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT")
        await conn.exec_driver_sql(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'words' AND column_name = 'context'
                ) AND NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'words' AND column_name = 'tag'
                ) THEN
                    EXECUTE 'ALTER TABLE words RENAME COLUMN context TO tag';
                END IF;
            END $$;
            """
        )
        await _exec_driver_statements(
            conn,
            (
                """
                CREATE TABLE IF NOT EXISTS words (
                    id            SERIAL PRIMARY KEY,
                    user_id       UUID NOT NULL,
                    word          TEXT NOT NULL,
                    korean        TEXT,
                    korean_detail TEXT,
                    english_def   TEXT,
                    example       TEXT,
                    tag           TEXT,
                    created_at    TIMESTAMP DEFAULT NOW(),
                    next_review   TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days')
                )
                """,
                "ALTER TABLE words ADD COLUMN IF NOT EXISTS user_id UUID",
                """
                DO $$
                DECLARE
                    legacy_user_id UUID;
                BEGIN
                    IF (SELECT COUNT(*) FROM users) = 1 THEN
                        SELECT id INTO legacy_user_id FROM users ORDER BY id LIMIT 1;
                        UPDATE words SET user_id = legacy_user_id WHERE user_id IS NULL;
                    ELSE
                        DELETE FROM words WHERE user_id IS NULL;
                    END IF;
                END $$;
                """,
                """
                WITH ranked AS (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY user_id, lower(word)
                               ORDER BY created_at DESC NULLS LAST, id DESC
                           ) AS rn
                    FROM words
                    WHERE user_id IS NOT NULL
                )
                DELETE FROM words w
                USING ranked r
                WHERE w.id = r.id AND r.rn > 1
                """,
                "ALTER TABLE words ALTER COLUMN user_id SET NOT NULL",
                "ALTER TABLE words ADD COLUMN IF NOT EXISTS korean_detail TEXT",
                "ALTER TABLE words ADD COLUMN IF NOT EXISTS sort_order INTEGER",
                "ALTER TABLE words ALTER COLUMN next_review SET DEFAULT NOW() + INTERVAL '7 days'",
                "ALTER TABLE words DROP COLUMN IF EXISTS phonetic",
                "ALTER TABLE words DROP CONSTRAINT IF EXISTS words_word_key",
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_words_user_word
                    ON words (user_id, lower(word))
                """,
                """
                CREATE TABLE IF NOT EXISTS quiz_history (
                    id          SERIAL PRIMARY KEY,
                    user_id     UUID,
                    word_id     INTEGER,
                    result      BOOLEAN,
                    reviewed_at TIMESTAMP DEFAULT NOW()
                )
                """,
                "ALTER TABLE quiz_history ADD COLUMN IF NOT EXISTS user_id UUID",
                "ALTER TABLE quiz_history DROP CONSTRAINT IF EXISTS quiz_history_word_id_fkey",
                """
                CREATE TABLE IF NOT EXISTS quiz_sessions (
                    id              SERIAL PRIMARY KEY,
                    user_id         UUID NOT NULL,
                    mode            TEXT NOT NULL,
                    tag             TEXT,
                    saved_from      DATE,
                    saved_to        DATE,
                    instruction     TEXT,
                    question_count  INTEGER DEFAULT 10,
                    total_questions INTEGER DEFAULT 0,
                    score           NUMERIC DEFAULT 0,
                    created_at      TIMESTAMP DEFAULT NOW(),
                    completed_at    TIMESTAMP,
                    review_applied_at TIMESTAMP
                )
                """,
                "ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",
                "ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS review_applied_at TIMESTAMP",
                """
                CREATE TABLE IF NOT EXISTS quiz_question_results (
                    id                    SERIAL PRIMARY KEY,
                    session_id            INTEGER NOT NULL,
                    user_id               UUID NOT NULL,
                    word_id               INTEGER,
                    source_word_id        INTEGER,
                    source_word           TEXT,
                    target_word           TEXT,
                    question_type         TEXT,
                    difficulty            TEXT,
                    prompt                TEXT,
                    user_answer           TEXT,
                    correct_answer        TEXT,
                    status                TEXT,
                    correct               BOOLEAN,
                    score                 NUMERIC DEFAULT 0,
                    confidence            NUMERIC DEFAULT 1,
                    feedback              TEXT,
                    is_derived            BOOLEAN DEFAULT FALSE,
                    derived_from_word_id  INTEGER,
                    suggested_word        TEXT,
                    suggested_korean      TEXT,
                    suggested_english_def TEXT,
                    suggested_example     TEXT,
                    suggested_tag         TEXT,
                    created_at            TIMESTAMP DEFAULT NOW()
                )
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_quiz_question_results_user_created
                    ON quiz_question_results (user_id, created_at DESC)
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_quiz_question_results_session
                    ON quiz_question_results (session_id)
                """,
                """
                CREATE TABLE IF NOT EXISTS labels (
                    id          SERIAL PRIMARY KEY,
                    user_id     UUID NOT NULL,
                    name        TEXT NOT NULL,
                    created_at  TIMESTAMP DEFAULT NOW()
                )
                """,
                "ALTER TABLE labels ADD COLUMN IF NOT EXISTS user_id UUID",
                "ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_name_key",
                "DELETE FROM labels WHERE user_id IS NULL",
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_labels_user_name
                    ON labels (user_id, name)
                """,
                """
                CREATE TABLE IF NOT EXISTS roleplay_sessions (
                    id          SERIAL PRIMARY KEY,
                    user_id     UUID NOT NULL,
                    level       TEXT,
                    scenario    TEXT,
                    tag         TEXT,
                    situation   TEXT,
                    title       TEXT,
                    turns       INTEGER DEFAULT 0,
                    summary     TEXT,
                    expressions JSONB DEFAULT '[]'::jsonb,
                    vocab       JSONB DEFAULT '[]'::jsonb,
                    created_at  TIMESTAMP DEFAULT NOW()
                )
                """,
                "ALTER TABLE roleplay_sessions ADD COLUMN IF NOT EXISTS situation TEXT",
                """
                CREATE INDEX IF NOT EXISTS ix_roleplay_sessions_user_created
                    ON roleplay_sessions (user_id, created_at DESC)
                """,
                """
                CREATE TABLE IF NOT EXISTS article_sources (
                    key                TEXT PRIMARY KEY,
                    name               TEXT NOT NULL,
                    domains            JSONB DEFAULT '[]'::jsonb,
                    default_topic      TEXT,
                    fallback_image_url TEXT,
                    feed_url           TEXT,
                    site_url           TEXT,
                    license_status     TEXT DEFAULT 'pending',
                    is_active          BOOLEAN DEFAULT TRUE,
                    created_at         TIMESTAMP DEFAULT NOW(),
                    updated_at         TIMESTAMP DEFAULT NOW()
                )
                """,
                "ALTER TABLE article_sources ADD COLUMN IF NOT EXISTS feed_url TEXT",
                "ALTER TABLE article_sources ADD COLUMN IF NOT EXISTS site_url TEXT",
                "ALTER TABLE article_sources ADD COLUMN IF NOT EXISTS license_status TEXT DEFAULT 'pending'",
                """
                CREATE TABLE IF NOT EXISTS articles (
                    id                SERIAL PRIMARY KEY,
                    source_key        TEXT,
                    source            TEXT,
                    title             TEXT NOT NULL,
                    url               TEXT NOT NULL,
                    image_url         TEXT,
                    published_at      TIMESTAMP,
                    topic             TEXT,
                    level             TEXT,
                    is_published      BOOLEAN DEFAULT FALSE,
                    description       TEXT,
                    content_snippet   TEXT,
                    extracted_text    TEXT,
                    extraction_status TEXT,
                    feed_entry_id     TEXT,
                    license_status    TEXT DEFAULT 'pending',
                    collection_method TEXT DEFAULT 'manual',
                    created_at        TIMESTAMP DEFAULT NOW(),
                    updated_at        TIMESTAMP DEFAULT NOW()
                )
                """,
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_key TEXT",
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS topic TEXT",
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS level TEXT",
                "ALTER TABLE articles DROP COLUMN IF EXISTS estimated_minutes",
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT FALSE",
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS feed_entry_id TEXT",
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS license_status TEXT DEFAULT 'pending'",
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS collection_method TEXT DEFAULT 'manual'",
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_articles_url
                    ON articles (url)
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_articles_published_topic
                    ON articles (is_published, topic, published_at DESC, id DESC)
                """,
                """
                CREATE TABLE IF NOT EXISTS article_chunks (
                    id          SERIAL PRIMARY KEY,
                    article_id  INTEGER NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    text        TEXT NOT NULL,
                    token_count INTEGER DEFAULT 0,
                    created_at  TIMESTAMP DEFAULT NOW()
                )
                """,
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_article_chunks_article_index
                    ON article_chunks (article_id, chunk_index)
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_article_chunks_article
                    ON article_chunks (article_id, chunk_index)
                """,
                """
                CREATE TABLE IF NOT EXISTS article_sessions (
                    id              SERIAL PRIMARY KEY,
                    user_id         UUID NOT NULL,
                    article_id      INTEGER NOT NULL,
                    status          TEXT DEFAULT 'started',
                    current_chunk   INTEGER DEFAULT 0,
                    study_json      JSONB DEFAULT '{}'::jsonb,
                    completion_json JSONB DEFAULT '{}'::jsonb,
                    created_at      TIMESTAMP DEFAULT NOW(),
                    updated_at      TIMESTAMP DEFAULT NOW()
                )
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_article_sessions_user_created
                    ON article_sessions (user_id, created_at DESC)
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_article_sessions_article
                    ON article_sessions (article_id)
                """,
                """
                CREATE TABLE IF NOT EXISTS article_refresh_jobs (
                    job_id            TEXT PRIMARY KEY,
                    status            TEXT NOT NULL,
                    ok                BOOLEAN DEFAULT FALSE,
                    source_key        TEXT,
                    total_sources     INTEGER DEFAULT 0,
                    completed_sources INTEGER DEFAULT 0,
                    current_source    TEXT,
                    saved             INTEGER DEFAULT 0,
                    skipped           INTEGER DEFAULT 0,
                    results           JSONB DEFAULT '[]'::jsonb,
                    error             TEXT,
                    message           TEXT,
                    created_at        TIMESTAMP DEFAULT NOW(),
                    started_at        TIMESTAMP,
                    finished_at       TIMESTAMP,
                    updated_at        TIMESTAMP DEFAULT NOW()
                )
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_article_refresh_jobs_status_created
                    ON article_refresh_jobs (status, created_at DESC)
                """,
                """
                CREATE TABLE IF NOT EXISTS api_usage_events (
                    id            SERIAL PRIMARY KEY,
                    user_id       UUID,
                    feature       TEXT NOT NULL,
                    operation     TEXT NOT NULL,
                    provider      TEXT,
                    model         TEXT,
                    units         INTEGER DEFAULT 1,
                    input_chars   INTEGER DEFAULT 0,
                    output_chars  INTEGER DEFAULT 0,
                    input_tokens  INTEGER,
                    output_tokens INTEGER,
                    total_tokens  INTEGER,
                    success       BOOLEAN DEFAULT TRUE,
                    created_at    TIMESTAMP DEFAULT NOW()
                )
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_api_usage_events_user_created
                    ON api_usage_events (user_id, created_at DESC)
                """,
            ),
        )
        await conn.exec_driver_sql(
            """
            WITH ranked AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY user_id
                           ORDER BY created_at DESC, id DESC
                       ) - 1 AS rn
                FROM words
                WHERE sort_order IS NULL
            )
            UPDATE words w
            SET sort_order = r.rn
            FROM ranked r
            WHERE w.id = r.id
            """
        )
        for source in source_payloads():
            await conn.execute(
                text(
                    """INSERT INTO article_sources
                           (key, name, domains, default_topic, fallback_image_url,
                            feed_url, site_url, license_status, is_active, updated_at)
                       VALUES (:key, :name, CAST(:domains AS jsonb), :default_topic,
                               :fallback_image_url, :feed_url, :site_url,
                               :license_status, :is_active, NOW())
                       ON CONFLICT (key) DO UPDATE SET
                           name = EXCLUDED.name,
                           domains = EXCLUDED.domains,
                           default_topic = EXCLUDED.default_topic,
                           fallback_image_url = EXCLUDED.fallback_image_url,
                           feed_url = EXCLUDED.feed_url,
                           site_url = EXCLUDED.site_url,
                           license_status = EXCLUDED.license_status,
                           is_active = EXCLUDED.is_active,
                           updated_at = NOW()"""
                ),
                {
                    **source,
                    "domains": json.dumps(source["domains"], ensure_ascii=False),
                },
            )
        active_source_keys = [source["key"] for source in source_payloads()]
        if active_source_keys:
            await conn.execute(
                text(
                    """UPDATE article_sources
                       SET is_active = FALSE,
                           updated_at = NOW()
                       WHERE key NOT IN :active_source_keys"""
                ).bindparams(bindparam("active_source_keys", expanding=True)),
                {"active_source_keys": active_source_keys},
            )
        await conn.execute(
            text(
                """UPDATE articles a
                   SET license_status = src.license_status,
                       updated_at = a.updated_at
                   FROM article_sources src
                   WHERE a.source_key = src.key
                     AND (a.license_status IS NULL OR a.license_status = 'pending')"""
            )
        )
        await conn.execute(
            text(
                """UPDATE articles
                   SET image_url = '',
                       updated_at = updated_at
                   WHERE collection_method = 'rss'
                     AND (
                         image_url LIKE 'https://images.unsplash.com/%'
                         OR lower(image_url) LIKE '%/logo%'
                         OR lower(image_url) LIKE '%logo_%'
                     )"""
            )
        )
        await conn.execute(
            text(
                """UPDATE articles
                   SET image_url = regexp_replace(image_url, '/standard/[0-9]{2,4}/', '/standard/976/'),
                       updated_at = updated_at
                   WHERE image_url LIKE 'https://ichef.bbci.co.uk/%'
                     AND image_url LIKE '%/standard/%'"""
            )
        )
        await conn.execute(
            text(
                """UPDATE articles
                   SET image_url = regexp_replace(image_url, 'width=[0-9]+', 'width=1000'),
                       updated_at = updated_at
                   WHERE image_url LIKE 'https://i.guim.co.uk/%'
                     AND image_url LIKE '%width=%'"""
            )
        )
        await conn.execute(
            text(
                """UPDATE articles
                   SET is_published = FALSE,
                       updated_at = updated_at
                   WHERE collection_method = 'rss'
                     AND lower(url) LIKE '%/null%'"""
            )
        )


async def is_word_saved(session: AsyncSession, user_id: str, word: str) -> bool:
    if not word or not word.strip():
        return False
    result = await session.execute(
        select(Word.id).where(
            Word.user_id == _uuid(user_id),
            func.lower(Word.word) == word.strip().lower(),
        )
    )
    return result.scalar_one_or_none() is not None


async def save_word(
    session: AsyncSession,
    user_id,
    word,
    korean,
    korean_detail,
    english_def,
    example,
    tag,
):
    user_uuid = _uuid(user_id)
    result = await session.execute(
        select(Word.id).where(
            Word.user_id == user_uuid,
            func.lower(Word.word) == word.lower(),
        )
    )
    word_id = result.scalar_one_or_none()
    if word_id:
        await session.execute(
            update(Word)
            .where(Word.id == word_id, Word.user_id == user_uuid)
            .values(
                korean=korean,
                english_def=english_def,
                example=example,
                tag=tag,
                korean_detail=korean_detail,
            )
        )
        await session.commit()
        return "✏️ 단어 정보를 업데이트했어요!"
    result = await session.execute(
        select(func.coalesce(func.min(Word.sort_order), 0) - 1).where(
            Word.user_id == user_uuid
        )
    )
    next_order = result.scalar_one()
    await session.execute(
        insert(Word).values(
            user_id=user_uuid,
            word=word,
            korean=korean,
            korean_detail=korean_detail,
            english_def=english_def,
            example=example,
            tag=tag,
            sort_order=next_order,
            next_review=datetime.now() + timedelta(days=7),
        )
    )
    await session.commit()
    return "✅ 단어장에 저장됐어요!"


async def existing_words_lower(session: AsyncSession, user_id: str) -> set:
    result = await session.execute(
        select(func.lower(Word.word)).where(Word.user_id == _uuid(user_id))
    )
    return set(result.scalars().all())


async def bulk_import_words(
    session: AsyncSession,
    user_id: str,
    items,
    default_tag: str = "미지정",
) -> dict:
    rows = [{"word": word, "korean": korean, "tag": default_tag} for word, korean in items]
    return await insert_words(session, user_id, rows, overwrite=False)


async def insert_words(
    session: AsyncSession,
    user_id: str,
    items,
    overwrite: bool = False,
) -> dict:
    added = updated = skipped = 0
    user_uuid = _uuid(user_id)
    result = await session.execute(
        select(func.lower(Word.word)).where(Word.user_id == user_uuid)
    )
    existing = set(result.scalars().all())

    to_insert = []
    to_update = []
    seen: set[str] = set()
    for it in items:
        word = (it.get("word") or "").strip()
        if not word:
            continue
        lower_word = word.lower()
        if lower_word in seen:
            skipped += 1
            continue
        seen.add(lower_word)
        payload = {**it, "word": word}
        if lower_word in existing:
            if overwrite:
                to_update.append(payload)
            else:
                skipped += 1
            continue
        to_insert.append(payload)

    if to_insert:
        result = await session.execute(
            select(func.coalesce(func.min(Word.sort_order), 0)).where(
                Word.user_id == user_uuid
            )
        )
        base = result.scalar_one()
        params = []
        for index, item in enumerate(to_insert):
            params.append(
                {
                    "user_id": user_uuid,
                    "word": item["word"].lower(),
                    "korean": (item.get("korean") or "").strip(),
                    "korean_detail": item.get("korean_detail") or "",
                    "english_def": item.get("english_def") or "",
                    "example": item.get("example") or "",
                    "tag": item.get("tag") or "미지정",
                    "sort_order": base - len(to_insert) + index,
                    "next_review": datetime.now() + timedelta(days=7),
                }
            )
        await session.execute(
            insert(Word),
            params,
        )
        added = len(params)

    for item in to_update:
        result = await session.execute(
            select(Word).where(
                Word.user_id == user_uuid,
                func.lower(Word.word) == item["word"].lower(),
            ),
        )
        word_row = result.scalar_one_or_none()
        if not word_row:
            continue
        if korean := (item.get("korean") or "").strip():
            word_row.korean = korean
        if korean_detail := (item.get("korean_detail") or ""):
            word_row.korean_detail = korean_detail
        if example := (item.get("example") or ""):
            word_row.example = example
        if tag := (item.get("tag") or ""):
            word_row.tag = tag
        updated += 1
    await session.commit()
    return {"added": added, "updated": updated, "skipped": skipped, "total": added + updated + skipped}


async def get_all_words(
    session: AsyncSession,
    user_id: str,
    tag: str | None = None,
):
    stmt = select(
        Word.id,
        Word.word,
        Word.korean,
        Word.korean_detail,
        Word.english_def,
        Word.example,
        Word.tag,
        Word.created_at,
        Word.next_review,
        Word.sort_order,
    ).where(Word.user_id == _uuid(user_id))
    if tag:
        stmt = stmt.where(Word.tag == tag)
    stmt = stmt.order_by(Word.sort_order.asc().nulls_last(), Word.created_at.desc())
    result = await session.execute(stmt)
    return _rows(result)


async def get_words_for_quiz(
    session: AsyncSession,
    user_id: str,
    mode: str = "random",
    tag: str = "",
    saved_from: str = "",
    saved_to: str = "",
    limit: int = 50,
):
    mode = (mode or "random").strip()
    limit = max(1, min(int(limit or 50), 100))
    clauses = ["user_id = :user_id"]
    params: dict[str, Any] = {"user_id": user_id, "limit": limit}
    if mode == "tag" and tag:
        clauses.append("tag = :tag")
        params["tag"] = tag
    if mode == "saved_date":
        if saved_from:
            clauses.append("created_at::date >= :saved_from")
            params["saved_from"] = saved_from
        if saved_to:
            clauses.append("created_at::date <= :saved_to")
            params["saved_to"] = saved_to
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
) -> int:
    result = await session.execute(
        text(
            """INSERT INTO quiz_sessions
                   (user_id, mode, tag, saved_from, saved_to, instruction, question_count)
               VALUES (:user_id, :mode, :tag, CAST(NULLIF(:saved_from, '') AS date),
                       CAST(NULLIF(:saved_to, '') AS date), :instruction, :question_count)
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
                "target_word": result.get("target_word") or "",
                "question_type": result.get("question_type") or "",
                "difficulty": result.get("difficulty") or "",
                "prompt": result.get("prompt") or "",
                "user_answer": result.get("user_answer") or "",
                "correct_answer": result.get("correct_answer") or "",
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
                 target_word, question_type, difficulty, prompt, user_answer,
                 correct_answer, status, correct, score, confidence, feedback,
                 is_derived, derived_from_word_id, suggested_word,
                 suggested_korean, suggested_english_def, suggested_example, suggested_tag)
               VALUES
                (:session_id, :user_id, :word_id, :source_word_id, :source_word,
                 :target_word, :question_type, :difficulty, :prompt, :user_answer,
                 :correct_answer, :status, :correct, :score, :confidence, :feedback,
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
    except Exception:
        await session.rollback()
        raise


async def get_quiz_stats(session: AsyncSession, user_id: str) -> dict:
    result = await session.execute(
        text(
            """SELECT
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
               WHERE user_id = :user_id"""
        ),
        {"user_id": user_id},
    )
    summary = dict(result.mappings().first() or {})

    result = await session.execute(
        text(
            """SELECT
                   COALESCE(source_word_id, word_id)::int AS word_id,
                   COALESCE(NULLIF(source_word, ''), NULLIF(target_word, ''), '') AS word,
                   COUNT(*)::int AS attempt_count,
                   COALESCE(SUM(score), 0)::float AS total_score,
                   COUNT(*) FILTER (WHERE status = 'correct')::int AS correct_count,
                   COUNT(*) FILTER (WHERE status = 'partial')::int AS partial_count,
                   COUNT(*) FILTER (WHERE status = 'incorrect')::int AS incorrect_count,
                   MAX(created_at) AS last_quiz_at
               FROM quiz_question_results
               WHERE user_id = :user_id AND COALESCE(source_word_id, word_id) IS NOT NULL
               GROUP BY COALESCE(source_word_id, word_id),
                        COALESCE(NULLIF(source_word, ''), NULLIF(target_word, ''), '')
               ORDER BY incorrect_count DESC, attempt_count DESC, last_quiz_at DESC
               LIMIT 50"""
        ),
        {"user_id": user_id},
    )
    word_stats = _rows(result)

    result = await session.execute(
        text(
            """SELECT
                   question_type,
                   COUNT(*)::int AS attempt_count,
                   COALESCE(SUM(score), 0)::float AS total_score,
                   COUNT(*) FILTER (WHERE status = 'incorrect')::int AS incorrect_count
               FROM quiz_question_results
               WHERE user_id = :user_id
               GROUP BY question_type
               ORDER BY attempt_count DESC"""
        ),
        {"user_id": user_id},
    )
    type_stats = _rows(result)

    result = await session.execute(
        text(
            """SELECT
                   COALESCE(source_word_id, word_id)::int AS word_id,
                   COALESCE(NULLIF(source_word, ''), NULLIF(target_word, ''), '') AS word,
                   target_word,
                   question_type,
                   prompt,
                   user_answer,
                   correct_answer,
                   feedback,
                   created_at
               FROM quiz_question_results
               WHERE user_id = :user_id AND status = 'incorrect'
               ORDER BY created_at DESC
               LIMIT 10"""
        ),
        {"user_id": user_id},
    )
    recent_incorrect = _rows(result)

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

    return {
        "summary": summary,
        "word_stats": word_stats,
        "type_stats": type_stats,
        "recent_incorrect": recent_incorrect,
    }


async def record_api_usage_events(
    user_id: str | None,
    events: list[dict[str, Any]],
) -> None:
    if not user_id or not events:
        return

    rows = []
    for event in events:
        rows.append(
            {
                "user_id": user_id,
                "feature": event.get("feature") or "unknown",
                "operation": event.get("operation") or "unknown",
                "provider": event.get("provider") or "",
                "model": event.get("model") or "",
                "units": max(1, int(event.get("units") or 1)),
                "input_chars": max(0, int(event.get("input_chars") or 0)),
                "output_chars": max(0, int(event.get("output_chars") or 0)),
                "input_tokens": event.get("input_tokens"),
                "output_tokens": event.get("output_tokens"),
                "total_tokens": event.get("total_tokens"),
                "success": bool(event.get("success", True)),
            }
        )

    try:
        async with SessionFactory.begin() as session:
            await session.execute(
                text(
                    """INSERT INTO api_usage_events
                           (user_id, feature, operation, provider, model, units,
                            input_chars, output_chars, input_tokens, output_tokens,
                            total_tokens, success)
                       VALUES
                           (:user_id, :feature, :operation, :provider, :model, :units,
                            :input_chars, :output_chars, :input_tokens, :output_tokens,
                            :total_tokens, :success)"""
                ),
                rows,
            )
    except Exception as exc:
        logger.warning("Failed to record API usage events: %s", exc)


FEATURE_LABELS = {
    "dictionary": "사전 검색",
    "translate": "번역",
    "tts": "발음 듣기",
    "slang": "슬랭 설명",
    "quiz": "AI 퀴즈",
    "roleplay": "롤플레잉",
    "article": "뉴스 리딩",
}

OPERATION_LABELS = {
    ("dictionary", "lookup"): "사전 검색",
    ("translate", "en_to_ko"): "영한 번역",
    ("translate", "ko_to_en"): "한영 번역",
    ("tts", "synthesize"): "발음 듣기",
    ("slang", "explain"): "슬랭 설명",
    ("quiz", "generate_quiz"): "AI 퀴즈 생성",
    ("quiz", "grade_subjective"): "주관식 채점",
    ("roleplay", "start"): "롤플레잉 시작",
    ("roleplay", "continue"): "롤플레잉 대화",
    ("roleplay", "summary"): "롤플레잉 정리",
    ("article", "study"): "뉴스 리딩",
    ("article", "ask"): "뉴스 리딩 질문",
    ("article", "complete"): "뉴스 리딩 정리",
}


def _feature_label(feature: str) -> str:
    return FEATURE_LABELS.get(feature or "", feature or "기타")


def _operation_label(feature: str, operation: str) -> str:
    return OPERATION_LABELS.get(
        (feature or "", operation or ""),
        _feature_label(feature),
    )


async def get_admin_api_usage(
    session: AsyncSession,
    date_value,
    group_by: str = "hour",
    range_key: str = "day",
    start_date_value=None,
    end_date_value=None,
) -> dict:
    """Admin aggregate for the usage/cost screen.

    Costs are rough operational estimates until provider billing is wired in.
    They are intentionally returned as estimated_cost_usd.
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
                      COALESCE(SUM(units), 0)::int AS request_count,
                      COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
                      COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
                      COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
                      COALESCE(SUM(input_chars), 0)::int AS input_chars,
                      COALESCE(SUM(output_chars), 0)::int AS output_chars,
                      COALESCE(SUM(CASE WHEN success THEN 0 ELSE units END), 0)::int AS failed_count,
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
        total_tokens = int(item.get("total_tokens") or 0)
        total_chars = int(item.get("input_chars") or 0) + int(item.get("output_chars") or 0)
        estimated_cost = round((total_tokens / 1000 * 0.002) + (total_chars / 1000 * 0.0002), 4)
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
        total_tokens = int(item.get("total_tokens") or 0)
        providers.append({
            **item,
            "estimated_cost_usd": round(total_tokens / 1000 * 0.002, 4),
        })

    result = await session.execute(
        text(
            """SELECT feature, operation, provider, model,
                      COALESCE(SUM(units), 0)::int AS request_count,
                      COALESCE(SUM(CASE WHEN success THEN 0 ELSE units END), 0)::int AS failed_count,
                      MAX(created_at) AS last_seen_at
               FROM api_usage_events
               WHERE created_at >= CAST(:start_date AS date)
                 AND created_at < CAST(:end_date AS date)
               GROUP BY feature, operation, provider, model
               HAVING COALESCE(SUM(CASE WHEN success THEN 0 ELSE units END), 0) > 0
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
            "request_count": sum(int(item.get("request_count") or 0) for item in usage_rows),
            "failed_count": sum(int(item.get("failed_count") or 0) for item in usage_rows),
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
        "roleplay_session_count": int(
            roleplay_summary.get("roleplay_session_count") or 0
        ),
        "weak_words": weak_words,
        "recent_roleplay_sessions": _rows(result),
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


async def update_word(
    session: AsyncSession,
    user_id: str,
    word_id: int,
    korean_detail,
    english_def,
    example,
    tag,
    next_review,
) -> bool:
    query = """UPDATE words
               SET korean_detail = :korean_detail,
                   english_def = :english_def,
                   example = :example,
                   tag = :tag"""
    params = {
        "korean_detail": korean_detail,
        "english_def": english_def,
        "example": example,
        "tag": tag or "미지정",
        "word_id": word_id,
        "user_id": user_id,
    }
    if next_review:
        query += ", next_review = :next_review"
        params["next_review"] = next_review
    query += " WHERE id = :word_id AND user_id = :user_id"
    result = await session.execute(text(query), params)
    await session.commit()
    return bool(result.rowcount)


async def delete_word(session: AsyncSession, user_id: str, word_id: int) -> bool:
    result = await session.execute(
        delete(Word).where(Word.id == word_id, Word.user_id == _uuid(user_id))
    )
    await session.commit()
    return bool(result.rowcount)


async def bulk_update_words(session: AsyncSession, user_id: str, items) -> dict:
    parsed = {}
    order = []
    for item in items:
        try:
            word_id = int(item["id"])
        except (KeyError, TypeError, ValueError):
            continue
        parsed[word_id] = item
        order.append(word_id)
    if not parsed:
        return {"ok": True, "updated": 0, "skipped": 0, "conflicts": []}

    result = await session.execute(
        text("SELECT id, lower(word) AS word FROM words WHERE user_id = :user_id"),
        {"user_id": user_id},
    )
    current_words = {row["id"]: row["word"] for row in result.mappings().all()}

    target = dict(current_words)
    new_word = {}
    for word_id in order:
        if word_id not in current_words:
            continue
        raw = (parsed[word_id].get("word") or "").strip()
        lower_word = raw.lower() if raw else current_words[word_id]
        new_word[word_id] = lower_word
        target[word_id] = lower_word

    counts = {}
    for lower_word in target.values():
        counts[lower_word] = counts.get(lower_word, 0) + 1
    conflict_ids = set()
    conflicts = []
    for word_id in order:
        if word_id not in current_words:
            continue
        changed = new_word[word_id] != current_words[word_id]
        if changed and counts.get(new_word[word_id], 0) > 1:
            conflict_ids.add(word_id)
            conflicts.append(parsed[word_id].get("word") or new_word[word_id])

    updated = 0
    try:
        for word_id in order:
            if word_id not in current_words or word_id in conflict_ids:
                continue
            item = parsed[word_id]
            result = await session.execute(
                text(
                    """UPDATE words
                       SET word = :word,
                           korean = :korean,
                           korean_detail = :korean_detail,
                           english_def = :english_def,
                           example = :example,
                           tag = :tag,
                           next_review = CASE :next_review
                               WHEN '1d' THEN NOW() + INTERVAL '1 day'
                               WHEN '1w' THEN NOW() + INTERVAL '7 days'
                               WHEN '1m' THEN NOW() + INTERVAL '1 month'
                               WHEN '3m' THEN NOW() + INTERVAL '3 months'
                               WHEN '' THEN next_review
                               ELSE CAST(:next_review AS timestamp)
                           END
                       WHERE id = :id AND user_id = :user_id"""
                ),
                {
                    "word": new_word[word_id],
                    "korean": item.get("korean", "") or "",
                    "korean_detail": item.get("korean_detail", "") or "",
                    "english_def": item.get("english_def", "") or "",
                    "example": item.get("example", "") or "",
                    "tag": item.get("tag") or "미지정",
                    "next_review": (item.get("next_review") or "").strip(),
                    "id": word_id,
                    "user_id": user_id,
                },
            )
            updated += result.rowcount or 0
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return {
            "ok": False,
            "updated": 0,
            "skipped": len(conflict_ids),
            "conflicts": conflicts,
            "message": "단어를 서로 맞바꾸는 등 중복이 생겨 저장하지 못했어요. 겹치는 단어를 확인해주세요.",
        }
    return {"ok": True, "updated": updated, "skipped": len(conflict_ids), "conflicts": conflicts}


async def bulk_delete_words(session: AsyncSession, user_id: str, ids) -> int:
    clean = []
    for item in ids or []:
        try:
            clean.append(int(item))
        except (TypeError, ValueError):
            continue
    if not clean:
        return 0
    result = await session.execute(
        delete(Word).where(Word.user_id == _uuid(user_id), Word.id.in_(clean))
    )
    await session.commit()
    return result.rowcount or 0


async def reorder_words(session: AsyncSession, user_id: str, ordered_ids) -> int:
    clean_ids: list[int] = []
    seen: set[int] = set()
    for raw_id in ordered_ids or []:
        try:
            word_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if word_id in seen:
            continue
        seen.add(word_id)
        clean_ids.append(word_id)
    if not clean_ids:
        return 0

    result = await session.execute(
        text(
            """WITH ordered AS (
                   SELECT item.id, item.ordinality - 1 AS sort_order
                   FROM unnest(:ordered_ids) WITH ORDINALITY AS item(id, ordinality)
               )
               UPDATE words AS w
               SET sort_order = ordered.sort_order
               FROM ordered
               WHERE w.id = ordered.id AND w.user_id = :user_id"""
        ).bindparams(bindparam("ordered_ids", type_=ARRAY(Integer))),
        {"ordered_ids": clean_ids, "user_id": _uuid(user_id)},
    )
    await session.commit()
    return result.rowcount or 0


async def get_words_to_review(session: AsyncSession, user_id: str):
    result = await session.execute(
        select(Word).where(
            Word.user_id == _uuid(user_id),
            Word.next_review <= datetime.now(),
        ).order_by(Word.next_review.asc())
    )
    return [
        {
            "id": word.id,
            "user_id": word.user_id,
            "word": word.word,
            "korean": word.korean,
            "korean_detail": word.korean_detail,
            "english_def": word.english_def,
            "example": word.example,
            "tag": word.tag,
            "created_at": word.created_at,
            "next_review": word.next_review,
            "sort_order": word.sort_order,
        }
        for word in result.scalars().all()
    ]


async def update_review(session: AsyncSession, user_id: str, word_id: int, correct: bool):
    days = 30 if correct else 1
    next_review = datetime.now() + timedelta(days=days)
    result = await session.execute(
        update(Word)
        .where(Word.id == word_id, Word.user_id == _uuid(user_id))
        .values(next_review=next_review)
    )
    if not result.rowcount:
        return
    session.add(
        QuizHistory(user_id=_uuid(user_id), word_id=word_id, result=correct)
    )
    await session.commit()


async def _seed_default_labels(session: AsyncSession, user_id: str) -> None:
    user_uuid = _uuid(user_id)
    for name in DEFAULT_LABELS:
        await session.execute(
            pg_insert(Label)
            .values(user_id=user_uuid, name=name)
            .on_conflict_do_nothing(index_elements=[Label.user_id, Label.name])
        )
    await session.commit()


async def get_labels(session: AsyncSession, user_id: str) -> list[str]:
    async def _fetch() -> list[str]:
        result = await session.execute(
            select(Label.name)
            .where(Label.user_id == _uuid(user_id))
            .order_by(
                (Label.name == "미지정").desc(),
                Label.id.asc(),
            ),
        )
        return list(result.scalars().all())

    labels = await _fetch()
    if not labels:
        await _seed_default_labels(session, user_id)
        labels = await _fetch()
    return labels


async def add_label(session: AsyncSession, user_id: str, name: str) -> tuple[list[str], bool]:
    name = (name or "").strip()
    existing = await get_labels(session, user_id)
    if not name:
        return existing, False
    if name in existing:
        return existing, True
    if len(existing) >= MAX_LABELS:
        return existing, False
    await session.execute(
        pg_insert(Label)
        .values(user_id=_uuid(user_id), name=name)
        .on_conflict_do_nothing(index_elements=[Label.user_id, Label.name])
    )
    await session.commit()
    return await get_labels(session, user_id), True


async def count_words_by_tag(session: AsyncSession, user_id: str, tag: str) -> int:
    result = await session.execute(
        select(func.count()).select_from(Word).where(
            Word.user_id == _uuid(user_id),
            Word.tag == tag,
        )
    )
    return int(result.scalar_one())


async def rename_label(
    session: AsyncSession,
    user_id: str,
    old: str,
    new: str,
) -> tuple[list[str], bool, str]:
    old = (old or "").strip()
    new = (new or "").strip()
    if not old or not new:
        return await get_labels(session, user_id), False, "태그 이름이 비어 있습니다."
    if old == "미지정":
        return await get_labels(session, user_id), False, "'미지정' 태그는 변경할 수 없습니다."
    existing = await get_labels(session, user_id)
    if old not in existing:
        return existing, False, "존재하지 않는 태그입니다."
    if new == old:
        return existing, True, "변경 사항이 없습니다."
    if new in existing:
        return existing, False, "이미 있는 태그 이름입니다."
    await session.execute(
        update(Label)
        .where(Label.user_id == _uuid(user_id), Label.name == old)
        .values(name=new)
    )
    await session.execute(
        update(Word)
        .where(Word.user_id == _uuid(user_id), Word.tag == old)
        .values(tag=new)
    )
    await session.commit()
    return await get_labels(session, user_id), True, "변경되었습니다."


async def delete_label(
    session: AsyncSession,
    user_id: str,
    name: str,
) -> tuple[list[str], bool, str, int]:
    name = (name or "").strip()
    if name == "미지정":
        return await get_labels(session, user_id), False, "'미지정' 태그는 삭제할 수 없습니다.", 0
    existing = await get_labels(session, user_id)
    if name not in existing:
        return existing, False, "존재하지 않는 태그입니다.", 0
    if len(existing) <= 1:
        return existing, False, "최소 1개의 태그는 있어야 합니다.", 0
    deleted = await count_words_by_tag(session, user_id, name)
    await session.execute(
        delete(Word).where(Word.user_id == _uuid(user_id), Word.tag == name)
    )
    await session.execute(
        delete(Label).where(Label.user_id == _uuid(user_id), Label.name == name)
    )
    await session.commit()
    return await get_labels(session, user_id), True, "삭제되었습니다.", deleted


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
        chunks = [{"chunk_index": 0, "text": lead, "token_count": max(1, len(lead) // 4)}]
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
    per_topic_limit: int = 1,
) -> dict:
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 12), 30))
    per_topic_limit = max(1, min(int(per_topic_limit or 1), 5))
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
        "per_topic_limit": per_topic_limit,
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
            f"""WITH ranked AS (
                   SELECT id, source_key, source, title, url, image_url, published_at,
                          topic, level, description, extraction_status,
                          feed_entry_id, license_status, collection_method, created_at, updated_at,
                          ROW_NUMBER() OVER (
                              PARTITION BY
                                  source_key,
                                  COALESCE(NULLIF(topic, ''), 'uncategorized')
                              ORDER BY published_at DESC NULLS LAST, updated_at DESC, id DESC
                          ) AS topic_rank
                   FROM articles
                   WHERE {where_sql}
               )
               SELECT id, source_key, source, title, url, image_url, published_at,
                      topic, level, description, extraction_status,
                      feed_entry_id, license_status, collection_method, created_at, updated_at
               FROM ranked
               WHERE topic_rank <= :per_topic_limit
               ORDER BY published_at DESC NULLS LAST, updated_at DESC, id DESC
               LIMIT :limit OFFSET :offset"""
        ),
        params,
    )
    rows = _rows(result)
    count_result = await session.execute(
        text(
            f"""WITH ranked AS (
                   SELECT ROW_NUMBER() OVER (
                              PARTITION BY
                                  source_key,
                                  COALESCE(NULLIF(topic, ''), 'uncategorized')
                              ORDER BY published_at DESC NULLS LAST, updated_at DESC, id DESC
                          ) AS topic_rank
                   FROM articles
                   WHERE {where_sql}
               )
               SELECT COUNT(*)::int FROM ranked WHERE topic_rank <= :per_topic_limit"""
        ),
        {k: v for k, v in params.items() if k not in {"limit", "offset"}},
    )
    return {"articles": rows, "page": page, "page_size": page_size, "total": int(count_result.scalar_one())}


async def list_admin_articles(
    session: AsyncSession,
    page: int = 1,
    page_size: int = 30,
) -> dict:
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 30), 100))
    result = await session.execute(
        text(
            """SELECT id, source_key, source, title, url, image_url, published_at,
                      topic, level, is_published, description,
                      extraction_status, feed_entry_id, license_status, collection_method,
                      created_at, updated_at
               FROM articles
               WHERE LOWER(COALESCE(topic, '')) <> 'opinion'
               ORDER BY updated_at DESC, id DESC
               LIMIT :limit OFFSET :offset"""
        ),
        {"limit": page_size, "offset": (page - 1) * page_size},
    )
    rows = _rows(result)
    count_result = await session.execute(
        text("SELECT COUNT(*)::int FROM articles WHERE LOWER(COALESCE(topic, '')) <> 'opinion'")
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
    await session.execute(
        text("DELETE FROM article_chunks WHERE article_id = :article_id"),
        {"article_id": int(article_id)},
    )
    await session.execute(
        text(
            """INSERT INTO article_chunks (article_id, chunk_index, text, token_count)
               VALUES (:article_id, 0, :text, :token_count)"""
        ),
        {
            "article_id": int(article_id),
            "text": content,
            "token_count": max(1, len(content) // 4),
        },
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

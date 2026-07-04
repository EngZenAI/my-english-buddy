import json

from sqlalchemy import bindparam, text

from backend.articles.sources import source_payloads
from backend.db.session import engine


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
                    review_applied_at TIMESTAMP,
                    questions_json  JSONB DEFAULT '[]'::jsonb
                )
                """,
                "ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP",
                "ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS review_applied_at TIMESTAMP",
                "ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS questions_json JSONB DEFAULT '[]'::jsonb",
                """
                CREATE TABLE IF NOT EXISTS quiz_question_results (
                    id                    SERIAL PRIMARY KEY,
                    session_id            INTEGER NOT NULL,
                    user_id               UUID NOT NULL,
                    word_id               INTEGER,
                    source_word_id        INTEGER,
                    source_word           TEXT,
                    question_id           TEXT,
                    target_word           TEXT,
                    question_type         TEXT,
                    difficulty            TEXT,
                    prompt                TEXT,
                    user_answer           TEXT,
                    correct_answer        TEXT,
                    selected_choice_id    TEXT,
                    correct_choice_id     TEXT,
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
                "ALTER TABLE quiz_question_results ADD COLUMN IF NOT EXISTS question_id TEXT",
                "ALTER TABLE quiz_question_results ADD COLUMN IF NOT EXISTS selected_choice_id TEXT",
                "ALTER TABLE quiz_question_results ADD COLUMN IF NOT EXISTS correct_choice_id TEXT",
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
                CREATE TABLE IF NOT EXISTS agent_memories (
                    id         SERIAL PRIMARY KEY,
                    user_id    UUID NOT NULL,
                    key        TEXT NOT NULL,
                    value_json JSONB DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMP DEFAULT NOW()
                )
                """,
                """
                CREATE UNIQUE INDEX IF NOT EXISTS ux_agent_memories_user_key
                    ON agent_memories (user_id, key)
                """,
                """
                CREATE TABLE IF NOT EXISTS agent_jobs (
                    id               UUID PRIMARY KEY,
                    user_id          UUID NOT NULL,
                    type             TEXT NOT NULL,
                    status           TEXT NOT NULL DEFAULT 'queued',
                    progress_current INTEGER DEFAULT 0,
                    progress_total   INTEGER DEFAULT 0,
                    message          TEXT,
                    result_json      JSONB DEFAULT '{}'::jsonb,
                    error            TEXT,
                    created_at       TIMESTAMP DEFAULT NOW(),
                    updated_at       TIMESTAMP DEFAULT NOW()
                )
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_agent_jobs_user_created
                    ON agent_jobs (user_id, created_at DESC)
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

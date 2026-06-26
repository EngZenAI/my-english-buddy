import os
import threading
import urllib.parse
from contextlib import contextmanager
from importlib import import_module
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import Depends
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras
import psycopg2.pool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", encoding='utf-8-sig')

DATABASE_URL = os.getenv("DATABASE_URL")

# 기본 제공 라벨 (OPIc·실생활 테마). 사용자가 추가/삭제 가능.
DEFAULT_LABELS = ["미지정", "여행", "비즈니스", "일상", "IT·코딩", "학업"]
MAX_LABELS = 20  # 라벨 최대 개수 (기본 라벨 포함)


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.async_database_url, pool_pre_ping=True)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionFactory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_async_session)]


async def create_db_schema():
    import_module("backend.auth.models")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# ── psycopg2 커넥션 풀 ──────────────────────────────────────
# 매 요청마다 원격 DB에 새로 접속하면 TLS 핸드셰이크 때문에 수백 ms가 든다.
# 실시간 검색처럼 호출이 잦은 경로에서 이게 큰 지연이 된다.
# 풀로 연결을 재사용하면 그 비용을 없앨 수 있다.
_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                result = urllib.parse.urlparse(DATABASE_URL)
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=1,
                    maxconn=10,
                    host=result.hostname,
                    port=result.port,
                    database=result.path[1:],  # 앞의 '/' 제거
                    user=result.username,
                    password=result.password,
                )
    return _pool


@contextmanager
def get_conn():
    """풀에서 커넥션을 빌려주고, 사용 후 풀로 반환한다.
    기존 호출부(`with get_conn() as conn:`)와 그대로 호환된다."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        try:
            conn.rollback()  # 미완료 트랜잭션 정리 (이미 commit된 것은 영향 없음)
        except Exception:
            pass
        pool.putconn(conn)


def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 기존 DB에 context 컬럼이 있으면 tag 로 이름 변경 (데이터 보존)
            cur.execute("""
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
            """)

            cur.execute("""
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
                );

                -- 기존 테이블에 korean_detail 컬럼이 없으면 추가
                ALTER TABLE words ADD COLUMN IF NOT EXISTS user_id UUID;
                ALTER TABLE words ADD COLUMN IF NOT EXISTS korean_detail TEXT;
                ALTER TABLE words ADD COLUMN IF NOT EXISTS sort_order INTEGER;
                ALTER TABLE words ALTER COLUMN next_review SET DEFAULT NOW() + INTERVAL '7 days';
                ALTER TABLE words DROP COLUMN IF EXISTS phonetic;
                ALTER TABLE words DROP CONSTRAINT IF EXISTS words_word_key;

                CREATE UNIQUE INDEX IF NOT EXISTS ux_words_user_word
                    ON words (user_id, lower(word));

                CREATE TABLE IF NOT EXISTS quiz_history (
                    id          SERIAL PRIMARY KEY,
                    word_id     INTEGER,
                    result      BOOLEAN,
                    reviewed_at TIMESTAMP DEFAULT NOW()
                );
                ALTER TABLE quiz_history DROP CONSTRAINT IF EXISTS quiz_history_word_id_fkey;

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
                    completed_at    TIMESTAMP
                );

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
                );
                CREATE INDEX IF NOT EXISTS ix_quiz_question_results_user_created
                    ON quiz_question_results (user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS ix_quiz_question_results_session
                    ON quiz_question_results (session_id);

                CREATE TABLE IF NOT EXISTS labels (
                    id          SERIAL PRIMARY KEY,
                    user_id     UUID NOT NULL,
                    name        TEXT NOT NULL,
                    created_at  TIMESTAMP DEFAULT NOW()
                );

                -- 라벨도 사용자별로 전환
                ALTER TABLE labels ADD COLUMN IF NOT EXISTS user_id UUID;
                ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_name_key;
                DELETE FROM labels WHERE user_id IS NULL;  -- 기존 전역 라벨 정리(사용자별로 재시드)
                CREATE UNIQUE INDEX IF NOT EXISTS ux_labels_user_name
                    ON labels (user_id, name);
            """)
            # sort_order 백필: 기존 행은 사용자별 최근 저장순(현재 화면 순서)을 0,1,2…로 부여
            cur.execute("""
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
                WHERE w.id = r.id;
            """)
        # 기본 라벨은 사용자가 처음 접근할 때(get_labels) 사용자별로 시드한다.
        conn.commit()

def is_word_saved(user_id: str, word: str) -> bool:
    if not word or not word.strip():
        return False
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM words WHERE user_id = %s AND lower(word) = lower(%s)",
                (user_id, word.strip()),
            )
            return cur.fetchone() is not None

def save_word(user_id, word, korean, korean_detail, english_def, example, tag):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM words WHERE user_id = %s AND lower(word) = lower(%s)",
                (user_id, word),
            )
            row = cur.fetchone()
            if row:
                # 이미 있으면 예문/태그/한국어 상세를 최신값으로 갱신
                cur.execute(
                    """UPDATE words
                       SET korean = %s,
                           english_def = %s,
                           example = %s,
                           tag = %s,
                           korean_detail = %s
                       WHERE id = %s AND user_id = %s""",
                    (korean, english_def, example, tag, korean_detail, row[0], user_id),
                )
                conn.commit()
                return "✏️ 단어 정보를 업데이트했어요!"
            # 새 단어는 목록 맨 위에 오도록 가장 작은 sort_order 부여
            cur.execute(
                "SELECT COALESCE(MIN(sort_order), 0) - 1 FROM words WHERE user_id = %s",
                (user_id,),
            )
            next_order = cur.fetchone()[0]
            cur.execute("""
                INSERT INTO words
                    (user_id, word, korean, korean_detail, english_def, example, tag, sort_order, next_review)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW() + INTERVAL '7 days')
            """, (user_id, word, korean, korean_detail, english_def, example, tag, next_order))
        conn.commit()
    return "✅ 단어장에 저장됐어요!"

def bulk_import_words(user_id: str, items, default_tag: str = "미지정") -> dict:
    """CSV/XLSX에서 읽은 (영어, 한국어) 목록을 일괄 저장.
    영어단어·한국어만 채우고 예문/상세는 빈값, 태그는 default_tag,
    복습일은 NOW()+7일. 이미 있는 단어는 건드리지 않고 건너뛴다(사용자 편집 보호)."""
    added = skipped = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 새로 넣을 것만 추림 (DB 기존 단어 + 같은 파일 내 중복 모두 스킵)
            to_insert: list[tuple[str, str]] = []
            seen: set[str] = set()
            for word, korean in items:
                w = (word or "").strip()
                if not w or w.lower() in seen:
                    if w:
                        skipped += 1
                    continue
                cur.execute(
                    "SELECT id FROM words WHERE user_id = %s AND lower(word) = lower(%s)",
                    (user_id, w),
                )
                if cur.fetchone():
                    skipped += 1
                    continue
                seen.add(w.lower())
                to_insert.append((w, (korean or "").strip()))

            # 가져온 단어들은 기존 단어 위쪽에, 파일 순서를 유지하며 배치
            cur.execute(
                "SELECT COALESCE(MIN(sort_order), 0) FROM words WHERE user_id = %s",
                (user_id,),
            )
            base = cur.fetchone()[0]
            n = len(to_insert)
            for i, (w, k) in enumerate(to_insert):
                cur.execute(
                    """INSERT INTO words
                           (user_id, word, korean, korean_detail, english_def,
                            example, tag, sort_order, next_review)
                       VALUES (%s, %s, %s, '', '', '', %s, %s, NOW() + INTERVAL '7 days')""",
                    (user_id, w.lower(), k, default_tag, base - n + i),
                )
                added += 1
        conn.commit()
    return {"added": added, "skipped": skipped, "total": added + skipped}


def existing_words_lower(user_id: str) -> set:
    """사용자가 이미 가진 단어(소문자) 집합 — 가져오기 미리보기의 중복 표시용."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT lower(word) FROM words WHERE user_id = %s", (user_id,))
            return {r[0] for r in cur.fetchall()}


def insert_words(user_id: str, items) -> dict:
    """미리보기에서 편집된 행들을 저장. 각 item: dict
    {word, korean, korean_detail?, english_def?, example?, tag?}.
    이미 있는 단어(및 같은 배치 내 중복)는 건너뛴다. 새 단어는 목록 위쪽에 배치."""
    added = skipped = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 기존 단어(소문자)를 한 번에 조회해 중복은 파이썬에서 거른다 (행별 SELECT 제거)
            cur.execute("SELECT lower(word) FROM words WHERE user_id = %s", (user_id,))
            existing = {r[0] for r in cur.fetchall()}

            to_insert = []
            seen: set = set()
            for it in items:
                w = (it.get("word") or "").strip()
                if not w:
                    continue
                lw = w.lower()
                if lw in existing or lw in seen:
                    skipped += 1
                    continue
                seen.add(lw)
                to_insert.append({**it, "word": w})

            if not to_insert:
                conn.commit()
                return {"added": 0, "skipped": skipped, "total": skipped}

            cur.execute(
                "SELECT COALESCE(MIN(sort_order), 0) FROM words WHERE user_id = %s",
                (user_id,),
            )
            base = cur.fetchone()[0]
            n = len(to_insert)
            words_arr = [it["word"].lower() for it in to_insert]
            koreans = [(it.get("korean") or "").strip() for it in to_insert]
            kds = [it.get("korean_detail") or "" for it in to_insert]
            eds = [it.get("english_def") or "" for it in to_insert]
            exs = [it.get("example") or "" for it in to_insert]
            tags = [it.get("tag") or "미지정" for it in to_insert]
            sos = [base - n + i for i in range(n)]
            # 한 번의 INSERT ... SELECT unnest 로 전부 삽입 (DB 왕복 1회)
            cur.execute(
                """INSERT INTO words
                       (user_id, word, korean, korean_detail, english_def,
                        example, tag, sort_order, next_review)
                   SELECT %s, v.word, v.korean, v.kd, v.ed, v.ex, v.tag, v.so,
                          NOW() + INTERVAL '7 days'
                   FROM unnest(
                            %s::text[], %s::text[], %s::text[], %s::text[],
                            %s::text[], %s::text[], %s::int[]
                        ) AS v(word, korean, kd, ed, ex, tag, so)""",
                (user_id, words_arr, koreans, kds, eds, exs, tags, sos),
            )
            added = cur.rowcount
        conn.commit()
    return {"added": added, "skipped": skipped, "total": added + skipped}


def get_all_words(user_id: str, tag: str | None = None):
    cols = """id, word, korean, korean_detail, english_def, example,
              tag, created_at, next_review, sort_order"""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            if tag:
                cur.execute(
                    f"""SELECT {cols}
                        FROM words
                        WHERE user_id = %s AND tag = %s
                        ORDER BY sort_order ASC NULLS LAST, created_at DESC""",
                    (user_id, tag),
                )
            else:
                cur.execute(
                    f"""SELECT {cols}
                        FROM words
                        WHERE user_id = %s
                        ORDER BY sort_order ASC NULLS LAST, created_at DESC""",
                    (user_id,),
                )
            return [dict(row) for row in cur.fetchall()]


def get_words_for_quiz(
    user_id: str,
    mode: str = "random",
    tag: str = "",
    saved_from: str = "",
    saved_to: str = "",
    limit: int = 50,
):
    """퀴즈 목표 설정에 맞는 후보 단어를 가져온다.

    TODO: 복습 스케줄 기반 출제로 되돌릴 때 next_review 조건을 옵션으로 추가한다.
    """
    mode = (mode or "random").strip()
    limit = max(1, min(int(limit or 50), 100))
    clauses = ["user_id = %s"]
    params: list = [user_id]
    if mode == "tag" and tag:
        clauses.append("tag = %s")
        params.append(tag)
    if mode == "saved_date":
        if saved_from:
            clauses.append("created_at::date >= %s")
            params.append(saved_from)
        if saved_to:
            clauses.append("created_at::date <= %s")
            params.append(saved_to)

    order_by = "RANDOM()" if mode == "random" else "sort_order ASC NULLS LAST, created_at DESC"
    params.append(limit)
    cols = """id, word, korean, korean_detail, english_def, example,
              tag, created_at, next_review, sort_order"""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                f"""SELECT {cols}
                    FROM words
                    WHERE {' AND '.join(clauses)}
                    ORDER BY {order_by}
                    LIMIT %s""",
                params,
            )
            return [dict(row) for row in cur.fetchall()]


def create_quiz_session(user_id: str, goal: dict, question_count: int) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO quiz_sessions
                       (user_id, mode, tag, saved_from, saved_to, instruction, question_count)
                   VALUES (%s, %s, %s, NULLIF(%s, '')::date, NULLIF(%s, '')::date, %s, %s)
                   RETURNING id""",
                (
                    user_id,
                    goal.get("mode") or "random",
                    goal.get("tag") or "",
                    goal.get("saved_from") or "",
                    goal.get("saved_to") or "",
                    goal.get("instruction") or "",
                    question_count,
                ),
            )
            session_id = cur.fetchone()[0]
        conn.commit()
    return session_id


def complete_quiz_session(user_id: str, session_id: int, score: float, total: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE quiz_sessions
                   SET score = %s, total_questions = %s, completed_at = NOW()
                   WHERE id = %s AND user_id = %s""",
                (score, total, session_id, user_id),
            )
        conn.commit()


def save_quiz_question_results(user_id: str, session_id: int, results: list[dict]) -> None:
    if not results:
        return
    with get_conn() as conn:
        with conn.cursor() as cur:
            for result in results:
                cur.execute(
                    """INSERT INTO quiz_question_results
                           (session_id, user_id, word_id, source_word_id, source_word,
                            target_word, question_type, difficulty, prompt, user_answer,
                            correct_answer, status, correct, score, confidence, feedback,
                            is_derived, derived_from_word_id, suggested_word,
                            suggested_korean, suggested_english_def, suggested_example,
                            suggested_tag)
                       VALUES
                           (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        session_id,
                        user_id,
                        result.get("word_id"),
                        result.get("source_word_id"),
                        result.get("source_word") or "",
                        result.get("target_word") or "",
                        result.get("question_type") or "",
                        result.get("difficulty") or "",
                        result.get("prompt") or "",
                        result.get("user_answer") or "",
                        result.get("correct_answer") or "",
                        result.get("status") or "",
                        result.get("correct"),
                        result.get("score", 0),
                        result.get("confidence", 1),
                        result.get("feedback") or "",
                        result.get("is_derived", False),
                        result.get("derived_from_word_id"),
                        result.get("suggested_word") or "",
                        result.get("suggested_korean") or "",
                        result.get("suggested_english_def") or "",
                        result.get("suggested_example") or "",
                        result.get("suggested_tag") or "미지정",
                    ),
                )
        conn.commit()

def update_word(user_id: str, word_id: int, korean_detail, english_def,
                example, tag, next_review) -> bool:
    """단어 행 개별 편집. 영어단어(word)·한국어(korean)는 변경하지 않는다.
    편집 가능: 한국어 상세 / 영어뜻 / 예문 / 태그 / 다음 복습일.
    next_review 는 'YYYY-MM-DD' 문자열(또는 빈값=변경 안 함)."""
    sets = [
        "korean_detail = %s",
        "english_def = %s",
        "example = %s",
        "tag = %s",
    ]
    params = [korean_detail, english_def, example, (tag or "미지정")]
    if next_review:
        sets.append("next_review = %s")
        params.append(next_review)
    params.extend([word_id, user_id])
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE words SET {', '.join(sets)} "
                "WHERE id = %s AND user_id = %s",
                params,
            )
            changed = cur.rowcount
        conn.commit()
    return changed > 0


def delete_word(user_id: str, word_id: int) -> bool:
    """단어 행 개별 삭제 (본인 소유만)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM words WHERE id = %s AND user_id = %s",
                (word_id, user_id),
            )
            changed = cur.rowcount
        conn.commit()
    return changed > 0


# 복습일 상대기간 코드 → Postgres INTERVAL (월말·윤년은 INTERVAL이 자동 처리)
REVIEW_INTERVALS = {
    "1d": "1 day",
    "1w": "7 days",
    "1m": "1 month",
    "3m": "3 months",
}


def bulk_update_words(user_id: str, items) -> int:
    """여러 단어를 한 번에 편집. 각 item: {id, korean_detail, english_def,
    example, tag, next_review}. word·korean은 변경하지 않음.
    next_review 는 상대기간 코드('1d'/'1w'/'1m'/'3m') → NOW()+INTERVAL,
    빈값이면 복습일 변경 안 함. (예전 'YYYY-MM-DD' 문자열도 그대로 허용)"""
    ids, kds, eds, exs, tags, nrs = [], [], [], [], [], []
    for it in items:
        try:
            wid = int(it["id"])
        except (KeyError, TypeError, ValueError):
            continue
        ids.append(wid)
        kds.append(it.get("korean_detail", "") or "")
        eds.append(it.get("english_def", "") or "")
        exs.append(it.get("example", "") or "")
        tags.append(it.get("tag") or "미지정")
        nrs.append((it.get("next_review") or "").strip())
    if not ids:
        return 0
    # 행마다 다른 값 + 복습일 코드를 한 번의 UPDATE(unnest)로 처리 → DB 왕복 1회.
    # 복습일: 코드는 NOW()+INTERVAL(월말·윤년 자동), ''는 변경 안 함, 그 외는 날짜로 해석.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE words AS w
                   SET korean_detail = v.kd,
                       english_def = v.ed,
                       example = v.ex,
                       tag = v.tag,
                       next_review = CASE v.nr
                           WHEN '1d' THEN NOW() + INTERVAL '1 day'
                           WHEN '1w' THEN NOW() + INTERVAL '7 days'
                           WHEN '1m' THEN NOW() + INTERVAL '1 month'
                           WHEN '3m' THEN NOW() + INTERVAL '3 months'
                           WHEN '' THEN w.next_review
                           ELSE v.nr::timestamp
                       END
                   FROM unnest(
                            %s::int[], %s::text[], %s::text[],
                            %s::text[], %s::text[], %s::text[]
                        ) AS v(id, kd, ed, ex, tag, nr)
                   WHERE w.id = v.id AND w.user_id = %s""",
                (ids, kds, eds, exs, tags, nrs, user_id),
            )
            updated = cur.rowcount
        conn.commit()
    return updated


def bulk_delete_words(user_id: str, ids) -> int:
    """체크된 여러 단어를 한 번에 삭제 (본인 소유만)."""
    clean = []
    for i in ids or []:
        try:
            clean.append(int(i))
        except (TypeError, ValueError):
            continue
    if not clean:
        return 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM words WHERE user_id = %s AND id = ANY(%s)",
                (user_id, clean),
            )
            deleted = cur.rowcount
        conn.commit()
    return deleted


def reorder_words(user_id: str, ordered_ids) -> int:
    """드래그로 바뀐 순서를 저장. ordered_ids는 위→아래 단어 id 목록.
    각 단어의 sort_order를 목록 인덱스(0,1,2…)로 갱신한다.
    단어 수만큼 UPDATE를 보내면 원격 DB 왕복이 그만큼 늘어 느리므로,
    unnest로 한 번의 UPDATE에 모아 1회 왕복으로 처리한다."""
    ids, orders = [], []
    for idx, wid in enumerate(ordered_ids or []):
        try:
            ids.append(int(wid))
            orders.append(idx)
        except (TypeError, ValueError):
            continue
    if not ids:
        return 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE words AS w
                   SET sort_order = v.ord
                   FROM unnest(%s::int[], %s::int[]) AS v(id, ord)
                   WHERE w.id = v.id AND w.user_id = %s""",
                (ids, orders, user_id),
            )
            updated = cur.rowcount
        conn.commit()
    return updated


def get_words_to_review(user_id: str):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("""
                SELECT * FROM words
                WHERE user_id = %s AND next_review <= NOW()
                ORDER BY next_review ASC
            """, (user_id,))
            return [dict(row) for row in cur.fetchall()]

def update_review(user_id: str, word_id: int, correct: bool):
    """퀴즈 결과에 따라 다음 복습일을 조정한다.

    정답은 기본 한 달 뒤, 오답은 가까운 복습을 위해 하루 뒤로 보낸다.
    """
    days = 30 if correct else 1
    next_review = datetime.now() + timedelta(days=days)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE words SET next_review = %s WHERE id = %s AND user_id = %s",
                (next_review, word_id, user_id)
            )
            if cur.rowcount == 0:
                conn.commit()
                return
            cur.execute(
                "INSERT INTO quiz_history (word_id, result) VALUES (%s, %s)",
                (word_id, correct)
            )
        conn.commit()


# ── 라벨(카테고리) — 사용자별 ──────────────────────────────
def _seed_default_labels(user_id: str) -> None:
    """해당 사용자에게 기본 태그를 1회 시드 (이미 있으면 무시)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            for name in DEFAULT_LABELS:
                cur.execute(
                    "INSERT INTO labels (user_id, name) VALUES (%s, %s) "
                    "ON CONFLICT (user_id, name) DO NOTHING",
                    (user_id, name),
                )
        conn.commit()


def get_labels(user_id: str) -> list[str]:
    def _fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT name FROM labels WHERE user_id = %s "
                    "ORDER BY (name = '미지정') DESC, id ASC",
                    (user_id,),
                )
                return [r[0] for r in cur.fetchall()]

    rows = _fetch()
    if not rows:
        _seed_default_labels(user_id)  # 첫 사용 → 기본 태그 시드
        rows = _fetch()
    return rows


def add_label(user_id: str, name: str) -> tuple[list[str], bool]:
    """라벨 추가. (전체 라벨 목록, 성공여부). 이미 있으면 성공, MAX_LABELS 초과 시 거부."""
    name = (name or "").strip()
    existing = get_labels(user_id)
    if not name:
        return existing, False
    if name in existing:
        return existing, True
    if len(existing) >= MAX_LABELS:
        return existing, False
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO labels (user_id, name) VALUES (%s, %s) "
                "ON CONFLICT (user_id, name) DO NOTHING",
                (user_id, name),
            )
        conn.commit()
    return get_labels(user_id), True


def count_words_by_tag(user_id: str, tag: str) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM words WHERE user_id = %s AND tag = %s",
                (user_id, tag),
            )
            return cur.fetchone()[0]


def rename_label(user_id: str, old: str, new: str) -> tuple[list[str], bool, str]:
    """태그 이름 변경 + 해당 사용자의 그 태그 단어들의 tag 값도 일괄 변경."""
    old = (old or "").strip()
    new = (new or "").strip()
    if not old or not new:
        return get_labels(user_id), False, "태그 이름이 비어 있습니다."
    if old == "미지정":
        return get_labels(user_id), False, "'미지정' 태그는 변경할 수 없습니다."
    existing = get_labels(user_id)
    if old not in existing:
        return existing, False, "존재하지 않는 태그입니다."
    if new == old:
        return existing, True, "변경 사항이 없습니다."
    if new in existing:
        return existing, False, "이미 있는 태그 이름입니다."
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE labels SET name = %s WHERE user_id = %s AND name = %s",
                (new, user_id, old),
            )
            cur.execute(
                "UPDATE words SET tag = %s WHERE user_id = %s AND tag = %s",
                (new, user_id, old),
            )
        conn.commit()
    return get_labels(user_id), True, "변경되었습니다."


def delete_label(user_id: str, name: str) -> tuple[list[str], bool, str, int]:
    """태그 삭제 + 해당 사용자의 그 태그 단어들도 함께 삭제.
    '미지정'은 삭제 불가, 최소 1개의 태그는 남겨야 함."""
    name = (name or "").strip()
    if name == "미지정":
        return get_labels(user_id), False, "'미지정' 태그는 삭제할 수 없습니다.", 0
    existing = get_labels(user_id)
    if name not in existing:
        return existing, False, "존재하지 않는 태그입니다.", 0
    if len(existing) <= 1:
        return existing, False, "최소 1개의 태그는 있어야 합니다.", 0
    deleted = count_words_by_tag(user_id, name)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM words WHERE user_id = %s AND tag = %s", (user_id, name))
            cur.execute("DELETE FROM labels WHERE user_id = %s AND name = %s", (user_id, name))
        conn.commit()
    return get_labels(user_id), True, "삭제되었습니다.", deleted

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

                CREATE TABLE IF NOT EXISTS labels (
                    id          SERIAL PRIMARY KEY,
                    name        TEXT NOT NULL UNIQUE,
                    created_at  TIMESTAMP DEFAULT NOW()
                );
            """)
            # 기본 라벨 시드 (이미 있으면 무시)
            for name in DEFAULT_LABELS:
                cur.execute(
                    "INSERT INTO labels (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
                    (name,),
                )
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
            cur.execute("""
                INSERT INTO words
                    (user_id, word, korean, korean_detail, english_def, example, tag, next_review)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW() + INTERVAL '7 days')
            """, (user_id, word, korean, korean_detail, english_def, example, tag))
        conn.commit()
    return "✅ 단어장에 저장됐어요!"

def get_all_words(user_id: str, tag: str | None = None):
    cols = """id, word, korean, korean_detail, english_def, example,
              tag, created_at, next_review"""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            if tag:
                cur.execute(
                    f"""SELECT {cols}
                        FROM words
                        WHERE user_id = %s AND tag = %s
                        ORDER BY created_at DESC""",
                    (user_id, tag),
                )
            else:
                cur.execute(
                    f"""SELECT {cols}
                        FROM words
                        WHERE user_id = %s
                        ORDER BY created_at DESC""",
                    (user_id,),
                )
            return [dict(row) for row in cur.fetchall()]

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
    days = 7 if correct else 1
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


# ── 라벨(카테고리) ──────────────────────────────────────────
def get_labels() -> list[str]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT name FROM labels "
                "ORDER BY (name = '미지정') DESC, id ASC"
            )
            return [r[0] for r in cur.fetchall()]


def add_label(name: str) -> tuple[list[str], bool]:
    """라벨 추가. (전체 라벨 목록, 성공여부)를 반환.
    이미 있는 이름이면 성공으로 간주, 최대 개수(MAX_LABELS) 초과 시 거부."""
    name = (name or "").strip()
    existing = get_labels()
    if not name:
        return existing, False
    if name in existing:
        return existing, True  # 이미 있으면 idempotent 성공
    if len(existing) >= MAX_LABELS:
        return existing, False  # 개수 초과 → 거부
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO labels (name) VALUES (%s) ON CONFLICT (name) DO NOTHING",
                (name,),
            )
        conn.commit()
    return get_labels(), True


def count_words_by_tag(tag: str) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM words WHERE tag = %s", (tag,))
            return cur.fetchone()[0]


def rename_label(old: str, new: str) -> tuple[list[str], bool, str]:
    """태그 이름 변경 + 해당 태그를 쓰는 단어들의 tag 값도 일괄 변경."""
    old = (old or "").strip()
    new = (new or "").strip()
    if not old or not new:
        return get_labels(), False, "태그 이름이 비어 있습니다."
    if old == "미지정":
        return get_labels(), False, "'미지정' 태그는 변경할 수 없습니다."
    existing = get_labels()
    if old not in existing:
        return existing, False, "존재하지 않는 태그입니다."
    if new == old:
        return existing, True, "변경 사항이 없습니다."
    if new in existing:
        return existing, False, "이미 있는 태그 이름입니다."
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE labels SET name = %s WHERE name = %s", (new, old))
            cur.execute("UPDATE words SET tag = %s WHERE tag = %s", (new, old))
        conn.commit()
    return get_labels(), True, "변경되었습니다."


def delete_label(name: str) -> tuple[list[str], bool, str, int]:
    """태그 삭제 + 해당 태그를 쓰는 단어들도 함께 삭제.
    '미지정'은 삭제 불가, 최소 1개의 태그는 남겨야 함."""
    name = (name or "").strip()
    if name == "미지정":
        return get_labels(), False, "'미지정' 태그는 삭제할 수 없습니다.", 0
    existing = get_labels()
    if name not in existing:
        return existing, False, "존재하지 않는 태그입니다.", 0
    if len(existing) <= 1:
        return existing, False, "최소 1개의 태그는 있어야 합니다.", 0
    deleted = count_words_by_tag(name)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM words WHERE tag = %s", (name,))
            cur.execute("DELETE FROM labels WHERE name = %s", (name,))
        conn.commit()
    return get_labels(), True, "삭제되었습니다.", deleted

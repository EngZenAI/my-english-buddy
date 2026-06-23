import os
import urllib.parse
from importlib import import_module
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import Depends
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from backend.config import settings

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env", encoding='utf-8-sig')

DATABASE_URL = os.getenv("DATABASE_URL")


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


def get_conn():
    # URL 방식 대신 직접 파라미터로 연결
    result = urllib.parse.urlparse(DATABASE_URL)
    return psycopg2.connect(
        host=result.hostname,
        port=result.port,
        database=result.path[1:],  # 앞의 '/' 제거
        user=result.username,
        password=result.password
    )

def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS words (
                    id          SERIAL PRIMARY KEY,
                    word        TEXT NOT NULL UNIQUE,
                    korean      TEXT,
                    english_def TEXT,
                    example     TEXT,
                    phonetic    TEXT,
                    context     TEXT,
                    created_at  TIMESTAMP DEFAULT NOW(),
                    next_review TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS quiz_history (
                    id          SERIAL PRIMARY KEY,
                    word_id     INTEGER REFERENCES words(id),
                    result      BOOLEAN,
                    reviewed_at TIMESTAMP DEFAULT NOW()
                );
            """)
        conn.commit()

def save_word(word, korean, english_def, example, phonetic, context):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM words WHERE word = %s", (word,))
            if cur.fetchone():
                return "⚠️ 이미 단어장에 있는 단어예요!"
            cur.execute("""
                INSERT INTO words (word, korean, english_def, example, phonetic, context)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (word, korean, english_def, example, phonetic, context))
        conn.commit()
    return "✅ 단어장에 저장됐어요!"

def get_all_words():
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("""
                SELECT word, korean, english_def, example,
                       phonetic, context, next_review
                FROM words
                ORDER BY created_at DESC
            """)
            return [dict(row) for row in cur.fetchall()]

def get_words_to_review():
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("""
                SELECT * FROM words
                WHERE next_review <= NOW()
                ORDER BY next_review ASC
            """)
            return [dict(row) for row in cur.fetchall()]

def update_review(word_id: int, correct: bool):
    days = 7 if correct else 1
    next_review = datetime.now() + timedelta(days=days)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE words SET next_review = %s WHERE id = %s",
                (next_review, word_id)
            )
            cur.execute(
                "INSERT INTO quiz_history (word_id, result) VALUES (%s, %s)",
                (word_id, correct)
            )
        conn.commit()
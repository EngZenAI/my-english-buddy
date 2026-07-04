from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, Integer, Text, func
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.base import Base


class ArticleSource(Base):
    __tablename__ = "article_sources"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    domains: Mapped[list | None] = mapped_column(JSONB, server_default=sql_text("'[]'::jsonb"))
    default_topic: Mapped[str | None] = mapped_column(Text)
    fallback_image_url: Mapped[str | None] = mapped_column(Text)
    feed_url: Mapped[str | None] = mapped_column(Text)
    site_url: Mapped[str | None] = mapped_column(Text)
    license_status: Mapped[str | None] = mapped_column(Text, server_default=sql_text("'pending'"))
    is_active: Mapped[bool | None] = mapped_column(Boolean, server_default=sql_text("TRUE"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_key: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    topic: Mapped[str | None] = mapped_column(Text)
    level: Mapped[str | None] = mapped_column(Text)
    is_published: Mapped[bool | None] = mapped_column(Boolean, server_default=sql_text("FALSE"))
    description: Mapped[str | None] = mapped_column(Text)
    content_snippet: Mapped[str | None] = mapped_column(Text)
    extracted_text: Mapped[str | None] = mapped_column(Text)
    extraction_status: Mapped[str | None] = mapped_column(Text)
    feed_entry_id: Mapped[str | None] = mapped_column(Text)
    license_status: Mapped[str | None] = mapped_column(Text, server_default=sql_text("'pending'"))
    collection_method: Mapped[str | None] = mapped_column(Text, server_default=sql_text("'manual'"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ux_articles_url", Article.url, unique=True)
Index(
    "ix_articles_published_topic",
    Article.is_published,
    Article.topic,
    Article.published_at.desc(),
    Article.id.desc(),
)


class ArticleChunk(Base):
    __tablename__ = "article_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    article_id: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int | None] = mapped_column(Integer, server_default=sql_text("0"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ux_article_chunks_article_index", ArticleChunk.article_id, ArticleChunk.chunk_index, unique=True)
Index("ix_article_chunks_article", ArticleChunk.article_id, ArticleChunk.chunk_index)


class ArticleSession(Base):
    __tablename__ = "article_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    article_id: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str | None] = mapped_column(Text, server_default=sql_text("'started'"))
    current_chunk: Mapped[int | None] = mapped_column(Integer, server_default=sql_text("0"))
    study_json: Mapped[dict | None] = mapped_column(JSONB, server_default=sql_text("'{}'::jsonb"))
    completion_json: Mapped[dict | None] = mapped_column(JSONB, server_default=sql_text("'{}'::jsonb"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ix_article_sessions_user_created", ArticleSession.user_id, ArticleSession.created_at.desc())
Index("ix_article_sessions_article", ArticleSession.article_id)


class ArticleRefreshJob(Base):
    __tablename__ = "article_refresh_jobs"

    job_id: Mapped[str] = mapped_column(Text, primary_key=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    ok: Mapped[bool | None] = mapped_column(Boolean, server_default=sql_text("FALSE"))
    source_key: Mapped[str | None] = mapped_column(Text)
    total_sources: Mapped[int | None] = mapped_column(Integer, server_default=sql_text("0"))
    completed_sources: Mapped[int | None] = mapped_column(Integer, server_default=sql_text("0"))
    current_source: Mapped[str | None] = mapped_column(Text)
    saved: Mapped[int | None] = mapped_column(Integer, server_default=sql_text("0"))
    skipped: Mapped[int | None] = mapped_column(Integer, server_default=sql_text("0"))
    results: Mapped[list | None] = mapped_column(JSONB, server_default=sql_text("'[]'::jsonb"))
    error: Mapped[str | None] = mapped_column(Text)
    message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ix_article_refresh_jobs_status_created", ArticleRefreshJob.status, ArticleRefreshJob.created_at.desc())

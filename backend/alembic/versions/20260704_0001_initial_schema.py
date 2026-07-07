"""Initial Alembic baseline schema.

Revision ID: 20260704_0001
Revises: None
Create Date: 2026-07-04 00:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260704_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("hashed_password", sa.String(length=1024), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("is_superuser", sa.Boolean(), nullable=False),
        sa.Column("is_verified", sa.Boolean(), nullable=False),
        sa.Column("avatar_url", sa.Text()),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "access_tokens",
        sa.Column("token", sa.String(length=43), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_access_tokens_created_at", "access_tokens", ["created_at"])

    op.create_table(
        "oauth_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("oauth_name", sa.String(length=100), nullable=False),
        sa.Column("access_token", sa.String(length=1024), nullable=False),
        sa.Column("expires_at", sa.Integer()),
        sa.Column("refresh_token", sa.String(length=1024)),
        sa.Column("account_id", sa.String(length=320), nullable=False),
        sa.Column("account_email", sa.String(length=320), nullable=False),
    )
    op.create_index("ix_oauth_accounts_account_id", "oauth_accounts", ["account_id"])
    op.create_index("ix_oauth_accounts_oauth_name", "oauth_accounts", ["oauth_name"])

    op.create_table(
        "password_reset_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_password_reset_codes_email", "password_reset_codes", ["email"])
    op.create_index("ix_password_reset_codes_user_id", "password_reset_codes", ["user_id"])

    op.create_table(
        "words",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("word", sa.Text(), nullable=False),
        sa.Column("korean", sa.Text()),
        sa.Column("korean_detail", sa.Text()),
        sa.Column("english_def", sa.Text()),
        sa.Column("example", sa.Text()),
        sa.Column("tag", sa.Text()),
        sa.Column("sort_order", sa.Integer()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("next_review", sa.DateTime(), server_default=sa.text("NOW() + INTERVAL '7 days'")),
    )
    op.create_index("ux_words_user_word", "words", ["user_id", sa.text("lower(word)")], unique=True)

    op.create_table(
        "quiz_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("word_id", sa.Integer()),
        sa.Column("result", sa.Boolean()),
        sa.Column("reviewed_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "quiz_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("tag", sa.Text()),
        sa.Column("saved_from", sa.Date()),
        sa.Column("saved_to", sa.Date()),
        sa.Column("instruction", sa.Text()),
        sa.Column("question_count", sa.Integer(), server_default=sa.text("10")),
        sa.Column("total_questions", sa.Integer(), server_default=sa.text("0")),
        sa.Column("score", sa.Numeric(), server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime()),
        sa.Column("review_applied_at", sa.DateTime()),
        sa.Column("questions_json", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
    )

    op.create_table(
        "quiz_question_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("word_id", sa.Integer()),
        sa.Column("source_word_id", sa.Integer()),
        sa.Column("source_word", sa.Text()),
        sa.Column("question_id", sa.Text()),
        sa.Column("target_word", sa.Text()),
        sa.Column("question_type", sa.Text()),
        sa.Column("difficulty", sa.Text()),
        sa.Column("prompt", sa.Text()),
        sa.Column("user_answer", sa.Text()),
        sa.Column("correct_answer", sa.Text()),
        sa.Column("selected_choice_id", sa.Text()),
        sa.Column("correct_choice_id", sa.Text()),
        sa.Column("status", sa.Text()),
        sa.Column("correct", sa.Boolean()),
        sa.Column("score", sa.Numeric(), server_default=sa.text("0")),
        sa.Column("confidence", sa.Numeric(), server_default=sa.text("1")),
        sa.Column("feedback", sa.Text()),
        sa.Column("is_derived", sa.Boolean(), server_default=sa.text("FALSE")),
        sa.Column("derived_from_word_id", sa.Integer()),
        sa.Column("suggested_word", sa.Text()),
        sa.Column("suggested_korean", sa.Text()),
        sa.Column("suggested_english_def", sa.Text()),
        sa.Column("suggested_example", sa.Text()),
        sa.Column("suggested_tag", sa.Text()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_quiz_question_results_user_created",
        "quiz_question_results",
        ["user_id", sa.text("created_at DESC")],
    )
    op.create_index("ix_quiz_question_results_session", "quiz_question_results", ["session_id"])

    op.create_table(
        "labels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ux_labels_user_name", "labels", ["user_id", "name"], unique=True)

    op.create_table(
        "roleplay_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("level", sa.Text()),
        sa.Column("scenario", sa.Text()),
        sa.Column("tag", sa.Text()),
        sa.Column("situation", sa.Text()),
        sa.Column("title", sa.Text()),
        sa.Column("turns", sa.Integer(), server_default=sa.text("0")),
        sa.Column("summary", sa.Text()),
        sa.Column("expressions", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
        sa.Column("vocab", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_roleplay_sessions_user_created",
        "roleplay_sessions",
        ["user_id", sa.text("created_at DESC")],
    )

    op.create_table(
        "roleplay_tts_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cache_key", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("voice", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("audio_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text(), server_default=sa.text("'audio/wav'")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index(
        "ux_roleplay_tts_user_cache",
        "roleplay_tts_cache",
        ["user_id", "cache_key"],
        unique=True,
    )
    op.create_index(
        "ix_roleplay_tts_user_last_used",
        "roleplay_tts_cache",
        ["user_id", sa.text("last_used_at DESC")],
    )

    op.create_table(
        "agent_memories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value_json", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ux_agent_memories_user_key", "agent_memories", ["user_id", "key"], unique=True)

    op.create_table(
        "agent_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'queued'")),
        sa.Column("progress_current", sa.Integer(), server_default=sa.text("0")),
        sa.Column("progress_total", sa.Integer(), server_default=sa.text("0")),
        sa.Column("message", sa.Text()),
        sa.Column("result_json", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb")),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_agent_jobs_user_created", "agent_jobs", ["user_id", "created_at"])

    op.create_table(
        "article_sources",
        sa.Column("key", sa.Text(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("domains", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
        sa.Column("default_topic", sa.Text()),
        sa.Column("fallback_image_url", sa.Text()),
        sa.Column("feed_url", sa.Text()),
        sa.Column("site_url", sa.Text()),
        sa.Column("license_status", sa.Text(), server_default=sa.text("'pending'")),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("TRUE")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )

    op.create_table(
        "articles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_key", sa.Text()),
        sa.Column("source", sa.Text()),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("image_url", sa.Text()),
        sa.Column("published_at", sa.DateTime()),
        sa.Column("topic", sa.Text()),
        sa.Column("level", sa.Text()),
        sa.Column("is_published", sa.Boolean(), server_default=sa.text("FALSE")),
        sa.Column("description", sa.Text()),
        sa.Column("content_snippet", sa.Text()),
        sa.Column("extracted_text", sa.Text()),
        sa.Column("extraction_status", sa.Text()),
        sa.Column("feed_entry_id", sa.Text()),
        sa.Column("license_status", sa.Text(), server_default=sa.text("'pending'")),
        sa.Column("collection_method", sa.Text(), server_default=sa.text("'manual'")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ux_articles_url", "articles", ["url"], unique=True)
    op.create_index(
        "ix_articles_published_topic",
        "articles",
        ["is_published", "topic", sa.text("published_at DESC"), sa.text("id DESC")],
    )

    op.create_table(
        "article_chunks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index(
        "ux_article_chunks_article_index",
        "article_chunks",
        ["article_id", "chunk_index"],
        unique=True,
    )
    op.create_index("ix_article_chunks_article", "article_chunks", ["article_id", "chunk_index"])

    op.create_table(
        "article_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("article_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'started'")),
        sa.Column("current_chunk", sa.Integer(), server_default=sa.text("0")),
        sa.Column("study_json", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb")),
        sa.Column("completion_json", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_article_sessions_user_created",
        "article_sessions",
        ["user_id", sa.text("created_at DESC")],
    )
    op.create_index("ix_article_sessions_article", "article_sessions", ["article_id"])

    op.create_table(
        "article_refresh_jobs",
        sa.Column("job_id", sa.Text(), primary_key=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("ok", sa.Boolean(), server_default=sa.text("FALSE")),
        sa.Column("source_key", sa.Text()),
        sa.Column("total_sources", sa.Integer(), server_default=sa.text("0")),
        sa.Column("completed_sources", sa.Integer(), server_default=sa.text("0")),
        sa.Column("current_source", sa.Text()),
        sa.Column("saved", sa.Integer(), server_default=sa.text("0")),
        sa.Column("skipped", sa.Integer(), server_default=sa.text("0")),
        sa.Column("results", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb")),
        sa.Column("error", sa.Text()),
        sa.Column("message", sa.Text()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("finished_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_article_refresh_jobs_status_created",
        "article_refresh_jobs",
        ["status", sa.text("created_at DESC")],
    )

    op.create_table(
        "api_usage_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("feature", sa.Text(), nullable=False),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text()),
        sa.Column("model", sa.Text()),
        sa.Column("units", sa.Integer(), server_default=sa.text("1")),
        sa.Column("input_chars", sa.Integer(), server_default=sa.text("0")),
        sa.Column("output_chars", sa.Integer(), server_default=sa.text("0")),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("total_tokens", sa.Integer()),
        sa.Column("success", sa.Boolean(), server_default=sa.text("TRUE")),
        sa.Column("error_message", sa.Text()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
    )
    op.create_index("ix_api_usage_events_user_created", "api_usage_events", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_api_usage_events_user_created", table_name="api_usage_events")
    op.drop_table("api_usage_events")

    op.drop_index("ix_article_refresh_jobs_status_created", table_name="article_refresh_jobs")
    op.drop_table("article_refresh_jobs")

    op.drop_index("ix_article_sessions_article", table_name="article_sessions")
    op.drop_index("ix_article_sessions_user_created", table_name="article_sessions")
    op.drop_table("article_sessions")

    op.drop_index("ix_article_chunks_article", table_name="article_chunks")
    op.drop_index("ux_article_chunks_article_index", table_name="article_chunks")
    op.drop_table("article_chunks")

    op.drop_index("ix_articles_published_topic", table_name="articles")
    op.drop_index("ux_articles_url", table_name="articles")
    op.drop_table("articles")
    op.drop_table("article_sources")

    op.drop_index("ix_agent_jobs_user_created", table_name="agent_jobs")
    op.drop_table("agent_jobs")

    op.drop_index("ux_agent_memories_user_key", table_name="agent_memories")
    op.drop_table("agent_memories")

    op.drop_index("ix_roleplay_sessions_user_created", table_name="roleplay_sessions")
    op.drop_index("ix_roleplay_tts_user_last_used", table_name="roleplay_tts_cache")
    op.drop_index("ux_roleplay_tts_user_cache", table_name="roleplay_tts_cache")
    op.drop_table("roleplay_tts_cache")
    op.drop_table("roleplay_sessions")

    op.drop_index("ux_labels_user_name", table_name="labels")
    op.drop_table("labels")

    op.drop_index("ix_quiz_question_results_session", table_name="quiz_question_results")
    op.drop_index("ix_quiz_question_results_user_created", table_name="quiz_question_results")
    op.drop_table("quiz_question_results")

    op.drop_table("quiz_sessions")
    op.drop_table("quiz_history")

    op.drop_index("ux_words_user_word", table_name="words")
    op.drop_table("words")

    op.drop_index("ix_password_reset_codes_user_id", table_name="password_reset_codes")
    op.drop_index("ix_password_reset_codes_email", table_name="password_reset_codes")
    op.drop_table("password_reset_codes")

    op.drop_index("ix_oauth_accounts_oauth_name", table_name="oauth_accounts")
    op.drop_index("ix_oauth_accounts_account_id", table_name="oauth_accounts")
    op.drop_table("oauth_accounts")

    op.drop_index("ix_access_tokens_created_at", table_name="access_tokens")
    op.drop_table("access_tokens")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

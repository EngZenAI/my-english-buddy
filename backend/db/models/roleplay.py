from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Index, Integer, Text, func
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.base import Base


class RoleplaySession(Base):
    __tablename__ = "roleplay_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    level: Mapped[str | None] = mapped_column(Text)
    scenario: Mapped[str | None] = mapped_column(Text)
    tag: Mapped[str | None] = mapped_column(Text)
    situation: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    turns: Mapped[int | None] = mapped_column(Integer, server_default=sql_text("0"))
    summary: Mapped[str | None] = mapped_column(Text)
    expressions: Mapped[list | None] = mapped_column(JSONB, server_default=sql_text("'[]'::jsonb"))
    vocab: Mapped[list | None] = mapped_column(JSONB, server_default=sql_text("'[]'::jsonb"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ix_roleplay_sessions_user_created", RoleplaySession.user_id, RoleplaySession.created_at.desc())


class RoleplayTtsCache(Base):
    __tablename__ = "roleplay_tts_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    cache_key: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    voice: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    audio_path: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(Text, server_default=sql_text("'audio/wav'"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ux_roleplay_tts_user_cache", RoleplayTtsCache.user_id, RoleplayTtsCache.cache_key, unique=True)
Index("ix_roleplay_tts_user_last_used", RoleplayTtsCache.user_id, RoleplayTtsCache.last_used_at.desc())

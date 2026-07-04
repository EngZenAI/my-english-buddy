from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import DateTime, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.base import Base

JsonValue = dict[str, Any] | list[Any] | str | int | float | bool | None


class AgentMemory(Base):
    __tablename__ = "agent_memories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    key: Mapped[str] = mapped_column(Text, nullable=False)
    value_json: Mapped[JsonValue] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ux_agent_memories_user_key", AgentMemory.user_id, AgentMemory.key, unique=True)


class AgentJob(Base):
    __tablename__ = "agent_jobs"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    user_id: Mapped[UUID] = mapped_column(nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'queued'"))
    progress_current: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    progress_total: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    message: Mapped[str | None] = mapped_column(Text)
    result_json: Mapped[JsonValue] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ix_agent_jobs_user_created", AgentJob.user_id, AgentJob.created_at)

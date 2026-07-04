from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Index, Integer, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.base import Base


class ApiUsageEvent(Base):
    __tablename__ = "api_usage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[UUID | None] = mapped_column()
    feature: Mapped[str] = mapped_column(Text, nullable=False)
    operation: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    units: Mapped[int | None] = mapped_column(Integer, server_default=text("1"))
    input_chars: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    output_chars: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    success: Mapped[bool | None] = mapped_column(Boolean, server_default=text("TRUE"))
    created_at: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


Index("ix_api_usage_events_user_created", ApiUsageEvent.user_id, ApiUsageEvent.created_at)

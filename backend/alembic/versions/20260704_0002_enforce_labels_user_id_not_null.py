"""Enforce labels user ownership.

Revision ID: 20260704_0002
Revises: 20260704_0001
Create Date: 2026-07-04 00:10:00
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260704_0002"
down_revision: Union[str, None] = "20260704_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "labels",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "labels",
        "user_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )

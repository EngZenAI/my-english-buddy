"""Add API usage error message.

Revision ID: 20260707_0002
Revises: 20260707_0001
Create Date: 2026-07-07 23:30:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260707_0002"
down_revision: Union[str, None] = "20260707_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("api_usage_events", sa.Column("error_message", sa.Text()))


def downgrade() -> None:
    op.drop_column("api_usage_events", "error_message")

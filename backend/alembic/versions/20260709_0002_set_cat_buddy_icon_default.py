"""Set cat buddy icon as default.

Revision ID: 20260709_0002
Revises: 20260709_0001
Create Date: 2026-07-09 00:30:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260709_0002"
down_revision: Union[str, None] = "20260709_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET buddy_icon = 'cat' WHERE buddy_icon = 'classic'")
    op.alter_column(
        "users",
        "buddy_icon",
        existing_type=sa.String(length=32),
        server_default="cat",
        existing_nullable=False,
    )


def downgrade() -> None:
    op.execute("UPDATE users SET buddy_icon = 'classic' WHERE buddy_icon = 'cat'")
    op.alter_column(
        "users",
        "buddy_icon",
        existing_type=sa.String(length=32),
        server_default="classic",
        existing_nullable=False,
    )

"""Add user buddy icon setting.

Revision ID: 20260709_0001
Revises: 20260707_0002
Create Date: 2026-07-09 00:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260709_0001"
down_revision: Union[str, None] = "20260707_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "buddy_icon",
            sa.String(length=32),
            nullable=False,
            server_default="cat",
        ),
    )
    op.create_check_constraint(
        "ck_users_buddy_icon",
        "users",
        "buddy_icon IN ('classic', 'cat')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_buddy_icon", "users", type_="check")
    op.drop_column("users", "buddy_icon")

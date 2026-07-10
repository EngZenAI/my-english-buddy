"""Add logical usage group identifiers.

Revision ID: 20260710_0001
Revises: 20260709_0002
Create Date: 2026-07-10 12:00:00
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "20260710_0001"
down_revision: Union[str, None] = "20260709_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("api_usage_events", sa.Column("usage_group_id", sa.Text()))
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id, created_at, operation, model
                       ORDER BY id
                   ) AS occurrence
            FROM api_usage_events
            WHERE provider = 'openai'
              AND operation IN ('realtime', 'realtime_transcription')
        )
        UPDATE api_usage_events AS event
        SET usage_group_id = 'legacy:' || md5(
            event.user_id::text || '|' || event.created_at::text || '|' ||
            event.operation || '|' || ranked.occurrence::text
        )
        FROM ranked
        WHERE event.id = ranked.id
        """
    )
    op.execute(
        """
        WITH grouped AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY user_id, usage_group_id
                       ORDER BY id
                   ) AS fragment_index
            FROM api_usage_events
            WHERE usage_group_id IS NOT NULL
        )
        UPDATE api_usage_events AS event
        SET units = CASE WHEN grouped.fragment_index = 1 THEN 1 ELSE 0 END
        FROM grouped
        WHERE event.id = grouped.id
        """
    )
    op.create_index(
        "uq_api_usage_events_group_fragment",
        "api_usage_events",
        ["user_id", "usage_group_id", "operation", "model"],
        unique=True,
        postgresql_where=sa.text("usage_group_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_api_usage_events_group_fragment", table_name="api_usage_events")
    op.execute("UPDATE api_usage_events SET units = 1 WHERE usage_group_id IS NOT NULL")
    op.drop_column("api_usage_events", "usage_group_id")

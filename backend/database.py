"""Compatibility exports for older imports.

New DB infrastructure should be imported from backend.db.* directly.
Raw SQL domain helpers are temporarily kept in backend.db.legacy while they are
migrated to SQLAlchemy repositories.
"""

from backend.db import (
    Base,
    SessionDep,
    SessionFactory,
    create_db_schema,
    engine,
    get_async_session,
    get_conn,
)
from backend.db.legacy import *  # noqa: F403

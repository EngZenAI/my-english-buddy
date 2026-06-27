import threading
from contextlib import contextmanager

import psycopg2.pool

from backend.config import settings
from backend.db.logging import LoggingConnection

_pool: psycopg2.pool.ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = psycopg2.pool.ThreadedConnectionPool(
                    minconn=1,
                    maxconn=10,
                    dsn=settings.sync_database_url,
                    connection_factory=LoggingConnection,
                )
    return _pool


@contextmanager
def get_conn():
    """Temporary bridge for raw SQL code while it is migrated to SQLAlchemy."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        try:
            conn.rollback()
        except Exception:
            pass
        pool.putconn(conn)

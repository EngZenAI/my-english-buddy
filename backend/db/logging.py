import logging
from typing import Any

SQL_LOGGER_NAME = "backend.db.sql"
logger = logging.getLogger(SQL_LOGGER_NAME)


def _compact_sql(query: Any) -> str:
    if isinstance(query, bytes):
        query = query.decode("utf-8", errors="replace")
    if not isinstance(query, str):
        return repr(query)
    return " ".join(query.split())


def _compact_params(params: Any) -> str:
    text = repr(params)
    if len(text) > 1000:
        return text[:1000] + "...<truncated>"
    return text


def log_sql(query: Any, params: Any = None, *, many: bool = False) -> None:
    if not logger.isEnabledFor(logging.INFO):
        return

    message = "[SQL] %s" % _compact_sql(query)
    if many:
        message += " [executemany]"
    if logger.isEnabledFor(logging.DEBUG) and params is not None:
        message += " params=%s" % _compact_params(params)
    logger.info(message)


def enable_sql_logging(*, verbose: bool = False) -> None:
    """Enable compact SQL statement logging locally without adding app settings."""
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
        logger.addHandler(handler)
    logger.propagate = False

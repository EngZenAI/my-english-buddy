from __future__ import annotations

import logging
from typing import Any


def log_exception(
    logger: logging.Logger,
    message: str,
    *args: Any,
    exc_info: bool = True,
) -> None:
    if exc_info:
        logger.exception(message, *args)
        return
    logger.warning(message, *args)

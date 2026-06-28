from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.config import settings
from backend.db.logging import log_sql

engine = create_async_engine(
    settings.async_database_url,
    pool_pre_ping=True,
)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "before_cursor_execute")
def _log_sqlalchemy_query(_, __, statement, parameters, ___, executemany):
    log_sql(statement, parameters, many=executemany)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionFactory() as session:
        yield session

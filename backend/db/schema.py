from importlib import import_module

from backend.db.base import Base
from backend.db.session import engine


async def create_db_schema():
    import_module("backend.auth.models")
    import_module("backend.db.models")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

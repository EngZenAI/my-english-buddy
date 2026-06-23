from typing import Annotated

from fastapi import Depends
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users_db_sqlalchemy.access_token import SQLAlchemyAccessTokenDatabase

from backend.auth.models import AccessToken, User
from backend.database import SessionDep


async def get_user_db(session: SessionDep):
    yield SQLAlchemyUserDatabase(session, User)


async def get_access_token_db(session: SessionDep):
    yield SQLAlchemyAccessTokenDatabase(session, AccessToken)


UserDatabaseDep = Annotated[SQLAlchemyUserDatabase, Depends(get_user_db)]
AccessTokenDatabaseDep = Annotated[
    SQLAlchemyAccessTokenDatabase,
    Depends(get_access_token_db),
]

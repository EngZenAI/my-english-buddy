import uuid

from fastapi_users.db import SQLAlchemyBaseUserTableUUID
from fastapi_users.db import SQLAlchemyBaseOAuthAccountTableUUID
from fastapi_users_db_sqlalchemy.access_token import SQLAlchemyBaseAccessTokenTable
from fastapi_users_db_sqlalchemy.generics import GUID
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


class OAuthAccount(SQLAlchemyBaseOAuthAccountTableUUID, Base):
    __tablename__ = "oauth_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("users.id", ondelete="cascade"), nullable=False
    )


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "users"

    oauth_accounts: Mapped[list[OAuthAccount]] = relationship(
        "OAuthAccount", lazy="joined"
    )


class AccessToken(SQLAlchemyBaseAccessTokenTable[uuid.UUID], Base):
    __tablename__ = "access_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("users.id", ondelete="cascade"), nullable=False
    )

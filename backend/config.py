from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8-sig",
        extra="ignore",
    )

    database_url: str
    google_translate_api_key: str | None = None
    watsonx_api_key: str | None = None
    watsonx_project_id: str | None = None
    watsonx_url: str | None = None
    auth_cookie_name: str = "engzen_"
    auth_cookie_max_age: int = 60 * 60 * 24 * 7
    auth_cookie_secure: bool = False

    @property
    def async_database_url(self) -> str:
        if self.database_url.startswith("postgresql+asyncpg://"):
            return self.database_url
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        if self.database_url.startswith("postgres://"):
            return self.database_url.replace("postgres://", "postgresql+asyncpg://", 1)
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

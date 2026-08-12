from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    app_name: str = "Tranzit transport yo'laklari"
    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/transit_map"
    database_ssl: bool = False
    secret_key: str = "development-only-secret-change-before-production"
    admin_initial_email: str = "admin@example.local"
    admin_initial_password: str = "CHANGE_ME_NOW"
    cors_origins: str = "http://localhost:5173"
    frontend_url: str = "http://localhost:5173"
    routing_provider: str = "osrm"
    routing_base_url: str = "https://router.project-osrm.org"
    routing_timeout_seconds: int = 15
    enable_demo_seed: bool = True
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    access_token_minutes: int = 480

    @field_validator("database_url")
    @classmethod
    def async_database_url(cls, value: str) -> str:
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        return value

    @field_validator("admin_initial_email", mode="before")
    @classmethod
    def normalized_admin_email(cls, value: str) -> str:
        normalized = str(value).strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("ADMIN_INITIAL_EMAIL email ko'rinishida bo'lishi kerak")
        return normalized

    @field_validator("admin_initial_password")
    @classmethod
    def valid_admin_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("ADMIN_INITIAL_PASSWORD kamida 8 belgidan iborat bo'lishi kerak")
        return value

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip().rstrip("/") for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

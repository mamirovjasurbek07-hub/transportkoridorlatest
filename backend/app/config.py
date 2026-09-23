from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import field_validator, model_validator
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
    map_provider: Literal["osm", "yandex"] = "osm"
    yandex_maps_api_key: str = ""
    routing_provider: str = "osrm"
    routing_base_url: str = "https://router.project-osrm.org"
    routing_profile: Literal["driving", "truck"] = "driving"
    yandex_router_enabled: bool = False
    yandex_router_api_key: str = ""
    yandex_router_base_url: str = "https://api.routing.yandex.net/v2/route"
    routing_timeout_seconds: int = 12
    route_cache_days: int = 30
    enable_demo_seed: bool = False
    seed_on_startup: bool = False
    audit_retention_days: int = 180
    public_visit_dedupe_minutes: int = 10
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    access_token_minutes: int = 480

    @field_validator("database_url")
    @classmethod
    def async_database_url(cls, value: str) -> str:
        normalized = value.strip()
        if normalized.startswith("postgres://"):
            normalized = normalized.replace("postgres://", "postgresql+asyncpg://", 1)
        elif normalized.startswith("postgresql://"):
            normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
        if not normalized.startswith("postgresql+asyncpg://"):
            raise ValueError("DATABASE_URL PostgreSQL connection URI bo'lishi kerak")

        parsed = urlsplit(normalized.replace("postgresql+asyncpg://", "postgresql://", 1))
        if not parsed.hostname or not parsed.username or not parsed.path.strip("/"):
            raise ValueError("DATABASE_URL host, foydalanuvchi va database nomini o'z ichiga olishi kerak")
        if parsed.hostname.endswith(".pooler.supabase.com") and "." not in parsed.username:
            raise ValueError("Supabase pooler username ROLE.PROJECT_REF formatida bo'lishi kerak")
        return normalized

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

    @model_validator(mode="after")
    def secure_production_settings(self) -> "Settings":
        if self.app_env != "production":
            return self
        if not self.secret_key.strip() or self.secret_key == "development-only-secret-change-before-production":
            raise ValueError("Production uchun noyob SECRET_KEY talab qilinadi")
        if self.admin_initial_password == "CHANGE_ME_NOW":
            raise ValueError("Production uchun ADMIN_INITIAL_PASSWORD almashtirilishi kerak")
        if not self.cookie_secure:
            raise ValueError("Production uchun COOKIE_SECURE=true bo'lishi kerak")
        if self.seed_on_startup:
            raise ValueError("Productionda SEED_ON_STARTUP=false bo'lishi kerak; seedni alohida ishga tushiring")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip().rstrip("/") for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

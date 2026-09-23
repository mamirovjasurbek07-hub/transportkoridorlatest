from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


connect_args: dict = {
    "timeout": 10,
    "server_settings": {"statement_timeout": "20000", "search_path": "public,extensions"},
}
if settings.database_ssl:
    connect_args["ssl"] = "require"

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=2,
    pool_timeout=10,
    pool_recycle=300,
    connect_args=connect_args,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session

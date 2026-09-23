"""Run seed explicitly; production web startup intentionally does not seed."""

import asyncio

from app.database import SessionLocal, engine
from app.seed import seed_all


async def main() -> None:
    async with SessionLocal() as db:
        await seed_all(db)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())

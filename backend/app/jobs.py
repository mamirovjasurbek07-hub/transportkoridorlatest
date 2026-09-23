import asyncio
import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.corridor_service import apply_route_result
from app.database import SessionLocal
from app.models import BackgroundJob, Corridor
from app.routing import RoutingService

logger = structlog.get_logger()
_route_rebuild_lock = asyncio.Lock()


def job_payload(job: BackgroundJob) -> dict:
    return {
        "id": str(job.id),
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "total": job.total,
        "payload": job.payload,
        "result": job.result,
        "error": job.error,
        "cancel_requested": job.cancel_requested,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


async def unfinished_route_job_ids() -> list[uuid.UUID]:
    """Recover persisted jobs after a worker restart without running them in parallel."""
    async with SessionLocal() as db:
        jobs = (await db.scalars(
            select(BackgroundJob)
            .where(BackgroundJob.kind == "ROUTE_REBUILD", BackgroundJob.status.in_({"PENDING", "RUNNING"}))
            .order_by(BackgroundJob.created_at)
        )).all()
        result: list[uuid.UUID] = []
        for job in jobs:
            if job.cancel_requested:
                job.status = "CANCELLED"
                job.finished_at = datetime.now(UTC)
            else:
                job.status = "PENDING"
                job.started_at = None
                result.append(job.id)
        await db.commit()
        return result


async def run_route_rebuild(job_id: uuid.UUID) -> None:
    async with _route_rebuild_lock:
        await _run_route_rebuild(job_id)


async def _run_route_rebuild(job_id: uuid.UUID) -> None:
    updated: list[str] = []
    failed: list[dict] = []
    try:
        async with SessionLocal() as db:
            job = await db.get(BackgroundJob, job_id)
            if not job:
                return
            job.status = "RUNNING"
            job.started_at = datetime.now(UTC)
            await db.commit()
            corridor_ids = list(job.payload.get("corridor_ids", []))
            profile = str(job.payload.get("routing_profile", "driving"))

        for index, corridor_id in enumerate(corridor_ids, start=1):
            async with SessionLocal() as db:
                job = await db.get(BackgroundJob, job_id)
                if not job or job.cancel_requested:
                    if job:
                        job.status = "CANCELLED"
                        job.finished_at = datetime.now(UTC)
                        job.result = {"updated": updated, "failed": failed}
                        await db.commit()
                    return
                corridor = await db.scalar(
                    select(Corridor).options(selectinload(Corridor.waypoints)).where(Corridor.id == uuid.UUID(corridor_id))
                )
                if not corridor:
                    failed.append({"id": corridor_id, "message": "Korridor topilmadi"})
                else:
                    ordered = sorted(corridor.waypoints, key=lambda item: item.sequence_no)
                    if len(ordered) < 2:
                        corridor.route_needs_review = True
                        corridor.status = "REVIEW"
                        failed.append({"id": corridor_id, "code": corridor.code, "message": "Kamida 2 ta waypoint kerak"})
                    else:
                        waypoint_data = [{"latitude": point.latitude, "longitude": point.longitude} for point in ordered]
                        result = await RoutingService(db).route(waypoint_data, force=True, profile=profile)
                        apply_route_result(corridor, result)
                        corridor.routing_profile = profile
                        if result.available:
                            updated.append(corridor_id)
                        else:
                            failed.append({"id": corridor_id, "code": corridor.code, "message": result.message})
                job.progress = index
                job.result = {"updated": updated, "failed": failed}
                await db.commit()

        async with SessionLocal() as db:
            job = await db.get(BackgroundJob, job_id)
            if job:
                job.status = "COMPLETED" if not failed else "COMPLETED_WITH_ERRORS"
                job.finished_at = datetime.now(UTC)
                job.result = {"updated": updated, "failed": failed}
                await db.commit()
    except Exception as exc:
        await logger.aerror("route_rebuild_job_failed", job_id=str(job_id), error=type(exc).__name__)
        async with SessionLocal() as db:
            job = await db.get(BackgroundJob, job_id)
            if job:
                job.status = "FAILED"
                job.error = f"{type(exc).__name__}: {str(exc)[:500]}"
                job.finished_at = datetime.now(UTC)
                await db.commit()

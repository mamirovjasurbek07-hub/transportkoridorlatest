import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import csrf_protect, editor_user
from app.jobs import job_payload, run_route_rebuild
from app.models import BackgroundJob, User

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("")
async def list_jobs(limit: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db), _: User = Depends(editor_user)) -> dict:
    rows = (await db.scalars(select(BackgroundJob).order_by(BackgroundJob.created_at.desc()).limit(limit))).all()
    return {"items": [job_payload(row) for row in rows]}


@router.get("/{job_id}")
async def get_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(editor_user)) -> dict:
    job = await db.get(BackgroundJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Vazifa topilmadi")
    return job_payload(job)


@router.post("/{job_id}/cancel", dependencies=[Depends(csrf_protect)])
async def cancel_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(editor_user)) -> dict:
    job = await db.get(BackgroundJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Vazifa topilmadi")
    if job.status not in {"PENDING", "RUNNING"}:
        raise HTTPException(status_code=409, detail="Bu vazifani bekor qilib bo'lmaydi")
    job.cancel_requested = True
    await db.commit()
    return job_payload(job)


@router.post("/{job_id}/retry", dependencies=[Depends(csrf_protect)])
async def retry_job(job_id: uuid.UUID, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), user: User = Depends(editor_user)) -> dict:
    previous = await db.get(BackgroundJob, job_id)
    if not previous or previous.kind != "ROUTE_REBUILD":
        raise HTTPException(status_code=404, detail="Qayta ishga tushiriladigan vazifa topilmadi")
    if previous.status not in {"FAILED", "COMPLETED_WITH_ERRORS", "CANCELLED"}:
        raise HTTPException(status_code=409, detail="Faqat xatoli yoki bekor qilingan vazifani qayta boshlash mumkin")
    job = BackgroundJob(kind=previous.kind, total=previous.total, payload=previous.payload, created_by=user.id)
    db.add(job)
    await db.commit()
    await db.refresh(job)
    background_tasks.add_task(run_route_rebuild, job.id)
    return job_payload(job)

from datetime import UTC, datetime
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from geoalchemy2.functions import ST_SetSRID, ST_MakePoint
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import editor_user, csrf_protect
from app.jobs import run_route_rebuild
from app.models import BackgroundJob, Corridor, CorridorWaypoint, CustomsPost, User
from app.schemas import PostCreate, PostUpdate
from app.audit import add_audit
from app.query_utils import contains_pattern

router = APIRouter(prefix="/posts", tags=["posts"])


def post_dict(p: CustomsPost) -> dict:
    return {
        "id": str(p.id), "post_code": p.post_code, "post_name": p.post_name, "post_type": p.post_type,
        "post_category": p.post_category,
        "region": p.region, "neighbor_country_code": p.neighbor_country_code, "latitude": p.latitude,
        "longitude": p.longitude, "location_verified": p.location_verified,
        "allow_passenger_vehicles": p.allow_passenger_vehicles, "allow_cargo_vehicles": p.allow_cargo_vehicles,
        "is_active": p.is_active,
        "created_at": p.created_at, "updated_at": p.updated_at,
    }


async def queue_post_corridors(db: AsyncSession, post: CustomsPost, user: User) -> tuple[BackgroundJob | None, int]:
    corridors = (await db.scalars(
        select(Corridor)
        .options(selectinload(Corridor.waypoints))
        .where(
            Corridor.is_active.is_(True),
            or_(
                Corridor.entry_post_code == post.post_code,
                Corridor.exit_post_code == post.post_code,
                Corridor.waypoints.any(CorridorWaypoint.post_code == post.post_code),
            ),
        )
    )).unique().all()
    review = 0
    rebuild_ids: list[str] = []
    for corridor in corridors:
        matching_waypoints = [point for point in corridor.waypoints if point.post_code == post.post_code]
        if post.latitude is None or post.longitude is None or not matching_waypoints:
            corridor.geometry = None
            corridor.route_needs_review = True
            corridor.status = "REVIEW"
            review += 1
            continue
        for point in matching_waypoints:
            point.latitude = post.latitude
            point.longitude = post.longitude
            point.location = ST_SetSRID(ST_MakePoint(post.longitude, post.latitude), 4326)
        corridor.geometry = None
        corridor.route_needs_review = True
        corridor.status = "REVIEW"
        review += 1
        rebuild_ids.append(str(corridor.id))
    if not rebuild_ids:
        return None, review
    job = BackgroundJob(kind="ROUTE_REBUILD", total=len(rebuild_ids), payload={"corridor_ids": rebuild_ids, "routing_profile": "driving", "reason": "post_coordinates_changed"}, created_by=user.id)
    db.add(job)
    await db.flush()
    return job, review


@router.get("")
async def list_posts(
    response: Response,
    search: str | None = None,
    post_type: str | None = None,
    post_category: str | None = Query(default=None, pattern="^(UNASSIGNED|EXTRA|FIRST|SECOND)$"),
    country: str | None = None,
    active_only: bool = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600" if active_only else "private, no-cache"
    filters = []
    if active_only:
        filters += [CustomsPost.is_active.is_(True), CustomsPost.deleted_at.is_(None)]
    if search:
        pattern = contains_pattern(search)
        filters.append(or_(CustomsPost.post_code.ilike(pattern, escape="\\"), CustomsPost.post_name.ilike(pattern, escape="\\")))
    if post_type:
        filters.append(CustomsPost.post_type == post_type)
    if post_category:
        filters.append(CustomsPost.post_category == post_category)
    if country:
        filters.append(CustomsPost.neighbor_country_code == country.upper())
    total = await db.scalar(select(func.count()).select_from(CustomsPost).where(*filters))
    rows = (await db.scalars(select(CustomsPost).where(*filters).order_by(CustomsPost.post_code).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [post_dict(p) for p in rows], "total": total or 0, "page": page, "page_size": page_size}


@router.post("", status_code=201, dependencies=[Depends(csrf_protect)])
async def create_post(payload: PostCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(editor_user)) -> dict:
    if await db.scalar(select(CustomsPost.id).where(CustomsPost.post_code == payload.post_code)):
        raise HTTPException(status_code=409, detail="Bu post kodi mavjud")
    values = payload.model_dump()
    post = CustomsPost(**values)
    if post.latitude is not None:
        post.location = ST_SetSRID(ST_MakePoint(post.longitude, post.latitude), 4326)
    db.add(post)
    await db.flush()
    await add_audit(db, request, user, "CREATE", "customs_post", str(post.id), after=values)
    await db.commit()
    await db.refresh(post)
    return post_dict(post)


@router.patch("/{post_id}", dependencies=[Depends(csrf_protect)])
async def update_post(post_id: str, payload: PostUpdate, request: Request, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db), user: User = Depends(editor_user)) -> dict:
    post = await db.get(CustomsPost, uuid.UUID(post_id))
    if not post:
        raise HTTPException(status_code=404, detail="Post topilmadi")
    before = post_dict(post)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(post, key, value)
    if "latitude" in changes or "longitude" in changes:
        post.location = ST_SetSRID(ST_MakePoint(post.longitude, post.latitude), 4326) if post.latitude is not None and post.longitude is not None else None
    if (post.latitude is None) != (post.longitude is None):
        raise HTTPException(status_code=422, detail="Latitude va longitude birga kiritilishi kerak")
    if post.post_type == "CHBP" and not post.neighbor_country_code:
        raise HTTPException(status_code=422, detail="CHBP uchun chegaradosh davlat majburiy")
    if post.post_type == "CHBP" and not (post.allow_passenger_vehicles or post.allow_cargo_vehicles):
        raise HTTPException(status_code=422, detail="Kamida bitta transport turiga ruxsat bering")
    job = None
    review = 0
    if before["latitude"] != post.latitude or before["longitude"] != post.longitude:
        job, review = await queue_post_corridors(db, post, user)
    audit_after = {**changes, "route_job_id": str(job.id) if job else None, "corridors_review": review}
    await add_audit(db, request, user, "UPDATE", "customs_post", str(post.id), before=before, after=audit_after)
    await db.commit()
    await db.refresh(post)
    if job:
        background_tasks.add_task(run_route_rebuild, job.id)
    return {**post_dict(post), "route_job_id": str(job.id) if job else None, "corridors_review": review}


@router.delete("/{post_id}", dependencies=[Depends(csrf_protect)])
async def soft_delete_post(post_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(editor_user)) -> dict:
    post = await db.get(CustomsPost, uuid.UUID(post_id))
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post topilmadi")
    post.is_active = False
    post.deleted_at = datetime.now(UTC)
    await add_audit(db, request, user, "SOFT_DELETE", "customs_post", str(post.id))
    await db.commit()
    return {"message": "Post nofaol qilindi"}

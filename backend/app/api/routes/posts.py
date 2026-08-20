from datetime import UTC, datetime
import hashlib
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from geoalchemy2.functions import ST_GeomFromGeoJSON, ST_SetSRID, ST_MakePoint
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import admin_user, csrf_protect
from app.models import Corridor, CorridorWaypoint, CustomsPost, User
from app.schemas import PostCreate, PostUpdate
from app.audit import add_audit
from app.routing import RoutingService

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


async def rebuild_post_corridors(db: AsyncSession, post: CustomsPost) -> tuple[int, int]:
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
    rebuilt = 0
    review = 0
    routing = RoutingService(db)
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
        ordered = sorted(corridor.waypoints, key=lambda point: point.sequence_no)
        result = await routing.route([
            {"latitude": point.latitude, "longitude": point.longitude}
            for point in ordered
        ], force=True, profile=corridor.routing_profile)
        if result and result.available and result.geometry:
            corridor.geometry = ST_GeomFromGeoJSON(json.dumps(result.geometry))
            corridor.geometry_hash = hashlib.sha256(json.dumps(result.geometry, sort_keys=True).encode()).hexdigest()
            corridor.distance_meters = result.distance_meters
            corridor.duration_seconds = result.duration_seconds
            corridor.geometry_source = f"post-update-{result.provider}"
            corridor.routing_provider = result.provider
            corridor.route_needs_review = False
            corridor.status = "ACTIVE"
            rebuilt += 1
        else:
            corridor.geometry = None
            corridor.route_needs_review = True
            corridor.status = "REVIEW"
            review += 1
    return rebuilt, review


@router.get("")
async def list_posts(
    search: str | None = None,
    post_type: str | None = None,
    country: str | None = None,
    active_only: bool = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    filters = []
    if active_only:
        filters += [CustomsPost.is_active.is_(True), CustomsPost.deleted_at.is_(None)]
    if search:
        filters.append(or_(CustomsPost.post_code.ilike(f"%{search}%"), CustomsPost.post_name.ilike(f"%{search}%")))
    if post_type:
        filters.append(CustomsPost.post_type == post_type)
    if country:
        filters.append(CustomsPost.neighbor_country_code == country.upper())
    total = await db.scalar(select(func.count()).select_from(CustomsPost).where(*filters))
    rows = (await db.scalars(select(CustomsPost).where(*filters).order_by(CustomsPost.post_code).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [post_dict(p) for p in rows], "total": total or 0, "page": page, "page_size": page_size}


@router.post("", status_code=201, dependencies=[Depends(csrf_protect)])
async def create_post(payload: PostCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
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
async def update_post(post_id: str, payload: PostUpdate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
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
    rebuilt = review = 0
    if before["latitude"] != post.latitude or before["longitude"] != post.longitude:
        rebuilt, review = await rebuild_post_corridors(db, post)
    audit_after = {**changes, "corridors_rebuilt": rebuilt, "corridors_review": review}
    await add_audit(db, request, user, "UPDATE", "customs_post", str(post.id), before=before, after=audit_after)
    await db.commit()
    await db.refresh(post)
    return {**post_dict(post), "corridors_rebuilt": rebuilt, "corridors_review": review}


@router.delete("/{post_id}", dependencies=[Depends(csrf_protect)])
async def soft_delete_post(post_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    post = await db.get(CustomsPost, uuid.UUID(post_id))
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post topilmadi")
    post.is_active = False
    post.deleted_at = datetime.now(UTC)
    await add_audit(db, request, user, "SOFT_DELETE", "customs_post", str(post.id))
    await db.commit()
    return {"message": "Post nofaol qilindi"}

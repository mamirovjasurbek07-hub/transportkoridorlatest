import hashlib
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from geoalchemy2.functions import ST_AsGeoJSON, ST_GeomFromGeoJSON, ST_SetSRID, ST_MakePoint
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import admin_user, csrf_protect
from app.models import Corridor, CorridorWaypoint, CustomsPost, User
from app.schemas import CorridorCreate, CorridorUpdate, RoutePreviewRequest
from app.routing import RoutingService
from app.audit import add_audit

router = APIRouter(prefix="/corridors", tags=["corridors"])


async def corridor_dict(db: AsyncSession, corridor: Corridor, include_geometry: bool = True) -> dict:
    geometry = None
    if include_geometry and corridor.geometry is not None:
        raw = await db.scalar(select(ST_AsGeoJSON(Corridor.geometry)).where(Corridor.id == corridor.id))
        geometry = json.loads(raw) if raw else None
    return {
        "id": str(corridor.id), "code": corridor.code, "name": corridor.name,
        "origin_country_code": corridor.origin_country_code, "destination_country_code": corridor.destination_country_code,
        "entry_post_code": corridor.entry_post_code, "exit_post_code": corridor.exit_post_code,
        "status": corridor.status, "color": corridor.color, "routing_provider": corridor.routing_provider,
        "routing_profile": corridor.routing_profile, "geometry_source": corridor.geometry_source,
        "geometry": geometry, "distance_meters": corridor.distance_meters, "duration_seconds": corridor.duration_seconds,
        "route_needs_review": corridor.route_needs_review, "priority": corridor.priority, "is_active": corridor.is_active,
        "waypoints": [{
            "sequence_no": w.sequence_no, "waypoint_type": w.waypoint_type, "latitude": w.latitude,
            "longitude": w.longitude, "post_code": w.post_code, "gateway_id": str(w.gateway_id) if w.gateway_id else None,
            "label": w.label,
        } for w in corridor.waypoints],
        "created_at": corridor.created_at, "updated_at": corridor.updated_at,
    }


@router.get("")
async def list_corridors(active_only: bool = True, db: AsyncSession = Depends(get_db)) -> dict:
    query = select(Corridor).order_by(Corridor.priority, Corridor.name)
    if active_only:
        query = query.where(Corridor.is_active.is_(True))
    rows = (await db.scalars(query)).unique().all()
    return {"items": [await corridor_dict(db, c) for c in rows], "total": len(rows)}


@router.post("/preview", dependencies=[Depends(csrf_protect)])
async def preview_route(payload: RoutePreviewRequest, db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> dict:
    result = await RoutingService(db).route([w.model_dump() for w in payload.waypoints], payload.force)
    if result.available:
        await db.commit()
    else:
        await db.rollback()
    return {
        "status": "available" if result.available else "unavailable", "geometry": result.geometry,
        "distance_meters": result.distance_meters, "duration_seconds": result.duration_seconds,
        "provider": "osrm", "cached": result.cached, "message": result.message,
    }


async def validate_posts(db: AsyncSession, entry: str, exit: str) -> None:
    count = await db.scalar(select(func.count()).select_from(CustomsPost).where(CustomsPost.post_code.in_([entry, exit])))
    expected = 1 if entry == exit else 2
    if count != expected:
        raise HTTPException(status_code=422, detail="Kirish yoki chiqish posti mavjud emas")


@router.post("", status_code=201, dependencies=[Depends(csrf_protect)])
async def create_corridor(payload: CorridorCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    await validate_posts(db, payload.entry_post_code, payload.exit_post_code)
    if await db.scalar(select(Corridor.id).where(Corridor.code == payload.code)):
        raise HTTPException(status_code=409, detail="Bu korridor kodi mavjud")
    duplicate = await db.scalar(select(Corridor.id).where(
        Corridor.origin_country_code == payload.origin_country_code,
        Corridor.destination_country_code == payload.destination_country_code,
        Corridor.entry_post_code == payload.entry_post_code,
        Corridor.exit_post_code == payload.exit_post_code,
        Corridor.is_active.is_(True),
    ))
    if duplicate and payload.is_active:
        raise HTTPException(status_code=409, detail="Bu yo'nalish uchun faol korridor mavjud")
    values = payload.model_dump(exclude={"waypoints", "build_route"})
    corridor = Corridor(**values)
    db.add(corridor)
    await db.flush()
    for w in payload.waypoints:
        data = w.model_dump()
        if data["gateway_id"]:
            data["gateway_id"] = uuid.UUID(data["gateway_id"])
        point = CorridorWaypoint(corridor_id=corridor.id, **data)
        point.location = ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
        db.add(point)
    if payload.build_route:
        result = await RoutingService(db).route([w.model_dump() for w in payload.waypoints])
        if result.available and result.geometry:
            corridor.geometry = ST_GeomFromGeoJSON(json.dumps(result.geometry))
            corridor.distance_meters = result.distance_meters
            corridor.duration_seconds = result.duration_seconds
            corridor.geometry_hash = hashlib.sha256(json.dumps(result.geometry, sort_keys=True).encode()).hexdigest()
            corridor.route_needs_review = False
            corridor.status = "ACTIVE" if corridor.status == "DRAFT" else corridor.status
        else:
            corridor.route_needs_review = True
            corridor.status = "REVIEW"
    await add_audit(db, request, user, "CREATE", "corridor", str(corridor.id), after={"code": corridor.code, "name": corridor.name})
    await db.commit()
    await db.refresh(corridor, ["waypoints"])
    return await corridor_dict(db, corridor)


@router.patch("/{corridor_id}", dependencies=[Depends(csrf_protect)])
async def update_corridor(corridor_id: str, payload: CorridorUpdate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    corridor = await db.scalar(select(Corridor).where(Corridor.id == corridor_id))
    if not corridor:
        raise HTTPException(status_code=404, detail="Korridor topilmadi")
    before = {"name": corridor.name, "status": corridor.status, "priority": corridor.priority}
    changes = payload.model_dump(exclude_unset=True, exclude={"waypoints", "rebuild_route"})
    for key, value in changes.items():
        setattr(corridor, key, value)
    if payload.waypoints is not None:
        for existing in list(corridor.waypoints):
            await db.delete(existing)
        await db.flush()
        for w in payload.waypoints:
            waypoint_data = w.model_dump()
            if waypoint_data["gateway_id"]:
                waypoint_data["gateway_id"] = uuid.UUID(waypoint_data["gateway_id"])
            point = CorridorWaypoint(corridor_id=corridor.id, **waypoint_data)
            point.location = ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
            db.add(point)
        if payload.rebuild_route:
            result = await RoutingService(db).route([w.model_dump() for w in payload.waypoints], force=True)
            if result.available and result.geometry:
                corridor.geometry = ST_GeomFromGeoJSON(json.dumps(result.geometry))
                corridor.distance_meters = result.distance_meters
                corridor.duration_seconds = result.duration_seconds
                corridor.geometry_hash = hashlib.sha256(json.dumps(result.geometry, sort_keys=True).encode()).hexdigest()
                corridor.route_needs_review = False
            else:
                corridor.route_needs_review = True
                corridor.status = "REVIEW"
    await add_audit(db, request, user, "UPDATE", "corridor", str(corridor.id), before=before, after=changes)
    await db.commit()
    await db.refresh(corridor, ["waypoints"])
    return await corridor_dict(db, corridor)


@router.delete("/{corridor_id}", dependencies=[Depends(csrf_protect)])
async def deactivate_corridor(corridor_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    corridor = await db.get(Corridor, uuid.UUID(corridor_id))
    if not corridor:
        raise HTTPException(status_code=404, detail="Korridor topilmadi")
    corridor.is_active = False
    corridor.status = "INACTIVE"
    await add_audit(db, request, user, "DEACTIVATE", "corridor", str(corridor.id))
    await db.commit()
    return {"message": "Korridor nofaol qilindi"}

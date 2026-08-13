import hashlib
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from geoalchemy2.functions import ST_AsGeoJSON, ST_GeomFromGeoJSON, ST_SetSRID, ST_MakePoint
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload, selectinload

from app.database import get_db
from app.dependencies import admin_user, csrf_protect
from app.models import Corridor, CorridorWaypoint, CustomsPost, User
from app.schemas import CorridorCreate, CorridorRebuildRequest, CorridorUpdate, RoutePreviewRequest
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


async def reload_corridor(db: AsyncSession, corridor_id: uuid.UUID) -> Corridor:
    """Reload every scalar and waypoint after commit without implicit async IO."""
    corridor = await db.scalar(
        select(Corridor)
        .options(selectinload(Corridor.waypoints))
        .where(Corridor.id == corridor_id)
        .execution_options(populate_existing=True)
    )
    if corridor is None:
        raise HTTPException(status_code=404, detail="Korridor topilmadi")
    return corridor


@router.get("")
async def list_corridors(active_only: bool = True, include_geometry: bool = True, db: AsyncSession = Depends(get_db)) -> dict:
    query = select(Corridor).order_by(Corridor.priority, Corridor.name)
    if not include_geometry:
        query = query.options(noload(Corridor.waypoints))
    if active_only:
        query = query.where(Corridor.is_active.is_(True))
    rows = (await db.scalars(query)).unique().all()
    return {"items": [await corridor_dict(db, c, include_geometry=include_geometry) for c in rows], "total": len(rows)}


@router.post("/preview", dependencies=[Depends(csrf_protect)])
async def preview_route(payload: RoutePreviewRequest, db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> dict:
    waypoint_data = await normalized_waypoints(db, payload.waypoints)
    result = await RoutingService(db).route(waypoint_data, payload.force, payload.routing_profile)
    if result.available:
        await db.commit()
    else:
        await db.rollback()
    return {
        "status": "available" if result.available else "unavailable", "geometry": result.geometry,
        "distance_meters": result.distance_meters, "duration_seconds": result.duration_seconds,
        "provider": result.provider, "cached": result.cached, "message": result.message,
    }


def apply_route(corridor: Corridor, result) -> None:
    if result.available and result.geometry:
        corridor.geometry = ST_GeomFromGeoJSON(json.dumps(result.geometry))
        corridor.distance_meters = result.distance_meters
        corridor.duration_seconds = result.duration_seconds
        corridor.geometry_hash = hashlib.sha256(json.dumps(result.geometry, sort_keys=True).encode()).hexdigest()
        corridor.routing_provider = result.provider
        corridor.geometry_source = f"{result.provider}-router"
        corridor.route_needs_review = False
        if corridor.status in ("DRAFT", "REVIEW"):
            corridor.status = "ACTIVE"
    else:
        corridor.route_needs_review = True
        corridor.status = "REVIEW"


async def normalized_waypoints(db: AsyncSession, waypoints) -> list[dict]:
    post_codes = {waypoint.post_code for waypoint in waypoints if waypoint.post_code}
    post_by_code = {}
    if post_codes:
        rows = (await db.scalars(select(CustomsPost).where(CustomsPost.post_code.in_(post_codes), CustomsPost.is_active.is_(True)))).all()
        post_by_code = {post.post_code: post for post in rows}
        if len(post_by_code) != len(post_codes):
            raise HTTPException(status_code=422, detail="Waypointga bog'langan post topilmadi yoki nofaol")
    result: list[dict] = []
    for waypoint in sorted(waypoints, key=lambda item: item.sequence_no):
        data = waypoint.model_dump()
        if waypoint.post_code:
            post = post_by_code[waypoint.post_code]
            if post.latitude is None or post.longitude is None:
                raise HTTPException(status_code=422, detail=f"{post.post_code} post koordinatasi belgilanmagan")
            data["latitude"] = post.latitude
            data["longitude"] = post.longitude
            data["label"] = data.get("label") or post.post_name
        result.append(data)
    for sequence_no, item in enumerate(result):
        item["sequence_no"] = sequence_no
    return result


async def validate_posts(db: AsyncSession, entry: str, exit: str) -> None:
    posts = (await db.scalars(select(CustomsPost).where(CustomsPost.post_code.in_([entry, exit]), CustomsPost.is_active.is_(True)))).all()
    expected = 1 if entry == exit else 2
    if len(posts) != expected:
        raise HTTPException(status_code=422, detail="Kirish yoki chiqish posti mavjud emas")
    if any(post.post_type != "CHBP" for post in posts):
        raise HTTPException(status_code=422, detail="Kirish va chiqish roli uchun CHBP chegara posti kerak")
    if any(post.latitude is None or post.longitude is None for post in posts):
        raise HTTPException(status_code=422, detail="Kirish yoki chiqish postining koordinatasi belgilanmagan")


@router.post("", status_code=201, dependencies=[Depends(csrf_protect)])
async def create_corridor(payload: CorridorCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    await validate_posts(db, payload.entry_post_code, payload.exit_post_code)
    waypoint_data = await normalized_waypoints(db, payload.waypoints)
    if await db.scalar(select(Corridor.id).where(Corridor.code == payload.code)):
        raise HTTPException(status_code=409, detail="Bu korridor kodi mavjud")
    values = payload.model_dump(exclude={"waypoints", "build_route"})
    corridor = Corridor(**values)
    db.add(corridor)
    await db.flush()
    for data in waypoint_data:
        data = dict(data)
        if data["gateway_id"]:
            data["gateway_id"] = uuid.UUID(data["gateway_id"])
        point = CorridorWaypoint(corridor_id=corridor.id, **data)
        point.location = ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
        db.add(point)
    if payload.build_route:
        result = await RoutingService(db).route(waypoint_data, profile=payload.routing_profile)
        apply_route(corridor, result)
    corridor_id_value = corridor.id
    await add_audit(db, request, user, "CREATE", "corridor", str(corridor_id_value), after={"code": corridor.code, "name": corridor.name})
    await db.commit()
    return await corridor_dict(db, await reload_corridor(db, corridor_id_value))


@router.patch("/{corridor_id}", dependencies=[Depends(csrf_protect)])
async def update_corridor(corridor_id: str, payload: CorridorUpdate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    corridor = await db.scalar(select(Corridor).options(selectinload(Corridor.waypoints)).where(Corridor.id == corridor_id))
    if not corridor:
        raise HTTPException(status_code=404, detail="Korridor topilmadi")
    before = {"name": corridor.name, "status": corridor.status, "priority": corridor.priority}
    changes = payload.model_dump(exclude_unset=True, exclude={"waypoints", "rebuild_route"})
    next_entry = changes.get("entry_post_code", corridor.entry_post_code)
    next_exit = changes.get("exit_post_code", corridor.exit_post_code)
    if "entry_post_code" in changes or "exit_post_code" in changes:
        await validate_posts(db, next_entry, next_exit)
    for key, value in changes.items():
        setattr(corridor, key, value)
    if payload.waypoints is not None:
        types = {waypoint.waypoint_type for waypoint in payload.waypoints}
        if not {"ORIGIN_GATEWAY", "ENTRY_POST", "EXIT_POST", "DESTINATION_GATEWAY"}.issubset(types):
            raise HTTPException(status_code=422, detail="Boshlanish, kirish posti, chiqish posti va tugash nuqtasi majburiy")
        entry_waypoint = next(waypoint for waypoint in payload.waypoints if waypoint.waypoint_type == "ENTRY_POST")
        exit_waypoint = next(waypoint for waypoint in payload.waypoints if waypoint.waypoint_type == "EXIT_POST")
        if entry_waypoint.post_code != next_entry or exit_waypoint.post_code != next_exit:
            raise HTTPException(status_code=422, detail="Waypoint postlari tanlangan kirish/chiqish postlariga mos emas")
        waypoint_data = await normalized_waypoints(db, payload.waypoints)
        for existing in list(corridor.waypoints):
            await db.delete(existing)
        await db.flush()
        for waypoint in waypoint_data:
            item = dict(waypoint)
            if item["gateway_id"]:
                item["gateway_id"] = uuid.UUID(item["gateway_id"])
            point = CorridorWaypoint(corridor_id=corridor.id, **item)
            point.location = ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
            db.add(point)
        if payload.rebuild_route:
            result = await RoutingService(db).route(waypoint_data, force=True, profile=corridor.routing_profile)
            apply_route(corridor, result)
    corridor_id_value = corridor.id
    await add_audit(db, request, user, "UPDATE", "corridor", str(corridor_id_value), before=before, after=changes)
    await db.commit()
    return await corridor_dict(db, await reload_corridor(db, corridor_id_value))


@router.post("/rebuild-road-geometries", dependencies=[Depends(csrf_protect)])
async def rebuild_road_geometries(payload: CorridorRebuildRequest, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    ids: list[uuid.UUID] = []
    for item in payload.corridor_ids:
        try:
            ids.append(uuid.UUID(item))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Korridor identifikatori noto'g'ri") from exc
    corridors = (await db.scalars(
        select(Corridor).options(selectinload(Corridor.waypoints)).where(Corridor.id.in_(ids)).order_by(Corridor.priority, Corridor.code)
    )).unique().all()
    updated: list[str] = []
    failed: list[dict] = []
    service = RoutingService(db)
    for corridor in corridors:
        ordered = sorted(corridor.waypoints, key=lambda w: w.sequence_no)
        if len(ordered) < 2:
            corridor.route_needs_review = True
            corridor.status = "REVIEW"
            failed.append({"id": str(corridor.id), "code": corridor.code, "message": "Kamida 2 ta waypoint kerak"})
            continue
        waypoint_data = [{"latitude": w.latitude, "longitude": w.longitude} for w in ordered]
        result = await service.route(waypoint_data, force=True, profile=payload.routing_profile)
        apply_route(corridor, result)
        corridor.routing_profile = payload.routing_profile
        if result.available:
            updated.append(str(corridor.id))
        else:
            failed.append({"id": str(corridor.id), "code": corridor.code, "message": result.message})
    await add_audit(db, request, user, "REBUILD_ROUTES", "corridor", None, after={"requested": len(ids), "updated": len(updated), "failed": len(failed), "provider": RoutingService._provider()})
    await db.commit()
    return {"requested": len(ids), "processed": len(corridors), "updated": updated, "failed": failed, "provider": RoutingService._provider()}


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

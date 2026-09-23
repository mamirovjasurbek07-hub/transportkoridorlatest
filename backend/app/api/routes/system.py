import time
import csv
import io
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.database import get_db
from app.dependencies import admin_user, csrf_protect, current_user, editor_user
from app.models import AppSetting, AuditLog, Corridor, CustomsPost, PostDailyMetric, TransitDeclaration, User
from app.monitoring import request_metrics
from app.seed import seed_demo_declarations
from app.audit import add_audit
from app.country_data import COUNTRIES
from app.config import settings
from app.query_utils import contains_pattern

router = APIRouter(tags=["system"])
_border_cache: tuple[float, dict] | None = None

@router.get("/health", tags=["health"])
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}


@router.get("/ready", tags=["health"])
async def readiness(db: AsyncSession = Depends(get_db)) -> dict:
    pending_routes = await db.scalar(select(func.count()).select_from(Corridor).where(Corridor.route_needs_review.is_(True))) or 0
    latest_metric = await db.scalar(select(func.max(PostDailyMetric.metric_date)))
    return {"status": "ready", "database": "connected", "routes_needing_review": pending_routes, "latest_metric_date": latest_metric}


@router.get("/map/config", tags=["map"])
async def map_config(db: AsyncSession = Depends(get_db)) -> dict:
    yandex_ready = settings.map_provider == "yandex" and bool(settings.yandex_maps_api_key.strip())
    routing_provider = "yandex" if settings.yandex_router_enabled and settings.routing_provider.lower() == "yandex" and settings.yandex_router_api_key.strip() else "osrm"
    ui = await db.get(AppSetting, "ui")
    runtime = ui.value if ui and isinstance(ui.value, dict) else {}
    requested_routing = str(runtime.get("routing_provider", routing_provider))
    if requested_routing == "yandex" and not settings.yandex_router_enabled:
        requested_routing = "osrm"
    return {
        "provider": "yandex" if yandex_ready else "osm",
        "requested_provider": settings.map_provider,
        "yandex_maps_api_key": settings.yandex_maps_api_key if yandex_ready else None,
        "routing_provider": requested_routing,
        "routing_profile": settings.routing_profile,
        "yandex_router_available": bool(settings.yandex_router_enabled and settings.yandex_router_api_key.strip()),
        "animation_corridor_limit": int(runtime.get("animation_corridor_limit", 100)),
    }


@router.get("/map/uzbekistan-border", tags=["map"])
async def uzbekistan_border() -> dict:
    """Proxy and cache the border so browsers never depend on GitHub CORS headers."""
    global _border_cache
    now = time.monotonic()
    if _border_cache and now - _border_cache[0] < 86_400:
        return _border_cache[1]
    metadata_url = "https://www.geoboundaries.org/api/current/gbOpen/UZB/ADM0/"
    pinned_media_url = "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/UZB/ADM0/geoBoundaries-UZB-ADM0_simplified.geojson"
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": "transit-corridors/1.0"}) as client:
            candidates = [pinned_media_url]
            try:
                metadata_response = await client.get(metadata_url)
                metadata_response.raise_for_status()
                geometry_url = metadata_response.json()["simplifiedGeometryGeoJSON"]
                if geometry_url.startswith("https://github.com/"):
                    # geoBoundaries stores large GeoJSON files in Git LFS. The raw
                    # host returns only a 131-byte pointer; the media host returns
                    # the actual file.
                    geometry_url = geometry_url.replace("https://github.com/", "https://media.githubusercontent.com/media/", 1).replace("/raw/", "/", 1)
                candidates.insert(0, geometry_url)
            except (httpx.HTTPError, KeyError, ValueError):
                pass
            result = None
            for candidate in dict.fromkeys(candidates):
                try:
                    geometry_response = await client.get(candidate)
                    geometry_response.raise_for_status()
                    payload = geometry_response.json()
                    if payload.get("type") == "FeatureCollection":
                        result = payload
                        break
                except (httpx.HTTPError, ValueError, AttributeError):
                    continue
            if result is None:
                raise ValueError("GeoJSON media fayli olinmadi")
    except (httpx.HTTPError, KeyError, ValueError):
        if _border_cache:
            return _border_cache[1]
        # The Yandex administrative layer still has the national border. An
        # empty collection keeps this optional overlay from breaking the map
        # or flooding the browser console with repeated 503 responses.
        result = {"type": "FeatureCollection", "features": []}
    _border_cache = (now, result)
    return result


@router.get("/countries", tags=["countries"])
async def countries(response: Response, db: AsyncSession = Depends(get_db)) -> list[dict]:
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
    route_pairs = (await db.execute(select(Corridor.origin_country_code, Corridor.destination_country_code).where(Corridor.is_active.is_(True)))).all()
    origins = {row.origin_country_code for row in route_pairs if row.origin_country_code}
    destinations = {row.destination_country_code for row in route_pairs if row.destination_country_code}
    return [
        {
            **country,
            "has_origin_route": country["alpha2"] in origins,
            "has_destination_route": country["alpha2"] in destinations,
        }
        for country in COUNTRIES
    ]


@router.get("/public/catalog", tags=["catalog"])
async def public_catalog(response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
    posts = (await db.scalars(select(CustomsPost).where(CustomsPost.is_active.is_(True), CustomsPost.deleted_at.is_(None)).order_by(CustomsPost.post_code))).all()
    corridors = (await db.scalars(select(Corridor).options(noload(Corridor.waypoints)).where(Corridor.is_active.is_(True)).order_by(Corridor.priority, Corridor.name))).all()
    origins = {row.origin_country_code for row in corridors if row.origin_country_code}
    destinations = {row.destination_country_code for row in corridors if row.destination_country_code}
    return {
        "countries": [{**country, "has_origin_route": country["alpha2"] in origins, "has_destination_route": country["alpha2"] in destinations} for country in COUNTRIES],
        "posts": [{"id": str(row.id), "post_code": row.post_code, "post_name": row.post_name, "post_type": row.post_type, "post_category": row.post_category, "region": row.region, "neighbor_country_code": row.neighbor_country_code, "latitude": row.latitude, "longitude": row.longitude, "location_verified": row.location_verified, "allow_passenger_vehicles": row.allow_passenger_vehicles, "allow_cargo_vehicles": row.allow_cargo_vehicles, "is_active": row.is_active} for row in posts],
        "corridors": [{"id": str(row.id), "code": row.code, "name": row.name, "origin_country_code": row.origin_country_code, "destination_country_code": row.destination_country_code, "entry_post_code": row.entry_post_code, "exit_post_code": row.exit_post_code, "status": row.status, "color": row.color, "routing_provider": row.routing_provider, "routing_profile": row.routing_profile, "geometry_source": row.geometry_source, "distance_meters": row.distance_meters, "duration_seconds": row.duration_seconds, "route_needs_review": row.route_needs_review, "priority": row.priority, "is_active": row.is_active, "waypoints": []} for row in corridors],
    }


@router.get("/declarations/summary", tags=["declarations"])
async def declaration_summary(db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> dict:
    total = await db.scalar(select(func.count()).select_from(TransitDeclaration)) or 0
    latest = await db.scalar(select(func.max(TransitDeclaration.created_at)))
    return {"total": total, "latest_import": latest}


@router.post("/declarations/mock/reset", tags=["declarations"], dependencies=[Depends(csrf_protect)])
async def reset_mock(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    count = await seed_demo_declarations(db, reset=True)
    await add_audit(db, request, user, "MOCK_RESET", "transit_declaration", None, after={"count": count})
    await db.commit()
    return {"message": "Mock deklaratsiyalar yangilandi", "count": count}


@router.get("/settings/dashboard", tags=["settings"])
async def dashboard(db: AsyncSession = Depends(get_db), _: User = Depends(current_user)) -> dict:
    row = (await db.execute(select(
        select(func.count()).select_from(CustomsPost).scalar_subquery().label("total_posts"),
        select(func.count()).select_from(CustomsPost).where(CustomsPost.latitude.is_not(None)).scalar_subquery().label("located"),
        select(func.count()).select_from(Corridor).where(Corridor.is_active.is_(True)).scalar_subquery().label("active_corridors"),
        select(func.count()).select_from(Corridor).where(Corridor.route_needs_review.is_(True)).scalar_subquery().label("review"),
        select(func.count()).select_from(TransitDeclaration).scalar_subquery().label("declarations"),
    ))).one()
    total_posts, located, active_corridors, review, declarations = map(int, row)
    return {"total_posts": total_posts, "located_posts": located, "unlocated_posts": total_posts - located, "active_corridors": active_corridors, "review_corridors": review, "declarations": declarations}


@router.get("/meta/report-period", tags=["analytics"])
async def report_period(response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
    metric_from, metric_to = (await db.execute(select(func.min(PostDailyMetric.metric_date), func.max(PostDailyMetric.metric_date)))).one()
    declaration_from, declaration_to = (await db.execute(select(func.min(TransitDeclaration.declaration_date), func.max(TransitDeclaration.declaration_date)))).one()
    latest = metric_to or declaration_to
    earliest = metric_from or declaration_from
    return {"date_from": earliest, "date_to": latest, "latest_metric_date": metric_to, "latest_declaration_date": declaration_to}


@router.get("/monitoring", tags=["monitoring"])
async def monitoring(minutes: int = Query(15, ge=1, le=1440), _: User = Depends(editor_user)) -> dict:
    return request_metrics(minutes)


@router.get("/settings", tags=["settings"])
async def list_settings(db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> list[dict]:
    rows = (await db.scalars(select(AppSetting).order_by(AppSetting.key))).all()
    return [{"key": row.key, "value": row.value, "updated_at": row.updated_at} for row in rows]


@router.put("/settings/{key}", tags=["settings"], dependencies=[Depends(csrf_protect)])
async def update_setting(key: str, value: dict, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    if key == "ui":
        provider = str(value.get("routing_provider", "osrm")).lower()
        if provider not in {"osrm", "yandex"}:
            raise HTTPException(status_code=422, detail="Routing provider osrm yoki yandex bo'lishi kerak")
        if provider == "yandex" and not (settings.yandex_router_enabled and settings.yandex_router_api_key.strip()):
            raise HTTPException(status_code=422, detail="Yandex Router ENV sozlamalarida yoqilmagan")
        limit = int(value.get("animation_corridor_limit", 100))
        if not 20 <= limit <= 250:
            raise HTTPException(status_code=422, detail="Animatsiya limiti 20–250 oralig'ida bo'lishi kerak")
        value = {**value, "routing_provider": provider, "animation_corridor_limit": limit}
    item = await db.get(AppSetting, key)
    before = item.value if item else None
    if not item:
        item = AppSetting(key=key, value=value, updated_by=user.id)
        db.add(item)
    else:
        item.value = value
        item.updated_by = user.id
    await add_audit(db, request, user, "UPDATE", "app_setting", key, before={"value": before}, after={"value": value})
    await db.commit()
    return {"key": key, "value": value}


@router.get("/audit", tags=["audit"])
async def list_audit(
    page_size: int = Query(50, ge=1, le=200),
    action: str | None = None,
    search: str | None = Query(default=None, max_length=120),
    before: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(admin_user),
) -> dict:
    filters = []
    if action:
        filters.append(AuditLog.action == action)
    if before:
        filters.append(AuditLog.created_at < before)
    if search:
        pattern = contains_pattern(search)
        filters.append(or_(AuditLog.action.ilike(pattern, escape="\\"), AuditLog.entity_id.ilike(pattern, escape="\\"), AuditLog.ip_address.ilike(pattern, escape="\\"), AuditLog.user_agent.ilike(pattern, escape="\\")))
    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    rows = (await db.scalars(select(AuditLog).where(*filters).order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(page_size + 1))).all()
    has_more = len(rows) > page_size
    rows = rows[:page_size]
    return {"items": [{"id": str(r.id), "user_id": str(r.user_id) if r.user_id else None, "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id, "before": r.before_json, "after": r.after_json, "ip_address": r.ip_address, "user_agent": r.user_agent, "created_at": r.created_at} for r in rows], "total": total, "next_cursor": rows[-1].created_at if has_more and rows else None}


@router.get("/audit/export.csv", tags=["audit"])
async def export_audit(action: str | None = None, search: str | None = Query(default=None, max_length=120), db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> StreamingResponse:
    filters = []
    if action:
        filters.append(AuditLog.action == action)
    if search:
        pattern = contains_pattern(search)
        filters.append(or_(AuditLog.action.ilike(pattern, escape="\\"), AuditLog.entity_id.ilike(pattern, escape="\\"), AuditLog.ip_address.ilike(pattern, escape="\\"), AuditLog.user_agent.ilike(pattern, escape="\\")))
    rows = (await db.scalars(select(AuditLog).where(*filters).order_by(AuditLog.created_at.desc()).limit(10_000))).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Sana", "Harakat", "Obyekt turi", "Obyekt", "IP", "User-Agent"])
    for row in rows:
        writer.writerow([row.created_at.isoformat(), row.action, row.entity_type, row.entity_id or "", row.ip_address or "", row.user_agent or ""])
    return StreamingResponse(iter(["\ufeff" + output.getvalue()]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=audit-log.csv"})


@router.get("/audit/ip-stats", tags=["audit"])
async def audit_ip_stats(days: int = Query(7, ge=1, le=90), db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> dict:
    from datetime import UTC, timedelta
    cutoff = datetime.now(UTC) - timedelta(days=days)
    rows = (await db.execute(select(AuditLog.ip_address, func.count().label("visits"), func.max(AuditLog.created_at).label("last_seen")).where(AuditLog.created_at >= cutoff, AuditLog.ip_address.is_not(None)).group_by(AuditLog.ip_address).order_by(func.count().desc()).limit(100))).all()
    return {"items": [{"ip_address": row.ip_address, "visits": row.visits, "last_seen": row.last_seen} for row in rows]}

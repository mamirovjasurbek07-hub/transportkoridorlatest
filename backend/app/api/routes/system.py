import time

import httpx
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import admin_user, csrf_protect
from app.models import AppSetting, AuditLog, Corridor, CustomsPost, TransitDeclaration, User
from app.seed import seed_demo_declarations
from app.audit import add_audit
from app.country_data import COUNTRIES
from app.config import settings

router = APIRouter(tags=["system"])
_border_cache: tuple[float, dict] | None = None

@router.get("/health", tags=["health"])
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(text("SELECT 1"))
    pending_routes = await db.scalar(select(func.count()).select_from(Corridor).where(Corridor.geometry_source == "seed-routing-pending-v5")) or 0
    return {"status": "ok", "database": "connected", "pending_route_rebuilds": pending_routes}


@router.get("/map/config", tags=["map"])
async def map_config() -> dict:
    yandex_ready = settings.map_provider == "yandex" and bool(settings.yandex_maps_api_key.strip())
    routing_provider = "yandex" if settings.yandex_router_enabled and settings.routing_provider.lower() == "yandex" and settings.yandex_router_api_key.strip() else "osrm"
    return {
        "provider": "yandex" if yandex_ready else "osm",
        "requested_provider": settings.map_provider,
        "yandex_maps_api_key": settings.yandex_maps_api_key if yandex_ready else None,
        "routing_provider": routing_provider,
        "routing_profile": settings.routing_profile,
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
async def countries(db: AsyncSession = Depends(get_db)) -> list[dict]:
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
async def dashboard(db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> dict:
    total_posts = await db.scalar(select(func.count()).select_from(CustomsPost)) or 0
    located = await db.scalar(select(func.count()).select_from(CustomsPost).where(CustomsPost.latitude.is_not(None))) or 0
    active_corridors = await db.scalar(select(func.count()).select_from(Corridor).where(Corridor.is_active.is_(True))) or 0
    review = await db.scalar(select(func.count()).select_from(Corridor).where(Corridor.route_needs_review.is_(True))) or 0
    declarations = await db.scalar(select(func.count()).select_from(TransitDeclaration)) or 0
    return {"total_posts": total_posts, "located_posts": located, "unlocated_posts": total_posts - located, "active_corridors": active_corridors, "review_corridors": review, "declarations": declarations}


@router.get("/settings", tags=["settings"])
async def list_settings(db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> list[dict]:
    rows = (await db.scalars(select(AppSetting).order_by(AppSetting.key))).all()
    return [{"key": row.key, "value": row.value, "updated_at": row.updated_at} for row in rows]


@router.put("/settings/{key}", tags=["settings"], dependencies=[Depends(csrf_protect)])
async def update_setting(key: str, value: dict, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
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
async def list_audit(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> dict:
    total = await db.scalar(select(func.count()).select_from(AuditLog)) or 0
    rows = (await db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [{"id": str(r.id), "user_id": str(r.user_id) if r.user_id else None, "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id, "before": r.before_json, "after": r.after_json, "ip_address": r.ip_address, "created_at": r.created_at} for r in rows], "total": total, "page": page, "page_size": page_size}

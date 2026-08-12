import csv
import io
import json
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import and_, case, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Corridor, CustomsPost, TransitDeclaration

router = APIRouter(prefix="/analytics", tags=["analytics"])


def validate_dates(date_from: date, date_to: date) -> None:
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="Boshlanish sanasi tugash sanasidan katta")
    if date_to > date.today():
        raise HTTPException(status_code=422, detail="Kelajak sanasi ruxsat etilmagan")
    if (date_to - date_from).days > 730:
        raise HTTPException(status_code=422, detail="Sana oralig'i 2 yildan oshmasin")


def declaration_filters(date_from: date, date_to: date, origin: str | None, destination: str | None, entry: str | None, exit: str | None):
    filters = [TransitDeclaration.declaration_date.between(date_from, date_to)]
    if origin:
        filters.append(TransitDeclaration.origin_country_code == origin.upper())
    if destination:
        filters.append(TransitDeclaration.destination_country_code == destination.upper())
    if entry:
        filters.append(TransitDeclaration.entry_post_code == entry)
    if exit:
        filters.append(TransitDeclaration.exit_post_code == exit)
    return filters


async def analytics_payload(db: AsyncSession, date_from: date, date_to: date, origin: str | None, destination: str | None, entry: str | None, exit: str | None, corridor_code: str | None) -> dict:
    validate_dates(date_from, date_to)
    filters = declaration_filters(date_from, date_to, origin, destination, entry, exit)
    selected_corridor = None
    if corridor_code:
        selected_corridor = await db.scalar(select(Corridor).where(Corridor.code == corridor_code, Corridor.is_active.is_(True)))
        if selected_corridor is None:
            raise HTTPException(status_code=404, detail="Korridor topilmadi")
        filters.extend([
            TransitDeclaration.entry_post_code == selected_corridor.entry_post_code,
            TransitDeclaration.exit_post_code == selected_corridor.exit_post_code,
        ])
        if selected_corridor.origin_country_code:
            filters.append(TransitDeclaration.origin_country_code == selected_corridor.origin_country_code)
        if selected_corridor.destination_country_code:
            filters.append(TransitDeclaration.destination_country_code == selected_corridor.destination_country_code)
    transit_seconds = extract("epoch", TransitDeclaration.exit_time - TransitDeclaration.entry_time)
    grouped = (await db.execute(
        select(
            TransitDeclaration.entry_post_code,
            TransitDeclaration.exit_post_code,
            func.count().label("count"),
            func.avg(transit_seconds).label("avg_seconds"),
            func.min(transit_seconds).label("min_seconds"),
            func.max(transit_seconds).label("max_seconds"),
        ).where(*filters).group_by(TransitDeclaration.entry_post_code, TransitDeclaration.exit_post_code)
    )).all()
    total = sum(row.count for row in grouped)
    corridor_query = select(Corridor).where(Corridor.is_active.is_(True))
    if corridor_code:
        corridor_query = corridor_query.where(Corridor.code == corridor_code)
    if origin:
        corridor_query = corridor_query.where(Corridor.origin_country_code == origin.upper())
    if destination:
        corridor_query = corridor_query.where(Corridor.destination_country_code == destination.upper())
    corridors = (await db.scalars(corridor_query)).all()
    corridor_by_pair: dict[tuple[str, str], Corridor] = {}
    for c in sorted(corridors, key=lambda item: item.priority):
        corridor_by_pair.setdefault((c.entry_post_code, c.exit_post_code), c)
    features = []
    unavailable = []
    for row in grouped:
        corridor = corridor_by_pair.get((row.entry_post_code, row.exit_post_code))
        geometry = None
        if corridor and corridor.geometry is not None:
            raw = await db.scalar(select(ST_AsGeoJSON(Corridor.geometry)).where(Corridor.id == corridor.id))
            geometry = json.loads(raw) if raw else None
        properties = {
            "id": str(corridor.id) if corridor else f"{row.entry_post_code}-{row.exit_post_code}",
            "code": corridor.code if corridor else None,
            "name": corridor.name if corridor else "Tasdiqlangan route mavjud emas",
            "origin_country_code": corridor.origin_country_code if corridor else origin,
            "destination_country_code": corridor.destination_country_code if corridor else destination,
            "entry_post_code": row.entry_post_code,
            "exit_post_code": row.exit_post_code,
            "declaration_count": row.count,
            "percentage_share": round(row.count * 100 / total, 2) if total else 0,
            "avg_transit_minutes": round((row.avg_seconds or 0) / 60),
            "min_transit_minutes": round((row.min_seconds or 0) / 60),
            "max_transit_minutes": round((row.max_seconds or 0) / 60),
            "distance_km": round((corridor.distance_meters or 0) / 1000, 1) if corridor else None,
            "route_available": geometry is not None,
            "color": corridor.color if corridor and corridor.color else "#22d3ee",
        }
        if geometry:
            features.append({"type": "Feature", "geometry": geometry, "properties": properties})
        else:
            unavailable.append(properties)
    post_rows = (await db.scalars(select(CustomsPost).where(CustomsPost.is_active.is_(True), CustomsPost.latitude.is_not(None)))).all()
    entry_counts: dict[str, int] = {}
    exit_counts: dict[str, int] = {}
    for row in grouped:
        entry_counts[row.entry_post_code] = entry_counts.get(row.entry_post_code, 0) + row.count
        exit_counts[row.exit_post_code] = exit_counts.get(row.exit_post_code, 0) + row.count
    posts_geojson = {"type": "FeatureCollection", "features": [{
        "type": "Feature", "geometry": {"type": "Point", "coordinates": [p.longitude, p.latitude]},
        "properties": {"id": str(p.id), "post_code": p.post_code, "post_name": p.post_name, "post_type": p.post_type,
            "neighbor_country_code": p.neighbor_country_code, "entry_count": entry_counts.get(p.post_code, 0),
            "exit_count": exit_counts.get(p.post_code, 0), "total_flow": entry_counts.get(p.post_code, 0) + exit_counts.get(p.post_code, 0)},
    } for p in post_rows]}
    by_origin = (await db.execute(select(TransitDeclaration.origin_country_code, func.count().label("count")).where(*filters).group_by(TransitDeclaration.origin_country_code).order_by(func.count().desc()).limit(8))).all()
    trend = (await db.execute(select(TransitDeclaration.declaration_date, func.count().label("count")).where(*filters).group_by(TransitDeclaration.declaration_date).order_by(TransitDeclaration.declaration_date))).all()
    period_days = (date_to - date_from).days + 1
    previous_filters = declaration_filters(date_from - timedelta(days=period_days), date_from - timedelta(days=1), origin, destination, entry, exit)
    if selected_corridor is not None:
        previous_filters.extend([
            TransitDeclaration.entry_post_code == selected_corridor.entry_post_code,
            TransitDeclaration.exit_post_code == selected_corridor.exit_post_code,
        ])
        if selected_corridor.origin_country_code:
            previous_filters.append(TransitDeclaration.origin_country_code == selected_corridor.origin_country_code)
        if selected_corridor.destination_country_code:
            previous_filters.append(TransitDeclaration.destination_country_code == selected_corridor.destination_country_code)
    previous_total = await db.scalar(select(func.count()).select_from(TransitDeclaration).where(*previous_filters)) or 0
    change = round((total - previous_total) * 100 / previous_total, 1) if previous_total else (100.0 if total else 0.0)
    top_pairs = sorted(grouped, key=lambda r: r.count, reverse=True)[:5]
    top_corridor = max(features, key=lambda f: f["properties"]["declaration_count"], default=None)
    return {
        "meta": {"date_from": date_from, "date_to": date_to, "refreshed_at": datetime.utcnow().isoformat() + "Z", "unavailable_count": len(unavailable)},
        "kpis": {"total_declarations": total, "active_corridors": len(features), "entry_posts": len(entry_counts), "exit_posts": len(exit_counts),
            "top_corridor": top_corridor["properties"]["name"] if top_corridor else "—", "avg_transit_minutes": round(sum((r.avg_seconds or 0) * r.count for r in grouped) / total / 60) if total else 0,
            "change_percent": change},
        "corridors": {"type": "FeatureCollection", "features": features}, "posts": posts_geojson, "unavailable_routes": unavailable,
        "top_pairs": [{"entry": r.entry_post_code, "exit": r.exit_post_code, "count": r.count} for r in top_pairs],
        "country_share": [{"country": r.origin_country_code, "count": r.count, "share": round(r.count * 100 / total, 1) if total else 0} for r in by_origin],
        "trend": [{"date": r.declaration_date, "count": r.count} for r in trend],
    }


@router.get("")
async def analytics(
    date_from: date = Query(default_factory=lambda: date(date.today().year, 1, 1)),
    date_to: date = Query(default_factory=date.today), origin: str | None = None, destination: str | None = None,
    entry: str | None = None, exit: str | None = None, corridor: str | None = None, db: AsyncSession = Depends(get_db),
) -> dict:
    return await analytics_payload(db, date_from, date_to, origin, destination, entry, exit, corridor)


@router.get("/export.csv")
async def export_csv(date_from: date, date_to: date, origin: str | None = None, destination: str | None = None, db: AsyncSession = Depends(get_db)) -> Response:
    data = await analytics_payload(db, date_from, date_to, origin, destination, None, None, None)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Kirish posti", "Chiqish posti", "Deklaratsiyalar", "Ulush (%)"])
    for feature in data["corridors"]["features"]:
        p = feature["properties"]
        writer.writerow([p["entry_post_code"], p["exit_post_code"], p["declaration_count"], p["percentage_share"]])
    return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=transit-analytics.csv"})


@router.get("/corridors.geojson")
async def export_geojson(date_from: date, date_to: date, db: AsyncSession = Depends(get_db)) -> dict:
    return (await analytics_payload(db, date_from, date_to, None, None, None, None, None))["corridors"]

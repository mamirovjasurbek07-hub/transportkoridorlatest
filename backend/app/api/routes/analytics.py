import csv
import io
import json
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.database import get_db
from app.models import Corridor, CustomsPost, PostDailyMetric, TransitDeclaration

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


async def analytics_payload(db: AsyncSession, date_from: date, date_to: date, origin: str | None, destination: str | None, entry: str | None, exit: str | None, corridor_code: str | None, map_mode: str = "all") -> dict:
    validate_dates(date_from, date_to)
    filters = declaration_filters(date_from, date_to, origin, destination, entry, exit)
    selected_corridor = None
    if corridor_code:
        selected_corridor = await db.scalar(
            select(Corridor).options(noload(Corridor.waypoints)).where(
                Corridor.code == corridor_code, Corridor.is_active.is_(True)
            )
        )
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
            TransitDeclaration.origin_country_code,
            TransitDeclaration.destination_country_code,
            TransitDeclaration.entry_post_code,
            TransitDeclaration.exit_post_code,
            func.count().label("count"),
            func.avg(transit_seconds).label("avg_seconds"),
            func.min(transit_seconds).label("min_seconds"),
            func.max(transit_seconds).label("max_seconds"),
        ).where(*filters).group_by(
            TransitDeclaration.origin_country_code,
            TransitDeclaration.destination_country_code,
            TransitDeclaration.entry_post_code,
            TransitDeclaration.exit_post_code,
        )
    )).all()
    total = sum(row.count for row in grouped)
    available_corridor_count = await db.scalar(select(func.count()).select_from(Corridor).where(
        Corridor.is_active.is_(True), Corridor.route_needs_review.is_(False), Corridor.geometry.is_not(None),
    )) or 0
    row_by_pair = {(row.origin_country_code, row.destination_country_code, row.entry_post_code, row.exit_post_code): row for row in grouped}
    top_rows = sorted(grouped, key=lambda row: row.count, reverse=True)[:5]
    top_keys = {(row.origin_country_code, row.destination_country_code, row.entry_post_code, row.exit_post_code) for row in top_rows}
    corridor_query = select(Corridor).options(noload(Corridor.waypoints)).where(Corridor.is_active.is_(True))
    if corridor_code:
        corridor_query = corridor_query.where(Corridor.code == corridor_code)
    if origin:
        corridor_query = corridor_query.where(Corridor.origin_country_code == origin.upper())
    if destination:
        corridor_query = corridor_query.where(Corridor.destination_country_code == destination.upper())
    corridors = [] if map_mode == "posts" and not corridor_code else (await db.scalars(corridor_query)).all()
    post_rows = (await db.scalars(select(CustomsPost).where(CustomsPost.is_active.is_(True), CustomsPost.latitude.is_not(None)))).all()
    posts_by_code = {post.post_code: post for post in post_rows}
    post_names = {code: post.post_name for code, post in posts_by_code.items()}
    valid_geometry_corridors = [corridor for corridor in corridors if corridor.geometry is not None and not corridor.route_needs_review]
    if map_mode == "top5" and not corridor_code:
        valid_geometry_corridors = [corridor for corridor in valid_geometry_corridors if (corridor.origin_country_code, corridor.destination_country_code, corridor.entry_post_code, corridor.exit_post_code) in top_keys]
    geometry_by_id = {
        corridor_id: json.loads(raw)
        for corridor_id, raw in (await db.execute(
            select(
                Corridor.id,
                ST_AsGeoJSON(func.ST_SimplifyPreserveTopology(Corridor.geometry, 0.0003), 6),
            ).where(Corridor.id.in_([corridor.id for corridor in valid_geometry_corridors]))
        )).all()
        if raw
    } if valid_geometry_corridors else {}
    features = []
    unavailable = []
    display_corridors = sorted(valid_geometry_corridors, key=lambda item: (item.priority, item.name))
    for corridor in display_corridors:
        key = (corridor.origin_country_code, corridor.destination_country_code, corridor.entry_post_code, corridor.exit_post_code)
        row = row_by_pair.get(key)
        count = row.count if row else 0
        properties = {
            "id": str(corridor.id), "code": corridor.code, "name": corridor.name,
            "origin_country_code": corridor.origin_country_code, "destination_country_code": corridor.destination_country_code,
            "entry_post_code": corridor.entry_post_code, "exit_post_code": corridor.exit_post_code,
            "entry_post_name": post_names.get(corridor.entry_post_code, corridor.entry_post_code),
            "exit_post_name": post_names.get(corridor.exit_post_code, corridor.exit_post_code),
            "entry_allow_passenger": posts_by_code.get(corridor.entry_post_code).allow_passenger_vehicles if corridor.entry_post_code in posts_by_code else None,
            "entry_allow_cargo": posts_by_code.get(corridor.entry_post_code).allow_cargo_vehicles if corridor.entry_post_code in posts_by_code else None,
            "exit_allow_passenger": posts_by_code.get(corridor.exit_post_code).allow_passenger_vehicles if corridor.exit_post_code in posts_by_code else None,
            "exit_allow_cargo": posts_by_code.get(corridor.exit_post_code).allow_cargo_vehicles if corridor.exit_post_code in posts_by_code else None,
            "declaration_count": count, "percentage_share": round(count * 100 / total, 2) if total else 0,
            "avg_transit_minutes": round((row.avg_seconds or 0) / 60) if row else 0,
            "min_transit_minutes": round((row.min_seconds or 0) / 60) if row else 0,
            "max_transit_minutes": round((row.max_seconds or 0) / 60) if row else 0,
            "distance_km": round((corridor.distance_meters or 0) / 1000, 1), "route_available": True,
            "color": corridor.color or "#22d3ee",
        }
        features.append({"type": "Feature", "geometry": geometry_by_id[corridor.id], "properties": properties})
    invalid_corridors = [corridor for corridor in corridors if corridor not in valid_geometry_corridors]
    if map_mode == "top5" and not corridor_code:
        invalid_corridors = [corridor for corridor in invalid_corridors if (corridor.origin_country_code, corridor.destination_country_code, corridor.entry_post_code, corridor.exit_post_code) in top_keys]
    unavailable.extend({"id": str(corridor.id), "code": corridor.code, "name": corridor.name,
        "origin_country_code": corridor.origin_country_code, "destination_country_code": corridor.destination_country_code,
        "entry_post_code": corridor.entry_post_code, "exit_post_code": corridor.exit_post_code, "route_available": False}
        for corridor in invalid_corridors)
    entry_counts: dict[str, int] = {}
    exit_counts: dict[str, int] = {}
    for row in grouped:
        entry_counts[row.entry_post_code] = entry_counts.get(row.entry_post_code, 0) + row.count
        exit_counts[row.exit_post_code] = exit_counts.get(row.exit_post_code, 0) + row.count
    metric_rows = (await db.execute(
        select(
            PostDailyMetric.post_code,
            func.sum(PostDailyMetric.vehicles_entry).label("vehicles_entry"),
            func.sum(PostDailyMetric.vehicles_exit).label("vehicles_exit"),
            func.sum(PostDailyMetric.empty_wagons_entry).label("empty_wagons_entry"),
            func.sum(PostDailyMetric.empty_wagons_exit).label("empty_wagons_exit"),
            func.sum(PostDailyMetric.loaded_wagons_entry).label("loaded_wagons_entry"),
            func.sum(PostDailyMetric.loaded_wagons_exit).label("loaded_wagons_exit"),
            func.sum(PostDailyMetric.citizens_entry).label("citizens_entry"),
            func.sum(PostDailyMetric.citizens_exit).label("citizens_exit"),
            func.sum(PostDailyMetric.customs_inspections).label("customs_inspections"),
            func.sum(PostDailyMetric.personal_inspections).label("personal_inspections"),
            func.sum(PostDailyMetric.administrative_offenses).label("administrative_offenses"),
            func.sum(PostDailyMetric.criminal_cases).label("criminal_cases"),
            func.sum(PostDailyMetric.narcotics_kg).label("narcotics_kg"),
            func.sum(PostDailyMetric.customs_payments).label("customs_payments"),
            func.sum(PostDailyMetric.cases_count).label("cases_count"),
            func.sum(PostDailyMetric.additional_customs_payments).label("additional_customs_payments"),
        ).where(PostDailyMetric.metric_date.between(date_from, date_to)).group_by(PostDailyMetric.post_code)
    )).all()
    metrics_by_code = {row.post_code: row for row in metric_rows}
    metric_fields = (
        "vehicles_entry", "vehicles_exit", "empty_wagons_entry", "empty_wagons_exit",
        "loaded_wagons_entry", "loaded_wagons_exit", "citizens_entry", "citizens_exit", "customs_inspections",
        "personal_inspections", "administrative_offenses", "criminal_cases", "narcotics_kg",
        "customs_payments", "cases_count", "additional_customs_payments",
    )
    post_properties: list[dict] = []
    for post in post_rows:
        metric = metrics_by_code.get(post.post_code)
        values = {field: float(getattr(metric, field) or 0) if field in {"narcotics_kg", "customs_payments", "additional_customs_payments"} else int(getattr(metric, field) or 0) for field in metric_fields} if metric else {field: 0 for field in metric_fields}
        declaration_entry = entry_counts.get(post.post_code, 0)
        declaration_exit = exit_counts.get(post.post_code, 0)
        if post.post_type in {"CHBP", "PORT"} and not (values["vehicles_entry"] or values["vehicles_exit"]):
            values["vehicles_entry"] = declaration_entry
            values["vehicles_exit"] = declaration_exit
        if post.post_type == "RW" and metric is None:
            values["loaded_wagons_entry"] = declaration_entry
            values["loaded_wagons_exit"] = declaration_exit
        total_flow = (
            values["cases_count"] if post.post_type == "TIF"
            else values["citizens_entry"] + values["citizens_exit"] if post.post_type == "AERO"
            else values["empty_wagons_entry"] + values["empty_wagons_exit"] + values["loaded_wagons_entry"] + values["loaded_wagons_exit"] if post.post_type == "RW"
            else values["vehicles_entry"] + values["vehicles_exit"]
        )
        if post.post_type == "TIF":
            ranking_score = values["cases_count"] + values["customs_payments"] / 100_000_000 + values["additional_customs_payments"] / 10_000_000
        elif post.post_type == "AERO":
            ranking_score = total_flow + values["personal_inspections"] * 2 + values["administrative_offenses"] * 5 + values["criminal_cases"] * 20 + values["narcotics_kg"] * 30
        else:
            ranking_score = total_flow + (values["citizens_entry"] + values["citizens_exit"]) * .35 + values["customs_inspections"] * .5 + values["administrative_offenses"] * 5 + values["criminal_cases"] * 20 + values["narcotics_kg"] * 30
        post_properties.append({
            "id": str(post.id), "post_code": post.post_code, "post_name": post.post_name, "post_type": post.post_type,
            "post_category": post.post_category, "neighbor_country_code": post.neighbor_country_code,
            "period_from": date_from.isoformat(), "period_to": date_to.isoformat(),
            "entry_count": declaration_entry, "exit_count": declaration_exit, "total_flow": int(total_flow),
            "ranking_value": round(ranking_score, 2), "stats_source": "daily_metrics" if metric else "declarations",
            "allow_passenger_vehicles": post.allow_passenger_vehicles, "allow_cargo_vehicles": post.allow_cargo_vehicles,
            **values,
        })
    for post_type in {str(item["post_type"]) for item in post_properties}:
        ranked = sorted((item for item in post_properties if item["post_type"] == post_type), key=lambda item: (-float(item["ranking_value"]), str(item["post_code"])))
        best_value = max((float(item["ranking_value"]) for item in ranked), default=0)
        for position, item in enumerate(ranked, start=1):
            item["ranking_position"] = position
            item["ranking_total"] = len(ranked)
            item["type_ranking_score"] = round(float(item["ranking_value"]) * 100 / best_value, 1) if best_value else 0
    category_keys = {(str(item["post_type"]), str(item["post_category"])) for item in post_properties}
    for post_type, post_category in category_keys:
        ranked = sorted(
            (item for item in post_properties if item["post_type"] == post_type and item["post_category"] == post_category),
            key=lambda item: (-float(item["ranking_value"]), str(item["post_code"])),
        )
        best_value = max((float(item["ranking_value"]) for item in ranked), default=0)
        for position, item in enumerate(ranked, start=1):
            item["category_ranking_position"] = position
            item["category_ranking_total"] = len(ranked)
            item["category_ranking_score"] = round(float(item["ranking_value"]) * 100 / best_value, 1) if best_value else 0
    for item in post_properties:
        item["ranking_score"] = round(float(item.get("type_ranking_score", 0)) * .4 + float(item.get("category_ranking_score", 0)) * .6, 1)
    properties_by_code = {item["post_code"]: item for item in post_properties}
    posts_geojson = {"type": "FeatureCollection", "features": [{
        "type": "Feature", "geometry": {"type": "Point", "coordinates": [post.longitude, post.latitude]},
        "properties": properties_by_code[post.post_code],
    } for post in post_rows]}
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
    top_pairs = top_rows
    top_corridor = max(features, key=lambda f: f["properties"]["declaration_count"], default=None)
    return {
        "meta": {"date_from": date_from, "date_to": date_to, "refreshed_at": datetime.utcnow().isoformat() + "Z", "unavailable_count": len(unavailable)},
        "kpis": {"total_declarations": total, "active_corridors": available_corridor_count, "entry_posts": len(entry_counts), "exit_posts": len(exit_counts),
            "top_corridor": top_corridor["properties"]["name"] if top_corridor else "—", "avg_transit_minutes": round(sum((r.avg_seconds or 0) * r.count for r in grouped) / total / 60) if total else 0,
            "change_percent": change},
        "corridors": {"type": "FeatureCollection", "features": features}, "posts": posts_geojson, "unavailable_routes": unavailable,
        "top_pairs": [{"origin": r.origin_country_code, "destination": r.destination_country_code,
            "entry": r.entry_post_code, "exit": r.exit_post_code, "count": r.count} for r in top_pairs],
        "country_share": [{"country": r.origin_country_code, "count": r.count, "share": round(r.count * 100 / total, 1) if total else 0} for r in by_origin],
        "trend": [{"date": r.declaration_date, "count": r.count} for r in trend],
    }


@router.get("")
async def analytics(
    response: Response,
    date_from: date = Query(default_factory=lambda: date(date.today().year, 1, 1)),
    date_to: date = Query(default_factory=date.today), origin: str | None = None, destination: str | None = None,
    entry: str | None = None, exit: str | None = None, corridor: str | None = None, map_mode: str = Query("posts", pattern="^(posts|top5|all)$"), db: AsyncSession = Depends(get_db),
) -> dict:
    response.headers["Cache-Control"] = "public, max-age=15, stale-while-revalidate=30"
    return await analytics_payload(db, date_from, date_to, origin, destination, entry, exit, corridor, map_mode)


@router.get("/export.csv")
async def export_csv(date_from: date, date_to: date, origin: str | None = None, destination: str | None = None, db: AsyncSession = Depends(get_db)) -> Response:
    data = await analytics_payload(db, date_from, date_to, origin, destination, None, None, None, "all")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Kirish posti", "Chiqish posti", "Deklaratsiyalar", "Ulush (%)"])
    for feature in data["corridors"]["features"]:
        p = feature["properties"]
        writer.writerow([p["entry_post_code"], p["exit_post_code"], p["declaration_count"], p["percentage_share"]])
    return Response(output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=transit-analytics.csv"})


@router.get("/corridors.geojson")
async def export_geojson(date_from: date, date_to: date, db: AsyncSession = Depends(get_db)) -> dict:
    return (await analytics_payload(db, date_from, date_to, None, None, None, None, None, "all"))["corridors"]

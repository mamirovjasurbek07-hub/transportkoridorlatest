import asyncio
import hashlib
import json
from dataclasses import dataclass

import httpx
from geoalchemy2.functions import ST_AsGeoJSON, ST_GeomFromGeoJSON
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import RouteCache


@dataclass
class RoutingResult:
    available: bool
    geometry: dict | None
    distance_meters: int | None
    duration_seconds: int | None
    cached: bool = False
    message: str | None = None


class RoutingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _hash(waypoints: list[dict]) -> tuple[str, str]:
        normalized = [[round(float(w["longitude"]), 5), round(float(w["latitude"]), 5)] for w in waypoints]
        waypoints_hash = hashlib.sha256(json.dumps(normalized, separators=(",", ":")).encode()).hexdigest()
        cache_key = hashlib.sha256(f"{settings.routing_provider}:driving:{waypoints_hash}".encode()).hexdigest()
        return waypoints_hash, cache_key

    async def route(self, waypoints: list[dict], force: bool = False) -> RoutingResult:
        waypoints_hash, cache_key = self._hash(waypoints)
        cached = await self.db.scalar(select(RouteCache).where(RouteCache.cache_key == cache_key))
        if not force and cached:
                raw_geometry = await self.db.scalar(select(ST_AsGeoJSON(cached.geometry)).where(RouteCache.id == cached.id))
                return RoutingResult(True, json.loads(raw_geometry), cached.distance_meters, cached.duration_seconds, True)

        coords = ";".join(f'{w["longitude"]},{w["latitude"]}' for w in waypoints)
        url = f"{settings.routing_base_url.rstrip('/')}/route/v1/driving/{coords}"
        params = {"overview": "full", "geometries": "geojson", "steps": "false"}
        last_error = "Routing xizmati javob bermadi"
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=settings.routing_timeout_seconds) as client:
                    response = await client.get(url, params=params)
                    response.raise_for_status()
                    payload = response.json()
                if payload.get("code") != "Ok" or not payload.get("routes"):
                    return RoutingResult(False, None, None, None, message="Avtomobil yo'li topilmadi")
                route = payload["routes"][0]
                geometry = route["geometry"]
                if cached:
                    cache = cached
                    cache.geometry = ST_GeomFromGeoJSON(json.dumps(geometry))
                    cache.distance_meters = round(route["distance"])
                    cache.duration_seconds = round(route["duration"])
                else:
                    cache = RouteCache(
                        cache_key=cache_key,
                        provider=settings.routing_provider,
                        profile="driving",
                        waypoints_hash=waypoints_hash,
                        geometry=ST_GeomFromGeoJSON(json.dumps(geometry)),
                        distance_meters=round(route["distance"]),
                        duration_seconds=round(route["duration"]),
                    )
                    self.db.add(cache)
                await self.db.flush()
                return RoutingResult(True, geometry, cache.distance_meters, cache.duration_seconds)
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                last_error = str(exc)
                if attempt == 0:
                    await asyncio.sleep(0.35)
        return RoutingResult(False, None, None, None, message=f"Routing vaqtincha mavjud emas: {last_error[:120]}")

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
    provider: str
    cached: bool = False
    message: str | None = None


class RoutingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _hash(waypoints: list[dict], provider: str | None = None, profile: str | None = None) -> tuple[str, str]:
        provider = provider or RoutingService._provider()
        profile = profile or settings.routing_profile
        normalized = [[round(float(w["longitude"]), 5), round(float(w["latitude"]), 5)] for w in waypoints]
        waypoints_hash = hashlib.sha256(json.dumps(normalized, separators=(",", ":")).encode()).hexdigest()
        cache_key = hashlib.sha256(f"{provider}:{profile}:{waypoints_hash}".encode()).hexdigest()
        return waypoints_hash, cache_key

    @staticmethod
    def _provider() -> str:
        if settings.routing_provider.lower() == "yandex" and settings.yandex_router_api_key.strip():
            return "yandex"
        return "osrm"

    async def route(self, waypoints: list[dict], force: bool = False, profile: str | None = None) -> RoutingResult:
        provider = self._provider()
        requested_profile = profile or settings.routing_profile
        waypoints_hash, cache_key = self._hash(waypoints, provider, requested_profile)
        cached = await self.db.scalar(select(RouteCache).where(RouteCache.cache_key == cache_key))
        if not force and cached:
            raw_geometry = await self.db.scalar(select(ST_AsGeoJSON(cached.geometry)).where(RouteCache.id == cached.id))
            return RoutingResult(True, json.loads(raw_geometry), cached.distance_meters, cached.duration_seconds, cached.provider, True)

        if provider == "yandex":
            return await self._route_yandex(waypoints, waypoints_hash, cache_key, cached, requested_profile)
        return await self._route_osrm(waypoints, waypoints_hash, cache_key, cached, requested_profile)

    async def _save_cache(self, cached: RouteCache | None, cache_key: str, waypoints_hash: str, provider: str, profile: str, geometry: dict, distance: int, duration: int) -> RouteCache:
        if cached:
            cache = cached
            cache.geometry = ST_GeomFromGeoJSON(json.dumps(geometry))
            cache.distance_meters = distance
            cache.duration_seconds = duration
            cache.provider = provider
            cache.profile = profile
        else:
            cache = RouteCache(
                cache_key=cache_key,
                provider=provider,
                profile=profile,
                waypoints_hash=waypoints_hash,
                geometry=ST_GeomFromGeoJSON(json.dumps(geometry)),
                distance_meters=distance,
                duration_seconds=duration,
            )
            self.db.add(cache)
        await self.db.flush()
        return cache

    async def _route_osrm(self, waypoints: list[dict], waypoints_hash: str, cache_key: str, cached: RouteCache | None, profile: str) -> RoutingResult:

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
                    return RoutingResult(False, None, None, None, "osrm", message="Avtomobil yo'li topilmadi")
                route = payload["routes"][0]
                geometry = route["geometry"]
                cache = await self._save_cache(cached, cache_key, waypoints_hash, "osrm", profile, geometry, round(route["distance"]), round(route["duration"]))
                return RoutingResult(True, geometry, cache.distance_meters, cache.duration_seconds, "osrm")
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                last_error = str(exc)
                if attempt == 0:
                    await asyncio.sleep(0.35)
        return RoutingResult(False, None, None, None, "osrm", message=f"Routing vaqtincha mavjud emas: {last_error[:120]}")

    async def _route_yandex(self, waypoints: list[dict], waypoints_hash: str, cache_key: str, cached: RouteCache | None, profile: str) -> RoutingResult:
        if len(waypoints) > 50:
            return RoutingResult(False, None, None, None, "yandex", message="Yandex Router bir corridor uchun ko'pi bilan 50 nuqtani qabul qiladi")
        params = {
            "apikey": settings.yandex_router_api_key,
            "waypoints": "|".join(f'{w["latitude"]},{w["longitude"]}' for w in waypoints),
            "mode": "truck" if profile == "truck" else "driving",
            "traffic": "disabled",
        }
        last_error = "Yandex Router javob bermadi"
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=settings.routing_timeout_seconds) as client:
                    response = await client.get(settings.yandex_router_base_url, params=params)
                if response.status_code >= 400:
                    last_error = f"Yandex Router HTTP {response.status_code}"
                    if response.status_code in (400, 401, 403, 429):
                        break
                    raise httpx.HTTPStatusError(last_error, request=response.request, response=response)
                payload = response.json()
                legs = payload.get("route", {}).get("legs", [])
                if not legs or any(leg.get("status") != "OK" for leg in legs):
                    return RoutingResult(False, None, None, None, "yandex", message="Belgilangan nuqtalar bo'yicha avtomobil yo'li topilmadi")
                coordinates: list[list[float]] = []
                distance = 0.0
                duration = 0.0
                for leg in legs:
                    for step in leg.get("steps", []):
                        distance += float(step.get("length", 0))
                        duration += float(step.get("duration", 0))
                        for latitude, longitude in step.get("polyline", {}).get("points", []):
                            point = [float(longitude), float(latitude)]
                            if not coordinates or coordinates[-1] != point:
                                coordinates.append(point)
                if len(coordinates) < 2:
                    return RoutingResult(False, None, None, None, "yandex", message="Yandex Router yaroqli yo'l geometriyasini qaytarmadi")
                geometry = {"type": "LineString", "coordinates": coordinates}
                cache = await self._save_cache(cached, cache_key, waypoints_hash, "yandex", profile, geometry, round(distance), round(duration))
                return RoutingResult(True, geometry, cache.distance_meters, cache.duration_seconds, "yandex")
            except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError):
                if attempt == 0:
                    await asyncio.sleep(0.35)
        return RoutingResult(False, None, None, None, "yandex", message=last_error)

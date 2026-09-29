import asyncio
import hashlib
import json
import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import httpx
from geoalchemy2.functions import ST_AsGeoJSON, ST_GeomFromGeoJSON
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import AppSetting, RouteCache

_http_client: httpx.AsyncClient | None = None


def routing_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=settings.routing_timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": f"transport-corridors/1.1 ({settings.frontend_url})"},
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _http_client


async def close_routing_http_client() -> None:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
    _http_client = None


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
        provider = provider or settings.routing_provider.lower()
        profile = profile or settings.routing_profile
        normalized = [[round(float(w["longitude"]), 5), round(float(w["latitude"]), 5), str(w.get("waypoint_type") or "LAND")] for w in waypoints]
        waypoints_hash = hashlib.sha256(json.dumps(normalized, separators=(",", ":")).encode()).hexdigest()
        cache_key = hashlib.sha256(f"{provider}:{profile}:{waypoints_hash}".encode()).hexdigest()
        return waypoints_hash, cache_key

    @staticmethod
    def _provider() -> str:
        if settings.yandex_router_enabled and settings.routing_provider.lower() == "yandex" and settings.yandex_router_api_key.strip():
            return "yandex"
        return "osrm"

    async def _runtime_provider(self) -> str:
        configured = settings.routing_provider.lower()
        ui = await self.db.get(AppSetting, "ui")
        if ui and isinstance(ui.value, dict):
            requested = str(ui.value.get("routing_provider", configured)).lower()
            if requested in {"osrm", "yandex"}:
                configured = requested
        if settings.yandex_router_enabled and configured == "yandex" and settings.yandex_router_api_key.strip():
            return "yandex"
        return "osrm"

    async def route(self, waypoints: list[dict], force: bool = False, profile: str | None = None) -> RoutingResult:
        provider = await self._runtime_provider()
        requested_profile = profile or settings.routing_profile
        sea_edges = [index for index in range(len(waypoints) - 1) if waypoints[index].get("waypoint_type") == "SEA" and waypoints[index + 1].get("waypoint_type") == "SEA"]
        cache_provider = f"mixed-{provider}" if sea_edges else provider
        waypoints_hash, cache_key = self._hash(waypoints, cache_provider, requested_profile)
        cached = await self.db.scalar(select(RouteCache).where(RouteCache.cache_key == cache_key))
        cache_is_fresh = cached is not None and (cached.expires_at is None or cached.expires_at > datetime.now(UTC))
        if not force and cache_is_fresh:
            raw_geometry = await self.db.scalar(select(ST_AsGeoJSON(cached.geometry)).where(RouteCache.id == cached.id))
            return RoutingResult(True, json.loads(raw_geometry), cached.distance_meters, cached.duration_seconds, cached.provider, True)

        if sea_edges:
            return await self._route_mixed(waypoints, sea_edges, waypoints_hash, cache_key, cached, provider, requested_profile, force)
        if provider == "yandex":
            return await self._route_yandex(waypoints, waypoints_hash, cache_key, cached, requested_profile)
        return await self._route_osrm(waypoints, waypoints_hash, cache_key, cached, requested_profile)

    @staticmethod
    def _direct_segment(start: dict, end: dict, provider: str = "sea") -> RoutingResult:
        latitude_1 = math.radians(float(start["latitude"]))
        latitude_2 = math.radians(float(end["latitude"]))
        delta_latitude = latitude_2 - latitude_1
        delta_longitude = math.radians(float(end["longitude"]) - float(start["longitude"]))
        value = math.sin(delta_latitude / 2) ** 2 + math.cos(latitude_1) * math.cos(latitude_2) * math.sin(delta_longitude / 2) ** 2
        distance = round(6_371_000 * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0, 1 - value))))
        return RoutingResult(
            True,
            {"type": "LineString", "coordinates": [[float(start["longitude"]), float(start["latitude"])], [float(end["longitude"]), float(end["latitude"])]]},
            distance,
            round(distance / 8.33),
            provider,
        )

    async def _route_mixed(
        self,
        waypoints: list[dict],
        sea_edges: list[int],
        waypoints_hash: str,
        cache_key: str,
        cached: RouteCache | None,
        land_provider: str,
        profile: str,
        force: bool,
    ) -> RoutingResult:
        async def land_chunk(points: list[dict]) -> RoutingResult:
            if len(points) < 2:
                return RoutingResult(True, {"type": "LineString", "coordinates": []}, 0, 0, land_provider)
            result = await self.route(points, force=force, profile=profile)
            if result.available:
                return result
            if points[0].get("waypoint_type") == "SEA":
                connector = self._direct_segment(points[0], points[1], "sea-connector")
                remainder = await land_chunk(points[1:])
                if not remainder.available:
                    return remainder
                coordinates = connector.geometry["coordinates"] + remainder.geometry["coordinates"][1:]
                return RoutingResult(True, {"type": "LineString", "coordinates": coordinates}, (connector.distance_meters or 0) + (remainder.distance_meters or 0), (connector.duration_seconds or 0) + (remainder.duration_seconds or 0), f"mixed-{land_provider}")
            if points[-1].get("waypoint_type") == "SEA":
                prefix = await land_chunk(points[:-1])
                if not prefix.available:
                    return prefix
                connector = self._direct_segment(points[-2], points[-1], "sea-connector")
                coordinates = prefix.geometry["coordinates"] + connector.geometry["coordinates"][1:]
                return RoutingResult(True, {"type": "LineString", "coordinates": coordinates}, (prefix.distance_meters or 0) + (connector.distance_meters or 0), (prefix.duration_seconds or 0) + (connector.duration_seconds or 0), f"mixed-{land_provider}")
            return result

        coordinates: list[list[float]] = []
        total_distance = 0
        total_duration = 0

        def append_result(result: RoutingResult) -> None:
            nonlocal total_distance, total_duration
            segment = list((result.geometry or {}).get("coordinates") or [])
            if coordinates and segment and coordinates[-1] == segment[0]:
                segment = segment[1:]
            coordinates.extend(segment)
            total_distance += result.distance_meters or 0
            total_duration += result.duration_seconds or 0

        cursor = 0
        for edge in sea_edges:
            if edge + 1 < cursor:
                continue
            road = await land_chunk(waypoints[cursor:edge + 1])
            if not road.available:
                return road
            append_result(road)
            append_result(self._direct_segment(waypoints[edge], waypoints[edge + 1]))
            cursor = edge + 1
        road = await land_chunk(waypoints[cursor:])
        if not road.available:
            return road
        append_result(road)
        if len(coordinates) < 2:
            return RoutingResult(False, None, None, None, f"mixed-{land_provider}", message="Aralash yo'nalish uchun yetarli nuqta yo'q")
        geometry = {"type": "LineString", "coordinates": coordinates}
        provider = f"mixed-{land_provider}"
        cache = await self._save_cache(cached, cache_key, waypoints_hash, provider, profile, geometry, total_distance, total_duration)
        return RoutingResult(True, geometry, cache.distance_meters, cache.duration_seconds, provider)

    async def _save_cache(self, cached: RouteCache | None, cache_key: str, waypoints_hash: str, provider: str, profile: str, geometry: dict, distance: int, duration: int) -> RouteCache:
        if cached:
            cache = cached
            cache.geometry = ST_GeomFromGeoJSON(json.dumps(geometry))
            cache.distance_meters = distance
            cache.duration_seconds = duration
            cache.provider = provider
            cache.profile = profile
            cache.expires_at = datetime.now(UTC) + timedelta(days=settings.route_cache_days)
        else:
            cache = RouteCache(
                cache_key=cache_key,
                provider=provider,
                profile=profile,
                waypoints_hash=waypoints_hash,
                geometry=ST_GeomFromGeoJSON(json.dumps(geometry)),
                distance_meters=distance,
                duration_seconds=duration,
                expires_at=datetime.now(UTC) + timedelta(days=settings.route_cache_days),
            )
            self.db.add(cache)
        await self.db.flush()
        return cache

    async def _route_osrm(self, waypoints: list[dict], waypoints_hash: str, cache_key: str, cached: RouteCache | None, profile: str) -> RoutingResult:
        if profile == "truck":
            return RoutingResult(False, None, None, None, "osrm", message="OSRM public xizmati truck profilini qo'llamaydi. Yandex Router truck rejimini yoqing yoki driving profilini tanlang.")
        coords = ";".join(f'{w["longitude"]},{w["latitude"]}' for w in waypoints)
        url = f"{settings.routing_base_url.rstrip('/')}/route/v1/driving/{coords}"
        params = {"overview": "full", "geometries": "geojson", "steps": "false"}
        last_error = "Routing xizmati javob bermadi"
        for attempt in range(2):
            try:
                response = await routing_http_client().get(url, params=params)
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
                    await asyncio.sleep(0.2)
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
                response = await routing_http_client().get(settings.yandex_router_base_url, params=params)
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
                    await asyncio.sleep(0.2)
        return RoutingResult(False, None, None, None, "yandex", message=last_error)

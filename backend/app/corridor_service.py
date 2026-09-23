import hashlib
import json
import uuid

from geoalchemy2.functions import ST_GeomFromGeoJSON, ST_MakePoint, ST_SetSRID

from app.models import Corridor, CorridorWaypoint
from app.routing import RoutingResult


def apply_route_result(corridor: Corridor, result: RoutingResult) -> None:
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


def waypoint_model(corridor_id: uuid.UUID, data: dict) -> CorridorWaypoint:
    values = dict(data)
    if values.get("gateway_id") and not isinstance(values["gateway_id"], uuid.UUID):
        values["gateway_id"] = uuid.UUID(values["gateway_id"])
    point = CorridorWaypoint(corridor_id=corridor_id, **values)
    point.location = ST_SetSRID(ST_MakePoint(point.longitude, point.latitude), 4326)
    return point

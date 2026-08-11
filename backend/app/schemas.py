from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class UserRead(BaseModel):
    id: str
    email: EmailStr
    role: str
    is_active: bool


class LoginResponse(BaseModel):
    user: UserRead
    csrf_token: str
    password_change_recommended: bool


PostType = Literal["CHBP", "TIF", "AERO", "RW", "PORT"]


class PostBase(BaseModel):
    post_code: str = Field(pattern=r"^[0-9A-Za-z_-]{3,10}$")
    post_name: str = Field(min_length=2, max_length=255)
    post_type: PostType
    region: str | None = Field(default=None, max_length=120)
    neighbor_country_code: str | None = Field(default=None, min_length=2, max_length=2)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_verified: bool = False
    is_active: bool = True

    @model_validator(mode="after")
    def validate_location(self) -> "PostBase":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude va longitude birga kiritilishi kerak")
        if self.post_type == "CHBP" and not self.neighbor_country_code:
            raise ValueError("CHBP uchun chegaradosh davlat majburiy")
        if self.neighbor_country_code:
            self.neighbor_country_code = self.neighbor_country_code.upper()
        return self


class PostCreate(PostBase):
    pass


class PostUpdate(BaseModel):
    post_name: str | None = Field(default=None, min_length=2, max_length=255)
    post_type: PostType | None = None
    region: str | None = None
    neighbor_country_code: str | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_verified: bool | None = None
    is_active: bool | None = None


class PostRead(PostBase):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime


WaypointType = Literal["ORIGIN_GATEWAY", "ENTRY_POST", "VIA", "EXIT_POST", "DESTINATION_GATEWAY"]


class WaypointInput(BaseModel):
    sequence_no: int = Field(ge=0)
    waypoint_type: WaypointType
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    post_code: str | None = None
    gateway_id: str | None = None
    label: str | None = None


class CorridorBase(BaseModel):
    code: str = Field(min_length=2, max_length=60)
    name: str = Field(min_length=3, max_length=255)
    origin_country_code: str | None = Field(default=None, min_length=2, max_length=2)
    destination_country_code: str | None = Field(default=None, min_length=2, max_length=2)
    entry_post_code: str
    exit_post_code: str
    status: Literal["DRAFT", "ACTIVE", "REVIEW", "INACTIVE"] = "DRAFT"
    color: str | None = None
    routing_profile: str = "driving"
    priority: int = Field(default=100, ge=1, le=9999)
    is_active: bool = True
    waypoints: list[WaypointInput] = []

    @model_validator(mode="after")
    def validate_waypoints(self) -> "CorridorBase":
        if len(self.waypoints) < 2:
            raise ValueError("Kamida 2 ta waypoint kerak")
        sequence = [w.sequence_no for w in self.waypoints]
        if len(set(sequence)) != len(sequence):
            raise ValueError("Waypoint tartib raqamlari takrorlanmasligi kerak")
        return self


class CorridorCreate(CorridorBase):
    build_route: bool = True


class CorridorUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    color: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    waypoints: list[WaypointInput] | None = None
    rebuild_route: bool = False


class RoutePreviewRequest(BaseModel):
    waypoints: list[WaypointInput] = Field(min_length=2)
    force: bool = False


class RouteResult(BaseModel):
    status: Literal["available", "unavailable"]
    geometry: dict | None = None
    distance_meters: int | None = None
    duration_seconds: int | None = None
    provider: str
    cached: bool = False
    message: str | None = None


class CorridorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    code: str
    name: str
    origin_country_code: str | None
    destination_country_code: str | None
    entry_post_code: str
    exit_post_code: str
    status: str
    color: str | None
    routing_provider: str
    routing_profile: str
    geometry_source: str
    distance_meters: int | None
    duration_seconds: int | None
    route_needs_review: bool
    priority: int
    is_active: bool
    waypoints: list[WaypointInput]
    created_at: datetime
    updated_at: datetime


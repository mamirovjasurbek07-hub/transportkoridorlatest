import uuid
from datetime import date, datetime
from typing import Any

from geoalchemy2 import Geography, Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="ADMIN")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CustomsPost(Base, TimestampMixin):
    __tablename__ = "customs_posts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_code: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    post_name: Mapped[str] = mapped_column(String(255))
    post_type: Mapped[str] = mapped_column(String(10), index=True)
    region: Mapped[str | None] = mapped_column(String(120))
    neighbor_country_code: Mapped[str | None] = mapped_column(String(2), index=True)
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    location: Mapped[Any | None] = mapped_column(Geography("POINT", srid=4326))
    location_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CountryGateway(Base, TimestampMixin):
    __tablename__ = "country_gateways"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    country_code: Mapped[str] = mapped_column(String(2), index=True)
    name: Mapped[str] = mapped_column(String(255))
    gateway_type: Mapped[str] = mapped_column(String(40))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    location: Mapped[Any | None] = mapped_column(Geography("POINT", srid=4326))
    neighbor_country_code: Mapped[str | None] = mapped_column(String(2))
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)


class Corridor(Base, TimestampMixin):
    __tablename__ = "corridors"
    __table_args__ = (
        Index("ix_corridor_match", "origin_country_code", "destination_country_code", "entry_post_code", "exit_post_code"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    origin_country_code: Mapped[str | None] = mapped_column(String(2))
    destination_country_code: Mapped[str | None] = mapped_column(String(2))
    entry_post_code: Mapped[str] = mapped_column(ForeignKey("customs_posts.post_code"))
    exit_post_code: Mapped[str] = mapped_column(ForeignKey("customs_posts.post_code"))
    status: Mapped[str] = mapped_column(String(30), default="DRAFT")
    color: Mapped[str | None] = mapped_column(String(20))
    routing_provider: Mapped[str] = mapped_column(String(30), default="osrm")
    routing_profile: Mapped[str] = mapped_column(String(30), default="driving")
    geometry_source: Mapped[str] = mapped_column(String(30), default="router")
    geometry: Mapped[Any | None] = mapped_column(Geometry("LINESTRING", srid=4326))
    distance_meters: Mapped[int | None] = mapped_column(BigInteger)
    duration_seconds: Mapped[int | None] = mapped_column(BigInteger)
    geometry_hash: Mapped[str | None] = mapped_column(String(64))
    route_needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    waypoints: Mapped[list["CorridorWaypoint"]] = relationship(back_populates="corridor", cascade="all, delete-orphan", order_by="CorridorWaypoint.sequence_no", lazy="selectin")


class CorridorWaypoint(Base):
    __tablename__ = "corridor_waypoints"
    __table_args__ = (UniqueConstraint("corridor_id", "sequence_no"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    corridor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("corridors.id", ondelete="CASCADE"), index=True)
    sequence_no: Mapped[int] = mapped_column(Integer)
    waypoint_type: Mapped[str] = mapped_column(String(30))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    location: Mapped[Any | None] = mapped_column(Geography("POINT", srid=4326))
    post_code: Mapped[str | None] = mapped_column(String(10))
    gateway_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("country_gateways.id"))
    label: Mapped[str | None] = mapped_column(String(255))
    corridor: Mapped[Corridor] = relationship(back_populates="waypoints")


class TransitDeclaration(Base):
    __tablename__ = "transit_declarations"
    __table_args__ = (
        Index("ix_declaration_countries_date", "origin_country_code", "destination_country_code", "declaration_date"),
        Index("ix_declaration_posts_date", "entry_post_code", "exit_post_code", "declaration_date"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    declaration_no: Mapped[str] = mapped_column(String(80), unique=True)
    source_system: Mapped[str] = mapped_column(String(30), default="MOCK")
    declaration_date: Mapped[date] = mapped_column(Date, index=True)
    origin_country_code: Mapped[str] = mapped_column(String(2))
    destination_country_code: Mapped[str] = mapped_column(String(2))
    entry_post_code: Mapped[str] = mapped_column(String(10))
    exit_post_code: Mapped[str] = mapped_column(String(10))
    entry_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    exit_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    vehicle_no: Mapped[str | None] = mapped_column(String(40))
    carrier_name: Mapped[str | None] = mapped_column(String(255))
    state: Mapped[str | None] = mapped_column(String(30))
    raw_ref: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RouteCache(Base):
    __tablename__ = "route_cache"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cache_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(30))
    profile: Mapped[str] = mapped_column(String(30))
    waypoints_hash: Mapped[str] = mapped_column(String(64))
    geometry: Mapped[Any] = mapped_column(Geometry("LINESTRING", srid=4326))
    distance_meters: Mapped[int] = mapped_column(BigInteger)
    duration_seconds: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(80))
    before_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip_address: Mapped[str | None] = mapped_column(String(80))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

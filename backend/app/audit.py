import ipaddress
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


def client_ip(request: Request) -> str:
    """Return the original client IP when the immediate peer is a trusted proxy."""
    peer = request.client.host if request.client else None
    trust_forwarded = False
    if peer:
        try:
            peer_ip = ipaddress.ip_address(peer)
            trust_forwarded = peer_ip.is_private or peer_ip.is_loopback
        except ValueError:
            pass
    if trust_forwarded:
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        if forwarded:
            try:
                return str(ipaddress.ip_address(forwarded))[:80]
            except ValueError:
                pass
    return peer[:80] if peer else "unknown"


def audit_record(
    action: str,
    entity_type: str,
    entity_id: str | None,
    ip_address: str | None,
    user_agent: str,
    user: User | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> AuditLog:
    return AuditLog(
        user_id=user.id if user else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id[:80] if entity_id else None,
        before_json=jsonable_encoder(before) if before is not None else None,
        after_json=jsonable_encoder(after) if after is not None else None,
        ip_address=ip_address[:80] if ip_address else None,
        user_agent=user_agent[:255],
    )


def audit_entry(
    request: Request,
    action: str,
    entity_type: str,
    entity_id: str | None,
    user: User | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> AuditLog:
    return audit_record(
        action,
        entity_type,
        entity_id,
        client_ip(request),
        request.headers.get("user-agent", ""),
        user,
        before,
        after,
    )


async def add_audit(
    db: AsyncSession,
    request: Request,
    user: User,
    action: str,
    entity_type: str,
    entity_id: str | None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    db.add(audit_entry(request, action, entity_type, entity_id, user, before, after))


async def add_security_audit(
    db: AsyncSession,
    request: Request,
    action: str,
    entity_id: str | None,
    user: User | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    db.add(audit_entry(request, action, "security", entity_id, user, after=details))

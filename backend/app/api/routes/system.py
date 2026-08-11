from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import admin_user, csrf_protect
from app.models import AppSetting, AuditLog, Corridor, CustomsPost, TransitDeclaration, User
from app.seed import seed_demo_declarations
from app.audit import add_audit

router = APIRouter(tags=["system"])

COUNTRIES = [
    ("AF", "AFG", "Afg'oniston", "🇦🇫"), ("AZ", "AZE", "Ozarbayjon", "🇦🇿"),
    ("BY", "BLR", "Belarus", "🇧🇾"), ("CN", "CHN", "Xitoy", "🇨🇳"),
    ("GE", "GEO", "Gruziya", "🇬🇪"), ("IR", "IRN", "Eron", "🇮🇷"),
    ("KZ", "KAZ", "Qozog'iston", "🇰🇿"), ("KG", "KGZ", "Qirg'iziston", "🇰🇬"),
    ("PK", "PAK", "Pokiston", "🇵🇰"), ("RU", "RUS", "Rossiya", "🇷🇺"),
    ("TJ", "TJK", "Tojikiston", "🇹🇯"), ("TM", "TKM", "Turkmaniston", "🇹🇲"),
    ("TR", "TUR", "Turkiya", "🇹🇷"), ("UA", "UKR", "Ukraina", "🇺🇦"),
    ("UZ", "UZB", "O'zbekiston", "🇺🇿"),
]


@router.get("/health", tags=["health"])
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}


@router.get("/countries", tags=["countries"])
async def countries() -> list[dict]:
    return [{"alpha2": a2, "alpha3": a3, "name": name, "flag": flag} for a2, a3, name, flag in COUNTRIES]


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

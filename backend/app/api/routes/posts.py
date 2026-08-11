from datetime import UTC, datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from geoalchemy2.functions import ST_SetSRID, ST_MakePoint
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import admin_user, csrf_protect
from app.models import CustomsPost, User
from app.schemas import PostCreate, PostUpdate
from app.audit import add_audit

router = APIRouter(prefix="/posts", tags=["posts"])


def post_dict(p: CustomsPost) -> dict:
    return {
        "id": str(p.id), "post_code": p.post_code, "post_name": p.post_name, "post_type": p.post_type,
        "region": p.region, "neighbor_country_code": p.neighbor_country_code, "latitude": p.latitude,
        "longitude": p.longitude, "location_verified": p.location_verified, "is_active": p.is_active,
        "created_at": p.created_at, "updated_at": p.updated_at,
    }


@router.get("")
async def list_posts(
    search: str | None = None,
    post_type: str | None = None,
    country: str | None = None,
    active_only: bool = True,
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> dict:
    filters = []
    if active_only:
        filters += [CustomsPost.is_active.is_(True), CustomsPost.deleted_at.is_(None)]
    if search:
        filters.append(or_(CustomsPost.post_code.ilike(f"%{search}%"), CustomsPost.post_name.ilike(f"%{search}%")))
    if post_type:
        filters.append(CustomsPost.post_type == post_type)
    if country:
        filters.append(CustomsPost.neighbor_country_code == country.upper())
    total = await db.scalar(select(func.count()).select_from(CustomsPost).where(*filters))
    rows = (await db.scalars(select(CustomsPost).where(*filters).order_by(CustomsPost.post_code).offset((page - 1) * page_size).limit(page_size))).all()
    return {"items": [post_dict(p) for p in rows], "total": total or 0, "page": page, "page_size": page_size}


@router.post("", status_code=201, dependencies=[Depends(csrf_protect)])
async def create_post(payload: PostCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    if await db.scalar(select(CustomsPost.id).where(CustomsPost.post_code == payload.post_code)):
        raise HTTPException(status_code=409, detail="Bu post kodi mavjud")
    values = payload.model_dump()
    post = CustomsPost(**values)
    if post.latitude is not None:
        post.location = ST_SetSRID(ST_MakePoint(post.longitude, post.latitude), 4326)
    db.add(post)
    await db.flush()
    await add_audit(db, request, user, "CREATE", "customs_post", str(post.id), after=values)
    await db.commit()
    await db.refresh(post)
    return post_dict(post)


@router.patch("/{post_id}", dependencies=[Depends(csrf_protect)])
async def update_post(post_id: str, payload: PostUpdate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    post = await db.get(CustomsPost, uuid.UUID(post_id))
    if not post:
        raise HTTPException(status_code=404, detail="Post topilmadi")
    before = post_dict(post)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(post, key, value)
    if "latitude" in changes or "longitude" in changes:
        post.location = ST_SetSRID(ST_MakePoint(post.longitude, post.latitude), 4326) if post.latitude is not None and post.longitude is not None else None
    await add_audit(db, request, user, "UPDATE", "customs_post", str(post.id), before=before, after=changes)
    await db.commit()
    await db.refresh(post)
    return post_dict(post)


@router.delete("/{post_id}", dependencies=[Depends(csrf_protect)])
async def soft_delete_post(post_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    post = await db.get(CustomsPost, uuid.UUID(post_id))
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post topilmadi")
    post.is_active = False
    post.deleted_at = datetime.now(UTC)
    await add_audit(db, request, user, "SOFT_DELETE", "customs_post", str(post.id))
    await db.commit()
    return {"message": "Post nofaol qilindi"}

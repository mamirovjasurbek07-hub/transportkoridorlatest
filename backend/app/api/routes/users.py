import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import add_audit
from app.database import get_db
from app.dependencies import admin_user, csrf_protect
from app.models import User
from app.schemas import UserCreate, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


def payload(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "role": user.role, "is_active": user.is_active, "totp_enabled": user.totp_enabled, "last_login_at": user.last_login_at, "created_at": user.created_at}


@router.get("")
async def list_users(db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> dict:
    rows = (await db.scalars(select(User).order_by(User.created_at))).all()
    return {"items": [payload(row) for row in rows]}


@router.post("", status_code=201, dependencies=[Depends(csrf_protect)])
async def create_user(data: UserCreate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(admin_user)) -> dict:
    email = data.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Email noto'g'ri")
    if await db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Bu email mavjud")
    user = User(email=email, password_hash=hash_password(data.password), role=data.role, password_changed_at=datetime.now(UTC))
    db.add(user)
    await db.flush()
    await add_audit(db, request, admin, "CREATE", "user", str(user.id), after={"email": email, "role": data.role})
    await db.commit()
    return payload(user)


@router.patch("/{user_id}", dependencies=[Depends(csrf_protect)])
async def update_user(user_id: uuid.UUID, data: UserUpdate, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(admin_user)) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi")
    changes = data.model_dump(exclude_unset=True)
    if user.id == admin.id and changes.get("is_active") is False:
        raise HTTPException(status_code=409, detail="O'z profilingizni o'chira olmaysiz")
    if user.role == "ADMIN" and (changes.get("role") not in {None, "ADMIN"} or changes.get("is_active") is False):
        active_admins = await db.scalar(select(func.count()).select_from(User).where(User.role == "ADMIN", User.is_active.is_(True))) or 0
        if active_admins <= 1:
            raise HTTPException(status_code=409, detail="Oxirgi faol adminni o'zgartirib bo'lmaydi")
    before = {"role": user.role, "is_active": user.is_active}
    if "role" in changes:
        user.role = changes["role"]
    if "is_active" in changes:
        user.is_active = changes["is_active"]
    if changes.get("password"):
        user.password_hash = hash_password(changes["password"])
        user.password_changed_at = datetime.now(UTC)
    await add_audit(db, request, admin, "UPDATE", "user", str(user.id), before=before, after={key: value for key, value in changes.items() if key != "password"})
    await db.commit()
    return payload(user)

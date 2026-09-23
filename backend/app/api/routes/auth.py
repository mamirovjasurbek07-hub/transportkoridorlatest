from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from slowapi import Limiter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import add_security_audit, client_ip
from app.config import settings
from app.database import get_db
from app.dependencies import csrf_protect, current_user
from app.models import User
from app.schemas import LoginRequest
from app.security import create_access_token, new_csrf_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=client_ip)


def user_payload(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "role": user.role, "is_active": user.is_active}


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    email = str(payload.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        await add_security_audit(
            db,
            request,
            "LOGIN_FAILED",
            email,
            user=user,
            details={"result": "invalid_credentials"},
        )
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email yoki parol noto'g'ri")
    user.last_login_at = datetime.now(UTC)
    csrf = new_csrf_token()
    response.set_cookie(
        "access_token",
        create_access_token(str(user.id), user.role),
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.access_token_minutes * 60,
        path="/",
    )
    response.set_cookie(
        "csrf_token",
        csrf,
        httponly=False,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.access_token_minutes * 60,
        path="/",
    )
    await add_security_audit(db, request, "LOGIN_SUCCESS", user.email, user=user, details={"role": user.role})
    await db.commit()
    return {
        "user": user_payload(user),
        "csrf_token": csrf,
        "password_change_recommended": payload.password == settings.admin_initial_password,
    }


@router.get("/me")
async def me(request: Request, response: Response, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)) -> dict:
    csrf = new_csrf_token()
    response.set_cookie(
        "csrf_token",
        csrf,
        httponly=False,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.access_token_minutes * 60,
        path="/",
    )
    await add_security_audit(db, request, "ADMIN_SESSION_USED", user.email, user=user)
    await db.commit()
    return {**user_payload(user), "csrf_token": csrf}


@router.post("/logout", dependencies=[Depends(csrf_protect)])
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)) -> dict:
    await add_security_audit(db, request, "LOGOUT", user.email, user=user)
    await db.commit()
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("csrf_token", path="/")
    return {"message": "Sessiya yakunlandi"}

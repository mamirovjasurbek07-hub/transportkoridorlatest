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
from app.schemas import LoginRequest, PasswordChangeRequest, TotpCodeRequest
from app.security import create_access_token, hash_password, new_csrf_token, new_totp_secret, verify_password, verify_totp

router = APIRouter(prefix="/auth", tags=["auth"])
limiter = Limiter(key_func=client_ip)


def user_payload(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "role": user.role, "is_active": user.is_active, "totp_enabled": user.totp_enabled}


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    email = str(payload.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    password_valid = bool(user and user.is_active and verify_password(payload.password, user.password_hash))
    otp_valid = bool(user and (not user.totp_enabled or (user.totp_secret and payload.otp and verify_totp(user.totp_secret, payload.otp))))
    if not password_valid or not otp_valid:
        await add_security_audit(
            db,
            request,
            "LOGIN_FAILED",
            email,
            user=user,
            details={"result": "invalid_credentials_or_otp"},
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
    return {**user_payload(user), "csrf_token": csrf}


@router.post("/logout", dependencies=[Depends(csrf_protect)])
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)) -> dict:
    await add_security_audit(db, request, "LOGOUT", user.email, user=user)
    await db.commit()
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("csrf_token", path="/")
    return {"message": "Sessiya yakunlandi"}


@router.post("/password", dependencies=[Depends(csrf_protect)])
async def change_password(payload: PasswordChangeRequest, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=422, detail="Joriy parol noto'g'ri")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=422, detail="Yangi parol joriy paroldan farq qilishi kerak")
    user.password_hash = hash_password(payload.new_password)
    user.password_changed_at = datetime.now(UTC)
    await add_security_audit(db, request, "PASSWORD_CHANGED", user.email, user=user)
    await db.commit()
    return {"message": "Parol yangilandi"}


@router.post("/2fa/setup", dependencies=[Depends(csrf_protect)])
async def setup_2fa(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if user.totp_enabled:
        raise HTTPException(status_code=409, detail="2FA allaqachon yoqilgan")
    user.totp_secret = new_totp_secret()
    await db.commit()
    issuer = "Tranzit Geoanalitika"
    return {"secret": user.totp_secret, "otpauth_url": f"otpauth://totp/{issuer}:{user.email}?secret={user.totp_secret}&issuer={issuer}"}


@router.post("/2fa/enable", dependencies=[Depends(csrf_protect)])
async def enable_2fa(payload: TotpCodeRequest, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not user.totp_secret or not verify_totp(user.totp_secret, payload.code):
        raise HTTPException(status_code=422, detail="Tasdiqlash kodi noto'g'ri")
    user.totp_enabled = True
    await add_security_audit(db, request, "TOTP_ENABLED", user.email, user=user)
    await db.commit()
    return {"message": "Ikki bosqichli himoya yoqildi"}


@router.post("/2fa/disable", dependencies=[Depends(csrf_protect)])
async def disable_2fa(payload: TotpCodeRequest, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)) -> dict:
    if not user.totp_secret or not verify_totp(user.totp_secret, payload.code):
        raise HTTPException(status_code=422, detail="Tasdiqlash kodi noto'g'ri")
    user.totp_enabled = False
    user.totp_secret = None
    await add_security_audit(db, request, "TOTP_DISABLED", user.email, user=user)
    await db.commit()
    return {"message": "Ikki bosqichli himoya o'chirildi"}

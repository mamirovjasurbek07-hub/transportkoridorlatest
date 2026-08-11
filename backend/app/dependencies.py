import secrets
import uuid

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.security import decode_access_token


async def current_user(
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login talab qilinadi")
    try:
        payload = decode_access_token(access_token)
        user = await db.get(User, uuid.UUID(payload["sub"]))
    except (InvalidTokenError, KeyError, ValueError):
        user = None
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessiya yaroqsiz")
    return user


async def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin huquqi talab qilinadi")
    return user


async def csrf_protect(
    request: Request,
    x_csrf_token: str | None = Header(default=None),
    csrf_token: str | None = Cookie(default=None),
) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    if not csrf_token or not x_csrf_token or not secrets.compare_digest(csrf_token, x_csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token yaroqsiz")

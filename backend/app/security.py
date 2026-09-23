import hashlib
import base64
import hmac
import struct
import time
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.config import settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


def create_access_token(user_id: str, role: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_minutes),
        "jti": secrets.token_urlsafe(12),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def stable_token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret: str, timestamp: int | None = None) -> str:
    counter = (timestamp or int(time.time())) // 30
    padded = secret.upper() + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{value:06d}"


def verify_totp(secret: str, code: str) -> bool:
    clean = code.strip().replace(" ", "")
    now = int(time.time())
    return clean.isdigit() and len(clean) == 6 and any(
        secrets.compare_digest(totp_code(secret, now + offset * 30), clean) for offset in (-1, 0, 1)
    )

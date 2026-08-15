"""JWT authentication utilities for MoreAni v2."""

import logging
import os
import secrets
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext

logger = logging.getLogger("uvicorn")

# --- Config ---
_secret = os.getenv("SECRET_KEY")
if _secret:
    SECRET_KEY = _secret
else:
    SECRET_KEY = secrets.token_hex(32)
    logger.warning(
        "SECRET_KEY not set — using random key. "
        "All tokens will be invalidated on restart. "
        "Set SECRET_KEY env var for production."
    )

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 7

# --- Password hashing ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_password_hash(password: str) -> str:
    """Hash a plain-text password with bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


# --- JWT ---
def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Create a signed JWT access token.

    Args:
        data: Payload dict (must include "sub" with user id).
        expires_delta: Custom expiry; defaults to TOKEN_EXPIRE_DAYS.
    """
    to_encode = data.copy()
    expire = datetime.now(UTC) + (expires_delta or timedelta(days=TOKEN_EXPIRE_DAYS))
    to_encode.update({"exp": expire})
    # Ensure sub is string for jose compatibility
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict | None:
    """Decode and verify a JWT token.

    Returns:
        The payload dict on success, or None on failure.
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None

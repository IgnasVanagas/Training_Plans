import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional, Union, Any

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .models import User, OrganizationMember

logger = logging.getLogger(__name__)
_INSECURE_SECRET_KEY_VALUES = {
    "",
    "change_me",
    "change_me_in_production",
    "your-secret-key-keep-it-secret",
}


def _load_secret_key() -> str:
    configured_secret = (os.getenv("SECRET_KEY") or "").strip()
    if configured_secret and configured_secret not in _INSECURE_SECRET_KEY_VALUES:
        return configured_secret

    logger.warning(
        "SECRET_KEY is missing or uses a placeholder value; generating an ephemeral runtime key. "
        "Set a strong SECRET_KEY for any persistent or shared environment."
    )
    return secrets.token_urlsafe(64)


# Secret key settings
SECRET_KEY = _load_secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
JWT_ISSUER = os.getenv("JWT_ISSUER", "endurance-platform")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "endurance-client")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
# Used for extracting token from Authorization header
# tokenUrl is used by Swagger UI
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(subject: Union[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    now = datetime.utcnow()
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode = {
        "exp": expire,
        "iat": now,
        "nbf": now,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "jti": str(uuid.uuid4()),
        "sub": str(subject),
    }
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_action_token(*, subject: str, purpose: str, expires_minutes: int = 60) -> str:
    now = datetime.utcnow()
    expire = now + timedelta(minutes=max(1, expires_minutes))
    to_encode = {
        "exp": expire,
        "iat": now,
        "nbf": now,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "jti": str(uuid.uuid4()),
        "sub": str(subject),
        "purpose": purpose,
        "typ": "action",
    }
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_action_token(*, token: str, purpose: str) -> str:
    payload = jwt.decode(
        token,
        SECRET_KEY,
        algorithms=[ALGORITHM],
        audience=JWT_AUDIENCE,
        issuer=JWT_ISSUER,
    )
    if payload.get("typ") != "action":
        raise JWTError("invalid action token type")
    if payload.get("purpose") != purpose:
        raise JWTError("invalid action token purpose")
    subject = payload.get("sub")
    if not subject:
        raise JWTError("missing subject")
    return str(subject)

async def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        cookie_token = request.cookies.get("access_token")
        if cookie_token:
            token = cookie_token

    if not token:
        raise credentials_exception

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
        )
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
        user_id_int = int(user_id)
        if user_id_int <= 0:
            raise credentials_exception
    except JWTError as exc:
        raise credentials_exception from exc
    except (TypeError, ValueError) as exc:
        raise credentials_exception from exc

    result = await db.execute(
        select(User)
        .options(
            selectinload(User.profile),
            selectinload(User.organization_memberships).selectinload(OrganizationMember.organization)
        )
        .where(User.id == user_id_int)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user

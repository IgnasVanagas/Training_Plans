import uuid
import os
import asyncio
import secrets
from datetime import datetime, timedelta, UTC
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from jose import JWTError

from ..auth import create_access_token, create_refresh_token, decode_refresh_token, create_action_token, decode_action_token, get_current_user, get_password_hash, verify_password, REFRESH_TOKEN_EXPIRE_DAYS
from ..database import get_db
from ..models import Organization, Profile, User, OrganizationMember
from ..schemas import EmailCodeVerificationRequest, ForgotPasswordRequest, LoginRequest, MessageResponse, ResetPasswordRequest, TokenResponse, UserCreate
from ..services.email import send_verification_email

router = APIRouter(prefix="/auth", tags=["auth"])


def _should_expose_auth_debug_links() -> bool:
    return os.getenv("EXPOSE_AUTH_DEBUG_LINKS", "false").lower() in {"1", "true", "yes", "on"}


def _require_email_verification() -> bool:
    return os.getenv("REQUIRE_EMAIL_VERIFICATION", "false").lower() in {"1", "true", "yes", "on"}


def _generate_email_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _email_verification_expiry() -> datetime:
    minutes = int(os.getenv("EMAIL_CONFIRM_CODE_EXPIRE_MINUTES", "15"))
    return datetime.now(UTC) + timedelta(minutes=max(1, minutes))


def _set_auth_cookie(response: Response, token: str) -> None:
    secure_cookie = os.getenv("AUTH_COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"}
    same_site_cookie = (os.getenv("AUTH_COOKIE_SAMESITE") or "lax").strip().lower()
    if same_site_cookie not in {"lax", "strict", "none"}:
        same_site_cookie = "lax"
    max_age_seconds = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60")) * 60
    response.set_cookie(
        key="access_token",
        value=token,
        max_age=max_age_seconds,
        httponly=True,
        secure=secure_cookie,
        samesite=same_site_cookie,
        path="/",
    )


def _set_refresh_cookie(response: Response, token: str) -> None:
    secure_cookie = os.getenv("AUTH_COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"}
    same_site_cookie = (os.getenv("AUTH_COOKIE_SAMESITE") or "lax").strip().lower()
    if same_site_cookie not in {"lax", "strict", "none"}:
        same_site_cookie = "lax"
    max_age_seconds = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    response.set_cookie(
        key="refresh_token",
        value=token,
        max_age=max_age_seconds,
        httponly=True,
        secure=secure_cookie,
        samesite=same_site_cookie,
        path="/",
    )


@router.post("/register", response_model=MessageResponse)
async def register(payload: UserCreate, response: Response, db: AsyncSession = Depends(get_db)) -> MessageResponse:
    email = str(payload.email).strip().lower()

    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    org_id = None
    org_status = "active"

    if payload.organization_code:
        # Join existing organization
        result = await db.execute(select(Organization).where(Organization.code == payload.organization_code))
        existing_org = result.scalar_one_or_none()
        if not existing_org:
            raise HTTPException(status_code=404, detail="Organization not found with provided code")
        org_id = existing_org.id
        # If user joins via code, status is pending
        org_status = "pending"

    user = User(
        email=email,
        password_hash=get_password_hash(payload.password),
        email_verified=False,
        email_verification_code=_generate_email_verification_code(),
        email_verification_expires_at=_email_verification_expiry(),
        role=payload.role,
    )
    db.add(user)
    await db.flush()

    # Create Organization Membership only if joining via code
    if org_id is not None:
        member = OrganizationMember(
            user_id=user.id,
            organization_id=org_id,
            role=payload.role.value,
            status=org_status
        )
        db.add(member)

    profile = Profile(
        user_id=user.id,
        first_name=payload.first_name,
        last_name=payload.last_name,
        gender=payload.gender,
        birth_date=payload.birth_date
    )
    db.add(profile)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered")

    await send_verification_email(
        to_email=user.email,
        code=user.email_verification_code or "",
        expires_minutes=int(os.getenv("EMAIL_CONFIRM_CODE_EXPIRE_MINUTES", "15")),
    )

    secure_cookie = os.getenv("AUTH_COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"}
    same_site_cookie = (os.getenv("AUTH_COOKIE_SAMESITE") or "lax").strip().lower()
    if same_site_cookie not in {"lax", "strict", "none"}:
        same_site_cookie = "lax"
    response.delete_cookie(key="access_token", path="/", secure=secure_cookie, samesite=same_site_cookie)
    response.delete_cookie(key="refresh_token", path="/", secure=secure_cookie, samesite=same_site_cookie)
    return MessageResponse(message="Account created. Enter the 6-digit verification code sent to your email.")


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    email = str(payload.email).strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        await asyncio.sleep(0.35)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if _require_email_verification() and not user.email_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email not verified. Please verify your email.")

    token = create_access_token(subject=str(user.id))
    refresh = create_refresh_token(subject=str(user.id))
    _set_auth_cookie(response, token)
    _set_refresh_cookie(response, refresh)
    return TokenResponse(access_token=token)


@router.post("/logout")
async def logout(response: Response) -> dict:
    secure_cookie = os.getenv("AUTH_COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"}
    same_site_cookie = (os.getenv("AUTH_COOKIE_SAMESITE") or "lax").strip().lower()
    if same_site_cookie not in {"lax", "strict", "none"}:
        same_site_cookie = "lax"
    response.delete_cookie(
        key="access_token",
        path="/",
        secure=secure_cookie,
        samesite=same_site_cookie,
    )
    response.delete_cookie(
        key="refresh_token",
        path="/",
        secure=secure_cookie,
        samesite=same_site_cookie,
    )
    return {"message": "Logged out"}


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No refresh token")

    try:
        user_id = decode_refresh_token(refresh_token)
    except JWTError:
        response.delete_cookie(key="refresh_token", path="/")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = await db.scalar(select(User).where(User.id == int(user_id)))
    if not user:
        response.delete_cookie(key="refresh_token", path="/")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    new_access = create_access_token(subject=str(user.id))
    new_refresh = create_refresh_token(subject=str(user.id))
    _set_auth_cookie(response, new_access)
    _set_refresh_cookie(response, new_refresh)
    return TokenResponse(access_token=new_access)


def _build_frontend_action_url(*, route: str, token: str) -> str:
    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    return f"{base_url}{route}{quote(token)}"


@router.post("/request-email-confirmation")
async def request_email_confirmation(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    current_user.email_verification_code = _generate_email_verification_code()
    current_user.email_verification_expires_at = _email_verification_expiry()
    message = "Verification email queued"
    response = {"message": message}
    await send_verification_email(
        to_email=current_user.email,
        code=current_user.email_verification_code or "",
        expires_minutes=int(os.getenv("EMAIL_CONFIRM_CODE_EXPIRE_MINUTES", "15")),
    )
    await db.commit()
    return response


@router.post("/resend-email-confirmation")
async def resend_email_confirmation(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)) -> dict:
    email = str(payload.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == email))

    response = {"message": "If that email exists, a verification email has been sent."}
    if not user:
        return response
    if user.email_verified:
        return {"message": "Email is already verified."}

    user.email_verification_code = _generate_email_verification_code()
    user.email_verification_expires_at = _email_verification_expiry()
    await send_verification_email(
        to_email=user.email,
        code=user.email_verification_code or "",
        expires_minutes=int(os.getenv("EMAIL_CONFIRM_CODE_EXPIRE_MINUTES", "15")),
    )
    await db.commit()
    return response


@router.post("/verify-email")
async def verify_email(payload: EmailCodeVerificationRequest, db: AsyncSession = Depends(get_db)) -> dict:
    email = str(payload.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == email))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.email_verified:
        return {"message": "Email confirmed"}

    if user.email_verification_code != payload.code:
        raise HTTPException(status_code=400, detail="Invalid verification code")

    expires_at = user.email_verification_expires_at
    if not expires_at:
        raise HTTPException(status_code=400, detail="Verification code expired")
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        raise HTTPException(status_code=400, detail="Verification code expired")

    user.email_verified = True
    user.email_verification_code = None
    user.email_verification_expires_at = None
    await db.commit()
    return {"message": "Email confirmed"}


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)) -> dict:
    email = str(payload.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == email))

    response = {
        "message": "If that email exists, password reset instructions have been sent.",
    }
    if user and _should_expose_auth_debug_links():
        token = create_action_token(
            subject=user.email,
            purpose="password_reset",
            expires_minutes=int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "30")),
        )
        response["reset_url"] = _build_frontend_action_url(route="/login?reset=", token=token)
    return response


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        email = decode_action_token(token=payload.token, purpose="password_reset").strip().lower()
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user = await db.scalar(select(User).where(User.email == email))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = get_password_hash(payload.new_password)
    await db.commit()
    return {"message": "Password updated"}

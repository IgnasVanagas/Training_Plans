import uuid
import os
import asyncio
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from jose import JWTError

from ..auth import create_access_token, create_action_token, decode_action_token, get_current_user, get_password_hash, verify_password
from ..database import get_db
from ..models import Organization, Profile, User, OrganizationMember
from ..schemas import EmailTokenRequest, ForgotPasswordRequest, LoginRequest, ResetPasswordRequest, TokenResponse, UserCreate

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_auth_cookie(response: Response, token: str) -> None:
    secure_cookie = os.getenv("AUTH_COOKIE_SECURE", "false").lower() in {"1", "true", "yes", "on"}
    max_age_seconds = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60")) * 60
    response.set_cookie(
        key="access_token",
        value=token,
        max_age=max_age_seconds,
        httponly=True,
        secure=secure_cookie,
        samesite="lax",
        path="/",
    )


@router.post("/register", response_model=TokenResponse)
async def register(payload: UserCreate, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
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
    else:
        # Create new organization
        org_name = payload.organization_name or "Default Organization"
        new_org_code = str(uuid.uuid4())[:8]
        organization = Organization(name=org_name, code=new_org_code, settings_json={})
        db.add(organization)
        await db.flush()
        org_id = organization.id
        org_status = "active"

    user = User(
        email=email,
        password_hash=get_password_hash(payload.password),
        email_verified=False,
        role=payload.role,
    )
    db.add(user)
    await db.flush()

    # Create Organization Membership
    member = OrganizationMember(
        user_id=user.id,
        organization_id=org_id,
        role=payload.role.value,  # Assuming role string matches
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

    token = create_access_token(subject=str(user.id))
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    email = str(payload.email).strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        await asyncio.sleep(0.35)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(subject=str(user.id))
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Logged out"}


def _build_frontend_action_url(*, route: str, token: str) -> str:
    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    return f"{base_url}{route}{quote(token)}"


@router.post("/request-email-confirmation")
async def request_email_confirmation(
    current_user: User = Depends(get_current_user),
) -> dict:
    token = create_action_token(
        subject=current_user.email,
        purpose="email_confirm",
        expires_minutes=int(os.getenv("EMAIL_CONFIRM_TOKEN_EXPIRE_MINUTES", "1440")),
    )
    verify_url = _build_frontend_action_url(route="/login?verify=", token=token)
    message = "Verification email queued"
    return {"message": message, "verify_url": verify_url}


@router.post("/verify-email")
async def verify_email(payload: EmailTokenRequest, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        email = decode_action_token(token=payload.token, purpose="email_confirm").strip().lower()
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")

    user = await db.scalar(select(User).where(User.email == email))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.email_verified = True
    await db.commit()
    return {"message": "Email confirmed"}


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)) -> dict:
    email = str(payload.email).strip().lower()
    user = await db.scalar(select(User).where(User.email == email))

    reset_url = None
    if user:
        token = create_action_token(
            subject=user.email,
            purpose="password_reset",
            expires_minutes=int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_MINUTES", "30")),
        )
        reset_url = _build_frontend_action_url(route="/login?reset=", token=token)

    return {
        "message": "If that email exists, password reset instructions have been sent.",
        "reset_url": reset_url,
    }


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

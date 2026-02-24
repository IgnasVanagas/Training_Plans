import uuid
import os
import asyncio

from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import create_access_token, get_password_hash, verify_password
from ..database import get_db
from ..models import Organization, Profile, User, OrganizationMember
from ..schemas import LoginRequest, TokenResponse, UserCreate

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
    allow_self_register_coach = os.getenv("ALLOW_SELF_REGISTER_COACH", "false").lower() in {"1", "true", "yes", "on"}
    if payload.role.value == "coach" and not allow_self_register_coach:
        raise HTTPException(status_code=403, detail="Coach self-registration is disabled")

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

    await db.commit()

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

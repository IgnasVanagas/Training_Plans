from __future__ import annotations

import os
import pathlib
import uuid
from datetime import date as dt_date, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import (
    Activity,
    CommunicationAcknowledgement,
    CommunicationComment,
    CommunicationThread,
    OrganizationCoachMessage,
    OrganizationDirectMessage,
    OrganizationGroupMessage,
    OrganizationMember,
    PlannedWorkout,
    Profile,
    RoleEnum,
    User,
)
from ..schemas import (
    CommunicationAcknowledgementCreate,
    CommunicationAcknowledgementOut,
    CommunicationCommentCreate,
    CommunicationCommentOut,
    CommunicationThreadOut,
    NotificationItemOut,
    NotificationsFeedOut,
    OrgMemberOut,
    OrganizationChatMessageCreate,
    OrganizationChatMessageOut,
    OrganizationCoachChatMessageOut,
    OrganizationDirectMessageCreate,
    OrganizationDirectMessageOut,
    SupportRequestCreate,
    SupportRequestResponse,
)

_UPLOADS_DIR = pathlib.Path(os.getenv("UPLOADS_DIR", "uploads/chat"))
_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
from ..services.permissions import get_shared_org_ids
from ..services.support import (
    SupportDeliveryError,
    SupportSubmissionBlocked,
    send_support_email,
    validate_support_request,
)

router = APIRouter(prefix="/communications", tags=["communications"])


@router.post("/support", response_model=SupportRequestResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_support_request(
    request: Request,
    payload: SupportRequestCreate | None = None,
    name: str | None = Form(None),
    email: str | None = Form(None),
    subject: str | None = Form(None),
    message: str | None = Form(None),
    page_url: str | None = Form(None),
    error_message: str | None = Form(None),
    bot_trap: str | None = Form(None),
    client_elapsed_ms: int | None = Form(None),
    photos: list[UploadFile] = File(default=[]),
) -> SupportRequestResponse:
    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    # If sent as multipart form, build the payload from form fields
    if payload is None:
        if not email or not message:
            raise HTTPException(status_code=422, detail="email and message are required")
        payload = SupportRequestCreate(
            name=name or None,
            email=email,
            subject=subject or None,
            message=message,
            page_url=page_url or None,
            error_message=error_message or None,
            bot_trap=bot_trap or None,
            client_elapsed_ms=client_elapsed_ms or 0,
        )

    # Read photo data
    photo_attachments: list[tuple[str, bytes, str]] = []
    for photo in photos:
        if photo.content_type and not photo.content_type.startswith("image/"):
            continue
        data = await photo.read()
        if len(data) > 10 * 1024 * 1024:  # 10 MB limit per photo
            raise HTTPException(status_code=413, detail="Photo too large (max 10 MB)")
        photo_attachments.append((
            photo.filename or "photo.jpg",
            data,
            photo.content_type or "image/jpeg",
        ))

    try:
        validate_support_request(payload, client_host=client_host, user_agent=user_agent)
        await send_support_email(
            payload,
            client_host=client_host,
            user_agent=user_agent,
            attachments=photo_attachments or None,
        )
    except SupportSubmissionBlocked as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SupportDeliveryError as exc:
        raise HTTPException(
            status_code=503,
            detail="Support is temporarily unavailable. Please try again later.",
        ) from exc

    return SupportRequestResponse(message="Support request sent.")


async def _require_active_org_membership(
    db: AsyncSession,
    *,
    user_id: int,
    organization_id: int,
    role: str | None = None,
) -> OrganizationMember:
    conditions = [
        OrganizationMember.user_id == user_id,
        OrganizationMember.organization_id == organization_id,
        OrganizationMember.status == "active",
    ]
    if role is not None:
        conditions.append(OrganizationMember.role == role)

    membership = await db.scalar(select(OrganizationMember).where(*conditions))
    if not membership:
        raise HTTPException(status_code=403, detail="Not authorized for this organization")
    return membership


def _sender_display_name(user: User, profile: Profile | None) -> str | None:
    if profile and (profile.first_name or profile.last_name):
        full_name = " ".join(part for part in [profile.first_name, profile.last_name] if part)
        return full_name.strip() or None
    return user.email


def _normalize_entity_type(value: str) -> str:
    normalized = (value or "").strip().lower()
    if normalized not in {"activity", "workout"}:
        raise HTTPException(status_code=400, detail="entity_type must be activity or workout")
    return normalized


async def _resolve_entity_owner_id(db: AsyncSession, *, entity_type: str, entity_id: int) -> int | None:
    if entity_type == "activity":
        activity = await db.scalar(select(Activity).where(Activity.id == entity_id))
        return activity.athlete_id if activity else None
    workout = await db.scalar(select(PlannedWorkout).where(PlannedWorkout.id == entity_id))
    return workout.user_id if workout else None


async def _ensure_access_to_entity(
    db: AsyncSession,
    *,
    current_user: User,
    entity_type: str,
    entity_id: int,
    athlete_id: int | None = None,
) -> int:
    owner_id = await _resolve_entity_owner_id(db, entity_type=entity_type, entity_id=entity_id)
    if owner_id is None:
        raise HTTPException(status_code=404, detail="Entity not found")

    if current_user.role == RoleEnum.athlete:
        if owner_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized")
        return current_user.id

    if current_user.role != RoleEnum.coach:
        raise HTTPException(status_code=403, detail="Only athlete or coach can use communication threads")

    target_athlete_id = athlete_id or owner_id
    if target_athlete_id != owner_id:
        raise HTTPException(status_code=400, detail="athlete_id does not match entity owner")

    shared_org_ids = await get_shared_org_ids(db, current_user.id, target_athlete_id)
    if not shared_org_ids:
        raise HTTPException(status_code=403, detail="No shared organization with athlete")

    return target_athlete_id


async def _list_thread_comments(db: AsyncSession, thread_id: int) -> list[CommunicationCommentOut]:
    rows = await db.execute(
        select(CommunicationComment, User)
        .join(User, User.id == CommunicationComment.author_id)
        .where(CommunicationComment.thread_id == thread_id)
        .order_by(CommunicationComment.created_at.asc())
    )
    out: list[CommunicationCommentOut] = []
    for comment, author in rows.all():
        role_value = author.role.value if hasattr(author.role, "value") else str(author.role)
        out.append(
            CommunicationCommentOut(
                id=comment.id,
                thread_id=comment.thread_id,
                author_id=comment.author_id,
                author_role=role_value,
                body=comment.body,
                created_at=comment.created_at,
            )
        )
    return out


@router.get("/threads/{entity_type}/{entity_id}", response_model=CommunicationThreadOut)
async def get_thread(
    entity_type: str,
    entity_id: int,
    athlete_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommunicationThreadOut:
    normalized_entity_type = _normalize_entity_type(entity_type)
    target_athlete_id = await _ensure_access_to_entity(
        db,
        current_user=current_user,
        entity_type=normalized_entity_type,
        entity_id=entity_id,
        athlete_id=athlete_id,
    )

    thread = await db.scalar(
        select(CommunicationThread).where(
            CommunicationThread.entity_type == normalized_entity_type,
            CommunicationThread.entity_id == entity_id,
            CommunicationThread.athlete_id == target_athlete_id,
        )
    )

    if not thread:
        return CommunicationThreadOut(
            id=0,
            entity_type=normalized_entity_type,
            entity_id=entity_id,
            athlete_id=target_athlete_id,
            coach_id=current_user.id if current_user.role == RoleEnum.coach else None,
            comments=[],
        )

    return CommunicationThreadOut(
        id=thread.id,
        entity_type=thread.entity_type,
        entity_id=thread.entity_id,
        athlete_id=thread.athlete_id,
        coach_id=thread.coach_id,
        comments=await _list_thread_comments(db, thread.id),
    )


@router.post("/threads/{entity_type}/{entity_id}/comments", response_model=CommunicationCommentOut)
async def add_thread_comment(
    entity_type: str,
    entity_id: int,
    payload: CommunicationCommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommunicationCommentOut:
    normalized_entity_type = _normalize_entity_type(entity_type)
    target_athlete_id = await _ensure_access_to_entity(
        db,
        current_user=current_user,
        entity_type=normalized_entity_type,
        entity_id=entity_id,
        athlete_id=payload.athlete_id,
    )

    thread = await db.scalar(
        select(CommunicationThread).where(
            CommunicationThread.entity_type == normalized_entity_type,
            CommunicationThread.entity_id == entity_id,
            CommunicationThread.athlete_id == target_athlete_id,
        )
    )

    if not thread:
        thread = CommunicationThread(
            entity_type=normalized_entity_type,
            entity_id=entity_id,
            athlete_id=target_athlete_id,
            coach_id=current_user.id if current_user.role == RoleEnum.coach else None,
        )
        db.add(thread)
        await db.flush()
    elif current_user.role == RoleEnum.coach and not thread.coach_id:
        thread.coach_id = current_user.id

    comment = CommunicationComment(
        thread_id=thread.id,
        author_id=current_user.id,
        body=payload.body.strip(),
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)

    role_value = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
    return CommunicationCommentOut(
        id=comment.id,
        thread_id=comment.thread_id,
        author_id=comment.author_id,
        author_role=role_value,
        body=comment.body,
        created_at=comment.created_at,
    )


@router.post("/acknowledgements", response_model=CommunicationAcknowledgementOut)
async def add_acknowledgement(
    payload: CommunicationAcknowledgementCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CommunicationAcknowledgementOut:
    normalized_entity_type = _normalize_entity_type(payload.entity_type)
    target_athlete_id = await _ensure_access_to_entity(
        db,
        current_user=current_user,
        entity_type=normalized_entity_type,
        entity_id=payload.entity_id,
        athlete_id=payload.athlete_id,
    )

    ack = CommunicationAcknowledgement(
        entity_type=normalized_entity_type,
        entity_id=payload.entity_id,
        athlete_id=target_athlete_id,
        actor_id=current_user.id,
        action=payload.action.strip().lower(),
        note=payload.note,
    )
    db.add(ack)
    await db.commit()
    await db.refresh(ack)

    return CommunicationAcknowledgementOut(
        id=ack.id,
        entity_type=ack.entity_type,
        entity_id=ack.entity_id,
        athlete_id=ack.athlete_id,
        actor_id=ack.actor_id,
        action=ack.action,
        note=ack.note,
        created_at=ack.created_at,
    )


@router.get("/acknowledgements/{entity_type}/{entity_id}", response_model=list[CommunicationAcknowledgementOut])
async def get_acknowledgements(
    entity_type: str,
    entity_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CommunicationAcknowledgementOut]:
    normalized_entity_type = _normalize_entity_type(entity_type)
    # Check access
    await _ensure_access_to_entity(
        db,
        current_user=current_user,
        entity_type=normalized_entity_type,
        entity_id=entity_id,
    )

    stmt = (
        select(CommunicationAcknowledgement)
        .where(
            CommunicationAcknowledgement.entity_type == normalized_entity_type,
            CommunicationAcknowledgement.entity_id == entity_id,
        )
        .order_by(CommunicationAcknowledgement.created_at.asc())
    )

    rows = await db.execute(stmt)
    return [
        CommunicationAcknowledgementOut(
            id=ack.id,
            entity_type=ack.entity_type,
            entity_id=ack.entity_id,
            athlete_id=ack.athlete_id,
            actor_id=ack.actor_id,
            action=ack.action,
            note=ack.note,
            created_at=ack.created_at,
        )
        for ack in rows.scalars().all()
    ]


@router.get("/history/{athlete_id}", response_model=list[CommunicationAcknowledgementOut])
async def get_communication_history(
    athlete_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CommunicationAcknowledgementOut]:
    if current_user.id != athlete_id:
        # Check if coach has access
        if current_user.role != RoleEnum.coach:
             raise HTTPException(status_code=403, detail="Not authorized")
        
        shared_org_ids = await get_shared_org_ids(db, current_user.id, athlete_id)
        if not shared_org_ids:
            raise HTTPException(status_code=403, detail="No shared organization with athlete")

    stmt = (
        select(CommunicationAcknowledgement)
        .where(CommunicationAcknowledgement.athlete_id == athlete_id)
        # Filter for coach notes or acknowledgements, usually history implies notes
        .where(CommunicationAcknowledgement.note != None) 
        .order_by(CommunicationAcknowledgement.created_at.desc())
        .limit(limit)
    )

    rows = await db.execute(stmt)
    return [
        CommunicationAcknowledgementOut(
            id=ack.id,
            entity_type=ack.entity_type,
            entity_id=ack.entity_id,
            athlete_id=ack.athlete_id,
            actor_id=ack.actor_id,
            action=ack.action,
            note=ack.note,
            created_at=ack.created_at,
        )
        for ack in rows.scalars().all()
    ]


@router.get("/notifications", response_model=NotificationsFeedOut)
async def get_notifications_feed(
    limit: int = Query(default=40, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationsFeedOut:
    items: list[NotificationItemOut] = []
    now = datetime.utcnow()
    coach_athlete_id_set: set[int] = set()

    if current_user.role == RoleEnum.coach:
        coach_org_ids = (
            await db.execute(
                select(OrganizationMember.organization_id).where(
                    OrganizationMember.user_id == current_user.id,
                    OrganizationMember.role == RoleEnum.coach.value,
                    OrganizationMember.status == "active",
                )
            )
        ).scalars().all()
        coach_org_id_set = set(coach_org_ids)

        athlete_ids = []
        if coach_org_id_set:
            athlete_ids = (
                await db.execute(
                    select(OrganizationMember.user_id).where(
                        OrganizationMember.organization_id.in_(coach_org_id_set),
                        OrganizationMember.role == RoleEnum.athlete.value,
                        OrganizationMember.status == "active",
                    )
                )
            ).scalars().all()

        if athlete_ids:
            coach_athlete_id_set = set(athlete_ids)
            recent_activities = (
                await db.execute(
                    select(Activity)
                    .where(Activity.athlete_id.in_(set(athlete_ids)))
                    .order_by(Activity.created_at.desc())
                    .limit(limit)
                )
            ).scalars().all()
            for activity in recent_activities:
                items.append(
                    NotificationItemOut(
                        id=f"activity-{activity.id}",
                        type="athlete_workout",
                        title="Athlete workout uploaded",
                        message=f"{activity.filename} ({activity.sport or 'activity'})",
                        created_at=activity.created_at,
                        entity_type="activity",
                        entity_id=activity.id,
                        athlete_id=activity.athlete_id,
                    )
                )

            recent_comments = (
                await db.execute(
                    select(CommunicationComment, CommunicationThread)
                    .join(CommunicationThread, CommunicationThread.id == CommunicationComment.thread_id)
                    .where(
                        CommunicationThread.athlete_id.in_(set(athlete_ids)),
                        CommunicationComment.author_id.in_(set(athlete_ids)),
                    )
                    .order_by(CommunicationComment.created_at.desc())
                    .limit(limit)
                )
            ).all()
            for comment, thread in recent_comments:
                items.append(
                    NotificationItemOut(
                        id=f"comment-{comment.id}",
                        type="message",
                        title="New athlete message",
                        message=comment.body,
                        created_at=comment.created_at,
                        entity_type=thread.entity_type,
                        entity_id=thread.entity_id,
                        athlete_id=thread.athlete_id,
                    )
                )

    else:
        upcoming_workouts = (
            await db.execute(
                select(PlannedWorkout)
                .where(
                    PlannedWorkout.user_id == current_user.id,
                    PlannedWorkout.date >= dt_date.today(),
                )
                .order_by(PlannedWorkout.date.asc())
                .limit(limit)
            )
        ).scalars().all()
        for workout in upcoming_workouts:
            items.append(
                NotificationItemOut(
                    id=f"planned-{workout.id}",
                    type="planned_workout",
                    title="New planned workout",
                    message=f"{workout.title} on {workout.date.isoformat()}",
                    created_at=datetime.combine(workout.date, datetime.min.time()),
                    entity_type="workout",
                    entity_id=workout.id,
                    athlete_id=current_user.id,
                )
            )

        coach_comments = (
            await db.execute(
                select(CommunicationComment, CommunicationThread, User)
                .join(CommunicationThread, CommunicationThread.id == CommunicationComment.thread_id)
                .join(User, User.id == CommunicationComment.author_id)
                .where(
                    CommunicationThread.athlete_id == current_user.id,
                    User.role == RoleEnum.coach,
                )
                .order_by(CommunicationComment.created_at.desc())
                .limit(limit)
            )
        ).all()
        for comment, thread, _author in coach_comments:
            items.append(
                NotificationItemOut(
                    id=f"coach-comment-{comment.id}",
                    type="message",
                    title="Coach message",
                    message=comment.body,
                    created_at=comment.created_at,
                    entity_type=thread.entity_type,
                    entity_id=thread.entity_id,
                    athlete_id=current_user.id,
                )
            )

        pending_invites = [
            m
            for m in current_user.organization_memberships
            if m.role == RoleEnum.athlete.value and m.status == "pending"
        ]
        for membership in pending_invites:
            org_name = membership.organization.name if membership.organization else "team"
            items.append(
                NotificationItemOut(
                    id=f"invite-{membership.organization_id}",
                    type="invitation",
                    title="Team invitation",
                    message=f"You were invited to join {org_name}",
                    created_at=now,
                    organization_id=membership.organization_id,
                    athlete_id=current_user.id,
                    status="pending",
                )
            )

    if current_user.role == RoleEnum.athlete:
        ack_stmt = (
            select(CommunicationAcknowledgement)
            .where(CommunicationAcknowledgement.athlete_id == current_user.id)
            .order_by(CommunicationAcknowledgement.created_at.desc())
            .limit(limit)
        )
    elif coach_athlete_id_set:
        ack_stmt = (
            select(CommunicationAcknowledgement)
            .where(
                CommunicationAcknowledgement.athlete_id.in_(coach_athlete_id_set),
                CommunicationAcknowledgement.actor_id != current_user.id,
            )
            .order_by(CommunicationAcknowledgement.created_at.desc())
            .limit(limit)
        )
    else:
        ack_stmt = select(CommunicationAcknowledgement).where(CommunicationAcknowledgement.id == -1)

    acknowledgements = (await db.execute(ack_stmt)).scalars().all()

    for ack in acknowledgements:
        items.append(
            NotificationItemOut(
                id=f"ack-{ack.id}",
                type="acknowledgement",
                title="Acknowledgement",
                message=ack.note or f"{ack.action} on {ack.entity_type} #{ack.entity_id}",
                created_at=ack.created_at,
                entity_type=ack.entity_type,
                entity_id=ack.entity_id,
                athlete_id=ack.athlete_id,
            )
        )

    sorted_items = sorted(items, key=lambda item: item.created_at, reverse=True)[:limit]
    return NotificationsFeedOut(items=sorted_items)


@router.get("/organizations/{organization_id}/group", response_model=list[OrganizationChatMessageOut])
async def list_organization_group_messages(
    organization_id: int,
    limit: int = Query(default=80, ge=1, le=300),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[OrganizationChatMessageOut]:
    await _require_active_org_membership(
        db,
        user_id=current_user.id,
        organization_id=organization_id,
    )

    rows = (
        await db.execute(
            select(OrganizationGroupMessage, User, Profile)
            .join(User, User.id == OrganizationGroupMessage.sender_id)
            .outerjoin(Profile, Profile.user_id == User.id)
            .where(OrganizationGroupMessage.organization_id == organization_id)
            .order_by(OrganizationGroupMessage.created_at.desc())
            .limit(limit)
        )
    ).all()

    return [
        OrganizationChatMessageOut(
            id=message.id,
            organization_id=message.organization_id,
            sender_id=message.sender_id,
            sender_role=(sender.role.value if hasattr(sender.role, "value") else str(sender.role)),
            sender_name=_sender_display_name(sender, sender_profile),
            body=message.body,
            attachment_url=message.attachment_url,
            attachment_name=message.attachment_name,
            created_at=message.created_at,
        )
        for message, sender, sender_profile in reversed(rows)
    ]


@router.post("/organizations/{organization_id}/group", response_model=OrganizationChatMessageOut)
async def post_organization_group_message(
    organization_id: int,
    payload: OrganizationChatMessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationChatMessageOut:
    await _require_active_org_membership(
        db,
        user_id=current_user.id,
        organization_id=organization_id,
    )

    body = payload.body.strip()
    if not body and not payload.attachment_url:
        raise HTTPException(status_code=400, detail="Message must have text or attachment")

    message = OrganizationGroupMessage(
        organization_id=organization_id,
        sender_id=current_user.id,
        body=body,
        attachment_url=payload.attachment_url,
        attachment_name=payload.attachment_name,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    sender_profile = await db.scalar(select(Profile).where(Profile.user_id == current_user.id))
    return OrganizationChatMessageOut(
        id=message.id,
        organization_id=message.organization_id,
        sender_id=message.sender_id,
        sender_role=(current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)),
        sender_name=_sender_display_name(current_user, sender_profile),
        body=message.body,
        attachment_url=message.attachment_url,
        attachment_name=message.attachment_name,
        created_at=message.created_at,
    )


@router.get("/organizations/{organization_id}/coach-chat", response_model=list[OrganizationCoachChatMessageOut])
async def list_organization_coach_chat_messages(
    organization_id: int,
    coach_id: int | None = Query(default=None),
    athlete_id: int | None = Query(default=None),
    limit: int = Query(default=120, ge=1, le=400),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[OrganizationCoachChatMessageOut]:
    if current_user.role == RoleEnum.athlete:
        await _require_active_org_membership(
            db,
            user_id=current_user.id,
            organization_id=organization_id,
            role=RoleEnum.athlete.value,
        )
        if coach_id is None:
            raise HTTPException(status_code=400, detail="coach_id is required")
        await _require_active_org_membership(
            db,
            user_id=coach_id,
            organization_id=organization_id,
            role=RoleEnum.coach.value,
        )
        target_athlete_id = current_user.id
        target_coach_id = coach_id
    elif current_user.role == RoleEnum.coach:
        await _require_active_org_membership(
            db,
            user_id=current_user.id,
            organization_id=organization_id,
            role=RoleEnum.coach.value,
        )
        if athlete_id is None:
            raise HTTPException(status_code=400, detail="athlete_id is required")
        await _require_active_org_membership(
            db,
            user_id=athlete_id,
            organization_id=organization_id,
            role=RoleEnum.athlete.value,
        )
        target_athlete_id = athlete_id
        target_coach_id = current_user.id
    else:
        raise HTTPException(status_code=403, detail="Only athletes and coaches can access coach chats")

    rows = (
        await db.execute(
            select(OrganizationCoachMessage, User, Profile)
            .join(User, User.id == OrganizationCoachMessage.sender_id)
            .outerjoin(Profile, Profile.user_id == User.id)
            .where(
                OrganizationCoachMessage.organization_id == organization_id,
                OrganizationCoachMessage.athlete_id == target_athlete_id,
                OrganizationCoachMessage.coach_id == target_coach_id,
            )
            .order_by(OrganizationCoachMessage.created_at.desc())
            .limit(limit)
        )
    ).all()

    return [
        OrganizationCoachChatMessageOut(
            id=message.id,
            organization_id=message.organization_id,
            athlete_id=message.athlete_id,
            coach_id=message.coach_id,
            sender_id=message.sender_id,
            sender_role=(sender.role.value if hasattr(sender.role, "value") else str(sender.role)),
            sender_name=_sender_display_name(sender, sender_profile),
            body=message.body,
            attachment_url=message.attachment_url,
            attachment_name=message.attachment_name,
            created_at=message.created_at,
        )
        for message, sender, sender_profile in reversed(rows)
    ]


@router.post("/organizations/{organization_id}/coach-chat", response_model=OrganizationCoachChatMessageOut)
async def post_organization_coach_chat_message(
    organization_id: int,
    payload: OrganizationChatMessageCreate,
    coach_id: int | None = Query(default=None),
    athlete_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationCoachChatMessageOut:
    body = payload.body.strip()
    if not body and not payload.attachment_url:
        raise HTTPException(status_code=400, detail="Message must have text or attachment")

    if current_user.role == RoleEnum.athlete:
        await _require_active_org_membership(
            db,
            user_id=current_user.id,
            organization_id=organization_id,
            role=RoleEnum.athlete.value,
        )
        if coach_id is None:
            raise HTTPException(status_code=400, detail="coach_id is required")
        await _require_active_org_membership(
            db,
            user_id=coach_id,
            organization_id=organization_id,
            role=RoleEnum.coach.value,
        )
        target_athlete_id = current_user.id
        target_coach_id = coach_id
    elif current_user.role == RoleEnum.coach:
        await _require_active_org_membership(
            db,
            user_id=current_user.id,
            organization_id=organization_id,
            role=RoleEnum.coach.value,
        )
        if athlete_id is None:
            raise HTTPException(status_code=400, detail="athlete_id is required")
        await _require_active_org_membership(
            db,
            user_id=athlete_id,
            organization_id=organization_id,
            role=RoleEnum.athlete.value,
        )
        target_athlete_id = athlete_id
        target_coach_id = current_user.id
    else:
        raise HTTPException(status_code=403, detail="Only athletes and coaches can send coach chats")

    message = OrganizationCoachMessage(
        organization_id=organization_id,
        athlete_id=target_athlete_id,
        coach_id=target_coach_id,
        sender_id=current_user.id,
        body=body,
        attachment_url=payload.attachment_url,
        attachment_name=payload.attachment_name,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    sender_profile = await db.scalar(select(Profile).where(Profile.user_id == current_user.id))
    return OrganizationCoachChatMessageOut(
        id=message.id,
        organization_id=message.organization_id,
        athlete_id=message.athlete_id,
        coach_id=message.coach_id,
        sender_id=message.sender_id,
        sender_role=(current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)),
        sender_name=_sender_display_name(current_user, sender_profile),
        body=message.body,
        attachment_url=message.attachment_url,
        attachment_name=message.attachment_name,
        created_at=message.created_at,
    )


# ── Direct messages (any two org members) ─────────────────────────────────────

@router.get("/organizations/{organization_id}/members", response_model=list[OrgMemberOut])
async def list_organization_members(
    organization_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[OrgMemberOut]:
    await _require_active_org_membership(db, user_id=current_user.id, organization_id=organization_id)

    rows = (
        await db.execute(
            select(User, Profile, OrganizationMember)
            .join(OrganizationMember, OrganizationMember.user_id == User.id)
            .outerjoin(Profile, Profile.user_id == User.id)
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.status == "active",
                User.id != current_user.id,
            )
            .order_by(User.id.asc())
        )
    ).all()

    return [
        OrgMemberOut(
            id=user.id,
            email=user.email,
            role=(member.role),
            first_name=profile.first_name if profile else None,
            last_name=profile.last_name if profile else None,
        )
        for user, profile, member in rows
    ]


@router.get("/organizations/{organization_id}/direct/{user_id}", response_model=list[OrganizationDirectMessageOut])
async def list_organization_direct_messages(
    organization_id: int,
    user_id: int,
    limit: int = Query(default=120, ge=1, le=400),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[OrganizationDirectMessageOut]:
    await _require_active_org_membership(db, user_id=current_user.id, organization_id=organization_id)
    await _require_active_org_membership(db, user_id=user_id, organization_id=organization_id)

    rows = (
        await db.execute(
            select(OrganizationDirectMessage, User, Profile)
            .join(User, User.id == OrganizationDirectMessage.sender_id)
            .outerjoin(Profile, Profile.user_id == User.id)
            .where(
                OrganizationDirectMessage.organization_id == organization_id,
                or_(
                    (OrganizationDirectMessage.sender_id == current_user.id) & (OrganizationDirectMessage.recipient_id == user_id),
                    (OrganizationDirectMessage.sender_id == user_id) & (OrganizationDirectMessage.recipient_id == current_user.id),
                ),
            )
            .order_by(OrganizationDirectMessage.created_at.desc())
            .limit(limit)
        )
    ).all()

    return [
        OrganizationDirectMessageOut(
            id=msg.id,
            organization_id=msg.organization_id,
            sender_id=msg.sender_id,
            recipient_id=msg.recipient_id,
            sender_name=_sender_display_name(sender, sender_profile),
            sender_role=(sender.role.value if hasattr(sender.role, "value") else str(sender.role)),
            body=msg.body,
            attachment_url=msg.attachment_url,
            attachment_name=msg.attachment_name,
            created_at=msg.created_at,
        )
        for msg, sender, sender_profile in reversed(rows)
    ]


@router.post("/organizations/{organization_id}/direct/{user_id}", response_model=OrganizationDirectMessageOut)
async def post_organization_direct_message(
    organization_id: int,
    user_id: int,
    payload: OrganizationDirectMessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OrganizationDirectMessageOut:
    await _require_active_org_membership(db, user_id=current_user.id, organization_id=organization_id)
    await _require_active_org_membership(db, user_id=user_id, organization_id=organization_id)

    body = payload.body.strip()
    if not body and not payload.attachment_url:
        raise HTTPException(status_code=400, detail="Message must have text or attachment")

    msg = OrganizationDirectMessage(
        organization_id=organization_id,
        sender_id=current_user.id,
        recipient_id=user_id,
        body=body,
        attachment_url=payload.attachment_url,
        attachment_name=payload.attachment_name,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    sender_profile = await db.scalar(select(Profile).where(Profile.user_id == current_user.id))
    return OrganizationDirectMessageOut(
        id=msg.id,
        organization_id=msg.organization_id,
        sender_id=msg.sender_id,
        recipient_id=msg.recipient_id,
        sender_name=_sender_display_name(current_user, sender_profile),
        sender_role=(current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)),
        body=msg.body,
        attachment_url=msg.attachment_url,
        attachment_name=msg.attachment_name,
        created_at=msg.created_at,
    )


@router.post("/organizations/{organization_id}/attachment")
async def upload_chat_attachment(
    organization_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> JSONResponse:
    await _require_active_org_membership(db, user_id=current_user.id, organization_id=organization_id)

    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB)")

    original_name = file.filename or "attachment"
    ext = pathlib.Path(original_name).suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest = _UPLOADS_DIR / stored_name
    dest.write_bytes(data)

    return JSONResponse({"attachment_url": stored_name, "attachment_name": original_name})

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import ALGORITHM, SECRET_KEY
from ..models import IntegrationAuditLog, ProviderConnection, ProviderSyncState
from jose import jwt, JWTError


def build_oauth_state(*, user_id: int, provider: str) -> str:
    payload = {
        "sub": str(user_id),
        "provider": provider,
        "iat": int(datetime.utcnow().timestamp()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_oauth_state(state: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(state, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(status_code=400, detail="Invalid OAuth state") from exc
    return payload


def build_event_key(provider: str, payload: dict[str, Any], headers: dict[str, str]) -> str:
    candidate_headers = [
        "x-strava-event-id",
        "x-provider-event-id",
        "x-request-id",
    ]
    normalized_headers = {k.lower(): v for k, v in headers.items()}
    for header in candidate_headers:
        if normalized_headers.get(header):
            return f"{provider}:{normalized_headers[header]}"

    payload_bytes = json.dumps(payload, sort_keys=True).encode("utf-8")
    return f"{provider}:sha256:{hashlib.sha256(payload_bytes).hexdigest()}"


def merge_cursor(previous: dict[str, Any] | None, nxt: dict[str, Any] | None) -> dict[str, Any] | None:
    if not previous and not nxt:
        return None
    out = dict(previous or {})
    out.update(nxt or {})
    return out


async def log_integration_audit(
    db: AsyncSession,
    *,
    user_id: int,
    provider: str,
    action: str,
    status: str,
    message: str | None = None,
) -> None:
    entry = IntegrationAuditLog(
        user_id=user_id,
        provider=provider,
        action=action,
        status=status,
        message=message,
    )
    db.add(entry)
    await db.commit()


async def get_or_create_sync_state(db: AsyncSession, *, user_id: int, provider: str) -> ProviderSyncState:
    state = await db.scalar(
        select(ProviderSyncState).where(
            ProviderSyncState.user_id == user_id,
            ProviderSyncState.provider == provider,
        )
    )
    if state:
        return state

    # Use ON CONFLICT DO NOTHING to avoid IntegrityError + rollback which
    # would expire every object in the request-scoped session (including
    # current_user), causing MissingGreenlet on subsequent attribute access.
    stmt = pg_insert(ProviderSyncState).values(
        user_id=user_id,
        provider=provider,
        cursor={},
        sync_status="idle",
        sync_progress=0,
        sync_total=0,
        updated_at=datetime.utcnow(),
    ).on_conflict_do_nothing(
        constraint="uq_provider_sync_state_provider_user",
    )
    await db.execute(stmt)
    await db.commit()

    # Re-fetch ORM instance (whether we inserted or the row already existed)
    state = await db.scalar(
        select(ProviderSyncState).where(
            ProviderSyncState.user_id == user_id,
            ProviderSyncState.provider == provider,
        )
    )
    if state:
        return state
    raise RuntimeError("Failed to get or create provider sync state")


async def get_connection(db: AsyncSession, *, user_id: int, provider: str) -> ProviderConnection | None:
    return await db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.user_id == user_id,
            ProviderConnection.provider == provider,
        )
    )

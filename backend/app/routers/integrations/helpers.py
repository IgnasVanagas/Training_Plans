from __future__ import annotations

import os
from urllib.parse import urlencode

from fastapi import HTTPException
from starlette.requests import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...integrations.registry import get_connector
from ...integrations.service import log_integration_audit
from ...models import Activity, ProviderConnection


def _as_stream_payload(payload: object) -> dict:
    if isinstance(payload, dict):
        return payload
    return {}


def _has_strava_detail(payload: dict) -> bool:
    detail = payload.get("detail") if isinstance(payload.get("detail"), dict) else None
    if isinstance(detail, dict) and (
        isinstance(detail.get("data"), list)
        or isinstance(detail.get("laps"), list)
        or isinstance(detail.get("stats"), dict)
    ):
        return True

    return (
        isinstance(payload.get("data"), list) and len(payload.get("data") or []) > 0
    ) or (
        isinstance(payload.get("laps"), list) and len(payload.get("laps") or []) > 0
    )


def _wants_json(request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return "application/json" in accept.lower()


def _frontend_callback_url(*, provider: str, status: str, message: str | None = None) -> str:
    frontend_base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    callback_path = os.getenv("INTEGRATIONS_CALLBACK_PATH", "/dashboard")
    query = {
        "integration_provider": provider,
        "integration_status": status,
    }
    if message:
        query["integration_message"] = message
    return f"{frontend_base_url}{callback_path}?{urlencode(query)}"


def _ensure_provider(provider: str) -> str:
    key = provider.lower()
    if key not in {
        "strava",
        "polar",
        "suunto",
        "whoop",
        "garmin",
        "coros",
        "google_fit",
        "apple_health",
    }:
        raise HTTPException(status_code=404, detail="Unsupported provider")
    return key


async def _purge_provider_activities(
    db: AsyncSession,
    *,
    user_id: int,
    provider: str,
) -> int:
    """Delete all activities sourced from a provider (Strava API §2.14.5, §4.4, §5.4)."""
    rows = await db.execute(
        select(Activity).where(
            Activity.athlete_id == user_id,
            Activity.file_type == "provider",
        )
    )
    purged = 0
    for activity in rows.scalars().all():
        payload = _as_stream_payload(activity.streams)
        meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
        if str(meta.get("source_provider") or "") != provider:
            continue
        activity.streams = None
        activity.is_deleted = True
        db.add(activity)
        purged += 1
    if purged > 0:
        await db.commit()
    return purged


async def _disconnect_provider_connection(
    db: AsyncSession,
    *,
    connection: ProviderConnection,
    reason: str,
    last_error: str | None = None,
) -> None:
    # Strava API Agreement §2.14.5 / §4.4 / §5.4: purge all provider data on disconnect.
    purged = await _purge_provider_activities(
        db, user_id=connection.user_id, provider=connection.provider,
    )
    connection.encrypted_access_token = None
    connection.encrypted_refresh_token = None
    connection.token_expires_at = None
    connection.status = "disconnected"
    connection.last_error = last_error
    await db.commit()
    await log_integration_audit(
        db,
        user_id=connection.user_id,
        provider=connection.provider,
        action="disconnect",
        status="warning" if last_error else "ok",
        message=f"{reason} Purged {purged} activities.",
    )

from __future__ import annotations

import asyncio
import os
from datetime import datetime
from datetime import date as dt_date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import AsyncSessionLocal
from ...integrations.registry import get_connector
from ...integrations.service import (
    get_or_create_sync_state,
    log_integration_audit,
)
from ...models import Activity, ProviderConnection, ProviderWebhookEvent
from ...services.compliance import match_and_score
from .helpers import _as_stream_payload, _disconnect_provider_connection


async def _find_strava_connection_by_owner_id(db: AsyncSession, owner_id: str) -> ProviderConnection | None:
    return await db.scalar(
        select(ProviderConnection).where(
            ProviderConnection.provider == "strava",
            ProviderConnection.external_athlete_id == owner_id,
        )
    )


async def _mark_strava_activity_deleted(db: AsyncSession, *, user_id: int, provider_activity_id: str) -> int:
    rows = await db.execute(
        select(Activity).where(
            Activity.athlete_id == user_id,
            Activity.file_type == "provider",
            Activity.streams['_meta']['source_activity_id'].astext == provider_activity_id,
        )
    )
    updated = 0
    matched_dates: set[dt_date] = set()
    for activity in rows.scalars().all():
        payload = _as_stream_payload(activity.streams)
        meta = payload.get("_meta") if isinstance(payload.get("_meta"), dict) else {}
        if str(meta.get("source_provider") or "") != "strava":
            continue
        meta.update({
            "deleted": True,
            "deleted_at": datetime.utcnow().isoformat(),
            "deleted_by": "strava_webhook",
        })
        payload["_meta"] = meta
        activity.streams = payload
        activity.is_deleted = True
        db.add(activity)
        updated += 1
        matched_dates.add(activity.created_at.date())
    if updated > 0:
        await db.commit()
        for match_date in sorted(matched_dates):
            await match_and_score(db, user_id, match_date)
    return updated


async def _queue_strava_recent_sync_from_webhook(db: AsyncSession, *, user_id: int, reason: str) -> str:
    # Import here to avoid circular import at module level
    from .sync_tasks import _sync_provider_task

    state = await get_or_create_sync_state(db, user_id=user_id, provider="strava")
    cursor = dict(state.cursor or {})
    cursor.pop("cancel_requested", None)
    cursor["strava_recent_only"] = True
    state.cursor = cursor

    if getattr(state, "sync_status", "idle") == "syncing":
        stale_sync_seconds = max(30, int(os.getenv("INTEGRATION_SYNC_STALE_SECONDS", "180")))
        updated_at = getattr(state, "updated_at", None)
        is_stale = (
            updated_at is None
            or (datetime.utcnow() - updated_at).total_seconds() > stale_sync_seconds
        )
        if not is_stale:
            state.sync_message = reason
            await db.commit()
            return "sync_already_running"
        # Stale sync (backend likely restarted mid-sync) — reset and continue
        state.sync_status = "idle"
        state.last_error = None

    state.sync_status = "syncing"
    state.sync_message = reason
    state.sync_progress = 0
    state.sync_total = 0
    state.last_error = None
    await db.commit()
    asyncio.create_task(_sync_provider_task("strava", user_id))
    return "sync_queued"


async def _process_strava_webhook_event(db: AsyncSession, payload: dict) -> dict:
    owner_id = str(payload.get("owner_id") or "").strip()
    object_type = str(payload.get("object_type") or "").strip().lower()
    aspect_type = str(payload.get("aspect_type") or "").strip().lower()
    updates = payload.get("updates") if isinstance(payload.get("updates"), dict) else {}

    if not owner_id:
        return {"status": "ignored", "reason": "missing_owner_id"}

    connection = await _find_strava_connection_by_owner_id(db, owner_id)
    if not connection:
        return {"status": "ignored", "reason": "owner_not_connected", "owner_id": owner_id}

    if object_type == "athlete" and str(updates.get("authorized") or "").lower() == "false":
        await _disconnect_provider_connection(
            db,
            connection=connection,
            reason="Strava athlete deauthorized the application.",
            last_error="Disconnected by Strava deauthorization webhook.",
        )
        return {"status": "deauthorized", "user_id": connection.user_id}

    if object_type != "activity":
        return {"status": "ignored", "reason": "unsupported_object", "object_type": object_type}

    object_id = str(payload.get("object_id") or "").strip()
    if not object_id:
        return {"status": "ignored", "reason": "missing_object_id"}

    if aspect_type == "delete":
        deleted_count = await _mark_strava_activity_deleted(db, user_id=connection.user_id, provider_activity_id=object_id)
        return {"status": "activity_deleted", "deleted_count": deleted_count, "user_id": connection.user_id}

    sync_status = await _queue_strava_recent_sync_from_webhook(
        db,
        user_id=connection.user_id,
        reason=f"Webhook received for Strava activity {object_id}; refreshing recent activities.",
    )
    return {"status": sync_status, "user_id": connection.user_id, "activity_id": object_id, "aspect_type": aspect_type}


async def _process_provider_webhook_event(provider: str, event_id: int) -> None:
    async with AsyncSessionLocal() as db:
        event = await db.scalar(select(ProviderWebhookEvent).where(ProviderWebhookEvent.id == event_id))
        if not event:
            return

        try:
            payload = event.payload if isinstance(event.payload, dict) else {}
            if provider == "strava":
                result = await _process_strava_webhook_event(db, payload)
            else:
                connector = get_connector(provider)
                result = await connector.handle_webhook(payload, {})

            event.status = "processed"
            event.processed_at = datetime.utcnow()
            event.last_error = None
            await db.commit()

            owner_id = payload.get("owner_id") if isinstance(payload, dict) else None
            if provider == "strava" and owner_id is not None:
                connection = await _find_strava_connection_by_owner_id(db, str(owner_id))
                if connection:
                    await log_integration_audit(
                        db,
                        user_id=connection.user_id,
                        provider=provider,
                        action="webhook_processed",
                        status="ok",
                        message=str(result),
                    )
        except Exception as exc:
            event.status = "failed"
            event.processed_at = datetime.utcnow()
            event.last_error = str(exc)
            await db.commit()

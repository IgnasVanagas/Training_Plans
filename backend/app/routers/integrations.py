from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from datetime import date as dt_date
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, Body
from fastapi.responses import RedirectResponse
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db, AsyncSessionLocal
from ..integrations.base import IntegrationUnavailableError
from ..integrations.crypto import decrypt_token, encrypt_token
from ..integrations.ingest import ingest_provider_activity
from ..integrations.registry import get_connector, list_provider_statuses
from ..integrations.service import (
    build_event_key,
    build_oauth_state,
    decode_oauth_state,
    get_connection,
    get_or_create_sync_state,
    log_integration_audit,
    merge_cursor,
)
from ..models import (
    Activity,
    HRVDaily,
    ProviderConnection,
    ProviderSyncState,
    ProviderWebhookEvent,
    RHRDaily,
    SleepSession,
    StressDaily,
    User,
)
from ..schemas import (
    BridgeSleepIn,
    BridgeWellnessIn,
    ManualWellnessIn,
    ProviderConnectOut,
    StravaImportPreferencesIn,
    StravaImportPreferencesOut,
    ProviderStatusOut,
    ProviderSyncOut,
    SyncStatusOut,
    WellnessSummaryOut,
)
from ..services.compliance import match_and_score
import os

router = APIRouter(prefix="/integrations", tags=["integrations"])


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


async def _strava_backfill_activity_details(
    db: AsyncSession,
    *,
    state: ProviderSyncState,
    connector,
    access_token: str,
    user_id: int,
    import_all_time: bool,
) -> tuple[int, str | None]:
    daily_limit = max(1, int(os.getenv("STRAVA_DAILY_REQUEST_LIMIT", "500")))
    detail_batch = max(20, min(50, int(os.getenv("STRAVA_DETAIL_BACKFILL_BATCH_ACTIVITIES", "50"))))
    detail_window_days = max(30, int(os.getenv("STRAVA_DETAIL_BACKFILL_WINDOW_DAYS", "365")))
    enrich_delay_seconds = max(0.0, float(os.getenv("STRAVA_ENRICH_DELAY_SECONDS", "0.35")))

    cursor = state.cursor or {}
    today_key = datetime.utcnow().strftime("%Y-%m-%d")
    request_day = str(cursor.get("strava_request_day") or "")
    request_used = int(cursor.get("strava_request_count") or 0)
    if request_day != today_key:
        request_day = today_key
        request_used = 0

    remaining_calls = max(0, daily_limit - request_used)
    max_by_budget = remaining_calls // 3
    if max_by_budget <= 0:
        cursor["strava_request_day"] = request_day
        cursor["strava_request_count"] = request_used
        cursor["strava_request_limit"] = daily_limit
        state.cursor = cursor
        return 0, f"Detail backfill paused (daily Strava limit {daily_limit} reached)."

    target_count = min(detail_batch, max_by_budget)
    cutoff = datetime.utcnow() - timedelta(days=detail_window_days)

    query = select(Activity).where(
        Activity.athlete_id == user_id,
        Activity.file_type == "provider",
    )
    if not import_all_time:
        query = query.where(Activity.created_at >= cutoff)
    query = query.order_by(Activity.created_at.desc()).limit(max(200, target_count * 12))
    res = await db.execute(query)
    activities = list(res.scalars().all())

    candidates: list[Activity] = []
    for activity in activities:
        streams = _as_stream_payload(activity.streams)
        meta = streams.get("_meta") if isinstance(streams.get("_meta"), dict) else {}
        if str(meta.get("source_provider") or "") != "strava":
            continue
        if not meta.get("source_activity_id"):
            continue
        if _has_strava_detail(streams):
            continue
        candidates.append(activity)
        if len(candidates) >= target_count:
            break

    enriched = 0
    for activity in candidates:
        if request_used + 3 > daily_limit:
            break

        streams = _as_stream_payload(activity.streams)
        meta = streams.get("_meta") if isinstance(streams.get("_meta"), dict) else {}
        source_activity_id = str(meta.get("source_activity_id"))
        try:
            async def _on_strava_request_debug(requests_last_10m: int):
                cursor_dbg = dict(state.cursor or {})
                cursor_dbg["strava_requests_last_10m"] = requests_last_10m
                state.cursor = cursor_dbg

            detail_payload = await connector.fetch_activity_deep_data(
                access_token=access_token,
                activity_id=source_activity_id,
                start_time=activity.created_at,
                request_debug_callback=_on_strava_request_debug,
            )
        except Exception:
            continue

        streams["data"] = detail_payload.get("data") or streams.get("data") or []
        streams["power_curve"] = detail_payload.get("power_curve")
        streams["hr_zones"] = detail_payload.get("hr_zones")
        streams["pace_curve"] = detail_payload.get("pace_curve")
        streams["laps"] = detail_payload.get("laps") or []
        streams["splits_metric"] = detail_payload.get("splits_metric") or []
        streams["stats"] = detail_payload.get("stats") or {}

        provider_payload = streams.get("provider_payload") if isinstance(streams.get("provider_payload"), dict) else {}
        provider_payload["detail"] = detail_payload.get("provider_activity_detail") or {}
        streams["provider_payload"] = provider_payload

        meta["enriched_at"] = datetime.utcnow().isoformat()
        streams["_meta"] = meta

        activity.streams = streams
        db.add(activity)
        enriched += 1
        request_used += 3

        if enrich_delay_seconds > 0:
            await db.commit()
            await db.reset()  # Release DB connection during sleep
            await asyncio.sleep(enrich_delay_seconds)
            state = await db.merge(state)  # Re-attach after pool release

    await db.commit()

    cursor = state.cursor or {}
    cursor["strava_request_day"] = request_day
    cursor["strava_request_count"] = request_used
    cursor["strava_request_limit"] = daily_limit
    state.cursor = cursor

    if enriched == 0:
        return 0, None
    return enriched, f"Background detail backfill enriched {enriched} activities."


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


async def _upsert_wellness(db: AsyncSession, *, user_id: int, provider: str, wellness_payload: dict) -> dict[str, int]:
    counts = {"hrv_daily": 0, "rhr_daily": 0, "sleep_sessions": 0, "stress_daily": 0}

    for item in wellness_payload.get("hrv_daily", []) or []:
        record = await db.scalar(
            select(HRVDaily).where(
                HRVDaily.user_id == user_id,
                HRVDaily.source_provider == provider,
                HRVDaily.record_date == item.get("date"),
            )
        )
        if not record:
            record = HRVDaily(
                user_id=user_id,
                source_provider=provider,
                record_date=item.get("date"),
                hrv_ms=float(item.get("hrv_ms") or 0),
                external_record_id=item.get("provider_record_id"),
            )
            db.add(record)
        else:
            record.hrv_ms = float(item.get("hrv_ms") or record.hrv_ms)
        counts["hrv_daily"] += 1

    for item in wellness_payload.get("rhr_daily", []) or []:
        record = await db.scalar(
            select(RHRDaily).where(
                RHRDaily.user_id == user_id,
                RHRDaily.source_provider == provider,
                RHRDaily.record_date == item.get("date"),
            )
        )
        if not record:
            record = RHRDaily(
                user_id=user_id,
                source_provider=provider,
                record_date=item.get("date"),
                resting_hr=float(item.get("resting_hr") or 0),
                external_record_id=item.get("provider_record_id"),
            )
            db.add(record)
        else:
            record.resting_hr = float(item.get("resting_hr") or record.resting_hr)
        counts["rhr_daily"] += 1

    for item in wellness_payload.get("sleep_sessions", []) or []:
        external_record_id = item.get("provider_record_id")
        if not external_record_id:
            continue
        record = await db.scalar(
            select(SleepSession).where(
                SleepSession.user_id == user_id,
                SleepSession.source_provider == provider,
                SleepSession.external_record_id == external_record_id,
            )
        )
        if not record:
            record = SleepSession(
                user_id=user_id,
                source_provider=provider,
                external_record_id=external_record_id,
                start_time=item.get("start_time"),
                end_time=item.get("end_time"),
                duration_seconds=int(item.get("duration_seconds") or 0),
                quality_score=item.get("quality_score"),
            )
            db.add(record)
        else:
            record.start_time = item.get("start_time") or record.start_time
            record.end_time = item.get("end_time") or record.end_time
            record.duration_seconds = int(item.get("duration_seconds") or record.duration_seconds)
            record.quality_score = item.get("quality_score", record.quality_score)
        counts["sleep_sessions"] += 1

    for item in wellness_payload.get("stress_daily", []) or []:
        record = await db.scalar(
            select(StressDaily).where(
                StressDaily.user_id == user_id,
                StressDaily.source_provider == provider,
                StressDaily.record_date == item.get("date"),
            )
        )
        if not record:
            record = StressDaily(
                user_id=user_id,
                source_provider=provider,
                record_date=item.get("date"),
                stress_score=float(item.get("stress_score") or 0),
                external_record_id=item.get("provider_record_id"),
            )
            db.add(record)
        else:
            record.stress_score = float(item.get("stress_score") or record.stress_score)
        counts["stress_daily"] += 1

    await db.commit()
    return counts


@router.get("/providers", response_model=list[ProviderStatusOut])
async def list_providers(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    matrix = list_provider_statuses()
    for item in matrix:
        connection = await get_connection(db, user_id=current_user.id, provider=item["provider"])
        if connection:
            item["connection_status"] = connection.status
            item["last_sync_at"] = connection.last_sync_at
            item["last_error"] = connection.last_error
        if item["provider"] == "strava":
            sync_state = await db.scalar(
                select(ProviderSyncState).where(
                    ProviderSyncState.user_id == current_user.id,
                    ProviderSyncState.provider == "strava",
                )
            )
            cursor = sync_state.cursor if sync_state and isinstance(sync_state.cursor, dict) else {}
            item["history_imported"] = bool(cursor.get("initial_sync_done"))
    return [ProviderStatusOut(**item) for item in matrix]


@router.get("/{provider}/connect", response_model=ProviderConnectOut)
async def connect_provider(
    provider: str,
    current_user: User = Depends(get_current_user),
):
    provider = _ensure_provider(provider)
    connector = get_connector(provider)

    if connector.approval_required:
        return ProviderConnectOut(
            provider=provider,
            status="pending_partner_approval",
            message=f"{connector.display_name} requires partner approval before production OAuth can be enabled.",
        )

    if connector.bridge_only:
        return ProviderConnectOut(
            provider=provider,
            status="bridge_ingestion",
            message=f"{connector.display_name} uses bridge ingestion endpoints; no direct OAuth in backend.",
        )

    if not connector.is_enabled():
        raise HTTPException(status_code=400, detail=f"{provider} integration is disabled by feature flag")
    if not connector.is_configured():
        if provider == "strava":
            missing: list[str] = []
            if not os.getenv("STRAVA_CLIENT_ID"):
                missing.append("STRAVA_CLIENT_ID")
            if not os.getenv("STRAVA_CLIENT_SECRET"):
                missing.append("STRAVA_CLIENT_SECRET")
            if not os.getenv("STRAVA_REDIRECT_URI"):
                missing.append("STRAVA_REDIRECT_URI")
            detail = (
                "strava integration is not configured"
                + (f"; missing: {', '.join(missing)}" if missing else "")
                + "; set vars in project .env and recreate backend container"
            )
            raise HTTPException(status_code=400, detail=detail)
        raise HTTPException(status_code=400, detail=f"{provider} integration is not configured")

    state = build_oauth_state(user_id=current_user.id, provider=provider)
    return ProviderConnectOut(provider=provider, authorize_url=connector.authorize_url(state), status="ready")


@router.get("/{provider}/callback")
async def provider_callback(
    request: Request,
    provider: str,
    code: str | None = None,
    state: str | None = None,
    scope: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    provider = _ensure_provider(provider)
    connector = get_connector(provider)

    if error:
        if _wants_json(request):
            raise HTTPException(status_code=400, detail=f"OAuth authorization failed: {error}")
        return RedirectResponse(
            url=_frontend_callback_url(provider=provider, status="failed", message=f"oauth_error:{error}"),
            status_code=302,
        )
    if not state or not code:
        if _wants_json(request):
            raise HTTPException(status_code=400, detail="Missing OAuth state or code")
        return RedirectResponse(
            url=_frontend_callback_url(provider=provider, status="failed", message="missing_state_or_code"),
            status_code=302,
        )

    state_payload = decode_oauth_state(state)
    if state_payload.get("provider") != provider:
        if _wants_json(request):
            raise HTTPException(status_code=400, detail="OAuth state/provider mismatch")
        return RedirectResponse(
            url=_frontend_callback_url(provider=provider, status="failed", message="state_provider_mismatch"),
            status_code=302,
        )

    user_id = int(state_payload.get("sub"))
    exchange = await connector.exchange_token(code)
    granted_scopes = connector._parse_scopes(scope) if provider == "strava" and scope else exchange.scopes
    if provider == "strava":
        missing_scopes = connector.missing_required_scopes(granted_scopes)
        if missing_scopes:
            if exchange.access_token:
                try:
                    await connector.deauthorize(exchange.access_token)
                except Exception:
                    pass
            detail = f"Missing required Strava scopes: {', '.join(missing_scopes)}"
            if _wants_json(request):
                raise HTTPException(status_code=400, detail=detail)
            return RedirectResponse(
                url=_frontend_callback_url(provider=provider, status="failed", message=f"missing_scopes:{','.join(missing_scopes)}"),
                status_code=302,
            )

    connection = await get_connection(db, user_id=user_id, provider=provider)
    if not connection:
        connection = ProviderConnection(user_id=user_id, provider=provider)
        db.add(connection)

    connection.external_athlete_id = exchange.external_athlete_id
    connection.encrypted_access_token = encrypt_token(exchange.access_token)
    connection.encrypted_refresh_token = encrypt_token(exchange.refresh_token)
    connection.token_expires_at = exchange.expires_at
    connection.scopes = granted_scopes
    connection.status = "connected"
    connection.last_error = None

    await db.commit()
    if provider == "strava" and connector.is_webhook_configured():
        try:
            webhook_result = await connector.ensure_webhook_subscription()
            await log_integration_audit(
                db,
                user_id=user_id,
                provider=provider,
                action="webhook_subscription_ensure",
                status="ok",
                message=str(webhook_result),
            )
        except Exception as exc:
            connection.last_error = f"Strava webhook subscription not ensured: {exc}"
            await db.commit()
            await log_integration_audit(
                db,
                user_id=user_id,
                provider=provider,
                action="webhook_subscription_ensure",
                status="warning",
                message=str(exc),
            )
    await log_integration_audit(
        db,
        user_id=user_id,
        provider=provider,
        action="connect",
        status="ok",
        message="OAuth connection established",
    )
    if _wants_json(request):
        return {"provider": provider, "status": "connected"}
    return RedirectResponse(
        url=_frontend_callback_url(provider=provider, status="connected"),
        status_code=302,
    )


@router.post("/{provider}/disconnect")
async def disconnect_provider(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    provider = _ensure_provider(provider)
    connector = get_connector(provider)
    connection = await get_connection(db, user_id=current_user.id, provider=provider)
    if not connection:
        raise HTTPException(status_code=404, detail="Provider connection not found")

    disconnect_warning: str | None = None
    if provider == "strava" and connection.encrypted_access_token:
        access_token = decrypt_token(connection.encrypted_access_token)
        if access_token:
            try:
                await connector.deauthorize(access_token)
            except Exception as exc:
                disconnect_warning = f"Strava deauthorization failed remotely: {exc}"

    await _disconnect_provider_connection(
        db,
        connection=connection,
        reason="Disconnected by user",
        last_error=disconnect_warning,
    )
    return {"provider": provider, "status": "disconnected"}


@router.get("/{provider}/status", response_model=ProviderStatusOut)
async def provider_status(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    provider = _ensure_provider(provider)
    connector = get_connector(provider)
    base = {
        "provider": provider,
        "display_name": connector.display_name,
        "enabled": connector.is_enabled(),
        "configured": connector.is_configured(),
        "approval_required": connector.approval_required,
        "bridge_only": connector.bridge_only,
        "required_scopes": connector.required_scopes,
        "docs_url": connector.docs_url,
        "connection_status": "disconnected",
        "last_sync_at": None,
        "last_error": None,
    }

    connection = await get_connection(db, user_id=current_user.id, provider=provider)
    if connection:
        base["connection_status"] = connection.status
        base["last_sync_at"] = connection.last_sync_at
        base["last_error"] = connection.last_error

    return base


@router.get("/strava/import-preferences", response_model=StravaImportPreferencesOut)
async def get_strava_import_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    state = await get_or_create_sync_state(db, user_id=current_user.id, provider="strava")
    cursor = state.cursor or {}
    return StravaImportPreferencesOut(
        import_all_time=bool(cursor.get("strava_import_all_time")),
        default_window_days=max(30, int(os.getenv("STRAVA_DETAIL_BACKFILL_WINDOW_DAYS", "365"))),
        daily_request_limit=max(1, int(os.getenv("STRAVA_DAILY_REQUEST_LIMIT", "500"))),
    )


@router.post("/strava/import-preferences", response_model=StravaImportPreferencesOut)
async def set_strava_import_preferences(
    payload: StravaImportPreferencesIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    state = await get_or_create_sync_state(db, user_id=current_user.id, provider="strava")
    cursor = dict(state.cursor or {})
    cursor["strava_import_all_time"] = bool(payload.import_all_time)
    state.cursor = cursor
    await db.commit()

    return StravaImportPreferencesOut(
        import_all_time=bool(cursor.get("strava_import_all_time")),
        default_window_days=max(30, int(os.getenv("STRAVA_DETAIL_BACKFILL_WINDOW_DAYS", "365"))),
        daily_request_limit=max(1, int(os.getenv("STRAVA_DAILY_REQUEST_LIMIT", "500"))),
    )


async def _startup_trigger_pending_syncs() -> None:
    """On startup, queue a Strava sync for any user whose initial sync never completed."""
    async with AsyncSessionLocal() as db:
        states = await db.execute(
            select(ProviderSyncState).where(
                ProviderSyncState.provider == "strava",
                ProviderSyncState.sync_status != "syncing",
            )
        )
        for state in states.scalars().all():
            cursor = state.cursor or {}
            if not cursor.get("initial_sync_done"):
                asyncio.create_task(_sync_provider_task("strava", state.user_id))
                logger.info("Startup: queued initial Strava sync for user_id=%s", state.user_id)


async def _sync_provider_task(provider: str, user_id: int):
    # Create a new session for the background task since the original one is closed
    async with AsyncSessionLocal() as db:
        try:
            state = await get_or_create_sync_state(db, user_id=user_id, provider=provider)
            state.sync_status = "syncing"
            state.sync_message = "Starting sync..."
            state.sync_progress = 0
            state.sync_total = 0  # Unknown initially
            state.last_error = None
            await db.commit()

            connector = get_connector(provider)
            connection = await get_connection(db, user_id=user_id, provider=provider)
            
            if not connection or connection.status != "connected":
                state.sync_status = "failed"
                state.sync_message = "Not connected"
                await db.commit()
                return

            access_token = decrypt_token(connection.encrypted_access_token)
            refresh_token = decrypt_token(connection.encrypted_refresh_token)

            now = datetime.utcnow()
            if connection.token_expires_at and connection.token_expires_at <= (now + timedelta(minutes=2)) and refresh_token:
                try:
                    refreshed = await connector.refresh_token(refresh_token)
                    access_token = refreshed.access_token
                    connection.encrypted_access_token = encrypt_token(refreshed.access_token)
                    if refreshed.refresh_token:
                        connection.encrypted_refresh_token = encrypt_token(refreshed.refresh_token)
                    connection.token_expires_at = refreshed.expires_at
                    connection.scopes = refreshed.scopes
                    await db.commit()
                except Exception as e:
                    state.sync_status = "failed"
                    state.sync_message = f"Token refresh failed: {str(e)}"
                    state.last_error = str(e)
                    await db.commit()
                    return

            sync_progress_step = max(1, int(os.getenv("INTEGRATION_SYNC_PROGRESS_STEP", "5")))
            ingest_commit_batch = max(1, int(os.getenv("INTEGRATION_SYNC_INGEST_COMMIT_BATCH", "20")))

            async def _is_cancel_requested() -> bool:
                latest_state = await db.scalar(select(ProviderSyncState).where(ProviderSyncState.id == state.id))
                if not latest_state:
                    return False
                latest_cursor = latest_state.cursor if isinstance(latest_state.cursor, dict) else {}
                if bool(latest_cursor.get("cancel_requested")):
                    state.cursor = dict(latest_cursor)
                    return True
                return False

            async def _finalize_cancelled(message: str, imported: int = 0, duplicates: int = 0) -> None:
                updated_cursor = dict(state.cursor or {})
                updated_cursor.pop("cancel_requested", None)
                updated_cursor.pop("strava_recent_only_once", None)
                state.cursor = updated_cursor
                state.sync_status = "completed"
                state.sync_message = message
                state.last_error = None
                await db.commit()
                await log_integration_audit(
                    db,
                    user_id=user_id,
                    provider=provider,
                    action="sync_cancelled",
                    status="ok",
                    message=f"Cancelled by user after imported={imported}, duplicates={duplicates}",
                )

            # Progress callback to update DB
            async def progress_callback(fetched_count: int):
                if fetched_count % sync_progress_step != 0:
                    if await _is_cancel_requested():
                        raise RuntimeError("SYNC_CANCELLED_BY_USER")
                    return
                await db.execute(
                    update(ProviderSyncState)
                    .where(ProviderSyncState.id == state.id)
                    .values(sync_progress=fetched_count, sync_message=f"Synced {fetched_count} activities...")
                )
                await db.commit()
                if await _is_cancel_requested():
                    raise RuntimeError("SYNC_CANCELLED_BY_USER")

            while True:
                if await _is_cancel_requested():
                    await _finalize_cancelled("Sync cancelled by user before processing started.")
                    return

                current_cursor = state.cursor or {}
                is_strava_initial_phase = provider == "strava" and not bool(current_cursor.get("initial_sync_done"))
                sync_request_cursor = dict(current_cursor)

                if provider == "strava":
                    if is_strava_initial_phase:
                        state.sync_message = "Starting sync... loading your last 3 months of activities."
                    else:
                        state.sync_message = "Starting sync..."
                else:
                    state.sync_message = "Starting sync..."
                state.sync_progress = 0
                state.sync_total = 0
                state.sync_status = "syncing"
                state.last_error = None
                await db.commit()

                if provider == "strava":
                    sync_result = await connector.fetch_activities(
                        access_token=access_token,
                        cursor=sync_request_cursor,
                        progress_callback=progress_callback,
                        should_cancel=_is_cancel_requested,
                    )
                else:
                    sync_result = await connector.fetch_activities(
                        access_token=access_token,
                        cursor=sync_request_cursor,
                        progress_callback=progress_callback,
                    )

                if await _is_cancel_requested():
                    await _finalize_cancelled("Sync cancelled by user.")
                    return

                # Ensure newest activities are always processed first (today, then yesterday, etc.).
                sync_result.activities.sort(key=lambda rec: rec.start_time, reverse=True)

                # Ingest activities
                imported = 0
                duplicates = 0
                total_items = len(sync_result.activities)
                state.sync_total = total_items
                await db.commit()

                strava_enrich_on_import = os.getenv("STRAVA_ENRICH_ON_IMPORT", "true").lower() in {"1", "true", "yes", "on"}
                strava_enrich_initial_only = os.getenv("STRAVA_ENRICH_INITIAL_ONLY", "true").lower() in {"1", "true", "yes", "on"}
                strava_enrich_max_activities = max(20, min(50, int(os.getenv("STRAVA_ENRICH_MAX_ACTIVITIES", "50"))))
                strava_enrich_delay_seconds = max(0.0, float(os.getenv("STRAVA_ENRICH_DELAY_SECONDS", "0.35")))
                strava_daily_request_limit = max(1, int(os.getenv("STRAVA_DAILY_REQUEST_LIMIT", "500")))
                today_key = datetime.utcnow().strftime("%Y-%m-%d")
                matched_dates: set = set()

                for index, record in enumerate(sync_result.activities):
                    if await _is_cancel_requested():
                        await _finalize_cancelled(
                            f"Sync cancelled by user. Imported {imported} new, {duplicates} duplicates.",
                            imported=imported,
                            duplicates=duplicates,
                        )
                        return

                    should_write_progress = ((index + 1) % sync_progress_step == 0) or (index + 1 == total_items)
                    if should_write_progress:
                        await db.execute(
                            update(ProviderSyncState)
                            .where(ProviderSyncState.id == state.id)
                            .values(sync_progress=index + 1, sync_total=total_items, sync_message=f"Saving activity {index+1}/{total_items}...")
                        )
                        await db.commit()

                    should_enrich_this_activity = (
                        provider == "strava"
                        and strava_enrich_on_import
                        and hasattr(connector, "fetch_activity_deep_data")
                        and index < strava_enrich_max_activities
                        and (
                            is_strava_initial_phase
                            or bool(sync_request_cursor.get("strava_recent_only"))
                            or not strava_enrich_initial_only
                        )
                    )

                    if should_enrich_this_activity:
                        cursor_snapshot = state.cursor or {}
                        request_day = str(cursor_snapshot.get("strava_request_day") or "")
                        request_used = int(cursor_snapshot.get("strava_request_count") or 0)
                        if request_day != today_key:
                            request_day = today_key
                            request_used = 0

                        # Deep detail fetch uses 3 Strava requests: activity detail, laps, streams.
                        estimated_cost = 3
                        if request_used + estimated_cost > strava_daily_request_limit:
                            strava_enrich_on_import = False
                            state.sync_message = (
                                f"Saving activity {index+1}/{total_items}... detail enrichment paused "
                                f"(daily Strava limit {strava_daily_request_limit} reached)."
                            )
                            await db.commit()
                            # Fall through to ingest the activity without enrichment
                        else:
                            payload = record.payload if isinstance(record.payload, dict) else {}
                            detail_payload = payload.get("detail") if isinstance(payload.get("detail"), dict) else None
                            has_local_detail = isinstance(detail_payload, dict) and (
                                isinstance(detail_payload.get("data"), list)
                                or isinstance(detail_payload.get("laps"), list)
                                or isinstance(detail_payload.get("stats"), dict)
                            )

                            if not has_local_detail:
                                try:
                                    async def _on_strava_request_debug(requests_last_10m: int):
                                        updated_cursor_dbg = dict(state.cursor or {})
                                        updated_cursor_dbg["strava_requests_last_10m"] = requests_last_10m
                                        state.cursor = updated_cursor_dbg

                                    fetched_detail = await connector.fetch_activity_deep_data(
                                        access_token=access_token,
                                        activity_id=record.provider_activity_id,
                                        start_time=record.start_time,
                                        request_debug_callback=_on_strava_request_debug,
                                    )
                                    payload = dict(payload)
                                    payload["detail"] = fetched_detail
                                    record.payload = payload

                                    updated_cursor = dict(state.cursor or {})
                                    updated_cursor["strava_request_day"] = request_day
                                    updated_cursor["strava_request_count"] = request_used + estimated_cost
                                    updated_cursor["strava_request_limit"] = strava_daily_request_limit
                                    state.cursor = updated_cursor
                                    request_used += estimated_cost
                                except Exception as enrich_error:
                                    # Keep sync resilient; activity summary still imports and can be enriched later.
                                    await log_integration_audit(
                                        db,
                                        user_id=user_id,
                                        provider=provider,
                                        action="activity_detail_enrich_failed",
                                        status="warning",
                                        message=f"Failed to enrich activity {record.provider_activity_id}: {enrich_error}",
                                    )

                                if strava_enrich_delay_seconds > 0:
                                    await db.commit()
                                    await db.reset()
                                    await asyncio.sleep(strava_enrich_delay_seconds)
                                    # Re-attach ORM objects after pool release
                                    state = await db.merge(state)
                                    connection = await db.merge(connection)

                    activity, created = await ingest_provider_activity(
                        db,
                        user_id=user_id,
                        provider=provider,
                        provider_activity_id=record.provider_activity_id,
                        name=record.name,
                        start_time=record.start_time,
                        duration_s=record.duration_s,
                        distance_m=record.distance_m,
                        sport=record.sport,
                        average_hr=record.average_hr,
                        average_watts=record.average_watts,
                        average_speed=record.average_speed,
                        payload=record.payload,
                        auto_commit=False,
                    )
                    if created:
                        imported += 1
                    else:
                        duplicates += 1
                    if (index + 1) % ingest_commit_batch == 0:
                        await db.commit()
                    matched_dates.add(record.start_time.date())
                    if provider == "strava":
                        payload_obj = record.payload if isinstance(record.payload, dict) else {}
                        summary = payload_obj.get("summary") if isinstance(payload_obj.get("summary"), dict) else {}
                        local_start_raw = summary.get("start_date_local")
                        if isinstance(local_start_raw, str):
                            local_start_text = local_start_raw.strip()
                            if local_start_text:
                                try:
                                    local_day = datetime.fromisoformat(local_start_text.replace("Z", "+00:00")).date()
                                    matched_dates.add(local_day)
                                except ValueError:
                                    try:
                                        matched_dates.add(dt_date.fromisoformat(local_start_text[:10]))
                                    except ValueError:
                                        pass

                await db.commit()

                # Recompute planned-vs-actual matching for all touched dates in this phase.
                if await _is_cancel_requested():
                    await _finalize_cancelled(
                        f"Sync cancelled by user. Imported {imported} new, {duplicates} duplicates.",
                        imported=imported,
                        duplicates=duplicates,
                    )
                    return

                for match_date in sorted(matched_dates):
                    await match_and_score(db, user_id, match_date)

                # Also refresh recent days so newly created plans for already-synced activities get matched.
                compliance_backfill_days = max(0, int(os.getenv("COMPLIANCE_MATCH_BACKFILL_DAYS", "2")))
                if compliance_backfill_days > 0:
                    base_day = datetime.utcnow().date()
                    for day_offset in range(0, compliance_backfill_days + 1):
                        await match_and_score(db, user_id, base_day - timedelta(days=day_offset))

                # Fetch wellness (simplified, no progress tracking for this part yet)
                wellness_payload = sync_result.wellness.__dict__
                try:
                    extra_wellness = await connector.fetch_wellness(access_token=access_token, cursor=current_cursor)
                    if extra_wellness:
                        for key in wellness_payload.keys():
                            wellness_payload[key] = (wellness_payload.get(key) or []) + (getattr(extra_wellness, key) or [])
                except Exception as e:
                    # Log but don't fail entire sync
                    print(f"Wellness sync failed: {e}")

                await _upsert_wellness(db, user_id=user_id, provider=provider, wellness_payload=wellness_payload)

                enriched_count = 0
                if provider == "strava" and hasattr(connector, "fetch_activity_deep_data"):
                    if await _is_cancel_requested():
                        await _finalize_cancelled(
                            f"Sync cancelled by user. Imported {imported} new, {duplicates} duplicates.",
                            imported=imported,
                            duplicates=duplicates,
                        )
                        return

                    cursor_snapshot = state.cursor or {}
                    import_all_time = bool(cursor_snapshot.get("strava_import_all_time"))
                    enriched_count, enriched_message = await _strava_backfill_activity_details(
                        db,
                        state=state,
                        connector=connector,
                        access_token=access_token,
                        user_id=user_id,
                        import_all_time=import_all_time,
                    )
                    if enriched_count > 0 and enriched_message:
                        state.sync_message = (
                            f"Saving activity {total_items}/{total_items}... {enriched_message}"
                            if total_items > 0
                            else enriched_message
                        )

                next_cursor = sync_result.next_cursor or {}
                next_cursor.pop("strava_recent_only", None)
                next_cursor.pop("strava_history_only", None)
                cursor_snapshot = state.cursor or {}
                cursor_request_day = cursor_snapshot.get("strava_request_day")
                next_request_day = next_cursor.get("strava_request_day")
                if not next_request_day and cursor_request_day:
                    next_cursor["strava_request_day"] = cursor_request_day

                if cursor_snapshot.get("strava_request_count") is not None:
                    next_cursor["strava_request_count"] = max(
                        int(next_cursor.get("strava_request_count") or 0),
                        int(cursor_snapshot.get("strava_request_count") or 0),
                    )
                if cursor_snapshot.get("strava_request_limit") is not None and next_cursor.get("strava_request_limit") is None:
                    next_cursor["strava_request_limit"] = cursor_snapshot.get("strava_request_limit")
                if cursor_snapshot.get("strava_requests_last_10m") is not None:
                    next_cursor["strava_requests_last_10m"] = max(
                        int(next_cursor.get("strava_requests_last_10m") or 0),
                        int(cursor_snapshot.get("strava_requests_last_10m") or 0),
                    )

                state.cursor = next_cursor
                state.cursor.pop("strava_recent_only_once", None)
                state.cursor.pop("strava_no_auto_history", None)
                state.last_success = datetime.utcnow()
                state.last_error = None
                connection.last_sync_at = datetime.utcnow()
                connection.last_error = None

                state.sync_status = "completed"
                state.sync_message = f"Completed. Imported {imported} new, {duplicates} duplicates."

                await db.commit()
                break

        except Exception as e:
            if str(e) == "SYNC_CANCELLED_BY_USER":
                await db.rollback()
                await _finalize_cancelled("Sync cancelled by user.")
                return

            await db.rollback()
            # New config session to save error state
            async with AsyncSessionLocal() as error_db:
                 state = await get_or_create_sync_state(error_db, user_id=user_id, provider=provider)
                 state.sync_status = "failed"
                 state.sync_message = str(e)
                 state.last_error = str(e)
                 await error_db.commit()
            print(f"Sync task failed: {e}")


@router.get("/{provider}/sync-status", response_model=SyncStatusOut)
async def get_sync_status(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    state = await get_or_create_sync_state(db, user_id=current_user.id, provider=provider)
    return SyncStatusOut(
        provider=provider,
        status=getattr(state, "sync_status", "idle"),
        progress=getattr(state, "sync_progress", 0),
        total=getattr(state, "sync_total", 0),
        message=getattr(state, "sync_message", ""),
        last_success=state.last_success,
        last_error=state.last_error
    )


@router.post("/{provider}/cancel-sync", response_model=SyncStatusOut)
async def cancel_sync(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    provider = _ensure_provider(provider)
    state = await get_or_create_sync_state(db, user_id=current_user.id, provider=provider)

    cursor = dict(state.cursor or {})
    cursor["cancel_requested"] = True
    state.cursor = cursor

    if getattr(state, "sync_status", "idle") == "syncing":
        state.sync_message = "Cancel requested. Stopping sync..."
    else:
        state.sync_status = "idle"
        state.sync_message = "No active sync to cancel."

    await db.commit()

    return SyncStatusOut(
        provider=provider,
        status=getattr(state, "sync_status", "idle"),
        progress=getattr(state, "sync_progress", 0),
        total=getattr(state, "sync_total", 0),
        message=getattr(state, "sync_message", ""),
        last_success=state.last_success,
        last_error=state.last_error,
    )


@router.post("/{provider}/sync-now", response_model=SyncStatusOut)
async def sync_provider_now(
    provider: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    payload: dict | None = Body(default=None),
):
    provider = _ensure_provider(provider)
    requested_mode = str((payload or {}).get("mode") or "").strip().lower()
    
    # Check if already syncing?
    state = await get_or_create_sync_state(db, user_id=current_user.id, provider=provider)
    connection = await get_connection(db, user_id=current_user.id, provider=provider)
    stale_sync_seconds = max(30, int(os.getenv("INTEGRATION_SYNC_STALE_SECONDS", "180")))
    if getattr(state, "sync_status", "idle") == "syncing":
        updated_at = getattr(state, "updated_at", None)
        is_stale = (
            updated_at is not None
            and (datetime.utcnow() - updated_at).total_seconds() > stale_sync_seconds
        )
        if not is_stale:
            return SyncStatusOut(
                provider=provider,
                status="syncing",
                progress=getattr(state, "sync_progress", 0),
                total=getattr(state, "sync_total", 0),
                message=getattr(state, "sync_message", "Sync already in progress"),
                last_success=state.last_success,
                last_error=state.last_error,
            )

        state.sync_status = "idle"
        state.sync_message = "Recovered from stale sync state; retrying now."
        state.last_error = None
        await db.commit()

    # Start background task
    if provider == "strava":
        cursor = dict(state.cursor or {})
        cursor.pop("cancel_requested", None)
        cursor.pop("strava_recent_only_once", None)
        cursor.pop("strava_no_auto_history", None)
        state.cursor = cursor
    else:
        cursor = dict(state.cursor or {})
        cursor.pop("cancel_requested", None)
        state.cursor = cursor

    background_tasks.add_task(_sync_provider_task, provider, current_user.id)
    
    # Update state to starting immediately so UI reflects it
    # But wait, the task starts after response. 
    # Better to set "starting" here.
    state.sync_status = "syncing"
    state.sync_message = "Queued..."
    state.sync_progress = 0
    state.last_error = None
    if connection:
        connection.last_error = None
    await db.commit()

    return SyncStatusOut(
        provider=provider,
        status="syncing",
        progress=0,
        total=0,
        message="Sync queued.",
        last_success=state.last_success,
        last_error=state.last_error
    )

# Legacy / simple synchronous version (commented out or removed)
# @router.post("/{provider}/sync-now-sync", response_model=ProviderSyncOut)
# ...



@router.post("/sync-poll-now")
async def sync_poll_all(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(ProviderConnection).where(
            ProviderConnection.user_id == current_user.id,
            ProviderConnection.status == "connected",
        )
    )
    providers = [row.provider for row in rows.scalars().all()]
    result = []
    for provider in providers:
        result.append(provider)
    return {"queued_providers": result, "note": "Use /integrations/{provider}/sync-now for deterministic per-provider sync"}


@router.get("/{provider}/webhook")
async def provider_webhook_challenge(provider: str, request: Request):
    provider = _ensure_provider(provider)
    if provider == "strava":
        connector = get_connector(provider)
        params = request.query_params
        verify_token = params.get("hub.verify_token")
        if verify_token != connector.webhook_verify_token():
            raise HTTPException(status_code=400, detail="Invalid Strava webhook verify token")
        if params.get("hub.mode") != "subscribe":
            raise HTTPException(status_code=400, detail="Invalid Strava webhook subscription mode")
        challenge = params.get("hub.challenge")
        if challenge:
            return {"hub.challenge": challenge}
    return {"status": "ok"}


@router.post("/{provider}/webhook")
async def provider_webhook(
    provider: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    provider = _ensure_provider(provider)
    payload = await request.json()
    headers = {k.lower(): v for k, v in request.headers.items()}
    event_key = build_event_key(provider, payload, headers)

    event = ProviderWebhookEvent(
        provider=provider,
        event_key=event_key,
        payload=payload,
        status="received",
    )
    db.add(event)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return {"status": "duplicate_ignored", "event_key": event_key}

    background_tasks.add_task(_process_provider_webhook_event, provider, event.id)
    return {"status": "accepted", "event_key": event_key}


@router.post("/{provider}/bridge/wellness")
async def bridge_wellness_ingest(
    provider: str,
    payload: list[BridgeWellnessIn],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    provider = _ensure_provider(provider)
    if provider not in {"google_fit", "apple_health"}:
        raise HTTPException(status_code=400, detail="Bridge wellness ingestion is only supported for google_fit and apple_health")

    normalized = {
        "hrv_daily": [],
        "rhr_daily": [],
        "sleep_sessions": [],
        "stress_daily": [],
    }
    for item in payload:
        if item.hrv_ms is not None:
            normalized["hrv_daily"].append(
                {"date": item.date, "hrv_ms": item.hrv_ms, "provider_record_id": item.provider_record_id}
            )
        if item.resting_hr is not None:
            normalized["rhr_daily"].append(
                {"date": item.date, "resting_hr": item.resting_hr, "provider_record_id": item.provider_record_id}
            )
        if item.stress_score is not None:
            normalized["stress_daily"].append(
                {"date": item.date, "stress_score": item.stress_score, "provider_record_id": item.provider_record_id}
            )

    counts = await _upsert_wellness(db, user_id=current_user.id, provider=provider, wellness_payload=normalized)
    await log_integration_audit(
        db,
        user_id=current_user.id,
        provider=provider,
        action="bridge_wellness_ingest",
        status="ok",
        message=f"{counts}",
    )
    return {"provider": provider, "updated": counts}


@router.post("/{provider}/bridge/sleep")
async def bridge_sleep_ingest(
    provider: str,
    payload: list[BridgeSleepIn],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    provider = _ensure_provider(provider)
    if provider not in {"google_fit", "apple_health"}:
        raise HTTPException(status_code=400, detail="Bridge sleep ingestion is only supported for google_fit and apple_health")

    normalized = {
        "hrv_daily": [],
        "rhr_daily": [],
        "sleep_sessions": [
            {
                "provider_record_id": item.provider_record_id,
                "start_time": item.start_time,
                "end_time": item.end_time,
                "duration_seconds": int((item.end_time - item.start_time).total_seconds()),
                "quality_score": item.quality_score,
            }
            for item in payload
        ],
        "stress_daily": [],
    }

    counts = await _upsert_wellness(db, user_id=current_user.id, provider=provider, wellness_payload=normalized)
    await log_integration_audit(
        db,
        user_id=current_user.id,
        provider=provider,
        action="bridge_sleep_ingest",
        status="ok",
        message=f"{counts}",
    )
    return {"provider": provider, "updated": counts}


@router.post("/wellness/manual")
async def log_manual_wellness(
    payload: ManualWellnessIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.hrv_ms is None and payload.resting_hr is None:
        raise HTTPException(status_code=400, detail="Provide at least one of hrv_ms or resting_hr")

    normalized = {
        "hrv_daily": [],
        "rhr_daily": [],
        "sleep_sessions": [],
        "stress_daily": [],
    }
    if payload.hrv_ms is not None:
        normalized["hrv_daily"].append({
            "date": payload.date,
            "hrv_ms": payload.hrv_ms,
            "provider_record_id": None,
        })
    if payload.resting_hr is not None:
        normalized["rhr_daily"].append({
            "date": payload.date,
            "resting_hr": payload.resting_hr,
            "provider_record_id": None,
        })

    counts = await _upsert_wellness(
        db,
        user_id=current_user.id,
        provider="manual",
        wellness_payload=normalized,
    )
    await log_integration_audit(
        db,
        user_id=current_user.id,
        provider="manual",
        action="manual_wellness_log",
        status="ok",
        message=f"{counts}",
    )
    return {"updated": counts}


@router.get("/wellness/summary", response_model=WellnessSummaryOut)
async def get_wellness_summary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    hrv = await db.scalar(
        select(HRVDaily)
        .where(HRVDaily.user_id == current_user.id)
        .order_by(HRVDaily.record_date.desc())
    )
    rhr = await db.scalar(
        select(RHRDaily)
        .where(RHRDaily.user_id == current_user.id)
        .order_by(RHRDaily.record_date.desc())
    )
    sleep = await db.scalar(
        select(SleepSession)
        .where(SleepSession.user_id == current_user.id)
        .order_by(SleepSession.end_time.desc())
    )
    stress = await db.scalar(
        select(StressDaily)
        .where(StressDaily.user_id == current_user.id)
        .order_by(StressDaily.record_date.desc())
    )

    return WellnessSummaryOut(
        hrv={
            "value": hrv.hrv_ms,
            "date": hrv.record_date,
            "provider": hrv.source_provider,
        }
        if hrv
        else None,
        resting_hr={
            "value": rhr.resting_hr,
            "date": rhr.record_date,
            "provider": rhr.source_provider,
        }
        if rhr
        else None,
        sleep={
            "duration_seconds": sleep.duration_seconds,
            "quality_score": sleep.quality_score,
            "end_time": sleep.end_time,
            "provider": sleep.source_provider,
        }
        if sleep
        else None,
        stress={
            "value": stress.stress_score,
            "date": stress.record_date,
            "provider": stress.source_provider,
        }
        if stress
        else None,
    )

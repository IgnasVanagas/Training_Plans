from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth import get_current_user
from ...database import get_db
from ...integrations.crypto import decrypt_token, encrypt_token
from ...integrations.registry import get_connector, list_provider_statuses
from ...integrations.service import (
    build_event_key,
    build_oauth_state,
    decode_oauth_state,
    get_connection,
    get_or_create_sync_state,
    log_integration_audit,
)
from ...models import (
    HRVDaily,
    ProviderConnection,
    ProviderSyncState,
    ProviderWebhookEvent,
    RHRDaily,
    SleepSession,
    StressDaily,
    User,
)
from ...schemas import (
    BridgeSleepIn,
    BridgeWellnessIn,
    ManualWellnessIn,
    ProviderConnectOut,
    ProviderStatusOut,
    ProviderSyncOut,
    StravaImportPreferencesIn,
    StravaImportPreferencesOut,
    SyncStatusOut,
    WellnessSummaryOut,
)
from .helpers import (
    _disconnect_provider_connection,
    _ensure_provider,
    _frontend_callback_url,
    _wants_json,
)
from .sync_tasks import _startup_trigger_pending_syncs, _sync_provider_task
from .webhook_handlers import _process_provider_webhook_event
from .wellness import _upsert_wellness

router = APIRouter(prefix="/integrations", tags=["integrations"])


# ---------------------------------------------------------------------------
# Provider listing & status
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# OAuth connect / callback / disconnect
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Strava import preferences
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Sync management
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Bridge & wellness routes
# ---------------------------------------------------------------------------

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

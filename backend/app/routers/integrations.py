from __future__ import annotations

from datetime import datetime, timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
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
    ProviderConnectOut,
    ProviderStatusOut,
    ProviderSyncOut,
    SyncStatusOut,
    WellnessSummaryOut,
)
from ..services.compliance import match_and_score
import os

router = APIRouter(prefix="/integrations", tags=["integrations"])


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

    connection = await get_connection(db, user_id=user_id, provider=provider)
    if not connection:
        connection = ProviderConnection(user_id=user_id, provider=provider)
        db.add(connection)

    connection.external_athlete_id = exchange.external_athlete_id
    connection.encrypted_access_token = encrypt_token(exchange.access_token)
    connection.encrypted_refresh_token = encrypt_token(exchange.refresh_token)
    connection.token_expires_at = exchange.expires_at
    connection.scopes = exchange.scopes
    connection.status = "connected"
    connection.last_error = None

    await db.commit()
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
    connection = await get_connection(db, user_id=current_user.id, provider=provider)
    if not connection:
        raise HTTPException(status_code=404, detail="Provider connection not found")

    connection.encrypted_access_token = None
    connection.encrypted_refresh_token = None
    connection.token_expires_at = None
    connection.status = "disconnected"
    connection.last_error = None

    await db.commit()
    await log_integration_audit(
        db,
        user_id=current_user.id,
        provider=provider,
        action="disconnect",
        status="ok",
        message="Disconnected by user",
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


async def _sync_provider_task(provider: str, user_id: int):
    # Create a new session for the background task since the original one is closed
    async with AsyncSessionLocal() as db:
        try:
            state = await get_or_create_sync_state(db, user_id=user_id, provider=provider)
            prior_cursor = state.cursor or {}
            is_strava_initial_phase = provider == "strava" and not bool(prior_cursor.get("initial_sync_done"))
            state.sync_status = "syncing"
            if provider == "strava":
                if is_strava_initial_phase:
                    state.sync_message = "Starting sync... loading your most recent activities first."
                else:
                    state.sync_message = "Starting sync... adding older history in the background."
            else:
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

            # Progress callback to update DB
            async def progress_callback(fetched_count: int):
                # Update progress in DB every time? Or batch?
                # Updating every request (10 items) is fine.
                suffix = ""
                if provider == "strava":
                    suffix = " Recent first; full history appears progressively."
                await db.execute(
                    update(ProviderSyncState)
                    .where(ProviderSyncState.id == state.id)
                    .values(sync_progress=fetched_count, sync_message=f"Synced {fetched_count} activities...{suffix}")
                )
                await db.commit()

            sync_result = await connector.fetch_activities(
                access_token=access_token, 
                cursor=state.cursor,
                progress_callback=progress_callback
            )

            # --- Existing logic for stream backfill ---
            if provider == "strava" and len(sync_result.activities) == 0:
                 # Check if we need to backfill streams (simplified logic for bg task)
                 pass 
            # ------------------------------------------

            # Ingest activities
            imported = 0
            duplicates = 0
            total_items = len(sync_result.activities)
            state.sync_total = total_items
            await db.commit()
            
            for index, record in enumerate(sync_result.activities):
                suffix = ""
                if provider == "strava":
                    suffix = " Recent first; full history appears progressively."
                await db.execute(
                    update(ProviderSyncState)
                    .where(ProviderSyncState.id == state.id)
                    .values(sync_progress=index + 1, sync_total=total_items, sync_message=f"Saving activity {index+1}/{total_items}...{suffix}")
                )
                await db.commit()
                
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
                )
                if created:
                    imported += 1
                else:
                    duplicates += 1
                
                # Match compliance immediately?
                # await match_and_score(db, user_id, record.start_time.date())

            # Fetch wellness (simplified, no progress tracking for this part yet)
            wellness_payload = sync_result.wellness.__dict__
            try:
                extra_wellness = await connector.fetch_wellness(access_token=access_token, cursor=state.cursor)
                if extra_wellness:
                    for key in wellness_payload.keys():
                        wellness_payload[key] = (wellness_payload.get(key) or []) + (getattr(extra_wellness, key) or [])
            except Exception as e:
                # Log but don't fail entire sync
                print(f"Wellness sync failed: {e}")

            counts = await _upsert_wellness(db, user_id=user_id, provider=provider, wellness_payload=wellness_payload)

            state.cursor = sync_result.next_cursor
            state.last_success = datetime.utcnow()
            state.last_error = None
            state.sync_status = "completed"
            if provider == "strava" and sync_result.next_cursor and sync_result.next_cursor.get("backfill_before_epoch"):
                state.sync_message = (
                    f"Completed this phase. Imported {imported} new, {duplicates} duplicates. "
                    "More historical activities will continue to appear over time as sync progresses."
                )
            else:
                state.sync_message = f"Completed. Imported {imported} new, {duplicates} duplicates."
            # Reset progress for next valid run, or leave it to show 100%? 
            # Leave it for now so UI sees it finished.
            
            # Update connection last_sync_at
            connection.last_sync_at = datetime.utcnow()
            connection.last_error = None
            
            await db.commit()

        except Exception as e:
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


@router.post("/{provider}/sync-now", response_model=SyncStatusOut)
async def sync_provider_now(
    provider: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    provider = _ensure_provider(provider)
    
    # Check if already syncing?
    state = await get_or_create_sync_state(db, user_id=current_user.id, provider=provider)
    connection = await get_connection(db, user_id=current_user.id, provider=provider)
    if getattr(state, "sync_status", "idle") == "syncing":
         # Maybe check updated_at to see if it's stale?
         # For now, allow trigger but warn or just return status
         pass

    # Start background task
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

    queued_message = "Sync queued"
    if provider == "strava":
        queued_message = "Sync queued. Your newest activities arrive first; full history follows over time."

    return SyncStatusOut(
        provider=provider,
        status="syncing",
        progress=0,
        total=0,
        message=queued_message,
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
        params = request.query_params
        challenge = params.get("hub.challenge")
        if challenge:
            return {"hub.challenge": challenge}
    return {"status": "ok"}


@router.post("/{provider}/webhook")
async def provider_webhook(provider: str, request: Request, db: AsyncSession = Depends(get_db)):
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

    connector = get_connector(provider)
    result = await connector.handle_webhook(payload, headers)

    event.status = "processed"
    event.processed_at = datetime.utcnow()
    await db.commit()
    return {"status": "processed", "event_key": event_key, "result": result}


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

from __future__ import annotations

import asyncio
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
    detail_batch = max(1, int(os.getenv("STRAVA_DETAIL_BACKFILL_BATCH_ACTIVITIES", "12")))
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
            detail_payload = await connector.fetch_activity_deep_data(
                access_token=access_token,
                activity_id=source_activity_id,
                start_time=activity.created_at,
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
            await asyncio.sleep(enrich_delay_seconds)

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

            strava_auto_backfill_enabled = os.getenv("STRAVA_AUTO_BACKFILL_CONTINUE", "true").lower() in {"1", "true", "yes", "on"}
            strava_auto_backfill_delay_seconds = max(0.0, float(os.getenv("STRAVA_AUTO_BACKFILL_DELAY_SECONDS", "8")))
            strava_auto_backfill_max_phases = max(0, int(os.getenv("STRAVA_AUTO_BACKFILL_MAX_PHASES", "0")))
            strava_phase_index = 0

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

            while True:
                current_cursor = state.cursor or {}
                is_strava_initial_phase = provider == "strava" and not bool(current_cursor.get("initial_sync_done"))

                if provider == "strava":
                    if is_strava_initial_phase:
                        state.sync_message = "Starting sync... loading your most recent activities first."
                    elif strava_phase_index > 0:
                        state.sync_message = f"Continuing sync phase {strava_phase_index + 1}... adding older history."
                    else:
                        state.sync_message = "Starting sync... adding older history in the background."
                else:
                    state.sync_message = "Starting sync..."
                state.sync_progress = 0
                state.sync_total = 0
                state.sync_status = "syncing"
                state.last_error = None
                await db.commit()

                sync_result = await connector.fetch_activities(
                    access_token=access_token,
                    cursor=current_cursor,
                    progress_callback=progress_callback,
                )

                # Ingest activities
                imported = 0
                duplicates = 0
                total_items = len(sync_result.activities)
                state.sync_total = total_items
                await db.commit()

                strava_enrich_on_import = os.getenv("STRAVA_ENRICH_ON_IMPORT", "true").lower() in {"1", "true", "yes", "on"}
                strava_enrich_initial_only = os.getenv("STRAVA_ENRICH_INITIAL_ONLY", "true").lower() in {"1", "true", "yes", "on"}
                strava_enrich_max_activities = max(1, min(50, int(os.getenv("STRAVA_ENRICH_MAX_ACTIVITIES", "50"))))
                strava_enrich_delay_seconds = max(0.0, float(os.getenv("STRAVA_ENRICH_DELAY_SECONDS", "0.35")))
                strava_daily_request_limit = max(1, int(os.getenv("STRAVA_DAILY_REQUEST_LIMIT", "500")))
                today_key = datetime.utcnow().strftime("%Y-%m-%d")

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

                    should_enrich_this_activity = (
                        provider == "strava"
                        and strava_enrich_on_import
                        and hasattr(connector, "fetch_activity_deep_data")
                        and index < strava_enrich_max_activities
                        and (is_strava_initial_phase or not strava_enrich_initial_only)
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
                            continue

                        payload = record.payload if isinstance(record.payload, dict) else {}
                        detail_payload = payload.get("detail") if isinstance(payload.get("detail"), dict) else None
                        has_local_detail = isinstance(detail_payload, dict) and (
                            isinstance(detail_payload.get("data"), list)
                            or isinstance(detail_payload.get("laps"), list)
                            or isinstance(detail_payload.get("stats"), dict)
                        )

                        if not has_local_detail:
                            try:
                                fetched_detail = await connector.fetch_activity_deep_data(
                                    access_token=access_token,
                                    activity_id=record.provider_activity_id,
                                    start_time=record.start_time,
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
                                    payload={"activity_id": record.provider_activity_id},
                                )

                            if strava_enrich_delay_seconds > 0:
                                await asyncio.sleep(strava_enrich_delay_seconds)

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
                    extra_wellness = await connector.fetch_wellness(access_token=access_token, cursor=current_cursor)
                    if extra_wellness:
                        for key in wellness_payload.keys():
                            wellness_payload[key] = (wellness_payload.get(key) or []) + (getattr(extra_wellness, key) or [])
                except Exception as e:
                    # Log but don't fail entire sync
                    print(f"Wellness sync failed: {e}")

                await _upsert_wellness(db, user_id=user_id, provider=provider, wellness_payload=wellness_payload)

                if provider == "strava" and hasattr(connector, "fetch_activity_deep_data"):
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
                cursor_snapshot = state.cursor or {}
                if cursor_snapshot.get("strava_request_day"):
                    next_cursor["strava_request_day"] = cursor_snapshot.get("strava_request_day")
                if cursor_snapshot.get("strava_request_count") is not None:
                    next_cursor["strava_request_count"] = cursor_snapshot.get("strava_request_count")
                if cursor_snapshot.get("strava_request_limit") is not None:
                    next_cursor["strava_request_limit"] = cursor_snapshot.get("strava_request_limit")

                has_backfill_remaining = bool(next_cursor.get("backfill_before_epoch")) and not bool(next_cursor.get("full_backfill_once_done"))
                can_continue_backfill = (
                    provider == "strava"
                    and strava_auto_backfill_enabled
                    and has_backfill_remaining
                    and (strava_auto_backfill_max_phases <= 0 or (strava_phase_index + 1) < strava_auto_backfill_max_phases)
                )

                state.cursor = next_cursor
                state.last_success = datetime.utcnow()
                state.last_error = None
                connection.last_sync_at = datetime.utcnow()
                connection.last_error = None

                if can_continue_backfill:
                    state.sync_status = "syncing"
                    state.sync_message = (
                        f"Completed phase {strava_phase_index + 1}. Imported {imported} new, {duplicates} duplicates. "
                        "Continuing historical backfill shortly..."
                    )
                    await db.commit()
                    strava_phase_index += 1
                    if strava_auto_backfill_delay_seconds > 0:
                        await asyncio.sleep(strava_auto_backfill_delay_seconds)
                    continue

                state.sync_status = "completed"
                if provider == "strava" and has_backfill_remaining and not strava_auto_backfill_enabled:
                    state.sync_message = (
                        f"Completed this phase. Imported {imported} new, {duplicates} duplicates. "
                        "More historical activities are available; trigger sync again to continue backfill."
                    )
                elif provider == "strava" and has_backfill_remaining and strava_auto_backfill_max_phases > 0:
                    state.sync_message = (
                        f"Completed this run. Imported {imported} new, {duplicates} duplicates. "
                        "More historical activities remain and will sync on the next run."
                    )
                else:
                    state.sync_message = f"Completed. Imported {imported} new, {duplicates} duplicates."

                await db.commit()
                break

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

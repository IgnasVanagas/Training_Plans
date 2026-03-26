from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta
from datetime import date as dt_date

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import AsyncSessionLocal
from ...integrations.crypto import decrypt_token, encrypt_token
from ...integrations.ingest import ingest_provider_activity
from ...integrations.registry import get_connector
from ...integrations.service import (
    get_connection,
    get_or_create_sync_state,
    log_integration_audit,
)
from ...models import Activity, ProviderSyncState
from ...services.compliance import match_and_score
from .helpers import _as_stream_payload, _has_strava_detail
from .wellness import _upsert_wellness

logger = logging.getLogger(__name__)


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

    # Only load lightweight columns for candidate selection to avoid pulling
    # hundreds of large JSONB streams blobs into Python memory.
    from sqlalchemy.orm import load_only
    candidate_query = (
        select(Activity)
        .options(load_only(Activity.id, Activity.athlete_id, Activity.created_at, Activity.file_type, Activity.streams))
        .where(
            Activity.athlete_id == user_id,
            Activity.file_type == "provider",
        )
    )
    if not import_all_time:
        candidate_query = candidate_query.where(Activity.created_at >= cutoff)
    candidate_query = candidate_query.order_by(Activity.created_at.desc()).limit(max(200, target_count * 12))
    res = await db.execute(candidate_query)

    # Build a list of candidate IDs (with source_activity_id), then discard the Activity rows.
    candidate_ids: list[tuple[int, str, datetime]] = []
    for activity in res.scalars():
        streams = _as_stream_payload(activity.streams)
        meta = streams.get("_meta") if isinstance(streams.get("_meta"), dict) else {}
        if str(meta.get("source_provider") or "") != "strava":
            continue
        src_id = meta.get("source_activity_id")
        if not src_id:
            continue
        if _has_strava_detail(streams):
            continue
        candidate_ids.append((activity.id, str(src_id), activity.created_at))
        if len(candidate_ids) >= target_count:
            break
    # Release all ORM-tracked Activity instances from session memory.
    await db.reset()
    state = await db.merge(state)

    enriched = 0
    for act_id, source_activity_id, act_created_at in candidate_ids:
        if request_used + 3 > daily_limit:
            break

        try:
            async def _on_strava_request_debug(requests_last_10m: int):
                cursor_dbg = dict(state.cursor or {})
                cursor_dbg["strava_requests_last_10m"] = requests_last_10m
                state.cursor = cursor_dbg

            detail_payload = await connector.fetch_activity_deep_data(
                access_token=access_token,
                activity_id=source_activity_id,
                start_time=act_created_at,
                request_debug_callback=_on_strava_request_debug,
            )
        except Exception:
            continue

        # Reload the specific activity row for update.
        activity = await db.get(Activity, act_id)
        if activity is None:
            continue

        streams = _as_stream_payload(activity.streams)
        meta = streams.get("_meta") if isinstance(streams.get("_meta"), dict) else {}

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

        # Commit each enriched activity individually and expire it from the
        # session so its large streams dict is eligible for garbage collection.
        await db.commit()
        db.expunge(activity)
        del detail_payload, streams, activity

        if enrich_delay_seconds > 0:
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

                    # Free the heavy detail/stream payload after ingestion so it
                    # doesn't accumulate in memory across the entire loop.
                    record.payload = None

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
                # Skip the heavy backfill phase on webhook-triggered recent-only
                # syncs to avoid OOM on small Render instances.  Backfill will
                # run on the next manual / scheduled full sync instead.
                is_webhook_recent_only = bool(sync_request_cursor.get("strava_recent_only"))
                if provider == "strava" and hasattr(connector, "fetch_activity_deep_data") and not is_webhook_recent_only:
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

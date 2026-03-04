from __future__ import annotations

import logging
import os
import asyncio
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from ..base import (
    OAuthExchangeResult,
    ProviderActivityRecord,
    ProviderConnector,
    ProviderWellnessPayload,
    SyncResult,
)


logger = logging.getLogger(__name__)

_STRAVA_REQUEST_WINDOW_SECONDS = 60.0
_STRAVA_REQUEST_WINDOW_15M_SECONDS = 900.0
_STRAVA_DEBUG_WINDOW_SECONDS = 600.0
_STRAVA_REQUEST_TIMESTAMPS: deque[float] = deque()
_STRAVA_REQUEST_LOCK = asyncio.Lock()


class StravaConnector(ProviderConnector):
    provider = "strava"
    display_name = "Strava"
    docs_url = "https://developers.strava.com/docs/"
    required_scopes = ["read", "activity:read_all"]

    def __init__(self) -> None:
        self.client_id = os.getenv("STRAVA_CLIENT_ID")
        self.client_secret = os.getenv("STRAVA_CLIENT_SECRET")
        self.redirect_uri = os.getenv("STRAVA_REDIRECT_URI", "http://localhost:8000/integrations/strava/callback")

    def is_enabled(self) -> bool:
        return os.getenv("ENABLE_STRAVA_INTEGRATION", "false").lower() in {"1", "true", "yes", "on"}

    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.redirect_uri)

    def authorize_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "approval_prompt": "force",
            "scope": os.getenv("STRAVA_SCOPES", "read,activity:read_all"),
            "state": state,
        }
        return f"https://www.strava.com/oauth/authorize?{urlencode(params)}"

    async def _exchange(self, payload: dict[str, Any]) -> OAuthExchangeResult:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post("https://www.strava.com/oauth/token", data=payload)
            response.raise_for_status()
            data = response.json()

        expires_at = None
        expires_at_epoch = data.get("expires_at")
        if expires_at_epoch:
            expires_at = datetime.fromtimestamp(expires_at_epoch, tz=timezone.utc).replace(tzinfo=None)

        scopes_raw = str(data.get("scope", ""))
        scopes = [scope.strip() for scope in scopes_raw.split(",") if scope.strip()]
        athlete = data.get("athlete") if isinstance(data.get("athlete"), dict) else {}

        return OAuthExchangeResult(
            access_token=data.get("access_token", ""),
            refresh_token=data.get("refresh_token"),
            expires_at=expires_at,
            scopes=scopes,
            external_athlete_id=str(athlete.get("id")) if athlete.get("id") else None,
            raw=data,
        )

    async def exchange_token(self, code: str) -> OAuthExchangeResult:
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
        }
        return await self._exchange(payload)

    async def refresh_token(self, refresh_token: str) -> OAuthExchangeResult:
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        return await self._exchange(payload)

    def _rolling_curve(self, values: list[float], windows: dict[str, int]) -> dict[str, float]:
        if not values:
            return {label: 0.0 for label in windows.keys()}

        prefix = [0.0]
        for val in values:
            prefix.append(prefix[-1] + float(val))

        out: dict[str, float] = {}
        n = len(values)
        for label, window in windows.items():
            if window <= 0 or n < window:
                out[label] = 0.0
                continue
            best = 0.0
            for idx in range(0, n - window + 1):
                total = prefix[idx + window] - prefix[idx]
                avg = total / window
                if avg > best:
                    best = avg
            out[label] = best
        return out

    def _hr_zones(self, hr_values: list[float], max_hr: float = 190.0) -> dict[str, int]:
        if not hr_values:
            return {f"Z{i}": 0 for i in range(1, 6)}

        zones = {f"Z{i}": 0 for i in range(1, 6)}
        for hr in hr_values:
            ratio = hr / max_hr if max_hr > 0 else 0
            if ratio < 0.6:
                zones["Z1"] += 1
            elif ratio < 0.7:
                zones["Z2"] += 1
            elif ratio < 0.8:
                zones["Z3"] += 1
            elif ratio < 0.9:
                zones["Z4"] += 1
            else:
                zones["Z5"] += 1
        return zones

    def _build_stream_points(self, start_time: datetime, stream_payload: dict[str, Any]) -> list[dict[str, Any]]:
        if start_time.tzinfo is None:
            start_time_utc = start_time.replace(tzinfo=timezone.utc)
        else:
            start_time_utc = start_time.astimezone(timezone.utc)

        stream_data: dict[str, list[Any]] = {}
        for key, value in stream_payload.items():
            if isinstance(value, dict) and isinstance(value.get("data"), list):
                stream_data[key] = value["data"]

        if not stream_data:
            return []

        length = max((len(arr) for arr in stream_data.values()), default=0)
        points: list[dict[str, Any]] = []

        for idx in range(length):
            point: dict[str, Any] = {}

            time_stream = stream_data.get("time")
            sec_offset = int(time_stream[idx]) if time_stream and idx < len(time_stream) and time_stream[idx] is not None else idx
            point["timestamp"] = (start_time_utc + timedelta(seconds=sec_offset)).isoformat().replace("+00:00", "Z")

            latlng = stream_data.get("latlng")
            if latlng and idx < len(latlng) and isinstance(latlng[idx], (list, tuple)) and len(latlng[idx]) == 2:
                point["lat"] = latlng[idx][0]
                point["lon"] = latlng[idx][1]

            distance = stream_data.get("distance")
            if distance and idx < len(distance):
                point["distance"] = distance[idx]

            speed = stream_data.get("velocity_smooth")
            if speed and idx < len(speed):
                point["speed"] = speed[idx]

            heartrate = stream_data.get("heartrate")
            if heartrate and idx < len(heartrate):
                point["heart_rate"] = heartrate[idx]

            watts = stream_data.get("watts")
            if watts and idx < len(watts):
                point["power"] = watts[idx]

            cadence = stream_data.get("cadence")
            if cadence and idx < len(cadence):
                point["cadence"] = cadence[idx]

            altitude = stream_data.get("altitude")
            if altitude and idx < len(altitude):
                point["altitude"] = altitude[idx]

            points.append(point)

        return points

    def _normalize_utc_iso(self, value: Any) -> str | None:
        if value is None:
            return None

        dt_value: datetime | None = None
        if isinstance(value, datetime):
            dt_value = value
        elif isinstance(value, str):
            raw = value.strip()
            if not raw:
                return None
            if raw.endswith("Z"):
                raw = f"{raw[:-1]}+00:00"
            try:
                dt_value = datetime.fromisoformat(raw)
            except ValueError:
                return None

        if dt_value is None:
            return None

        if dt_value.tzinfo is None:
            dt_value = dt_value.replace(tzinfo=timezone.utc)
        else:
            dt_value = dt_value.astimezone(timezone.utc)

        return dt_value.isoformat().replace("+00:00", "Z")

    def _normalize_laps(self, laps_payload: Any) -> list[dict[str, Any]]:
        if not isinstance(laps_payload, list):
            return []

        normalized: list[dict[str, Any]] = []
        for idx, lap in enumerate(laps_payload):
            if not isinstance(lap, dict):
                continue

            normalized.append(
                {
                    "split": idx + 1,
                    "start_time": self._normalize_utc_iso(lap.get("start_date") or lap.get("start_date_local")),
                    "duration": lap.get("elapsed_time") or lap.get("moving_time"),
                    "distance": lap.get("distance"),
                    "avg_speed": lap.get("average_speed"),
                    "avg_hr": lap.get("average_heartrate"),
                    "max_hr": lap.get("max_heartrate"),
                    "avg_power": lap.get("average_watts"),
                }
            )

        return [lap for lap in normalized if (lap.get("distance") or 0) > 0]

    async def _acquire_rate_limit_slot(self) -> int:
        configured_per_minute = int(os.getenv("STRAVA_MAX_REQUESTS_PER_MINUTE", "6"))
        configured_per_15m = int(os.getenv("STRAVA_MAX_REQUESTS_PER_15_MIN", "90"))
        per_15m_limit = max(1, configured_per_15m)
        per_minute_limit = max(1, min(configured_per_minute, per_15m_limit // 15 if per_15m_limit >= 15 else 1))

        while True:
            wait_seconds = 0.0
            async with _STRAVA_REQUEST_LOCK:
                now = time.monotonic()

                while _STRAVA_REQUEST_TIMESTAMPS and now - _STRAVA_REQUEST_TIMESTAMPS[0] > _STRAVA_DEBUG_WINDOW_SECONDS:
                    _STRAVA_REQUEST_TIMESTAMPS.popleft()

                requests_last_minute = sum(1 for ts in _STRAVA_REQUEST_TIMESTAMPS if now - ts < _STRAVA_REQUEST_WINDOW_SECONDS)
                requests_last_15m = sum(1 for ts in _STRAVA_REQUEST_TIMESTAMPS if now - ts < _STRAVA_REQUEST_WINDOW_15M_SECONDS)
                if requests_last_minute < per_minute_limit and requests_last_15m < per_15m_limit:
                    _STRAVA_REQUEST_TIMESTAMPS.append(now)
                    requests_last_10m = sum(1 for ts in _STRAVA_REQUEST_TIMESTAMPS if now - ts < _STRAVA_DEBUG_WINDOW_SECONDS)
                    return requests_last_10m

                oldest_in_minute = next((ts for ts in _STRAVA_REQUEST_TIMESTAMPS if now - ts < _STRAVA_REQUEST_WINDOW_SECONDS), now)
                wait_for_minute = _STRAVA_REQUEST_WINDOW_SECONDS - (now - oldest_in_minute)

                oldest_in_15m = next((ts for ts in _STRAVA_REQUEST_TIMESTAMPS if now - ts < _STRAVA_REQUEST_WINDOW_15M_SECONDS), now)
                wait_for_15m = _STRAVA_REQUEST_WINDOW_15M_SECONDS - (now - oldest_in_15m)

                wait_seconds = max(0.2, wait_for_minute if requests_last_minute >= per_minute_limit else 0.0, wait_for_15m if requests_last_15m >= per_15m_limit else 0.0)

            await asyncio.sleep(wait_seconds)

    async def _get_with_retry(
        self,
        client: httpx.AsyncClient,
        *,
        url: str,
        headers: dict[str, str],
        params: dict[str, Any] | None = None,
        context: str,
        max_retries: int = 3,
        request_debug_callback=None,
    ) -> httpx.Response:
        max_wait_seconds = max(1.0, float(os.getenv("STRAVA_429_MAX_WAIT_SECONDS", "15")))
        last_response: httpx.Response | None = None
        for attempt in range(1, max_retries + 1):
            requests_last_10m = await self._acquire_rate_limit_slot()
            if request_debug_callback:
                await request_debug_callback(requests_last_10m)
            response = await client.get(url, headers=headers, params=params)
            logger.info("Strava API request (%s) attempt=%s requests_last_10m=%s", context, attempt, requests_last_10m)
            if response.status_code != 429:
                return response

            last_response = response
            retry_after = response.headers.get("Retry-After")
            wait_seconds = max_wait_seconds
            if retry_after:
                try:
                    wait_seconds = max(1.0, min(float(retry_after), max_wait_seconds))
                except ValueError:
                    wait_seconds = max_wait_seconds

            logger.warning(
                "Strava rate limit hit (429) on %s (attempt %s/%s). Pausing for %.0fs...",
                context,
                attempt,
                max_retries,
                wait_seconds,
            )
            await asyncio.sleep(wait_seconds)

        if last_response is not None:
            return last_response
        raise RuntimeError(f"Failed Strava request for {context}")

    async def _fetch_activity_detail_payload(
        self,
        access_token: str,
        activity_id: str,
        start_time: datetime,
        request_debug_callback=None,
    ) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            detail_res = await self._get_with_retry(
                client,
                url=f"https://www.strava.com/api/v3/activities/{activity_id}",
                headers=headers,
                context=f"activity detail {activity_id}",
                request_debug_callback=request_debug_callback,
            )
            detail_res.raise_for_status()
            detail = detail_res.json() if isinstance(detail_res.json(), dict) else {}

            laps_res = await self._get_with_retry(
                client,
                url=f"https://www.strava.com/api/v3/activities/{activity_id}/laps",
                headers=headers,
                context=f"activity laps {activity_id}",
                request_debug_callback=request_debug_callback,
            )
            if laps_res.status_code == 404:
                laps_payload = []
            else:
                laps_res.raise_for_status()
                laps_payload = laps_res.json() if isinstance(laps_res.json(), list) else []

            streams_res = await self._get_with_retry(
                client,
                url=f"https://www.strava.com/api/v3/activities/{activity_id}/streams",
                params={
                    "keys": "time,latlng,distance,velocity_smooth,heartrate,watts,cadence,altitude",
                    "key_by_type": "true",
                },
                headers=headers,
                context=f"activity streams {activity_id}",
                request_debug_callback=request_debug_callback,
            )

            if streams_res.status_code == 404:
                streams_payload = {}
                logger.info("Strava streams unavailable for activity_id=%s; continuing with summary/detail only", activity_id)
            else:
                streams_res.raise_for_status()
                streams_payload = streams_res.json() if isinstance(streams_res.json(), dict) else {}

        points = self._build_stream_points(start_time, streams_payload)
        hr_values = [float(p.get("heart_rate")) for p in points if p.get("heart_rate") is not None]
        power_values = [float(p.get("power")) for p in points if p.get("power") is not None]

        power_curve_raw = self._rolling_curve(
            power_values,
            {
                "1s": 1,
                "5s": 5,
                "30s": 30,
                "1min": 60,
                "5min": 300,
                "10min": 600,
                "20min": 1200,
                "60min": 3600,
            },
        )
        power_curve = {k: int(v) for k, v in power_curve_raw.items()} if power_values else None

        pace_curve = self._rolling_curve(
            [float(p.get("speed")) for p in points if p.get("speed") is not None],
            {
                "1s": 1,
                "5s": 5,
                "30s": 30,
                "1min": 60,
                "5min": 300,
                "10min": 600,
                "20min": 1200,
                "60min": 3600,
            },
        )

        stats = {
            "max_hr": detail.get("max_heartrate") or (max(hr_values) if hr_values else None),
            "max_speed": detail.get("max_speed"),
            "max_watts": detail.get("max_watts") or (max(power_values) if power_values else None),
            "max_cadence": detail.get("max_cadence"),
            "avg_cadence": detail.get("average_cadence"),
            "total_elevation_gain": detail.get("total_elevation_gain"),
            "total_calories": detail.get("calories"),
        }

        laps = self._normalize_laps(laps_payload)

        return {
            "data": points,
            "power_curve": power_curve,
            "hr_zones": self._hr_zones(hr_values) if hr_values else None,
            "pace_curve": pace_curve if points else None,
            "laps": laps,
            "splits_metric": None,
            "stats": stats,
            "provider_activity_detail": detail,
        }

    async def fetch_activity_deep_data(
        self,
        *,
        access_token: str,
        activity_id: str,
        start_time: datetime,
        request_debug_callback=None,
    ) -> dict[str, Any]:
        return await self._fetch_activity_detail_payload(
            access_token,
            activity_id,
            start_time,
            request_debug_callback=request_debug_callback,
        )

    async def fetch_activities(self, *, access_token: str, cursor: dict[str, Any] | None, progress_callback=None, should_cancel=None) -> SyncResult:
        cursor = cursor or {}
        after_epoch = cursor.get("after_epoch")
        initial_sync_done = bool(cursor.get("initial_sync_done"))
        backfill_before_epoch = cursor.get("backfill_before_epoch")
        recent_only_mode = bool(cursor.get("strava_recent_only"))
        history_only_mode = bool(cursor.get("strava_history_only"))

        daily_request_limit = max(1, int(os.getenv("STRAVA_DAILY_REQUEST_LIMIT", "500")))
        today_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        request_day = str(cursor.get("strava_request_day") or "")
        request_used = int(cursor.get("strava_request_count") or 0)
        requests_last_10m_debug = int(cursor.get("strava_requests_last_10m") or 0)
        if request_day != today_key:
            request_day = today_key
            request_used = 0

        initial_sync_max_raw = int(os.getenv("STRAVA_INITIAL_SYNC_MAX_ACTIVITIES", "50"))
        initial_sync_max = max(20, min(50, initial_sync_max_raw))

        max_pages = int(os.getenv("STRAVA_SYNC_MAX_PAGES", "0"))
        full_history_enabled = os.getenv("STRAVA_FULL_HISTORY_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
        backfill_batch_activities = int(os.getenv("STRAVA_BACKFILL_BATCH_ACTIVITIES", "100"))
        backfill_batch_activities = max(20, backfill_batch_activities)
        backfill_request_delay_seconds = float(os.getenv("STRAVA_BACKFILL_REQUEST_DELAY_SECONDS", "2.0"))

        activities: list[ProviderActivityRecord] = []
        seen_ids: set[str] = set()

        async def collect_activity_summaries(
            client: httpx.AsyncClient,
            *,
            params: dict[str, Any],
            max_activities: int,
            request_delay_seconds: float = 0.0,
        ) -> None:
            nonlocal request_used, requests_last_10m_debug
            pages_fetched = 0
            max_429_retries = max(1, int(os.getenv("STRAVA_LIST_429_MAX_RETRIES", "2")))
            consecutive_429s = 0
            while len(activities) < max_activities:
                if should_cancel and await should_cancel():
                    logger.info("Strava sync cancellation requested. Stopping list pagination.")
                    break

                if request_used >= daily_request_limit:
                    logger.warning(
                        "Strava daily request limit reached (%s/%s). Stopping import for now.",
                        request_used,
                        daily_request_limit,
                    )
                    break

                if request_delay_seconds > 0:
                    await asyncio.sleep(request_delay_seconds)

                requests_last_10m_debug = await self._acquire_rate_limit_slot()

                response = await client.get(
                    "https://www.strava.com/api/v3/athlete/activities",
                    params=params,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                request_used += 1
                logger.info(
                    "Strava API request (list activities page=%s) requests_last_10m=%s",
                    params.get("page"),
                    requests_last_10m_debug,
                )
                if response.status_code == 429:
                    consecutive_429s += 1
                    retry_after = response.headers.get("Retry-After")
                    max_wait_seconds = max(1.0, float(os.getenv("STRAVA_429_MAX_WAIT_SECONDS", "15")))
                    wait_seconds = max_wait_seconds
                    if retry_after:
                        try:
                            wait_seconds = max(1.0, min(float(retry_after), max_wait_seconds))
                        except ValueError:
                            wait_seconds = max_wait_seconds

                    logger.warning(
                        "Strava rate limit hit (429) on list activities (attempt %s/%s). Pausing for %.0fs...",
                        consecutive_429s,
                        max_429_retries,
                        wait_seconds,
                    )
                    if consecutive_429s >= max_429_retries:
                        logger.warning("Stopping Strava list pagination for this run after repeated 429s.")
                        break
                    await asyncio.sleep(wait_seconds)
                    continue

                consecutive_429s = 0

                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list) or not payload:
                    break

                for item in payload:
                    if should_cancel and await should_cancel():
                        logger.info("Strava sync cancellation requested during page processing. Stopping.")
                        break

                    if len(activities) >= max_activities:
                        break
                    if not isinstance(item, dict):
                        continue

                    activity_id = str(item.get("id"))
                    if not activity_id or activity_id in seen_ids:
                        continue

                    start_iso = item.get("start_date") or item.get("start_date_local")
                    if not start_iso:
                        continue
                    start_time = datetime.fromisoformat(start_iso.replace("Z", "+00:00")).replace(tzinfo=None)

                    activities.append(
                        ProviderActivityRecord(
                            provider_activity_id=activity_id,
                            name=item.get("name") or f"Strava activity {item.get('id')}",
                            start_time=start_time,
                            duration_s=float(item.get("moving_time") or item.get("elapsed_time") or 0),
                            distance_m=float(item.get("distance") or 0),
                            sport=(item.get("sport_type") or item.get("type") or "other").lower(),
                            average_hr=float(item.get("average_heartrate")) if item.get("average_heartrate") is not None else None,
                            average_watts=float(item.get("average_watts")) if item.get("average_watts") is not None else None,
                            average_speed=float(item.get("average_speed")) if item.get("average_speed") is not None else None,
                            payload={"summary": item},
                        )
                    )
                    seen_ids.add(activity_id)

                    if progress_callback:
                        await progress_callback(len(activities))

                params["page"] += 1
                pages_fetched += 1
                if max_pages > 0 and pages_fetched >= max_pages:
                    break

                if should_cancel and await should_cancel():
                    logger.info("Strava sync cancellation requested after page. Stopping.")
                    break

        history_items_added = 0

        async with httpx.AsyncClient(timeout=30.0) as client:
            should_collect_recent = not history_only_mode
            should_collect_history = not recent_only_mode

            if should_cancel and await should_cancel():
                should_collect_recent = False
                should_collect_history = False

            if should_collect_recent and not initial_sync_done:
                await collect_activity_summaries(
                    client,
                    params={"per_page": min(initial_sync_max, 50), "page": 1},
                    max_activities=initial_sync_max,
                    request_delay_seconds=0.0,
                )
            elif should_collect_recent:
                incremental_max = int(os.getenv("STRAVA_SYNC_MAX_ACTIVITIES", "50"))
                incremental_max = max(20, min(50, incremental_max))
                incremental_overlap_seconds = max(0, int(os.getenv("STRAVA_INCREMENTAL_OVERLAP_SECONDS", "900")))
                # Always load newest pages first so today/yesterday never depend on cursor correctness,
                # but bound to records newer than our last sync cursor to avoid repeated duplicate scans.
                incremental_params: dict[str, Any] = {"per_page": min(incremental_max, 50), "page": 1}
                if after_epoch:
                    try:
                        incremental_after = max(0, int(after_epoch) - incremental_overlap_seconds)
                        incremental_params["after"] = incremental_after
                    except (TypeError, ValueError):
                        pass
                await collect_activity_summaries(
                    client,
                    params=incremental_params,
                    max_activities=incremental_max,
                    request_delay_seconds=0.0,
                )

            if should_collect_history and full_history_enabled and backfill_before_epoch:
                    history_count_before = len(activities)
                    await collect_activity_summaries(
                        client,
                        params={"per_page": 30, "page": 1, "before": int(backfill_before_epoch)},
                        max_activities=len(activities) + backfill_batch_activities,
                        request_delay_seconds=max(0.0, backfill_request_delay_seconds),
                    )
                    history_items_added = max(0, len(activities) - history_count_before)

        # Safety ordering: always process and save from newest -> oldest.
        activities.sort(key=lambda rec: rec.start_time, reverse=True)

        newest_start = max((record.start_time for record in activities), default=None)
        oldest_start = min((record.start_time for record in activities), default=None)

        next_cursor = dict(cursor)
        if newest_start is not None:
            next_cursor["after_epoch"] = int(newest_start.replace(tzinfo=timezone.utc).timestamp())
        if oldest_start is not None:
            oldest_epoch = int(oldest_start.replace(tzinfo=timezone.utc).timestamp())
            existing_backfill = next_cursor.get("backfill_before_epoch")
            if existing_backfill is not None:
                try:
                    next_cursor["backfill_before_epoch"] = min(int(existing_backfill), oldest_epoch)
                except (TypeError, ValueError):
                    next_cursor["backfill_before_epoch"] = oldest_epoch
            else:
                next_cursor["backfill_before_epoch"] = oldest_epoch
        if not initial_sync_done:
            next_cursor["initial_sync_done"] = True

        if should_collect_history and full_history_enabled and initial_sync_done and backfill_before_epoch and history_items_added == 0:
            next_cursor["full_backfill_once_done"] = True
            next_cursor.pop("backfill_before_epoch", None)

        next_cursor["strava_request_day"] = request_day
        next_cursor["strava_request_count"] = request_used
        next_cursor["strava_request_limit"] = daily_request_limit
        next_cursor["strava_requests_last_10m"] = requests_last_10m_debug
        next_cursor["strava_daily_limit_reached"] = request_used >= daily_request_limit

        return SyncResult(
            activities=activities,
            wellness=ProviderWellnessPayload(hrv_daily=[], rhr_daily=[], sleep_sessions=[], stress_daily=[]),
            next_cursor=next_cursor,
        )

    async def fetch_wellness(self, *, access_token: str, cursor: dict[str, Any] | None) -> ProviderWellnessPayload:
        return ProviderWellnessPayload(hrv_daily=[], rhr_daily=[], sleep_sessions=[], stress_daily=[])

    async def handle_webhook(self, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        return {
            "status": "accepted",
            "provider": "strava",
            "object_type": payload.get("object_type"),
            "owner_id": payload.get("owner_id"),
            "aspect_type": payload.get("aspect_type"),
        }

from __future__ import annotations

import logging
import os
import asyncio
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

    async def _get_with_retry(
        self,
        client: httpx.AsyncClient,
        *,
        url: str,
        headers: dict[str, str],
        params: dict[str, Any] | None = None,
        context: str,
        max_retries: int = 3,
    ) -> httpx.Response:
        last_response: httpx.Response | None = None
        for attempt in range(1, max_retries + 1):
            response = await client.get(url, headers=headers, params=params)
            if response.status_code != 429:
                return response

            last_response = response
            retry_after = response.headers.get("Retry-After")
            wait_seconds = 60.0
            if retry_after:
                try:
                    wait_seconds = max(1.0, float(retry_after))
                except ValueError:
                    wait_seconds = 60.0

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

    async def _fetch_activity_detail_payload(self, access_token: str, activity_id: str, start_time: datetime) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            detail_res = await self._get_with_retry(
                client,
                url=f"https://www.strava.com/api/v3/activities/{activity_id}",
                headers=headers,
                context=f"activity detail {activity_id}",
            )
            detail_res.raise_for_status()
            detail = detail_res.json() if isinstance(detail_res.json(), dict) else {}

            laps_res = await self._get_with_retry(
                client,
                url=f"https://www.strava.com/api/v3/activities/{activity_id}/laps",
                headers=headers,
                context=f"activity laps {activity_id}",
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

    async def fetch_activity_deep_data(self, *, access_token: str, activity_id: str, start_time: datetime) -> dict[str, Any]:
        return await self._fetch_activity_detail_payload(access_token, activity_id, start_time)

    async def fetch_activities(self, *, access_token: str, cursor: dict[str, Any] | None, progress_callback=None) -> SyncResult:
        cursor = cursor or {}
        after_epoch = cursor.get("after_epoch")
        initial_sync_done = bool(cursor.get("initial_sync_done"))
        backfill_before_epoch = cursor.get("backfill_before_epoch")

        daily_request_limit = max(1, int(os.getenv("STRAVA_DAILY_REQUEST_LIMIT", "500")))
        today_key = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        request_day = str(cursor.get("strava_request_day") or "")
        request_used = int(cursor.get("strava_request_count") or 0)
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
            nonlocal request_used
            pages_fetched = 0
            while len(activities) < max_activities:
                if request_used >= daily_request_limit:
                    logger.warning(
                        "Strava daily request limit reached (%s/%s). Stopping import for now.",
                        request_used,
                        daily_request_limit,
                    )
                    break

                if request_delay_seconds > 0:
                    await asyncio.sleep(request_delay_seconds)

                response = await client.get(
                    "https://www.strava.com/api/v3/athlete/activities",
                    params=params,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                request_used += 1
                if response.status_code == 429:
                    logger.warning("Strava rate limit hit (429) on list activities. Pausing for 60s...")
                    await asyncio.sleep(60)
                    continue

                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list) or not payload:
                    break

                for item in payload:
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

        async with httpx.AsyncClient(timeout=30.0) as client:
            if not initial_sync_done:
                await collect_activity_summaries(
                    client,
                    params={"per_page": min(initial_sync_max, 50), "page": 1},
                    max_activities=initial_sync_max,
                    request_delay_seconds=0.0,
                )
            else:
                incremental_max = int(os.getenv("STRAVA_SYNC_MAX_ACTIVITIES", "50"))
                incremental_max = max(1, incremental_max)
                incremental_params: dict[str, Any] = {"per_page": 30, "page": 1}
                if after_epoch:
                    incremental_params["after"] = after_epoch
                await collect_activity_summaries(
                    client,
                    params=incremental_params,
                    max_activities=incremental_max,
                    request_delay_seconds=0.0,
                )

                if full_history_enabled and backfill_before_epoch:
                    await collect_activity_summaries(
                        client,
                        params={"per_page": 30, "page": 1, "before": int(backfill_before_epoch)},
                        max_activities=len(activities) + backfill_batch_activities,
                        request_delay_seconds=max(0.0, backfill_request_delay_seconds),
                    )

        newest_start = max((record.start_time for record in activities), default=None)
        oldest_start = min((record.start_time for record in activities), default=None)

        next_cursor = dict(cursor)
        if newest_start is not None:
            next_cursor["after_epoch"] = int(newest_start.replace(tzinfo=timezone.utc).timestamp())
        if oldest_start is not None:
            next_cursor["backfill_before_epoch"] = int(oldest_start.replace(tzinfo=timezone.utc).timestamp())
        if not initial_sync_done:
            next_cursor["initial_sync_done"] = True

        if full_history_enabled and initial_sync_done and backfill_before_epoch and len(activities) == 0:
            next_cursor["full_backfill_once_done"] = True
            next_cursor.pop("backfill_before_epoch", None)

        next_cursor["strava_request_day"] = request_day
        next_cursor["strava_request_count"] = request_used
        next_cursor["strava_request_limit"] = daily_request_limit

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

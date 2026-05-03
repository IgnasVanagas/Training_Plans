from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import IntegrityError

from app.models import Activity, HRVDaily, ProviderConnection, ProviderWebhookEvent, RHRDaily, RoleEnum, SleepSession, StressDaily, User
from app.routers import integrations as integrations_router
from app.routers.integrations import helpers as integration_helpers
from app.routers.integrations import webhook_handlers as integrations_webhooks
from app.routers.integrations import wellness as integrations_wellness
from app.schemas import BridgeSleepIn, BridgeWellnessIn, ManualWellnessIn, StravaImportPreferencesIn


class _ScalarListResult:
    def __init__(self, values):
        self._values = list(values)

    def scalars(self):
        return self

    def all(self):
        return list(self._values)


class _QueueDB:
    def __init__(self, *, execute_results=None, scalar_results=None, commit_side_effect=None):
        self.execute_results = list(execute_results or [])
        self.scalar_results = list(scalar_results or [])
        self.commit_side_effect = commit_side_effect
        self.added = []
        self.commits = 0
        self.rollbacks = 0
        self._next_id = 500

    async def execute(self, stmt):
        if not self.execute_results:
            return _ScalarListResult([])
        return self.execute_results.pop(0)

    async def scalar(self, stmt):
        if not self.scalar_results:
            return None
        return self.scalar_results.pop(0)

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = self._next_id
            self._next_id += 1
        self.added.append(obj)

    async def commit(self):
        self.commits += 1
        if self.commit_side_effect is not None:
            raise self.commit_side_effect

    async def rollback(self):
        self.rollbacks += 1


class _AsyncSessionContext:
    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, exc_type, exc, tb):
        return None


class _JSONRequest:
    def __init__(self, payload, *, headers=None):
        self._payload = payload
        self.headers = headers or {}

    async def json(self):
        return self._payload


class _FakeConnector:
    def __init__(
        self,
        *,
        enabled=True,
        configured=True,
        approval_required=False,
        bridge_only=False,
        missing_scopes=None,
        webhook_configured=False,
    ):
        self.display_name = "Fake Provider"
        self.required_scopes = ["read", "activity:read", "activity:read_all"]
        self.docs_url = "https://docs.example.com/provider"
        self.approval_required = approval_required
        self.bridge_only = bridge_only
        self._enabled = enabled
        self._configured = configured
        self._missing_scopes = list(missing_scopes or [])
        self._webhook_configured = webhook_configured
        self.deauthorized = []

    def is_enabled(self):
        return self._enabled

    def is_configured(self):
        return self._configured

    def authorize_url(self, state):
        return f"https://auth.example.com/{state}"

    async def exchange_token(self, code):
        return SimpleNamespace(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_at=datetime(2026, 3, 10, 10, 0, 0, tzinfo=timezone.utc),
            scopes=["read", "activity:read", "activity:read_all"],
            external_athlete_id="12345",
        )

    def _parse_scopes(self, scope):
        return [value for value in str(scope).split(",") if value]

    def missing_required_scopes(self, granted_scopes):
        return list(self._missing_scopes)

    async def deauthorize(self, token):
        self.deauthorized.append(token)

    def is_webhook_configured(self):
        return self._webhook_configured

    async def ensure_webhook_subscription(self):
        return {"id": 99}

    def webhook_verify_token(self):
        return "verify-me"


def _current_user(user_id=9):
    return User(id=user_id, email=f"user{user_id}@example.com", password_hash="x", role=RoleEnum.athlete, email_verified=True)


def test_integrations_helper_utilities_cover_payload_detection_callback_urls_and_provider_checks(monkeypatch):
    assert integration_helpers._as_stream_payload({"a": 1}) == {"a": 1}
    assert integration_helpers._as_stream_payload([]) == {}
    assert integration_helpers._has_strava_detail({"detail": {"data": [{}]}}) is True
    assert integration_helpers._has_strava_detail({"data": [{}]}) is True
    assert integration_helpers._has_strava_detail({"detail": {}}) is False
    assert integration_helpers._wants_json(SimpleNamespace(headers={"accept": "text/html, application/json"})) is True

    monkeypatch.setenv("FRONTEND_BASE_URL", "https://frontend.example.com/")
    monkeypatch.setenv("INTEGRATIONS_CALLBACK_PATH", "/integrations/result")
    assert integration_helpers._frontend_callback_url(provider="strava", status="failed", message="missing") == (
        "https://frontend.example.com/integrations/result?integration_provider=strava&integration_status=failed&integration_message=missing"
    )

    assert integration_helpers._ensure_provider("Strava") == "strava"
    with pytest.raises(HTTPException) as exc_info:
        integration_helpers._ensure_provider("unsupported")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_purge_disconnect_and_wellness_upsert_helpers_cover_insert_and_update_paths(monkeypatch):
    strava_activity = Activity(
        id=1,
        athlete_id=9,
        filename="strava.fit",
        file_path="uploads/strava.fit",
        file_type="provider",
        sport="running",
        streams={"_meta": {"source_provider": "strava"}},
    )
    polar_activity = Activity(
        id=2,
        athlete_id=9,
        filename="polar.fit",
        file_path="uploads/polar.fit",
        file_type="provider",
        sport="running",
        streams={"_meta": {"source_provider": "polar"}},
    )
    purge_db = _QueueDB(execute_results=[_ScalarListResult([strava_activity, polar_activity])])

    purged = await integration_helpers._purge_provider_activities(purge_db, user_id=9, provider="strava")

    assert purged == 1
    assert strava_activity.is_deleted is True
    assert polar_activity.is_deleted in {None, False}
    assert purge_db.commits == 1

    audit_calls = []

    async def fake_audit(*args, **kwargs):
        audit_calls.append(kwargs)

    async def fake_purge(db, *, user_id, provider):
        return 3

    monkeypatch.setattr(integration_helpers, "log_integration_audit", fake_audit)
    monkeypatch.setattr(integration_helpers, "_purge_provider_activities", fake_purge)

    connection = ProviderConnection(
        user_id=9,
        provider="strava",
        encrypted_access_token="enc-access",
        encrypted_refresh_token="enc-refresh",
        status="connected",
    )
    disconnect_db = _QueueDB()
    await integration_helpers._disconnect_provider_connection(
        disconnect_db,
        connection=connection,
        reason="Disconnected by user",
        last_error="remote failure",
    )

    assert connection.encrypted_access_token is None
    assert connection.encrypted_refresh_token is None
    assert connection.status == "disconnected"
    assert audit_calls[0]["status"] == "warning"
    assert "Purged 3 activities" in audit_calls[0]["message"]

    existing_rhr = RHRDaily(user_id=9, source_provider="manual", record_date=date(2026, 3, 10), resting_hr=50)
    existing_stress = StressDaily(user_id=9, source_provider="manual", record_date=date(2026, 3, 10), stress_score=10)
    wellness_db = _QueueDB(scalar_results=[None, existing_rhr, None, existing_stress])

    counts = await integrations_wellness._upsert_wellness(
        wellness_db,
        user_id=9,
        provider="manual",
        wellness_payload={
            "hrv_daily": [{"date": date(2026, 3, 10), "hrv_ms": 52, "provider_record_id": "h1"}],
            "rhr_daily": [{"date": date(2026, 3, 10), "resting_hr": 48, "provider_record_id": "r1"}],
            "sleep_sessions": [{
                "provider_record_id": "s1",
                "start_time": datetime(2026, 3, 9, 22, 0, tzinfo=timezone.utc),
                "end_time": datetime(2026, 3, 10, 6, 0, tzinfo=timezone.utc),
                "duration_seconds": 28800,
                "quality_score": 88,
            }],
            "stress_daily": [{"date": date(2026, 3, 10), "stress_score": 21, "provider_record_id": "st1"}],
        },
    )

    assert counts == {"hrv_daily": 1, "rhr_daily": 1, "sleep_sessions": 1, "stress_daily": 1}
    assert len(wellness_db.added) == 2
    assert existing_rhr.resting_hr == pytest.approx(48.0)
    assert existing_stress.stress_score == pytest.approx(21.0)
    assert wellness_db.commits == 1


@pytest.mark.asyncio
async def test_webhook_handlers_cover_strava_branches_and_provider_event_processing(monkeypatch):
    connection = ProviderConnection(user_id=9, provider="strava", external_athlete_id="owner-1")
    disconnect_calls = []
    queue_calls = []

    async def fake_disconnect(db, *, connection, reason, last_error=None):
        disconnect_calls.append((connection.user_id, reason, last_error))

    async def fake_mark_deleted(db, *, user_id, provider_activity_id):
        return 2

    async def fake_queue(db, *, user_id, reason):
        queue_calls.append((user_id, reason))
        return "sync_queued"

    monkeypatch.setattr(integrations_webhooks, "_disconnect_provider_connection", fake_disconnect)
    monkeypatch.setattr(integrations_webhooks, "_mark_strava_activity_deleted", fake_mark_deleted)
    monkeypatch.setattr(integrations_webhooks, "_queue_strava_recent_sync_from_webhook", fake_queue)

    assert await integrations_webhooks._process_strava_webhook_event(_QueueDB(), {}) == {
        "status": "ignored",
        "reason": "missing_owner_id",
    }

    async def no_connection(db, owner_id):
        return None

    monkeypatch.setattr(integrations_webhooks, "_find_strava_connection_by_owner_id", no_connection)
    ignored = await integrations_webhooks._process_strava_webhook_event(_QueueDB(), {"owner_id": "owner-1"})
    assert ignored == {"status": "ignored", "reason": "owner_not_connected", "owner_id": "owner-1"}

    async def find_connection(db, owner_id):
        return connection

    monkeypatch.setattr(integrations_webhooks, "_find_strava_connection_by_owner_id", find_connection)
    deauthorized = await integrations_webhooks._process_strava_webhook_event(
        _QueueDB(),
        {"owner_id": "owner-1", "object_type": "athlete", "updates": {"authorized": "false"}},
    )
    deleted = await integrations_webhooks._process_strava_webhook_event(
        _QueueDB(),
        {"owner_id": "owner-1", "object_type": "activity", "object_id": "77", "aspect_type": "delete"},
    )
    synced = await integrations_webhooks._process_strava_webhook_event(
        _QueueDB(),
        {"owner_id": "owner-1", "object_type": "activity", "object_id": "88", "aspect_type": "create"},
    )

    assert deauthorized == {"status": "deauthorized", "user_id": 9}
    assert disconnect_calls[0][0] == 9
    assert deleted == {"status": "activity_deleted", "deleted_count": 2, "user_id": 9}
    assert synced["status"] == "sync_queued"
    assert queue_calls[0][0] == 9

    processed_event = ProviderWebhookEvent(id=41, provider="strava", payload={"owner_id": "owner-1"}, status="received")
    failed_event = ProviderWebhookEvent(id=42, provider="strava", payload={"owner_id": "owner-1"}, status="received")
    audit_calls = []

    async def fake_log_audit(*args, **kwargs):
        audit_calls.append(kwargs)

    async def fake_process_strava(db, payload):
        return {"status": "ok"}

    monkeypatch.setattr(integrations_webhooks, "AsyncSessionLocal", lambda: _AsyncSessionContext(_QueueDB(scalar_results=[processed_event, connection])))
    monkeypatch.setattr(integrations_webhooks, "_process_strava_webhook_event", fake_process_strava)
    monkeypatch.setattr(integrations_webhooks, "log_integration_audit", fake_log_audit)
    monkeypatch.setattr(integrations_webhooks, "_find_strava_connection_by_owner_id", find_connection)

    await integrations_webhooks._process_provider_webhook_event("strava", 41)

    assert processed_event.status == "processed"
    assert processed_event.last_error is None
    assert audit_calls[0]["action"] == "webhook_processed"

    async def raise_processing(db, payload):
        raise RuntimeError("boom")

    monkeypatch.setattr(integrations_webhooks, "AsyncSessionLocal", lambda: _AsyncSessionContext(_QueueDB(scalar_results=[failed_event])))
    monkeypatch.setattr(integrations_webhooks, "_process_strava_webhook_event", raise_processing)

    await integrations_webhooks._process_provider_webhook_event("strava", 42)

    assert failed_event.status == "failed"
    assert failed_event.last_error == "boom"


@pytest.mark.asyncio
async def test_provider_listing_status_and_connect_routes_cover_major_branches(monkeypatch):
    current_user = _current_user()
    connection = ProviderConnection(user_id=current_user.id, provider="strava", status="connected", last_error="warn")
    connection.last_sync_at = datetime(2026, 3, 10, 8, 0, 0, tzinfo=timezone.utc)
    sync_state = SimpleNamespace(cursor={"initial_sync_done": True})
    db = _QueueDB(scalar_results=[sync_state])

    monkeypatch.setattr(
        integrations_router,
        "list_provider_statuses",
        lambda: [
            {
                "provider": "strava",
                "display_name": "Strava",
                "enabled": True,
                "configured": True,
                "approval_required": False,
                "bridge_only": False,
                "required_scopes": ["read"],
                "docs_url": None,
            },
            {
                "provider": "polar",
                "display_name": "Polar",
                "enabled": True,
                "configured": True,
                "approval_required": False,
                "bridge_only": False,
                "required_scopes": [],
                "docs_url": None,
            },
        ],
    )

    async def fake_get_connection(db, *, user_id, provider):
        return connection if provider == "strava" else None

    monkeypatch.setattr(integrations_router, "get_connection", fake_get_connection)
    listed = await integrations_router.list_providers(current_user=current_user, db=db)
    assert listed[0].connection_status == "connected"
    assert listed[0].history_imported is True
    assert listed[1].connection_status == "disconnected"

    connector = _FakeConnector()
    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: connector)

    async def no_status_connection(*args, **kwargs):
        return None

    monkeypatch.setattr(integrations_router, "get_connection", no_status_connection)
    status = await integrations_router.provider_status("strava", current_user=current_user, db=_QueueDB())
    assert status["provider"] == "strava"
    assert status["connection_status"] == "disconnected"

    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: _FakeConnector(approval_required=True))
    assert (await integrations_router.connect_provider("strava", current_user=current_user)).status == "pending_partner_approval"

    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: _FakeConnector(bridge_only=True))
    assert (await integrations_router.connect_provider("strava", current_user=current_user)).status == "bridge_ingestion"

    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: _FakeConnector(enabled=False))
    with pytest.raises(HTTPException) as disabled_exc:
        await integrations_router.connect_provider("strava", current_user=current_user)
    assert disabled_exc.value.status_code == 400

    monkeypatch.delenv("STRAVA_CLIENT_ID", raising=False)
    monkeypatch.delenv("STRAVA_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("STRAVA_REDIRECT_URI", raising=False)
    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: _FakeConnector(configured=False))
    with pytest.raises(HTTPException) as configured_exc:
        await integrations_router.connect_provider("strava", current_user=current_user)
    assert "STRAVA_CLIENT_ID" in configured_exc.value.detail

    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: connector)
    monkeypatch.setattr(integrations_router, "build_oauth_state", lambda user_id, provider: f"state-{user_id}-{provider}")
    ready = await integrations_router.connect_provider("strava", current_user=current_user)
    assert ready.authorize_url == "https://auth.example.com/state-9-strava"
    assert ready.status == "ready"


@pytest.mark.asyncio
async def test_callback_disconnect_preferences_sync_and_poll_routes(monkeypatch):
    current_user = _current_user()
    connector = _FakeConnector()
    callback_db = _QueueDB()
    audit_calls = []

    async def fake_audit(*args, **kwargs):
        audit_calls.append(kwargs)

    async def no_connection(db, *, user_id, provider):
        return None

    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: connector)
    monkeypatch.setattr(integrations_router, "decode_oauth_state", lambda state: {"provider": "strava", "sub": str(current_user.id)})
    monkeypatch.setattr(integrations_router, "get_connection", no_connection)
    monkeypatch.setattr(integrations_router, "encrypt_token", lambda token: f"enc:{token}")
    monkeypatch.setattr(integrations_router, "log_integration_audit", fake_audit)

    connected = await integrations_router.provider_callback(
        request=SimpleNamespace(headers={"accept": "application/json"}),
        provider="strava",
        code="oauth-code",
        state="state-token",
        scope="read,activity:read,activity:read_all",
        db=callback_db,
    )

    saved_connection = next(obj for obj in callback_db.added if isinstance(obj, ProviderConnection))
    assert connected == {"provider": "strava", "status": "connected"}
    assert saved_connection.status == "connected"
    assert saved_connection.encrypted_access_token == "enc:access-token"
    assert audit_calls[-1]["action"] == "connect"

    missing_scope_connector = _FakeConnector(missing_scopes=["activity:read"])
    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: missing_scope_connector)
    redirect = await integrations_router.provider_callback(
        request=SimpleNamespace(headers={"accept": "text/html"}),
        provider="strava",
        code="oauth-code",
        state="state-token",
        scope="read,activity:read_all",
        db=_QueueDB(),
    )
    assert redirect.headers["location"].endswith("integration_message=missing_scopes%3Aactivity%3Aread")
    assert missing_scope_connector.deauthorized == ["access-token"]

    disconnect_calls = []
    disconnect_connection = ProviderConnection(user_id=current_user.id, provider="strava", encrypted_access_token="enc-token", status="connected")

    async def existing_connection(db, *, user_id, provider):
        return disconnect_connection

    async def fake_disconnect_provider_connection(db, *, connection, reason, last_error=None):
        disconnect_calls.append((connection.user_id, reason, last_error))

    async def raising_deauthorize(token):
        raise RuntimeError("remote down")

    connector.deauthorize = raising_deauthorize
    monkeypatch.setattr(integrations_router, "get_connector", lambda provider: connector)
    monkeypatch.setattr(integrations_router, "get_connection", existing_connection)
    monkeypatch.setattr(integrations_router, "decrypt_token", lambda token: "live-access-token")
    monkeypatch.setattr(integrations_router, "_disconnect_provider_connection", fake_disconnect_provider_connection)

    disconnected = await integrations_router.disconnect_provider("strava", current_user=current_user, db=_QueueDB())
    assert disconnected == {"provider": "strava", "status": "disconnected"}
    assert "deauthorization failed remotely" in disconnect_calls[0][2]

    pref_state = SimpleNamespace(cursor={}, last_success=None, last_error=None)

    async def get_sync_state(db, *, user_id, provider):
        return pref_state

    monkeypatch.setattr(integrations_router, "get_or_create_sync_state", get_sync_state)
    monkeypatch.setenv("STRAVA_DETAIL_BACKFILL_WINDOW_DAYS", "180")
    monkeypatch.setenv("STRAVA_DAILY_REQUEST_LIMIT", "250")

    prefs = await integrations_router.get_strava_import_preferences(current_user=current_user, db=_QueueDB())
    saved_prefs = await integrations_router.set_strava_import_preferences(
        payload=StravaImportPreferencesIn(import_all_time=True),
        current_user=current_user,
        db=_QueueDB(),
    )
    assert prefs.default_window_days == 180
    assert saved_prefs.import_all_time is True
    assert pref_state.cursor["strava_import_all_time"] is True

    syncing_state = SimpleNamespace(
        sync_status="syncing",
        sync_progress=4,
        sync_total=10,
        sync_message="Working",
        last_success=None,
        last_error=None,
        cursor={},
        updated_at=datetime.utcnow(),
    )

    async def get_syncing_state(db, *, user_id, provider):
        return syncing_state

    monkeypatch.setattr(integrations_router, "get_or_create_sync_state", get_syncing_state)
    status = await integrations_router.get_sync_status("strava", current_user=current_user, db=_QueueDB())
    canceled = await integrations_router.cancel_sync("strava", current_user=current_user, db=_QueueDB())

    already_running_state = SimpleNamespace(
        sync_status="syncing",
        sync_progress=4,
        sync_total=10,
        sync_message="Working",
        last_success=None,
        last_error=None,
        cursor={},
        updated_at=datetime.utcnow(),
    )

    async def get_already_running_state(db, *, user_id, provider):
        return already_running_state

    monkeypatch.setattr(integrations_router, "get_or_create_sync_state", get_already_running_state)
    already_running = await integrations_router.sync_provider_now(
        "strava",
        background_tasks=BackgroundTasks(),
        current_user=current_user,
        db=_QueueDB(),
        payload=None,
    )
    assert status.progress == 4
    assert canceled.message == "Cancel requested. Stopping sync..."
    assert already_running.message == "Working"

    stale_state = SimpleNamespace(
        sync_status="syncing",
        sync_progress=0,
        sync_total=0,
        sync_message="Stale",
        last_success=None,
        last_error="old",
        cursor={"cancel_requested": True, "strava_no_auto_history": True},
        updated_at=datetime.utcnow() - timedelta(seconds=600),
    )
    provider_connection = ProviderConnection(user_id=current_user.id, provider="strava", status="connected", last_error="old")

    async def get_stale_state(db, *, user_id, provider):
        return stale_state

    async def get_provider_connection(db, *, user_id, provider):
        return provider_connection

    monkeypatch.setattr(integrations_router, "get_or_create_sync_state", get_stale_state)
    monkeypatch.setattr(integrations_router, "get_connection", get_provider_connection)
    background_tasks = BackgroundTasks()
    queued = await integrations_router.sync_provider_now(
        "strava",
        background_tasks=background_tasks,
        current_user=current_user,
        db=_QueueDB(),
        payload={"mode": "full"},
    )
    assert queued.message == "Sync queued."
    assert stale_state.cursor == {}
    assert provider_connection.last_error is None
    assert len(background_tasks.tasks) == 1

    poll_db = _QueueDB(execute_results=[_ScalarListResult([ProviderConnection(provider="strava"), ProviderConnection(provider="polar")])])
    polled = await integrations_router.sync_poll_all(current_user=current_user, db=poll_db)
    assert polled == {
        "queued_providers": ["strava", "polar"],
        "note": "Use /integrations/{provider}/sync-now for deterministic per-provider sync",
    }


@pytest.mark.asyncio
async def test_webhook_bridge_manual_and_summary_routes_cover_live_package_paths(monkeypatch):
    current_user = _current_user()
    webhook_db = _QueueDB()
    background_tasks = BackgroundTasks()

    monkeypatch.setattr(integrations_router, "build_event_key", lambda provider, payload, headers: "event-key")
    accepted = await integrations_router.provider_webhook(
        "strava",
        request=_JSONRequest({"object_id": 123}, headers={"x-request-id": "abc"}),
        background_tasks=background_tasks,
        db=webhook_db,
    )
    assert accepted == {"status": "accepted", "event_key": "event-key"}
    assert len(background_tasks.tasks) == 1

    duplicate_db = _QueueDB(commit_side_effect=IntegrityError("dup", None, None))
    duplicate = await integrations_router.provider_webhook(
        "strava",
        request=_JSONRequest({"object_id": 123}, headers={"x-request-id": "abc"}),
        background_tasks=BackgroundTasks(),
        db=duplicate_db,
    )
    assert duplicate == {"status": "duplicate_ignored", "event_key": "event-key"}
    assert duplicate_db.rollbacks == 1

    audit_calls = []
    upsert_payloads = []

    async def fake_audit(*args, **kwargs):
        audit_calls.append(kwargs)

    async def fake_upsert(db, *, user_id, provider, wellness_payload):
        upsert_payloads.append((provider, wellness_payload))
        return {"hrv_daily": 1, "rhr_daily": 1, "sleep_sessions": 1, "stress_daily": 1}

    monkeypatch.setattr(integrations_router, "log_integration_audit", fake_audit)
    monkeypatch.setattr(integrations_router, "_upsert_wellness", fake_upsert)

    wellness_result = await integrations_router.bridge_wellness_ingest(
        "google_fit",
        payload=[BridgeWellnessIn(date=date(2026, 3, 10), hrv_ms=55, resting_hr=48, stress_score=20, provider_record_id="gw1")],
        current_user=current_user,
        db=_QueueDB(),
    )
    sleep_result = await integrations_router.bridge_sleep_ingest(
        "apple_health",
        payload=[
            BridgeSleepIn(
                provider_record_id="sl1",
                start_time=datetime(2026, 3, 9, 22, 0, tzinfo=timezone.utc),
                end_time=datetime(2026, 3, 10, 6, 0, tzinfo=timezone.utc),
                quality_score=90,
            )
        ],
        current_user=current_user,
        db=_QueueDB(),
    )
    manual_result = await integrations_router.log_manual_wellness(
        payload=ManualWellnessIn(date=date(2026, 3, 10), hrv_ms=60, resting_hr=47),
        current_user=current_user,
        db=_QueueDB(),
    )

    assert wellness_result["provider"] == "google_fit"
    assert sleep_result["provider"] == "apple_health"
    assert manual_result["updated"]["hrv_daily"] == 1
    assert upsert_payloads[0][1]["hrv_daily"][0]["provider_record_id"] == "gw1"
    assert upsert_payloads[1][1]["sleep_sessions"][0]["duration_seconds"] == 28800
    assert upsert_payloads[2][0] == "manual"
    assert len(audit_calls) == 3

    with pytest.raises(HTTPException) as manual_exc:
        await integrations_router.log_manual_wellness(
            payload=ManualWellnessIn(date=date(2026, 3, 10)),
            current_user=current_user,
            db=_QueueDB(),
        )
    assert manual_exc.value.status_code == 400

    summary_db = _QueueDB(
        scalar_results=[
            HRVDaily(user_id=current_user.id, source_provider="manual", record_date=date(2026, 3, 10), hrv_ms=60),
            RHRDaily(user_id=current_user.id, source_provider="manual", record_date=date(2026, 3, 10), resting_hr=47),
            SleepSession(
                user_id=current_user.id,
                source_provider="apple_health",
                external_record_id="sl1",
                start_time=datetime(2026, 3, 9, 22, 0, tzinfo=timezone.utc),
                end_time=datetime(2026, 3, 10, 6, 0, tzinfo=timezone.utc),
                duration_seconds=28800,
                quality_score=90,
            ),
            StressDaily(user_id=current_user.id, source_provider="google_fit", record_date=date(2026, 3, 10), stress_score=20),
        ]
    )
    summary = await integrations_router.get_wellness_summary(current_user=current_user, db=summary_db)
    assert summary.hrv["value"] == 60
    assert summary.resting_hr["value"] == 47
    assert summary.sleep["duration_seconds"] == 28800
    assert summary.stress["value"] == 20
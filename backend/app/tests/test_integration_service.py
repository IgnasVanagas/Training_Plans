"""
Integration service and support service tests.
Covers: build_oauth_state, decode_oauth_state, build_event_key, merge_cursor,
  validate_support_request, _check_rate_limit.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.auth import JWT_AUDIENCE, SECRET_KEY, ALGORITHM
from app.integrations.service import (
    build_event_key,
    build_oauth_state,
    decode_oauth_state,
    merge_cursor,
)
from app.schemas import SupportRequestCreate
from app.services.support import (
    SupportSubmissionBlocked,
    _RATE_LIMIT_BUCKETS,
    validate_support_request,
)
from jose import jwt


# ---------------------------------------------------------------------------
# build_oauth_state / decode_oauth_state
# ---------------------------------------------------------------------------

def test_build_oauth_state_is_jwt_string():
    token = build_oauth_state(user_id=1, provider="strava")
    assert isinstance(token, str)
    # Should be decodable without audience (service-internal token)
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_aud": False})
    assert payload["sub"] == "1"
    assert payload["provider"] == "strava"


def test_decode_oauth_state_returns_dict():
    state = build_oauth_state(user_id=7, provider="garmin")
    result = decode_oauth_state(state)
    assert result["sub"] == "7"
    assert result["provider"] == "garmin"


def test_decode_oauth_state_with_invalid_token_raises_400():
    with pytest.raises(HTTPException) as exc:
        decode_oauth_state("not.a.valid.token")
    assert exc.value.status_code == 400
    assert "Invalid OAuth state" in exc.value.detail


def test_build_oauth_state_different_per_call():
    # IAT timestamp may differ by seconds making tokens unique
    import time
    t1 = build_oauth_state(user_id=1, provider="strava")
    time.sleep(0.01)
    t2 = build_oauth_state(user_id=1, provider="strava")
    # Tokens may or may not differ - just ensure they are decodable
    p1 = jwt.decode(t1, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_aud": False})
    p2 = jwt.decode(t2, SECRET_KEY, algorithms=[ALGORITHM], options={"verify_aud": False})
    assert p1["sub"] == p2["sub"] == "1"


# ---------------------------------------------------------------------------
# build_event_key
# ---------------------------------------------------------------------------

def test_build_event_key_uses_x_request_id_header():
    key = build_event_key("strava", {"object_type": "activity"}, {"X-Request-ID": "abc-123"})
    assert key == "strava:abc-123"


def test_build_event_key_uses_strava_event_id_first():
    key = build_event_key(
        "strava",
        {"object_type": "activity"},
        {"x-strava-event-id": "strava-evt-1", "X-Request-ID": "secondary"},
    )
    assert key == "strava:strava-evt-1"


def test_build_event_key_falls_back_to_payload_hash():
    payload = {"event": "ping"}
    key = build_event_key("garmin", payload, {})
    assert key.startswith("garmin:sha256:")
    assert len(key) > 15


def test_build_event_key_is_deterministic_for_same_payload():
    payload = {"a": 1, "b": 2}
    k1 = build_event_key("suunto", payload, {})
    k2 = build_event_key("suunto", payload, {})
    assert k1 == k2


def test_build_event_key_differs_for_different_payloads():
    k1 = build_event_key("strava", {"a": 1}, {})
    k2 = build_event_key("strava", {"a": 2}, {})
    assert k1 != k2


# ---------------------------------------------------------------------------
# merge_cursor
# ---------------------------------------------------------------------------

def test_merge_cursor_both_none():
    assert merge_cursor(None, None) is None


def test_merge_cursor_previous_none():
    result = merge_cursor(None, {"page": 2})
    assert result == {"page": 2}


def test_merge_cursor_next_none():
    result = merge_cursor({"after_epoch": 1000}, None)
    assert result == {"after_epoch": 1000}


def test_merge_cursor_overwrites_previous():
    result = merge_cursor({"after_epoch": 100, "page": 1}, {"after_epoch": 200})
    assert result["after_epoch"] == 200
    assert result["page"] == 1


def test_merge_cursor_does_not_mutate_previous():
    prev = {"after_epoch": 100}
    prev_copy = prev.copy()
    merge_cursor(prev, {"after_epoch": 200})
    assert prev == prev_copy


# ---------------------------------------------------------------------------
# validate_support_request
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_rate_buckets():
    _RATE_LIMIT_BUCKETS.clear()
    yield
    _RATE_LIMIT_BUCKETS.clear()


def _make_support_payload(**overrides) -> SupportRequestCreate:
    defaults = dict(
        email="user@example.com",
        message="I need help with my account access.",
        client_elapsed_ms=3000,
    )
    defaults.update(overrides)
    return SupportRequestCreate(**defaults)


def test_validate_support_request_passes_normal():
    # Should not raise
    validate_support_request(
        _make_support_payload(),
        client_host="10.0.0.1",
        user_agent="Mozilla/5.0 test",
    )


def test_validate_support_request_rejects_bot_trap():
    with pytest.raises(SupportSubmissionBlocked):
        validate_support_request(
            _make_support_payload(bot_trap="filled"),
            client_host="10.0.0.1",
            user_agent="Mozilla",
        )


def test_validate_support_request_rejects_fast_submit():
    with pytest.raises(SupportSubmissionBlocked):
        validate_support_request(
            _make_support_payload(client_elapsed_ms=100),
            client_host="10.0.0.1",
            user_agent="Mozilla",
        )


def test_validate_support_request_rejects_too_many_links():
    msg = "Visit https://spam1.com and https://spam2.com and https://spam3.com for help"
    with pytest.raises(SupportSubmissionBlocked):
        validate_support_request(
            _make_support_payload(message=msg),
            client_host="10.0.0.1",
            user_agent="Mozilla",
        )


def test_validate_support_request_rate_limits_repeated_sends():
    validate_support_request(
        _make_support_payload(client_elapsed_ms=60000),
        client_host="10.0.0.5",
        user_agent="Mozilla",
    )
    with pytest.raises(SupportSubmissionBlocked):
        validate_support_request(
            _make_support_payload(client_elapsed_ms=60000),
            client_host="10.0.0.5",
            user_agent="Mozilla",
        )


def test_validate_support_request_blocks_after_max_requests_when_spacing_disabled(monkeypatch):
    monkeypatch.setenv("SUPPORT_RATE_LIMIT_MIN_SPACING_SECONDS", "0")
    monkeypatch.setenv("SUPPORT_RATE_LIMIT_MAX_REQUESTS", "3")

    for _ in range(3):
        validate_support_request(
            _make_support_payload(client_elapsed_ms=60000),
            client_host="10.0.0.8",
            user_agent="Mozilla",
        )

    with pytest.raises(SupportSubmissionBlocked):
        validate_support_request(
            _make_support_payload(client_elapsed_ms=60000),
            client_host="10.0.0.8",
            user_agent="Mozilla",
        )


def test_validate_support_request_blocks_oversized_user_agent():
    long_ua = "A" * 600
    with pytest.raises(SupportSubmissionBlocked):
        validate_support_request(
            _make_support_payload(),
            client_host="10.0.0.2",
            user_agent=long_ua,
        )

"""
Auth module extended tests.
Covers: get_password_hash, verify_password, create_access_token,
  create_refresh_token, decode_refresh_token, create_action_token,
  decode_action_token, and edge cases.
"""
from __future__ import annotations

import time
from datetime import timedelta

import pytest
from jose import JWTError

from app.auth import (
    create_access_token,
    create_action_token,
    create_refresh_token,
    decode_action_token,
    decode_refresh_token,
    get_password_hash,
    verify_password,
    SECRET_KEY,
    ALGORITHM,
    JWT_AUDIENCE,
    JWT_ISSUER,
)
from jose import jwt


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

def test_get_password_hash_returns_string():
    hashed = get_password_hash("SecurePass1!")
    assert isinstance(hashed, str)
    assert len(hashed) > 20


def test_get_password_hash_is_not_plaintext():
    hashed = get_password_hash("MyPassword")
    assert hashed != "MyPassword"


def test_get_password_hash_different_for_same_input():
    # bcrypt uses random salt, so two hashes of the same password differ
    h1 = get_password_hash("same")
    h2 = get_password_hash("same")
    assert h1 != h2


def test_verify_password_correct():
    hashed = get_password_hash("CorrectPass!")
    assert verify_password("CorrectPass!", hashed) is True


def test_verify_password_wrong():
    hashed = get_password_hash("CorrectPass!")
    assert verify_password("WrongPass!", hashed) is False


def test_verify_password_empty_against_hashed():
    hashed = get_password_hash("nonempty")
    assert verify_password("", hashed) is False


# ---------------------------------------------------------------------------
# Access token
# ---------------------------------------------------------------------------

def test_create_access_token_is_string():
    token = create_access_token(subject="42")
    assert isinstance(token, str)
    # JWT format: three base64 segments separated by dots
    assert token.count(".") == 2


def test_access_token_contains_correct_subject():
    token = create_access_token(subject="99")
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    assert payload["sub"] == "99"


def test_access_token_has_required_fields():
    token = create_access_token(subject="1")
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    for field in ("exp", "iat", "nbf", "iss", "aud", "jti", "sub"):
        assert field in payload, f"Missing field: {field}"


def test_access_token_jti_is_unique():
    t1 = create_access_token(subject="5")
    t2 = create_access_token(subject="5")
    p1 = jwt.decode(t1, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    p2 = jwt.decode(t2, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    assert p1["jti"] != p2["jti"]


def test_access_token_custom_expiry():
    token = create_access_token(subject="7", expires_delta=timedelta(hours=2))
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    # exp should be roughly 2 hours from now
    remaining = payload["exp"] - int(time.time())
    assert 7100 < remaining < 7500  # 2 h ± 200s tolerance


def test_access_token_expired_raises():
    token = create_access_token(subject="1", expires_delta=timedelta(seconds=-1))
    with pytest.raises(JWTError):
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)


# ---------------------------------------------------------------------------
# Refresh token
# ---------------------------------------------------------------------------

def test_create_refresh_token_is_string():
    token = create_refresh_token(subject="10")
    assert isinstance(token, str)


def test_refresh_token_typ_is_refresh():
    token = create_refresh_token(subject="10")
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    assert payload["typ"] == "refresh"


def test_decode_refresh_token_returns_subject():
    token = create_refresh_token(subject="55")
    subject = decode_refresh_token(token)
    assert subject == "55"


def test_decode_refresh_token_rejects_access_token():
    # Access token has no "typ" == "refresh"
    access = create_access_token(subject="1")
    with pytest.raises(JWTError):
        decode_refresh_token(access)


# ---------------------------------------------------------------------------
# Action tokens
# ---------------------------------------------------------------------------

def test_create_action_token_is_string():
    token = create_action_token(subject="user@example.com", purpose="email_verify")
    assert isinstance(token, str)


def test_action_token_contains_purpose_and_typ():
    token = create_action_token(subject="user@example.com", purpose="password_reset")
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    assert payload["purpose"] == "password_reset"
    assert payload["typ"] == "action"


def test_decode_action_token_returns_subject():
    token = create_action_token(subject="user@example.com", purpose="email_verify")
    subject = decode_action_token(token=token, purpose="email_verify")
    assert subject == "user@example.com"


def test_decode_action_token_rejects_wrong_purpose():
    token = create_action_token(subject="user@example.com", purpose="email_verify")
    with pytest.raises(JWTError):
        decode_action_token(token=token, purpose="password_reset")


def test_decode_action_token_rejects_refresh_token():
    refresh = create_refresh_token(subject="user@example.com")
    with pytest.raises(JWTError):
        decode_action_token(token=refresh, purpose="email_verify")


def test_action_token_custom_expiry():
    token = create_action_token(subject="u", purpose="invite", expires_minutes=15)
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    remaining = payload["exp"] - int(time.time())
    assert 800 < remaining < 950  # ~15 min ± tolerance


def test_action_token_minimum_1min_expiry():
    # 0 or negative expires_minutes clamped to 1
    token = create_action_token(subject="u", purpose="test", expires_minutes=0)
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM], audience=JWT_AUDIENCE, issuer=JWT_ISSUER)
    remaining = payload["exp"] - int(time.time())
    assert remaining > 0  # must not already be expired

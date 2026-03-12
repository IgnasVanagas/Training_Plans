from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet

from ..auth import SECRET_KEY


def _build_fernet() -> Fernet:
    token_secret = (os.getenv("INTEGRATIONS_TOKEN_ENCRYPTION_KEY") or "").strip() or SECRET_KEY
    key = base64.urlsafe_b64encode(hashlib.sha256(token_secret.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_token(token: str | None) -> str | None:
    if not token:
        return None
    return _build_fernet().encrypt(token.encode("utf-8")).decode("utf-8")


def decrypt_token(cipher_text: str | None) -> str | None:
    if not cipher_text:
        return None
    return _build_fernet().decrypt(cipher_text.encode("utf-8")).decode("utf-8")

from __future__ import annotations

import asyncio
import logging
import os
import re
import smtplib
import ssl
import time
from collections import defaultdict, deque
from email.message import EmailMessage

from ..schemas import SupportRequestCreate

logger = logging.getLogger(__name__)

_URL_PATTERN = re.compile(r"(?:https?://|www\.)", re.IGNORECASE)
_RATE_LIMIT_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


class SupportSubmissionBlocked(Exception):
    pass


class SupportDeliveryError(Exception):
    pass


def validate_support_request(
    payload: SupportRequestCreate,
    *,
    client_host: str | None,
    user_agent: str | None,
) -> None:
    if payload.bot_trap:
        raise SupportSubmissionBlocked("Support request flagged as bot traffic.")

    min_elapsed_ms = int(os.getenv("SUPPORT_MIN_ELAPSED_MS", "2500"))
    if payload.client_elapsed_ms < min_elapsed_ms:
        raise SupportSubmissionBlocked("Support request flagged as bot traffic.")

    max_links = int(os.getenv("SUPPORT_MAX_LINKS", "2"))
    if len(_URL_PATTERN.findall(payload.message)) > max_links:
        raise SupportSubmissionBlocked("Support request flagged as bot traffic.")

    _check_rate_limit(key=client_host or payload.email, user_agent=user_agent)


def _check_rate_limit(*, key: str, user_agent: str | None) -> None:
    now = time.monotonic()
    window_seconds = int(os.getenv("SUPPORT_RATE_LIMIT_WINDOW_SECONDS", "3600"))
    max_requests = int(os.getenv("SUPPORT_RATE_LIMIT_MAX_REQUESTS", "5"))
    min_spacing_seconds = int(os.getenv("SUPPORT_RATE_LIMIT_MIN_SPACING_SECONDS", "45"))
    bucket = _RATE_LIMIT_BUCKETS[key]

    while bucket and (now - bucket[0]) > window_seconds:
        bucket.popleft()

    if bucket and (now - bucket[-1]) < min_spacing_seconds:
        raise SupportSubmissionBlocked("Please wait before sending another support request.")

    if len(bucket) >= max_requests:
        raise SupportSubmissionBlocked("Too many support requests. Please try again later.")

    bucket.append(now)

    if user_agent and len(user_agent) > 512:
        raise SupportSubmissionBlocked("Support request flagged as bot traffic.")


async def send_support_email(
    payload: SupportRequestCreate,
    *,
    client_host: str | None,
    user_agent: str | None,
) -> None:
    try:
        await asyncio.to_thread(
            _send_support_email_sync,
            payload,
            client_host=client_host,
            user_agent=user_agent,
        )
    except SupportDeliveryError:
        raise
    except Exception as exc:  # pragma: no cover
        logger.exception("Unexpected support delivery failure")
        raise SupportDeliveryError("Support delivery failed") from exc


def _send_support_email_sync(
    payload: SupportRequestCreate,
    *,
    client_host: str | None,
    user_agent: str | None,
) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    if not smtp_host:
        raise SupportDeliveryError("SMTP is not configured")

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() in {"1", "true", "yes", "on"}
    smtp_use_starttls = os.getenv("SMTP_USE_STARTTLS", "true").lower() in {"1", "true", "yes", "on"}
    support_to = os.getenv("SUPPORT_EMAIL_TO", "ignas@wunderbit.lt")
    support_from = os.getenv("SUPPORT_EMAIL_FROM") or smtp_username or support_to

    message = EmailMessage()
    message["Subject"] = payload.subject or "Origami Plans support request"
    message["From"] = support_from
    message["To"] = support_to
    message["Reply-To"] = payload.email
    message.set_content(
        "\n".join(
            [
                "New Origami Plans support request",
                "",
                f"Name: {payload.name or '-'}",
                f"Email: {payload.email}",
                f"Page: {payload.page_url or '-'}",
                f"Client IP: {client_host or '-'}",
                f"User-Agent: {user_agent or '-'}",
                f"Error details: {payload.error_message or '-'}",
                "",
                "Message:",
                payload.message,
            ]
        )
    )

    context = ssl.create_default_context()
    try:
        if smtp_use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=20) as smtp:
                if smtp_username and smtp_password:
                    smtp.login(smtp_username, smtp_password)
                smtp.send_message(message)
            return

        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
            if smtp_use_starttls:
                smtp.starttls(context=context)
            if smtp_username and smtp_password:
                smtp.login(smtp_username, smtp_password)
            smtp.send_message(message)
    except Exception as exc:
        logger.exception("Failed to send support request email")
        raise SupportDeliveryError("Support delivery failed") from exc
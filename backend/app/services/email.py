import logging
import os

import httpx


logger = logging.getLogger(__name__)


async def send_email_via_resend(*, to_email: str, subject: str, html: str) -> bool:
    api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    from_email = (os.getenv("RESEND_FROM_EMAIL") or "").strip()
    if not api_key or not from_email:
        logger.warning("Resend not configured (missing RESEND_API_KEY or RESEND_FROM_EMAIL); skipping email send")
        return False

    payload = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post("https://api.resend.com/emails", json=payload, headers=headers)
        if response.status_code >= 400:
            logger.error("Resend send failed with status %s: %s", response.status_code, response.text)
            return False
        return True
    except Exception:
        logger.exception("Failed to send email via Resend")
        return False


async def send_verification_email(*, to_email: str, verify_url: str) -> bool:
    subject = "Verify your email"
    html = (
        "<div style='font-family:Arial,sans-serif;line-height:1.5;color:#111'>"
        "<h2 style='margin:0 0 12px'>Verify your email</h2>"
        "<p style='margin:0 0 12px'>Thanks for creating your account. Please verify your email to finish setup.</p>"
        f"<p style='margin:0 0 16px'><a href='{verify_url}' style='background:#0ea5e9;color:#fff;padding:10px 14px;text-decoration:none;border-radius:6px;display:inline-block'>Verify email</a></p>"
        f"<p style='margin:0 0 8px'>If the button does not work, copy this link:</p><p style='margin:0;word-break:break-all'>{verify_url}</p>"
        "</div>"
    )
    return await send_email_via_resend(to_email=to_email, subject=subject, html=html)

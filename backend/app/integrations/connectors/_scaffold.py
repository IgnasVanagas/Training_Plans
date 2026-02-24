from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from ..base import (
    IntegrationUnavailableError,
    OAuthExchangeResult,
    ProviderConnector,
    ProviderWellnessPayload,
    SyncResult,
)


class ApprovalScaffoldConnector(ProviderConnector):
    def __init__(
        self,
        *,
        provider: str,
        display_name: str,
        docs_url: str,
        required_scopes: list[str],
        approval_required: bool = True,
        bridge_only: bool = False,
    ) -> None:
        self.provider = provider
        self.display_name = display_name
        self.docs_url = docs_url
        self.required_scopes = required_scopes
        self.approval_required = approval_required
        self.bridge_only = bridge_only

    def is_enabled(self) -> bool:
        return os.getenv(f"ENABLE_{self.provider.upper()}_INTEGRATION", "false").lower() in {"1", "true", "yes", "on"}

    def is_configured(self) -> bool:
        client_id = os.getenv(f"{self.provider.upper()}_CLIENT_ID")
        client_secret = os.getenv(f"{self.provider.upper()}_CLIENT_SECRET")
        return bool(client_id and client_secret)

    def authorize_url(self, state: str) -> str:
        raise IntegrationUnavailableError(
            f"{self.display_name} connector is scaffolded only and pending partner approval. See {self.docs_url}"
        )

    async def exchange_token(self, code: str) -> OAuthExchangeResult:
        raise IntegrationUnavailableError(
            f"{self.display_name} token exchange is disabled until partner approval."
        )

    async def refresh_token(self, refresh_token: str) -> OAuthExchangeResult:
        raise IntegrationUnavailableError(
            f"{self.display_name} token refresh is disabled until partner approval."
        )

    async def fetch_activities(self, *, access_token: str, cursor: dict[str, Any] | None) -> SyncResult:
        raise IntegrationUnavailableError(
            f"{self.display_name} activity sync is disabled until partner approval."
        )

    async def fetch_wellness(self, *, access_token: str, cursor: dict[str, Any] | None) -> ProviderWellnessPayload:
        if self.bridge_only:
            return ProviderWellnessPayload(hrv_daily=[], rhr_daily=[], sleep_sessions=[], stress_daily=[])
        raise IntegrationUnavailableError(
            f"{self.display_name} wellness sync is disabled until partner approval."
        )

    async def handle_webhook(self, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        return {
            "status": "ignored",
            "reason": "pending_partner_approval",
            "provider": self.provider,
            "received_at": datetime.utcnow().isoformat(),
        }

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any


class IntegrationUnavailableError(Exception):
    pass


@dataclass
class ProviderActivityRecord:
    provider_activity_id: str
    name: str
    start_time: datetime
    duration_s: float | None
    distance_m: float | None
    sport: str | None
    average_hr: float | None = None
    average_watts: float | None = None
    average_speed: float | None = None
    payload: dict[str, Any] | None = None


@dataclass
class ProviderWellnessPayload:
    hrv_daily: list[dict[str, Any]]
    rhr_daily: list[dict[str, Any]]
    sleep_sessions: list[dict[str, Any]]
    stress_daily: list[dict[str, Any]]


@dataclass
class OAuthExchangeResult:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    scopes: list[str]
    external_athlete_id: str | None
    raw: dict[str, Any]


@dataclass
class SyncResult:
    activities: list[ProviderActivityRecord]
    wellness: ProviderWellnessPayload
    next_cursor: dict[str, Any] | None


class ProviderConnector(ABC):
    provider: str
    display_name: str
    approval_required: bool = False
    bridge_only: bool = False
    docs_url: str | None = None
    required_scopes: list[str] = []

    @abstractmethod
    def is_enabled(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def is_configured(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def authorize_url(self, state: str) -> str:
        raise NotImplementedError

    @abstractmethod
    async def exchange_token(self, code: str) -> OAuthExchangeResult:
        raise NotImplementedError

    @abstractmethod
    async def refresh_token(self, refresh_token: str) -> OAuthExchangeResult:
        raise NotImplementedError

    @abstractmethod
    async def fetch_activities(
        self,
        *,
        access_token: str,
        cursor: dict[str, Any] | None,
    ) -> SyncResult:
        raise NotImplementedError

    @abstractmethod
    async def fetch_wellness(
        self,
        *,
        access_token: str,
        cursor: dict[str, Any] | None,
    ) -> ProviderWellnessPayload:
        raise NotImplementedError

    @abstractmethod
    async def handle_webhook(self, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        raise NotImplementedError

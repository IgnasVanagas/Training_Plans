from __future__ import annotations

from .base import ProviderConnector
from .connectors.apple_health import AppleHealthConnector
from .connectors.coros import CorosConnector
from .connectors.garmin import GarminConnector
from .connectors.google_fit import GoogleFitConnector
from .connectors.polar import PolarConnector
from .connectors.strava import StravaConnector
from .connectors.suunto import SuuntoConnector
from .connectors.whoop import WhoopConnector


PROVIDER_CONNECTORS: dict[str, ProviderConnector] = {
    "strava": StravaConnector(),
    "polar": PolarConnector(),
    "suunto": SuuntoConnector(),
    "whoop": WhoopConnector(),
    "garmin": GarminConnector(),
    "coros": CorosConnector(),
    "google_fit": GoogleFitConnector(),
    "apple_health": AppleHealthConnector(),
}


def get_connector(provider: str) -> ProviderConnector:
    key = provider.lower()
    if key not in PROVIDER_CONNECTORS:
        raise KeyError(f"Unknown provider: {provider}")
    return PROVIDER_CONNECTORS[key]


def list_provider_statuses() -> list[dict]:
    out: list[dict] = []
    for provider, connector in PROVIDER_CONNECTORS.items():
        out.append(
            {
                "provider": provider,
                "display_name": connector.display_name,
                "enabled": connector.is_enabled(),
                "configured": connector.is_configured(),
                "approval_required": connector.approval_required,
                "bridge_only": connector.bridge_only,
                "required_scopes": connector.required_scopes,
                "docs_url": connector.docs_url,
            }
        )
    return out

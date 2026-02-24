from ._scaffold import ApprovalScaffoldConnector


class GarminConnector(ApprovalScaffoldConnector):
    def __init__(self) -> None:
        super().__init__(
            provider="garmin",
            display_name="Garmin Health API",
            docs_url="https://developer.garmin.com/gc-developer-program/health-api/",
            required_scopes=["dailies", "epochs", "activities", "sleep"],
        )

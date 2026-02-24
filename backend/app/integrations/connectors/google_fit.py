from ._scaffold import ApprovalScaffoldConnector


class GoogleFitConnector(ApprovalScaffoldConnector):
    def __init__(self) -> None:
        super().__init__(
            provider="google_fit",
            display_name="Google Fit Bridge",
            docs_url="https://developers.google.com/fit",
            required_scopes=["fitness.activity.read", "fitness.heart_rate.read", "fitness.sleep.read"],
            approval_required=False,
            bridge_only=True,
        )

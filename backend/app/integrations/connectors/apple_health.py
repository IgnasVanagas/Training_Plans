from ._scaffold import ApprovalScaffoldConnector


class AppleHealthConnector(ApprovalScaffoldConnector):
    def __init__(self) -> None:
        super().__init__(
            provider="apple_health",
            display_name="Apple HealthKit Bridge",
            docs_url="https://developer.apple.com/health-fitness/",
            required_scopes=["HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "HKCategoryTypeIdentifierSleepAnalysis"],
            approval_required=False,
            bridge_only=True,
        )

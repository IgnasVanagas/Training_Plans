from ._scaffold import ApprovalScaffoldConnector


class CorosConnector(ApprovalScaffoldConnector):
    def __init__(self) -> None:
        super().__init__(
            provider="coros",
            display_name="COROS Partner API",
            docs_url="https://support.coros.com/hc/en-us",
            required_scopes=["activities", "wellness"],
        )

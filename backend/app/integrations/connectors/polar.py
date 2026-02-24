from ._scaffold import ApprovalScaffoldConnector


class PolarConnector(ApprovalScaffoldConnector):
    def __init__(self) -> None:
        super().__init__(
            provider="polar",
            display_name="Polar AccessLink",
            docs_url="https://www.polar.com/accesslink-api/",
            required_scopes=["activity", "sleep", "heart_rate"],
        )

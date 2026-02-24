from ._scaffold import ApprovalScaffoldConnector


class WhoopConnector(ApprovalScaffoldConnector):
    def __init__(self) -> None:
        super().__init__(
            provider="whoop",
            display_name="WHOOP Developer Platform",
            docs_url="https://developer.whoop.com/docs/developing/user-data",
            required_scopes=["read:workout", "read:recovery", "read:sleep", "read:cycles"],
        )

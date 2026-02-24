from ._scaffold import ApprovalScaffoldConnector


class SuuntoConnector(ApprovalScaffoldConnector):
    def __init__(self) -> None:
        super().__init__(
            provider="suunto",
            display_name="Suunto Partner API",
            docs_url="https://apizone.suunto.com/",
            required_scopes=["activity", "sleep", "recovery"],
        )

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { IntegrationsPanel } from "./IntegrationsPanel";

const sampleProviders = [
  {
    provider: "strava",
    display_name: "Strava",
    enabled: true,
    configured: true,
    approval_required: false,
    bridge_only: false,
    required_scopes: ["read", "activity:read_all"],
    docs_url: "https://developers.strava.com/docs/",
    connection_status: "connected",
    last_sync_at: null,
    last_error: null,
  },
  {
    provider: "suunto",
    display_name: "Suunto",
    enabled: true,
    configured: true,
    approval_required: false,
    bridge_only: false,
    required_scopes: ["activity"],
    docs_url: "https://apizone.suunto.com/",
    connection_status: "disconnected",
    last_sync_at: null,
    last_error: null,
  },
  {
    provider: "garmin",
    display_name: "Garmin Health API",
    enabled: false,
    configured: false,
    approval_required: true,
    bridge_only: false,
    required_scopes: ["activities"],
    docs_url: "https://developer.garmin.com/",
    connection_status: "disconnected",
    last_sync_at: null,
    last_error: "Pending partner approval",
  },
];

describe("IntegrationsPanel", () => {
  const renderPanel = (ui: JSX.Element) => render(<MantineProvider>{ui}</MantineProvider>);

  it("renders provider status labels", () => {
    renderPanel(
      <IntegrationsPanel
        providers={sampleProviders}
        connectingProvider={null}
        disconnectingProvider={null}
        syncingProvider={null}
        onConnect={() => undefined}
        onDisconnect={() => undefined}
        onSync={() => undefined}
      />
    );

    expect(screen.getByText("Strava")).toBeInTheDocument();
    expect(screen.getByText("Garmin Health API")).toBeInTheDocument();
    expect(screen.getAllByText(/Pending partner approval/).length).toBeGreaterThan(0);
  });

  it("fires connect disconnect and sync actions", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const onSync = vi.fn();

    renderPanel(
      <IntegrationsPanel
        providers={[sampleProviders[0], sampleProviders[1]]}
        connectingProvider={null}
        disconnectingProvider={null}
        syncingProvider={null}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onSync={onSync}
      />
    );

    const connectButtons = screen.getAllByRole("button", { name: "Connect" });
    const disconnectButtons = screen.getAllByRole("button", { name: "Disconnect" });
    const syncButtons = screen.getAllByRole("button", { name: "Sync now" });

    await user.click(connectButtons[1]);
    await user.click(disconnectButtons[0]);
    await user.click(syncButtons[0]);

    expect(onConnect).toHaveBeenCalledWith("suunto");
    expect(onDisconnect).toHaveBeenCalledWith("strava");
    expect(onSync).toHaveBeenCalledWith("strava");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { I18nProvider } from "../../i18n/I18nProvider";
import DashboardActivityTrackersTab from "./DashboardActivityTrackersTab";
import type { ProviderStatus } from "../../api/integrations";

const wrap = (ui: React.ReactElement) =>
  render(
    <MantineProvider>
      <I18nProvider>{ui}</I18nProvider>
    </MantineProvider>,
  );

const makeProvider = (overrides: Partial<ProviderStatus> = {}): ProviderStatus => ({
  provider: "strava",
  display_name: "Strava",
  enabled: true,
  configured: true,
  approval_required: false,
  bridge_only: false,
  required_scopes: [],
  connection_status: "disconnected",
  ...overrides,
});

describe("DashboardActivityTrackersTab", () => {
  it("renders providers and triggers connect", () => {
    const onConnect = vi.fn();
    wrap(
      <DashboardActivityTrackersTab
        providers={[makeProvider()]}
        onConnect={onConnect}
        onDisconnect={() => {}}
        onSync={() => {}}
        onCancelSync={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Connect your Strava/i }));
    expect(onConnect).toHaveBeenCalledWith("strava");
  });

  it("shows connected state with sync/disconnect and last error", () => {
    const onSync = vi.fn();
    const onDisconnect = vi.fn();
    wrap(
      <DashboardActivityTrackersTab
        providers={[
          makeProvider({
            provider: "garmin",
            display_name: "Garmin",
            connection_status: "connected",
            last_sync_at: new Date("2026-01-01").toISOString(),
            last_error: "auth expired",
          }),
        ]}
        onConnect={() => {}}
        onDisconnect={onDisconnect}
        onSync={onSync}
        onCancelSync={() => {}}
      />,
    );
    expect(screen.getByText(/Garmin is taking longer/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sync now/i }));
    expect(onSync).toHaveBeenCalledWith("garmin");
    fireEvent.click(screen.getByRole("button", { name: /Disconnect/i }));
    expect(onDisconnect).toHaveBeenCalledWith("garmin");
  });

  it("shows pending approval and disabled/unconfigured statuses", () => {
    wrap(
      <DashboardActivityTrackersTab
        providers={[
          makeProvider({ provider: "polar", display_name: "Polar", approval_required: true }),
          makeProvider({ provider: "coros", display_name: "Coros", enabled: false }),
          makeProvider({ provider: "wahoo", display_name: "Wahoo", configured: false }),
          makeProvider({ provider: "suunto", display_name: "Suunto", bridge_only: true }),
        ]}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onSync={() => {}}
        onCancelSync={() => {}}
      />,
    );
    expect(screen.getByText(/Pending partner approval/i)).toBeInTheDocument();
    expect(screen.getByText(/Disabled/)).toBeInTheDocument();
    expect(screen.getByText(/Not configured/i)).toBeInTheDocument();
    expect(screen.getByText(/Bridge ingestion/i)).toBeInTheDocument();
  });

  it("renders Strava sync progress and cancel button while syncing", () => {
    const onCancel = vi.fn();
    wrap(
      <DashboardActivityTrackersTab
        providers={[
          makeProvider({
            provider: "strava",
            display_name: "Strava",
            connection_status: "connected",
            history_imported: true,
          }),
        ]}
        syncingProvider="strava"
        syncStatus={{ provider: "strava", status: "running", progress: 5, total: 10 }}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onSync={() => {}}
        onCancelSync={onCancel}
      />,
    );
    expect(screen.getByText(/Synced 5 of 10/i)).toBeInTheDocument();
    expect(screen.getByText(/3-month history imported/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Cancel sync/i }));
    expect(onCancel).toHaveBeenCalledWith("strava");
  });
});

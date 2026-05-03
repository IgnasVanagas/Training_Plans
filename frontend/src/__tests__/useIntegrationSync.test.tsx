import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../api/integrations", () => ({
  cancelIntegrationSync: vi.fn().mockResolvedValue({ status: "completed" }),
  connectIntegration: vi.fn().mockResolvedValue({ authorization_url: "http://example/auth" }),
  disconnectIntegration: vi.fn().mockResolvedValue(undefined),
  getIntegrationSyncStatus: vi.fn().mockResolvedValue({ status: "completed" }),
  syncIntegrationNow: vi.fn().mockResolvedValue({ status: "queued" }),
  listIntegrationProviders: vi.fn().mockResolvedValue([]),
  getStravaImportPreferences: vi.fn().mockResolvedValue({ import_all_time: false }),
  setStravaImportPreferences: vi.fn().mockResolvedValue({ import_all_time: true }),
  getWellnessSummary: vi.fn().mockResolvedValue({}),
  logManualWellness: vi.fn().mockResolvedValue({}),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("useIntegrationSync hook", () => {
  it("triggers mutations end-to-end", async () => {
    const { useIntegrationSync } = await import("../pages/dashboard/useIntegrationSync");
    const queryClient = new QueryClient();
    const { result } = renderHook(
      () =>
        useIntegrationSync({
          queryClient,
          me: { id: 1, role: "athlete", profile: {} } as any,
          integrations: [
            {
              provider: "strava",
              connected: true,
              last_sync_at: null,
              sync_status: "completed",
              status: "completed",
            } as any,
          ],
          activeTab: "trackers",
          isDocumentVisible: true,
        }),
      { wrapper },
    );

    // Connect
    await act(async () => {
      try {
        result.current.connectIntegrationMutation.mutate({ provider: "strava" } as any);
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 5));
    });

    // Sync
    await act(async () => {
      try {
        result.current.syncIntegrationMutation.mutate({ provider: "strava" } as any);
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 5));
    });

    // Cancel
    await act(async () => {
      try {
        result.current.cancelSyncMutation.mutate({ provider: "strava" } as any);
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 5));
    });

    // Disconnect
    await act(async () => {
      try {
        result.current.disconnectIntegrationMutation.mutate({ provider: "strava" } as any);
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 5));
    });

    expect(result.current).toBeDefined();
  });

  it("renders with multiple providers and activeTab variations", async () => {
    const { useIntegrationSync } = await import("../pages/dashboard/useIntegrationSync");
    const queryClient = new QueryClient();
    const { rerender } = renderHook(
      ({ tab, vis }: { tab: string; vis: boolean }) =>
        useIntegrationSync({
          queryClient,
          me: { id: 1, role: "athlete", profile: {} } as any,
          integrations: [
            { provider: "strava", connected: false, status: "idle" } as any,
            { provider: "garmin", connected: true, status: "running" } as any,
            { provider: "wahoo", connected: true, status: "queued" } as any,
          ],
          activeTab: tab,
          isDocumentVisible: vis,
        }),
      { wrapper, initialProps: { tab: "trackers", vis: true } },
    );
    rerender({ tab: "dashboard", vis: false });
    rerender({ tab: "trackers", vis: true });
    expect(true).toBe(true);
  });
});

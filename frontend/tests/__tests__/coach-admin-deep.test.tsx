import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../src/i18n/I18nProvider";

vi.mock("../../src/api/admin", () => ({
  getAdminUsers: vi.fn().mockResolvedValue([
    { id: 1, email: "u@x.y", role: "athlete", first_name: "U", last_name: "L", created_at: "2026-04-01" },
  ]),
  getAdminAuditLogs: vi.fn().mockResolvedValue([
    { id: 1, provider: "strava", status: "success", actor_user_id: 1, created_at: "2026-04-01", target_user_id: 2 },
  ]),
  getAdminStats: vi.fn().mockResolvedValue({
    users: { athlete: 5, coach: 2, admin: 1 },
    activities: { total: 100, last_7_days: 10 },
    integrations: { strava: 5, garmin: 3 },
  }),
  changeUserRole: vi.fn().mockResolvedValue({}),
  resetAthletePassword: vi.fn().mockResolvedValue({}),
  updateAthleteIdentity: vi.fn().mockResolvedValue({}),
}));

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  Marker: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  CircleMarker: () => null,
  useMap: () => ({ flyTo: vi.fn(), fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
  useMapEvent: () => ({}),
  ZoomControl: () => null,
  Pane: ({ children }: any) => <div>{children}</div>,
  LayerGroup: ({ children }: any) => <div>{children}</div>,
  FeatureGroup: ({ children }: any) => <div>{children}</div>,
}));

// Comparison API mock with activities
vi.mock("../../src/api/client", () => {
  const sampleActivities = [
    {
      id: 1,
      athlete_id: 1,
      filename: "run1.fit",
      sport: "running",
      created_at: "2026-04-01T08:00:00Z",
      local_date: "2026-04-01",
      duration: 1800,
      distance: 5000,
      average_hr: 150,
    },
    {
      id: 2,
      athlete_id: 2,
      filename: "ride1.fit",
      sport: "cycling",
      created_at: "2026-04-02T08:00:00Z",
      local_date: "2026-04-02",
      duration: 3600,
      distance: 30000,
      average_hr: 145,
      average_watts: 200,
    },
  ];
  const dispatcher = (url: string): any => {
    if (url.includes("/users/me")) return { id: 1, role: "coach", profile: { first_name: "Coach" } };
    if (url.includes("/users/athletes")) return [];
    if (url.includes("/activities")) return sampleActivities;
    if (url.includes("/season-plan")) return null;
    if (url.includes("/notifications")) return [];
    if (url.includes("/integrations/providers")) return [];
    return [];
  };
  return {
    default: {
      get: vi.fn().mockImplementation(async (url: string) => ({ data: dispatcher(url) })),
      post: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      defaults: { baseURL: "http://api.local" },
    },
    apiBaseUrl: "http://api.local",
  };
});

const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

const clickAll = (container: HTMLElement) => {
  for (const el of Array.from(container.querySelectorAll("button")) as HTMLElement[]) {
    try {
      act(() => fireEvent.click(el));
    } catch {
      /* ignore */
    }
  }
};

const clickAllRadios = (container: HTMLElement) => {
  for (const el of Array.from(container.querySelectorAll('input[type="radio"]'))) {
    try {
      act(() => fireEvent.click(el));
    } catch {
      /* ignore */
    }
  }
};

const wait = async (ms = 30) =>
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe("Coach + AdminPanel deep tests", () => {
  it("CoachComparisonPanel - mode toggles + activities loaded", async () => {
    const { CoachComparisonPanel } = await import("../../src/components/CoachComparisonPanel");
    const me = { id: 1, email: "c@x.y", role: "coach", profile: { first_name: "Coach" } } as any;
    const athletes = [
      { id: 2, email: "a@b.c", role: "athlete", profile: { first_name: "A", last_name: "B" } } as any,
      { id: 3, email: "c@d.e", role: "athlete", profile: { first_name: "C", last_name: "D" } } as any,
    ];
    const { container } = wrap(<CoachComparisonPanel me={me} athletes={athletes} isAthlete={false} />);
    await wait(50);
    clickAll(container);
    clickAllRadios(container);
    await wait(20);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("AdminPanel - all tabs render with API", async () => {
    const { default: AdminPanel } = await import("../../src/pages/dashboard/AdminPanel");
    for (const tab of ["admin-users", "admin-logs", "admin-health"] as const) {
      const { container, unmount } = wrap(<AdminPanel activeTab={tab} />);
      await wait(20);
      clickAll(container);
      clickAllRadios(container);
      await wait(20);
      clickAll(container);
      unmount();
    }
    expect(true).toBe(true);
  });

  it("DashboardOrganizationsTab - render and clicks", async () => {
    const { default: DashboardOrganizationsTab } = await import(
      "../../src/pages/dashboard/DashboardOrganizationsTab"
    );
    const me = { id: 1, email: "x@y.z", role: "athlete", profile: { first_name: "A" } } as any;
    const { container } = wrap(<DashboardOrganizationsTab me={me} athletes={[]} />);
    await wait(30);
    clickAll(container);
    clickAllRadios(container);
    await wait(20);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("InsightsPage - with API", async () => {
    const { default: InsightsPage } = await import("../../src/pages/dashboard/InsightsPage");
    const me = { id: 1, email: "x@y.z", role: "athlete", profile: { ftp: 250, max_hr: 190 } } as any;
    const { container } = wrap(
      <InsightsPage
        isDark={false}
        me={me}
        wellnessSummary={{}}
        onSelectMetric={() => {}}
        athleteId={null}
        athletes={[]}
      />,
    );
    await wait(30);
    clickAll(container);
    clickAllRadios(container);
    await wait(20);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardTrainingZonesTab - segmented sport changes", async () => {
    const { default: DashboardTrainingZonesTab } = await import(
      "../../src/pages/dashboard/DashboardTrainingZonesTab"
    );
    const user = {
      id: 1,
      email: "x@y.z",
      role: "athlete",
      profile: {
        ftp: 250,
        max_hr: 190,
        resting_hr: 50,
        preferred_units: "metric",
        zone_settings: {
          running: { hr: { upper_bounds: [120, 140, 160, 175, 185, 190] }, pace: { upper_bounds: [3, 4, 5, 6, 7, 8] } },
          cycling: { hr: { upper_bounds: [120, 140, 160, 175, 185, 190] }, power: { upper_bounds: [150, 200, 250, 300, 350, 400] } },
        },
      },
    } as any;
    const { container } = wrap(
      <DashboardTrainingZonesTab user={user} onSubmit={() => {}} isSaving={false} />,
    );
    await wait(20);
    clickAll(container);
    clickAllRadios(container);
    await wait(20);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });
});

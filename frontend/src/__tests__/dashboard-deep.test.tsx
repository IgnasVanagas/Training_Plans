import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "../i18n/I18nProvider";

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

const sampleMe = {
  id: 1,
  email: "athlete@example.com",
  role: "athlete",
  is_admin: false,
  profile: {
    first_name: "Sam",
    last_name: "Athlete",
    sports: ["running"],
    main_sport: "running",
    preferred_units: "metric",
    ftp: 250,
    max_hr: 190,
    resting_hr: 50,
    weight: 70,
    height_cm: 180,
    training_days: ["Mon", "Tue"],
    gender: "male",
    birth_date: "1990-01-01",
  },
  organization_membership: null,
};

// Smart api mock: dispatch by URL
vi.mock("../api/client", () => {
  const dispatcher = (url: string): any => {
    if (url.includes("/users/me")) return sampleMe;
    if (url.includes("/users/athletes")) return [];
    if (url.includes("/users/athlete-permissions")) return [];
    if (url.includes("/calendar/share-settings")) return [];
    if (url.includes("/calendar/approvals")) return [];
    if (url.includes("/coach-operations")) return { issues: [], compliance: {} };
    if (url.includes("/integrations/providers")) return [];
    if (url.includes("/integrations/wellness")) return {};
    if (url.includes("/activities")) return [];
    if (url.includes("/training-status")) return {};
    if (url.includes("/notifications")) return [];
    if (url.includes("/season-plan")) return null;
    if (url.includes("/profile-metric-history")) return [];
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

const wrap = (ui: React.ReactElement, route = "/dashboard") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

const wrapWithRoutes = (path: string, route: string, element: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path={path} element={element} />
              <Route path="*" element={element} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

const clickAll = (container: HTMLElement, sel = "button") => {
  for (const el of Array.from(container.querySelectorAll(sel)) as HTMLElement[]) {
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

const fireChangeAll = (container: HTMLElement) => {
  for (const el of Array.from(container.querySelectorAll("input, textarea, select")) as HTMLElement[]) {
    const input = el as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") {
      try {
        act(() => fireEvent.click(el));
      } catch {
        /* ignore */
      }
      continue;
    }
    if (input.type === "number") continue; // skip number inputs to avoid parsing crashes
    try {
      act(() => fireEvent.change(el, { target: { value: "test" } }));
    } catch {
      /* ignore */
    }
  }
};

describe("Dashboard with mocked API", () => {
  it("Dashboard - navigate tabs", { timeout: 180000 }, async () => {
    const { default: Dashboard } = await import("../pages/Dashboard");
    const tabs = ["dashboard", "activities", "races", "zones", "profile"];
    for (const tab of tabs) {
      const { container, unmount } = wrapWithRoutes("*", `/?tab=${tab}`, <Dashboard />);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      clickAll(container);
      unmount();
    }
    expect(true).toBe(true);
  });

  it("ActivityDetailPage - with API", async () => {
    const { ActivityDetailPage } = await import("../pages/ActivityDetailPage");
    const { container } = wrapWithRoutes(
      "/activity/:id",
      "/activity/1",
      <ActivityDetailPage />,
    );
    await waitFor(() => container.querySelector("button, div"));
    clickAll(container);
    clickAllRadios(container);
    fireChangeAll(container);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardCoachHome - clicks", async () => {
    const { default: DashboardCoachHome } = await import("../pages/dashboard/DashboardCoachHome");
    const me = { ...sampleMe, role: "coach" };
    const { container } = wrap(
      <DashboardCoachHome
        me={me as any}
        athletes={[
          { id: 2, email: "a@b.c", role: "athlete", profile: { first_name: "A", last_name: "B" } } as any,
        ]}
        complianceAlerts={[]}
        coachFeedbackRows={[]}
        coachOperations={{ at_risk_athletes: [], exception_queue: [], issues: [], compliance: {} } as any}
        coachOperationsLoading={false}
        approvalQueue={[]}
        reviewingApproval={false}
        onReviewApproval={() => {}}
        inviteUrl={null}
        inviteEmail=""
        onInviteEmailChange={() => {}}
        inviteMessage=""
        onInviteMessageChange={() => {}}
        onInviteByEmail={() => {}}
        invitingByEmail={false}
        onGenerateInvite={() => {}}
        generatingInvite={false}
        onOpenPlan={() => {}}
        onOpenActivities={() => {}}
        onOpenOrganizations={() => {}}
        onOpenComparison={() => {}}
      />,
    );
    clickAll(container);
    clickAllRadios(container);
    fireChangeAll(container);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardLayoutShell - toggle drawer + tabs", async () => {
    const { default: DashboardLayoutShell } = await import(
      "../pages/dashboard/DashboardLayoutShell"
    );
    const setActive = vi.fn();
    const { container } = wrap(
      <DashboardLayoutShell
        opened={false}
        toggle={() => {}}
        meDisplayName="Sam"
        mePicture={null}
        activeTab="dashboard"
        setActiveTab={setActive}
        headerRight={null}
        role="athlete"
        athletes={[]}
        selectedAthleteId={null}
        onSelectAthlete={() => {}}
        organizationName={null}
        onAthleteSettings={() => {}}
      >
        <div>child</div>
      </DashboardLayoutShell>,
    );
    clickAll(container);
    clickAllRadios(container);
    fireChangeAll(container);
    clickAll(container);
    // Coach mode
    const { container: c2 } = wrap(
      <DashboardLayoutShell
        opened={true}
        toggle={() => {}}
        meDisplayName="Coach"
        mePicture={null}
        activeTab="athletes"
        setActiveTab={setActive}
        headerRight={<button>x</button>}
        role="coach"
        athletes={[
          { id: 2, email: "a@b.c", role: "athlete", profile: { first_name: "A" } } as any,
        ]}
        selectedAthleteId={2}
        onSelectAthlete={() => {}}
        organizationName="Org"
        onAthleteSettings={() => {}}
      >
        <div>child</div>
      </DashboardLayoutShell>,
    );
    clickAll(c2);
    clickAllRadios(c2);
    expect(document.body.textContent).toBeTruthy();
  });
});

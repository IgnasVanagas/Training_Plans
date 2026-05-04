import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Dashboard from "../../src/pages/Dashboard";

type MockUser = {
  id: number;
  email: string;
  role: "athlete" | "coach" | "admin";
  profile?: {
    first_name?: string | null;
    last_name?: string | null;
    picture?: string | null;
    week_start_day?: string | null;
    ftp?: number | null;
    resting_hr?: number | null;
    hrv_ms?: number | null;
  };
  organization_memberships?: Array<{
    status?: string;
    role?: string;
    is_admin?: boolean;
    organization?: { id: number; name?: string | null } | null;
  }>;
};

const { apiMock, integrationSyncState } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  integrationSyncState: {
    connectingProvider: null as string | null,
    disconnectingProvider: null as string | null,
    cancelingProvider: null as string | null,
    syncingProvider: null as string | null,
    syncStatus: null as unknown,
    connectIntegrationMutation: { mutate: vi.fn(), isPending: false },
    disconnectIntegrationMutation: { mutate: vi.fn(), isPending: false },
    syncIntegrationMutation: { mutate: vi.fn(), isPending: false },
    cancelSyncMutation: { mutate: vi.fn(), isPending: false },
  },
}));

let currentMe: MockUser;
let currentAthletes: MockUser[];

vi.mock("../../src/api/client", () => ({
  default: apiMock,
}));

vi.mock("../../src/api/calendarCollaboration", () => ({
  getCalendarApprovals: vi.fn(async () => []),
  getCalendarShareSettings: vi.fn(async () => []),
  reviewCalendarApproval: vi.fn(async () => ({})),
  updateCalendarShareSettings: vi.fn(async () => ({})),
}));

vi.mock("../../src/api/coachOperations", () => ({
  getCoachOperations: vi.fn(async () => ({
    pendingInvites: 0,
    pendingApprovals: 0,
    unreadMessages: 0,
    pendingOrganizationRequests: 0,
  })),
}));

vi.mock("../../src/api/integrations", () => ({
  listIntegrationProviders: vi.fn(async () => []),
  getWellnessSummary: vi.fn(async () => ({
    resting_hr: null,
    hrv: null,
    sleep: null,
    stress: null,
  })),
  logManualWellness: vi.fn(async () => ({ updated: { hrv_daily: 1, rhr_daily: 0, sleep_sessions: 0, stress_daily: 0 } })),
}));

vi.mock("../../src/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

vi.mock("../../src/pages/dashboard/useIntegrationSync", () => ({
  useIntegrationSync: () => integrationSyncState,
}));

vi.mock("../../src/components/DualCalendarView", () => ({
  default: () => <div data-testid="dual-calendar-view">Dual Calendar View</div>,
}));

vi.mock("../../src/components/ActivitiesView", () => ({
  ActivitiesView: () => <div data-testid="activities-view">Activities View</div>,
}));

vi.mock("../../src/components/TrainingCalendar", () => ({
  TrainingCalendar: () => <div data-testid="training-calendar">Training Calendar</div>,
}));

vi.mock("../../src/components/library/WorkoutLibrary", () => ({
  WorkoutLibrary: () => <div data-testid="workout-library">Workout Library</div>,
}));

vi.mock("../../src/components/planner/SeasonPlannerDrawer", () => ({
  default: ({ inline }: { inline?: boolean }) => (
    <div data-testid={inline ? "season-planner-inline" : "season-planner-modal"}>Season Planner</div>
  ),
}));

vi.mock("../../src/components/dashboard/MetricHistoryModal", () => ({
  MetricHistoryModal: () => <div data-testid="metric-history-modal">Metric History Modal</div>,
}));

vi.mock("../../src/components/dashboard/ActivityUploadPanel", () => ({
  default: () => <div data-testid="activity-upload-panel">Activity Upload Panel</div>,
}));

vi.mock("../../src/components/common/SupportContactButton", () => ({
  default: () => <button type="button">Support</button>,
}));

vi.mock("../../src/pages/dashboard/DashboardAthleteHome", () => ({
  default: () => <div data-testid="dashboard-athlete-home">Athlete Home</div>,
}));

vi.mock("../../src/pages/dashboard/InsightsPage", () => ({
  default: () => <div data-testid="insights-page">Insights</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardCoachHome", () => ({
  default: () => <div data-testid="dashboard-coach-home">Coach Home</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardCoachAthletesPage", () => ({
  default: () => <div data-testid="dashboard-coach-athletes-page">Coach Athletes</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardLayoutShell", () => ({
  default: ({ activeTab, children }: { activeTab: string; children: React.ReactNode }) => (
    <div>
      <div data-testid="active-tab">{activeTab}</div>
      {children}
    </div>
  ),
}));

vi.mock("../../src/pages/dashboard/DashboardNotificationsTab", () => ({
  default: () => <div data-testid="dashboard-notifications-tab">Notifications</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardOrganizationsTab", () => ({
  default: () => <div data-testid="dashboard-organizations-tab">Organizations</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardRacesRecordsTab", () => ({
  default: () => <div data-testid="dashboard-races-records-tab">Races</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardAthleteProfileTab", () => ({
  default: () => <div data-testid="dashboard-athlete-profile-tab">Profile</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardTrainingZonesTab", () => ({
  default: () => <div data-testid="dashboard-training-zones-tab">Training Zones</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardActivityTrackersTab", () => ({
  default: () => <div data-testid="dashboard-activity-trackers-tab">Trackers</div>,
}));

vi.mock("../../src/pages/dashboard/DashboardSettingsTab", () => ({
  default: () => <div data-testid="dashboard-settings-tab">Settings</div>,
}));

vi.mock("../../src/pages/dashboard/AdminPanel", () => ({
  default: ({ activeTab }: { activeTab: string }) => <div data-testid="admin-panel">{activeTab}</div>,
}));

vi.mock("../../src/components/CoachComparisonPanel", () => ({
  CoachComparisonPanel: () => <div data-testid="coach-comparison-panel">Comparison</div>,
}));

const buildQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderDashboard = (initialEntry = "/dashboard") =>
  render(
    <MantineProvider>
      <QueryClientProvider client={buildQueryClient()}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    currentMe = {
      id: 7,
      email: "athlete@example.com",
      role: "athlete",
      profile: {
        first_name: "Asta",
        last_name: "Runner",
        week_start_day: "monday",
      },
      organization_memberships: [],
    };
    currentAthletes = [];

    apiMock.get.mockImplementation(async (url: string) => {
      if (url === "/users/me") return { data: currentMe };
      if (url === "/users/athletes") return { data: currentAthletes };
      if (url === "/users/athlete-permissions") return { data: [] };
      if (url.startsWith("/calendar/?")) return { data: [] };
      if (url === "/activities/") return { data: [] };
      if (url === "/activities/training-status") return { data: null };
      if (url === "/activities/training-status-history") return { data: [] };
      if (url === "/communications/notifications") return { data: { items: [] } };
      throw new Error(`Unexpected GET ${url}`);
    });

    apiMock.post.mockResolvedValue({ data: { invite_url: "https://example.com/invite", message: "ok", status: "accepted" } });
    apiMock.put.mockResolvedValue({ data: currentMe });
  });

  it("defaults athletes to the plan tab when no explicit tab is present", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("active-tab")).toHaveTextContent("plan");
    });
    expect(screen.getByTestId("training-calendar")).toBeInTheDocument();
  });

  it("defaults admins to the admin health tab", async () => {
    currentMe = {
      ...currentMe,
      role: "admin",
      email: "admin@example.com",
    };

    renderDashboard();

    await waitFor(() => {
      expect(screen.getByTestId("active-tab")).toHaveTextContent("admin-health");
    });
    expect(screen.getByTestId("admin-panel")).toHaveTextContent("admin-health");
  });

  it("renders requested coach tabs from the URL", async () => {
    currentMe = {
      ...currentMe,
      role: "coach",
      email: "coach@example.com",
      organization_memberships: [
        {
          status: "active",
          role: "coach",
          is_admin: true,
          organization: { id: 12, name: "Hill Squad" },
        },
      ],
    };
    currentAthletes = [
      {
        id: 21,
        email: "athlete.one@example.com",
        role: "athlete",
        profile: { first_name: "One", last_name: "Athlete" },
      },
    ];

    const cases = [
      { entry: "/dashboard?tab=activities", testId: "activities-view" },
      { entry: "/dashboard?tab=athletes", testId: "dashboard-coach-athletes-page" },
      { entry: "/dashboard?tab=organizations", testId: "dashboard-organizations-tab" },
      { entry: "/dashboard?tab=notifications", testId: "dashboard-notifications-tab" },
      { entry: "/dashboard?tab=settings", testId: "dashboard-settings-tab" },
      { entry: "/dashboard?tab=comparison", testId: "coach-comparison-panel" },
      { entry: "/dashboard?tab=trackers", testId: "dashboard-activity-trackers-tab" },
      { entry: "/dashboard?tab=macrocycle", testId: "season-planner-inline" },
      { entry: "/dashboard?tab=races", testId: "dashboard-races-records-tab" },
      { entry: "/dashboard?tab=insights", testId: "insights-page" },
    ];

    for (const testCase of cases) {
      const { unmount } = renderDashboard(testCase.entry);

      expect(await screen.findByTestId(testCase.testId)).toBeInTheDocument();

      unmount();
    }
  });

  it("renders athlete profile and zones tabs from the URL", async () => {
    const cases = [
      { entry: "/dashboard?tab=profile", testId: "dashboard-athlete-profile-tab" },
      { entry: "/dashboard?tab=zones", testId: "dashboard-training-zones-tab" },
    ];

    for (const testCase of cases) {
      const { unmount } = renderDashboard(testCase.entry);

      expect(await screen.findByTestId(testCase.testId)).toBeInTheDocument();

      unmount();
    }
  });
});
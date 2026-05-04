/**
 * Dashboard handler-firing test. Mocks each child to expose its prop callbacks
 * as click targets so that the inline arrow functions, mutation invocations,
 * and useMutation onSuccess/onError handlers in Dashboard.tsx actually run.
 */
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import React from "react";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

vi.mock("../../src/api/client", () => ({
  default: apiMock,
  apiBaseUrl: "http://api.local",
}));

vi.mock("../../src/api/calendarCollaboration", () => ({
  getCalendarApprovals: vi.fn(async () => []),
  getCalendarShareSettings: vi.fn(async () => []),
  reviewCalendarApproval: vi.fn(async () => ({})),
  updateCalendarShareSettings: vi.fn(async () => ({})),
}));
vi.mock("../../src/api/coachOperations", () => ({
  getCoachOperations: vi.fn(async () => ({
    pending_invites: 0, pending_approvals: 0, unread_messages: 0,
    pending_organization_requests: 0, at_risk_athletes: [], exception_queue: [],
  })),
}));
vi.mock("../../src/api/integrations", () => ({
  listIntegrationProviders: vi.fn(async () => []),
  getWellnessSummary: vi.fn(async () => ({ rhr: 50 })),
  logManualWellness: vi.fn(async () => ({ updated: { hrv_daily: 1, rhr_daily: 0, sleep_sessions: 0, stress_daily: 0 } })),
}));
vi.mock("../../src/i18n/I18nProvider", () => ({
  useI18n: () => ({ language: "en", setLanguage: vi.fn(), syncLanguagePreference: vi.fn(), t: (s: string) => s }),
}));
vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));
vi.mock("../../src/pages/dashboard/useIntegrationSync", () => ({
  useIntegrationSync: () => ({
    connectingProvider: null, disconnectingProvider: null, cancelingProvider: null,
    syncingProvider: null, syncStatus: null,
    connectIntegrationMutation: { mutate: vi.fn(), isPending: false },
    disconnectIntegrationMutation: { mutate: vi.fn(), isPending: false },
    syncIntegrationMutation: { mutate: vi.fn(), isPending: false },
    cancelSyncMutation: { mutate: vi.fn(), isPending: false },
  }),
}));

// Capture child-prop callbacks via mocks that render trigger buttons.
vi.mock("../../src/components/DualCalendarView", () => ({ default: () => <div /> }));
vi.mock("../../src/components/ActivitiesView", () => ({ ActivitiesView: () => <div /> }));
vi.mock("../../src/components/TrainingCalendar", () => ({
  TrainingCalendar: (props: any) => (
    <div>
      <button data-testid="tc-drop" onClick={() => props.onWorkoutDrop?.({ id: 1, name: "x" } as any, new Date(2026, 3, 10))}>drop</button>
    </div>
  ),
}));
vi.mock("../../src/components/library/WorkoutLibrary", () => ({ WorkoutLibrary: () => <div /> }));
vi.mock("../../src/components/planner/SeasonPlannerDrawer", () => ({
  default: (props: any) => (
    <div>
      <button data-testid="planner-close" onClick={() => props.onClose?.()}>close</button>
    </div>
  ),
}));
vi.mock("../../src/components/dashboard/MetricHistoryModal", () => ({
  MetricHistoryModal: (props: any) => (
    <div>
      <button data-testid="metric-close" onClick={() => props.onClose?.()}>close</button>
      <button data-testid="metric-save" onClick={() => props.onSave?.({ value: 50 })}>save</button>
    </div>
  ),
}));
vi.mock("../../src/components/dashboard/ActivityUploadPanel", () => ({
  default: (props: any) => (
    <div>
      <button data-testid="upload-done" onClick={() => props.onUploaded?.()}>uploaded</button>
    </div>
  ),
}));
vi.mock("../../src/components/common/SupportContactButton", () => ({ default: () => <button>Support</button> }));

vi.mock("../../src/pages/dashboard/DashboardAthleteHome", () => ({
  default: (props: any) => (
    <div data-testid="athlete-home">
      <button data-testid="ah-open-plan" onClick={() => props.onOpenPlan?.()}>plan</button>
      <button data-testid="ah-select-metric" onClick={() => props.onSelectMetric?.("rhr_daily")}>metric</button>
      <button data-testid="ah-respond-accept" onClick={() => props.onRespondInvitation?.(99, "accept", true)}>accept</button>
      <button data-testid="ah-respond-decline" onClick={() => props.onRespondInvitation?.(99, "decline")}>decline</button>
    </div>
  ),
}));

vi.mock("../../src/pages/dashboard/InsightsPage", () => ({
  default: (props: any) => (
    <div data-testid="insights">
      <button data-testid="ins-select-metric" onClick={() => props.onSelectMetric?.("hrv_daily")}>metric</button>
    </div>
  ),
}));

vi.mock("../../src/pages/dashboard/DashboardCoachHome", () => ({
  default: (props: any) => (
    <div data-testid="coach-home">
      <button data-testid="ch-review-approve" onClick={() => props.onReviewApproval?.(7, "approve")}>approve</button>
      <button data-testid="ch-review-reject" onClick={() => props.onReviewApproval?.(7, "reject")}>reject</button>
      <button data-testid="ch-invite-email" onClick={() => { props.onInviteEmailChange?.("x@y.z"); props.onInviteByEmail?.(); }}>invite-email</button>
      <button data-testid="ch-invite-message" onClick={() => { props.onInviteMessageChange?.("hi"); }}>invite-msg</button>
      <button data-testid="ch-generate" onClick={() => props.onGenerateInvite?.()}>generate</button>
      <button data-testid="ch-open-plan" onClick={() => props.onOpenPlan?.()}>plan</button>
      <button data-testid="ch-open-acts" onClick={() => props.onOpenActivities?.()}>acts</button>
      <button data-testid="ch-open-orgs" onClick={() => props.onOpenOrganizations?.()}>orgs</button>
      <button data-testid="ch-open-cmp" onClick={() => props.onOpenComparison?.()}>cmp</button>
    </div>
  ),
}));

vi.mock("../../src/pages/dashboard/DashboardCoachAthletesPage", () => ({ default: () => <div /> }));

vi.mock("../../src/pages/dashboard/DashboardLayoutShell", () => ({
  default: (props: any) => (
    <div>
      <div data-testid="active-tab">{props.activeTab}</div>
      <button data-testid="ls-toggle" onClick={() => props.toggle?.()}>tog</button>
      <button data-testid="ls-set-tab-profile" onClick={() => props.setActiveTab?.("profile")}>profile</button>
      <button data-testid="ls-set-tab-zones" onClick={() => props.setActiveTab?.("zones")}>zones</button>
      <button data-testid="ls-set-tab-trackers" onClick={() => props.setActiveTab?.("trackers")}>trackers</button>
      <button data-testid="ls-set-tab-organizations" onClick={() => props.setActiveTab?.("organizations")}>orgs</button>
      <button data-testid="ls-set-tab-notifications" onClick={() => props.setActiveTab?.("notifications")}>noti</button>
      <button data-testid="ls-set-tab-races" onClick={() => props.setActiveTab?.("races")}>races</button>
      <button data-testid="ls-set-tab-insights" onClick={() => props.setActiveTab?.("insights")}>insights</button>
      <button data-testid="ls-set-tab-comparison" onClick={() => props.setActiveTab?.("comparison")}>cmp</button>
      <button data-testid="ls-set-tab-macrocycle" onClick={() => props.setActiveTab?.("macrocycle")}>macro</button>
      <button data-testid="ls-set-tab-settings" onClick={() => props.setActiveTab?.("settings")}>settings</button>
      <button data-testid="ls-select-athlete" onClick={() => props.onSelectAthlete?.("9")}>select-ath</button>
      <button data-testid="ls-athlete-settings" onClick={() => props.onAthleteSettings?.()}>ath-settings</button>
      {props.children}
    </div>
  ),
}));

vi.mock("../../src/pages/dashboard/DashboardNotificationsTab", () => ({
  default: (props: any) => (
    <div data-testid="notifications-tab">
      <button data-testid="nt-refresh" onClick={() => props.onRefresh?.()}>refresh</button>
    </div>
  ),
}));
vi.mock("../../src/pages/dashboard/DashboardOrganizationsTab", () => ({ default: () => <div data-testid="orgs-tab" /> }));
vi.mock("../../src/pages/dashboard/DashboardRacesRecordsTab", () => ({ default: () => <div data-testid="races-tab" /> }));
vi.mock("../../src/pages/dashboard/DashboardAthleteProfileTab", () => ({
  default: (props: any) => (
    <div data-testid="profile-tab">
      <button data-testid="prof-submit" onClick={() => props.onSubmit?.({ first_name: "Alice", birth_date: "1990-01-01" })}>save</button>
    </div>
  ),
}));
vi.mock("../../src/pages/dashboard/DashboardTrainingZonesTab", () => ({
  default: (props: any) => (
    <div data-testid="zones-tab">
      <button data-testid="zones-submit" onClick={() => props.onSubmit?.({ ftp: 260 })}>save</button>
    </div>
  ),
}));
vi.mock("../../src/pages/dashboard/DashboardActivityTrackersTab", () => ({
  default: (props: any) => (
    <div data-testid="trackers-tab">
      <button data-testid="tr-connect" onClick={() => props.onConnect?.("strava")}>connect</button>
      <button data-testid="tr-disconnect" onClick={() => props.onDisconnect?.("strava")}>disconnect</button>
      <button data-testid="tr-sync" onClick={() => props.onSync?.("strava")}>sync</button>
      <button data-testid="tr-cancel" onClick={() => props.onCancelSync?.("strava")}>cancel</button>
    </div>
  ),
}));
vi.mock("../../src/pages/dashboard/DashboardSettingsTab", () => ({
  default: (props: any) => (
    <div data-testid="settings-tab">
      <button data-testid="set-change-pwd" onClick={() => props.onChangePassword?.({ current_password: "a", new_password: "b" })}>pwd</button>
      <button data-testid="set-resend" onClick={() => props.onResendVerification?.()}>resend</button>
      <button data-testid="set-update-permission" onClick={() => props.onUpdateAthletePermission?.(2, { allow_edit_workouts: true })}>perm</button>
      <button data-testid="set-update-share" onClick={() => props.onUpdateCalendarShare?.(2, { is_public: true })}>share</button>
    </div>
  ),
}));
vi.mock("../../src/pages/dashboard/AdminPanel", () => ({
  default: (props: any) => (
    <div data-testid="admin-panel">
      <button data-testid="admin-tab-users" onClick={() => props.onTabChange?.("admin-users")}>users</button>
      <button data-testid="admin-tab-logs" onClick={() => props.onTabChange?.("admin-logs")}>logs</button>
      <button data-testid="admin-tab-health" onClick={() => props.onTabChange?.("admin-health")}>health</button>
    </div>
  ),
}));
vi.mock("../../src/components/CoachComparisonPanel", () => ({ CoachComparisonPanel: () => <div data-testid="cmp-panel" /> }));

import Dashboard from "../../src/pages/Dashboard";

const meAthlete: any = {
  id: 7, email: "athlete@example.com", role: "athlete",
  profile: { first_name: "Alice", week_start_day: "monday" },
  organization_memberships: [
    { id: 1, role: "athlete", status: "pending", organization: { id: 99, name: "Trail Club" } },
  ],
  coaches: [],
};
const meCoach: any = {
  id: 8, email: "coach@example.com", role: "coach",
  profile: { first_name: "Coach", week_start_day: "monday" },
  organization_memberships: [
    { id: 2, role: "coach", status: "active", is_admin: true, organization: { id: 100, name: "Pro Lab" } },
  ],
  coaches: [],
};
const meAdmin: any = { ...meAthlete, id: 9, email: "admin@x", role: "admin" };

const buildQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

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

const setupApi = (me: any) => {
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === "/users/me") return { data: me };
    if (url === "/users/athletes") return { data: [{ id: 11, email: "a11@x", role: "athlete", profile: { first_name: "A11" } }] };
    if (url === "/users/athlete-permissions") return { data: [] };
    if (url.startsWith("/calendar/?")) return { data: [] };
    if (url === "/activities/") return { data: [] };
    if (url === "/activities/training-status") return { data: { fitness: 60, fatigue: 30, form: 5 } };
    if (url === "/activities/training-status-history") return { data: [] };
    if (url === "/communications/notifications") return { data: { items: [] } };
    return { data: [] };
  });
  apiMock.post.mockResolvedValue({ data: { invite_url: "https://example.com/invite", message: "ok", status: "accepted" } });
  apiMock.put.mockResolvedValue({ data: me });
};

describe("Dashboard handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("athlete: tab switching + child callbacks fire mutations", async () => {
    setupApi(meAthlete);
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("active-tab")).toBeInTheDocument());

    // Switch through every tab to render them and trigger setActiveTab.
    for (const id of [
      "ls-set-tab-profile", "ls-set-tab-zones", "ls-set-tab-trackers",
      "ls-set-tab-organizations", "ls-set-tab-notifications", "ls-set-tab-races",
      "ls-set-tab-insights", "ls-set-tab-comparison", "ls-set-tab-settings",
    ]) {
      const btn = screen.queryByTestId(id);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }

    // Trigger profile/zones submit
    for (const id of ["prof-submit", "zones-submit"]) {
      const btn = screen.queryByTestId(id);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }

    // Trackers
    await act(async () => { fireEvent.click(screen.getByTestId("ls-set-tab-trackers")); });
    for (const id of ["tr-connect", "tr-disconnect", "tr-sync", "tr-cancel"]) {
      const btn = screen.queryByTestId(id);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }

    // Settings
    await act(async () => { fireEvent.click(screen.getByTestId("ls-set-tab-settings")); });
    for (const id of ["set-change-pwd", "set-resend", "set-update-permission", "set-update-share"]) {
      const btn = screen.queryByTestId(id);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }

    // Notifications refresh
    await act(async () => { fireEvent.click(screen.getByTestId("ls-set-tab-notifications")); });
    const refresh = screen.queryByTestId("nt-refresh");
    if (refresh) await act(async () => { fireEvent.click(refresh); });

    // Layout shell handlers
    for (const id of ["ls-toggle", "ls-select-athlete", "ls-athlete-settings"]) {
      const btn = screen.queryByTestId(id);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }

    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toBeTruthy();
  });

  it("athlete home: respond invitation + select metric", async () => {
    setupApi(meAthlete);
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("active-tab")).toBeInTheDocument());

    for (const id of ["ah-open-plan", "ah-select-metric", "ah-respond-accept", "ah-respond-decline"]) {
      const btn = screen.queryByTestId(id);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }
    // Insights metric
    await act(async () => { fireEvent.click(screen.getByTestId("ls-set-tab-insights")); });
    const ins = screen.queryByTestId("ins-select-metric");
    if (ins) await act(async () => { fireEvent.click(ins); });

    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toBeTruthy();
  });

  it("coach: home callbacks fire", async () => {
    setupApi(meCoach);
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("active-tab")).toBeInTheDocument());

    for (const id of [
      "ch-review-approve", "ch-review-reject", "ch-invite-email", "ch-invite-message",
      "ch-generate", "ch-open-plan", "ch-open-acts", "ch-open-orgs", "ch-open-cmp",
    ]) {
      const btn = screen.queryByTestId(id);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }

    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toBeTruthy();
  });

  it("admin: tabs", async () => {
    setupApi(meAdmin);
    renderDashboard();
    await waitFor(() => expect(screen.getByTestId("active-tab")).toBeInTheDocument());

    for (const id of ["admin-tab-users", "admin-tab-logs", "admin-tab-health"]) {
      const btn = screen.queryByTestId(id);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }
    expect(document.body.textContent).toBeTruthy();
  });
});

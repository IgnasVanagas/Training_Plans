import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import DashboardCoachHome from "../../../src/pages/dashboard/DashboardCoachHome";
import DashboardSettingsTab from "../../../src/pages/dashboard/DashboardSettingsTab";
import DashboardRacesRecordsTab from "../../../src/pages/dashboard/DashboardRacesRecordsTab";
import DashboardCoachAthletesPage from "../../../src/pages/dashboard/DashboardCoachAthletesPage";
import DashboardAthleteProfileTab from "../../../src/pages/dashboard/DashboardAthleteProfileTab";
import DashboardTrainingZonesTab from "../../../src/pages/dashboard/DashboardTrainingZonesTab";
import AdminPanel from "../../../src/pages/dashboard/AdminPanel";
import InsightsPage from "../../../src/pages/dashboard/InsightsPage";
import type { User } from "../../../src/pages/dashboard/types";

vi.mock("../../../src/api/client", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { items: [], events: [], data: [] } }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));
vi.mock("../../../src/api/admin", () => ({
  getAdminUsers: vi.fn().mockResolvedValue({ items: [] }),
  getAdminAuditLogs: vi.fn().mockResolvedValue({ items: [] }),
  getAdminStats: vi.fn().mockResolvedValue({}),
  changeUserRole: vi.fn(),
  resetAthletePassword: vi.fn(),
  updateAthleteIdentity: vi.fn(),
}));
vi.mock("../../../src/api/activities", () => ({
  getPersonalRecords: vi.fn().mockResolvedValue({ time: {}, distance: {} }),
}));
vi.mock("../../../src/api/planning", () => ({
  getLatestSeasonPlan: vi.fn().mockResolvedValue({ goal_races: [] }),
}));
vi.mock("../../../src/api/organizations", () => ({
  resolveUserPictureUrl: (v: unknown) => (typeof v === "string" ? v : null),
  uploadProfilePicture: vi.fn(),
}));
vi.mock("../../../src/api/calendarCollaboration", () => ({
  buildPublicCalendarShareUrl: () => "http://x",
  buildPublicCalendarIcsUrl: () => "http://x",
}));

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

const meCoach: User = { id: 1, email: "c@x.com", role: "coach", profile: { main_sport: "running" } };
const meAthlete: User = { id: 2, email: "a@x.com", role: "athlete", profile: { main_sport: "running" } };
const meAdmin: User = { id: 9, email: "ad@x.com", role: "admin" };

const athlete1: User = {
  id: 10,
  email: "ath1@x.com",
  role: "athlete",
  profile: { first_name: "Ath", last_name: "One", main_sport: "running" },
};

describe("dashboard pages smoke", () => {
  it("renders DashboardCoachHome", () => {
    wrap(
      <DashboardCoachHome
        me={meCoach}
        athletes={[athlete1]}
        complianceAlerts={[
          { id: 1, user_id: 10, title: "Run", date: "2026-05-01", compliance_status: "missed", is_planned: true },
        ] as any}
        coachFeedbackRows={[{ id: 1, athlete_id: 10, created_at: "2026-05-01", filename: "f.fit" } as any]}
        coachOperations={{
          athletes: [],
          at_risk_athletes: [{ athlete_id: 10, athlete_name: "Ath One", reasons: ["activity_gap_8d"] }],
          exception_queue: [{ athlete_id: 10, athlete_name: "Ath One", risk_level: "high", exception_reasons: ["missed_compliance_recent"], date: "2026-05-01" }],
        } as any}
        coachOperationsLoading={false}
        approvalQueue={[
          { workout_id: 5, athlete_id: 10, athlete_name: "Ath One", title: "Tempo", date: "2026-05-02", request_type: "create", requested_by_user_id: 10, requested_at: "2026-05-01" } as any,
        ]}
        reviewingApproval={false}
        onReviewApproval={() => {}}
        inviteUrl="http://invite/x"
        inviteEmail="x@y.com"
        onInviteEmailChange={() => {}}
        inviteMessage="Hi"
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
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DashboardSettingsTab for coach and athlete", () => {
    wrap(
      <DashboardSettingsTab
        me={meCoach}
        athletes={[athlete1]}
        permissionsRows={[
          {
            athlete_id: 10,
            permissions: {
              allow_delete_activities: true,
              allow_delete_workouts: false,
              allow_edit_workouts: true,
              allow_export_calendar: true,
              allow_public_calendar_share: false,
              require_workout_approval: false,
            },
          },
        ]}
        shareSettingsRows={[
          { athlete_id: 10, enabled: true, token: "tok", include_completed: true, include_descriptions: false },
        ]}
        isSavingProfile={false}
        onSaveProfile={() => {}}
        requestingEmailConfirmation={false}
        changingPassword={false}
        onRequestEmailConfirmation={() => {}}
        onChangePassword={() => {}}
        onUpdateAthletePermission={() => {}}
        onUpdateCalendarShare={() => {}}
        savingAthleteProfileId={null}
        onSaveAthleteProfile={() => {}}
      />,
    );
    wrap(
      <DashboardSettingsTab
        me={meAthlete}
        athletes={[]}
        permissionsRows={[]}
        shareSettingsRows={[]}
        isSavingProfile={false}
        onSaveProfile={() => {}}
        requestingEmailConfirmation={false}
        changingPassword={false}
        onRequestEmailConfirmation={() => {}}
        onChangePassword={() => {}}
        onUpdateAthletePermission={() => {}}
        onUpdateCalendarShare={() => {}}
        savingAthleteProfileId={null}
        onSaveAthleteProfile={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DashboardRacesRecordsTab", () => {
    wrap(<DashboardRacesRecordsTab me={meAthlete} athleteId={null} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DashboardCoachAthletesPage", () => {
    wrap(
      <DashboardCoachAthletesPage
        me={meCoach}
        athletes={[athlete1]}
        onOpenAthleteSettings={() => {}}
        onOpenAthleteCalendar={() => {}}
        onOpenAthleteMessages={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DashboardAthleteProfileTab", () => {
    wrap(
      <DashboardAthleteProfileTab
        user={meAthlete}
        onSubmit={() => {}}
        isSaving={false}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DashboardTrainingZonesTab", () => {
    wrap(
      <DashboardTrainingZonesTab
        user={{ ...meAthlete, profile: { ...meAthlete.profile, zone_settings: null } }}
        onSubmit={() => {}}
        isSaving={false}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders AdminPanel", () => {
    wrap(<AdminPanel />);
    wrap(<AdminPanel activeTab="admin-logs" onTabChange={() => {}} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders InsightsPage", () => {
    wrap(
      <InsightsPage
        isDark={false}
        me={meAthlete}
        wellnessSummary={null}
        onSelectMetric={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

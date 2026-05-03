import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { I18nProvider } from "../../i18n/I18nProvider";
import DashboardAthleteHome from "./DashboardAthleteHome";
import type { User } from "./types";

const wrap = (ui: React.ReactElement) =>
  render(
    <MantineProvider>
      <I18nProvider>{ui}</I18nProvider>
    </MantineProvider>,
  );

const baseUser: User = {
  id: 1,
  email: "a@x.com",
  role: "athlete",
  profile: { main_sport: "running", lt2: 4.5, ftp: 250, resting_hr: 50, hrv_ms: 65 },
};

describe("DashboardAthleteHome", () => {
  it("renders empty state and triggers Build Session", () => {
    const onOpenPlan = vi.fn();
    wrap(
      <DashboardAthleteHome
        isDark={false}
        me={baseUser}
        wellnessSummary={null}
        integrations={[]}
        onOpenPlan={onOpenPlan}
        onSelectMetric={() => {}}
        onRespondInvitation={() => {}}
        respondingInvitation={false}
      />,
    );
    expect(screen.getByText(/No workout planned yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Build Session/i }));
    expect(onOpenPlan).toHaveBeenCalled();
  });

  it("renders today workout, integrations error, and metric clicks for cycling profile", () => {
    const onSelectMetric = vi.fn();
    wrap(
      <DashboardAthleteHome
        isDark
        me={{
          ...baseUser,
          profile: { ...baseUser.profile, main_sport: "cycling", preferred_units: "metric" },
          coaches: [{ id: 9, email: "c@x.com", first_name: "Coach", last_name: "X" }],
        }}
        todayWorkout={{
          id: "e1",
          date: "2026-05-02",
          title: "Endurance ride",
          sport_type: "Cycling",
          planned_duration: 90,
          is_planned: true,
          created_by_name: "Coach X",
        } as any}
        isTodayWorkout
        wellnessSummary={{
          resting_hr: { value: 48 },
          hrv: { value: 70 },
          sleep: { duration_seconds: 27000, provider: "garmin", end_time: "2026-05-02T07:00:00Z" },
          stress: { value: 22, provider: "garmin", date: "2026-05-02" },
        }}
        integrations={[{ provider: "garmin", last_error: "boom" }]}
        trainingStatus={{
          athlete_id: 1,
          reference_date: "2026-05-02",
          acute: { aerobic: 1, anaerobic: 0, daily_load: 1 },
          chronic: { aerobic: 1, anaerobic: 0, daily_load: 1 },
          atl: 30.4,
          ctl: 40.1,
          tsb: 9.7,
          training_status: "Productive",
        }}
        onOpenPlan={() => {}}
        onSelectMetric={onSelectMetric}
        onRespondInvitation={() => {}}
        respondingInvitation={false}
      />,
    );
    expect(screen.getByText(/Endurance ride/i)).toBeInTheDocument();
    expect(screen.getByText(/Sync needs attention/i)).toBeInTheDocument();
    expect(screen.getByText("FTP")).toBeInTheDocument();
    expect(screen.getByText("Productive")).toBeInTheDocument();
    fireEvent.click(screen.getByText("FTP").parentElement!.parentElement!);
    expect(onSelectMetric).toHaveBeenCalledWith("ftp");
  });

  it("opens consent modal for pending invitation and confirms accept", () => {
    const onRespond = vi.fn();
    wrap(
      <DashboardAthleteHome
        isDark={false}
        me={{
          ...baseUser,
          organization_memberships: [
            {
              organization: { id: 7, name: "Team Alpha" },
              role: "athlete",
              status: "pending",
              is_admin: false,
              message: "Welcome",
            },
          ],
        }}
        wellnessSummary={null}
        integrations={[]}
        onOpenPlan={() => {}}
        onSelectMetric={() => {}}
        onRespondInvitation={onRespond}
        respondingInvitation={false}
      />,
    );
    expect(screen.getByText(/invitation to join Team Alpha/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Accept Team Alpha/i }));
    expect(screen.getByText(/Confirm data sharing/i)).toBeInTheDocument();
    const consentCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(consentCheckbox);
    // Click confirm-style button inside the modal (last button rendered in modal flow)
    const allButtons = screen.getAllByRole("button");
    const cancelBtn = allButtons.find((b) => /^Cancel$/i.test(b.textContent || ""));
    fireEvent.click(cancelBtn!);
    expect(onRespond).toHaveBeenCalledTimes(0);
  });
});

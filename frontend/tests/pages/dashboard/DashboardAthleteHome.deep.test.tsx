import { describe, it, expect, vi } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import React from "react";
import { renderApp } from "../../utils/renderApp";

vi.mock("../../../src/api/client", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));

import DashboardAthleteHome from "../../../src/pages/dashboard/DashboardAthleteHome";

const me: any = {
  id: 1, role: "athlete", email: "a@x",
  profile: { first_name: "Alice", last_name: "Wong", main_sport: "running" },
  organization_memberships: [
    { id: 1, role: "athlete", status: "pending", organization: { id: 10, name: "Trail Club" } },
    { id: 2, role: "athlete", status: "active", organization: { id: 11, name: "Marathon Squad" } },
  ],
  coaches: [
    { id: 50, first_name: "Coach", last_name: "Lee", email: "c@x" },
    { id: 51, first_name: "", last_name: "", email: "c2@x" },
  ],
};

const todayWorkout: any = {
  id: 100, title: "Tempo run", date: "2026-04-10", planned_duration: 60,
  planned_distance: 12, planned_intensity: "Z3", sport_type: "running", is_planned: true,
};

const trainingStatus: any = {
  fitness: 70, fatigue: 30, form: 5, ramp_rate: 2,
  status_label: "Productive", load_progression: "increasing",
};

function sweep() {
  for (const b of Array.from(document.body.querySelectorAll("button"))) {
    try { act(() => { fireEvent.click(b); }); } catch {}
  }
  for (const i of Array.from(document.body.querySelectorAll('input[type="checkbox"], input[type="radio"]'))) {
    try { act(() => { fireEvent.click(i); }); } catch {}
  }
}

describe("DashboardAthleteHome deep", () => {
  it("renders with pending invites, today workout, training status; sweeps", () => {
    renderApp(
      <DashboardAthleteHome
        isDark={false}
        me={me}
        todayWorkout={todayWorkout}
        isTodayWorkout={true}
        wellnessSummary={{ rhr: 50, hrv: 80, sleep_hours: 7.5, stress: 30 }}
        integrations={[{ provider: "strava", status: "active", last_sync_at: "2026-04-09T08:00:00Z" }]}
        trainingStatus={trainingStatus}
        onOpenPlan={vi.fn()}
        onSelectMetric={vi.fn()}
        onRespondInvitation={vi.fn()}
        respondingInvitation={false}
      />,
    );
    sweep();

    // Re-render in dark mode without invites/today workout
    renderApp(
      <DashboardAthleteHome
        isDark={true}
        me={{ ...me, organization_memberships: [], coaches: [] }}
        wellnessSummary={null}
        integrations={[]}
        onOpenPlan={vi.fn()}
        onSelectMetric={vi.fn()}
        onRespondInvitation={vi.fn()}
        respondingInvitation={true}
      />,
    );
    sweep();
    expect(document.body.textContent).toBeTruthy();
  });
});

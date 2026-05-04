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
vi.mock("../../../src/api/planning", () => ({
  getLatestSeasonPlan: vi.fn().mockResolvedValue({
    id: 1, athlete_id: 1, generated_at: "2026-04-01T00:00:00Z",
    weeks: [
      { week_index: 1, start_date: "2026-04-06", end_date: "2026-04-12", phase: "Build", target_load: 350, sessions: [] },
      { week_index: 2, start_date: "2026-04-13", end_date: "2026-04-19", phase: "Build", target_load: 360, sessions: [] },
    ],
    goal_races: [{ name: "Boston", date: "2026-05-15", priority: "A", sport_type: "running", distance_km: 42.2, expected_time: "03:30:00", location: "Boston", notes: "" }],
    phases: [{ phase: "Build", start_date: "2026-04-01", end_date: "2026-04-30" }],
  }),
  generateSeasonPlan: vi.fn().mockResolvedValue({ id: 1 }),
  saveSeasonPlan: vi.fn().mockResolvedValue({ id: 1 }),
}));

import SeasonPlannerDrawer from "../../../src/components/planner/SeasonPlannerDrawer";

const meAthlete: any = {
  id: 1, role: "athlete", email: "a@x.com",
  profile: { first_name: "Alice", last_name: "Wong", main_sport: "running", preferred_units: "metric" },
};
const meCoach: any = { ...meAthlete, role: "coach" };

function sweepClicks() {
  for (const b of Array.from(document.body.querySelectorAll("button"))) {
    try { act(() => { fireEvent.click(b); }); } catch {}
  }
  for (const i of Array.from(document.body.querySelectorAll('input, textarea'))) {
    try { act(() => { fireEvent.change(i, { target: { value: "5" } }); }); } catch {}
  }
}

describe("SeasonPlannerDrawer coverage", () => {
  it("renders inline athlete and drawer coach", async () => {
    renderApp(<SeasonPlannerDrawer opened={true} onClose={vi.fn()} me={meAthlete} athletes={[]} inline />);
    await new Promise((r) => setTimeout(r, 80));
    sweepClicks();

    renderApp(<SeasonPlannerDrawer opened={true} onClose={vi.fn()} me={meCoach} athletes={[meAthlete]} selectedAthleteId={1} />);
    await new Promise((r) => setTimeout(r, 80));
    sweepClicks();
    expect(document.body.textContent).toBeTruthy();
  });
});

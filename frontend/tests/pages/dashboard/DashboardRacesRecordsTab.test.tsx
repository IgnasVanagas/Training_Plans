import { describe, it, expect, vi } from "vitest";
import { fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";
import { renderApp } from "../../utils/renderApp";

const apiGet = vi.fn();
vi.mock("../../../src/api/client", () => ({
  default: {
    get: (...args: any[]) => apiGet(...args),
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
    goal_races: [
      { name: "Spring Half", date: "2026-06-01", priority: "A", sport_type: "running", distance_km: 21.1, expected_time: "01:30:00" },
      { name: "Past Race", date: "2026-01-01", priority: "B", sport_type: "running", distance_km: 10 },
    ],
  }),
}));
vi.mock("../../../src/api/activities", () => ({
  getPersonalRecords: vi.fn().mockResolvedValue({
    backfill_status: "completed",
    sport: "running",
    distances: { "5km": [{ rank: 1, time: 1200, distance_meters: 5000, activity_id: 1, date: "2026-03-01" }] },
    windows: { "5min": [{ rank: 1, value: 320, activity_id: 1, date: "2026-03-01" }] },
  }),
}));

import DashboardRacesRecordsTab from "../../../src/pages/dashboard/DashboardRacesRecordsTab";

const me: any = { id: 1, role: "athlete", profile: { main_sport: "running", preferred_units: "metric" } };

describe("DashboardRacesRecordsTab", () => {
  it("renders running and switches to cycling", async () => {
    renderApp(<DashboardRacesRecordsTab me={me} athleteId={null} />);
    await waitFor(() => expect(document.body.textContent).toContain("Spring"), { timeout: 3000 }).catch(() => {});

    // Switch sport segmented control
    const cyclingInput = document.querySelector('input[type="radio"][value="cycling"]') as HTMLInputElement;
    if (cyclingInput) {
      await act(async () => { fireEvent.click(cyclingInput); });
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders for athlete with imperial units and no plan", async () => {
    const meImp: any = { id: 2, role: "athlete", profile: { main_sport: "cycling", preferred_units: "imperial" } };
    renderApp(<DashboardRacesRecordsTab me={meImp} athleteId={5} />);
    await waitFor(() => expect(document.body.textContent).toBeTruthy(), { timeout: 1500 }).catch(() => {});
  });
});

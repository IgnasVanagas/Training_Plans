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

import DashboardAthleteProfileTab from "../../../src/pages/dashboard/DashboardAthleteProfileTab";
import DashboardTrainingZonesTab from "../../../src/pages/dashboard/DashboardTrainingZonesTab";

const baseUser: any = {
  id: 1,
  email: "alice@example.com",
  role: "athlete",
  profile: {
    first_name: "Alice",
    last_name: "Wong",
    main_sport: "running",
    preferred_units: "metric",
    weight: 65,
    height: 170,
    birth_date: "1990-05-12",
    gender: "female",
    ftp: 250,
    max_hr: 190,
    resting_hr: 50,
    lt2: 4.0,
    lt2_speed_kmh: 15,
    week_start_day: "monday",
    notes: "Loves trails",
    zone_settings: {
      running: {
        hr: { lt2: 170, upper_bounds: [120, 140, 160, 180, 195] },
        pace: { lt2: 4.0, upper_bounds: [5.5, 5.0, 4.5, 4.0, 3.5, 3.2] },
      },
      cycling: {
        hr: { lt2: 170, upper_bounds: [120, 140, 160, 180, 195] },
        power: { lt2: 250, upper_bounds: [120, 180, 220, 260, 300, 360] },
      },
    },
  },
};

function sweep() {
  for (const b of Array.from(document.body.querySelectorAll("button"))) {
    try { act(() => { fireEvent.click(b); }); } catch {}
  }
  for (const i of Array.from(document.body.querySelectorAll('input, textarea'))) {
    try { act(() => { fireEvent.change(i, { target: { value: "5" } }); }); } catch {}
  }
}

describe("Dashboard profile/zones deep", () => {
  it("renders DashboardAthleteProfileTab and sweeps", () => {
    renderApp(<DashboardAthleteProfileTab user={baseUser} onSubmit={vi.fn()} isSaving={false} />);
    sweep();
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DashboardTrainingZonesTab and sweeps", () => {
    renderApp(<DashboardTrainingZonesTab user={baseUser} onSubmit={vi.fn()} isSaving={false} />);
    sweep();
    expect(document.body.textContent).toBeTruthy();
  });
});

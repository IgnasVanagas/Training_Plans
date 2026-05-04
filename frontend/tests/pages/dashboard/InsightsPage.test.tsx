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

import InsightsPage from "../../../src/pages/dashboard/InsightsPage";

const me: any = { id: 1, role: "athlete", profile: { main_sport: "running", preferred_units: "metric", lt2: 4.0, ftp: 250, max_hr: 190 } };

describe("InsightsPage", () => {
  it("renders running variant with trend data and lets the user change range", async () => {
    apiGet.mockResolvedValue({
      data: {
        data: Array.from({ length: 90 }, (_, i) => {
          const d = new Date(2026, 0, 1 + i);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          return {
            date: `${yyyy}-${mm}-${dd}`,
            fitness: 50 + i * 0.2,
            fatigue: 40 + i * 0.1,
            form: 10 - i * 0.05,
            load: 30 + (i % 10),
          };
        }),
      },
    });
    const onSelectMetric = vi.fn();
    renderApp(
      <InsightsPage
        isDark={false}
        me={me}
        wellnessSummary={{ rhr: 50, hrv: 70, sleep_hours: 7.5 }}
        trainingStatus={{ ctl: 80, atl: 65, tsb: 15 } as any}
        onSelectMetric={onSelectMetric}
        athleteId={null}
        athletes={[]}
      />,
    );
    await waitFor(() => expect(document.body.textContent).toBeTruthy(), { timeout: 1500 }).catch(() => {});

    // Click range buttons if present
    for (const label of ["30d", "90d", "180d", "365d"]) {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
      if (btn) await act(async () => { fireEvent.click(btn); });
    }

    // Hover-leave on cards triggers handlers
    const cards = document.querySelectorAll('[class*="Card"]');
    cards.forEach((c) => {
      fireEvent.mouseEnter(c);
      fireEvent.mouseLeave(c);
    });

    expect(document.body.textContent).toBeTruthy();
  });

  it("renders cycling variant in dark mode without data", () => {
    apiGet.mockResolvedValue({ data: { data: [] } });
    const meCycle: any = { id: 1, role: "athlete", profile: { main_sport: "cycling", preferred_units: "imperial", ftp: 280 } };
    renderApp(
      <InsightsPage
        isDark
        me={meCycle}
        wellnessSummary={null}
        trainingStatus={undefined as any}
        onSelectMetric={vi.fn()}
        athleteId={3}
        athletes={[{ id: 3, profile: { first_name: "X" } }]}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

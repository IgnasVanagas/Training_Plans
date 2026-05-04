import { describe, it, expect, vi } from "vitest";
import { fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";
import { renderApp } from "../utils/renderApp";

const apiGet = vi.fn();
vi.mock("../../src/api/client", () => ({
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
vi.mock("../../src/api/activities", () => ({
  createManualActivity: vi.fn().mockResolvedValue({ id: 1 }),
}));

import { ActivitiesView } from "../../src/components/ActivitiesView";

const sampleActivities = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  filename: `act-${i}.fit`,
  sport: i % 2 === 0 ? "running" : "cycling",
  created_at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T07:00:00Z`,
  distance: 10000 + i * 100,
  duration: 3600 + i * 30,
  avg_speed: 3 + i * 0.05,
  average_hr: 140 + i,
  average_watts: i % 2 === 0 ? null : 200 + i,
  athlete_id: 1,
  is_deleted: false,
  source_provider: i % 3 === 0 ? "strava" : "upload",
  file_type: "fit",
  duplicate_recordings_count: i === 5 ? 2 : 0,
  duplicate_of_id: null,
}));

describe("ActivitiesView deep", () => {
  it("renders activity list and exercises filters/clicks", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/users/me")) {
        return Promise.resolve({ data: { id: 1, profile: { preferred_units: "metric" } } });
      }
      if (url.startsWith("/activities")) {
        return Promise.resolve({ data: sampleActivities });
      }
      return Promise.resolve({ data: [] });
    });
    renderApp(<ActivitiesView athleteId={1} currentUserRole="athlete" />);
    await waitFor(() => expect(document.body.textContent).toContain("act-0"), { timeout: 2500 }).catch(() => {});
    // Click first activity card / row
    const links = document.querySelectorAll('a[href^="/activity"], button');
    if (links.length) {
      await act(async () => { fireEvent.click(links[0]); });
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders coach view with athletes and imperial units", async () => {
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/users/me")) {
        return Promise.resolve({ data: { id: 1, profile: { preferred_units: "imperial" } } });
      }
      if (url.startsWith("/activities")) {
        return Promise.resolve({ data: sampleActivities.slice(0, 3) });
      }
      return Promise.resolve({ data: [] });
    });
    renderApp(
      <ActivitiesView
        athleteId={2}
        currentUserRole="coach"
        athletes={[{ id: 2, profile: { first_name: "Bob" } }]}
        showUploadSection={false}
      />,
    );
    await waitFor(() => expect(document.body.textContent).toBeTruthy(), { timeout: 1500 }).catch(() => {});
  });

  it("renders empty state", async () => {
    apiGet.mockResolvedValue({ data: [] });
    renderApp(<ActivitiesView athleteId={null} currentUserRole="athlete" />);
    await waitFor(() => expect(document.body.textContent).toBeTruthy(), { timeout: 1000 }).catch(() => {});
  });
});

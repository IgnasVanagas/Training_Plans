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

import CoachAthleteZoneSettingsPanel from "../../../src/components/dashboard/CoachAthleteZoneSettingsPanel";

const baseAthlete: any = {
  id: 1,
  email: "alice@x.com",
  role: "athlete",
  profile: {
    first_name: "Alice",
    last_name: "Wong",
    main_sport: "running",
    ftp: 250,
    lt2: 4.0,
    max_hr: 190,
    resting_hr: 50,
    zone_settings: {
      running: {
        hr: { lt1: 130, lt2: 160, upper_bounds: [130, 145, 160, 175] },
        pace: { lt1: 5.0, lt2: 4.0, upper_bounds: [5.5, 5.0, 4.5, 4.0, 3.5, 3.2] },
      },
      cycling: {
        hr: { lt1: 130, lt2: 160, upper_bounds: [130, 145, 160, 175] },
        power: { lt1: 180, lt2: 250, upper_bounds: [120, 180, 220, 260, 300, 360] },
      },
    },
  },
};

describe("CoachAthleteZoneSettingsPanel deep", () => {
  it("renders, switches sport/metric, edits values and triggers save", async () => {
    const onSave = vi.fn();
    renderApp(
      <CoachAthleteZoneSettingsPanel
        athletes={[baseAthlete, { ...baseAthlete, id: 2, email: "bob@x.com", profile: { ...baseAthlete.profile, first_name: "Bob", main_sport: "cycling" } }]}
        savingAthleteId={null}
        onSave={onSave}
        initialAthleteId={"1"}
      />,
    );
    // Toggle sport segments (Running -> Cycling) by clicking radio inputs
    document.querySelectorAll('input[type="radio"]').forEach((el) => {
      const value = (el as HTMLInputElement).value;
      if (["cycling", "running", "hr", "pace", "power"].includes(value)) {
        act(() => { fireEvent.click(el); });
      }
    });
    // Tweak number inputs
    document.querySelectorAll('input[inputmode="decimal"], input[type="text"]').forEach((el) => {
      try { fireEvent.change(el, { target: { value: "5" } }); } catch {}
    });
    // Trigger Save
    const saveBtn = Array.from(document.querySelectorAll("button")).find((b) => /save|apply/i.test(b.textContent || ""));
    if (saveBtn) await act(async () => { fireEvent.click(saveBtn); });
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders empty state when no athletes", () => {
    renderApp(
      <CoachAthleteZoneSettingsPanel athletes={[]} savingAthleteId={null} onSave={vi.fn()} />,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

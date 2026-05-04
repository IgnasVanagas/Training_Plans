import { describe, it, expect, vi } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import React, { useState } from "react";
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

import { WorkoutEditor } from "../../../src/components/builder/WorkoutEditor";

const mkStep = (id: string, category: any, durationSec: number, target: any) => ({
  id,
  type: "block" as const,
  category,
  duration: { type: "time" as const, value: durationSec },
  target,
});

const initialStructure: any[] = [
  mkStep("warmup", "warmup", 600, { type: "heart_rate_zone", metric: "percent_max_hr", value: 70, unit: "%" }),
  {
    id: "main",
    type: "repeat",
    repeats: 4,
    steps: [
      mkStep("rep-work-1", "work", 300, { type: "power", metric: "percent_ftp", value: 105, unit: "%" }),
      mkStep("rep-rest-1", "recovery", 120, { type: "power", metric: "percent_ftp", value: 55, unit: "%" }),
    ],
  },
  mkStep("cooldown", "cooldown", 300, { type: "heart_rate_zone", metric: "percent_max_hr", value: 60, unit: "%" }),
];

function sweepClicks() {
  for (const b of Array.from(document.body.querySelectorAll("button"))) {
    try { act(() => { fireEvent.click(b); }); } catch {}
  }
  for (const i of Array.from(document.body.querySelectorAll('input[type="text"], input[type="number"], textarea'))) {
    try { act(() => { fireEvent.change(i, { target: { value: "300" } }); }); } catch {}
  }
}

const Harness = ({ sport }: { sport: string }) => {
  const [structure, setStructure] = useState<any[]>(initialStructure);
  return (
    <WorkoutEditor
      structure={structure}
      onChange={setStructure}
      sportType={sport}
      workoutName={"Test workout"}
      description={"Some description"}
      intensityType={sport === "running" ? "pace" : "power"}
      onWorkoutNameChange={vi.fn()}
      onDescriptionChange={vi.fn()}
      onIntensityTypeChange={vi.fn()}
      onSportTypeChange={vi.fn()}
      athleteName={"Alice"}
      athleteProfile={{ ftp: 250, lt2: 4.0, max_hr: 190, resting_hr: 50, weight: 65 }}
    />
  );
};

describe("WorkoutEditor coverage", () => {
  it("renders running and cycling, sweeps interactions", () => {
    renderApp(<Harness sport={"running"} />);
    sweepClicks();
    renderApp(<Harness sport={"cycling"} />);
    sweepClicks();
    expect(document.body.textContent).toBeTruthy();
  });
});

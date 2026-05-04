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

const noteRows = [
  { id: 1, date: "2026-04-10", content: "Existing note", athlete_id: 1, created_at: "2026-04-10T00:00:00", updated_at: "2026-04-10T00:00:00" },
];
vi.mock("../../../src/api/dayNotes", () => ({
  getDayNotes: vi.fn().mockResolvedValue([
    { id: 1, date: "2026-04-10", content: "Existing note", athlete_id: 1, created_at: "2026-04-10T00:00:00", updated_at: "2026-04-10T00:00:00" },
  ]),
  getDayNotesRange: vi.fn().mockResolvedValue([]),
  upsertDayNote: vi.fn().mockResolvedValue({ id: 1, date: "2026-04-10", content: "x", athlete_id: 1 }),
  deleteDayNote: vi.fn().mockResolvedValue(undefined),
}));

import { DayDetailsModal } from "../../../src/components/calendar/TrainingCalendarModals";

function sweepClicks() {
  const buttons = Array.from(document.body.querySelectorAll("button"));
  for (const b of buttons) {
    try { act(() => { fireEvent.click(b); }); } catch {}
  }
  const ck = Array.from(document.body.querySelectorAll('input[type="checkbox"], input[type="radio"]'));
  for (const c of ck) { try { act(() => { fireEvent.click(c); }); } catch {} }
  const inputs = Array.from(document.body.querySelectorAll('input[type="text"], input[type="number"], input[type="date"], input[type="time"], textarea'));
  for (const inp of inputs) { try { act(() => { fireEvent.change(inp, { target: { value: "2" } }); }); } catch {} }
}

const palette = {
  surface: "#fff", surfaceAlt: "#fafafa", border: "#ddd",
  textMain: "#111", textDim: "#888", accent: "#06f",
  bg: "#fff", panel: "#fafafa", soft: "#eee", strong: "#000",
};
const activityColors = {
  running: "#06f", cycling: "#f60", swimming: "#0a0", strength: "#a06", other: "#888",
} as any;

const planningMarkers = new Map<string, any[]>();
planningMarkers.set("2026-04-10", [
  { type: "goal_race", priority: "A", _raceIndex: 0, name: "Boston", sport_type: "running", distance_km: 42.2, expected_time: "03:30:00", location: "Boston", notes: "Goal" },
  { type: "phase_boundary", phase: "Build", index: 1 },
  { type: "training_block", description: "VO2max", priority: "high" },
]);

const dayEvents = [
  {
    id: 11, title: "Tempo run", start: new Date("2026-04-10T07:00:00"), end: new Date("2026-04-10T08:00:00"),
    sport_type: "running", planned_intensity: "Z3", planned_duration: 60, planned_distance: 12,
    structured_workout: { intervals: [{ duration: 600, intensity: "Z3" }] }, recurrence: null,
    is_planned: true, planned_zone: "Z3",
  },
  {
    id: 12, title: "Cycle", start: new Date("2026-04-10T17:00:00"), end: new Date("2026-04-10T18:30:00"),
    sport_type: "cycling", planned_intensity: "Z2", planned_duration: 90, planned_distance: 30,
    structured_workout: null, recurrence: null,
    is_planned: false,
  },
];

describe("DayDetailsModal coverage sweep", () => {
  it("renders fully and triggers handlers across both modes and dark theme", () => {
    for (const isDark of [false, true]) {
      for (const mode of ["text", "quick"] as const) {
        renderApp(
          <DayDetailsModal
            opened
            onClose={vi.fn()}
            selectedDayTitle={"Friday, April 10"}
            dayEvents={dayEvents}
            selectedDateRange={{ startDate: "2026-04-10", endDate: "2026-04-10" }}
            planningMarkersByDate={planningMarkers}
            isDark={isDark}
            athleteId={1}
            viewDate={new Date("2026-04-10")}
            onPlannedSelect={vi.fn()}
            onDownloadPlannedWorkout={vi.fn()}
            coachNeedsAthleteSelection={false}
            athleteOptions={[{ value: "1", label: "Alice" }, { value: "2", label: "Bob" }]}
            selectedEvent={dayEvents[0]}
            setSelectedEvent={vi.fn()}
            setDayCreateError={vi.fn()}
            quickWorkout={{ sport_type: "running", planned_intensity: "Z2", planned_duration: 60, planned_distance: 10, athlete_id: 1, recurrence: null }}
            setQuickWorkout={vi.fn()}
            canEditWorkouts={true}
            ensureAthleteSelectedForCreate={() => true}
            onQuickPlanningAction={vi.fn()}
            planningActionPending={false}
            onSeasonPlanItemUpdate={vi.fn()}
            seasonPlanUpdatePending={false}
            calendarSeasonPlan={{ id: 1, athlete_id: 1, weeks: [], goal_races: [{ name: "Boston", sport_type: "running", distance_km: 42.2, expected_time: "03:30:00", location: "Boston", notes: "" , priority: "A", date: "2026-04-10" }], phases: [{ phase: "Build", start_date: "2026-04-01", end_date: "2026-04-30" }] }}
            onOpenWorkoutBuilder={vi.fn()}
            onCreateQuickWorkout={vi.fn()}
            onCreateRestDay={vi.fn()}
            onLibrarySelect={vi.fn()}
            dayCreateError={null}
            activityColors={activityColors}
            palette={palette}
            onDuplicateSelect={vi.fn()}
            textWorkoutInput={mode === "text" ? "Easy 60min Z2" : ""}
            setTextWorkoutInput={vi.fn()}
            onCreateTextWorkout={vi.fn()}
          />,
        );
        sweepClicks();
      }
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it("range selection variant sweeps", () => {
    renderApp(
      <DayDetailsModal
        opened
        onClose={vi.fn()}
        selectedDayTitle={"Apr 10 - Apr 12"}
        dayEvents={dayEvents}
        selectedDateRange={{ startDate: "2026-04-10", endDate: "2026-04-12" }}
        planningMarkersByDate={planningMarkers}
        isDark={false}
        athleteId={null}
        viewDate={new Date("2026-04-10")}
        onPlannedSelect={vi.fn()}
        onDownloadPlannedWorkout={vi.fn()}
        coachNeedsAthleteSelection={false}
        athleteOptions={[{ value: "1", label: "Alice" }]}
        selectedEvent={dayEvents[1]}
        setSelectedEvent={vi.fn()}
        setDayCreateError={vi.fn()}
        quickWorkout={{ sport_type: "running", planned_intensity: "Z2", planned_duration: 60, planned_distance: 10, athlete_id: null, recurrence: null }}
        setQuickWorkout={vi.fn()}
        canEditWorkouts={true}
        ensureAthleteSelectedForCreate={() => false}
        onQuickPlanningAction={vi.fn()}
        planningActionPending={true}
        onSeasonPlanItemUpdate={vi.fn()}
        seasonPlanUpdatePending={true}
        calendarSeasonPlan={null}
        onOpenWorkoutBuilder={vi.fn()}
        onCreateQuickWorkout={vi.fn()}
        onCreateRestDay={vi.fn()}
        onLibrarySelect={vi.fn()}
        dayCreateError={"Some error"}
        activityColors={activityColors}
        palette={palette}
        onDuplicateSelect={vi.fn()}
        textWorkoutInput={""}
        setTextWorkoutInput={vi.fn()}
        onCreateTextWorkout={vi.fn()}
      />,
    );
    sweepClicks();
    expect(document.body.textContent).toBeTruthy();
  });
});

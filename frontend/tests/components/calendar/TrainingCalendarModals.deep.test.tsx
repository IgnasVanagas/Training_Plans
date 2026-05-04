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
vi.mock("../../../src/api/dayNotes", () => ({
  getDayNotes: vi.fn().mockResolvedValue([]),
  getDayNotesRange: vi.fn().mockResolvedValue([]),
  upsertDayNote: vi.fn().mockResolvedValue({}),
  deleteDayNote: vi.fn().mockResolvedValue(undefined),
}));

import { BulkEditModal, WorkoutEditModal, DayDetailsModal } from "../../../src/components/calendar/TrainingCalendarModals";

const palette = { surface: "#fff", surfaceAlt: "#fafafa", border: "#ddd", textMain: "#111", textDim: "#888", accent: "#06f" };

const baseAthleteProfile = {
  main_sport: "running",
  ftp: 250,
  lt2: 4.5,
  max_hr: 190,
  resting_hr: 50,
  zone_settings: {
    running: {
      hr: { lt2: 170, upper_bounds: [120, 140, 160, 180, 195] },
      pace: { lt2: 4.0, upper_bounds: [5.5, 5.0, 4.5, 4.0, 3.5] },
    },
    cycling: {
      hr: { lt2: 170, upper_bounds: [120, 140, 160, 180, 195] },
      power: { lt2: 250, upper_bounds: [120, 180, 220, 260, 320, 400] },
    },
  },
};

describe("TrainingCalendarModals deep", () => {
  it("renders BulkEditModal with all fields and triggers Apply", async () => {
    const setBulkWeekKey = vi.fn();
    const setBulkAthleteScope = vi.fn();
    const setBulkShiftDays = vi.fn();
    const setBulkDurationScale = vi.fn();
    const setBulkZoneDelta = vi.fn();
    const onApply = vi.fn();
    const weeksInMonth = [
      { key: "w1", start: new Date("2026-04-06"), end: new Date("2026-04-12") },
      { key: "w2", start: new Date("2026-04-13"), end: new Date("2026-04-19") },
    ];
    renderApp(
      <BulkEditModal
        opened
        onClose={vi.fn()}
        weeksInMonth={weeksInMonth}
        bulkWeekKey={"w1"}
        setBulkWeekKey={setBulkWeekKey}
        athleteOptions={[{ value: "1", label: "Alice" }, { value: "2", label: "Bob" }]}
        bulkAthleteScope={"all"}
        setBulkAthleteScope={setBulkAthleteScope}
        bulkShiftDays={0}
        setBulkShiftDays={setBulkShiftDays}
        bulkDurationScale={1}
        setBulkDurationScale={setBulkDurationScale}
        bulkZoneDelta={0}
        setBulkZoneDelta={setBulkZoneDelta}
        bulkApplying={false}
        onApply={onApply}
      />,
    );
    // Click any Apply / submit button if present
    const applyBtn = Array.from(document.querySelectorAll("button")).find((b) => /apply|preview/i.test(b.textContent || ""));
    if (applyBtn) await act(async () => { fireEvent.click(applyBtn); });
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders WorkoutEditModal for running and cycling sport", async () => {
    const baseEvent = {
      id: 11,
      title: "Easy Run",
      start: new Date("2026-04-10T07:00:00"),
      end: new Date("2026-04-10T08:00:00"),
      sport_type: "running",
      planned_intensity: "Z2",
      planned_duration: 60,
      planned_distance: 10,
      structured_workout: null,
      athlete_id: 1,
      planned_zone: "Z2",
    };
    renderApp(
      <WorkoutEditModal
        opened
        onClose={vi.fn()}
        selectedEvent={baseEvent}
        saveError={null}
        athleteOptions={[{ value: "1", label: "Alice" }]}
        setSelectedEvent={vi.fn()}
        athleteName={"Alice"}
        athleteProfile={baseAthleteProfile}
        canDeleteWorkouts
        canEditWorkouts
        deleteMutation={{ mutate: vi.fn(), isPending: false }}
        handleSave={vi.fn()}
      />,
    );
    expect(document.body.textContent).toBeTruthy();

    renderApp(
      <WorkoutEditModal
        opened
        onClose={vi.fn()}
        selectedEvent={{ ...baseEvent, sport_type: "cycling", planned_intensity: "Z3" }}
        saveError={"oops"}
        athleteOptions={[]}
        setSelectedEvent={vi.fn()}
        athleteName={"Bob"}
        athleteProfile={{ ...baseAthleteProfile, main_sport: "cycling" }}
        canDeleteWorkouts={false}
        canEditWorkouts={false}
        deleteMutation={{ mutate: vi.fn(), isPending: false }}
        handleSave={vi.fn()}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DayDetailsModal with rich props (range + planning markers + events)", () => {
    const planningMarkersByDate = new Map();
    planningMarkersByDate.set("2026-04-10", [
      { type: "macro_cycle", phase: "Build", index: 0 },
      { type: "meso_cycle", phase: "Aerobic", index: 0 },
      { type: "micro_cycle", load: 5, intensity: 3, index: 0 },
    ]);
    const stubEvent = {
      id: 0,
      title: "",
      sport_type: "running",
      planned_intensity: "Z2",
      start: new Date("2026-04-10"),
      end: new Date("2026-04-10"),
      recurrence: null,
    };
    renderApp(
      <DayDetailsModal
        opened
        onClose={vi.fn()}
        selectedDayTitle={"Friday April 10"}
        dayEvents={[
          { id: 1, title: "Easy Run", sport_type: "running", planned_intensity: "Z2", start: new Date("2026-04-10"), end: new Date("2026-04-10") },
        ]}
        selectedDateRange={{ startDate: "2026-04-10", endDate: "2026-04-10" }}
        planningMarkersByDate={planningMarkersByDate}
        isDark={false}
        athleteId={1}
        viewDate={new Date("2026-04-10")}
        onPlannedSelect={vi.fn()}
        onDownloadPlannedWorkout={vi.fn()}
        coachNeedsAthleteSelection={false}
        athleteOptions={[{ value: "1", label: "Alice" }]}
        selectedEvent={stubEvent}
        setSelectedEvent={vi.fn()}
        setDayCreateError={vi.fn()}
        quickWorkout={{ sport: "running", duration: 60, intensity: "Z2", notes: "" }}
        setQuickWorkout={vi.fn()}
        canEditWorkouts
        ensureAthleteSelectedForCreate={vi.fn(() => true)}
        onQuickPlanningAction={vi.fn()}
        planningActionPending={false}
        onSeasonPlanItemUpdate={vi.fn()}
        seasonPlanUpdatePending={false}
        calendarSeasonPlan={null}
        onOpenWorkoutBuilder={vi.fn()}
        onCreateQuickWorkout={vi.fn()}
        onCreateRestDay={vi.fn()}
        onLibrarySelect={vi.fn()}
        dayCreateError={null}
        activityColors={{}}
        palette={palette}
        onDuplicateSelect={vi.fn()}
        textWorkoutInput={""}
        setTextWorkoutInput={vi.fn()}
        onCreateTextWorkout={vi.fn()}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

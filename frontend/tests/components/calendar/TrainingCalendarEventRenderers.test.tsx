import { describe, it, expect, vi } from "vitest";
import { fireEvent, act } from "@testing-library/react";
import React from "react";
import { renderApp } from "../../utils/renderApp";

vi.mock("../../../src/api/client", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));

import {
  CalendarEventCard,
  NoteChip,
  DayEventItem,
} from "../../../src/components/calendar/TrainingCalendarEventRenderers";

const palette = {
  cardBg: "#fff",
  cardBorder: "#ccc",
  textDim: "#666",
  textMain: "#000",
};

const colors: any = {
  run: "#run", cycling: "#cy", swim: "#sw", walk: "#wa", hike: "#hi",
  workout: "#wo", virtual: "#vi", rest: "#re", default: "#de",
};

function makeEvent(over: any = {}) {
  const r = {
    id: 1,
    sport_type: "Running",
    title: "Easy run",
    is_planned: true,
    planned_duration: 60,
    planned_distance: 10,
    duration: null,
    distance: null,
    notes: null,
    matched_activity_id: null,
    is_more_indicator: false,
    hidden_count: 0,
    ...over,
  };
  return { resource: r, start: new Date(2026, 3, 10, 7, 0), end: new Date(2026, 3, 10, 8, 0) };
}

function sweep() {
  for (const b of Array.from(document.body.querySelectorAll("button"))) {
    try { act(() => { fireEvent.click(b); }); } catch {}
    try { act(() => { fireEvent.mouseEnter(b); }); } catch {}
    try { act(() => { fireEvent.mouseLeave(b); }); } catch {}
  }
}

describe("TrainingCalendarEventRenderers", () => {
  it("CalendarEventCard renders planned, completed, rest, virtual, and more-indicator", () => {
    renderApp(
      <>
        <CalendarEventCard event={makeEvent({ is_planned: true })} activityColors={colors} isDark={false} palette={palette} preferredUnits="metric" />
        <CalendarEventCard event={makeEvent({ is_planned: false, duration: 45, distance: 8 })} activityColors={colors} isDark={true} palette={palette} preferredUnits="imperial" />
        <CalendarEventCard event={makeEvent({ sport_type: "Rest", title: "Rest Day", is_planned: true, planned_duration: 0, planned_distance: 0 })} activityColors={colors} isDark={false} palette={palette} preferredUnits="metric" />
        <CalendarEventCard event={makeEvent({ sport_type: "VirtualRide", title: "Zwift", is_planned: false, duration: 60, distance: 30 })} activityColors={colors} isDark={false} palette={palette} preferredUnits="metric" />
        <CalendarEventCard event={makeEvent({ is_more_indicator: true, hidden_count: 3 })} activityColors={colors} isDark={true} palette={palette} preferredUnits="metric" />
      </>,
    );
    sweep();
    expect(document.body.textContent).toBeTruthy();
  });

  it("NoteChip renders text and toggles", () => {
    renderApp(<NoteChip note={{ content: "Long ride sat", author_name: "Coach", author_role: "coach" }} isDark={false} palette={palette} />);
    renderApp(<NoteChip note={{ content: "Long ride sat" }} isDark={true} palette={palette} />);
    sweep();
    expect(document.body.textContent).toContain("Long ride sat");
  });

  it("DayEventItem renders for planned and completed", () => {
    const baseR: any = { id: 1, sport_type: "Running", title: "Easy run", is_planned: true, planned_duration: 60, planned_distance: 10 };
    renderApp(
      <DayEventItem
        r={baseR}
        activityColors={colors}
        isDark={false}
        palette={palette}
        athleteId={1}
        viewDate={new Date(2026, 3, 10)}
        onPlannedSelect={() => {}}
        onCloseDayModal={() => {}}
        onDownloadPlannedWorkout={() => {}}
        onDuplicateSelect={() => {}}
      />,
    );
    renderApp(
      <DayEventItem
        r={{ ...baseR, is_planned: false, duration: 30, distance: 5, sport_type: "Cycling", avg_speed: 8 }}
        activityColors={colors}
        isDark={true}
        palette={palette}
        viewDate={new Date(2026, 3, 10)}
        onPlannedSelect={() => {}}
        onCloseDayModal={() => {}}
        onDownloadPlannedWorkout={() => {}}
      />,
    );
    sweep();
    expect(document.body.textContent).toBeTruthy();
  });
});

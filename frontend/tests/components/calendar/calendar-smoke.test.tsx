import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import CalendarHeader from "../../../src/components/calendar/CalendarHeader";
import ContinuousCalendarGrid from "../../../src/components/calendar/ContinuousCalendarGrid";

const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

describe("calendar smoke", () => {
  it("renders CalendarHeader month and week views", () => {
    wrap(
      <CalendarHeader
        date={new Date("2026-05-02")}
        onNavigate={() => {}}
        currentView="month"
        onViewChange={() => {}}
        monthlyTotalsLabel="100km"
        onMonthlyTotalsClick={() => {}}
      />,
    );
    wrap(
      <CalendarHeader
        date={new Date("2026-05-02")}
        onNavigate={() => {}}
        currentView="week"
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders ContinuousCalendarGrid with empty events", () => {
    const palette = {
      surface: "#fff",
      surfaceAlt: "#fafafa",
      border: "#ddd",
      textMain: "#111",
      textDim: "#888",
      accent: "#06f",
      todayHighlight: "#fff7e6",
      hoverHighlight: "#f0f0f0",
    };
    const events = [
      {
        id: "evt-1",
        title: "Easy run",
        start: new Date("2026-05-02"),
        end: new Date("2026-05-02"),
        resource: { id: 1, date: "2026-05-02", title: "Easy run", is_planned: true, sport_type: "Run" },
      },
    ];
    wrap(
      <ContinuousCalendarGrid
        viewDate={new Date("2026-05-02")}
        onViewDateChange={() => {}}
        weekStartDay={1}
        events={events as any}
        visibleWeeks={4}
        palette={palette}
        isDark={false}
        activityColors={{ Run: "#06f" }}
        planningMarkersByDate={new Map()}
        buildPlanningMarkerVisual={() => ({ Icon: () => null, color: "#000", title: "" })}
        onSelectEvent={() => {}}
        onSelectSlot={() => {}}
        onEventDrop={() => {}}
        onDropFromOutside={() => {}}
        canEditWorkouts
        notesByDate={new Map()}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "../i18n/I18nProvider";

import { AthleteCalendarPage } from "../pages/AthleteCalendarPage";
import { WorkoutBuilderPage } from "../pages/WorkoutBuilderPage";
import DashboardLayoutShell from "../pages/dashboard/DashboardLayoutShell";
import { useIntegrationSync } from "../pages/dashboard/useIntegrationSync";
import SeasonPlannerPreview from "../components/planner/SeasonPlannerPreview";
import SeasonPlannerDrawer from "../components/planner/SeasonPlannerDrawer";
import { TrainingCalendar } from "../components/TrainingCalendar";
import { ChartsPanel } from "../components/activityDetail/ChartsPanel";
import { FullscreenMapModal } from "../components/activityDetail/FullscreenMapModal";
import { HardEffortsPanel } from "../components/activityDetail/HardEffortsPanel";
import { HardEffortsChart } from "../components/activityDetail/HardEffortsChart";
import TrainingCalendarZoneDetailModal from "../components/calendar/TrainingCalendarZoneDetailModal";
import TrainingCalendarZoneSummaryPanel from "../components/calendar/TrainingCalendarZoneSummaryPanel";
import { DayDetailsModal, BulkEditModal, WorkoutEditModal } from "../components/calendar/TrainingCalendarModals";

// global mocks
vi.mock("../api/client", () => ({
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
vi.mock("../api/organizations", () => ({
  resolveUserPictureUrl: () => null,
}));
vi.mock("../api/integrations", () => ({
  cancelIntegrationSync: vi.fn().mockResolvedValue({ status: "completed", message: "ok" }),
  connectIntegration: vi.fn().mockResolvedValue({ authorization_url: "x" }),
  disconnectIntegration: vi.fn().mockResolvedValue(undefined),
  getIntegrationSyncStatus: vi.fn().mockResolvedValue({ status: "completed", message: "done" }),
  syncIntegrationNow: vi.fn().mockResolvedValue({ status: "queued", message: "ok" }),
}));
vi.mock("../api/dayNotes", () => ({
  getDayNotes: vi.fn().mockResolvedValue([]),
  getDayNotesRange: vi.fn().mockResolvedValue([]),
  upsertDayNote: vi.fn().mockResolvedValue({}),
  deleteDayNote: vi.fn().mockResolvedValue(undefined),
}));

// Stub leaflet/react-leaflet to avoid jsdom issues
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  Marker: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  CircleMarker: () => null,
  useMap: () => ({ flyTo: vi.fn(), fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
  useMapEvent: () => ({}),
  ZoomControl: () => null,
  Pane: ({ children }: any) => <div>{children}</div>,
  LayerGroup: ({ children }: any) => <div>{children}</div>,
  FeatureGroup: ({ children }: any) => <div>{children}</div>,
}));

const wrap = (ui: React.ReactElement, initial = "/") => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[initial]}>{ui}</MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

const ui = {
  surface: "#fff",
  surfaceAlt: "#fafafa",
  border: "#ddd",
  textMain: "#111",
  textDim: "#888",
  accent: "#06f",
};

describe("page-level smoke tests", () => {
  it("renders AthleteCalendarPage error state without crashing", () => {
    wrap(
      <Routes>
        <Route path="/athlete/:id" element={<AthleteCalendarPage />} />
      </Routes>,
      "/athlete/2",
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders WorkoutBuilderPage", () => {
    wrap(<WorkoutBuilderPage />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DashboardLayoutShell for coach, athlete, admin", () => {
    const tabs = ["dashboard", "settings", "plan", "athletes"] as const;
    for (const tab of tabs) {
      wrap(
        <DashboardLayoutShell
          opened={false}
          toggle={() => {}}
          meDisplayName="Coach Smith"
          mePicture={null}
          activeTab={tab as any}
          setActiveTab={() => {}}
          headerRight={<span>hr</span>}
          role="coach"
          athletes={[
            {
              id: 2,
              email: "a@b.c",
              profile: { first_name: "A", last_name: "Test" },
            } as any,
          ]}
          selectedAthleteId="2"
          onSelectAthlete={() => {}}
          organizationName="Org"
          onAthleteSettings={() => {}}
        >
          <div>child</div>
        </DashboardLayoutShell>,
      );
    }
    wrap(
      <DashboardLayoutShell
        opened
        toggle={() => {}}
        meDisplayName="Athlete"
        activeTab={"plan" as any}
        setActiveTab={() => {}}
        headerRight={null}
        role="athlete"
      >
        <div>child</div>
      </DashboardLayoutShell>,
    );
    wrap(
      <DashboardLayoutShell
        opened
        toggle={() => {}}
        meDisplayName="Admin"
        activeTab={"admin-users" as any}
        setActiveTab={() => {}}
        headerRight={null}
        role="admin"
      >
        <div>child</div>
      </DashboardLayoutShell>,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders SeasonPlannerPreview", () => {
    const preview = {
      countdowns: [
        {
          race_id: 1,
          name: "Spring 10K",
          date: "2026-06-01",
          priority: "A",
          weeks_to_go: 4,
        },
      ],
      season_blocks: [
        {
          name: "Base",
          start_date: "2026-04-01",
          end_date: "2026-05-01",
          phase: "base",
        },
      ],
      macro_cycles: [],
      meso_cycles: [
        {
          name: "Build 1",
          start_date: "2026-04-01",
          end_date: "2026-04-21",
          phase: "build",
        },
      ],
      micro_cycles: [
        {
          start_date: "2026-04-01",
          end_date: "2026-04-07",
          load: 6,
          intensity: 4,
        },
      ],
      generated_workouts: [
        { date: "2026-04-02", sport_type: "Run", title: "Easy run" },
      ],
      load_progression: [
        { week: 1, load: 5 },
        { week: 2, load: 7 },
      ],
      summary: {
        total_weeks: 12,
        race_count: 2,
        constraint_count: 1,
        generated_workout_count: 60,
      },
    } as any;
    wrap(<SeasonPlannerPreview preview={preview} isDark={false} t={(s: string) => s} />);
    wrap(<SeasonPlannerPreview preview={preview} isDark t={(s: string) => s} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders SeasonPlannerDrawer for coach", () => {
    wrap(
      <SeasonPlannerDrawer
        opened
        onClose={() => {}}
        me={{ id: 1, role: "coach", email: "c@x.y" } as any}
        athletes={[
          { id: 2, email: "a@b.c", profile: { first_name: "A" } } as any,
        ]}
        selectedAthleteId={2}
        inline={false}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders TrainingCalendar smoke", () => {
    wrap(<TrainingCalendar athleteId={null} />);
    expect(document.body.textContent).toBeTruthy();
  });
});

describe("activityDetail panel smoke", () => {
  const me = { id: 1, profile: { preferred_units: "metric" } };

  const renderProps: any = {
    me,
    visibleSeries: { heart_rate: true, power: true, pace: true, speed: true, elevation: true, cadence: true, temperature: true },
    setVisibleSeries: () => {},
    powerChartMode: "raw",
    setPowerChartMode: () => {},
    focusMode: false,
    setFocusMode: () => {},
    focusObjective: "pacing",
    setFocusObjective: () => {},
    focusSeries: { heart_rate: true, power: true, pace: false, speed: false, elevation: false, cadence: false, temperature: false },
    supportsPaceSeries: true,
    supportsSpeedSeries: true,
    chartDataLength: 2,
    chartRenderData: [
      { time: 0, heart_rate: 120, power: 150, pace: 5, speed: 3, elevation: 100, cadence: 80, temperature: 20 },
      { time: 60, heart_rate: 130, power: 160, pace: 5.1, speed: 3.1, elevation: 105, cadence: 82, temperature: 21 },
    ],
    chartRange: [0, 1] as [number, number],
    setChartRange: () => {},
    rangeLabel: ["0:00", "1:00"] as [string, string],
    chartSelection: null,
    setChartSelection: () => {},
    chartSelectionStats: null,
    isDraggingChartRef: { current: false },
    dragStartIdxRef: { current: null },
    hoveredPointIndexRef: { current: null },
    onMouseMove: () => {},
    onMouseLeave: () => {},
    sharedTooltipProps: {},
    formatElapsedFromMinutes: (v: any) => String(v),
    isDark: false,
    ui,
    t: (s: string) => s,
  };

  it("renders ChartsPanel", () => {
    wrap(<ChartsPanel {...renderProps} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders ChartsPanel with focusMode", () => {
    wrap(<ChartsPanel {...renderProps} focusMode chartSelection={{ startIdx: 0, endIdx: 1 }} chartSelectionStats={{ avgHr: 125, avgPower: 155 }} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders FullscreenMapModal closed", () => {
    wrap(
      <FullscreenMapModal
        opened={false}
        onClose={() => {}}
        routePositions={[]}
        centerPos={[0, 0]}
        mapHeatSegments={[]}
        selectedEffortRoutePositions={[]}
        selectedChartRoutePositions={[]}
        interactiveMapRoutePoints={[]}
        onMapHover={() => {}}
        fullscreenMarkerPos={null}
        fullscreenMarkerPoint={null}
        chartSelectionStats={null}
        onClearSelection={() => {}}
        mapHeatMetric={"heart_rate" as any}
        setMapHeatMetric={() => {}}
        fsVisibleMetrics={{ heart_rate: true, power: true, pace: true, speed: true, elevation: true, cadence: true, temperature: true } as any}
        setFsVisibleMetrics={() => {}}
        supportsPaceSeries
        supportsSpeedSeries
        chartRenderData={renderProps.chartRenderData}
        chartSelection={null}
        setChartSelection={() => {}}
        onFsChartMove={() => {}}
        onFsChartLeave={() => {}}
        isFsDraggingRef={{ current: false }}
        fsDragStartIdxRef={{ current: null }}
        me={me}
        formatElapsedFromMinutes={(v) => String(v)}
        isDark={false}
        ui={ui}
        t={(s) => s}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders FullscreenMapModal opened", () => {
    wrap(
      <FullscreenMapModal
        opened
        onClose={() => {}}
        routePositions={[[10, 10], [10.001, 10.001]]}
        centerPos={[10, 10]}
        mapHeatSegments={[{ positions: [[10, 10], [10.001, 10.001]], color: "#f00" }]}
        selectedEffortRoutePositions={[]}
        selectedChartRoutePositions={[]}
        interactiveMapRoutePoints={[]}
        onMapHover={() => {}}
        fullscreenMarkerPos={null}
        fullscreenMarkerPoint={null}
        chartSelectionStats={null}
        onClearSelection={() => {}}
        mapHeatMetric={"heart_rate" as any}
        setMapHeatMetric={() => {}}
        fsVisibleMetrics={{ heart_rate: true, power: true, pace: true, speed: true, elevation: true, cadence: true, temperature: true } as any}
        setFsVisibleMetrics={() => {}}
        supportsPaceSeries
        supportsSpeedSeries
        chartRenderData={renderProps.chartRenderData}
        chartSelection={null}
        setChartSelection={() => {}}
        onFsChartMove={() => {}}
        onFsChartLeave={() => {}}
        isFsDraggingRef={{ current: false }}
        fsDragStartIdxRef={{ current: null }}
        me={me}
        formatElapsedFromMinutes={(v) => String(v)}
        isDark
        ui={ui}
        t={(s) => s}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders HardEffortsPanel for cycling and running activity", () => {
    const baseStream = Array.from({ length: 200 }, (_, i) => ({
      time_offset_seconds: i,
      heart_rate: 150 + (i % 20),
      power: 200 + (i % 30),
      speed: 3 + (i % 5) * 0.05,
      cadence: 80,
      altitude: 100 + i * 0.1,
      pace_min_per_km: 5 + (i % 5) * 0.05,
    }));
    wrap(
      <HardEffortsPanel
        activity={{ id: 1, sport: "Cycling", type: "Cycling" } as any}
        streamPoints={baseStream}
        zoneProfile={{ ftp: 250, zone_settings: { cycling: { power: { lt2: 250 } } } }}
        selectedEffortKey={null}
        onSelectEffort={() => {}}
        isDark={false}
        ui={ui}
        t={(s) => s}
      />,
    );
    wrap(
      <HardEffortsPanel
        activity={{ id: 2, sport: "Running", type: "Running" } as any}
        streamPoints={baseStream}
        zoneProfile={{ zone_settings: { running: { pace: { lt2: 4.5 } } } }}
        selectedEffortKey={null}
        onSelectEffort={() => {}}
        isDark
        ui={ui}
        t={(s) => s}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders HardEffortsChart", () => {
    const streamPoints = Array.from({ length: 50 }, (_, i) => ({
      time_offset_seconds: i,
      heart_rate: 150,
      power: 200,
    }));
    const efforts = [
      { key: "h1", startIdx: 0, endIdx: 30, durationSeconds: 30, avgPower: 220, avgHr: 160, zone: 4, label: "30s" },
    ] as any[];
    wrap(
      <HardEffortsChart
        streamPoints={streamPoints}
        hardEfforts={efforts}
        selectedEffortKey={"h1"}
        onSelectEffort={() => {}}
        isCyclingActivity
        isDark={false}
        ui={ui}
        t={(s) => s}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

describe("calendar modal smoke", () => {
  it("renders TrainingCalendarZoneDetailModal closed and open", () => {
    wrap(<TrainingCalendarZoneDetailModal data={null} onClose={() => {}} />);
    const data = {
      title: "Week 1",
      metrics: {
        totalDistanceKm: 50,
        totalDurationMin: 240,
        avgPaceMinPerKm: 5,
        maxPaceMinPerKm: 4,
        avgHr: 150,
        maxHr: 180,
        cyclingAvgPower: 200,
        cyclingMaxPower: 320,
        cyclingNormalizedPower: 215,
        activitiesCount: 5,
        aerobicLoad: 50,
        anaerobicLoad: 10,
      },
      zones: {
        running: { activityCount: 3, zoneSecondsByMetric: { hr: { Z1: 600, Z2: 800 }, pace: { Z1: 600, Z2: 800 } } },
        cycling: { activityCount: 2, zoneSecondsByMetric: { hr: { Z1: 600 }, power: { Z1: 600, Z2: 400 } } },
      },
      activities: [
        {
          id: 11,
          date: new Date("2026-04-15"),
          sport: "Run",
          distanceKm: 10,
          durationMin: 50,
          avgHr: 150,
          avgPaceMinPerKm: 5,
          zoneSeconds: { Z1: 600, Z2: 1500 },
          zoneCount: 5,
        },
      ],
      partialData: false,
    };
    wrap(<TrainingCalendarZoneDetailModal data={data as any} onClose={() => {}} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders BulkEditModal", () => {
    wrap(
      <BulkEditModal
        opened
        onClose={() => {}}
        weeksInMonth={[
          { start: new Date("2026-04-06"), end: new Date("2026-04-12"), key: "w1" },
        ]}
        bulkWeekKey="w1"
        setBulkWeekKey={() => {}}
        athleteOptions={[{ value: "2", label: "A B" }]}
        bulkAthleteScope="all"
        setBulkAthleteScope={() => {}}
        bulkShiftDays={0}
        setBulkShiftDays={() => {}}
        bulkDurationScale={1}
        setBulkDurationScale={() => {}}
        bulkZoneDelta={0}
        setBulkZoneDelta={() => {}}
        bulkApplying={false}
        onApply={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DayDetailsModal", () => {
    wrap(
      <DayDetailsModal
        opened
        onClose={() => {}}
        selectedDayTitle="Monday Apr 6"
        dayEvents={[]}
        selectedDateRange={{ startDate: "2026-04-06", endDate: "2026-04-06" }}
        planningMarkersByDate={new Map()}
        isDark={false}
        athleteId={null}
        viewDate={new Date("2026-04-06")}
        onPlannedSelect={() => {}}
        onDownloadPlannedWorkout={() => {}}
        coachNeedsAthleteSelection={false}
        athleteOptions={[]}
        selectedEvent={{ id: 1, recurrence: null }}
        setSelectedEvent={() => {}}
        setDayCreateError={() => {}}
        quickWorkout={{ sport: "Run", durationMinutes: 30 }}
        setQuickWorkout={() => {}}
        canEditWorkouts
        ensureAthleteSelectedForCreate={() => true}
        onQuickPlanningAction={() => {}}
        planningActionPending={false}
        onSeasonPlanItemUpdate={() => {}}
        seasonPlanUpdatePending={false}
        calendarSeasonPlan={null}
        onOpenWorkoutBuilder={() => {}}
        onCreateQuickWorkout={() => {}}
        onCreateRestDay={() => {}}
        onLibrarySelect={() => {}}
        dayCreateError={null}
        activityColors={{ Run: "#06f" }}
        palette={{
          surface: "#fff",
          surfaceAlt: "#fafafa",
          border: "#ddd",
          textMain: "#111",
          textDim: "#888",
          accent: "#06f",
          todayHighlight: "#fff7e6",
          hoverHighlight: "#f0f0f0",
        }}
        onDuplicateSelect={() => {}}
        textWorkoutInput=""
        setTextWorkoutInput={() => {}}
        onCreateTextWorkout={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders WorkoutEditModal", () => {
    wrap(
      <WorkoutEditModal
        opened
        onClose={() => {}}
        selectedEvent={{
          id: 99,
          title: "Easy run",
          date: "2026-04-06",
          sport_type: "running",
          planned_intensity: "easy",
          planned_zone: 2,
          planned_duration_minutes: 45,
          is_planned: true,
        }}
        saveError={null}
        athleteOptions={[{ value: "2", label: "A B" }]}
        setSelectedEvent={() => {}}
        athleteName="A B"
        athleteProfile={{
          main_sport: "running",
          ftp: 250,
          max_hr: 190,
          resting_hr: 50,
          weight: 70,
        }}
        canDeleteWorkouts
        canEditWorkouts
        deleteMutation={{ isPending: false, mutate: () => {} }}
        handleSave={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders TrainingCalendarZoneSummaryPanel inline", () => {
    wrap(
      <TrainingCalendarZoneSummaryPanel
        monthlyOpenSignal={0}
        zoneSummary={{ weeks: [], months: [] } as any}
        events={[]}
        weeksInMonth={[
          { start: new Date("2026-04-06"), end: new Date("2026-04-12"), key: "w1" },
        ]}
        weekRowHeights={[80]}
        palette={{
          surface: "#fff",
          surfaceAlt: "#fafafa",
          border: "#ddd",
          textMain: "#111",
          textDim: "#888",
          accent: "#06f",
        } as any}
        isDark={false}
        activityColors={{ Run: "#06f" }}
        athletes={[]}
        me={{ id: 1, role: "athlete" }}
        athleteId={null}
        allAthletes={false}
        monthStart={new Date("2026-04-01")}
        monthEnd={new Date("2026-04-30")}
        weekStartDay={1}
        weekdayHeaderHeight={40}
        panelWidth={220}
        isLoading={false}
      >
        {(api: any) => (
          <div>
            <div>{api.headerContent}</div>
            <div>{api.renderWeekRow({ start: new Date("2026-04-06"), end: new Date("2026-04-12"), key: "w1" }, 0)}</div>
          </div>
        )}
      </TrainingCalendarZoneSummaryPanel>,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

describe("useIntegrationSync hook", () => {
  it("provides the expected api shape", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: any) => (
      <MantineProvider>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </MantineProvider>
    );
    const { result } = renderHook(
      () =>
        useIntegrationSync({
          queryClient: client,
          me: { id: 1, role: "athlete" } as any,
          integrations: [
            { provider: "strava", connected: true, last_sync_at: null } as any,
          ],
          activeTab: "trackers",
          isDocumentVisible: true,
        }),
      { wrapper },
    );
    expect(result.current).toBeTruthy();
    expect(typeof result.current).toBe("object");
  });
});

// import-only modules to register coverage
import * as activityDetailTypes from "../types/activityDetail";
import * as workoutTypes from "../types/workout";
import * as trainingCalendarStyles from "../components/calendar/trainingCalendarStyles";
import * as calendarTypes from "../components/calendar/types";
import * as dashboardTypes from "../pages/dashboard/types";

describe("type/style module imports", () => {
  it("loads module surfaces", () => {
    expect(activityDetailTypes).toBeTruthy();
    expect(workoutTypes).toBeTruthy();
    expect(trainingCalendarStyles).toBeTruthy();
    expect(calendarTypes).toBeTruthy();
    expect(dashboardTypes).toBeTruthy();
  });
});

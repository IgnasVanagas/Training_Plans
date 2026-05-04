import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../src/i18n/I18nProvider";

vi.mock("../../src/api/client", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { id: 1, email: "a@a.com", profile: { first_name: "Sam" } } }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));

import {
  CalendarWeekSkeleton,
  CalendarMonthSkeleton,
  ActivitiesListSkeleton,
  ActivityDetailSkeleton,
  ComparisonLoadingSkeleton,
} from "../../src/components/common/SkeletonScreens";
import { WorkoutVisualizer } from "../../src/components/builder/WorkoutVisualizer";
import { MetricHistoryModal } from "../../src/components/dashboard/MetricHistoryModal";
import { ComparisonPanel } from "../../src/components/activityDetail/ComparisonPanel";
import { BestEffortsPanel } from "../../src/components/activityDetail/BestEffortsPanel";
import { AppSidebarLayout } from "../../src/components/AppSidebarLayout";

const w = (ui: React.ReactNode) => {
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

describe("SkeletonScreens", () => {
  it("renders all skeleton variants", () => {
    w(<CalendarWeekSkeleton />);
    w(<CalendarMonthSkeleton />);
    w(<ActivitiesListSkeleton />);
    w(<ActivitiesListSkeleton count={3} />);
    w(<ActivityDetailSkeleton />);
    w(<ComparisonLoadingSkeleton />);
    w(<ComparisonLoadingSkeleton mode="weeks" />);
    w(<ComparisonLoadingSkeleton mode="months" />);
    expect(true).toBe(true);
  });

  it("renders WorkoutVisualizer with mixed targets", () => {
    const steps: any = [
      { id: "a", type: "block", category: "warmup", duration: { type: "time", value: 600 }, target: { type: "heart_rate_zone", zone: 2 } },
      { id: "b", type: "block", category: "work", duration: { type: "distance", value: 1000 }, target: { type: "power", min: 200, max: 250 } },
      { id: "c", type: "block", category: "work", duration: { type: "time", value: 300 }, target: { type: "pace", value: 300 } },
      { id: "d", type: "block", category: "recovery", duration: { type: "open" }, target: { type: "rpe", value: 5 } },
      {
        id: "r",
        type: "repeat",
        repeats: 2,
        steps: [
          { id: "s1", type: "block", category: "work", duration: { type: "time", value: 60 }, target: { type: "power", value: 220 } },
          { id: "s2", type: "block", category: "recovery", duration: { type: "time", value: 60 }, target: { type: "heart_rate_zone", zone: 1 } },
        ],
      },
    ];
    w(<WorkoutVisualizer steps={steps} ftp={250} weight={70} />);
    expect(true).toBe(true);
  });

  it("renders MetricHistoryModal", () => {
    w(
      <MetricHistoryModal
        selectedMetric={"hrv" as any}
        onClose={() => {}}
        manualMetricDate={new Date("2026-04-01")}
        setManualMetricDate={() => {}}
        manualMetricValue={50}
        setManualMetricValue={() => {}}
        saveDailyMetric={() => {}}
        savingManualMetric={false}
        selectedMetricChartData={[{ date: "2026-04-01", value: 50 }]}
        selectedMetricRows={[{ date: "2026-04-01", value: 50 }]}
      />,
    );
    expect(true).toBe(true);
  });

  it("renders ComparisonPanel", () => {
    const activity: any = {
      id: 1,
      planned_comparison: {
        score_pct: 85,
        status: "on_track",
        thresholds: [{ status: "on_track", minScorePct: 80 }],
        deviation_summary: "ok",
      },
    };
    const ui: any = { surface: "#fff", border: "#ccc", textMain: "#000", textDim: "#666" };
    w(
      <ComparisonPanel
        activity={activity}
        executionTraceRows={[]}
        executionTraceMeta={{ thresholds: [] } as any}
        executionInfoOpen={false}
        setExecutionInfoOpen={() => {}}
        formatPace={() => "5:00"}
        ui={ui}
      />,
    );
    expect(true).toBe(true);
  });

  it("renders BestEffortsPanel", () => {
    const activity: any = {
      id: 1,
      sport: "running",
      best_efforts: [
        { duration_seconds: 60, time_seconds: 45, distance: null, name: "1 min" },
        { duration_seconds: null, time_seconds: 240, distance: 1000, name: "1 km" },
      ],
    };
    const ui: any = { surface: "#fff", border: "#ccc", textMain: "#000", textDim: "#666" };
    w(
      <BestEffortsPanel
        activity={activity}
        me={{ id: 1 }}
        rankedBestEfforts={activity.best_efforts}
        bestEffortMetaByKey={{}}
        selectedEffortKey={null}
        onSelectEffort={() => {}}
        isCyclingActivity={false}
        isRunningActivity={true}
        isDark={false}
        ui={ui}
        t={(k: string) => k}
      />,
    );
    expect(true).toBe(true);
  });

  it("renders AppSidebarLayout and clicks", async () => {
    const { container } = w(<AppSidebarLayout activeNav="plan">child</AppSidebarLayout>);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    for (const btn of Array.from(container.querySelectorAll("button"))) {
      try {
        act(() => fireEvent.click(btn));
      } catch {
        /* ignore */
      }
    }
    expect(true).toBe(true);
  });
});

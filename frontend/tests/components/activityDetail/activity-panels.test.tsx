import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import { BestEffortsPanel } from "../../../src/components/activityDetail/BestEffortsPanel";
import { SplitsTable } from "../../../src/components/activityDetail/SplitsTable";
import { HardEffortsChart } from "../../../src/components/activityDetail/HardEffortsChart";
import { HardEffortsPanel } from "../../../src/components/activityDetail/HardEffortsPanel";
import { SessionFeedbackPanel } from "../../../src/components/activityDetail/SessionFeedbackPanel";
import { ComparisonPanel } from "../../../src/components/activityDetail/ComparisonPanel";
import { SelectedSegmentSummary } from "../../../src/components/activityDetail/SelectedSegmentSummary";
import { CommentsPanel } from "../../../src/components/activityDetail/CommentsPanel";

vi.mock("../../../src/api/client", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { items: [], comments: [] } }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));
vi.mock("../../../src/api/communications", () => ({
  getThread: vi.fn().mockResolvedValue({ items: [] }),
  addThreadComment: vi.fn().mockResolvedValue({}),
  acknowledgeThread: vi.fn().mockResolvedValue({}),
}));

const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
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
const t = (s: string) => s;
const me = { id: 1, profile: { preferred_units: "metric" } };

describe("activityDetail panels smoke", () => {
  it("renders BestEffortsPanel and empty path", () => {
    wrap(
      <BestEffortsPanel
        activity={{
          best_efforts: [
            { type: "time", duration: 60, distance: 400, value: 100, key: "k1" },
            { type: "distance", duration: 600, distance: 5000, value: 600, key: "k2" },
          ],
          sport: "Run",
        } as any}
        me={me}
        rankedBestEfforts={[
          { type: "time", duration: 60, distance: 400, value: 100, key: "k1" },
        ] as any}
        bestEffortMetaByKey={{
          k1: { startIdx: 0, endIdx: 5 } as any,
        }}
        selectedEffortKey="k1"
        onSelectEffort={() => {}}
        isCyclingActivity={false}
        isRunningActivity
        isDark={false}
        ui={ui}
        t={t}
      />,
    );
    wrap(
      <BestEffortsPanel
        activity={{ best_efforts: [], sport: "Ride" } as any}
        me={me}
        rankedBestEfforts={[] as any}
        bestEffortMetaByKey={{}}
        selectedEffortKey={null}
        onSelectEffort={() => {}}
        isCyclingActivity
        isRunningActivity={false}
        isDark
        ui={ui}
        t={t}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders SplitsTable", () => {
    const activity = {
      sport: "Run",
      splits: [
        { distance: 1000, elapsed_time: 300, moving_time: 295, average_heartrate: 150, average_speed: 3.3, average_grade: 0 },
      ],
      laps: [
        { distance: 500, elapsed_time: 150, moving_time: 145 },
      ],
    } as any;
    wrap(
      <SplitsTable
        activity={activity}
        me={me}
        streamPoints={[]}
        isDesktopViewport
        onSaveAnnotations={() => {}}
        isSaving={false}
        formatPace={(s) => `${s}`}
        isRunningActivity
        isCyclingActivity={false}
        ui={ui}
        t={t}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("labels cycling split power as WAP", () => {
    const activity = {
      sport: "Ride",
      laps: [
        { split: 1, distance: 1000, duration: 120, avg_speed: 8.5, avg_hr: 148, avg_power: 210 },
      ],
    } as any;

    wrap(
      <SplitsTable
        activity={activity}
        me={me}
        streamPoints={[]}
        isDesktopViewport
        onSaveAnnotations={() => {}}
        isSaving={false}
        formatPace={(s) => `${s}`}
        isRunningActivity={false}
        isCyclingActivity
        ui={ui}
        t={t}
      />,
    );

    expect(screen.getAllByText("WAP")).toHaveLength(2);
    expect(screen.queryByText("NP")).not.toBeInTheDocument();
  });

  it("renders HardEffortsPanel with empty stream", () => {
    wrap(
      <HardEffortsPanel
        activity={{ sport: "Run" } as any}
        streamPoints={[]}
        zoneProfile={{ ftp: 200, max_hr: 190 }}
        selectedEffortKey={null}
        onSelectEffort={() => {}}
        isDark={false}
        ui={ui}
        t={t}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("shows hard-effort stats on hover and keeps segments selectable", () => {
    const onSelectEffort = vi.fn();
    const streamPoints = Array.from({ length: 50 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 4, 3, 10, 0, i)).toISOString(),
      time_offset_seconds: i,
      heart_rate: 150 + (i % 3),
      power: 200 + i,
    }));

    wrap(
      <HardEffortsChart
        streamPoints={streamPoints}
        hardEfforts={[
          { key: "h-start", startIndex: 0, endIndex: 10, durationSeconds: 11, avgPower: 220, wap: 228, maxPower: 310, avgHr: 158, maxHr: 167, zone: 4, pctRef: 101 } as any,
          { key: "h-end", startIndex: 38, endIndex: 49, durationSeconds: 12, avgPower: 286, wap: 294, maxPower: 365, avgHr: 164, maxHr: 172, zone: 5, pctRef: 118 } as any,
        ]}
        selectedEffortKey={null}
        onSelectEffort={onSelectEffort}
        isCyclingActivity
        isDark={false}
        ui={ui}
        t={t}
      />,
    );

    const startRegion = screen.getByTestId("hard-effort-region-h-start");
    const endRegion = screen.getByTestId("hard-effort-region-h-end");

    expect(screen.queryByTestId("hard-effort-hover-card")).toBeNull();

    fireEvent.mouseEnter(startRegion);
    expect(screen.getByTestId("hard-effort-hover-card")).toBeTruthy();
    expect(screen.getByText("Avg W: 220 W")).toBeTruthy();

    fireEvent.mouseEnter(endRegion);
    expect(screen.getByText("Avg W: 286 W")).toBeTruthy();

    fireEvent.click(endRegion);
    expect(onSelectEffort).toHaveBeenCalledWith("h-end");

    fireEvent.mouseLeave(endRegion);
    expect(screen.queryByTestId("hard-effort-hover-card")).toBeNull();
  });

  it("insets hard-effort hitboxes to the plotted chart area", async () => {
    const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 500,
    });

    try {
      const streamPoints = Array.from({ length: 50 }, (_, i) => ({
        timestamp: new Date(Date.UTC(2026, 4, 3, 10, 0, i)).toISOString(),
        time_offset_seconds: i,
        heart_rate: 150 + (i % 3),
        power: 200 + i,
      }));

      wrap(
        <HardEffortsChart
          streamPoints={streamPoints}
          hardEfforts={[
            { key: "h-start", startIndex: 0, endIndex: 10, durationSeconds: 11, avgPower: 220, wap: 228, maxPower: 310, avgHr: 158, maxHr: 167, zone: 4, pctRef: 101 } as any,
          ]}
          selectedEffortKey={null}
          onSelectEffort={() => {}}
          isCyclingActivity
          isDark={false}
          ui={ui}
          t={t}
        />,
      );

      await waitFor(() => {
        expect(screen.getByTestId("hard-effort-overlay-frame")).toHaveStyle({ left: "53px", width: "393px" });
      });
    } finally {
      if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
      }
    }
  });

  it("renders SessionFeedbackPanel", () => {
    wrap(
      <SessionFeedbackPanel
        activityId={42}
        initialActivity={{ rpe: 5, lactate_mmol_l: 2, notes: "felt great" }}
        canEdit
      />,
    );
    wrap(
      <SessionFeedbackPanel
        activityId={42}
        initialActivity={null}
        canEdit={false}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders ComparisonPanel", () => {
    const activity = {
      planned_comparison: {
        workout_title: "Tempo run",
        summary: {
          has_planned_distance: true,
          duration_delta_min: 1.2,
          duration_match_pct: 95,
          distance_delta_km: 0.1,
          distance_match_pct: 92,
        },
        compliance_status: "completed_green",
      },
    } as any;
    wrap(
      <ComparisonPanel
        activity={activity}
        executionTraceRows={[]}
        executionTraceMeta={{
          usedWeightPct: 100,
          weightedTotalPoints: 90,
          normalizationDivisor: 1,
          reconstructedScorePct: 90,
          thresholds: [{ status: "green", minScorePct: 80 }],
        }}
        executionInfoOpen={false}
        setExecutionInfoOpen={() => {}}
        formatPace={(s) => `${s}`}
        ui={ui}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders SelectedSegmentSummary in null and active states", () => {
    wrap(
      <SelectedSegmentSummary
        stats={null}
        me={me}
        supportsPaceSeries
        onClear={() => {}}
        formatElapsedFromMinutes={() => "1m"}
        ui={ui}
        t={t}
      />,
    );
    wrap(
      <SelectedSegmentSummary
        stats={{
          avgHr: 150,
          maxHr: 170,
          avgPower: 200,
          maxPower: 250,
          avgSpeed: 3.5,
          maxSpeed: 4.2,
          startMin: 0,
          endMin: 10,
          durationMin: 10,
        }}
        me={me}
        supportsPaceSeries
        onClear={() => {}}
        formatElapsedFromMinutes={() => "10m"}
        ui={ui}
        t={t}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders CommentsPanel", () => {
    wrap(<CommentsPanel entityType="activity" entityId={5} athleteId={1} />);
    expect(document.body.textContent).toBeTruthy();
  });
});

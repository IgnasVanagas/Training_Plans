import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ActivityDetailPage } from "./ActivityDetailPage";

const { apiMock, personalRecordsMock } = vi.hoisted(() => ({
  apiMock: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  personalRecordsMock: vi.fn(),
}));

let currentMe: any;
let currentActivity: any;

vi.mock("../api/client", () => ({
  default: apiMock,
}));

vi.mock("../api/activities", () => ({
  getPersonalRecords: (...args: any[]) => personalRecordsMock(...args),
}));

vi.mock("../i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("../utils/localSnapshot", () => ({
  readSnapshot: vi.fn(() => undefined),
  writeSnapshot: vi.fn(),
}));

vi.mock("@mantine/hooks", () => ({
  useMediaQuery: vi.fn(() => true),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

vi.mock("leaflet", () => {
  const DefaultIcon = function DefaultIcon() {};
  (DefaultIcon as any).prototype = { _getIconUrl: "" };
  (DefaultIcon as any).mergeOptions = vi.fn();

  return {
    default: {
      Icon: {
        Default: DefaultIcon,
      },
    },
  };
});

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div data-testid="activity-map">{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  CircleMarker: ({ children }: any) => <div>{children}</div>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="chart-container">{children}</div>,
  LineChart: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Line: () => null,
  Bar: ({ children }: any) => <div>{children}</div>,
  Cell: () => null,
  ReferenceLine: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

vi.mock("../components/activityDetail/mapHelpers", () => ({
  MapFitBounds: () => null,
  MapPanTo: () => null,
  MapRouteInteractionLayer: () => null,
  toDistanceLabel: (value: number) => `${value.toFixed(2)} km`,
  getHeatColor: () => "#228be6",
}));

vi.mock("../components/ShareToChatModal", () => ({
  default: () => <div data-testid="share-to-chat-modal">Share modal</div>,
}));

vi.mock("../components/common/SkeletonScreens", () => ({
  ActivityDetailSkeleton: () => <div data-testid="activity-detail-skeleton">Loading</div>,
}));

vi.mock("../components/common/SupportContactButton", () => ({
  default: ({ buttonText }: { buttonText?: string }) => <button type="button">{buttonText || "Support"}</button>,
}));

vi.mock("../components/activityDetail/CommentsPanel", () => ({
  CommentsPanel: () => <div data-testid="comments-panel">Comments Panel</div>,
}));

vi.mock("../components/activityDetail/SessionFeedbackPanel", () => ({
  SessionFeedbackPanel: () => <div data-testid="session-feedback-panel">Session Feedback</div>,
}));

vi.mock("../components/activityDetail/ComparisonPanel", () => ({
  ComparisonPanel: ({ executionTraceRows }: { executionTraceRows: any[] }) => (
    <div data-testid="comparison-panel">Comparison rows: {executionTraceRows.length}</div>
  ),
}));

vi.mock("../components/activityDetail/SplitsTable", () => ({
  SplitsTable: ({ activity }: { activity: any }) => (
    <div data-testid="splits-table">Splits: {(activity.splits_metric || activity.laps || []).length}</div>
  ),
}));

vi.mock("../components/activityDetail/ChartsPanel", () => ({
  ChartsPanel: ({ chartDataLength }: { chartDataLength: number }) => (
    <div data-testid="charts-panel">Chart rows: {chartDataLength}</div>
  ),
}));

vi.mock("../components/activityDetail/HardEffortsPanel", () => ({
  HardEffortsPanel: ({ onSelectEffort, onMetaChange }: { onSelectEffort: (key: string) => void; onMetaChange: (meta: Record<string, unknown>) => void }) => (
    <div data-testid="hard-efforts-panel">
      <button
        type="button"
        onClick={() => {
          onMetaChange({
            "30s": {
              startIndex: 1,
              endIndex: 4,
              centerIndex: 2,
              seconds: 3,
              meters: 900,
              avgPower: 320,
              avgHr: 155,
              speedKmh: 36,
            },
          });
          onSelectEffort("30s");
        }}
      >
        Focus hard effort
      </button>
    </div>
  ),
}));

vi.mock("../components/activityDetail/BestEffortsPanel", () => ({
  BestEffortsPanel: ({ rankedBestEfforts, onSelectEffort }: { rankedBestEfforts: any[]; onSelectEffort: (key: string) => void }) => (
    <div data-testid="best-efforts-panel">
      <div>Best efforts: {rankedBestEfforts.length}</div>
      <button type="button" onClick={() => onSelectEffort("30s")}>Focus best effort</button>
    </div>
  ),
}));

vi.mock("../components/activityDetail/FullscreenMapModal", () => ({
  FullscreenMapModal: () => <div data-testid="fullscreen-map-modal">Fullscreen Map</div>,
}));

vi.mock("../components/activityDetail/SelectedSegmentSummary", () => ({
  SelectedSegmentSummary: () => <div data-testid="selected-segment-summary">Selected Segment</div>,
}));

const buildQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const buildCyclingActivity = () => ({
  id: 88,
  athlete_id: 9,
  filename: "Morning Ride.fit",
  created_at: "2026-03-01T08:00:00Z",
  sport: "cycling",
  distance: 26400,
  duration: 3600,
  moving_time: 3420,
  avg_speed: 7.3,
  average_hr: 148,
  average_watts: 228,
  max_hr: 176,
  max_speed: 14.2,
  max_watts: 486,
  max_cadence: 104,
  avg_cadence: 88,
  total_elevation_gain: 380,
  total_calories: 760,
  aerobic_load: 42.5,
  anaerobic_load: 12.2,
  ftp_at_time: 280,
  weight_at_time: 70,
  strava_activity_url: "https://example.com/activities/88",
  power_curve: {
    "30s": 410,
    "5min": 330,
    "20min": 295,
  },
  hr_zones: { Z1: 300, Z2: 1200, Z3: 900, Z4: 600, Z5: 300, Z6: 180, Z7: 120 },
  best_efforts: [
    { window: "30s", seconds: 3, power: 420, avg_hr: 164 },
    { window: "5min", seconds: 5, power: 332, avg_hr: 158 },
  ],
  personal_records: { "30s": 1, "5min": 2 },
  laps: [{ lap_index: 1 }, { lap_index: 2 }],
  splits_metric: [{ split: 1 }, { split: 2 }, { split: 3 }],
  planned_comparison: {
    workout_id: 11,
    workout_title: "Threshold Session",
    summary: {
      execution_score_pct: 86,
      execution_status: "good",
      execution_components: {
        duration: 88,
        distance: 81,
        intensity: 90,
        splits: 76,
      },
    },
  },
  streams: Array.from({ length: 12 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 2, 1, 8, 0, index)).toISOString(),
    distance: index * 220,
    power: 180 + index * 10,
    heart_rate: 130 + index * 2,
    speed: 6.2 + index * 0.2,
    lat: 54.68 + index * 0.001,
    lon: 25.28 + index * 0.001,
    altitude: 90 + index,
    cadence: 82 + index,
  })),
  is_deleted: false,
  notes: "Strong finish",
  rpe: 7,
});

const buildRunningActivity = () => ({
  id: 55,
  athlete_id: 7,
  filename: "Tempo Run.fit",
  created_at: "2026-03-02T07:00:00Z",
  sport: "running",
  distance: 12000,
  duration: 3000,
  moving_time: 2920,
  avg_speed: 3.9,
  average_hr: 154,
  average_watts: 0,
  max_hr: 179,
  max_speed: 5.1,
  max_watts: 0,
  max_cadence: 92,
  avg_cadence: 86,
  total_elevation_gain: 110,
  total_calories: 640,
  aerobic_load: 31.4,
  anaerobic_load: 6.8,
  ftp_at_time: null,
  weight_at_time: 64,
  strava_activity_url: null,
  power_curve: null,
  hr_zones: { Z1: 200, Z2: 700, Z3: 900, Z4: 700, Z5: 300, Z6: 120, Z7: 80 },
  best_efforts: [{ distance: "1km", meters: 800, time_seconds: 230, avg_hr: 168 }],
  personal_records: { "1km": 1 },
  laps: [{ lap_index: 1 }],
  splits_metric: [{ split: 1 }, { split: 2 }],
  planned_comparison: null,
  streams: Array.from({ length: 10 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 2, 2, 7, 0, index)).toISOString(),
    distance: index * 120,
    power: null,
    heart_rate: 138 + index * 3,
    speed: 3.4 + index * 0.08,
    lat: 54.7 + index * 0.0008,
    lon: 25.3 + index * 0.0008,
    altitude: 105 + index,
    cadence: 84 + index,
  })),
  is_deleted: false,
  notes: "Tempo progression",
  rpe: 6,
});

const renderActivityDetail = (entry: string) =>
  render(
    <MantineProvider>
      <QueryClientProvider client={buildQueryClient()}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/activities/:id" element={<ActivityDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );

describe("ActivityDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    currentMe = {
      id: 7,
      email: "coach@example.com",
      role: "coach",
      profile: {
        preferred_units: "metric",
        ftp: 290,
        lt2: 4.15,
        max_hr: 188,
        timezone: "UTC",
      },
    };
    currentActivity = buildCyclingActivity();

    apiMock.get.mockImplementation(async (url: string) => {
      if (url === "/users/me") return { data: currentMe };
      if (url === `/activities/${currentActivity.id}`) return { data: currentActivity };
      if (url === `/users/athletes/${currentActivity.athlete_id}`) {
        return {
          data: {
            id: currentActivity.athlete_id,
            profile: {
              ftp: 280,
              max_hr: 186,
              preferred_units: "metric",
            },
          },
        };
      }
      if (url === `/users/athletes/${currentMe.id}/permissions`) {
        return { data: { permissions: { allow_delete_activities: true } } };
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    apiMock.post.mockResolvedValue({ data: {} });
    apiMock.patch.mockResolvedValue({ data: currentActivity });
    apiMock.delete.mockResolvedValue({ data: {} });

    personalRecordsMock.mockResolvedValue({
      power: {
        "30s": [{ value: 450 }],
        "5min": [{ value: 338 }],
        "20min": [{ value: 300 }],
      },
    });
  });

  it("renders a loaded cycling activity and exposes the main detail sections", async () => {
    const user = userEvent.setup();

    renderActivityDetail("/activities/88");

    expect(await screen.findByText("Morning Ride.fit")).toBeInTheDocument();
    expect(screen.getByText("26.40 km")).toBeInTheDocument();
    expect(screen.getByText("Weighted Avg Power (WAP)")).toBeInTheDocument();
    expect(screen.getByTestId("activity-map")).toBeInTheDocument();
    expect(screen.getByText("Power Zones")).toBeInTheDocument();
    expect(screen.getByText("Comparison")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Charts" }));
    expect(await screen.findByTestId("charts-panel")).toHaveTextContent("Chart rows: 12");

    await user.click(screen.getByRole("tab", { name: "Power Zones" }));
    await waitFor(() => {
      expect(screen.getAllByText("Z1").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("tab", { name: "Hard Efforts" }));
    expect(await screen.findByTestId("hard-efforts-panel")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Focus hard effort" }));

    await user.click(screen.getByRole("tab", { name: "Laps" }));
    expect(await screen.findByTestId("splits-table")).toHaveTextContent("Splits: 3");

    await user.click(screen.getByRole("tab", { name: "Best Efforts" }));
    expect(await screen.findByTestId("best-efforts-panel")).toHaveTextContent("Best efforts: 2");
    await user.click(screen.getByRole("button", { name: "Focus best effort" }));

    await user.click(screen.getByRole("tab", { name: "Comparison" }));
    expect(await screen.findByTestId("comparison-panel")).toHaveTextContent("Comparison rows: 4");
  }, 15000);

  it("renders running-specific metrics and pace zones", async () => {
    const user = userEvent.setup();

    currentMe = {
      ...currentMe,
      role: "athlete",
      email: "runner@example.com",
      id: 55,
      profile: {
        preferred_units: "metric",
        lt2: 4.05,
        max_hr: 190,
        timezone: "UTC",
      },
    };
    currentActivity = buildRunningActivity();

    renderActivityDetail("/activities/55");

    expect(await screen.findByText("Tempo Run.fit")).toBeInTheDocument();
    expect(screen.getAllByText("Avg Pace").length).toBeGreaterThan(0);
    expect(screen.getByText("Pace Intensity (PI)")).toBeInTheDocument();
    expect(screen.getByText("Run Load (RL)")).toBeInTheDocument();
    expect(screen.getByText("Pace Zones")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Pace Zones" }));

    await waitFor(() => {
      expect(screen.getAllByText(/Z[1-7]/).length).toBeGreaterThan(0);
    });
  });
});
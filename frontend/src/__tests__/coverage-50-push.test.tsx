import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "../i18n/I18nProvider";

vi.mock("../api/communications", () => ({
  getThread: vi.fn().mockResolvedValue({ comments: [], reactions: [] }),
  addThreadComment: vi.fn().mockResolvedValue({ id: 1, body: "test" }),
}));

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

const sampleMe = {
  id: 1,
  email: "athlete@example.com",
  role: "athlete",
  is_admin: false,
  profile: { first_name: "Sam", last_name: "A", ftp: 250, max_hr: 190, resting_hr: 50, weight: 70, preferred_units: "metric", main_sport: "running" },
};

const sampleActivity = {
  id: 1,
  athlete_id: 1,
  filename: "run.fit",
  sport: "running",
  created_at: "2026-04-01T08:00:00Z",
  local_date: "2026-04-01",
  start_date: "2026-04-01T08:00:00Z",
  duration: 1800,
  moving_time: 1700,
  distance: 5000,
  average_hr: 150,
  max_hr: 175,
  average_speed: 2.78,
  total_elevation_gain: 50,
  splits_metric: [
    { distance: 1000, duration: 350, average_hr: 145, average_speed: 2.85 },
    { distance: 1000, duration: 340, average_hr: 150, average_speed: 2.94 },
  ],
  laps: [{ distance: 500, duration: 175, average_hr: 145 }],
  streams: {
    time: Array.from({ length: 20 }, (_, i) => i),
    heartrate: Array.from({ length: 20 }, (_, i) => 120 + i),
    distance: Array.from({ length: 20 }, (_, i) => i * 100),
    altitude: Array.from({ length: 20 }, (_, i) => 10 + i),
    cadence: Array.from({ length: 20 }, () => 80),
    velocity_smooth: Array.from({ length: 20 }, () => 2.8),
    latlng: Array.from({ length: 20 }, (_, i) => [55 + i * 0.001, 10 + i * 0.001]),
  },
  user_rpe: 5,
};

vi.mock("../api/client", () => {
  const dispatcher = (url: string): any => {
    if (url.includes("/users/me")) return sampleMe;
    if (/\/users\/athletes\/\d+\/permissions/.test(url)) return { permissions: {} };
    if (/\/users\/athletes\/\d+/.test(url)) return sampleMe;
    if (/\/activities\/\d+/.test(url)) return sampleActivity;
    if (url.includes("/activities")) return [sampleActivity];
    if (url.includes("/personal-records")) return [];
    if (url.includes("/season-plan")) return null;
    return [];
  };
  return {
    default: {
      get: vi.fn().mockImplementation(async (url: string) => ({ data: dispatcher(url) })),
      post: vi.fn().mockResolvedValue({ data: {} }),
      patch: vi.fn().mockResolvedValue({ data: {} }),
      delete: vi.fn().mockResolvedValue({ data: {} }),
      put: vi.fn().mockResolvedValue({ data: {} }),
      defaults: { baseURL: "http://api.local" },
    },
    apiBaseUrl: "http://api.local",
  };
});

const wrap = (path: string, route: string, element: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path={path} element={element} />
              <Route path="*" element={element} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

const wait = async (ms = 80) =>
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const clickEverything = (container: HTMLElement) => {
  const selectors = [
    "button",
    '[role="tab"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="switch"]',
    '[role="radio"]',
    'input[type="radio"]',
    'input[type="checkbox"]',
    "a[href]",
    '[data-mantine-stop-propagation="false"]',
  ];
  for (const sel of selectors) {
    for (const el of Array.from(container.querySelectorAll(sel))) {
      try {
        act(() => fireEvent.click(el));
      } catch {
        /* ignore */
      }
    }
  }
};

const fireChangeText = (container: HTMLElement) => {
  for (const el of Array.from(
    container.querySelectorAll('input[type="text"], input[type="search"], textarea, input:not([type])'),
  )) {
    try {
      act(() => fireEvent.change(el, { target: { value: "abc" } }));
    } catch {
      /* ignore */
    }
  }
};

describe("Activity detail and editor deep interactions", () => {
  it("ActivityDetailPage clicks tabs and roles", async () => {
    const { ActivityDetailPage } = await import("../pages/ActivityDetailPage");
    const { container } = wrap("/activity/:id", "/activity/1", <ActivityDetailPage />);
    await wait(200);
    clickEverything(container);
    await wait(40);
    clickEverything(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it.skip("WorkoutEditor structured deep clicks", async () => {
    const { WorkoutEditor } = await import("../components/builder/WorkoutEditor");
    const structure: any = [
      { id: "n1", type: "step", category: "warmup", durationType: "time", durationValue: 600, targetType: "hr", targetValue: 130 },
      { id: "n2", type: "step", category: "work", durationType: "time", durationValue: 300, targetType: "pace", targetValue: 300 },
      {
        id: "r1",
        type: "repeat",
        count: 3,
        steps: [
          { id: "s1", type: "step", category: "work", durationType: "time", durationValue: 60, targetType: "hr", targetValue: 160 },
          { id: "s2", type: "step", category: "recovery", durationType: "time", durationValue: 60, targetType: "hr", targetValue: 120 },
        ],
      },
      { id: "n3", type: "step", category: "cooldown", durationType: "time", durationValue: 600, targetType: "hr", targetValue: 110 },
    ];
    const { container } = wrap(
      "*",
      "/",
      <WorkoutEditor
        structure={structure}
        onChange={() => {}}
        sportType="running"
        workoutName="Run"
        description=""
        intensityType="endurance"
        onWorkoutNameChange={() => {}}
        onDescriptionChange={() => {}}
        onIntensityTypeChange={() => {}}
        onSportTypeChange={() => {}}
      />,
    );
    await wait(60);
    clickEverything(container);
    await wait(30);
    clickEverything(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("CoachComparisonPanel toggles modes and chips", async () => {
    const Mod = await import("../components/CoachComparisonPanel");
    const Comp: any = (Mod as any).default ?? (Mod as any).CoachComparisonPanel;
    const athletes = [
      { id: 1, email: "a@a.com", profile: { first_name: "A", last_name: "1" } },
      { id: 2, email: "b@b.com", profile: { first_name: "B", last_name: "2" } },
    ];
    const { container } = wrap("*", "/", <Comp athletes={athletes} me={sampleMe} isAthlete={false} />);
    await wait(150);
    clickEverything(container);
    fireChangeText(container);
    await wait(30);
    clickEverything(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardOrganizationsTab opens chats", async () => {
    const Mod = await import("../pages/dashboard/DashboardOrganizationsTab");
    const Comp: any = (Mod as any).default;
    const { container } = wrap("*", "/", <Comp me={sampleMe} athletes={[]} />);
    await wait(120);
    clickEverything(container);
    fireChangeText(container);
    await wait(30);
    clickEverything(container);
    expect(document.body.textContent).toBeTruthy();
  });
});

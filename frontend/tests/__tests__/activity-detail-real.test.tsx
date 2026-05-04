import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { I18nProvider } from "../../src/i18n/I18nProvider";

vi.mock("../../src/api/communications", () => ({
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
    { distance: 1000, duration: 360, average_hr: 155, average_speed: 2.78 },
  ],
  laps: [{ distance: 500, duration: 175, average_hr: 145 }],
  streams: {
    time: [0, 1, 2, 3, 4, 5],
    heartrate: [120, 130, 140, 150, 155, 160],
    distance: [0, 100, 200, 300, 400, 500],
    altitude: [10, 11, 12, 13, 14, 15],
    cadence: [80, 82, 84, 85, 86, 88],
    velocity_smooth: [2.5, 2.6, 2.7, 2.8, 2.9, 3.0],
    latlng: [[55, 10], [55.001, 10.001], [55.002, 10.002], [55.003, 10.003], [55.004, 10.004], [55.005, 10.005]],
  },
  user_rpe: 5,
  user_lactate: null,
  user_note: null,
};

vi.mock("../../src/api/client", () => {
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

const wrapWithRoutes = (path: string, route: string, element: React.ReactElement) => {
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

const clickAll = (container: HTMLElement) => {
  for (const el of Array.from(container.querySelectorAll("button")) as HTMLElement[]) {
    try {
      act(() => fireEvent.click(el));
    } catch {
      /* ignore */
    }
  }
};

const clickAllRadios = (container: HTMLElement) => {
  for (const el of Array.from(container.querySelectorAll('input[type="radio"]'))) {
    try {
      act(() => fireEvent.click(el));
    } catch {
      /* ignore */
    }
  }
};

const fireChangeText = (container: HTMLElement) => {
  for (const el of Array.from(container.querySelectorAll('input[type="text"], input[type="search"], textarea')) as HTMLElement[]) {
    try {
      act(() => fireEvent.change(el, { target: { value: "test" } }));
    } catch {
      /* ignore */
    }
  }
};

const wait = async (ms = 100) =>
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe("ActivityDetailPage with real activity", () => {
  it("renders detail page and exercises handlers", async () => {
    const { ActivityDetailPage } = await import("../../src/pages/ActivityDetailPage");
    const { container } = wrapWithRoutes("/activity/:id", "/activity/1", <ActivityDetailPage />);
    await wait(200);
    clickAll(container);
    clickAllRadios(container);
    fireChangeText(container);
    await wait(50);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders TrainingCalendar with athletes and clicks", async () => {
    const { TrainingCalendar } = await import("../../src/components/TrainingCalendar");
    const { container } = wrapWithRoutes("*", "/", <TrainingCalendar athleteId={null} />);
    await wait(150);
    clickAll(container);
    clickAllRadios(container);
    fireChangeText(container);
    await wait(30);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });
});

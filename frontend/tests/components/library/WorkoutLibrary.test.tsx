import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import { WorkoutLibrary } from "../../../src/components/library/WorkoutLibrary";

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
vi.mock("../../../src/api/workouts", () => ({
  getWorkouts: vi.fn().mockResolvedValue([]),
  deleteWorkout: vi.fn().mockResolvedValue(undefined),
  updateWorkout: vi.fn().mockResolvedValue({}),
  getRecentCoachWorkouts: vi.fn().mockResolvedValue([]),
}));

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

describe("WorkoutLibrary smoke", () => {
  it("renders without crashing", () => {
    wrap(<WorkoutLibrary />);
    expect(document.body.textContent).toBeTruthy();
  });
});

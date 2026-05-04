import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import { WorkoutEditor } from "../../../src/components/builder/WorkoutEditor";
import { WorkoutBuilder } from "../../../src/components/builder/WorkoutBuilder";
import { WorkoutVisualizer } from "../../../src/components/builder/WorkoutVisualizer";

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
  getWorkout: vi.fn().mockResolvedValue({ id: 1, name: "X", structure: [] }),
  getWorkouts: vi.fn().mockResolvedValue([]),
  createWorkout: vi.fn().mockResolvedValue({ id: 2 }),
  updateWorkout: vi.fn().mockResolvedValue({ id: 1 }),
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

const sampleStructure = [
  {
    id: "n1",
    type: "block",
    category: "warmup",
    duration: { type: "time", value: 600 },
    target: { type: "rpe", value: 3 },
  },
  {
    id: "r1",
    type: "repeat",
    repeats: 3,
    steps: [
      {
        id: "n2",
        type: "block",
        category: "work",
        duration: { type: "time", value: 60 },
        target: { type: "power", min: 200, max: 240 },
      },
      {
        id: "n3",
        type: "block",
        category: "recovery",
        duration: { type: "time", value: 60 },
        target: { type: "rpe", value: 1 },
      },
    ],
  },
] as any[];

describe("builder smoke", () => {
  it("renders WorkoutEditor with a sample structure", () => {
    wrap(
      <WorkoutEditor
        structure={sampleStructure}
        onChange={() => {}}
        sportType="cycling"
        workoutName="Test"
        description="Desc"
        intensityType="ftp"
        onWorkoutNameChange={() => {}}
        onDescriptionChange={() => {}}
        onIntensityTypeChange={() => {}}
        onSportTypeChange={() => {}}
        athleteName="Athlete"
        athleteProfile={{ ftp: 250, lt2: 4.5, max_hr: 190, resting_hr: 50, weight: 70 }}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders WorkoutEditor empty", () => {
    wrap(<WorkoutEditor structure={[]} onChange={() => {}} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders WorkoutVisualizer", () => {
    wrap(<WorkoutVisualizer steps={sampleStructure} ftp={250} weight={70} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders WorkoutBuilder", () => {
    wrap(<WorkoutBuilder />);
    expect(document.body.textContent).toBeTruthy();
  });
});

import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import { WorkoutPreviewGraph } from "./WorkoutPreviewGraph";
import type { WorkoutNode } from "../../types/workout";

const wrap = (nodes: WorkoutNode[]) =>
  render(
    <MantineProvider>
      <WorkoutPreviewGraph structure={nodes} />
    </MantineProvider>
  );

describe("WorkoutPreviewGraph", () => {
  it("renders without crashing for an empty structure", () => {
    const { container } = wrap([]);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders blocks for time-based steps with various target intensities", () => {
    const structure: WorkoutNode[] = [
      // warmup with HR zone 1 (low intensity color)
      { id: "1", type: "block", category: "warmup", duration: { type: "time", value: 600 }, target: { type: "heart_rate_zone", zone: 1 } },
      // tempo using percent_ftp (mid intensity)
      { id: "2", type: "block", category: "work", duration: { type: "time", value: 1200 }, target: { type: "power", metric: "percent_ftp", value: 88, zone: 3 } },
      // VO2 using percent_max_hr in HR-zone-style target (high intensity)
      { id: "3", type: "block", category: "work", duration: { type: "time", value: 180 }, target: { type: "heart_rate", metric: "percent_max_hr", value: 96 } as any },
      // recovery
      { id: "4", type: "block", category: "recovery", duration: { type: "time", value: 300 }, target: { type: "rpe", value: 2 } },
      // cooldown
      { id: "5", type: "block", category: "cooldown", duration: { type: "time", value: 300 }, target: { type: "heart_rate_zone", zone: 1 } },
    ] as any;

    const { container } = wrap(structure);
    // 5 segment boxes inside the container
    const innerBoxes = container.querySelectorAll('[style*="border-radius: 2px 2px 0 0"]');
    expect(innerBoxes.length).toBe(5);
  });

  it("flattens repeated step groups into segments", () => {
    const structure: WorkoutNode[] = [
      {
        id: "r",
        type: "repeat",
        repeats: 3,
        steps: [
          { id: "a", type: "block", category: "work", duration: { type: "time", value: 60 }, target: { type: "rpe", value: 9 } },
          { id: "b", type: "block", category: "recovery", duration: { type: "time", value: 60 }, target: { type: "rpe", value: 2 } },
        ],
      },
    ] as any;

    const { container } = wrap(structure);
    const innerBoxes = container.querySelectorAll('[style*="border-radius: 2px 2px 0 0"]');
    expect(innerBoxes.length).toBe(6);
  });

  it("handles distance and lap_button durations and pace targets", () => {
    const structure: WorkoutNode[] = [
      { id: "1", type: "block", category: "work", duration: { type: "distance", value: 400 }, target: { type: "pace", value: 4.5 } },
      { id: "2", type: "block", category: "work", duration: { type: "lap_button" } as any, target: { type: "percent_threshold_pace", metric: "percent_threshold_pace", value: 102 } as any },
      // power_zone fallback path (high zone) — exercises zone>=5 branch
      { id: "3", type: "block", category: "work", duration: { type: "time", value: 60 }, target: { type: "power_zone", zone: 6 } as any },
      // heart_rate_zone with zone <= 1 fallback
      { id: "4", type: "block", category: "warmup", duration: { type: "time", value: 60 }, target: { type: "heart_rate_zone", zone: 0 } as any },
    ] as any;

    const { container } = wrap(structure);
    const innerBoxes = container.querySelectorAll('[style*="border-radius: 2px 2px 0 0"]');
    expect(innerBoxes.length).toBe(4);
  });

  it("renders the expected number of segments", () => {
    const structure: WorkoutNode[] = [
      { id: "1", type: "block", category: "work", duration: { type: "time", value: 600 }, target: { type: "rpe", value: 6 } },
    ] as any;

    const { container } = wrap(structure);
    const innerBoxes = container.querySelectorAll('[style*="border-radius: 2px 2px 0 0"]');
    expect(innerBoxes.length).toBe(1);
  });
});

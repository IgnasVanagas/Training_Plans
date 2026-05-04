import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDefaultBlock,
  createDefaultRepeat,
  createDefaultTarget,
  createStarterPreset,
  createZoneBlock,
  edgeColorFromZone,
  estimateTotals,
  flattenBlocks,
  formatHms,
  formatPace,
  formatSecondsHm,
  hrZoneRows,
  inferIntensityZone,
  intensityPercentForStep,
  nodeCategory,
  normalizePaceSeconds,
  paceZoneRows,
  parseHms,
  parsePaceInput,
  powerZoneRows,
} from "../../../src/components/builder/workoutEditorUtils";

describe("workoutEditorUtils", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
  });

  it("formats and parses time and pace helpers", () => {
    expect(normalizePaceSeconds(null)).toBeNull();
    expect(normalizePaceSeconds(5.5)).toBe(330);
    expect(normalizePaceSeconds(330)).toBe(330);

    expect(formatHms(3661)).toBe("01:01:01");
    expect(formatHms(null)).toBe("");
    expect(parseHms("01:01:01")).toBe(3661);
    expect(parseHms("05:30")).toBe(330);
    expect(parseHms("bad")).toBe(0);

    expect(formatPace(305)).toBe("5:05/km");
    expect(parsePaceInput("5:05/km")).toBe(305);
    expect(parsePaceInput("5.5")).toBe(330);
    expect(parsePaceInput("bad value")).toBe(300);

    expect(formatSecondsHm(3660)).toBe("1h 1m");
    expect(formatSecondsHm(undefined)).toBe("-");
  });

  it("builds zone rows and default targets", () => {
    expect(powerZoneRows(250)[0]).toEqual({ zone: 1, low: 50, high: 55, label: "125 - 138 W" });
    expect(hrZoneRows(200)[4]).toEqual({ zone: 5, low: 91, high: 100, label: "182 - 200 bpm" });
    expect(paceZoneRows(300)[0]).toEqual({ zone: 1, low: 120, high: 113, label: "6:00/km - 5:39/km" });
    expect(createDefaultTarget()).toEqual({
      type: "power",
      metric: "percent_ftp",
      value: 75,
      unit: "%",
      zone: 2,
      min: 56,
      max: 75,
    });
  });

  it("creates default blocks, repeats, and starter presets", () => {
    const warmup = createDefaultBlock("warmup");
    const runningBlock = createZoneBlock("work", 6, "running");
    const repeat = createDefaultRepeat();
    const intervals = createStarterPreset("intervals");
    const recovery = createStarterPreset("recovery");

    expect(warmup.category).toBe("warmup");
    expect(warmup.duration.value).toBe(600);
    expect(warmup.target.zone).toBe(1);

    expect(runningBlock.target.metric).toBe("percent_max_hr");
    expect(runningBlock.target.zone).toBe(5);

    expect(repeat.type).toBe("repeat");
    expect(repeat.repeats).toBe(1);
    expect(repeat.steps).toHaveLength(2);

    expect(intervals).toHaveLength(3);
    expect(intervals[1]).toMatchObject({ type: "repeat", repeats: 5 });
    expect(recovery[1]).toMatchObject({ type: "block", duration: { type: "time", value: 1800 } });
  });

  it("estimates totals and flattens repeat structures", () => {
    const repeat = createDefaultRepeat();
    repeat.repeats = 2;

    const distanceBlock = {
      ...createDefaultBlock("work"),
      duration: { type: "distance", value: 1000 },
    } as ReturnType<typeof createDefaultBlock>;

    expect(estimateTotals([repeat, distanceBlock])).toEqual({
      totalSeconds: 1200,
      totalDistanceKm: 1,
    });

    expect(flattenBlocks([repeat])).toHaveLength(4);
    expect(nodeCategory(distanceBlock)).toBe("work");
    expect(nodeCategory(repeat)).toBe("work");
  });

  it("infers visual intensity from targets", () => {
    const defaultBlock = createDefaultBlock("work");
    const noZoneBlock = {
      ...createDefaultBlock("work"),
      target: {
        ...createDefaultBlock("work").target,
        zone: undefined,
        value: 121,
      },
    } as ReturnType<typeof createDefaultBlock>;
    const rpeBlock = {
      ...createDefaultBlock("work"),
      target: {
        type: "rpe",
        metric: "rpe_scale",
        value: 8,
        unit: "RPE",
      },
    } as ReturnType<typeof createDefaultBlock>;
    const wattsBlock = {
      ...createDefaultBlock("work"),
      target: {
        ...createDefaultBlock("work").target,
        zone: undefined,
        metric: "watts",
        value: 250,
      },
    } as ReturnType<typeof createDefaultBlock>;

    expect(inferIntensityZone(defaultBlock)).toBe(defaultBlock.target.zone);
    expect(inferIntensityZone(noZoneBlock)).toBe(6);

    expect(edgeColorFromZone(1)).toBe("var(--mantine-color-gray-5)");
    expect(edgeColorFromZone(2)).toBe("var(--mantine-color-green-5)");
    expect(edgeColorFromZone(4)).toBe("var(--mantine-color-orange-5)");
    expect(edgeColorFromZone(6)).toBe("var(--mantine-color-violet-6)");

    expect(intensityPercentForStep(defaultBlock)).toBe(defaultBlock.target.value);
    expect(intensityPercentForStep(rpeBlock)).toBe(35);
    expect(intensityPercentForStep(wattsBlock)).toBe(140);
  });
});
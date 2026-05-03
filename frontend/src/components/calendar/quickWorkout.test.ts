import { describe, expect, it } from "vitest";

import {
  buildQuickWorkoutDescription,
  buildQuickWorkoutStructure,
  buildQuickWorkoutZoneDetails,
} from "./quickWorkout";

describe("quick workout helpers", () => {
  it("prefers running pace and heart-rate zone settings when present", () => {
    const runningProfile = {
      zone_settings: {
        running: {
          pace: { upper_bounds: [5.5, 5.0, 4.5] },
          hr: { upper_bounds: [140, 155, 170] },
        },
      },
    };

    expect(buildQuickWorkoutZoneDetails("running", 2, runningProfile)).toBe("Pace 5:30/km-5:00/km");
    expect(buildQuickWorkoutZoneDetails("run", 3, { zone_settings: { running: { hr: { upper_bounds: [140, 155, 170] } } } })).toBe("HR 155 bpm-170 bpm");
  });

  it("falls back through running LT2 and max-HR defaults", () => {
    expect(buildQuickWorkoutZoneDetails("running", 4, { lt2: 5 })).toBe("Pace 5:09/km-4:51/km");
    expect(buildQuickWorkoutZoneDetails("running", 8, { max_hr: 190 })).toBe("HR 181-190 bpm");
  });

  it("resolves cycling power and HR details before FTP fallback", () => {
    const cyclingPowerProfile = {
      zone_settings: {
        cycling: {
          power: { upper_bounds: [120, 180, 240] },
        },
      },
    };
    const cyclingHrProfile = {
      zone_settings: {
        cycling: {
          hr: { upper_bounds: [130, 145, 160] },
        },
      },
    };

    expect(buildQuickWorkoutZoneDetails("cycling", 2, cyclingPowerProfile)).toBe("Power 120 W-180 W");
    expect(buildQuickWorkoutZoneDetails("bike", 3, cyclingHrProfile)).toBe("HR 145 bpm-160 bpm");
    expect(buildQuickWorkoutZoneDetails("cycling", 8, { ftp: 250 })).toBe("Power 378-500 W");
    expect(buildQuickWorkoutZoneDetails("cycling", 2, {})).toBe("");
  });

  it("builds time and distance workout structures with minimum bounds", () => {
    expect(buildQuickWorkoutStructure("time", "running", 0, 2, 0)).toEqual([
      expect.objectContaining({
        type: "block",
        category: "work",
        duration: { type: "time", value: 300 },
        target: expect.objectContaining({ type: "heart_rate_zone", zone: 1, min: 50, max: 60 }),
      }),
    ]);

    expect(buildQuickWorkoutStructure("distance", "cycling", 3, 0, 0.4)).toEqual([
      expect.objectContaining({
        duration: { type: "distance", value: 1000 },
        target: expect.objectContaining({ type: "power", zone: 3, min: 76, max: 90 }),
      }),
    ]);
  });

  it("formats quick workout descriptions", () => {
    expect(buildQuickWorkoutDescription("time", 45, 0, 3, "HR 140-155 bpm")).toBe(
      "Quick workout: 0h 45m in zone 3 (HR 140-155 bpm)"
    );
    expect(buildQuickWorkoutDescription("distance", 0, 12, 2, "")).toBe("Quick workout: 12 km in zone 2");
  });
});
import { describe, expect, it } from "vitest";

import {
  formatHrZoneLabel,
  getDefaultHrZonePcts,
  getHrZoneClassifierBounds,
  resolveHrZoneRows,
} from "../../src/utils/hrZones";

describe("hrZones", () => {
  it("returns defaults for running", () => {
    const defaults = getDefaultHrZonePcts("running");
    expect(defaults.length).toBe(5);
    expect(defaults[0]).toEqual([65, 84]);
  });

  it("resolves default rows when no profile threshold", () => {
    const result = resolveHrZoneRows({}, "running");
    expect(result.threshold).toBeNull();
    expect(result.rows.length).toBe(5);
    expect(result.rows[0].lowAbs).toBeNull();
  });

  it("resolves absolute bounds from provided upper bounds", () => {
    const profile = {
      zone_settings: {
        running: {
          hr: {
            lt2: 170,
            upper_bounds: [143, 151, 160, 168],
          },
        },
      },
    };

    const result = resolveHrZoneRows(profile, "running");
    expect(result.threshold).toBe(170);
    expect(result.rows.length).toBe(5);
    expect(result.rows[0].highAbs).toBeGreaterThan(0);
  });

  it("converts percentage-looking stored bounds to absolute", () => {
    const profile = {
      zone_settings: {
        running: {
          hr: {
            lt2: 170,
            upper_bounds: [84, 89, 94, 99],
          },
        },
      },
    };

    const result = resolveHrZoneRows(profile, "running");
    expect(result.rows.length).toBe(5);
    expect(result.rows[0].highAbs).toBeCloseTo(Math.round((170 * 84) / 100), 0);
  });

  it("formats first and last zone labels", () => {
    const profile = {
      zone_settings: {
        running: {
          hr: {
            lt2: 170,
            upper_bounds: [143, 151, 160, 168],
          },
        },
      },
    };

    expect(formatHrZoneLabel(profile, "running", 1)).toMatch(/^< /);
    expect(formatHrZoneLabel(profile, "running", 5)).toMatch(/^> /);
  });

  it("returns null label for missing zone index", () => {
    const profile = { zone_settings: {} };
    expect(formatHrZoneLabel(profile, "running", 999)).toBeNull();
  });

  it("returns classifier bounds without last zone", () => {
    const profile = {
      zone_settings: {
        running: {
          hr: {
            lt2: 170,
            upper_bounds: [143, 151, 160, 168],
          },
        },
      },
    };

    const out = getHrZoneClassifierBounds(profile, "running");
    expect(out.rows.length).toBe(5);
    expect(out.upperBounds.length).toBe(4);
    expect(out.upperBounds.every((v) => v > 0)).toBe(true);
  });
});

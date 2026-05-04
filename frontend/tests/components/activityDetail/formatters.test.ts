import { describe, expect, it } from "vitest";

import {
  calculateNormalizedPower,
  formatDuration,
  formatZoneDuration,
  toTimestampMs,
} from "../../../src/components/activityDetail/formatters";

describe("activity detail formatters", () => {
  it("normalizes timestamps from numbers, dates, and strings", () => {
    const date = new Date("2024-03-01T10:00:00Z");

    expect(toTimestampMs(1234)).toBe(1234);
    expect(toTimestampMs(date)).toBe(date.getTime());
    expect(toTimestampMs("2024-03-01T10:00:00")).toBe(Date.parse("2024-03-01T10:00:00Z"));
    expect(toTimestampMs("not-a-date")).toBeNaN();
    expect(toTimestampMs(null)).toBeNaN();
  });

  it("calculates normalized power from short and rolling sample windows", () => {
    expect(calculateNormalizedPower([])).toBeNull();
    expect(calculateNormalizedPower([150, 150, 150])).toBe(150);
    expect(calculateNormalizedPower(Array.from({ length: 40 }, () => 200))).toBe(200);
  });

  it("formats durations for charts and zone summaries", () => {
    expect(formatDuration(3661)).toBe("1h 1m 1s");
    expect(formatDuration(61.2, true)).toBe("1m 1.2s");
    expect(formatDuration(-5)).toBe("0m 0s");
    expect(formatZoneDuration(3661)).toBe("1h 1m");
  });
});
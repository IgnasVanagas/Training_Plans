import { describe, expect, it } from "vitest";

import {
  compareValue,
  cyclingZoneFromPower,
  formatMinutes,
  formatName,
  formatPace,
  normalizeSport,
  parseMonthLabel,
  parseWeekLabel,
  runningZoneFromHr,
  safeNum,
  toMonthKey,
  toWeekKey,
} from "../../../src/components/coachComparison/utils";

describe("coachComparison utils", () => {
  it("normalizes sport names", () => {
    expect(normalizeSport("Running")).toBe("running");
    expect(normalizeSport("Bike Ride")).toBe("cycling");
    expect(normalizeSport("Yoga")).toBe("other");
  });

  it("formats athlete name and falls back to email", () => {
    expect(
      formatName({ id: 1, email: "a@x.com", profile: { first_name: "A", last_name: "B" } })
    ).toBe("A B");
    expect(formatName({ id: 1, email: "a@x.com" })).toBe("a@x.com");
  });

  it("builds month and week keys", () => {
    expect(toMonthKey("2026-04-20")).toBe("2026-04");
    expect(toWeekKey("2026-04-20")).toBe("2026-04-20");
  });

  it("parses month/week labels to display strings", () => {
    expect(parseMonthLabel("2026-04").toLowerCase()).toContain("2026");
    expect(parseWeekLabel("2026-04-20")).toContain("2026");
  });

  it("safeNum sanitizes non numeric values", () => {
    expect(safeNum(10)).toBe(10);
    expect(safeNum("10")).toBe(0);
    expect(safeNum(NaN)).toBe(0);
  });

  it("calculates running HR zones", () => {
    expect(runningZoneFromHr(110, 200)).toBe(1);
    expect(runningZoneFromHr(130, 200)).toBe(2);
    expect(runningZoneFromHr(150, 200)).toBe(3);
    expect(runningZoneFromHr(170, 200)).toBe(4);
    expect(runningZoneFromHr(190, 200)).toBe(5);
  });

  it("calculates cycling power zones", () => {
    expect(cyclingZoneFromPower(120, 300)).toBe(1);
    expect(cyclingZoneFromPower(210, 300)).toBe(2);
    expect(cyclingZoneFromPower(270, 300)).toBe(3);
    expect(cyclingZoneFromPower(300, 300)).toBe(4);
    expect(cyclingZoneFromPower(340, 300)).toBe(5);
    expect(cyclingZoneFromPower(420, 300)).toBe(6);
    expect(cyclingZoneFromPower(500, 300)).toBe(7);
  });

  it("formats duration, pace and value diffs", () => {
    expect(formatMinutes(125)).toBe("2h 5m");
    expect(formatPace(4.5)).toBe("4:30/km");
    expect(formatPace(null)).toBe("-");
    expect(compareValue(10, 12, "%")).toBe("+2.0%");
    expect(compareValue(12, 10, "")).toBe("-2.0");
    expect(compareValue(null, 10)).toBe("-");
  });
});

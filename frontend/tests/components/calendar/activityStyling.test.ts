import { describe, it, expect } from "vitest";
import {
  resolveActivityBrandType,
  resolveActivityAccentColor,
  resolveActivityPillLabel,
  resolveWeekAccentColor,
} from "../../../src/components/calendar/activityStyling";

const colors: any = {
  run: "#run",
  cycling: "#cycling",
  swim: "#swim",
  walk: "#walk",
  hike: "#hike",
  workout: "#workout",
  virtual: "#virtual",
  rest: "#rest",
  default: "#default",
};

describe("activityStyling", () => {
  it("resolveActivityBrandType maps known sports", () => {
    expect(resolveActivityBrandType("Run")).toBe("run");
    expect(resolveActivityBrandType("Running")).toBe("run");
    expect(resolveActivityBrandType("Cycling")).toBe("cycling");
    expect(resolveActivityBrandType("VirtualRide")).toBe("virtual");
    expect(resolveActivityBrandType("Swim")).toBe("swim");
    expect(resolveActivityBrandType("Walk")).toBe("walk");
    expect(resolveActivityBrandType("Hike")).toBe("hike");
    expect(resolveActivityBrandType("Workout")).toBe("workout");
    expect(resolveActivityBrandType("Rest")).toBe("rest");
    expect(resolveActivityBrandType("", "Easy run")).toBe("run");
    expect(resolveActivityBrandType("", "Trail walk")).toBe("hike");
    expect(resolveActivityBrandType("", "Zwift session")).toBe("virtual");
    expect(resolveActivityBrandType("", "Gravel ride")).toBe("cycling");
    expect(resolveActivityBrandType("", "")).toBe("default");
    expect(resolveActivityBrandType()).toBe("default");
  });

  it("resolveActivityAccentColor returns mapped color", () => {
    expect(resolveActivityAccentColor(colors, "Run")).toBe("#run");
    expect(resolveActivityAccentColor(colors, undefined, "Cycling")).toBe("#cycling");
    expect(resolveActivityAccentColor(colors, undefined, undefined)).toBe("#default");
  });

  it("resolveActivityPillLabel returns localized labels", () => {
    expect(resolveActivityPillLabel("Run")).toBe("Run");
    expect(resolveActivityPillLabel("Cycling")).toBe("Ride");
    expect(resolveActivityPillLabel("VirtualRide")).toBe("Virtual Ride");
    expect(resolveActivityPillLabel("Workout")).toBe("Workout");
    expect(resolveActivityPillLabel("Swim")).toBe("Swim");
    expect(resolveActivityPillLabel("Walk")).toBe("Walk");
    expect(resolveActivityPillLabel("Hike")).toBe("Hike");
    expect(resolveActivityPillLabel("Rest")).toBe("Rest Day");
    expect(resolveActivityPillLabel("Other")).toBe("Session");
  });

  it("resolveWeekAccentColor handles empty and majority cases", () => {
    expect(resolveWeekAccentColor([], colors)).toBe("#default");
    const rows = [
      { sport_type: "Run" },
      { sport_type: "Run" },
      { sport_type: "Cycling" },
    ];
    expect(resolveWeekAccentColor(rows, colors)).toBe("#run");
  });
});

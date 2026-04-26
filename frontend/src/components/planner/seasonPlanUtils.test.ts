import { describe, expect, it } from "vitest";

import {
  athleteLabel,
  defaultPeriodization,
  defaultPlan,
  emptyConstraint,
  emptyMetric,
  emptyRace,
  normalizePlan,
  removeMetric,
  setMetricField,
  setPlanField,
  setPeriodizationField,
} from "./seasonPlanUtils";

describe("seasonPlanUtils", () => {
  it("creates empty templates", () => {
    expect(emptyMetric()).toEqual({ metric: "", value: "", unit: "" });
    expect(emptyRace().priority).toBe("A");
    expect(emptyConstraint().kind).toBe("travel");
  });

  it("builds default periodization", () => {
    const p = defaultPeriodization();
    expect(p.weekly_hours_target).toBe(8);
    expect(p.periodization_model).toBe("polarized");
  });

  it("builds athlete label from profile and fallback email", () => {
    expect(athleteLabel({ profile: { first_name: "A", last_name: "B" }, email: "x@y.com" } as any)).toBe("A B");
    expect(athleteLabel({ email: "x@y.com" } as any)).toBe("x@y.com");
    expect(athleteLabel(null)).toBe("");
  });

  it("creates default plan", () => {
    const plan = defaultPlan("running", "Alex");
    expect(plan.sport_type).toBe("running");
    expect(plan.name).toContain("Alex");
    expect(plan.goal_races.length).toBe(1);
  });

  it("normalizes null plan to defaults", () => {
    const plan = normalizePlan(null, "cycling", "Rider");
    expect(plan.sport_type).toBe("cycling");
    expect(plan.target_metrics.length).toBe(1);
  });

  it("applies immutable update helpers", () => {
    const initial = defaultPlan("running", "Athlete");
    const changedName = setPlanField(initial, "name", "New Plan");
    const changedWeekly = setPeriodizationField(initial, "weekly_hours_target", 12);
    const changedMetric = setMetricField(initial, 0, "metric", "ftp");

    expect(changedName.name).toBe("New Plan");
    expect(initial.name).not.toBe("New Plan");
    expect(changedWeekly.periodization.weekly_hours_target).toBe(12);
    expect(changedMetric.target_metrics[0].metric).toBe("ftp");
  });

  it("removeMetric keeps at least one row", () => {
    const initial = defaultPlan("running", "Athlete");
    const out = removeMetric(initial, 0);
    expect(out.target_metrics.length).toBe(1);
  });
});

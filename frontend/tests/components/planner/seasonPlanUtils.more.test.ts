import { describe, expect, it } from "vitest";
import {
  normalizePlan,
  removeMetric,
  setRaceField,
  removeRace,
  setRaceMetricField,
  removeRaceMetric,
  setConstraintField,
  removeConstraint,
} from "../../../src/components/planner/seasonPlanUtils";

describe("seasonPlanUtils additional helpers", () => {
  it("normalizes existing plan preserving fields and back-filling metrics", () => {
    const plan = {
      id: 1,
      athlete_id: 2,
      name: "Plan",
      sport_type: "running",
      season_start: "2026-01-01",
      season_end: "2026-12-31",
      notes: null,
      target_metrics: [],
      goal_races: [
        { name: "Race", date: "2026-06-01", priority: "A", sport_type: "running", distance_km: null, expected_time: "", location: "", notes: "", target_metrics: [] },
      ],
      constraints: [],
      periodization: undefined,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
    } as any;
    const out = normalizePlan(plan, "running", "Athlete");
    expect(out.id).toBe(1);
    expect(out.target_metrics.length).toBe(1);
    expect(out.goal_races[0].target_metrics.length).toBe(1);
    expect(out.periodization.weekly_hours_target).toBeGreaterThan(0);
  });

  it("removeMetric drops single empty row but keeps minimum one", () => {
    const initial = {
      id: null,
      name: "p",
      sport_type: "running",
      season_start: "2026-01-01",
      season_end: "2026-06-01",
      notes: "",
      target_metrics: [
        { metric: "ftp", value: "250", unit: "W" },
        { metric: "vo2max", value: "60", unit: "" },
      ],
      goal_races: [],
      constraints: [],
      periodization: { weekly_hours_target: 8, longest_session_minutes: 90, training_days_per_week: 5, recovery_week_frequency: 4, taper_profile: "standard", periodization_model: "polarized" },
    } as any;
    const out = removeMetric(initial, 0);
    expect(out.target_metrics.length).toBe(1);
    expect(out.target_metrics[0].metric).toBe("vo2max");
  });

  it("setRaceField updates a single race", () => {
    const initial = {
      id: null,
      name: "p",
      sport_type: "running",
      season_start: "2026-01-01",
      season_end: "2026-06-01",
      notes: "",
      target_metrics: [],
      goal_races: [
        { name: "old", date: "2026-06-01", priority: "A", sport_type: "running", distance_km: null, expected_time: "", location: "", notes: "", target_metrics: [{ metric: "", value: "", unit: "" }] },
      ],
      constraints: [],
      periodization: { weekly_hours_target: 8, longest_session_minutes: 90, training_days_per_week: 5, recovery_week_frequency: 4, taper_profile: "standard", periodization_model: "polarized" },
    } as any;
    const out = setRaceField(initial, 0, "name", "New");
    expect(out.goal_races[0].name).toBe("New");
    const out2 = removeRace(out, 0);
    expect(out2.goal_races.length).toBe(0);
  });

  it("setRaceMetricField/removeRaceMetric updates and removes nested metrics", () => {
    const base = {
      id: null,
      name: "p",
      sport_type: "running",
      season_start: "2026-01-01",
      season_end: "2026-06-01",
      notes: "",
      target_metrics: [],
      goal_races: [
        {
          name: "race",
          date: "2026-06-01",
          priority: "A",
          sport_type: "running",
          distance_km: null,
          expected_time: "",
          location: "",
          notes: "",
          target_metrics: [
            { metric: "pace", value: "4:00", unit: "/km" },
            { metric: "hr", value: "170", unit: "bpm" },
          ],
        },
      ],
      constraints: [],
      periodization: { weekly_hours_target: 8, longest_session_minutes: 90, training_days_per_week: 5, recovery_week_frequency: 4, taper_profile: "standard", periodization_model: "polarized" },
    } as any;
    const updated = setRaceMetricField(base, 0, 1, "value", "165");
    expect(updated.goal_races[0].target_metrics[1].value).toBe("165");
    const removed = removeRaceMetric(updated, 0, 0);
    expect(removed.goal_races[0].target_metrics.length).toBe(1);
    expect(removed.goal_races[0].target_metrics[0].metric).toBe("hr");
  });

  it("setConstraintField/removeConstraint update and remove", () => {
    const base = {
      id: null,
      name: "p",
      sport_type: "running",
      season_start: "2026-01-01",
      season_end: "2026-06-01",
      notes: "",
      target_metrics: [],
      goal_races: [],
      constraints: [
        { name: "Travel", kind: "travel", start_date: "2026-04-01", end_date: "2026-04-04", severity: "moderate", impact: "reduce", notes: "" },
      ],
      periodization: { weekly_hours_target: 8, longest_session_minutes: 90, training_days_per_week: 5, recovery_week_frequency: 4, taper_profile: "standard", periodization_model: "polarized" },
    } as any;
    const updated = setConstraintField(base, 0, "name", "Big trip");
    expect(updated.constraints[0].name).toBe("Big trip");
    const removed = removeConstraint(updated, 0);
    expect(removed.constraints.length).toBe(0);
  });
});

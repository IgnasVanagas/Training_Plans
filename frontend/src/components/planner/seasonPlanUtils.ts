import {
  PeriodizationConfig,
  PlannerConstraint,
  PlannerGoalRace,
  PlannerTargetMetric,
  SeasonPlan,
  SeasonPlanPayload,
} from "../../api/planning";

import { User } from "../../pages/dashboard/types";

const todayKey = () => new Date().toISOString().slice(0, 10);

const plusDays = (base: string, days: number) => {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export const emptyMetric = (): PlannerTargetMetric => ({ metric: "", value: "", unit: "" });

export const emptyRace = (): PlannerGoalRace => ({
  name: "",
  date: plusDays(todayKey(), 84),
  priority: "A",
  sport_type: "",
  distance_km: null,
  expected_time: "",
  location: "",
  notes: "",
  target_metrics: [emptyMetric()],
});

export const emptyConstraint = (): PlannerConstraint => ({
  name: "",
  kind: "travel",
  start_date: plusDays(todayKey(), 14),
  end_date: plusDays(todayKey(), 17),
  severity: "moderate",
  impact: "reduce",
  notes: "",
});

export const defaultPeriodization = (): PeriodizationConfig => ({
  weekly_hours_target: 8,
  longest_session_minutes: 180,
  training_days_per_week: 5,
  recovery_week_frequency: 4,
  taper_profile: "standard",
  periodization_model: "polarized",
});

export const athleteLabel = (athlete?: User | null) => {
  if (!athlete) return "";
  if (athlete.profile?.first_name || athlete.profile?.last_name) {
    return `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim();
  }
  return athlete.email;
};

export const defaultPlan = (sportType: string, athleteName?: string): SeasonPlanPayload => {
  const seasonStart = todayKey();
  return {
    id: null,
    name: athleteName ? `${athleteName} ${sportType} Season` : `${sportType} Season`,
    sport_type: sportType,
    season_start: seasonStart,
    season_end: plusDays(seasonStart, 168),
    notes: "",
    target_metrics: [emptyMetric()],
    goal_races: [emptyRace()],
    constraints: [],
    periodization: defaultPeriodization(),
  };
};

export const normalizePlan = (plan: SeasonPlan | null, sportType: string, athleteName?: string): SeasonPlanPayload => {
  if (!plan) {
    return defaultPlan(sportType, athleteName);
  }
  return {
    id: plan.id,
    name: plan.name,
    sport_type: plan.sport_type,
    season_start: plan.season_start,
    season_end: plan.season_end,
    notes: plan.notes || "",
    target_metrics: plan.target_metrics?.length ? plan.target_metrics : [emptyMetric()],
    goal_races: plan.goal_races?.length
      ? plan.goal_races.map((race) => ({
          ...race,
          target_metrics: race.target_metrics?.length ? race.target_metrics : [emptyMetric()],
        }))
      : [emptyRace()],
    constraints: plan.constraints || [],
    periodization: plan.periodization || defaultPeriodization(),
  };
};

// ── Immutable plan mutation helpers ──────────────────────────────────────────
// Pure functions returning a new SeasonPlanPayload. Use with setPlan().

export const setPlanField = <K extends keyof SeasonPlanPayload>(
  plan: SeasonPlanPayload,
  field: K,
  value: SeasonPlanPayload[K],
): SeasonPlanPayload => ({ ...plan, [field]: value });

export const setPeriodizationField = <K extends keyof PeriodizationConfig>(
  plan: SeasonPlanPayload,
  field: K,
  value: PeriodizationConfig[K],
): SeasonPlanPayload => ({ ...plan, periodization: { ...plan.periodization, [field]: value } });

export const setMetricField = (
  plan: SeasonPlanPayload,
  index: number,
  field: keyof PlannerTargetMetric,
  value: string,
): SeasonPlanPayload => ({
  ...plan,
  target_metrics: plan.target_metrics.map((row, i) =>
    i === index ? { ...row, [field]: value } : row,
  ),
});

export const removeMetric = (plan: SeasonPlanPayload, index: number): SeasonPlanPayload => {
  const filtered = plan.target_metrics.filter((_, i) => i !== index);
  return { ...plan, target_metrics: filtered.length ? filtered : [emptyMetric()] };
};

export const setRaceField = (
  plan: SeasonPlanPayload,
  raceIndex: number,
  field: keyof PlannerGoalRace,
  value: PlannerGoalRace[keyof PlannerGoalRace],
): SeasonPlanPayload => ({
  ...plan,
  goal_races: plan.goal_races.map((row, i) =>
    i === raceIndex ? { ...row, [field]: value } : row,
  ),
});

export const removeRace = (plan: SeasonPlanPayload, raceIndex: number): SeasonPlanPayload => ({
  ...plan,
  goal_races: plan.goal_races.filter((_, i) => i !== raceIndex),
});

export const setRaceMetricField = (
  plan: SeasonPlanPayload,
  raceIndex: number,
  metricIndex: number,
  field: keyof PlannerTargetMetric,
  value: string,
): SeasonPlanPayload => ({
  ...plan,
  goal_races: plan.goal_races.map((row, i) =>
    i === raceIndex
      ? {
          ...row,
          target_metrics: row.target_metrics.map((m, j) =>
            j === metricIndex ? { ...m, [field]: value } : m,
          ),
        }
      : row,
  ),
});

export const removeRaceMetric = (
  plan: SeasonPlanPayload,
  raceIndex: number,
  metricIndex: number,
): SeasonPlanPayload => ({
  ...plan,
  goal_races: plan.goal_races.map((row, i) =>
    i === raceIndex
      ? { ...row, target_metrics: row.target_metrics.filter((_, j) => j !== metricIndex) }
      : row,
  ),
});

export const setConstraintField = (
  plan: SeasonPlanPayload,
  index: number,
  field: keyof PlannerConstraint,
  value: PlannerConstraint[keyof PlannerConstraint],
): SeasonPlanPayload => ({
  ...plan,
  constraints: plan.constraints.map((row, i) =>
    i === index ? { ...row, [field]: value } : row,
  ),
});

export const removeConstraint = (plan: SeasonPlanPayload, index: number): SeasonPlanPayload => ({
  ...plan,
  constraints: plan.constraints.filter((_, i) => i !== index),
});
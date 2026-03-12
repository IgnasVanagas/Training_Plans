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
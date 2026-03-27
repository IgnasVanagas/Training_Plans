import api from "./client";

export type PlannerTargetMetric = {
  metric: string;
  value: string | number;
  unit?: string | null;
};

export type PlannerGoalRace = {
  name: string;
  date: string;
  priority: "A" | "B" | "C";
  sport_type?: string | null;
  distance_km?: number | null;
  expected_time?: string | null;
  location?: string | null;
  notes?: string | null;
  target_metrics: PlannerTargetMetric[];
};

export type PlannerConstraint = {
  name?: string | null;
  kind: "injury" | "travel" | "sickness" | "unavailable";
  start_date: string;
  end_date: string;
  severity: "low" | "moderate" | "high";
  impact: "reduce" | "avoid_intensity" | "rest";
  notes?: string | null;
};

export type PeriodizationConfig = {
  weekly_hours_target: number;
  longest_session_minutes: number;
  training_days_per_week: number;
  recovery_week_frequency: number;
  taper_profile: "short" | "standard" | "extended";
  periodization_model: "polarized" | "pyramidal" | "threshold";
};

export type SeasonPlanPayload = {
  id?: number | null;
  name: string;
  sport_type: string;
  season_start: string;
  season_end: string;
  notes?: string | null;
  target_metrics: PlannerTargetMetric[];
  goal_races: PlannerGoalRace[];
  constraints: PlannerConstraint[];
  periodization: PeriodizationConfig;
};

export type SeasonPlanPreview = {
  countdowns: Array<Record<string, any>>;
  season_blocks: Array<Record<string, any>>;
  macro_cycles: Array<Record<string, any>>;
  meso_cycles: Array<Record<string, any>>;
  micro_cycles: Array<Record<string, any>>;
  generated_workouts: Array<Record<string, any>>;
  load_progression: Array<Record<string, any>>;
  summary: Record<string, any>;
};

export type SeasonPlan = SeasonPlanPayload & {
  id: number;
  athlete_id: number;
  coach_id?: number | null;
  generated_summary?: SeasonPlanPreview | null;
  created_at: string;
  updated_at: string;
};

export type SeasonPlanApplyResponse = {
  plan_id: number;
  athlete_id: number;
  created_count: number;
  replaced_count: number;
  skipped_count: number;
  preserved_manual_count: number;
  preview: SeasonPlanPreview;
};

export const getLatestSeasonPlan = async (athleteId?: number | null): Promise<SeasonPlan | null> => {
  const response = await api.get<SeasonPlan | null>("/planning/season", {
    params: athleteId ? { athlete_id: athleteId } : undefined,
  });
  return response.data;
};

export const previewSeasonPlan = async (payload: SeasonPlanPayload, athleteId?: number | null): Promise<SeasonPlanPreview> => {
  const response = await api.post<SeasonPlanPreview>("/planning/season/preview", payload, {
    params: athleteId ? { athlete_id: athleteId } : undefined,
  });
  return response.data;
};

export const saveSeasonPlan = async (payload: SeasonPlanPayload, athleteId?: number | null): Promise<SeasonPlan> => {
  const response = await api.post<SeasonPlan>("/planning/season", payload, {
    params: athleteId ? { athlete_id: athleteId } : undefined,
  });
  return response.data;
};

export const applySeasonPlan = async (planId: number, replaceGenerated = true): Promise<SeasonPlanApplyResponse> => {
  const response = await api.post<SeasonPlanApplyResponse>(`/planning/season/${planId}/apply`, undefined, {
    params: { replace_generated: replaceGenerated },
  });
  return response.data;
};

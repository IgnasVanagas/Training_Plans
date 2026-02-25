import { WorkoutNode } from "../../types/workout";

export interface CalendarEvent {
  id?: number;
  user_id?: number;
  title: string;
  date: string;
  is_more_indicator?: boolean;
  hidden_count?: number;
  sport_type?: string;
  planned_duration?: number;
  planned_distance?: number;
  planned_intensity?: string;
  description?: string;
  compliance_status?: "planned" | "completed_green" | "completed_yellow" | "completed_red" | "missed";
  matched_activity_id?: number;
  structure?: WorkoutNode[];
  is_planned?: boolean;
  duration?: number;
  distance?: number;
  avg_hr?: number;
  avg_watts?: number;
  avg_speed?: number;
}

export interface ZoneSportSummary {
  activities_count: number;
  total_duration_minutes: number;
  total_distance_km: number;
  zone_seconds: Record<string, number>;
  zone_seconds_by_metric?: Record<string, Record<string, number>>;
}

export interface ZoneBucketSummary {
  activities_count: number;
  total_duration_minutes: number;
  total_distance_km: number;
  sports: {
    running: ZoneSportSummary;
    cycling: ZoneSportSummary;
  };
}

export interface AthleteZoneSummary {
  athlete_id: number;
  athlete_email?: string;
  weekly: ZoneBucketSummary;
  monthly: ZoneBucketSummary;
  weekly_activity_zones: ActivityZoneSummary[];
  monthly_activity_zones: ActivityZoneSummary[];
}

export interface ActivityZoneSummary {
  activity_id: number;
  date: string;
  sport: "running" | "cycling" | string;
  title: string;
  duration_minutes: number;
  distance_km: number;
  zone_seconds: Record<string, number>;
  zone_seconds_by_metric?: Record<string, Record<string, number>>;
}

export interface ZoneSummaryResponse {
  reference_date: string;
  week: { start_date: string; end_date: string };
  month: { start_date: string; end_date: string };
  athletes: AthleteZoneSummary[];
}

export interface AthletePermissionsResponse {
  athlete_id: number;
  permissions: {
    allow_delete_activities: boolean;
    allow_delete_workouts: boolean;
    allow_edit_workouts: boolean;
  };
}

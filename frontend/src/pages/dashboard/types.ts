export type Profile = {
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | Date | null;
  weight?: number | null;
  hrv_ms?: number | null;
  ftp?: number | null;
  lt2?: number | null;
  max_hr?: number | null;
  resting_hr?: number | null;
  sports?: string[] | null;
  zone_settings?: {
    running?: { hr?: { lt1?: number | null; lt2?: number | null; upper_bounds?: number[] | null }; pace?: { lt1?: number | null; lt2?: number | null; upper_bounds?: number[] | null } };
    cycling?: { hr?: { lt1?: number | null; lt2?: number | null; upper_bounds?: number[] | null }; power?: { lt1?: number | null; lt2?: number | null; upper_bounds?: number[] | null } };
  } | null;
  auto_sync_integrations?: boolean | null;
  main_sport?: string | null;
  timezone?: string | null;
  preferred_units?: string | null;
  week_start_day?: string | null;
};

export type User = {
  id: number;
  email: string;
  role: "coach" | "athlete" | "admin";
  profile?: Profile | null;
};

export type TrainingStatus = {
  athlete_id: number;
  reference_date: string;
  acute: {
    aerobic: number;
    anaerobic: number;
    daily_load: number;
  };
  chronic: {
    aerobic: number;
    anaerobic: number;
    daily_load: number;
  };
  training_status: string;
};

export type MetricKey = "ftp" | "rhr" | "hrv" | "aerobic_load" | "anaerobic_load" | "training_status";

export type ProfileMetricSnapshot = {
  date: string;
  ftp: number | null;
  rhr: number | null;
  hrv: number | null;
};

export type AthletePermissions = {
  athlete_id: number;
  permissions: {
    allow_delete_activities: boolean;
    allow_delete_workouts: boolean;
    allow_edit_workouts: boolean;
  };
};

export type DashboardCalendarEvent = {
  id?: number;
  user_id?: number;
  title: string;
  date: string;
  sport_type?: string;
  compliance_status?: "planned" | "completed_green" | "completed_yellow" | "completed_red" | "missed";
  is_planned?: boolean;
  planned_duration?: number;
  duration?: number;
};

export type ActivityFeedRow = {
  id: number;
  athlete_id: number;
  created_at: string;
  sport?: string;
  filename: string;
};

export type InviteResponse = {
  invite_token: string;
  invite_url: string;
};

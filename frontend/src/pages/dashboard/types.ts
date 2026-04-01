export type Profile = {
  first_name?: string | null;
  last_name?: string | null;
  gender?: string | null;
  birth_date?: string | Date | null;
  weight?: number | null;
  country?: string | null;
  contact_email?: string | null;
  contact_number?: string | null;
  menstruation_available_to_coach?: boolean | null;
  training_days?: string[] | null;
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
  email_verified?: boolean;
  role: "coach" | "athlete" | "admin";
  has_upcoming_coach_workout?: boolean;
  next_coach_workout_date?: string | null;
  coaches?: Array<{
    id: number;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    organization_ids?: number[];
    organization_names?: string[];
  }>;
  organization_memberships?: Array<{
    organization?: {
      id: number;
      name: string;
      code?: string | null;
      description?: string | null;
      picture?: string | null;
    };
    role: string;
    status: string;
  }>;
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
  atl: number;
  ctl: number;
  tsb: number;
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
  created_by_user_id?: number;
  created_by_name?: string;
  created_by_email?: string;
  title: string;
  date: string;
  sport_type?: string;
  compliance_status?: "planned" | "completed_green" | "completed_yellow" | "completed_red" | "missed";
  matched_activity_id?: number;
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

export type InviteByEmailResponse = {
  email: string;
  existing_user: boolean;
  invite_url: string;
  status: string;
  message: string;
};

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  created_at: string;
  entity_type?: string | null;
  entity_id?: number | null;
  organization_id?: number | null;
  athlete_id?: number | null;
  status?: string | null;
};

export type NotificationsFeed = {
  items: NotificationItem[];
};

export type OrganizationCoach = {
  id: number;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
};

export type OrganizationDiscoverItem = {
  id: number;
  name: string;
  description?: string | null;
  picture?: string | null;
  coaches: OrganizationCoach[];
  my_membership_status?: string | null;
};

export type OrganizationDiscoverResponse = {
  items: OrganizationDiscoverItem[];
};

export type OrgMember = {
  id: number;
  email: string;
  role: string;
  first_name?: string | null;
  last_name?: string | null;
};

export type OrganizationInboxThread = {
  key: string;
  thread_type: "group" | "coach" | "member";
  participant_id?: number | null;
  participant_role?: string | null;
  participant_name?: string | null;
  body_preview?: string | null;
  attachment_name?: string | null;
  sender_id?: number | null;
  created_at?: string | null;
};

export type OrganizationInboxResponse = {
  items: OrganizationInboxThread[];
};

export type OrganizationGroupMessage = {
  id: number;
  organization_id: number;
  sender_id: number;
  sender_role: string;
  sender_name?: string | null;
  body: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  created_at: string;
};

export type OrganizationCoachMessage = {
  id: number;
  organization_id: number;
  athlete_id: number;
  coach_id: number;
  sender_id: number;
  sender_role: string;
  sender_name?: string | null;
  body: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  created_at: string;
};

export type OrganizationDirectMessage = {
  id: number;
  organization_id: number;
  sender_id: number;
  recipient_id: number;
  sender_role: string;
  sender_name?: string | null;
  body: string;
  attachment_url?: string | null;
  attachment_name?: string | null;
  created_at: string;
};

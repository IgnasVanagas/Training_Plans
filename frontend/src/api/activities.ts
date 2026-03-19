import client from "./client";

export type ManualActivityCreate = {
  sport: string;
  date: string;
  duration: number;
  distance?: number | null;
  average_hr?: number | null;
  average_watts?: number | null;
  rpe?: number | null;
  notes?: string | null;
};

export type PREntry = {
  value: number;
  activity_id: number;
  date: string | null;
  avg_hr?: number | null;
};

export type PersonalRecordsResponse = {
  sport: string;
  power?: Record<string, PREntry[]>;
  best_efforts?: Record<string, PREntry[]>;
  has_activities_for_sport?: boolean;
  missing_best_efforts_count?: number;
  backfill_status?: "ready" | "processing";
  backfill_updated_count?: number;
  records_source?: "best_efforts" | "power_curve_fallback" | "none";
};

export const createManualActivity = async (payload: ManualActivityCreate) => {
  const response = await client.post("/activities/manual", payload);
  return response.data;
};

export const getPersonalRecords = async (sport: string, athleteId?: number | null): Promise<PersonalRecordsResponse> => {
  const params: Record<string, string | number> = { sport };
  if (athleteId) params.athlete_id = athleteId;
  const response = await client.get<PersonalRecordsResponse>("/activities/personal-records", { params });
  return response.data;
};

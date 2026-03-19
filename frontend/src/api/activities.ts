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

export const createManualActivity = async (payload: ManualActivityCreate) => {
  const response = await client.post("/activities/manual", payload);
  return response.data;
};

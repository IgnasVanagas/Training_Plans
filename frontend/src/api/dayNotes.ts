import client from "./client";

export type DayNote = {
  id: number;
  athlete_id: number;
  author_id: number;
  author_name: string | null;
  author_role: string | null;
  date: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export const getDayNotes = async (
  date: string,
  athleteId?: number,
): Promise<DayNote[]> => {
  const params: Record<string, string | number> = { date };
  if (athleteId) params.athlete_id = athleteId;
  const response = await client.get<DayNote[]>("/calendar/day-notes", { params });
  return response.data;
};

export const upsertDayNote = async (
  date: string,
  content: string,
  athleteId?: number,
): Promise<DayNote> => {
  const params: Record<string, string | number> = { date };
  if (athleteId) params.athlete_id = athleteId;
  const response = await client.put<DayNote>(
    "/calendar/day-notes",
    { content },
    { params },
  );
  return response.data;
};

export const deleteDayNote = async (noteId: number): Promise<void> => {
  await client.delete(`/calendar/day-notes/${noteId}`);
};

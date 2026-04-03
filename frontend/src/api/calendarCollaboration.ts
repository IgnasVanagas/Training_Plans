import api from "./client";
import { CalendarApprovalItem, CalendarShareSettings } from "../pages/dashboard/types";
import { CalendarEvent } from "../components/calendar/types";

export const getCalendarShareSettings = async (athleteId?: number | null): Promise<CalendarShareSettings[]> => {
  const response = await api.get<CalendarShareSettings[]>("/calendar/sharing/settings", {
    params: athleteId ? { athlete_id: athleteId } : undefined,
  });
  return response.data;
};

export const updateCalendarShareSettings = async (
  athleteId: number,
  payload: Partial<CalendarShareSettings>,
): Promise<CalendarShareSettings> => {
  const response = await api.put<CalendarShareSettings>("/calendar/sharing/settings", payload, {
    params: { athlete_id: athleteId },
  });
  return response.data;
};

export const getCalendarApprovals = async (athleteId?: number | null): Promise<CalendarApprovalItem[]> => {
  const response = await api.get<CalendarApprovalItem[]>("/calendar/approvals", {
    params: athleteId ? { athlete_id: athleteId } : undefined,
  });
  return response.data;
};

export const reviewCalendarApproval = async (
  workoutId: number,
  decision: "approve" | "reject",
  note?: string,
): Promise<{ workout_id: number; status: "approved" | "rejected"; deleted: boolean }> => {
  const response = await api.post(`/calendar/${workoutId}/review`, { decision, note });
  return response.data;
};

export const buildPublicCalendarShareUrl = (token: string): string => {
  if (typeof window === "undefined") {
    return `/calendar/public/${token}`;
  }
  return `${window.location.origin}/calendar/public/${token}`;
};

export const buildPublicCalendarIcsUrl = (token: string, startDate: string, endDate: string): string => {
  const baseUrl = String(api.defaults.baseURL || "").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/calendar/public/${token}/ics`);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  return url.toString();
};

export const getPublicCalendar = async (
  token: string,
  startDate: string,
  endDate: string,
): Promise<{ meta: { athlete_name: string; include_completed: boolean; include_descriptions: boolean }; events: CalendarEvent[] }> => {
  const baseUrl = String(api.defaults.baseURL || "").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/calendar/public/${token}`);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Could not load shared calendar");
  }
  return response.json();
};

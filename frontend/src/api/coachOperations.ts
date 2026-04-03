import client from "./client";
import { CoachOperationsPayload } from "../pages/dashboard/types";

export type CoachOperationsFilters = {
  athleteId?: number | null;
  sport?: string | null;
  riskLevel?: "low" | "moderate" | "high" | null;
  exceptionsOnly?: boolean;
  atRiskOnly?: boolean;
};

export const getCoachOperations = async (filters?: CoachOperationsFilters): Promise<CoachOperationsPayload> => {
  const params: Record<string, string | number | boolean> = {};

  if (filters?.athleteId) params.athlete_id = filters.athleteId;
  if (filters?.sport) params.sport = filters.sport;
  if (filters?.riskLevel) params.risk_level = filters.riskLevel;
  if (filters?.exceptionsOnly) params.exceptions_only = true;
  if (filters?.atRiskOnly) params.at_risk_only = true;

  const response = await client.get<CoachOperationsPayload>("/users/coach/operations", { params });
  return response.data;
};

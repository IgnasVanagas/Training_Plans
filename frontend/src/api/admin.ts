import api from "./client";

export type AdminUser = {
  id: number;
  email: string;
  role: "coach" | "athlete" | "admin";
  email_verified: boolean;
  first_name: string | null;
  last_name: string | null;
  activity_count: number;
};

export type AdminAuditLog = {
  id: number;
  user_id: number;
  user_email: string | null;
  provider: string;
  action: string;
  status: string;
  message: string | null;
  created_at: string;
};

export type AdminStats = {
  users: { coach: number; athlete: number; admin: number };
  total_activities: number;
  db: string;
  memory?: {
    process_rss_mb: number | null;
    process_peak_mb: number | null;
    host_total_mb: number | null;
    host_available_mb: number | null;
  };
};

export type AdminIdentityUpdatePayload = {
  admin_password: string;
  first_name?: string;
  last_name?: string;
  email?: string;
};

export type AdminResetPasswordPayload = {
  admin_password: string;
  new_password: string;
};

export const getAdminUsers = (params?: {
  skip?: number;
  limit?: number;
  search?: string;
  role?: string;
}) => api.get<AdminUser[]>("/admin/users", { params }).then((r) => r.data);

export const changeUserRole = (userId: number, role: string) =>
  api.patch<{ id: number; role: string }>(`/admin/users/${userId}/role`, { role }).then((r) => r.data);

export const getAdminAuditLogs = (params?: {
  skip?: number;
  limit?: number;
  provider?: string;
  status?: string;
}) => api.get<AdminAuditLog[]>("/admin/audit-logs", { params }).then((r) => r.data);

export const getAdminStats = () =>
  api.get<AdminStats>("/admin/stats").then((r) => r.data);

export const updateAthleteIdentity = (userId: number, payload: AdminIdentityUpdatePayload) =>
  api.patch<{ id: number; email: string; first_name: string | null; last_name: string | null; updated: boolean }>(
    `/admin/users/${userId}/identity`,
    payload,
  ).then((r) => r.data);

export const resetAthletePassword = (userId: number, payload: AdminResetPasswordPayload) =>
  api.post<{ id: number; reset: boolean }>(`/admin/users/${userId}/reset-password`, payload).then((r) => r.data);

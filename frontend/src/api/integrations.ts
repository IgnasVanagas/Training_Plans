import client from "./client";

export type ProviderStatus = {
  provider: string;
  display_name: string;
  enabled: boolean;
  configured: boolean;
  approval_required: boolean;
  bridge_only: boolean;
  required_scopes: string[];
  docs_url?: string | null;
  connection_status: string;
  last_sync_at?: string | null;
  last_error?: string | null;
};

export type ProviderConnectResponse = {
  provider: string;
  authorize_url?: string | null;
  status: string;
  message?: string | null;
};

export type ProviderSyncResponse = {
  provider: string;
  status: string;
  progress: number;
  total: number;
  message?: string | null;
  last_success?: string | null;
  last_error?: string | null;
};

export type WellnessSummary = {
  hrv?: { value: number; date: string; provider: string } | null;
  resting_hr?: { value: number; date: string; provider: string } | null;
  sleep?: { duration_seconds: number; quality_score?: number | null; end_time: string; provider: string } | null;
  stress?: { value: number; date: string; provider: string } | null;
};

export const listIntegrationProviders = async (): Promise<ProviderStatus[]> => {
  const response = await client.get<ProviderStatus[]>("/integrations/providers");
  return response.data;
};

export const connectIntegration = async (provider: string): Promise<ProviderConnectResponse> => {
  const response = await client.get<ProviderConnectResponse>(`/integrations/${provider}/connect`);
  return response.data;
};

export const disconnectIntegration = async (provider: string) => {
  const response = await client.post(`/integrations/${provider}/disconnect`);
  return response.data;
};

export const syncIntegrationNow = async (provider: string): Promise<ProviderSyncResponse> => {
  const response = await client.post<ProviderSyncResponse>(`/integrations/${provider}/sync-now`);
  return response.data;
};

export const getIntegrationSyncStatus = async (provider: string): Promise<ProviderSyncResponse> => {
  const response = await client.get<ProviderSyncResponse>(`/integrations/${provider}/sync-status`);
  return response.data;
};

export const getWellnessSummary = async (): Promise<WellnessSummary> => {
  const response = await client.get<WellnessSummary>("/integrations/wellness/summary");
  return response.data;
};

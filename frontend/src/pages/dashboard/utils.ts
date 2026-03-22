import { MetricKey } from "./types";

export const extractApiErrorMessage = (error: unknown): string => {
  const maybeError = error as {
    code?: string;
    response?: { data?: { detail?: string } };
    message?: string;
  };
  if (maybeError?.code === "ECONNABORTED") return "Request timed out. Please try again.";
  if (maybeError?.response?.data?.detail) return maybeError.response.data.detail;
  if (maybeError?.message === "Network Error") return "Network error. Check your connection and try again.";
  return maybeError?.message || "Unexpected error";
};

export const formatDuration = (decimalMinutes: number) => {
  const minutes = Math.floor(decimalMinutes);
  const seconds = Math.round((decimalMinutes - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const formatMinutesHm = (minutes?: number | null) => {
  if (!minutes || minutes <= 0) return "-";
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
};

export const metricDescriptions: Record<MetricKey, string> = {
  ftp: "Functional Threshold Power: the highest power you can sustain for about 60 minutes. Used for cycling intensity zones.",
  rhr: "Resting Heart Rate (RHR): your baseline morning heart rate, used as a recovery and readiness marker.",
  hrv: "Heart Rate Variability (HRV): your autonomic nervous system balance marker, tracked in milliseconds.",
  aerobic_load: "ATL (Acute Training Load): 7-day exponential weighted average of daily training stress. Reflects recent fatigue.",
  anaerobic_load: "CTL (Chronic Training Load): 42-day exponential weighted average of daily training stress. Reflects fitness level.",
  training_status: "Training Status is derived from TSB (Training Stress Balance = CTL − ATL). Positive TSB means fresh; negative means fatigued.",
};

export const metricModalTitle: Record<MetricKey, string> = {
  ftp: "FTP",
  rhr: "Resting Heart Rate",
  hrv: "HRV",
  aerobic_load: "ATL — Acute Training Load",
  anaerobic_load: "CTL — Chronic Training Load",
  training_status: "Training Status",
};

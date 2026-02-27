import axios from "axios";

const requestTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);

const resolveApiBaseUrl = () => {
  const envUrl = (import.meta.env.VITE_API_URL || "").trim();
  if (typeof window === "undefined") {
    return envUrl || "http://localhost:8000";
  }

  const frontendHost = window.location.hostname;
  const frontendProtocol = window.location.protocol || "http:";
  const defaultLanApiUrl = `${frontendProtocol}//${frontendHost}:8000`;

  if (!envUrl) {
    return defaultLanApiUrl;
  }

  try {
    const parsed = new URL(envUrl);
    const isLocalTarget = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isFrontendLocal = frontendHost === "localhost" || frontendHost === "127.0.0.1";
    if (isLocalTarget && !isFrontendLocal) {
      parsed.hostname = frontendHost;
      if (!parsed.port) {
        parsed.port = "8000";
      }
      return parsed.toString().replace(/\/$/, "");
    }
    return envUrl;
  } catch {
    return defaultLanApiUrl;
  }
};

const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
  timeout: Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;

import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

import { clearAuthSession, getAuthToken, hasAuthSession, markAuthSessionActive } from "../utils/authSession";

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
  const token = getAuthToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function onTokenRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      // Never revive a session from refresh cookies after explicit local logout.
      if (!hasAuthSession()) {
        return Promise.reject(error);
      }

      // Don't attempt refresh for the refresh endpoint itself
      if (originalRequest.url?.includes("/auth/refresh")) {
        clearAuthSession();
        window.location.replace("/");
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Another refresh is in progress — queue this request
        return new Promise((resolve) => {
          addRefreshSubscriber((newToken: string) => {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            resolve(api(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const attemptRefresh = async (attemptsLeft: number): Promise<string> => {
        try {
          const { data } = await axios.post(
            `${api.defaults.baseURL}/auth/refresh`,
            {},
            { withCredentials: true },
          );
          return data.access_token;
        } catch (refreshError: any) {
          // Retry once on network errors or 5xx (e.g. DB hiccup) but not on 401/403
          const status = refreshError?.response?.status;
          if (attemptsLeft > 0 && (!status || status >= 500)) {
            await new Promise((res) => setTimeout(res, 1500));
            return attemptRefresh(attemptsLeft - 1);
          }
          throw refreshError;
        }
      };

      try {
        const newToken = await attemptRefresh(1);
        markAuthSessionActive(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        onTokenRefreshed(newToken);
        return api(originalRequest);
      } catch {
        clearAuthSession();
        window.location.replace("/");
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;

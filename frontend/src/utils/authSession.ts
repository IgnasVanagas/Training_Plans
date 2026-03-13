const AUTH_SESSION_STORAGE_KEY = "tp:auth-session";
const AUTH_TOKEN_STORAGE_KEY = "tp:auth-token";

export const hasAuthSession = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY) === "1"
    && typeof window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) === "string"
    && (window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || "").length > 0;
};

export const markAuthSessionActive = (token?: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  }
};

export const getAuthToken = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
};

export const clearAuthSession = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
};
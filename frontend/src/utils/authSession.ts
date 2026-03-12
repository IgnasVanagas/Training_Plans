const AUTH_SESSION_STORAGE_KEY = "tp:auth-session";

export const hasAuthSession = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(AUTH_SESSION_STORAGE_KEY) === "1";
};

export const markAuthSessionActive = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_SESSION_STORAGE_KEY, "1");
};

export const clearAuthSession = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
};
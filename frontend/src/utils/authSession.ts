const AUTH_SESSION_STORAGE_KEY = "tp:auth-session";
const AUTH_TOKEN_STORAGE_KEY = "tp:auth-token";
let signOutInProgress = false;

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

const buildLogoutUrl = (apiBaseUrl?: string): string => {
  const normalizedBaseUrl = (apiBaseUrl || "").trim().replace(/\/$/, "");
  if (!normalizedBaseUrl) {
    return "/auth/logout";
  }

  try {
    return new URL("/auth/logout", `${normalizedBaseUrl}/`).toString();
  } catch {
    return `${normalizedBaseUrl}/auth/logout`;
  }
};

const sendBestEffortLogout = (logoutUrl: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const body = new Blob(["{}"], { type: "application/json" });
      navigator.sendBeacon(logoutUrl, body);
      return;
    }
  } catch {
    // Fall through to fetch keepalive.
  }

  try {
    void window.fetch(logoutUrl, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    // Local state is already cleared; ignore network failures.
  }
};

export const optimisticSignOut = (options?: { apiBaseUrl?: string; redirectTo?: string }): void => {
  if (typeof window === "undefined") {
    return;
  }
  if (signOutInProgress) {
    return;
  }

  signOutInProgress = true;
  clearAuthSession();
  sendBestEffortLogout(buildLogoutUrl(options?.apiBaseUrl));
  window.location.replace(options?.redirectTo || "/");
};
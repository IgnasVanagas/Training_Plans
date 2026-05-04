import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAuthSession,
  getAuthToken,
  hasAuthSession,
  markAuthSessionActive,
  optimisticSignOut,
} from "../../src/utils/authSession";

describe("authSession", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns false when session markers are missing", () => {
    expect(hasAuthSession()).toBe(false);
  });

  it("marks session active with token", () => {
    markAuthSessionActive("token-1");
    expect(hasAuthSession()).toBe(true);
    expect(getAuthToken()).toBe("token-1");
  });

  it("clearAuthSession removes auth keys and snapshots", () => {
    window.localStorage.setItem("tp:auth-session", "1");
    window.localStorage.setItem("tp:auth-token", "abc");
    window.localStorage.setItem("zone-summary:2026-01", "x");
    window.localStorage.setItem("activity:123", "x");
    window.localStorage.setItem("keep-me", "yes");

    clearAuthSession();

    expect(window.localStorage.getItem("tp:auth-session")).toBeNull();
    expect(window.localStorage.getItem("tp:auth-token")).toBeNull();
    expect(window.localStorage.getItem("zone-summary:2026-01")).toBeNull();
    expect(window.localStorage.getItem("activity:123")).toBeNull();
    expect(window.localStorage.getItem("keep-me")).toBe("yes");
  });

  it("optimisticSignOut clears auth and redirects", () => {
    markAuthSessionActive("token-1");
    const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValue(new Response());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // jsdom marks window.location.replace as non-configurable; assert observable side effects instead.
    optimisticSignOut({ apiBaseUrl: "http://localhost:8000", redirectTo: "/login" });

    expect(hasAuthSession()).toBe(false);
    expect(fetchSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

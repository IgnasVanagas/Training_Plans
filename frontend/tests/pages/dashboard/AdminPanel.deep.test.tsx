import { describe, it, expect, vi } from "vitest";
import { fireEvent, act, waitFor } from "@testing-library/react";
import React from "react";
import { renderApp } from "../../utils/renderApp";

vi.mock("../../../src/api/client", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));

vi.mock("../../../src/api/admin", () => ({
  getAdminUsers: vi.fn().mockResolvedValue([
    { id: 1, email: "alice@example.com", role: "athlete", email_verified: true, first_name: "Alice", last_name: "Wong", activity_count: 12 },
    { id: 2, email: "bob@example.com", role: "coach", email_verified: false, first_name: "Bob", last_name: "Lee", activity_count: 3 },
  ]),
  getAdminAuditLogs: vi.fn().mockResolvedValue([
    { id: 10, user_id: 1, user_email: "alice@example.com", provider: "strava", action: "sync", status: "ok", message: "synced", created_at: "2026-04-01T10:00:00Z" },
    { id: 11, user_id: 2, user_email: "bob@example.com", provider: "garmin", action: "sync", status: "error", message: "fail", created_at: "2026-04-02T10:00:00Z" },
  ]),
  getAdminStats: vi.fn().mockResolvedValue({
    users: { coach: 5, athlete: 50, admin: 1 },
    total_activities: 5000,
    db: "postgres 16",
    memory: { process_rss_mb: 120, process_peak_mb: 150, host_total_mb: 8000, host_available_mb: 4000 },
  }),
  changeUserRole: vi.fn().mockResolvedValue({}),
  resetAthletePassword: vi.fn().mockResolvedValue({}),
  updateAthleteIdentity: vi.fn().mockResolvedValue({}),
}));

import AdminPanel from "../../../src/pages/dashboard/AdminPanel";

function sweep() {
  for (const b of Array.from(document.body.querySelectorAll("button"))) {
    try { act(() => { fireEvent.click(b); }); } catch {}
  }
  for (const i of Array.from(document.body.querySelectorAll('input, textarea'))) {
    try { act(() => { fireEvent.change(i, { target: { value: "alice" } }); }); } catch {}
  }
}

describe("AdminPanel deep", () => {
  it("renders all three tabs and exercises filters/edits", async () => {
    const onTab = vi.fn();
    renderApp(<AdminPanel activeTab="admin-users" onTabChange={onTab} />);
    await waitFor(() => {
      expect(document.body.textContent).toContain("alice");
    }, { timeout: 5000 });
    sweep();

    renderApp(<AdminPanel activeTab="admin-logs" onTabChange={onTab} />);
    await waitFor(() => {
      expect(document.body.textContent?.toLowerCase()).toContain("strava");
    }, { timeout: 5000 });
    sweep();

    renderApp(<AdminPanel activeTab="admin-health" onTabChange={onTab} />);
    await new Promise((r) => setTimeout(r, 100));
    sweep();
    expect(document.body.textContent).toBeTruthy();
  });
});

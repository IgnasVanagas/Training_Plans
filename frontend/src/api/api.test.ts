import { describe, expect, it, vi, beforeEach } from "vitest";

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const put = vi.fn();

vi.mock("./client", () => ({
  default: { get, post, patch, delete: del, put, defaults: { baseURL: "http://api.local" } },
  apiBaseUrl: "http://api.local",
}));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();
  put.mockReset();
});

describe("api/workouts", () => {
  it("calls GET endpoints with params", async () => {
    const mod = await import("./workouts");
    get.mockResolvedValueOnce({ data: [{ id: 1 }] });
    const list = await mod.getWorkouts({ limit: 10 });
    expect(get).toHaveBeenCalledWith("/workouts/", { params: { limit: 10 } });
    expect(list).toEqual([{ id: 1 }]);

    get.mockResolvedValueOnce({ data: { id: 2 } });
    expect(await mod.getWorkout(2)).toEqual({ id: 2 });
    expect(get).toHaveBeenLastCalledWith("/workouts/2");

    get.mockResolvedValueOnce({ data: [{ id: 3 }] });
    expect(await mod.getRecentCoachWorkouts()).toEqual([{ id: 3 }]);
    expect(get).toHaveBeenLastCalledWith("/calendar/recent-coach-workouts", { params: { limit: 20 } });
  });

  it("calls POST/PATCH/DELETE for mutations", async () => {
    const mod = await import("./workouts");
    post.mockResolvedValueOnce({ data: { id: 99 } });
    const created = await mod.createWorkout({ title: "x" } as any);
    expect(post).toHaveBeenCalledWith("/workouts/", { title: "x" });
    expect(created).toEqual({ id: 99 });

    patch.mockResolvedValueOnce({ data: { id: 5 } });
    expect(await mod.updateWorkout(5, { title: "y" } as any)).toEqual({ id: 5 });
    expect(patch).toHaveBeenCalledWith("/workouts/5", { title: "y" });

    del.mockResolvedValueOnce({ data: undefined });
    await mod.deleteWorkout(7);
    expect(del).toHaveBeenCalledWith("/workouts/7");
  });
});

describe("api/dayNotes", () => {
  it("hits the day-notes endpoints", async () => {
    const mod = await import("./dayNotes");

    get.mockResolvedValueOnce({ data: [] });
    await mod.getDayNotes("2026-01-01", 42);
    expect(get).toHaveBeenCalledWith("/calendar/day-notes", { params: { date: "2026-01-01", athlete_id: 42 } });

    get.mockResolvedValueOnce({ data: [] });
    await mod.getDayNotes("2026-01-01");
    expect(get).toHaveBeenLastCalledWith("/calendar/day-notes", { params: { date: "2026-01-01" } });

    get.mockResolvedValueOnce({ data: [] });
    await mod.getDayNotesRange("2026-01-01", "2026-01-07", 42);
    expect(get).toHaveBeenLastCalledWith("/calendar/day-notes-range", {
      params: { start: "2026-01-01", end: "2026-01-07", athlete_id: 42 },
    });

    put.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.upsertDayNote("2026-01-01", "hi", 42);
    expect(put).toHaveBeenCalledWith("/calendar/day-notes", { content: "hi" }, { params: { date: "2026-01-01", athlete_id: 42 } });

    del.mockResolvedValueOnce({ data: undefined });
    await mod.deleteDayNote(99);
    expect(del).toHaveBeenCalledWith("/calendar/day-notes/99");
  });
});

describe("api/activities", () => {
  it("posts manual activities and gets PRs", async () => {
    const mod = await import("./activities");
    post.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.createManualActivity({ sport: "Run", date: "2026-01-01", duration: 30 } as any);
    expect(post).toHaveBeenCalledWith("/activities/manual", { sport: "Run", date: "2026-01-01", duration: 30 });

    get.mockResolvedValueOnce({ data: { sport: "Run" } });
    await mod.getPersonalRecords("Run", 5);
    expect(get).toHaveBeenLastCalledWith("/activities/personal-records", { params: { sport: "Run", athlete_id: 5 } });

    get.mockResolvedValueOnce({ data: { sport: "Run" } });
    await mod.getPersonalRecords("Run");
    expect(get).toHaveBeenLastCalledWith("/activities/personal-records", { params: { sport: "Run" } });
  });
});

describe("api/communications", () => {
  it("supports threads, comments, acknowledgements, notifications, and history", async () => {
    const mod = await import("./communications");

    get.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.getThread("activity", 7, 4);
    expect(get).toHaveBeenCalledWith("/communications/threads/activity/7", { params: { athlete_id: 4 } });

    get.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.getThread("activity", 7);
    expect(get).toHaveBeenLastCalledWith("/communications/threads/activity/7", { params: undefined });

    post.mockResolvedValueOnce({ data: { id: 2 } });
    await mod.addThreadComment("activity", 7, "hi", 4);
    expect(post).toHaveBeenCalledWith("/communications/threads/activity/7/comments", { body: "hi", athlete_id: 4 });

    post.mockResolvedValueOnce({ data: { id: 3 } });
    await mod.addAcknowledgement({ entity_type: "activity", entity_id: 1, action: "ack" });
    expect(post).toHaveBeenLastCalledWith("/communications/acknowledgements", { entity_type: "activity", entity_id: 1, action: "ack" });

    get.mockResolvedValueOnce({ data: { items: [] } });
    await mod.getNotificationsFeed();
    expect(get).toHaveBeenLastCalledWith("/communications/notifications", { params: { limit: 40 } });

    get.mockResolvedValueOnce({ data: [] });
    await mod.getAcknowledgements("activity", 8);
    expect(get).toHaveBeenLastCalledWith("/communications/acknowledgements/activity/8");

    get.mockResolvedValueOnce({ data: [] });
    await mod.getCommunicationHistory(4, 50);
    expect(get).toHaveBeenLastCalledWith("/communications/history/4", { params: { limit: 50 } });
  });

  it("posts plain support requests and form data when photos are present", async () => {
    const mod = await import("./communications");

    post.mockResolvedValueOnce({ data: { message: "ok" } });
    const plain = await mod.sendSupportRequest({
      email: "a@b.com",
      message: "help",
      client_elapsed_ms: 100,
    });
    expect(plain).toEqual({ message: "ok" });
    expect(post).toHaveBeenLastCalledWith("/communications/support", {
      email: "a@b.com",
      message: "help",
      client_elapsed_ms: 100,
    });

    post.mockResolvedValueOnce({ data: { message: "ok" } });
    const file = new File(["x"], "p.png", { type: "image/png" });
    await mod.sendSupportRequest(
      { email: "a@b.com", message: "help", client_elapsed_ms: 200 },
      [file]
    );
    expect(post).toHaveBeenLastCalledWith("/communications/support", expect.any(FormData));
    const formData = (post.mock.calls.at(-1)?.[1]) as FormData;
    expect(formData.get("email")).toBe("a@b.com");
    expect(formData.get("client_elapsed_ms")).toBe("200");
    expect(formData.get("photos")).toBeTruthy();
  });
});

describe("api/admin", () => {
  it("calls admin endpoints", async () => {
    const mod = await import("./admin");

    get.mockResolvedValueOnce({ data: [] });
    await mod.getAdminUsers({ limit: 10 });
    expect(get).toHaveBeenCalledWith("/admin/users", { params: { limit: 10 } });

    patch.mockResolvedValueOnce({ data: { id: 1, role: "coach" } });
    await mod.changeUserRole(1, "coach");
    expect(patch).toHaveBeenCalledWith("/admin/users/1/role", { role: "coach" });

    get.mockResolvedValueOnce({ data: [] });
    await mod.getAdminAuditLogs();
    expect(get).toHaveBeenLastCalledWith("/admin/audit-logs", { params: undefined });

    get.mockResolvedValueOnce({ data: { db: "ok" } });
    await mod.getAdminStats();
    expect(get).toHaveBeenLastCalledWith("/admin/stats");

    patch.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.updateAthleteIdentity(1, { admin_password: "p", first_name: "A" });
    expect(patch).toHaveBeenLastCalledWith("/admin/users/1/identity", { admin_password: "p", first_name: "A" });

    post.mockResolvedValueOnce({ data: { id: 1, reset: true } });
    await mod.resetAthletePassword(1, { admin_password: "p", new_password: "n" });
    expect(post).toHaveBeenLastCalledWith("/admin/users/1/reset-password", { admin_password: "p", new_password: "n" });
  });
});

describe("api/coachOperations", () => {
  it("builds filter params correctly", async () => {
    const mod = await import("./coachOperations");

    get.mockResolvedValueOnce({ data: { athletes: [] } });
    await mod.getCoachOperations();
    expect(get).toHaveBeenLastCalledWith("/users/coach/operations", { params: {} });

    get.mockResolvedValueOnce({ data: { athletes: [] } });
    await mod.getCoachOperations({
      athleteId: 1,
      sport: "Run",
      riskLevel: "high",
      exceptionsOnly: true,
      atRiskOnly: true,
    });
    expect(get).toHaveBeenLastCalledWith("/users/coach/operations", {
      params: { athlete_id: 1, sport: "Run", risk_level: "high", exceptions_only: true, at_risk_only: true },
    });
  });
});

describe("api/calendarCollaboration", () => {
  it("hits sharing settings, approvals, and review endpoints", async () => {
    const mod = await import("./calendarCollaboration");

    get.mockResolvedValueOnce({ data: [] });
    await mod.getCalendarShareSettings(7);
    expect(get).toHaveBeenLastCalledWith("/calendar/sharing/settings", { params: { athlete_id: 7 } });

    get.mockResolvedValueOnce({ data: [] });
    await mod.getCalendarShareSettings();
    expect(get).toHaveBeenLastCalledWith("/calendar/sharing/settings", { params: undefined });

    put.mockResolvedValueOnce({ data: {} });
    await mod.updateCalendarShareSettings(7, { include_completed: true } as any);
    expect(put).toHaveBeenLastCalledWith("/calendar/sharing/settings", { include_completed: true }, { params: { athlete_id: 7 } });

    get.mockResolvedValueOnce({ data: [] });
    await mod.getCalendarApprovals(7);
    expect(get).toHaveBeenLastCalledWith("/calendar/approvals", { params: { athlete_id: 7 } });

    post.mockResolvedValueOnce({ data: { workout_id: 1, status: "approved", deleted: false } });
    await mod.reviewCalendarApproval(1, "approve", "ok");
    expect(post).toHaveBeenLastCalledWith("/calendar/1/review", { decision: "approve", note: "ok" });

    expect(mod.buildPublicCalendarShareUrl("tok")).toContain("/calendar/public/tok");
    const ics = mod.buildPublicCalendarIcsUrl("tok", "2026-01-01", "2026-01-07");
    expect(ics).toContain("/calendar/public/tok/ics");
    expect(ics).toContain("start_date=2026-01-01");
  });
});

describe("api/planning", () => {
  const samplePayload = {
    name: "Plan",
    sport_type: "Running",
    season_start: "2026-01-01",
    season_end: "2026-06-01",
    target_metrics: [],
    goal_races: [],
    constraints: [],
    periodization: {
      weekly_hours_target: 5,
      longest_session_minutes: 60,
      training_days_per_week: 4,
      recovery_week_frequency: 4,
      taper_profile: "standard",
      periodization_model: "polarized",
    },
  } as const;

  it("calls season planning endpoints", async () => {
    const mod = await import("./planning");

    get.mockResolvedValueOnce({ data: null });
    await mod.getLatestSeasonPlan(7);
    expect(get).toHaveBeenLastCalledWith(
      "/planning/season",
      expect.objectContaining({ params: { athlete_id: 7 } })
    );

    post.mockResolvedValueOnce({ data: {} });
    await mod.previewSeasonPlan(samplePayload as any);
    expect(post).toHaveBeenLastCalledWith("/planning/season/preview", expect.any(Object), { params: undefined });

    post.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.saveSeasonPlan(samplePayload as any, 7);
    expect(post).toHaveBeenLastCalledWith("/planning/season", expect.any(Object), { params: { athlete_id: 7 } });

    post.mockResolvedValueOnce({ data: { plan_id: 1 } });
    await mod.applySeasonPlan(1, false);
    expect(post).toHaveBeenLastCalledWith("/planning/season/1/apply", undefined, { params: { replace_generated: false } });
  });
});

describe("api/integrations", () => {
  it("calls integration endpoints", async () => {
    const mod = await import("./integrations");

    get.mockResolvedValueOnce({ data: [] });
    await mod.listIntegrationProviders();
    expect(get).toHaveBeenLastCalledWith("/integrations/providers");

    get.mockResolvedValueOnce({ data: { provider: "strava", status: "ok" } });
    await mod.connectIntegration("strava");
    expect(get).toHaveBeenLastCalledWith("/integrations/strava/connect");

    post.mockResolvedValueOnce({ data: {} });
    await mod.disconnectIntegration("strava");
    expect(post).toHaveBeenLastCalledWith("/integrations/strava/disconnect");

    post.mockResolvedValueOnce({ data: {} });
    await mod.syncIntegrationNow("strava", "full");
    expect(post).toHaveBeenLastCalledWith("/integrations/strava/sync-now", { mode: "full" });

    post.mockResolvedValueOnce({ data: {} });
    await mod.syncIntegrationNow("strava");
    expect(post).toHaveBeenLastCalledWith("/integrations/strava/sync-now", undefined);

    get.mockResolvedValueOnce({ data: {} });
    await mod.getIntegrationSyncStatus("strava");
    expect(get).toHaveBeenLastCalledWith("/integrations/strava/sync-status");

    post.mockResolvedValueOnce({ data: {} });
    await mod.cancelIntegrationSync("strava");
    expect(post).toHaveBeenLastCalledWith("/integrations/strava/cancel-sync");

    get.mockResolvedValueOnce({ data: {} });
    await mod.getWellnessSummary();
    expect(get).toHaveBeenLastCalledWith("/integrations/wellness/summary");

    post.mockResolvedValueOnce({ data: { updated: {} } });
    await mod.logManualWellness({ date: "2026-01-01", hrv_ms: 50 });
    expect(post).toHaveBeenLastCalledWith("/integrations/wellness/manual", { date: "2026-01-01", hrv_ms: 50 });

    get.mockResolvedValueOnce({ data: {} });
    await mod.getStravaImportPreferences();
    expect(get).toHaveBeenLastCalledWith("/integrations/strava/import-preferences");

    post.mockResolvedValueOnce({ data: {} });
    await mod.setStravaImportPreferences({ import_all_time: true });
    expect(post).toHaveBeenLastCalledWith("/integrations/strava/import-preferences", { import_all_time: true });
  });
});

describe("api/organizations", () => {
  it("hits org discover/create/join/leave/messaging endpoints", async () => {
    const mod = await import("./organizations");

    get.mockResolvedValueOnce({ data: { coached: [], member_of: [] } });
    await mod.discoverOrganizations("  acme  ");
    expect(get).toHaveBeenLastCalledWith("/users/organizations/discover", { params: { query: "acme" } });

    get.mockResolvedValueOnce({ data: {} });
    await mod.discoverOrganizations();
    expect(get).toHaveBeenLastCalledWith("/users/organizations/discover", { params: undefined });

    post.mockResolvedValueOnce({ data: { id: 1, name: "Acme" } });
    await mod.createOrganization({ name: "Acme" });
    expect(post).toHaveBeenLastCalledWith("/users/organization", { name: "Acme" });

    post.mockResolvedValueOnce({ data: { message: "ok", status: "pending" } });
    await mod.requestOrganizationJoin(7, "hi", true, "v1");
    expect(post).toHaveBeenLastCalledWith("/users/organization/request-join", {
      organization_id: 7,
      message: "hi",
      athlete_data_sharing_consent: true,
      athlete_data_sharing_consent_version: "v1",
    });

    get.mockResolvedValueOnce({ data: [] });
    await mod.listOrganizationGroupMessages(1);
    expect(get).toHaveBeenLastCalledWith("/communications/organizations/1/group");

    get.mockResolvedValueOnce({ data: { threads: [] } });
    await mod.listOrganizationInbox(1);
    expect(get).toHaveBeenLastCalledWith("/communications/organizations/1/inbox");

    get.mockResolvedValueOnce({ data: [] });
    await mod.listOrgMembers(1);
    expect(get).toHaveBeenLastCalledWith("/communications/organizations/1/members");

    post.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.postOrganizationGroupMessage(1, "hi", "url", "name");
    expect(post).toHaveBeenLastCalledWith("/communications/organizations/1/group", {
      body: "hi",
      attachment_url: "url",
      attachment_name: "name",
    });

    get.mockResolvedValueOnce({ data: [] });
    await mod.listOrganizationCoachMessages(1, { coachId: 2, athleteId: 3 });
    expect(get).toHaveBeenLastCalledWith("/communications/organizations/1/coach-chat", {
      params: { coach_id: 2, athlete_id: 3 },
    });

    post.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.postOrganizationCoachMessage(1, { athleteId: 3 }, "hi");
    expect(post).toHaveBeenLastCalledWith(
      "/communications/organizations/1/coach-chat",
      { body: "hi", attachment_url: null, attachment_name: null },
      { params: { athlete_id: 3 } }
    );

    get.mockResolvedValueOnce({ data: [] });
    await mod.listOrgDirectMessages(1, 5);
    expect(get).toHaveBeenLastCalledWith("/communications/organizations/1/direct/5");

    post.mockResolvedValueOnce({ data: { id: 1 } });
    await mod.postOrgDirectMessage(1, 5, "hi");
    expect(post).toHaveBeenLastCalledWith("/communications/organizations/1/direct/5", {
      body: "hi",
      attachment_url: null,
      attachment_name: null,
    });

    post.mockResolvedValueOnce({ data: { attachment_url: "u", attachment_name: "f" } });
    await mod.uploadChatAttachment(1, new File(["x"], "f.png"));
    expect(post).toHaveBeenLastCalledWith(
      "/communications/organizations/1/attachment",
      expect.any(FormData),
      expect.objectContaining({ headers: { "Content-Type": "multipart/form-data" } })
    );

    del.mockResolvedValueOnce({ data: { status: "ok", detail: "" } });
    await mod.leaveOrganization(1);
    expect(del).toHaveBeenLastCalledWith("/users/organizations/1/membership");

    del.mockResolvedValueOnce({ data: { status: "ok", detail: "" } });
    await mod.removeOrganizationMember(1, 5);
    expect(del).toHaveBeenLastCalledWith("/users/organizations/1/members/5");

    get.mockResolvedValueOnce({ data: {} });
    await mod.getOrgSettings(1);
    expect(get).toHaveBeenLastCalledWith("/users/organizations/1");

    put.mockResolvedValueOnce({ data: { id: 1, name: "X" } });
    await mod.updateOrganization(1, { name: "X" });
    expect(put).toHaveBeenLastCalledWith("/users/organizations/1", { name: "X" });

    post.mockResolvedValueOnce({ data: { id: 1, name: "x" } });
    await mod.uploadOrgPicture(1, new File(["x"], "p.png"));
    expect(post).toHaveBeenLastCalledWith(
      "/users/organizations/1/picture",
      expect.any(FormData),
      expect.objectContaining({ headers: { "Content-Type": "multipart/form-data" } })
    );

    patch.mockResolvedValueOnce({ data: { status: "ok", is_admin: true } });
    await mod.setMemberAdmin(1, 5, true);
    expect(patch).toHaveBeenLastCalledWith("/users/organizations/1/members/5/admin", { is_admin: true });

    post.mockResolvedValueOnce({ data: {} });
    await mod.uploadProfilePicture(new File(["x"], "p.png"));
    expect(post).toHaveBeenLastCalledWith(
      "/users/profile/picture",
      expect.any(FormData),
      expect.objectContaining({ headers: { "Content-Type": "multipart/form-data" } })
    );
  });

  it("resolves picture URLs with absolute, uploads, and bare filenames", async () => {
    const mod = await import("./organizations");

    expect(mod.resolveOrgPictureUrl(null)).toBeNull();
    expect(mod.resolveOrgPictureUrl(undefined)).toBeNull();
    expect(mod.resolveOrgPictureUrl("https://cdn/x.png")).toBe("https://cdn/x.png");
    expect(mod.resolveOrgPictureUrl("/uploads/org/x.png")).toBe("http://api.local/uploads/org/x.png");
    expect(mod.resolveOrgPictureUrl("x.png")).toBe("http://api.local/uploads/org/x.png");

    expect(mod.resolveUserPictureUrl(null)).toBeNull();
    expect(mod.resolveUserPictureUrl("https://cdn/x.png")).toBe("https://cdn/x.png");
    expect(mod.resolveUserPictureUrl("x.png")).toBe("http://api.local/uploads/user/x.png");
  });
});

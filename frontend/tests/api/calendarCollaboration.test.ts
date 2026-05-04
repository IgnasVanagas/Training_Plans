import { describe, it, expect, vi, beforeEach } from "vitest";

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();

vi.mock("../../src/api/client", () => ({
  default: {
    get: (...a: any[]) => apiGet(...a),
    post: (...a: any[]) => apiPost(...a),
    put: (...a: any[]) => apiPut(...a),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));

const fetchMock = vi.fn();
(globalThis as any).fetch = fetchMock;

import {
  getCalendarShareSettings,
  updateCalendarShareSettings,
  getCalendarApprovals,
  reviewCalendarApproval,
  buildPublicCalendarShareUrl,
  buildPublicCalendarIcsUrl,
  getPublicCalendar,
} from "../../src/api/calendarCollaboration";

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  fetchMock.mockReset();
});

describe("calendarCollaboration api", () => {
  it("getCalendarShareSettings - with and without athleteId", async () => {
    apiGet.mockResolvedValue({ data: [{ id: 1 } as any] });
    await getCalendarShareSettings(7);
    expect(apiGet).toHaveBeenCalledWith("/calendar/sharing/settings", { params: { athlete_id: 7 } });
    apiGet.mockResolvedValue({ data: [] });
    await getCalendarShareSettings();
    expect(apiGet).toHaveBeenLastCalledWith("/calendar/sharing/settings", { params: undefined });
  });

  it("updateCalendarShareSettings hits PUT", async () => {
    apiPut.mockResolvedValue({ data: { id: 1 } });
    const out = await updateCalendarShareSettings(5, { is_public: true } as any);
    expect(out).toEqual({ id: 1 });
    expect(apiPut).toHaveBeenCalledWith("/calendar/sharing/settings", { is_public: true }, { params: { athlete_id: 5 } });
  });

  it("getCalendarApprovals - with and without athleteId", async () => {
    apiGet.mockResolvedValue({ data: [] });
    await getCalendarApprovals(11);
    await getCalendarApprovals();
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it("reviewCalendarApproval posts decision", async () => {
    apiPost.mockResolvedValue({ data: { workout_id: 1, status: "approved", deleted: false } });
    const out = await reviewCalendarApproval(1, "approve", "looks good");
    expect(out.status).toBe("approved");
    expect(apiPost).toHaveBeenCalledWith("/calendar/1/review", { decision: "approve", note: "looks good" });
  });

  it("buildPublicCalendarShareUrl uses window origin", () => {
    expect(buildPublicCalendarShareUrl("tok")).toContain("/calendar/public/tok");
  });

  it("buildPublicCalendarIcsUrl uses api baseURL and query params", () => {
    const url = buildPublicCalendarIcsUrl("tok", "2026-01-01", "2026-01-31");
    expect(url).toContain("http://api.local/calendar/public/tok/ics");
    expect(url).toContain("start_date=2026-01-01");
    expect(url).toContain("end_date=2026-01-31");
  });

  it("getPublicCalendar returns json on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ meta: { athlete_name: "A" }, events: [] }) });
    const out = await getPublicCalendar("tok", "2026-01-01", "2026-01-31");
    expect(out.meta.athlete_name).toBe("A");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("getPublicCalendar throws on failure", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await expect(getPublicCalendar("tok", "2026-01-01", "2026-01-31")).rejects.toThrow("Could not load shared calendar");
  });
});

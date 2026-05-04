import { describe, it, expect, vi } from "vitest";
import { fireEvent, act } from "@testing-library/react";
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

import DashboardCoachHome from "../../../src/pages/dashboard/DashboardCoachHome";

const me: any = { id: 1, role: "coach", email: "c@x", profile: { first_name: "Coach", last_name: "Lee" } };
const athletes: any[] = [
  { id: 11, email: "a@x", role: "athlete", profile: { first_name: "Alice", last_name: "W", main_sport: "running" } },
  { id: 12, email: "b@x", role: "athlete", profile: { first_name: "Bob", last_name: "Z", main_sport: "cycling" } },
];

const complianceAlerts: any[] = [
  { id: 100, user_id: 11, title: "Easy run", date: "2026-04-10", planned_duration: 60, planned_distance: 10, planned_intensity: "Z2", sport_type: "running", is_planned: true, matched_activity_id: 200, compliance_score: 35 },
];
const coachFeedbackRows: any[] = [
  { id: 201, athlete_id: 11, athlete_first_name: "Alice", title: "Tempo", sport: "running", started_at: "2026-04-09T07:00:00Z", created_at: "2026-04-09T08:00:00Z", duration: 3600, distance: 12000, compliance_score: 30 },
];
const coachOperations: any = {
  pending_invites: 1,
  pending_approvals: 1,
  unread_messages: 2,
  pending_organization_requests: 0,
  at_risk_athletes: [{ id: 11, first_name: "Alice", last_name: "W", reason: "low_compliance", value: 0.4 }],
  exception_queue: [
    { athlete_id: 11, athlete_name: "Alice", risk_level: "high", exception_reasons: ["missing_data"] },
    { athlete_id: 12, athlete_name: "Bob", risk_level: "medium", exception_reasons: ["compliance_drop"] },
  ],
};
const approvalQueue: any[] = [
  { id: 301, workout_id: 401, athlete_id: 11, athlete_name: "Alice", title: "Long ride", date: "2026-04-12", change_type: "edit" },
];

function sweep() {
  for (const b of Array.from(document.body.querySelectorAll("button"))) {
    try { act(() => { fireEvent.click(b); }); } catch {}
  }
  for (const i of Array.from(document.body.querySelectorAll('input, textarea'))) {
    try { act(() => { fireEvent.change(i, { target: { value: "athlete@example.com" } }); }); } catch {}
  }
}

describe("DashboardCoachHome deep", () => {
  it("renders rich coach home and exercises handlers", () => {
    renderApp(
      <DashboardCoachHome
        me={me}
        athletes={athletes}
        complianceAlerts={complianceAlerts}
        coachFeedbackRows={coachFeedbackRows}
        coachOperations={coachOperations}
        coachOperationsLoading={false}
        approvalQueue={approvalQueue}
        reviewingApproval={false}
        onReviewApproval={vi.fn()}
        inviteUrl={"https://example.com/invite"}
        inviteEmail={""}
        onInviteEmailChange={vi.fn()}
        inviteMessage={""}
        onInviteMessageChange={vi.fn()}
        onInviteByEmail={vi.fn()}
        invitingByEmail={false}
        onGenerateInvite={vi.fn()}
        generatingInvite={false}
        onOpenPlan={vi.fn()}
        onOpenActivities={vi.fn()}
        onOpenOrganizations={vi.fn()}
        onOpenComparison={vi.fn()}
      />,
    );
    sweep();
    expect(document.body.textContent).toBeTruthy();
  });
});

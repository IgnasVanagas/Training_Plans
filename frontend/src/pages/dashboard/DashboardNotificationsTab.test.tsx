import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { I18nProvider } from "../../i18n/I18nProvider";
import DashboardNotificationsTab from "./DashboardNotificationsTab";
import type { NotificationItem, User } from "./types";

const wrap = (ui: React.ReactElement) =>
  render(
    <MantineProvider>
      <I18nProvider>{ui}</I18nProvider>
    </MantineProvider>,
  );

const baseAthlete: User = { id: 1, email: "a@x.com", role: "athlete" };
const baseCoach: User = { id: 2, email: "c@x.com", role: "coach" };

const makeItem = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: "n1",
  type: "message",
  title: "Hello",
  message: "Body",
  created_at: new Date("2026-01-01T10:00:00Z").toISOString(),
  ...overrides,
});

describe("DashboardNotificationsTab", () => {
  it("renders empty state when no items", () => {
    wrap(
      <DashboardNotificationsTab
        me={baseAthlete}
        items={[]}
        loading={false}
        onRefresh={() => {}}
        onRespondInvitation={() => {}}
        respondingInvitation={false}
      />,
    );
    expect(screen.getByText(/No notifications yet/i)).toBeInTheDocument();
  });

  it("renders coach subtitle and triggers refresh", () => {
    const onRefresh = vi.fn();
    wrap(
      <DashboardNotificationsTab
        me={baseCoach}
        items={[makeItem({ type: "athlete_workout", title: "AW", message: "msg" })]}
        loading={false}
        onRefresh={onRefresh}
        onRespondInvitation={() => {}}
        respondingInvitation={false}
      />,
    );
    expect(screen.getByText(/Athlete workouts/i)).toBeInTheDocument();
    expect(screen.getByText("AW")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("handles invitation accept with consent gating", () => {
    const onRespond = vi.fn();
    wrap(
      <DashboardNotificationsTab
        me={baseAthlete}
        items={[
          makeItem({
            id: "inv1",
            type: "invitation",
            status: "pending",
            organization_id: 42,
            title: "Invite",
            message: "Join us",
          }),
        ]}
        loading={false}
        onRefresh={() => {}}
        onRespondInvitation={onRespond}
        respondingInvitation={false}
      />,
    );
    const acceptBtn = screen.getByRole("button", { name: /accept/i });
    expect(acceptBtn).toBeDisabled();
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    expect(onRespond).toHaveBeenCalledWith(42, "accept", true);
    fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(onRespond).toHaveBeenCalledWith(42, "decline");
  });

  it("renders various notification type colors without crashing", () => {
    wrap(
      <DashboardNotificationsTab
        me={baseAthlete}
        items={[
          makeItem({ id: "1", type: "planned_workout" }),
          makeItem({ id: "2", type: "acknowledgement" }),
          makeItem({ id: "3", type: "unknown_type" }),
        ]}
        loading={false}
        onRefresh={() => {}}
        onRespondInvitation={() => {}}
        respondingInvitation={false}
      />,
    );
    expect(screen.getAllByText(/Hello/i).length).toBeGreaterThan(0);
  });
});

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import DashboardOrganizationsTab from "../../../src/pages/dashboard/DashboardOrganizationsTab";

const { organizationApiMocks, notificationShowMock } = vi.hoisted(() => ({
  organizationApiMocks: {
    discoverOrganizations: vi.fn(),
    createOrganization: vi.fn(),
    leaveOrganization: vi.fn(),
    listOrgDirectMessages: vi.fn(),
    listOrganizationInbox: vi.fn(),
    listOrganizationCoachMessages: vi.fn(),
    listOrganizationGroupMessages: vi.fn(),
    postOrgDirectMessage: vi.fn(),
    postOrganizationCoachMessage: vi.fn(),
    postOrganizationGroupMessage: vi.fn(),
    removeOrganizationMember: vi.fn(),
    requestOrganizationJoin: vi.fn(),
    uploadChatAttachment: vi.fn(),
    getOrgSettings: vi.fn(),
    updateOrganization: vi.fn(),
    uploadOrgPicture: vi.fn(),
    setMemberAdmin: vi.fn(),
  },
  notificationShowMock: vi.fn(),
}));

vi.mock("../../../src/api/client", () => ({
  apiBaseUrl: "https://api.example.com",
}));

vi.mock("../../../src/api/organizations", () => ({
  ...organizationApiMocks,
  resolveOrgPictureUrl: (picture?: string | null) => (picture ? `https://cdn.example.com/orgs/${picture}` : null),
  resolveUserPictureUrl: (picture?: string | null) => (picture ? `https://cdn.example.com/users/${picture}` : null),
}));

vi.mock("../../../src/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("@mantine/hooks", () => ({
  useMediaQuery: vi.fn(() => false),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: notificationShowMock,
  },
}));

const buildQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const renderOrganizationsTab = (props: any) =>
  render(
    <MantineProvider>
      <QueryClientProvider client={buildQueryClient()}>
        <MemoryRouter>
          <DashboardOrganizationsTab {...props} />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );

describe("DashboardOrganizationsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    if (!(HTMLElement.prototype as any).scrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        configurable: true,
        value: vi.fn(),
      });
    }

    organizationApiMocks.discoverOrganizations.mockResolvedValue({ items: [] });
    organizationApiMocks.createOrganization.mockResolvedValue({ id: 2, name: "Peak Form Lab" });
    organizationApiMocks.leaveOrganization.mockResolvedValue({});
    organizationApiMocks.listOrgDirectMessages.mockResolvedValue([]);
    organizationApiMocks.listOrganizationInbox.mockResolvedValue({ items: [] });
    organizationApiMocks.listOrganizationCoachMessages.mockResolvedValue([]);
    organizationApiMocks.listOrganizationGroupMessages.mockResolvedValue([]);
    organizationApiMocks.postOrgDirectMessage.mockResolvedValue({});
    organizationApiMocks.postOrganizationCoachMessage.mockResolvedValue({});
    organizationApiMocks.postOrganizationGroupMessage.mockResolvedValue({});
    organizationApiMocks.removeOrganizationMember.mockResolvedValue({});
    organizationApiMocks.requestOrganizationJoin.mockResolvedValue({ message: "Join request sent" });
    organizationApiMocks.uploadChatAttachment.mockResolvedValue({ attachment_url: "attachment.pdf", attachment_name: "attachment.pdf" });
    organizationApiMocks.getOrgSettings.mockResolvedValue({
      id: 1,
      name: "Velocity Lab",
      description: "High-performance endurance squad",
      picture: null,
      code: "VELO123",
      creator_id: 10,
      members: [],
    });
    organizationApiMocks.updateOrganization.mockResolvedValue({});
    organizationApiMocks.uploadOrgPicture.mockResolvedValue({});
    organizationApiMocks.setMemberAdmin.mockResolvedValue({});
  });

  it("renders the no-organization lobby and supports discovery, join, and create flows", async () => {
    const user = userEvent.setup();

    organizationApiMocks.discoverOrganizations.mockImplementation(async (query: string) => ({
      items: query.toLowerCase().includes("summit")
        ? [
            {
              id: 44,
              name: "Summit Collective",
              description: "Mountain endurance crew",
              picture: null,
              member_count: 18,
              my_membership_status: null,
              coaches: [{ first_name: "Ieva", last_name: "Coach", email: "ieva@example.com" }],
            },
          ]
        : [],
    }));

    renderOrganizationsTab({
      me: {
        id: 7,
        role: "athlete",
        email: "athlete@example.com",
        organization_memberships: [],
        coaches: [],
        profile: { timezone: "UTC" },
      },
      athletes: [],
    });

    expect(screen.getByText("No Organization Yet")).toBeInTheDocument();
    expect(screen.getByText("Join or create an organization to use group and coach chat.")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search organizations by name..."), "Summit");

    expect(await screen.findByText("Summit Collective")).toBeInTheDocument();
    expect(screen.getByText("18 members")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText("Join Organization")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "I confirm that coaches in this organization can access my Strava-derived training data." }));
    await user.click(screen.getByRole("button", { name: "Send Request" }));

    await waitFor(() => {
      expect(organizationApiMocks.requestOrganizationJoin).toHaveBeenCalledWith(44, undefined, true, "2026-04-27");
    });

    await user.click(screen.getAllByRole("button", { name: "Create Organization" })[0]);
    expect(await screen.findByText("Organization Name")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Enter organization name..."), "Peak Form Lab");
    await user.type(screen.getByPlaceholderText("What is your organization about?"), "Data-driven endurance coaching");
    await user.click(screen.getByRole("button", { name: "Create Organization" }));

    await waitFor(() => {
      expect(organizationApiMocks.createOrganization).toHaveBeenCalledWith({
        name: "Peak Form Lab",
        description: "Data-driven endurance coaching",
      });
    });
  }, 15000);

  it("renders active organization threads and supports switching across group, member, and coach chats", async () => {
    const user = userEvent.setup();

    organizationApiMocks.listOrganizationInbox.mockResolvedValue({
      items: [
        {
          key: "group",
          thread_type: "group",
          body_preview: "Race plan updated",
          created_at: "2026-03-04T08:15:00Z",
          sender_id: 21,
          participant_id: null,
          participant_name: null,
          participant_picture: null,
        },
        {
          key: "member:34",
          thread_type: "member",
          body_preview: "Can you review my file?",
          created_at: "2026-03-04T09:00:00Z",
          sender_id: 34,
          participant_id: 34,
          participant_name: "Team Admin",
          participant_picture: null,
        },
      ],
    });
    organizationApiMocks.listOrganizationGroupMessages.mockResolvedValue([
      {
        id: 1,
        sender_id: 21,
        sender_name: "Asta Runner",
        sender_picture: null,
        body: "Check /dashboard/activities/88 before tomorrow",
        created_at: "2026-03-04T08:15:00Z",
        attachment_url: "files/plan.pdf",
        attachment_name: "plan.pdf",
      },
    ]);
    organizationApiMocks.listOrgDirectMessages.mockResolvedValue([
      {
        id: 2,
        sender_id: 34,
        sender_name: "Team Admin",
        sender_picture: null,
        body: "Upload looked good.",
        created_at: "2026-03-04T09:01:00Z",
      },
    ]);
    organizationApiMocks.listOrganizationCoachMessages.mockResolvedValue([
      {
        id: 3,
        sender_id: 10,
        sender_name: "Coach Lina",
        sender_picture: null,
        body: "Threshold block tomorrow.",
        created_at: "2026-03-04T09:05:00Z",
      },
    ]);

    renderOrganizationsTab({
      me: {
        id: 10,
        role: "coach",
        email: "coach@example.com",
        profile: { timezone: "UTC" },
        coaches: [
          {
            id: 10,
            first_name: "Coach",
            last_name: "Lina",
            email: "coach@example.com",
            organization_ids: [1],
          },
        ],
        organization_memberships: [
          {
            status: "active",
            is_admin: true,
            organization: {
              id: 1,
              name: "Velocity Lab",
              description: "High-performance endurance squad",
              picture: null,
            },
          },
        ],
      },
      athletes: [
        {
          id: 21,
          email: "asta@example.com",
          profile: { first_name: "Asta", last_name: "Runner", picture: null },
        },
      ],
      initialOrganizationId: 1,
    });

    expect(await screen.findByText("Velocity Lab")).toBeInTheDocument();
    expect(screen.getAllByText("Organization Group").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Team Admin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Asta Runner").length).toBeGreaterThan(0);

    expect(await screen.findByText("plan.pdf")).toBeInTheDocument();

    await user.click(screen.getByText("Direct athlete conversation"));
    expect(await screen.findByText("Threshold block tomorrow.")).toBeInTheDocument();

    const messageInput = screen.getByPlaceholderText("Write a direct message...");
    await user.type(messageInput, "Bring threshold gear{enter}");

    await waitFor(() => {
      expect(organizationApiMocks.postOrganizationCoachMessage).toHaveBeenCalledWith(
        1,
        { athleteId: 21 },
        "Bring threshold gear",
        undefined,
        undefined,
      );
    });

    await user.click(screen.getByText("Race plan updated"));
    expect(await screen.findByText(/before tomorrow/)).toBeInTheDocument();
    expect(screen.getByText("plan.pdf")).toBeInTheDocument();

    await user.click(screen.getByText("Can you review my file?"));
    expect(await screen.findByText("Upload looked good.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Remove member")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(organizationApiMocks.removeOrganizationMember).toHaveBeenCalledWith(1, 21);
    });
  });
});
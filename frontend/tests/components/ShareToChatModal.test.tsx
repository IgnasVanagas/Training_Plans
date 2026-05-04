import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  listOrgMembers,
  postOrgDirectMessage,
  postOrganizationCoachMessage,
  postOrganizationGroupMessage,
} from "../../src/api/organizations";
import api from "../../src/api/client";
import ShareToChatModal from "../../src/components/ShareToChatModal";

const mockNavigate = vi.fn();

vi.mock("@mantine/core", async () => {
  const actual = await vi.importActual<typeof import("@mantine/core")>("@mantine/core");
  return {
    ...actual,
    Select: ({ data, label, onChange, value }: { data: Array<{ value: string; label: string }>; label: string; onChange?: (value: string | null) => void; value?: string | null }) => (
      <label>
        <span>{label}</span>
        <select
          aria-label={label}
          onChange={(event) => onChange?.(event.currentTarget.value || null)}
          value={value ?? ""}
        >
          {data.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    ),
  };
});

vi.mock("../../src/api/client", () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock("../../src/api/organizations", () => ({
  listOrgMembers: vi.fn(),
  postOrgDirectMessage: vi.fn(),
  postOrganizationCoachMessage: vi.fn(),
  postOrganizationGroupMessage: vi.fn(),
}));

vi.mock("../../src/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (text: string) => text,
  }),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: {
    show: vi.fn(),
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockedApiGet = vi.mocked(api.get);
const mockedListOrgMembers = vi.mocked(listOrgMembers);
const mockedPostOrgDirectMessage = vi.mocked(postOrgDirectMessage);
const mockedPostOrganizationCoachMessage = vi.mocked(postOrganizationCoachMessage);
const mockedPostOrganizationGroupMessage = vi.mocked(postOrganizationGroupMessage);
const mockedShowNotification = vi.mocked(notifications.show);

const defaultMe = {
  role: "athlete",
  organization_memberships: [
    {
      organization: { id: 1, name: "Alpha Endurance" },
      role: "athlete",
      status: "active",
    },
  ],
};

const defaultMembers = [
  { id: 9, role: "coach", email: "coach@example.com", first_name: "Casey", last_name: "Coach" },
  { id: 10, role: "athlete", email: "alex@example.com", first_name: "Alex", last_name: "Athlete" },
];

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const renderModal = ({
  me = defaultMe,
  members = defaultMembers,
  opened = true,
  shareText = "Workout summary",
}: {
  me?: typeof defaultMe | { role?: string; organization_memberships?: Array<{ organization?: { id: number; name: string } | null; role: string; status: string }> };
  members?: typeof defaultMembers;
  opened?: boolean;
  shareText?: string;
} = {}) => {
  mockedApiGet.mockResolvedValue({ data: me });
  mockedListOrgMembers.mockResolvedValue(members);

  const queryClient = createQueryClient();
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const onClose = vi.fn();
  const user = userEvent.setup();

  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <MantineProvider>
          <ShareToChatModal opened={opened} onClose={onClose} shareText={shareText} />
        </MantineProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );

  return { invalidateQueries, onClose, user };
};

const waitForQueries = async (expectedOrgId = 1) => {
  await screen.findByText("Share to Chat");
  await waitFor(() => expect(mockedApiGet).toHaveBeenCalledWith("/users/me"));
  if (expectedOrgId) {
    await waitFor(() => expect(mockedListOrgMembers).toHaveBeenCalledWith(expectedOrgId));
  }
};

const selectOption = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
  const select = screen.getByLabelText(label);
  await user.selectOptions(select, screen.getByRole("option", { name: option }));
};

describe("ShareToChatModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPostOrgDirectMessage.mockResolvedValue({} as never);
    mockedPostOrganizationCoachMessage.mockResolvedValue({} as never);
    mockedPostOrganizationGroupMessage.mockResolvedValue({} as never);
  });

  it("filters memberships to active organizations matching the current role", async () => {
    renderModal({
      me: {
        role: "athlete",
        organization_memberships: [
          { organization: { id: 1, name: "Alpha Endurance" }, role: "athlete", status: "active" },
          { organization: { id: 2, name: "Inactive Org" }, role: "athlete", status: "inactive" },
          { organization: { id: 3, name: "Coach Org" }, role: "coach", status: "active" },
        ],
      },
    });

    await waitForQueries(1);

    expect(mockedListOrgMembers).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
    expect(screen.queryByText("You are not a member of any organization.")).not.toBeInTheDocument();
  });

  it("sends a group message and navigates to the organizations tab on success", async () => {
    const { invalidateQueries, onClose, user } = renderModal({ shareText: "  Initial share text  " });

    await waitForQueries();
    await user.clear(screen.getByLabelText("Message"));
    await user.type(screen.getByLabelText("Message"), "  Updated share message  ");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockedPostOrganizationGroupMessage).toHaveBeenCalledWith(1, "Updated share message");
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/dashboard", { state: { activeTab: "organizations" } });
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
    expect(mockedShowNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        color: "green",
        title: "Shared",
        message: "Message sent to chat.",
      })
    );
  });

  it("sends a coach thread message for athlete-to-coach sharing", async () => {
    const { user } = renderModal({ shareText: "Tempo session summary" });

    await waitForQueries();
    await selectOption(user, "Send to", "Casey Coach");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockedPostOrganizationCoachMessage).toHaveBeenCalledWith(
        1,
        { coachId: 9 },
        "Tempo session summary"
      );
    });
  });

  it("requires consent before sharing a specific activity to a non-coach member", async () => {
    const { onClose, user } = renderModal({
      shareText: "https://example.com/dashboard/activities/42",
    });

    await waitForQueries();
    await selectOption(user, "Send to", "Alex Athlete");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Share activity permission")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Yes, grant permission and share", hidden: true }));

    await waitFor(() => {
      expect(mockedPostOrgDirectMessage).toHaveBeenCalledWith(
        1,
        10,
        "https://example.com/dashboard/activities/42"
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an error notification when sending fails", async () => {
    mockedPostOrganizationGroupMessage.mockRejectedValueOnce(new Error("network failure"));
    const { onClose, user } = renderModal({ shareText: "Share after failure" });

    await waitForQueries();
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(mockedShowNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "red",
          title: "Failed",
          message: "Could not send message.",
        })
      );
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
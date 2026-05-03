import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "../../i18n/I18nProvider";
import SupportContactButton from "./SupportContactButton";

const sendSupportRequest = vi.fn();
vi.mock("../../api/communications", () => ({
  sendSupportRequest: (...args: unknown[]) => sendSupportRequest(...args),
}));

const renderButton = (props: React.ComponentProps<typeof SupportContactButton> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <Notifications />
        <I18nProvider>
          <SupportContactButton {...props} />
        </I18nProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
};

describe("SupportContactButton", () => {
  beforeEach(() => {
    sendSupportRequest.mockReset();
  });

  it("renders an icon-only trigger when iconOnly is set", async () => {
    renderButton({ iconOnly: true, buttonText: "Help" });
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("opens the modal and validates required fields", async () => {
    const user = userEvent.setup();
    renderButton({ buttonText: "Support" });

    await user.click(screen.getByRole("button", { name: "Support" }));

    expect(await screen.findByText("Contact support")).toBeInTheDocument();

    // Try to send with no message — server call should not happen
    await user.click(screen.getByRole("button", { name: /send message/i }));
    expect(sendSupportRequest).not.toHaveBeenCalled();
  });

  it("submits the support request with form values", async () => {
    sendSupportRequest.mockResolvedValueOnce({ message: "Thanks!" });
    const user = userEvent.setup();
    renderButton({ email: "user@example.com", name: "User", pageLabel: "Dashboard" });

    await user.click(screen.getByRole("button", { name: /support/i }));

    const textarea = await screen.findByPlaceholderText(/describe the issue/i);
    await user.type(textarea, "Need help");

    await user.click(screen.getByRole("button", { name: /send message/i }));

    await waitFor(() => {
      expect(sendSupportRequest).toHaveBeenCalledTimes(1);
    });
    const [payload, photos] = sendSupportRequest.mock.calls[0];
    expect(payload.email).toBe("user@example.com");
    expect(payload.message).toBe("Need help");
    expect(payload.subject).toContain("Dashboard");
    expect(photos).toEqual([]);
  });
});

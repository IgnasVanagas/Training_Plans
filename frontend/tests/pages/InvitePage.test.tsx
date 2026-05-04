import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "../../src/i18n/I18nProvider";
import InvitePage from "../../src/pages/InvitePage";

const apiPut = vi.fn();
vi.mock("../../src/api/client", () => ({
  default: { put: (...args: unknown[]) => apiPut(...args) },
}));

const hasAuthSessionMock = vi.fn();
vi.mock("../../src/utils/authSession", () => ({
  hasAuthSession: () => hasAuthSessionMock(),
}));

const renderInvite = (path = "/invite/TOKEN-XYZ") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <Notifications />
        <I18nProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/invite/:token" element={<InvitePage />} />
              <Route path="/login" element={<div>Login route</div>} />
              <Route path="/dashboard" element={<div>Dashboard route</div>} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
};

describe("InvitePage", () => {
  beforeEach(() => {
    apiPut.mockReset();
    hasAuthSessionMock.mockReset();
  });

  it("redirects unauthenticated users to login when accepting", async () => {
    hasAuthSessionMock.mockReturnValue(false);
    const user = userEvent.setup();
    renderInvite();

    expect(screen.getByText("TOKEN-XYZ")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /accept invitation/i }));
    expect(await screen.findByText("Login route")).toBeInTheDocument();
  });

  it("requires consent before submitting and accepts invitation when checked", async () => {
    hasAuthSessionMock.mockReturnValue(true);
    apiPut.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderInvite();

    // Without consent, accept does nothing
    await user.click(screen.getByRole("button", { name: /accept invitation/i }));
    expect(apiPut).not.toHaveBeenCalled();

    // Toggle consent and accept
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /accept invitation/i }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut).toHaveBeenCalledWith(
      "/users/organization/join",
      expect.objectContaining({
        code: "TOKEN-XYZ",
        athlete_data_sharing_consent: true,
      })
    );

    expect(await screen.findByText("Dashboard route")).toBeInTheDocument();
  });

  it("shows the error alert when accepting fails", async () => {
    hasAuthSessionMock.mockReturnValue(true);
    apiPut.mockRejectedValue({ response: { data: { detail: "Token expired" } } });
    const user = userEvent.setup();
    renderInvite();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /accept invitation/i }));

    await waitFor(() => expect(screen.getByText(/invitation error/i)).toBeInTheDocument());
    expect(screen.getByText("Token expired")).toBeInTheDocument();
  });

  it("returns to login preserving token via the back button", async () => {
    hasAuthSessionMock.mockReturnValue(true);
    const user = userEvent.setup();
    renderInvite();

    await user.click(screen.getByRole("button", { name: /back to login/i }));
    expect(await screen.findByText("Login route")).toBeInTheDocument();
  });
});

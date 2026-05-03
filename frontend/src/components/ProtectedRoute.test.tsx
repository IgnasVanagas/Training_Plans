import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ProtectedRoute from "./ProtectedRoute";

const useQueryMock = vi.fn();
const getMock = vi.fn();
const clearAuthSessionMock = vi.fn();
const hasAuthSessionMock = vi.fn();
const syncLanguagePreferenceMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => useQueryMock(options),
}));

vi.mock("../api/client", () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
  },
}));

vi.mock("../i18n/I18nProvider", () => ({
  useI18n: () => ({
    syncLanguagePreference: syncLanguagePreferenceMock,
  }),
}));

vi.mock("../utils/authSession", () => ({
  clearAuthSession: () => clearAuthSessionMock(),
  hasAuthSession: () => hasAuthSessionMock(),
}));

const renderProtectedRoute = () =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>Secret dashboard</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Login route</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>
  );

describe("ProtectedRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to login when there is no local auth session", async () => {
    hasAuthSessionMock.mockReturnValue(false);
    useQueryMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: false,
      error: null,
    });

    renderProtectedRoute();

    expect(await screen.findByText("Login route")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it("shows a loader while session validation is pending", () => {
    hasAuthSessionMock.mockReturnValue(true);
    useQueryMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      error: null,
    });

    const { container } = renderProtectedRoute();

    expect(screen.queryByText("Secret dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Login route")).not.toBeInTheDocument();
    expect(container.querySelector(".mantine-Center-root")).not.toBeNull();
  });

  it("clears local auth state on non-auth session errors", async () => {
    hasAuthSessionMock.mockReturnValue(true);
    useQueryMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { status: 500 } },
    });

    renderProtectedRoute();

    expect(await screen.findByText("Login route")).toBeInTheDocument();
    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
  });

  it("keeps local auth state on 401 errors", async () => {
    hasAuthSessionMock.mockReturnValue(true);
    useQueryMock.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: { response: { status: 401 } },
    });

    renderProtectedRoute();

    expect(await screen.findByText("Login route")).toBeInTheDocument();
    expect(clearAuthSessionMock).not.toHaveBeenCalled();
  });

  it("renders children after a successful session check and syncs language", async () => {
    hasAuthSessionMock.mockReturnValue(true);
    useQueryMock.mockImplementation((options: { queryFn?: () => Promise<unknown> }) => {
      void options.queryFn?.();
      return {
        data: { profile: { preferred_language: "lt" } },
        isPending: false,
        isError: false,
        error: null,
      };
    });
    getMock.mockResolvedValue({ data: { profile: { preferred_language: "lt" } } });

    renderProtectedRoute();

    expect(await screen.findByText("Secret dashboard")).toBeInTheDocument();
    await waitFor(() => {
      expect(syncLanguagePreferenceMock).toHaveBeenCalledWith("lt");
    });
    expect(getMock).toHaveBeenCalledWith("/users/me");
  });
});
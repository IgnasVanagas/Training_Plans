import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import LoginPage from "./LoginPage";
import api from "../api/client";
import { markAuthSessionActive } from "../utils/authSession";

vi.mock("../api/client", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock("../i18n/I18nProvider", () => ({
  useI18n: () => ({
    language: "en",
    setLanguage: vi.fn(),
    syncLanguagePreference: vi.fn(),
    t: (text: string) => text,
  }),
}));

vi.mock("../components/common/SupportContactButton", () => ({
  default: ({ buttonText }: { buttonText?: string }) => (
    <button type="button">{buttonText || "Support"}</button>
  ),
}));

vi.mock("@mantine/dates", () => ({
  DateInput: ({ label, value, onChange }: { label: string; value: Date | null; onChange: (next: Date | null) => void }) => (
    <input
      aria-label={label}
      value={value instanceof Date ? value.toISOString().slice(0, 10) : ""}
      onChange={(event) => {
        const nextValue = event.currentTarget.value;
        onChange(nextValue ? new Date(`${nextValue}T00:00:00`) : null);
      }}
    />
  ),
}));

type ApiMock = {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const apiMock = api as unknown as ApiMock;

const renderLoginPage = (initialEntry = "/login") => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<div>Dashboard landing</div>} />
            <Route path="/privacy" element={<div>Privacy policy</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
};

describe("LoginPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("redirects authenticated users to the dashboard", async () => {
    markAuthSessionActive("existing-token");

    renderLoginPage();

    expect(await screen.findByText("Dashboard landing")).toBeInTheDocument();
  });

  it("submits forgot-password requests", async () => {
    const user = userEvent.setup();

    apiMock.post.mockImplementation(async (url: string) => {
      if (url === "/auth/forgot-password") {
        return { data: { message: "Reset sent" } };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    renderLoginPage();

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByPlaceholderText("you@example.com"), "athlete@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset instructions" }));

    expect(await screen.findByText("Reset sent")).toBeInTheDocument();
    expect(apiMock.post).toHaveBeenCalledWith("/auth/forgot-password", { email: "athlete@example.com" });
  });

  it("registers invited athletes and verifies their email", async () => {
    const user = userEvent.setup();

    apiMock.post.mockImplementation(async (url: string, payload?: unknown) => {
      if (url === "/auth/logout") {
        return { data: {} };
      }
      if (url === "/auth/register") {
        return { data: { message: "Registration started" } };
      }
      if (url === "/auth/resend-email-confirmation") {
        return { data: { message: "Verification resent" } };
      }
      if (url === "/auth/verify-email") {
        expect(payload).toEqual({ email: "new.athlete@example.com", code: "123456" });
        return { data: {} };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    renderLoginPage("/login?invite=team-code");

    expect(screen.getByText("Team invite detected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.type(screen.getByPlaceholderText("you@example.com"), "new.athlete@example.com");
    await user.type(screen.getByPlaceholderText("Your password"), "StrongPass1!");
    await user.type(screen.getByPlaceholderText("John"), "New");
    await user.type(screen.getByPlaceholderText("Doe"), "Athlete");
    fireEvent.change(screen.getByLabelText("Birth Date"), { target: { value: "2000-01-01" } });

    await user.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("You must accept the Privacy Policy to register.")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Privacy Policy/i }));
    await user.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("You must confirm coach data sharing to join this organization.")).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", {
        name: /I confirm that coaches in this organization can access my Strava-derived training data\./i,
      })
    );
    await user.click(screen.getByRole("button", { name: "Register" }));

    expect(await screen.findByText("Registration started")).toBeInTheDocument();
    expect(screen.getByText("Email verification")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resend verification email" }));
    expect(await screen.findByText("Verification resent")).toBeInTheDocument();

    const digitInputs = screen.getAllByRole("textbox");
    for (const [index, digit] of ["1", "2", "3", "4", "5", "6"].entries()) {
      await user.type(digitInputs[index], digit);
    }
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    expect(await screen.findByText("Email verified successfully. You can now sign in.")).toBeInTheDocument();
  }, 15000);

  it("signs in invited athletes, clears snapshots, and joins the organization", async () => {
    const user = userEvent.setup();

    window.localStorage.setItem("activity:42", "stale");
    window.localStorage.setItem("week-view:current", "stale");

    apiMock.post.mockImplementation(async (url: string, payload?: unknown) => {
      if (url === "/auth/logout") {
        return { data: {} };
      }
      if (url === "/auth/login") {
        expect(payload).toEqual({ email: "signed.in@example.com", password: "StrongPass1!" });
        return { data: { access_token: "fresh-token" } };
      }
      throw new Error(`Unexpected POST ${url}`);
    });
    apiMock.get.mockImplementation(async (url: string) => {
      if (url === "/users/me") {
        return { data: { email: "signed.in@example.com" } };
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    apiMock.put.mockImplementation(async (url: string, payload?: unknown) => {
      if (url === "/users/organization/join") {
        expect(payload).toEqual({
          code: "team-code",
          athlete_data_sharing_consent: true,
          athlete_data_sharing_consent_version: "2026-04-27",
        });
        return { data: {} };
      }
      throw new Error(`Unexpected PUT ${url}`);
    });

    renderLoginPage("/login?invite=team-code");

    await user.type(screen.getByPlaceholderText("you@example.com"), "signed.in@example.com");
    await user.type(screen.getByPlaceholderText("Your password"), "StrongPass1!");
    await user.click(
      screen.getByRole("checkbox", {
        name: /I confirm that coaches in this organization can access my Strava-derived training data\./i,
      })
    );
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Dashboard landing")).toBeInTheDocument();
    expect(window.localStorage.getItem("activity:42")).toBeNull();
    expect(window.localStorage.getItem("week-view:current")).toBeNull();
    expect(window.sessionStorage.getItem("tp:strava-login-recent-sync")).toBe("1");
  });

  it("validates reset-password input before submitting the reset request", async () => {
    const user = userEvent.setup();

    apiMock.post.mockImplementation(async (url: string, payload?: unknown) => {
      if (url === "/auth/reset-password") {
        expect(payload).toEqual({ token: "reset-token", new_password: "UpdatedPass1!" });
        return { data: { message: "Password updated" } };
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    renderLoginPage("/login?reset=reset-token");

    await user.type(screen.getByPlaceholderText("you@example.com"), "reset@example.com");
    await user.type(screen.getByPlaceholderText("New password"), "UpdatedPass1!");
    await user.type(screen.getByPlaceholderText("Confirm new password"), "DifferentPass1!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Confirm new password"));
    await user.type(screen.getByPlaceholderText("Confirm new password"), "UpdatedPass1!");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith("/auth/reset-password", {
        token: "reset-token",
        new_password: "UpdatedPass1!",
      });
    });
  });
});
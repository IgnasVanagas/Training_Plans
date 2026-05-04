import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import App from "../src/App";

vi.mock("../src/components/ProtectedRoute", () => ({
  default: ({ children }: { children: JSX.Element }) => <div data-testid="protected-route">{children}</div>,
}));

vi.mock("../src/pages/LoginPage", () => ({
  default: () => <div>Login page</div>,
}));

vi.mock("../src/pages/Dashboard", () => ({
  default: () => <div>Dashboard page</div>,
}));

vi.mock("../src/pages/InvitePage", () => ({
  default: () => <div>Invite page</div>,
}));

vi.mock("../src/pages/AthleteCalendarPage", () => ({
  AthleteCalendarPage: () => <div>Athlete calendar page</div>,
}));

vi.mock("../src/pages/WorkoutBuilderPage", () => ({
  WorkoutBuilderPage: () => <div>Workout builder page</div>,
}));

vi.mock("../src/pages/ActivityDetailPage", () => ({
  ActivityDetailPage: () => <div>Activity detail page</div>,
}));

vi.mock("../src/pages/PublicCalendarPage", () => ({
  default: () => <div>Public calendar page</div>,
}));

vi.mock("../src/pages/PrivacyPolicyPage", () => ({
  default: () => <div>Privacy policy page</div>,
}));

vi.mock("../src/pages/NotFoundPage", () => ({
  default: () => <div>Not found page</div>,
}));

const renderAt = (path: string) => {
  window.history.pushState({}, "", path);
  return render(
    <MantineProvider>
      <App />
    </MantineProvider>
  );
};

describe("App", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("redirects the root route to the protected dashboard", async () => {
    renderAt("/");

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    expect(screen.getByTestId("protected-route")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("redirects join links with a code to the invite page", async () => {
    renderAt("/join?code=team code");

    expect(await screen.findByText("Invite page")).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/invite/team%20code");
    });
  });

  it("redirects join links without a code to login", async () => {
    renderAt("/join");

    expect(await screen.findByText("Login page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
  });

  it("renders public pages and not found fallbacks", async () => {
    renderAt("/privacy");
    expect(await screen.findByText("Privacy policy page")).toBeInTheDocument();

    renderAt("/calendar/public/public-token");
    expect(await screen.findByText("Public calendar page")).toBeInTheDocument();

    renderAt("/does-not-exist");
    expect(await screen.findByText("Not found page")).toBeInTheDocument();
  });
});
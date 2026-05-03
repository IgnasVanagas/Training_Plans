import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "../i18n/I18nProvider";
import PublicCalendarPage from "./PublicCalendarPage";

const getPublicCalendar = vi.fn();
vi.mock("../api/calendarCollaboration", () => ({
  getPublicCalendar: (...args: unknown[]) => getPublicCalendar(...args),
}));

const renderAt = (path: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/share/:token" element={<PublicCalendarPage />} />
              <Route path="/share" element={<PublicCalendarPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

describe("PublicCalendarPage", () => {
  it("shows error state when request fails", async () => {
    getPublicCalendar.mockRejectedValueOnce(new Error("nope"));
    renderAt("/share/abc");
    await waitFor(() =>
      expect(screen.getByText(/Shared calendar unavailable/i)).toBeInTheDocument(),
    );
  });

  it("renders grouped events and navigates months", async () => {
    getPublicCalendar.mockResolvedValue({
      meta: { athlete_name: "Athlete A", include_completed: true },
      events: [
        { id: 1, title: "Easy run", date: "2026-05-02", is_planned: true },
        { id: 2, title: "Tempo", date: "2026-05-02", is_planned: false },
      ],
    });
    renderAt("/share/tok");
    await waitFor(() => expect(screen.getByText("Athlete A")).toBeInTheDocument());
    expect(screen.getByText("Easy run")).toBeInTheDocument();
    expect(screen.getByText("Tempo")).toBeInTheDocument();
    expect(screen.getByText(/Planned \+ completed/i)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    fireEvent.click(buttons[0]);
    expect(getPublicCalendar).toHaveBeenCalled();
  });

  it("renders empty state when no events", async () => {
    getPublicCalendar.mockResolvedValue({
      meta: { athlete_name: "B", include_completed: false },
      events: [],
    });
    renderAt("/share/tok2");
    await waitFor(() =>
      expect(screen.getByText(/No visible events/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Planned only/i)).toBeInTheDocument();
  });
});

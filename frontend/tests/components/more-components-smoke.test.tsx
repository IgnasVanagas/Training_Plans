import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import DualCalendarView from "../../src/components/DualCalendarView";
import { CoachComparisonPanel } from "../../src/components/CoachComparisonPanel";

vi.mock("../../src/api/client", () => ({
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
vi.mock("../../src/api/organizations", () => ({
  resolveUserPictureUrl: () => null,
}));

const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter>{ui}</MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

describe("more components smoke", () => {
  it("renders DualCalendarView for coach", () => {
    wrap(
      <DualCalendarView
        me={{ id: 1, role: "coach" } as any}
        athletes={[
          { id: 2, email: "a@b.c", profile: { first_name: "A" } } as any,
          { id: 3, email: "c@d.e", profile: { last_name: "B" } } as any,
        ]}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders DualCalendarView for athlete", () => {
    wrap(<DualCalendarView me={{ id: 1, role: "athlete" } as any} athletes={[]} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders CoachComparisonPanel", () => {
    wrap(
      <CoachComparisonPanel
        me={{ id: 1, email: "me@x.y", profile: { first_name: "Me" } } as any}
        athletes={[
          { id: 2, email: "a@b.c", profile: { first_name: "A" } } as any,
        ]}
        isAthlete={false}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

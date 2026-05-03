import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n/I18nProvider";
import ZoneBars from "./coachComparison/ZoneBars";
import { AppSidebarLayout } from "./AppSidebarLayout";
import { ActivitiesView } from "./ActivitiesView";

vi.mock("../api/client", () => ({
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
vi.mock("../api/organizations", () => ({
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

describe("misc components smoke", () => {
  it("renders ZoneBars 5 and 7 zones", () => {
    wrap(<ZoneBars zones={{ Z1: 10, Z2: 20, Z3: 30, Z4: 25, Z5: 15 }} zoneCount={5} />);
    wrap(
      <ZoneBars
        zones={{ Z1: 5, Z2: 10, Z3: 15, Z4: 20, Z5: 25, Z6: 15, Z7: 10 }}
        zoneCount={7}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders AppSidebarLayout", () => {
    wrap(
      <AppSidebarLayout activeNav="dashboard">
        <div>child</div>
      </AppSidebarLayout>,
    );
    expect(document.body.textContent).toContain("child");
  });

  it("renders ActivitiesView", () => {
    wrap(<ActivitiesView currentUserRole="athlete" />);
    expect(document.body.textContent).toBeTruthy();
  });
});

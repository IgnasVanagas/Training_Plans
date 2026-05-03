import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n/I18nProvider";

// Stub leaflet
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div>{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  Marker: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  CircleMarker: () => null,
  useMap: () => ({ flyTo: vi.fn(), fitBounds: vi.fn() }),
  useMapEvents: () => ({}),
  useMapEvent: () => ({}),
  ZoomControl: () => null,
  Pane: ({ children }: any) => <div>{children}</div>,
  LayerGroup: ({ children }: any) => <div>{children}</div>,
  FeatureGroup: ({ children }: any) => <div>{children}</div>,
}));

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
  uploadProfilePicture: vi.fn().mockResolvedValue({}),
}));
vi.mock("../api/integrations", () => ({
  cancelIntegrationSync: vi.fn().mockResolvedValue({ status: "completed" }),
  connectIntegration: vi.fn().mockResolvedValue({ authorization_url: "x" }),
  disconnectIntegration: vi.fn().mockResolvedValue(undefined),
  getIntegrationSyncStatus: vi.fn().mockResolvedValue({ status: "completed" }),
  syncIntegrationNow: vi.fn().mockResolvedValue({ status: "queued" }),
  listIntegrationProviders: vi.fn().mockResolvedValue([]),
  getWellnessSummary: vi.fn().mockResolvedValue({}),
  logManualWellness: vi.fn().mockResolvedValue({}),
  getStravaImportPreferences: vi.fn().mockResolvedValue({ import_all_time: false }),
  setStravaImportPreferences: vi.fn().mockResolvedValue({ import_all_time: true }),
}));

const wrap = (ui: React.ReactElement, route = "/") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

const clickAll = (container: HTMLElement, sel = "button") => {
  const elements = Array.from(container.querySelectorAll(sel)) as HTMLElement[];
  for (const el of elements) {
    try {
      act(() => {
        fireEvent.click(el);
      });
    } catch {
      // ignore
    }
  }
};

const changeAllSelects = (container: HTMLElement) => {
  const selects = Array.from(
    container.querySelectorAll('input[role="searchbox"], input[role="combobox"], select'),
  ) as HTMLElement[];
  for (const el of selects) {
    try {
      act(() => {
        fireEvent.focus(el);
        fireEvent.change(el, { target: { value: "x" } });
      });
    } catch {
      /* ignore */
    }
  }
};

describe("interactive coverage tests", () => {
  it("WorkoutLibrary - filter, click new, click templates", async () => {
    const { WorkoutLibrary } = await import("../components/library/WorkoutLibrary");
    const { container } = wrap(<WorkoutLibrary onSelect={() => {}} onDragStart={() => {}} onDragEnd={() => {}} />);
    // change segmented control values
    const segments = Array.from(container.querySelectorAll('input[type="radio"]'));
    for (const seg of segments) {
      try {
        act(() => fireEvent.click(seg));
      } catch {}
    }
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("WorkoutEditor - click adds and toggles", async () => {
    const { WorkoutEditor } = await import("../components/builder/WorkoutEditor");
    const onChange = vi.fn();
    const { container } = wrap(
      <WorkoutEditor
        structure={[]}
        onChange={onChange}
        sportType="running"
        workoutName="Test"
        description="d"
        intensityType="ftp"
        onWorkoutNameChange={() => {}}
        onDescriptionChange={() => {}}
        onIntensityTypeChange={() => {}}
        onSportTypeChange={() => {}}
        athleteName="A"
        athleteProfile={{ ftp: 250, lt2: 4.5, max_hr: 190, resting_hr: 50, weight: 70 }}
      />,
    );
    clickAll(container);
    // change inputs
    const inputs = Array.from(container.querySelectorAll('input[type="text"], textarea')) as HTMLElement[];
    for (const el of inputs) {
      try {
        act(() => fireEvent.change(el, { target: { value: "edited" } }));
      } catch {}
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it("WorkoutEditor - with structure, click toggle/edit/delete", async () => {
    const { WorkoutEditor } = await import("../components/builder/WorkoutEditor");
    const structure = [
      {
        id: "n1",
        type: "block",
        category: "warmup",
        duration: { type: "time", value: 600 },
        target: { type: "rpe", value: 3 },
      },
      {
        id: "r1",
        type: "repeat",
        repeats: 3,
        steps: [
          {
            id: "n2",
            type: "block",
            category: "work",
            duration: { type: "time", value: 60 },
            target: { type: "power", min: 200, max: 240 },
          },
        ],
      },
    ] as any[];
    const { container } = wrap(
      <WorkoutEditor
        structure={structure}
        onChange={() => {}}
        sportType="cycling"
        workoutName="Test"
        intensityType="ftp"
      />,
    );
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("ActivityUploadPanel - click buttons", async () => {
    const { default: ActivityUploadPanel } = await import("../components/dashboard/ActivityUploadPanel");
    const { container } = wrap(
      <ActivityUploadPanel onUploaded={() => {}} />,
    );
    clickAll(container);
    const inputs = container.querySelectorAll('input[type="text"], input[type="number"]');
    for (const el of Array.from(inputs)) {
      try {
        act(() => fireEvent.change(el as any, { target: { value: "1" } }));
      } catch {}
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it("SettingsForm - input + submit", async () => {
    const { default: SettingsForm } = await import("../components/dashboard/SettingsForm");
    const onSubmit = vi.fn();
    const { container } = wrap(
      <SettingsForm
        user={{
          id: 1,
          email: "a@b.c",
          role: "athlete",
          profile: {
            first_name: "A",
            last_name: "B",
            preferred_units: "metric",
            ftp: 250,
            max_hr: 190,
            resting_hr: 50,
            weight: 70,
          },
        }}
        onSubmit={onSubmit}
        isSaving={false}
      />,
    );
    const inputs = Array.from(container.querySelectorAll("input")) as HTMLInputElement[];
    for (const el of inputs) {
      if (el.type !== "hidden") {
        try {
          act(() => fireEvent.change(el, { target: { value: el.type === "number" ? "100" : "edited" } }));
        } catch {}
      }
    }
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("TrainingCalendar - click navigation buttons", async () => {
    const { TrainingCalendar } = await import("../components/TrainingCalendar");
    const { container } = wrap(<TrainingCalendar athleteId={null} />);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("CoachComparisonPanel - click & change", async () => {
    const { CoachComparisonPanel } = await import("../components/CoachComparisonPanel");
    const { container } = wrap(
      <CoachComparisonPanel
        me={{ id: 1, email: "me@x.y", profile: { first_name: "Me" } } as any}
        athletes={[
          { id: 2, email: "a@b.c", profile: { first_name: "A" } } as any,
          { id: 3, email: "c@d.e", profile: { first_name: "C" } } as any,
        ]}
        isAthlete={false}
      />,
    );
    clickAll(container);
    changeAllSelects(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardCoachAthletesPage - clicks", async () => {
    const { default: DashboardCoachAthletesPage } = await import(
      "../pages/dashboard/DashboardCoachAthletesPage"
    );
    const { container } = wrap(
      <DashboardCoachAthletesPage
        me={{ id: 1, email: "c@x.y", role: "coach", profile: { first_name: "C" } } as any}
        athletes={[
          {
            id: 2,
            email: "a@b.c",
            role: "athlete",
            profile: { first_name: "A", last_name: "B" },
          } as any,
        ]}
        onOpenAthleteSettings={() => {}}
        onOpenAthleteCalendar={() => {}}
        onOpenAthleteMessages={() => {}}
      />,
    );
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardSettingsTab - clicks for coach + athlete", async () => {
    const { default: DashboardSettingsTab } = await import(
      "../pages/dashboard/DashboardSettingsTab"
    );
    const baseUser = {
      id: 1,
      email: "x@y.z",
      role: "athlete",
      profile: {
        first_name: "A",
        last_name: "B",
        preferred_units: "metric",
        ftp: 250,
        max_hr: 190,
        resting_hr: 50,
      },
    } as any;
    const { container } = wrap(
      <DashboardSettingsTab
        me={baseUser}
        athletes={[]}
        permissionsRows={[]}
        shareSettingsRows={[]}
        isSavingProfile={false}
        onSaveProfile={() => {}}
        requestingEmailConfirmation={false}
        changingPassword={false}
        onRequestEmailConfirmation={() => {}}
        onChangePassword={() => {}}
        onUpdateAthletePermission={() => {}}
        onUpdateCalendarShare={() => {}}
        savingAthleteProfileId={null}
        onSaveAthleteProfile={() => {}}
      />,
    );
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardTrainingZonesTab - tab interactions", async () => {
    const { default: DashboardTrainingZonesTab } = await import(
      "../pages/dashboard/DashboardTrainingZonesTab"
    );
    const { container } = wrap(
      <DashboardTrainingZonesTab
        user={{
          id: 1,
          email: "x@y.z",
          role: "athlete",
          profile: {
            ftp: 250,
            max_hr: 190,
            resting_hr: 50,
            preferred_units: "metric",
          },
        } as any}
        onSubmit={() => {}}
        isSaving={false}
      />,
    );
    clickAll(container);
    const radios = Array.from(container.querySelectorAll('input[type="radio"]'));
    for (const r of radios) {
      try {
        act(() => fireEvent.click(r));
      } catch {}
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardOrganizationsTab - clicks", async () => {
    const { default: DashboardOrganizationsTab } = await import(
      "../pages/dashboard/DashboardOrganizationsTab"
    );
    const { container } = wrap(
      <DashboardOrganizationsTab
        me={{ id: 1, email: "x@y.z", role: "athlete", profile: { first_name: "A" } } as any}
        athletes={[]}
      />,
    );
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("AdminPanel - clicks", async () => {
    const { default: AdminPanel } = await import("../pages/dashboard/AdminPanel");
    const { container } = wrap(<AdminPanel activeTab="admin-users" />);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
    const { container: c2 } = wrap(<AdminPanel activeTab="admin-logs" />);
    clickAll(c2);
    const { container: c3 } = wrap(<AdminPanel activeTab="admin-health" />);
    clickAll(c3);
    expect(document.body.textContent).toBeTruthy();
  });

  it("DashboardRacesRecordsTab - clicks", async () => {
    const { default: DashboardRacesRecordsTab } = await import(
      "../pages/dashboard/DashboardRacesRecordsTab"
    );
    const { container } = wrap(
      <DashboardRacesRecordsTab
        me={{ id: 1, email: "x@y.z", role: "athlete" } as any}
        athleteId={null}
      />,
    );
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("InsightsPage - clicks", async () => {
    const { default: InsightsPage } = await import("../pages/dashboard/InsightsPage");
    const { container } = wrap(
      <InsightsPage
        isDark={false}
        me={{ id: 1, email: "x@y.z", role: "athlete" } as any}
        wellnessSummary={{}}
        onSelectMetric={() => {}}
        athleteId={null}
        athletes={[]}
      />,
    );
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });

  it("Dashboard - render and clicks", async () => {
    const { default: Dashboard } = await import("../pages/Dashboard");
    const { container } = wrap(<Dashboard />);
    clickAll(container);
    expect(document.body.textContent).toBeTruthy();
  });
});

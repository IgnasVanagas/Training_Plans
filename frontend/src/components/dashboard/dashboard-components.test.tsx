import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "../../i18n/I18nProvider";
import SettingsForm from "./SettingsForm";
import { MetricHistoryModal } from "./MetricHistoryModal";
import ActivityUploadPanel from "./ActivityUploadPanel";
import CoachAthleteZoneSettingsPanel from "./CoachAthleteZoneSettingsPanel";
import type { User } from "../../pages/dashboard/types";

vi.mock("../../api/client", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));

vi.mock("../../api/activities", () => ({
  createManualActivity: vi.fn().mockResolvedValue({ id: 1 }),
}));

const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <Notifications />
      <I18nProvider>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </I18nProvider>
    </MantineProvider>,
  );
};

const baseAthlete: User = {
  id: 1,
  email: "athlete@x.com",
  role: "athlete",
  profile: {
    first_name: "A",
    last_name: "B",
    main_sport: "running",
    ftp: 200,
    lt2: 4.5,
    max_hr: 190,
    resting_hr: 50,
    zone_settings: {
      running: {
        hr: { lt1: 130, lt2: 160, upper_bounds: [130, 145, 160, 175, 190] },
        pace: { lt1: 4.5, lt2: 3.8, upper_bounds: [5.5, 5.0, 4.5, 4.0, 3.5] },
      },
      cycling: {
        hr: { lt1: 130, lt2: 160, upper_bounds: [130, 145, 160, 175, 190] },
        power: { lt1: 180, lt2: 240, upper_bounds: [120, 180, 220, 260, 320] },
      },
    },
  },
};

describe("components/dashboard smoke", () => {
  it("renders SettingsForm with athlete profile", () => {
    wrap(
      <SettingsForm
        user={baseAthlete}
        onSubmit={() => {}}
        isSaving={false}
        requestingEmailConfirmation={false}
        changingPassword={false}
        onRequestEmailConfirmation={() => {}}
        onChangePassword={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders MetricHistoryModal closed and open variants", () => {
    const setDate = vi.fn();
    const setVal = vi.fn();
    const save = vi.fn();
    const data = [
      { date: "2026-01-01", value: 50 },
      { date: "2026-01-02", value: 52 },
    ];
    const { rerender } = wrap(
      <MetricHistoryModal
        selectedMetric={null}
        onClose={() => {}}
        manualMetricDate={null}
        setManualMetricDate={setDate}
        manualMetricValue=""
        setManualMetricValue={setVal}
        saveDailyMetric={save}
        savingManualMetric={false}
        selectedMetricChartData={[]}
        selectedMetricRows={[]}
      />,
    );
    rerender(
      <MantineProvider>
        <Notifications />
        <I18nProvider>
          <QueryClientProvider client={new QueryClient()}>
            <MetricHistoryModal
              selectedMetric="rhr"
              onClose={() => {}}
              manualMetricDate={new Date("2026-01-01")}
              setManualMetricDate={setDate}
              manualMetricValue={50}
              setManualMetricValue={setVal}
              saveDailyMetric={save}
              savingManualMetric={false}
              selectedMetricChartData={data}
              selectedMetricRows={data}
            />
          </QueryClientProvider>
        </I18nProvider>
      </MantineProvider>,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders ActivityUploadPanel", () => {
    wrap(<ActivityUploadPanel onUploaded={() => {}} />);
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders CoachAthleteZoneSettingsPanel with an athlete", () => {
    wrap(
      <CoachAthleteZoneSettingsPanel
        athletes={[baseAthlete]}
        savingAthleteId={null}
        onSave={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });

  it("renders CoachAthleteZoneSettingsPanel empty list", () => {
    wrap(
      <CoachAthleteZoneSettingsPanel
        athletes={[]}
        savingAthleteId={null}
        onSave={() => {}}
      />,
    );
    expect(document.body.textContent).toBeTruthy();
  });
});

import { useEffect, useMemo, useState } from "react";
import { Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useI18n } from "../../i18n/I18nProvider";
import { Profile, User } from "../../pages/dashboard/types";

type Props = {
  athletes: User[];
  savingAthleteId: number | null;
  onSave: (athleteId: number, profile: Profile) => void;
  initialAthleteId?: string | null;
};

const normalizeProfileDraft = (profile?: Profile | null): Profile => ({
  ftp: profile?.ftp ?? null,
  lt2: profile?.lt2 ?? null,
  max_hr: profile?.max_hr ?? null,
  resting_hr: profile?.resting_hr ?? null,
  main_sport: profile?.main_sport ?? null,
  zone_settings: profile?.zone_settings ?? null,
});

const CoachAthleteZoneSettingsPanel = ({ athletes, savingAthleteId, onSave, initialAthleteId }: Props) => {
  const { t } = useI18n();
  const athleteOptions = useMemo(() => athletes.map((athlete) => ({
    value: athlete.id.toString(),
    label: (athlete.profile?.first_name || athlete.profile?.last_name)
      ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
      : athlete.email,
  })), [athletes]);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(
    (initialAthleteId && athleteOptions.some((o) => o.value === initialAthleteId))
      ? initialAthleteId
      : athleteOptions[0]?.value || null
  );
  const selectedAthlete = athletes.find((athlete) => String(athlete.id) === selectedAthleteId) || null;
  const [draft, setDraft] = useState<Profile>(normalizeProfileDraft(selectedAthlete?.profile));
  const [zoneSport, setZoneSport] = useState<"running" | "cycling">("running");
  const [zoneMetric, setZoneMetric] = useState<"hr" | "pace" | "power">("hr");

  useEffect(() => {
    if (initialAthleteId && athleteOptions.some((o) => o.value === initialAthleteId)) {
      setSelectedAthleteId(initialAthleteId);
      return;
    }
    if (!selectedAthleteId && athleteOptions[0]?.value) {
      setSelectedAthleteId(athleteOptions[0].value);
      return;
    }
    if (selectedAthleteId && !athleteOptions.some((option) => option.value === selectedAthleteId)) {
      setSelectedAthleteId(athleteOptions[0]?.value || null);
    }
  }, [athleteOptions, selectedAthleteId, initialAthleteId]);

  useEffect(() => {
    setDraft(normalizeProfileDraft(selectedAthlete?.profile));
  }, [selectedAthlete]);

  useEffect(() => {
    if (zoneSport === "running" && zoneMetric === "power") {
      setZoneMetric("hr");
    }
    if (zoneSport === "cycling" && zoneMetric === "pace") {
      setZoneMetric("power");
    }
  }, [zoneMetric, zoneSport]);

  const handleChange = (field: keyof Profile, value: unknown) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const lt2Minutes = draft.lt2 ? Math.floor(draft.lt2) : "";
  const lt2Seconds = draft.lt2 ? Math.round((draft.lt2 - Math.floor(draft.lt2)) * 60) : "";

  const handleLt2Change = (type: "min" | "sec", value: number | string) => {
    let minutes = typeof lt2Minutes === "number" ? lt2Minutes : 0;
    let seconds = typeof lt2Seconds === "number" ? lt2Seconds : 0;
    if (type === "min") minutes = Number(value || 0);
    if (type === "sec") seconds = Number(value || 0);
    handleChange("lt2", minutes + seconds / 60);
  };

  const getZoneConfig = () => {
    const settings = draft.zone_settings || {};
    const sportConfig = settings[zoneSport] || {};
    return (sportConfig as any)[zoneMetric] || {};
  };

  const setZoneConfigField = (field: "lt1" | "lt2" | "upper_bounds", value: number | number[] | null) => {
    const next = { ...(draft.zone_settings || {}) } as any;
    next[zoneSport] = { ...(next[zoneSport] || {}) };
    next[zoneSport][zoneMetric] = { ...(next[zoneSport][zoneMetric] || {}) };
    next[zoneSport][zoneMetric][field] = value;
    handleChange("zone_settings", next);
  };

  const zoneConfig = getZoneConfig();
  const expectedUpperBoundCount = (() => {
    if (zoneSport === "running" && zoneMetric === "hr") return 4;
    if (zoneSport === "running" && zoneMetric === "pace") return 6;
    if (zoneSport === "cycling" && zoneMetric === "hr") return 4;
    return 6;
  })();

  const suggestedUpperBounds = (() => {
    const toFixedArray = (values: number[], scale = 0) => values.map((item) => Number(item.toFixed(scale)));
    if (zoneSport === "running" && zoneMetric === "pace") {
      const lt2 = Number(zoneConfig.lt2 ?? draft.lt2 ?? 0);
      if (lt2 > 0) return toFixedArray([lt2 * 0.84, lt2 * 0.90, lt2 * 0.97, lt2 * 1.03, lt2 * 1.10, lt2 * 1.20], 2);
      return [3.8, 4.1, 4.5, 4.9, 5.3, 5.8];
    }
    if (zoneMetric === "power") {
      const ftp = Number(draft.ftp ?? 0);
      if (ftp > 0) return toFixedArray([ftp * 0.55, ftp * 0.75, ftp * 0.90, ftp * 1.05, ftp * 1.20, ftp * 1.50], 0);
      return [120, 160, 200, 240, 280, 340];
    }
    const maxHr = Number(draft.max_hr ?? 0);
    if (maxHr > 0) return toFixedArray([maxHr * 0.60, maxHr * 0.70, maxHr * 0.80, maxHr * 0.90], 0);
    return [120, 135, 150, 165];
  })();

  const zoneUpperBounds = (() => {
    const existing = Array.isArray(zoneConfig.upper_bounds)
      ? zoneConfig.upper_bounds.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
      : [];
    return Array.from({ length: expectedUpperBoundCount }, (_, index) => existing[index] ?? suggestedUpperBounds[index]);
  })();

  const setSingleUpperBound = (index: number, value: number | string) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const next = [...zoneUpperBounds];
    next[index] = value;
    setZoneConfigField("upper_bounds", next);
  };

  const validateZoneSettings = () => {
    const settings = draft.zone_settings;
    if (!settings) return true;
    const checks: Array<{ sport: "running" | "cycling"; metric: "hr" | "pace" | "power"; cfg: any }> = [];
    (["running", "cycling"] as const).forEach((sport) => {
      const sportConfig = settings[sport] || {};
      (Object.keys(sportConfig) as Array<"hr" | "pace" | "power">).forEach((metric) => {
        checks.push({ sport, metric, cfg: (sportConfig as any)[metric] || {} });
      });
    });

    for (const check of checks) {
      const lt1 = check.cfg?.lt1;
      const lt2 = check.cfg?.lt2;
      if (lt1 != null && lt2 != null) {
        if (check.metric === "pace" && !(Number(lt2) < Number(lt1))) {
          notifications.show({ color: "red", title: "Invalid pace LT values", message: "For pace, LT2 must be faster than LT1 (smaller min/km)." });
          return false;
        }
        if (check.metric !== "pace" && !(Number(lt2) > Number(lt1))) {
          notifications.show({ color: "red", title: "Invalid LT values", message: "LT2 must be greater than LT1." });
          return false;
        }
      }

      const bounds = Array.isArray(check.cfg?.upper_bounds) ? check.cfg.upper_bounds : [];
      for (let index = 1; index < bounds.length; index += 1) {
        if (!(Number(bounds[index]) > Number(bounds[index - 1]))) {
          notifications.show({ color: "red", title: "Invalid zone boundaries", message: `${check.sport}/${check.metric} bounds must be strictly increasing.` });
          return false;
        }
      }
    }

    return true;
  };

  const saveDraft = () => {
    if (!selectedAthlete) return;
    if (!validateZoneSettings()) return;
    const payload: Profile = { ...draft };
    (["ftp", "lt2", "max_hr", "resting_hr"] as const).forEach((key) => {
      if (payload[key] == null) {
        (payload[key] as any) = null;
      }
    });
    onSave(selectedAthlete.id, payload);
  };

  return (
    <Stack gap="sm">
      <div>
        <Title order={4}>{t("Athlete Zone Settings") || "Athlete Zone Settings"}</Title>
        <Text size="sm" c="dimmed">{t("Adjust athlete heart rate, power, and pace zones.") || "Adjust athlete heart rate, power, and pace zones."}</Text>
      </div>

      {athleteOptions.length === 0 ? (
        <Text size="sm" c="dimmed">{t("No athletes available for zone editing.") || "No athletes available for zone editing."}</Text>
      ) : (
        <>
          <Select
            label={t("Choose Athlete") || "Choose Athlete"}
            placeholder={t("Select an athlete") || "Select an athlete"}
            data={athleteOptions}
            value={selectedAthleteId}
            onChange={setSelectedAthleteId}
            searchable
          />

          <Paper withBorder p="sm" radius="sm">
            <Stack gap="sm">
              <Text fw={600}>{t("Threshold Metrics") || "Threshold Metrics"}</Text>
              <Group grow>
                <Select
                  label={t("Main Sport") || "Main Sport"}
                  data={[{ value: "running", label: t("Running") || "Running" }, { value: "cycling", label: t("Cycling") || "Cycling" }]}
                  value={draft.main_sport || ""}
                  onChange={(value) => handleChange("main_sport", value || null)}
                />
                <NumberInput
                  label={t("FTP (Watts)") || "FTP (Watts)"}
                  value={draft.ftp ?? ""}
                  onChange={(value) => handleChange("ftp", typeof value === "number" ? value : null)}
                />
              </Group>
              <Group grow>
                <NumberInput
                  label={t("Max HR (bpm)") || "Max HR (bpm)"}
                  value={draft.max_hr ?? ""}
                  onChange={(value) => handleChange("max_hr", typeof value === "number" ? value : null)}
                />
                <NumberInput
                  label={t("RHR (bpm)") || "RHR (bpm)"}
                  value={draft.resting_hr ?? ""}
                  onChange={(value) => handleChange("resting_hr", typeof value === "number" ? value : null)}
                />
              </Group>
              <Stack gap={0}>
                <Text size="sm" fw={500}>{t("LT2 (Pace)") || "LT2 (Pace)"}</Text>
                <Group grow>
                  <NumberInput
                    placeholder={t("Min") || "Min"}
                    min={2}
                    max={59}
                    value={lt2Minutes}
                    onChange={(value) => handleLt2Change("min", value)}
                    suffix="m"
                  />
                  <NumberInput
                    placeholder={t("Sec") || "Sec"}
                    min={0}
                    max={59}
                    value={lt2Seconds}
                    onChange={(value) => handleLt2Change("sec", value)}
                    suffix="s"
                  />
                </Group>
                <Text size="xs" c="dimmed">{t("Minutes : Seconds (min/km)") || "Minutes : Seconds (min/km)"}</Text>
              </Stack>
            </Stack>
          </Paper>

          <Paper withBorder p="sm" radius="sm">
            <Stack gap="sm">
              <Group grow>
                <Select
                  label={t("Sport") || "Sport"}
                  data={[{ value: "running", label: t("Running") || "Running" }, { value: "cycling", label: t("Cycling") || "Cycling" }]}
                  value={zoneSport}
                  onChange={(value) => setZoneSport((value as "running" | "cycling") || "running")}
                  allowDeselect={false}
                />
                <Select
                  label={t("Metric") || "Metric"}
                  data={zoneSport === "running"
                    ? [{ value: "hr", label: t("Heart Rate") || "Heart Rate" }, { value: "pace", label: t("Pace") || "Pace" }]
                    : [{ value: "hr", label: t("Heart Rate") || "Heart Rate" }, { value: "power", label: t("Power") || "Power" }]}
                  value={zoneMetric}
                  onChange={(value) => setZoneMetric((value as "hr" | "pace" | "power") || "hr")}
                  allowDeselect={false}
                />
              </Group>

              <Group grow>
                <NumberInput
                  label={zoneMetric === "pace" ? "LT1 Pace (min/km)" : "LT1"}
                  value={zoneConfig.lt1 ?? ""}
                  onChange={(value) => setZoneConfigField("lt1", typeof value === "number" ? value : null)}
                  decimalScale={zoneMetric === "pace" ? 2 : 0}
                />
                <NumberInput
                  label={zoneMetric === "pace" ? "LT2 Pace (min/km)" : "LT2"}
                  value={zoneConfig.lt2 ?? ""}
                  onChange={(value) => setZoneConfigField("lt2", typeof value === "number" ? value : null)}
                  decimalScale={zoneMetric === "pace" ? 2 : 0}
                />
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                {zoneUpperBounds.map((bound, index) => (
                  <NumberInput
                    key={`${zoneSport}-${zoneMetric}-${index}`}
                    label={`Z${index + 1} upper bound`}
                    value={bound}
                    decimalScale={zoneMetric === "pace" ? 2 : 0}
                    onChange={(value) => setSingleUpperBound(index, value)}
                  />
                ))}
              </SimpleGrid>

              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  {zoneMetric === "pace"
                    ? `Zones defined as Z1…Z${expectedUpperBoundCount + 1} from slow to fast pace.`
                    : `Zones defined as Z1…Z${expectedUpperBoundCount + 1} from low to high intensity.`}
                </Text>
                <Button variant="light" size="xs" onClick={() => setZoneConfigField("upper_bounds", suggestedUpperBounds.slice(0, expectedUpperBoundCount))}>
                  {t("Auto-fill Suggested") || "Auto-fill Suggested"}
                </Button>
              </Group>
            </Stack>
          </Paper>

          <Group justify="flex-end">
            <Button onClick={saveDraft} loading={savingAthleteId === selectedAthlete?.id}>
              {t("Save Athlete Zones") || "Save Athlete Zones"}
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
};

export default CoachAthleteZoneSettingsPanel;
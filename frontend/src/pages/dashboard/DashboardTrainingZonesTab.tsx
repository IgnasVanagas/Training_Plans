import { useState, useCallback, useMemo, useEffect } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconDots,
  IconInfoCircle,
  IconMoodSmile,
  IconRoute,
  IconRun,
  IconBike,
  IconSwimming,
} from "@tabler/icons-react";
import { useI18n } from "../../i18n/I18nProvider";
import type { Profile, User } from "./types";

/* ─── Default zone definitions (% of threshold) ─── */

const RUNNING_HR_ZONES: Array<[number, number]> = [
  [65, 84], [85, 89], [90, 94], [95, 99], [100, 106],
];
// Pace zones based on %LT2 speed: higher speed% = lower pace (faster) = harder zone.
// Zones are represented as % of LT2 pace time (inverse of speed %)
const RUNNING_PACE_ZONES: Array<[number, number]> = [
  [150, 180], // Z1 Recovery  (50-60% LT2 speed; slowest/easiest)
  [120, 150], // Z2 Aerobic   (60-75% LT2 speed)
  [105, 120], // Z3 Tempo     (75-90% LT2 speed)
  [95, 105],  // Z4 Threshold (90-100% LT2 speed)
  [83, 95],   // Z5 VO2max    (100%+ LT2 speed; fastest/hardest)
];
const CYCLING_HR_ZONES: Array<[number, number]> = [
  [65, 81], [82, 89], [90, 93], [94, 99], [100, 102], [103, 106], [107, 120],
];
const CYCLING_POWER_ZONES: Array<[number, number]> = [
  [50, 55], [56, 75], [76, 90], [91, 105], [106, 120], [121, 150], [151, 200],
];
const SWIMMING_HR_ZONES: Array<[number, number]> = [
  [65, 84], [85, 89], [90, 94], [95, 99], [100, 106],
];
const SWIMMING_PACE_ZONES: Array<[number, number]> = [
  [150, 180], // Z1 Recovery  (slowest)
  [120, 150], // Z2 Aerobic
  [105, 120], // Z3 Tempo
  [95, 105],  // Z4 Threshold
  [83, 95],   // Z5 VO2max   (fastest)
];

const RPE_ZONES_5: Array<[number, number]> = [
  [1, 2], [3, 4], [5, 6], [7, 8], [9, 10],
];
const RPE_ZONES_7: Array<[number, number]> = [
  [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [8, 9], [9, 10],
];

type Sport = "running" | "cycling" | "swimming";

const getZoneDefaults = (sport: Sport) => {
  switch (sport) {
    case "running":
      return { hr: RUNNING_HR_ZONES, pace: RUNNING_PACE_ZONES, rpe: RPE_ZONES_5 };
    case "cycling":
      return { hr: CYCLING_HR_ZONES, power: CYCLING_POWER_ZONES, rpe: RPE_ZONES_7 };
    case "swimming":
      return { hr: SWIMMING_HR_ZONES, pace: SWIMMING_PACE_ZONES, rpe: RPE_ZONES_5 };
  }
};

/* ─── Pace formatting (seconds → mm:ss) ─── */
const fmtPace = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};
const parsePaceInput = (v: string): number | null => {
  const parts = v.split(":").map(Number);
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
  return null;
};

const normalizePaceThresholdSeconds = (raw: unknown): number | null => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  // Profile/zone pace threshold is stored as min/km in backend.
  if (parsed < 20) return parsed * 60;
  return parsed;
};

/* ─── Types ─── */
type ZoneRow = { low: number; high: number }; // percentages

type ColumnState = {
  editing: boolean;
  threshold: number | null;
  zones: ZoneRow[];
};

const defaultColumnState = (defaults: Array<[number, number]>): ColumnState => ({
  editing: false,
  threshold: null,
  zones: defaults.map(([lo, hi]) => ({ low: lo, high: hi })),
});

/* ─── Component ─── */
type Props = {
  user: User;
  onSubmit: (data: Profile) => void;
  isSaving: boolean;
};

const DashboardTrainingZonesTab = ({ user, onSubmit, isSaving }: Props) => {
  const isDark = useComputedColorScheme("light") === "dark";
  const { t } = useI18n();

  const [sport, setSport] = useState<Sport>("running");

  const defaults = useMemo(() => getZoneDefaults(sport), [sport]);
  const zoneCount = defaults.hr.length;

  // Stored zone_settings from profile
  const storedZones = user.profile?.zone_settings;

  // Build initial column states from profile or defaults
  const buildInitialHR = useCallback((): ColumnState => {
    const sportCfg = storedZones?.[sport as "running" | "cycling"];
    const hrCfg = sportCfg?.hr;
    if (hrCfg?.upper_bounds?.length) {
      const bounds: number[] = hrCfg.upper_bounds;
      const lt2 = hrCfg.lt2 ?? null;
      // upper_bounds are stored as absolute bpm — convert back to %LTHR
      if (lt2 && lt2 > 0) {
        // Detect corrupt data: if bounds look like raw percentage values (max bound
        // well below threshold), they were saved without a threshold and should be
        // treated as percentages directly instead of dividing by lt2 again.
        const maxBound = Math.max(...bounds);
        const looksLikePercentages = maxBound <= lt2 * 0.75 && maxBound <= 200;

        const zones: ZoneRow[] = [];
        const defaultLow = defaults.hr[0]?.[0] ?? 65;
        for (let i = 0; i < bounds.length; i++) {
          const highPct = looksLikePercentages ? Math.round(bounds[i]) : Math.round((bounds[i] / lt2) * 100);
          const prevPct = i === 0 ? defaultLow : (looksLikePercentages ? Math.round(bounds[i - 1]) : Math.round((bounds[i - 1] / lt2) * 100));
          zones.push({ low: prevPct, high: highPct });
        }
        // Validate: all zones must have low < high; if not, fall back to defaults
        const valid = zones.every(z => z.low < z.high);
        if (valid) {
          return { editing: false, threshold: lt2, zones };
        }
        // Stored bounds are inconsistent with threshold — use default zone percentages
        return {
          editing: false,
          threshold: lt2,
          zones: defaults.hr.map(([lo, hi]) => ({ low: lo, high: hi })),
        };
      }
    }
    return defaultColumnState(defaults.hr);
  }, [sport, storedZones, defaults.hr]);

  const buildInitialPace = useCallback((): ColumnState => {
    const metric = sport === "cycling" ? "power" : "pace";
    const sportCfg = storedZones?.[sport as "running" | "cycling"];
    const cfg = (sportCfg as any)?.[metric];
    if (sport === "cycling" && cfg?.upper_bounds?.length) {
      const bounds: number[] = cfg.upper_bounds;
      const lt2 = cfg.lt2 ?? null;
      // upper_bounds are stored as absolute watts — convert back to %FTP
      if (lt2 && lt2 > 0) {
        const zones: ZoneRow[] = [];
        const defaultLow = CYCLING_POWER_ZONES[0]?.[0] ?? 50;
        for (let i = 0; i < bounds.length; i++) {
          const prevPct = i === 0 ? defaultLow : Math.round((bounds[i - 1] / lt2) * 100);
          zones.push({ low: prevPct, high: Math.round((bounds[i] / lt2) * 100) });
        }
        return { editing: false, threshold: lt2, zones };
      }
    }

    if (sport !== "cycling") {
      const lt2Seconds = normalizePaceThresholdSeconds(cfg?.lt2);
      return {
        editing: false,
        threshold: lt2Seconds,
        zones: defaults.pace!.map(([lo, hi]) => ({ low: lo, high: hi })),
      };
    }

    const paceDefaults = sport === "cycling" ? CYCLING_POWER_ZONES : defaults.pace!;
    return defaultColumnState(paceDefaults);
  }, [sport, storedZones, defaults.pace]);

  const [hrCol, setHrCol] = useState<ColumnState>(buildInitialHR);
  const [paceCol, setPaceCol] = useState<ColumnState>(buildInitialPace);

  // Local raw text for pace threshold input — allows free typing, parsed on blur
  const [paceRawText, setPaceRawText] = useState<string>(
    () => paceCol.threshold ? fmtPace(paceCol.threshold) : ""
  );

  // Reset columns when sport changes
  const handleSportChange = (s: Sport) => {
    setSport(s);
  };

  useEffect(() => {
    const nextHr = buildInitialHR();
    const nextPace = buildInitialPace();
    setHrCol(nextHr);
    setPaceCol(nextPace);
    setPaceRawText(nextPace.threshold ? fmtPace(nextPace.threshold) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  const hrThreshold = hrCol.threshold ?? user.profile?.max_hr ?? null;
  const paceThreshold = paceCol.threshold ?? (sport === "cycling" ? (user.profile?.ftp ?? null) : (user.profile?.lt2 ? user.profile.lt2 * 60 : null));

  const computeAbsValue = (pct: number, threshold: number | null) =>
    threshold ? Math.round((threshold * pct) / 100) : null;

  const sportTabs: Array<{ key: Sport; label: string; icon: typeof IconRun }> = [
    { key: "running", label: t("Running"), icon: IconRun },
    { key: "cycling", label: t("Cycling"), icon: IconBike },
    { key: "swimming", label: t("Swimming"), icon: IconSwimming },
  ];

  const panelBg = isDark ? "var(--mantine-color-dark-6)" : "white";
  const cardBg = isDark ? "var(--mantine-color-dark-7)" : "#f8fafc";
  const paceMetricLabel = sport === "cycling" ? t("Power at FTP") : t("Pace at lactate threshold");
  const paceUnit = sport === "cycling" ? "W" : "/km";
  const hrUnit = "bpm";

  const rpeZones = zoneCount === 7 ? RPE_ZONES_7 : RPE_ZONES_5;

  /* ─── Saving logic ─── */
  const handleSaveHR = () => {
    const sportKey = sport as "running" | "cycling";
    const th = hrCol.threshold;
    // Convert percentage zone bounds to absolute bpm for backend storage
    const upperBounds = th && th > 0
      ? hrCol.zones.map((z) => Math.round((z.high * th) / 100))
      : hrCol.zones.map((z) => z.high);
    const existing = user.profile?.zone_settings || {};
    const sportCfg = { ...(existing[sportKey] || {}) };
    (sportCfg as any).hr = {
      lt2: hrCol.threshold,
      upper_bounds: upperBounds,
    };
    onSubmit({
      zone_settings: { ...existing, [sportKey]: sportCfg },
    });
    setHrCol((prev) => ({ ...prev, editing: false }));
  };

  const handleSavePace = () => {
    const sportKey = sport as "running" | "cycling";
    const metric = sport === "cycling" ? "power" : "pace";
    const existing = user.profile?.zone_settings || {};
    const sportCfg = { ...(existing[sportKey] || {}) };
    if (sport === "cycling") {
      const th = paceCol.threshold;
      // Convert percentage zone bounds to absolute watts for backend storage
      const upperBounds = th && th > 0
        ? paceCol.zones.map((z) => Math.round((z.high * th) / 100))
        : paceCol.zones.map((z) => z.high);
      (sportCfg as any)[metric] = {
        lt2: paceCol.threshold,
        upper_bounds: upperBounds,
      };
    } else {
      // Running pace is stored as min/km threshold; bounds are derived from that threshold.
      const thresholdMinutes = paceCol.threshold && paceCol.threshold > 0
        ? Number((paceCol.threshold / 60).toFixed(4))
        : null;
      (sportCfg as any)[metric] = {
        lt2: thresholdMinutes,
      };
    }
    onSubmit({
      zone_settings: { ...existing, [sportKey]: sportCfg },
    });
    setPaceCol((prev) => ({ ...prev, editing: false }));
  };

  const handleDiscardHR = () => setHrCol(buildInitialHR());
  const handleDiscardPace = () => {
    const initial = buildInitialPace();
    setPaceCol(initial);
    setPaceRawText(initial.threshold ? fmtPace(initial.threshold) : "");
  };

  const updateHrZone = (idx: number, field: "low" | "high", val: number) => {
    setHrCol((prev) => {
      const zones = [...prev.zones];
      zones[idx] = { ...zones[idx], [field]: val };
      return { ...prev, zones };
    });
  };
  const updatePaceZone = (idx: number, field: "low" | "high", val: number) => {
    setPaceCol((prev) => {
      const zones = [...prev.zones];
      zones[idx] = { ...zones[idx], [field]: val };
      return { ...prev, zones };
    });
  };

  /* ─── Zone card renderer ─── */
  const ZoneCard = ({
    zoneNum,
    lowAbs,
    highAbs,
    unit,
    editing,
    lowPct,
    highPct,
    onLowChange,
    onHighChange,
    color,
    isFirst,
    isLast,
  }: {
    zoneNum: number;
    lowAbs: string;
    highAbs: string;
    unit: string;
    editing: boolean;
    lowPct: number;
    highPct: number;
    onLowChange?: (v: number) => void;
    onHighChange?: (v: number) => void;
    color?: string;
    isFirst?: boolean;
    isLast?: boolean;
  }) => (
    <Paper
      withBorder
      p="sm"
      radius="sm"
      style={{
        background: cardBg,
        borderColor: isDark ? "var(--mantine-color-dark-4)" : "#e2e8f0",
      }}
    >
      <Text size="sm" fw={600} c={color || undefined}>
        {t("Zone")} {zoneNum}
      </Text>
      <Group gap={4} align="center" wrap="nowrap">
        <Text size="sm" fw={700}>
          {isFirst
            ? <>{t("less than")} {highAbs} {unit}</>
            : isLast
              ? <>{t("more than")} {lowAbs} {unit}</>
              : <>{lowAbs} {t("to")} {highAbs} {unit}</>
          }
        </Text>
      </Group>
      {editing && (
        <Group gap={4} mt={6} wrap="nowrap">
          <NumberInput
            size="xs"
            w={60}
            value={lowPct}
            onChange={(v) => onLowChange?.(typeof v === "number" ? v : 0)}
            hideControls
          />
          <Text size="xs" c="dimmed">%</Text>
          <Text size="xs" c="dimmed">{t("to")}</Text>
          <NumberInput
            size="xs"
            w={60}
            value={highPct}
            onChange={(v) => onHighChange?.(typeof v === "number" ? v : 0)}
            hideControls
            styles={{ input: { color: "var(--mantine-color-blue-6)", fontWeight: 600 } }}
          />
          <Text size="xs" c="dimmed">%</Text>
        </Group>
      )}
    </Paper>
  );

  return (
    <Box maw={1100} mx="auto" py="md">
      <Title order={2} mb="sm">{t("Training Zones")}</Title>

      {/* Advisory text */}
      <Stack gap={4} mb="md">
        <Text size="sm" c={isDark ? "gray.0" : "dark.9"} style={{ opacity: 0.7 }}>
          {t("The default values on HR at LT and HR at FTP come from scientific norms and are estimated values based on your age. We strongly recommend that you add your individual values, if you know them. The app will examine each of your next workouts and will suggest new values if the required conditions are met.")}
        </Text>
        <Text size="sm" c={isDark ? "gray.0" : "dark.9"} style={{ opacity: 0.7 }}>
          {t("Fill both the Heart Rate (HR) at LT/FTP and the pace/power at LT/FTP/T-time, so your coach can fully individualize your training program, based on that. Thus, providing you with more accurate workout monitoring and analysis.")}
        </Text>
      </Stack>

      {/* Sport tabs */}
      <Group gap={0} mb="lg">
        {sportTabs.map((tab) => (
          <Button
            key={tab.key}
            variant={sport === tab.key ? "outline" : "subtle"}
            leftSection={<tab.icon size={16} />}
            size="sm"
            onClick={() => handleSportChange(tab.key)}
            color={sport === tab.key ? "dark" : "gray"}
            styles={{
              root: {
                borderRadius: sport === tab.key ? 8 : 8,
                fontWeight: sport === tab.key ? 600 : 400,
                borderColor: sport === tab.key ? (isDark ? "#ccc" : "#333") : "transparent",
              },
            }}
          >
            {tab.label}
          </Button>
        ))}
      </Group>

      {/* Three-column zone grid */}
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {/* ─── HR Column ─── */}
        <Paper
          withBorder
          p="md"
          radius="md"
          bg={panelBg}
          style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "#e2e8f0" }}
        >
          <Group justify="space-between" mb="xs" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconActivityHeartbeat size={20} />
              <Text size="sm" fw={600}>
                {t("Heartrate at lactate threshold")}
                <Tooltip label={t("HR zones are calculated as % of your lactate threshold heart rate")}>
                  <IconInfoCircle size={14} style={{ marginLeft: 4, verticalAlign: "middle", opacity: 0.5 }} />
                </Tooltip>
              </Text>
            </Group>
            {hrCol.editing && (
              <Menu shadow="md" width={160} position="bottom-end" withArrow>
                <Menu.Target>
                  <ActionIcon variant="subtle" size="sm"><IconDots size={16} /></ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={handleDiscardHR}>{t("Reset to defaults")}</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>

          {hrCol.editing && (
            <Box mb="sm">
              <Text size="xs" c="dimmed" mb={2}>{t("Threshold")} *</Text>
              <NumberInput
                size="sm"
                w={100}
                value={hrCol.threshold ?? ""}
                onChange={(v) => setHrCol((prev) => ({ ...prev, threshold: typeof v === "number" ? v : null }))}
                suffix={` ${hrUnit}`}
                hideControls
              />
            </Box>
          )}

          <Stack gap={6}>
            {hrCol.zones.map((zone, idx) => {
              const th = hrCol.editing ? hrCol.threshold : hrThreshold;
              const prevHighAbs = idx > 0 ? computeAbsValue(hrCol.zones[idx - 1].high, th) : null;
              const lowAbs = idx === 0
                ? computeAbsValue(zone.low, th)
                : prevHighAbs != null ? prevHighAbs + 1 : computeAbsValue(zone.low, th);
              const highAbs = computeAbsValue(zone.high, th);
              return (
                <ZoneCard
                  key={idx}
                  zoneNum={idx + 1}
                  lowAbs={lowAbs != null ? String(lowAbs) : "—"}
                  highAbs={highAbs != null ? String(highAbs) : "—"}
                  unit={hrUnit}
                  editing={hrCol.editing}
                  lowPct={zone.low}
                  highPct={zone.high}
                  onLowChange={(v) => updateHrZone(idx, "low", v)}
                  onHighChange={(v) => updateHrZone(idx, "high", v)}
                  isFirst={idx === 0}
                  isLast={idx === hrCol.zones.length - 1}
                />
              );
            })}
          </Stack>

          <Group mt="sm" gap="xs">
            {hrCol.editing ? (
              <>
                <Button size="xs" color="dark" onClick={handleSaveHR} loading={isSaving}>
                  {t("Save changes")}
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={handleDiscardHR}>
                  {t("Discard")}
                </Button>
              </>
            ) : (
              <Button
                size="xs"
                variant="outline"
                color="gray"
                onClick={() => setHrCol((prev) => ({ ...prev, editing: true, threshold: hrThreshold }))}
              >
                {t("Adjust zones")}
              </Button>
            )}
          </Group>
        </Paper>

        {/* ─── Pace / Power Column ─── */}
        <Paper
          withBorder
          p="md"
          radius="md"
          bg={panelBg}
          style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "#e2e8f0" }}
        >
          <Group justify="space-between" mb="xs" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconRoute size={20} />
              <Text size="sm" fw={600}>
                {paceMetricLabel}
                <Tooltip label={sport === "cycling"
                  ? t("Power zones are calculated as % of your FTP")
                  : t("Pace zones are calculated as % of your lactate threshold pace")
                }>
                  <IconInfoCircle size={14} style={{ marginLeft: 4, verticalAlign: "middle", opacity: 0.5 }} />
                </Tooltip>
              </Text>
            </Group>
            {paceCol.editing && (
              <Menu shadow="md" width={160} position="bottom-end" withArrow>
                <Menu.Target>
                  <ActionIcon variant="subtle" size="sm"><IconDots size={16} /></ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={handleDiscardPace}>{t("Reset to defaults")}</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>

          {paceCol.editing && (
            <Box mb="sm">
              <Text size="xs" c="dimmed" mb={2}>{t("Threshold")} *</Text>
              {sport === "cycling" ? (
                <NumberInput
                  size="sm"
                  w={100}
                  value={paceCol.threshold ?? ""}
                  onChange={(v) => setPaceCol((prev) => ({ ...prev, threshold: typeof v === "number" ? v : null }))}
                  suffix=" W"
                  hideControls
                />
              ) : (
                <TextInput
                  size="sm"
                  w={120}
                  placeholder="m:ss"
                  value={paceRawText}
                  onChange={(e) => {
                    let v = e.currentTarget.value.replace(/[^0-9:]/g, "");
                    // Auto-insert colon after minutes digit(s) if user types only digits
                    if (v.length >= 2 && !v.includes(":")) {
                      v = v.slice(0, -2) + ":" + v.slice(-2);
                    }
                    setPaceRawText(v);
                    // Eagerly update threshold if already valid
                    const sec = parsePaceInput(v);
                    if (sec !== null && sec > 0) setPaceCol((prev) => ({ ...prev, threshold: sec }));
                  }}
                  onBlur={() => {
                    const sec = parsePaceInput(paceRawText);
                    if (sec !== null && sec > 0) {
                      setPaceCol((prev) => ({ ...prev, threshold: sec }));
                      setPaceRawText(fmtPace(sec));
                    } else if (paceCol.threshold) {
                      // Revert to last valid value
                      setPaceRawText(fmtPace(paceCol.threshold));
                    } else {
                      setPaceRawText("");
                    }
                  }}
                  rightSection={<Text size="xs" c="dimmed">/km</Text>}
                />
              )}
            </Box>
          )}

          <Stack gap={6}>
            {paceCol.zones.map((zone, idx) => {
              const th = paceCol.editing ? paceCol.threshold : paceThreshold;
              let lowAbs: string, highAbs: string;
              if (sport === "cycling") {
                const prevHighAbs = idx > 0 ? computeAbsValue(paceCol.zones[idx - 1].high, th) : null;
                const l = idx === 0
                  ? computeAbsValue(zone.low, th)
                  : prevHighAbs != null ? prevHighAbs + 1 : computeAbsValue(zone.low, th);
                const h = computeAbsValue(zone.high, th);
                lowAbs = l != null ? String(l) : "—";
                highAbs = h != null ? String(h) : "—";
              } else {
                // Pace: compute absolute seconds then format
                const l = th ? (th * zone.low) / 100 : null;
                const h = th ? (th * zone.high) / 100 : null;
                lowAbs = l != null ? fmtPace(l) : "—";
                highAbs = h != null ? fmtPace(h) : "—";
              }
              return (
                <ZoneCard
                  key={idx}
                  zoneNum={idx + 1}
                  lowAbs={lowAbs}
                  highAbs={highAbs}
                  unit={paceUnit}
                  editing={paceCol.editing}
                  lowPct={zone.low}
                  highPct={zone.high}
                  onLowChange={(v) => updatePaceZone(idx, "low", v)}
                  onHighChange={(v) => updatePaceZone(idx, "high", v)}
                  color="blue"
                  isFirst={idx === 0}
                  isLast={idx === paceCol.zones.length - 1}
                />
              );
            })}
          </Stack>

          <Group mt="sm" gap="xs">
            {paceCol.editing ? (
              <>
                <Button size="xs" color="dark" onClick={handleSavePace} loading={isSaving}>
                  {t("Save changes")}
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={handleDiscardPace}>
                  {t("Discard")}
                </Button>
              </>
            ) : (
              <Button
                size="xs"
                variant="outline"
                color="gray"
                onClick={() => {
                  setPaceCol((prev) => ({ ...prev, editing: true, threshold: paceThreshold }));
                  setPaceRawText(paceThreshold ? fmtPace(paceThreshold) : "");
                }}
              >
                {t("Adjust zones")}
              </Button>
            )}
          </Group>
        </Paper>

        {/* ─── RPE Column (always read-only) ─── */}
        <Paper
          withBorder
          p="md"
          radius="md"
          bg={panelBg}
          style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "#e2e8f0" }}
        >
          <Group gap={6} mb="xs" wrap="nowrap">
            <IconMoodSmile size={20} />
            <Text size="sm" fw={600}>
              RPE
              <Tooltip label={t("Rate of Perceived Exertion — a subjective 1-10 effort scale")}>
                <IconInfoCircle size={14} style={{ marginLeft: 4, verticalAlign: "middle", opacity: 0.5 }} />
              </Tooltip>
            </Text>
          </Group>

          <Stack gap={6}>
            {rpeZones.map(([low, high], idx) => (
              <Paper
                key={idx}
                withBorder
                p="sm"
                radius="sm"
                style={{
                  background: cardBg,
                  borderColor: isDark ? "var(--mantine-color-dark-4)" : "#e2e8f0",
                }}
              >
                <Text size="sm" fw={600}>{t("Zone")} {idx + 1}</Text>
                <Text size="sm" fw={700}>{low} {t("to")} {high}</Text>
              </Paper>
            ))}
          </Stack>
        </Paper>
      </SimpleGrid>
    </Box>
  );
};

export default DashboardTrainingZonesTab;

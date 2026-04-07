import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Drawer,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconBan,
  IconFlag,
  IconHeartBroken,
  IconInfoCircle,
  IconPlane,
  IconPlayerPlay,
  IconPlus,
  IconSettings2,
  IconShieldOff,
  IconTarget,
  IconTrash,
  IconTrophy,
  IconVirus,
} from "@tabler/icons-react";
import { format, parseISO } from "date-fns";
import {
  applySeasonPlan,
  getLatestSeasonPlan,
  PeriodizationConfig,
  PlannerConstraint,
  previewSeasonPlan,
  saveSeasonPlan,
  SeasonPlanPayload,
  SeasonPlanPreview,
} from "../../api/planning";
import { useI18n } from "../../i18n/I18nProvider";
import { User } from "../../pages/dashboard/types";
import {
  athleteLabel,
  defaultPlan,
  emptyConstraint,
  emptyMetric,
  emptyRace,
  normalizePlan,
  removeConstraint,
  removeMetric,
  removeRace,
  removeRaceMetric,
  setConstraintField,
  setMetricField,
  setPeriodizationField,
  setPlanField,
  setRaceField,
  setRaceMetricField,
} from "./seasonPlanUtils";
import SeasonPlannerPreview from "./SeasonPlannerPreview";

const PERIODIZATION_MODEL_INFO: Record<string, { label: string; description: string }> = {
  polarized:  { label: "Polarized (80/20)", description: "~80% low intensity, ~20% high intensity. Gold standard supported by Seiler (2010), Stöggl & Sperlich (2015)." },
  pyramidal:  { label: "Pyramidal", description: "Decreasing volume from Z1→Z5. Effective in well-trained athletes (Esteve-Lanao et al., 2007)." },
  threshold:  { label: "Threshold / Sweetspot", description: "Higher proportion of tempo/threshold work. Time-efficient for time-crunched athletes." },
};

const CONSTRAINT_ICONS: Record<string, React.ElementType> = {
  injury:      IconHeartBroken,
  travel:      IconPlane,
  sickness:    IconVirus,
  unavailable: IconBan,
};
const CONSTRAINT_COLORS: Record<string, string> = {
  injury:      "red",
  travel:      "cyan",
  sickness:    "orange",
  unavailable: "gray",
};

const PRIORITY_BORDER: Record<string, string> = {
  A: "#EF4444",
  B: "#F59E0B",
  C: "#6366F1",
};

type Props = {
  opened: boolean;
  onClose: () => void;
  me: User;
  athletes: User[];
  selectedAthleteId?: number | null;
  inline?: boolean;
};

export default function SeasonPlannerDrawer({ opened, onClose, me, athletes, selectedAthleteId, inline }: Props) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const isDark = useComputedColorScheme("light") === "dark";

  const ui = {
    cardBg:  isDark ? "rgba(22, 34, 58, 0.62)" : "rgba(255,255,255,0.92)",
    border:  isDark ? "rgba(148,163,184,0.28)" : "rgba(15,23,42,0.14)",
    textDim: isDark ? "#9FB0C8" : "#52617A",
  } as const;

  const athleteOptions = useMemo(
    () => athletes.map((athlete) => ({ value: athlete.id.toString(), label: athleteLabel(athlete) })),
    [athletes],
  );

  const fallbackTargetAthleteId = me.role === "coach"
    ? (selectedAthleteId ?? athletes[0]?.id ?? null)
    : me.id;
  const [targetAthleteId, setTargetAthleteId] = useState<number | null>(fallbackTargetAthleteId);
  const selectedAthlete = useMemo(
    () => (me.role === "coach" ? athletes.find((athlete) => athlete.id === targetAthleteId) || null : me),
    [athletes, me, targetAthleteId],
  );
  const [plan, setPlan] = useState<SeasonPlanPayload>(() => defaultPlan(me.profile?.main_sport || "Cycling", athleteLabel(selectedAthlete)));
  const [preview, setPreview] = useState<SeasonPlanPreview | null>(null);
  const [replaceGenerated, setReplaceGenerated] = useState("replace");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    setTargetAthleteId(fallbackTargetAthleteId);
  }, [fallbackTargetAthleteId, opened]);

  const planQuery = useQuery({
    queryKey: ["season-plan", targetAthleteId],
    enabled: opened && Boolean(targetAthleteId),
    queryFn: () => getLatestSeasonPlan(targetAthleteId),
  });

  useEffect(() => {
    if (!opened || !targetAthleteId) return;
    const sportType = selectedAthlete?.profile?.main_sport || me.profile?.main_sport || "Cycling";
    setPlan(normalizePlan(planQuery.data || null, sportType, athleteLabel(selectedAthlete)));
    setPreview(planQuery.data?.generated_summary || null);
    setLocalError(null);
  }, [me.profile?.main_sport, opened, planQuery.data, selectedAthlete, targetAthleteId]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!targetAthleteId) throw new Error(t("Choose athlete") || "Choose athlete");
      return previewSeasonPlan(plan, targetAthleteId);
    },
    onSuccess: (data) => { setPreview(data); setLocalError(null); },
    onError: (error: any) => setLocalError(error?.response?.data?.detail || error?.message || (t("Could not preview plan") || "Could not preview plan")),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!targetAthleteId) throw new Error(t("Choose athlete") || "Choose athlete");
      return saveSeasonPlan(plan, targetAthleteId);
    },
    onSuccess: (data) => {
      setPlan(normalizePlan(data, data.sport_type, athleteLabel(selectedAthlete)));
      setPreview(data.generated_summary || null);
      setLocalError(null);
      queryClient.invalidateQueries({ queryKey: ["season-plan", targetAthleteId] });
      notifications.show({ color: "green", title: t("Season framework saved") || "Season framework saved", message: t("Race priorities and cycle settings are stored.") || "Race priorities and cycle settings are stored." });
    },
    onError: (error: any) => setLocalError(error?.response?.data?.detail || error?.message || (t("Could not save plan") || "Could not save plan")),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const saved = plan.id ? null : await saveSeasonPlan(plan, targetAthleteId);
      const planId = saved?.id || plan.id;
      if (!planId) throw new Error(t("Save the framework first") || "Save the framework first");
      return applySeasonPlan(planId, replaceGenerated === "replace");
    },
    onSuccess: (data) => {
      setPreview(data.preview);
      setLocalError(null);
      queryClient.invalidateQueries({ queryKey: ["season-plan", targetAthleteId] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-calendar"] });
      notifications.show({
        color: "green",
        title: t("Season plan applied") || "Season plan applied",
        message: `${data.created_count} ${t("workouts generated") || "workouts generated"}${data.skipped_count ? ` · ${data.skipped_count} ${t("days skipped") || "days skipped"}` : ""}`,
      });
    },
    onError: (error: any) => setLocalError(error?.response?.data?.detail || error?.message || (t("Could not apply plan") || "Could not apply plan")),
  });

  const sportOptions = [
    { value: "Cycling", label: t("Cycling") || "Cycling" },
    { value: "Running", label: t("Running") || "Running" },
  ];

  const content = (
    <ScrollArea h={inline ? "calc(100dvh - 140px)" : "calc(100vh - 90px)"} offsetScrollbars>
      <Stack gap="md" pb="xl" px={inline ? "md" : undefined}>
        {localError && <Alert color="red">{localError}</Alert>}
        {planQuery.isLoading && <Alert color="blue">{t("Loading saved framework") || "Loading saved framework"}</Alert>}

        {/* ── Goal and Race Framework ── */}
        <Paper withBorder radius="md" p="md" bg={ui.cardBg} style={{ borderColor: ui.border }}>
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Group gap="xs" align="center">
                <ThemeIcon size="sm" variant="light" color="orange" radius="xl"><IconFlag size={12} /></ThemeIcon>
                <Box>
                  <Text fw={700}>{t("Goal and Race Framework") || "Goal and Race Framework"}</Text>
                  <Text size="xs" c="dimmed">{t("Set race priorities, target metrics, countdowns, and taper orchestration.") || "Set race priorities, target metrics, countdowns, and taper orchestration."}</Text>
                </Box>
              </Group>
              <Badge variant="light">{selectedAthlete ? athleteLabel(selectedAthlete) : me.email}</Badge>
            </Group>

            {me.role === "coach" && (
              <Select
                label={t("Assign to Athlete") || "Assign to Athlete"}
                data={athleteOptions}
                value={targetAthleteId?.toString() || null}
                onChange={(value) => setTargetAthleteId(value ? Number(value) : null)}
                placeholder={t("Select athlete") || "Select athlete"}
              />
            )}

            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label={t("Plan name") || "Plan name"}
                value={plan.name}
                onChange={(e) => setPlan((p) => setPlanField(p, "name", e.currentTarget.value))}
              />
              <Select
                label={t("Sport") || "Sport"}
                data={sportOptions}
                value={plan.sport_type}
                onChange={(value) => value && setPlan((p) => setPlanField(p, "sport_type", value))}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <DatePickerInput
                label={t("Season start") || "Season start"}
                value={plan.season_start ? parseISO(plan.season_start) : null}
                onChange={(date) => date && setPlan((p) => setPlanField(p, "season_start", format(date, "yyyy-MM-dd")))}
                valueFormat="DD/MM/YYYY"
                clearable={false}
              />
              <DatePickerInput
                label={t("Season end") || "Season end"}
                value={plan.season_end ? parseISO(plan.season_end) : null}
                onChange={(date) => date && setPlan((p) => setPlanField(p, "season_end", format(date, "yyyy-MM-dd")))}
                valueFormat="DD/MM/YYYY"
                clearable={false}
              />
            </SimpleGrid>

            <Textarea
              label={t("Planner notes") || "Planner notes"}
              minRows={2}
              value={plan.notes || ""}
              onChange={(e) => setPlan((p) => setPlanField(p, "notes", e.currentTarget.value))}
            />
          </Stack>
        </Paper>

        {/* ── Season target metrics ── */}
        <Paper withBorder radius="md" p="md" bg={ui.cardBg} style={{ borderColor: ui.border }}>
          <Stack gap="sm">
            <Group justify="space-between">
              <Group gap="xs" align="center">
                <ThemeIcon size="sm" variant="light" color="cyan" radius="xl"><IconTarget size={12} /></ThemeIcon>
                <Text fw={700}>{t("Season target metrics") || "Season target metrics"}</Text>
              </Group>
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />}
                onClick={() => setPlan((p) => ({ ...p, target_metrics: [...p.target_metrics, emptyMetric()] }))}>
                {t("Add metric") || "Add metric"}
              </Button>
            </Group>
            {plan.target_metrics.map((metric, index) => (
              <Group key={`season-metric-${index}`} align="flex-end" wrap="nowrap">
                <TextInput flex={1} label={t("Metric") || "Metric"} value={metric.metric}
                  onChange={(e) => setPlan((p) => setMetricField(p, index, "metric", e.currentTarget.value))} />
                <TextInput flex={1} label={t("Target value") || "Target value"} value={String(metric.value ?? "")}
                  onChange={(e) => setPlan((p) => setMetricField(p, index, "value", e.currentTarget.value))} />
                <TextInput w={110} label={t("Unit") || "Unit"} value={metric.unit || ""}
                  onChange={(e) => setPlan((p) => setMetricField(p, index, "unit", e.currentTarget.value))} />
                <ActionIcon color="red" variant="subtle" onClick={() => setPlan((p) => removeMetric(p, index))}>
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        </Paper>

        {/* ── Goal races ── */}
        <Paper withBorder radius="md" p="md" bg={ui.cardBg} style={{ borderColor: ui.border }}>
          <Stack gap="sm">
            <Group justify="space-between">
              <Group gap="xs" align="center">
                <ThemeIcon size="sm" variant="light" color="orange" radius="xl"><IconTrophy size={12} /></ThemeIcon>
                <Box>
                  <Text fw={700}>{t("Goal races") || "Goal races"}</Text>
                  <Text size="xs" c="dimmed">{t("A races drive peak/taper logic, B races get mini peaks, C races stay supportive.") || "A races drive peak/taper logic, B races get mini peaks, C races stay supportive."}</Text>
                </Box>
              </Group>
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />}
                onClick={() => setPlan((p) => ({ ...p, goal_races: [...p.goal_races, emptyRace()] }))}>
                {t("Add race") || "Add race"}
              </Button>
            </Group>

            {plan.goal_races.length === 0 && (
              <Stack align="center" gap="xs" py="lg">
                <ThemeIcon size="xl" variant="light" color="orange" radius="xl"><IconTrophy size={20} /></ThemeIcon>
                <Text size="sm" c="dimmed" ta="center">
                  {t("No races added yet. Add an A race to generate a peak and taper.") || "No races added yet. Add an A race to generate a peak and taper."}
                </Text>
              </Stack>
            )}

            {plan.goal_races.map((race, raceIndex) => (
              <Card
                key={`race-${raceIndex}`}
                withBorder
                radius="md"
                style={{ borderLeft: `4px solid ${PRIORITY_BORDER[race.priority] || PRIORITY_BORDER.C}` }}
              >
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text fw={600}>{race.name || `${t("Race") || "Race"} ${raceIndex + 1}`}</Text>
                    <ActionIcon color="red" variant="subtle" onClick={() => setPlan((p) => removeRace(p, raceIndex))}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Select label={t("Sport") || "Sport"} data={sportOptions} value={race.sport_type || ""}
                      onChange={(value) => setPlan((p) => setRaceField(p, raceIndex, "sport_type", value || ""))}
                      placeholder={t("Select sport") || "Select sport"} />
                    <TextInput label={t("Race name") || "Race name"} value={race.name} required
                      onChange={(e) => setPlan((p) => setRaceField(p, raceIndex, "name", e.currentTarget.value))} />
                  </SimpleGrid>
                  <SimpleGrid cols={{ base: 1, sm: 3 }}>
                    <DatePickerInput
                      label={t("Race date") || "Race date"}
                      value={race.date ? parseISO(race.date) : null}
                      onChange={(date) => date && setPlan((p) => setRaceField(p, raceIndex, "date", format(date, "yyyy-MM-dd")))}
                      valueFormat="DD/MM/YYYY"
                      clearable={false}
                      required
                    />
                    <NumberInput label={t("Distance") || "Distance"} value={race.distance_km ?? ""} min={0} step={0.1} suffix=" km"
                      onChange={(value) => setPlan((p) => setRaceField(p, raceIndex, "distance_km", typeof value === "number" ? value : null))} />
                    <TextInput label={t("Expected time") || "Expected time"} placeholder="hh:mm:ss" value={race.expected_time || ""}
                      onChange={(e) => setPlan((p) => setRaceField(p, raceIndex, "expected_time", e.currentTarget.value))} />
                  </SimpleGrid>
                  <SimpleGrid cols={{ base: 1, sm: 3 }}>
                    <Select label={t("Priority") || "Priority"} data={["A", "B", "C"]} value={race.priority}
                      onChange={(value) => value && setPlan((p) => setRaceField(p, raceIndex, "priority", value as "A" | "B" | "C"))} />
                    <TextInput label={t("Location") || "Location"} value={race.location || ""}
                      onChange={(e) => setPlan((p) => setRaceField(p, raceIndex, "location", e.currentTarget.value))} />
                  </SimpleGrid>
                  <Textarea label={t("Details") || "Details"} minRows={2} value={race.notes || ""}
                    onChange={(e) => setPlan((p) => setRaceField(p, raceIndex, "notes", e.currentTarget.value))} />

                  <Divider label={t("Race target metrics") || "Race target metrics"} labelPosition="center" />
                  {race.target_metrics.map((metric, metricIndex) => (
                    <Group key={`race-${raceIndex}-metric-${metricIndex}`} align="flex-end" wrap="nowrap">
                      <TextInput flex={1} label={t("Metric") || "Metric"} value={metric.metric}
                        onChange={(e) => setPlan((p) => setRaceMetricField(p, raceIndex, metricIndex, "metric", e.currentTarget.value))} />
                      <TextInput flex={1} label={t("Target value") || "Target value"} value={String(metric.value ?? "")}
                        onChange={(e) => setPlan((p) => setRaceMetricField(p, raceIndex, metricIndex, "value", e.currentTarget.value))} />
                      <TextInput w={110} label={t("Unit") || "Unit"} value={metric.unit || ""}
                        onChange={(e) => setPlan((p) => setRaceMetricField(p, raceIndex, metricIndex, "unit", e.currentTarget.value))} />
                      <ActionIcon color="red" variant="subtle" onClick={() => setPlan((p) => removeRaceMetric(p, raceIndex, metricIndex))}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />}
                    onClick={() => setPlan((p) => ({ ...p, goal_races: p.goal_races.map((row, i) => i === raceIndex ? { ...row, target_metrics: [...row.target_metrics, emptyMetric()] } : row) }))}>
                    {t("Add race metric") || "Add race metric"}
                  </Button>
                </Stack>
              </Card>
            ))}
          </Stack>
        </Paper>

        {/* ── Availability and constraints ── */}
        <Paper withBorder radius="md" p="md" bg={ui.cardBg} style={{ borderColor: ui.border }}>
          <Stack gap="sm">
            <Group justify="space-between">
              <Group gap="xs" align="center">
                <ThemeIcon size="sm" variant="light" color="red" radius="xl"><IconShieldOff size={12} /></ThemeIcon>
                <Box>
                  <Text fw={700}>{t("Availability and constraints") || "Availability and constraints"}</Text>
                  <Text size="xs" c="dimmed">{t("Travel, sickness, injury, and unavailable windows reduce load or force recovery weeks.") || "Travel, sickness, injury, and unavailable windows reduce load or force recovery weeks."}</Text>
                </Box>
              </Group>
              <Button size="xs" variant="light" leftSection={<IconPlus size={14} />}
                onClick={() => setPlan((p) => ({ ...p, constraints: [...p.constraints, emptyConstraint()] }))}>
                {t("Add constraint") || "Add constraint"}
              </Button>
            </Group>

            {plan.constraints.length === 0 && (
              <Stack align="center" gap="xs" py="md">
                <ThemeIcon size="xl" variant="light" color="gray" radius="xl"><IconShieldOff size={20} /></ThemeIcon>
                <Text size="sm" c="dimmed" ta="center">
                  {t("No constraints yet. Add travel, injury, or unavailability windows.") || "No constraints yet. Add travel, injury, or unavailability windows."}
                </Text>
              </Stack>
            )}

            {plan.constraints.map((constraint, index) => {
              const ConstraintIcon = CONSTRAINT_ICONS[constraint.kind] || IconBan;
              return (
                <Card key={`constraint-${index}`} withBorder radius="md">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Group gap="xs" align="center">
                        <ThemeIcon size="sm" variant="light" color={CONSTRAINT_COLORS[constraint.kind] || "gray"} radius="xl">
                          <ConstraintIcon size={12} />
                        </ThemeIcon>
                        <Text fw={600}>{constraint.name || `${t("Constraint") || "Constraint"} ${index + 1}`}</Text>
                      </Group>
                      <ActionIcon color="red" variant="subtle" onClick={() => setPlan((p) => removeConstraint(p, index))}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <TextInput label={t("Label") || "Label"} value={constraint.name || ""}
                        onChange={(e) => setPlan((p) => setConstraintField(p, index, "name", e.currentTarget.value))} />
                      <Select label={t("Type") || "Type"} value={constraint.kind}
                        data={[
                          { value: "injury",      label: t("Injury") || "Injury" },
                          { value: "travel",      label: t("Travel") || "Travel" },
                          { value: "sickness",    label: t("Sickness") || "Sickness" },
                          { value: "unavailable", label: t("Unavailable") || "Unavailable" },
                        ]}
                        onChange={(value) => value && setPlan((p) => setConstraintField(p, index, "kind", value as PlannerConstraint["kind"]))} />
                    </SimpleGrid>
                    <SimpleGrid cols={{ base: 1, sm: 4 }}>
                      <DatePickerInput
                        label={t("Start") || "Start"}
                        value={constraint.start_date ? parseISO(constraint.start_date) : null}
                        onChange={(date) => date && setPlan((p) => setConstraintField(p, index, "start_date", format(date, "yyyy-MM-dd")))}
                        valueFormat="DD/MM/YYYY"
                        clearable={false}
                      />
                      <DatePickerInput
                        label={t("End") || "End"}
                        value={constraint.end_date ? parseISO(constraint.end_date) : null}
                        onChange={(date) => date && setPlan((p) => setConstraintField(p, index, "end_date", format(date, "yyyy-MM-dd")))}
                        valueFormat="DD/MM/YYYY"
                        clearable={false}
                      />
                      <Select label={t("Severity") || "Severity"} value={constraint.severity}
                        data={[
                          { value: "low",      label: t("Low") || "Low" },
                          { value: "moderate", label: t("Moderate") || "Moderate" },
                          { value: "high",     label: t("High") || "High" },
                        ]}
                        onChange={(value) => value && setPlan((p) => setConstraintField(p, index, "severity", value as PlannerConstraint["severity"]))} />
                      <Select label={t("Impact") || "Impact"} value={constraint.impact}
                        data={[
                          { value: "reduce",           label: t("Reduce load") || "Reduce load" },
                          { value: "avoid_intensity",  label: t("Avoid intensity") || "Avoid intensity" },
                          { value: "rest",             label: t("Rest only") || "Rest only" },
                        ]}
                        onChange={(value) => value && setPlan((p) => setConstraintField(p, index, "impact", value as PlannerConstraint["impact"]))} />
                    </SimpleGrid>
                    <Textarea label={t("Constraint notes") || "Constraint notes"} minRows={2} value={constraint.notes || ""}
                      onChange={(e) => setPlan((p) => setConstraintField(p, index, "notes", e.currentTarget.value))} />
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        </Paper>

        {/* ── Periodization settings ── */}
        <Paper withBorder radius="md" p="md" bg={ui.cardBg} style={{ borderColor: ui.border }}>
          <Stack gap="sm">
            <Group gap="xs" align="center">
              <ThemeIcon size="sm" variant="light" color="indigo" radius="xl"><IconSettings2 size={12} /></ThemeIcon>
              <Text fw={700}>{t("Periodization settings") || "Periodization settings"}</Text>
            </Group>

            <Paper withBorder radius="md" p="sm" bg={isDark ? "dark.6" : "indigo.0"} style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-indigo-2)" }}>
              <Stack gap="xs">
                <Select
                  label={t("Periodization model") || "Periodization model"}
                  data={Object.entries(PERIODIZATION_MODEL_INFO).map(([value, info]) => ({ value, label: info.label }))}
                  value={plan.periodization.periodization_model}
                  onChange={(value) => value && setPlan((p) => setPeriodizationField(p, "periodization_model", value as PeriodizationConfig["periodization_model"]))}
                />
                <Group gap="xs" align="flex-start">
                  <ThemeIcon size="sm" variant="light" color="indigo" radius="xl"><IconInfoCircle size={12} /></ThemeIcon>
                  <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                    {PERIODIZATION_MODEL_INFO[plan.periodization.periodization_model]?.description || ""}
                  </Text>
                </Group>
              </Stack>
            </Paper>

            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput label={t("Weekly hours target") || "Weekly hours target"} value={plan.periodization.weekly_hours_target} min={1} max={40} step={0.5}
                onChange={(value) => setPlan((p) => setPeriodizationField(p, "weekly_hours_target", Number(value) || 1))} />
              <NumberInput label={t("Longest session minutes") || "Longest session minutes"} value={plan.periodization.longest_session_minutes} min={30} max={600} step={10}
                onChange={(value) => setPlan((p) => setPeriodizationField(p, "longest_session_minutes", Number(value) || 30))} />
              <NumberInput label={t("Training days per week") || "Training days per week"} value={plan.periodization.training_days_per_week} min={2} max={7} step={1}
                onChange={(value) => setPlan((p) => setPeriodizationField(p, "training_days_per_week", Number(value) || 2))} />
              <NumberInput label={t("Recovery week frequency") || "Recovery week frequency"} value={plan.periodization.recovery_week_frequency} min={2} max={6} step={1}
                onChange={(value) => setPlan((p) => setPeriodizationField(p, "recovery_week_frequency", Number(value) || 2))} />
            </SimpleGrid>
            <Select label={t("Taper profile") || "Taper profile"}
              data={[
                { value: "short",    label: t("Short") || "Short" },
                { value: "standard", label: t("Standard") || "Standard" },
                { value: "extended", label: t("Extended") || "Extended" },
              ]}
              value={plan.periodization.taper_profile}
              onChange={(value) => value && setPlan((p) => setPeriodizationField(p, "taper_profile", value as PeriodizationConfig["taper_profile"]))} />
          </Stack>
        </Paper>

        {/* ── Generate and apply ── */}
        <Paper withBorder radius="md" p="md" bg={ui.cardBg} style={{ borderColor: ui.border }}>
          <Stack gap="sm">
            <Group gap="xs" align="center">
              <ThemeIcon size="sm" variant="light" color="green" radius="xl"><IconPlayerPlay size={12} /></ThemeIcon>
              <Text fw={700}>{t("Generate and apply") || "Generate and apply"}</Text>
            </Group>
            <Group wrap="wrap">
              <Button variant="default" onClick={() => previewMutation.mutate()} loading={previewMutation.isPending}>
                {t("Preview periodization") || "Preview periodization"}
              </Button>
              <Button variant="light" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
                {t("Save framework") || "Save framework"}
              </Button>
              <Divider orientation="vertical" />
              <Select
                value={replaceGenerated}
                onChange={(value) => setReplaceGenerated(value || "replace")}
                data={[
                  { value: "replace",  label: t("Replace prior generated workouts") || "Replace prior generated workouts" },
                  { value: "preserve", label: t("Keep prior generated workouts") || "Keep prior generated workouts" },
                ]}
                w={240}
              />
              <Tooltip label={t("Save the framework first") || "Save the framework first"} disabled={Boolean(plan.id)} withArrow>
                <Button
                  onClick={() => applyMutation.mutate()}
                  loading={applyMutation.isPending}
                  style={{ background: "#E95A12", border: "none" }}
                >
                  {t("Apply to calendar") || "Apply to calendar"}
                </Button>
              </Tooltip>
            </Group>
          </Stack>
        </Paper>

        {/* ── Preview ── */}
        {preview && <SeasonPlannerPreview preview={preview} isDark={isDark} t={t} />}
      </Stack>
    </ScrollArea>
  );

  if (inline) return content;

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="min(640px, 100vw)" title={t("Season Planner") || "Season Planner"} padding="md">
      {content}
    </Drawer>
  );
}

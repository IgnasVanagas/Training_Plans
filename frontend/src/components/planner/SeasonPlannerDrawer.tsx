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
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconBarbell, IconChartBar, IconCircle, IconFlag, IconInfoCircle, IconPlus, IconTarget, IconTrash, IconTrendingUp } from "@tabler/icons-react";
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
import { athleteLabel, defaultPlan, defaultPeriodization, emptyConstraint, emptyMetric, emptyRace, normalizePlan } from "./seasonPlanUtils";

const PHASE_COLORS: Record<string, string> = {
  base: "#3B82F6",
  build: "#F59E0B",
  peak: "#EF4444",
  taper: "#A855F7",
  race: "#EC4899",
  recovery: "#22C55E",
  transition: "#94A3B8",
};

const PERIODIZATION_MODEL_INFO: Record<string, { label: string; description: string }> = {
  polarized:  { label: "Polarized (80/20)", description: "~80% low intensity, ~20% high intensity. Gold standard supported by Seiler (2010), Stöggl & Sperlich (2015)." },
  pyramidal:  { label: "Pyramidal", description: "Decreasing volume from Z1→Z5. Effective in well-trained athletes (Esteve-Lanao et al., 2007)." },
  threshold:  { label: "Threshold / Sweetspot", description: "Higher proportion of tempo/threshold work. Time-efficient for time-crunched athletes." },
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
    onSuccess: (data) => {
      setPreview(data);
      setLocalError(null);
    },
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
      notifications.show({
        color: "green",
        title: t("Season framework saved") || "Season framework saved",
        message: t("Race priorities and cycle settings are stored.") || "Race priorities and cycle settings are stored.",
      });
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

  const summaryCards = useMemo(() => {
    if (!preview?.summary) return [] as Array<{ label: string; value: string }>;
    return [
      { label: t("Weeks") || "Weeks", value: String(preview.summary.total_weeks || 0) },
      { label: t("Races") || "Races", value: String(preview.summary.race_count || 0) },
      { label: t("Constraints") || "Constraints", value: String(preview.summary.constraint_count || 0) },
      { label: t("Generated workouts") || "Generated workouts", value: String(preview.summary.generated_workout_count || 0) },
    ];
  }, [preview?.summary, t]);

  const sportOptions = [
    { value: "Cycling", label: t("Cycling") || "Cycling" },
    { value: "Running", label: t("Running") || "Running" },
  ];

  const content = (
    <ScrollArea h={inline ? "calc(100dvh - 140px)" : "calc(100vh - 90px)"} offsetScrollbars>
      <Stack gap="md" pb="xl" px={inline ? "md" : undefined}>
          {localError && <Alert color="red">{localError}</Alert>}
          {planQuery.isLoading && <Alert color="blue">{t("Loading saved framework") || "Loading saved framework"}</Alert>}

          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start">
                <Box>
                  <Text fw={700}>{t("Goal and Race Framework") || "Goal and Race Framework"}</Text>
                  <Text size="sm" c="dimmed">{t("Set race priorities, target metrics, countdowns, and taper orchestration.") || "Set race priorities, target metrics, countdowns, and taper orchestration."}</Text>
                </Box>
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
                <TextInput label={t("Plan name") || "Plan name"} value={plan.name} onChange={(event) => setPlan((current) => ({ ...current, name: event.currentTarget.value }))} />
                <Select label={t("Sport") || "Sport"} data={sportOptions} value={plan.sport_type} onChange={(value) => value && setPlan((current) => ({ ...current, sport_type: value }))} />
              </SimpleGrid>

              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label={t("Season start") || "Season start"} type="date" value={plan.season_start} onChange={(event) => setPlan((current) => ({ ...current, season_start: event.currentTarget.value }))} />
                <TextInput label={t("Season end") || "Season end"} type="date" value={plan.season_end} onChange={(event) => setPlan((current) => ({ ...current, season_end: event.currentTarget.value }))} />
              </SimpleGrid>

              <Textarea label={t("Planner notes") || "Planner notes"} minRows={2} value={plan.notes || ""} onChange={(event) => setPlan((current) => ({ ...current, notes: event.currentTarget.value }))} />
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={700}>{t("Season target metrics") || "Season target metrics"}</Text>
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setPlan((current) => ({ ...current, target_metrics: [...current.target_metrics, emptyMetric()] }))}>
                  {t("Add metric") || "Add metric"}
                </Button>
              </Group>
              {plan.target_metrics.map((metric, index) => (
                <Group key={`season-metric-${index}`} align="flex-end" wrap="nowrap">
                  <TextInput flex={1} label={t("Metric") || "Metric"} value={metric.metric} onChange={(event) => setPlan((current) => ({ ...current, target_metrics: current.target_metrics.map((row, rowIndex) => rowIndex === index ? { ...row, metric: event.currentTarget.value } : row) }))} />
                  <TextInput flex={1} label={t("Target value") || "Target value"} value={String(metric.value ?? "")} onChange={(event) => setPlan((current) => ({ ...current, target_metrics: current.target_metrics.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.currentTarget.value } : row) }))} />
                  <TextInput w={110} label={t("Unit") || "Unit"} value={metric.unit || ""} onChange={(event) => setPlan((current) => ({ ...current, target_metrics: current.target_metrics.map((row, rowIndex) => rowIndex === index ? { ...row, unit: event.currentTarget.value } : row) }))} />
                  <ActionIcon color="red" variant="subtle" onClick={() => setPlan((current) => ({ ...current, target_metrics: current.target_metrics.filter((_, rowIndex) => rowIndex !== index) || [emptyMetric()] }))}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Box>
                  <Text fw={700}>{t("Goal races") || "Goal races"}</Text>
                  <Text size="sm" c="dimmed">{t("A races drive peak/taper logic, B races get mini peaks, C races stay supportive.") || "A races drive peak/taper logic, B races get mini peaks, C races stay supportive."}</Text>
                </Box>
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setPlan((current) => ({ ...current, goal_races: [...current.goal_races, emptyRace()] }))}>
                  {t("Add race") || "Add race"}
                </Button>
              </Group>

              {plan.goal_races.map((race, raceIndex) => (
                <Card key={`race-${raceIndex}`} withBorder radius="md">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text fw={600}>{race.name || `${t("Race") || "Race"} ${raceIndex + 1}`}</Text>
                      <ActionIcon color="red" variant="subtle" onClick={() => setPlan((current) => ({ ...current, goal_races: current.goal_races.filter((_, index) => index !== raceIndex) }))}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <Select label={t("Sport") || "Sport"} data={sportOptions} value={race.sport_type || ""} onChange={(value) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, sport_type: value || "" } : row) }))} placeholder={t("Select sport") || "Select sport"} />
                      <TextInput label={t("Race name") || "Race name"} value={race.name} onChange={(event) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, name: event.currentTarget.value } : row) }))} required />
                    </SimpleGrid>
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                      <TextInput label={t("Race date") || "Race date"} type="date" value={race.date} onChange={(event) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, date: event.currentTarget.value } : row) }))} required />
                      <NumberInput label={t("Distance") || "Distance"} value={race.distance_km ?? ""} onChange={(value) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, distance_km: typeof value === "number" ? value : null } : row) }))} min={0} step={0.1} suffix=" km" />
                      <TextInput label={t("Expected time") || "Expected time"} placeholder="hh:mm:ss" value={race.expected_time || ""} onChange={(event) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, expected_time: event.currentTarget.value } : row) }))} />
                    </SimpleGrid>
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                      <Select label={t("Priority") || "Priority"} data={["A", "B", "C"]} value={race.priority} onChange={(value) => value && setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, priority: value as "A" | "B" | "C" } : row) }))} />
                      <TextInput label={t("Location") || "Location"} value={race.location || ""} onChange={(event) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, location: event.currentTarget.value } : row) }))} />
                    </SimpleGrid>
                    <Textarea label={t("Details") || "Details"} minRows={2} value={race.notes || ""} onChange={(event) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, notes: event.currentTarget.value } : row) }))} />

                    <Divider label={t("Race target metrics") || "Race target metrics"} labelPosition="center" />
                    {race.target_metrics.map((metric, metricIndex) => (
                      <Group key={`race-${raceIndex}-metric-${metricIndex}`} align="flex-end" wrap="nowrap">
                        <TextInput flex={1} label={t("Metric") || "Metric"} value={metric.metric} onChange={(event) => setPlan((current) => ({
                          ...current,
                          goal_races: current.goal_races.map((row, index) => index === raceIndex ? {
                            ...row,
                            target_metrics: row.target_metrics.map((targetRow, targetIndex) => targetIndex === metricIndex ? { ...targetRow, metric: event.currentTarget.value } : targetRow),
                          } : row),
                        }))} />
                        <TextInput flex={1} label={t("Target value") || "Target value"} value={String(metric.value ?? "")} onChange={(event) => setPlan((current) => ({
                          ...current,
                          goal_races: current.goal_races.map((row, index) => index === raceIndex ? {
                            ...row,
                            target_metrics: row.target_metrics.map((targetRow, targetIndex) => targetIndex === metricIndex ? { ...targetRow, value: event.currentTarget.value } : targetRow),
                          } : row),
                        }))} />
                        <TextInput w={110} label={t("Unit") || "Unit"} value={metric.unit || ""} onChange={(event) => setPlan((current) => ({
                          ...current,
                          goal_races: current.goal_races.map((row, index) => index === raceIndex ? {
                            ...row,
                            target_metrics: row.target_metrics.map((targetRow, targetIndex) => targetIndex === metricIndex ? { ...targetRow, unit: event.currentTarget.value } : targetRow),
                          } : row),
                        }))} />
                        <ActionIcon color="red" variant="subtle" onClick={() => setPlan((current) => ({
                          ...current,
                          goal_races: current.goal_races.map((row, index) => index === raceIndex ? {
                            ...row,
                            target_metrics: row.target_metrics.filter((_, targetIndex) => targetIndex !== metricIndex),
                          } : row),
                        }))}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    ))}
                    <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setPlan((current) => ({
                      ...current,
                      goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, target_metrics: [...row.target_metrics, emptyMetric()] } : row),
                    }))}>
                      {t("Add race metric") || "Add race metric"}
                    </Button>
                  </Stack>
                </Card>
              ))}
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Box>
                  <Text fw={700}>{t("Availability and constraints") || "Availability and constraints"}</Text>
                  <Text size="sm" c="dimmed">{t("Travel, sickness, injury, and unavailable windows reduce load or force recovery weeks.") || "Travel, sickness, injury, and unavailable windows reduce load or force recovery weeks."}</Text>
                </Box>
                <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setPlan((current) => ({ ...current, constraints: [...current.constraints, emptyConstraint()] }))}>
                  {t("Add constraint") || "Add constraint"}
                </Button>
              </Group>

              {plan.constraints.length === 0 ? <Text size="sm" c="dimmed">{t("No constraints yet") || "No constraints yet"}</Text> : null}
              {plan.constraints.map((constraint, index) => (
                <Card key={`constraint-${index}`} withBorder radius="md">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text fw={600}>{constraint.name || `${t("Constraint") || "Constraint"} ${index + 1}`}</Text>
                      <ActionIcon color="red" variant="subtle" onClick={() => setPlan((current) => ({ ...current, constraints: current.constraints.filter((_, rowIndex) => rowIndex !== index) }))}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      <TextInput label={t("Label") || "Label"} value={constraint.name || ""} onChange={(event) => setPlan((current) => ({ ...current, constraints: current.constraints.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.currentTarget.value } : row) }))} />
                      <Select label={t("Type") || "Type"} data={[
                        { value: "injury", label: t("Injury") || "Injury" },
                        { value: "travel", label: t("Travel") || "Travel" },
                        { value: "sickness", label: t("Sickness") || "Sickness" },
                        { value: "unavailable", label: t("Unavailable") || "Unavailable" },
                      ]} value={constraint.kind} onChange={(value) => value && setPlan((current) => ({ ...current, constraints: current.constraints.map((row, rowIndex) => rowIndex === index ? { ...row, kind: value as PlannerConstraint["kind"] } : row) }))} />
                    </SimpleGrid>
                    <SimpleGrid cols={{ base: 1, sm: 4 }}>
                      <TextInput label={t("Start") || "Start"} type="date" value={constraint.start_date} onChange={(event) => setPlan((current) => ({ ...current, constraints: current.constraints.map((row, rowIndex) => rowIndex === index ? { ...row, start_date: event.currentTarget.value } : row) }))} />
                      <TextInput label={t("End") || "End"} type="date" value={constraint.end_date} onChange={(event) => setPlan((current) => ({ ...current, constraints: current.constraints.map((row, rowIndex) => rowIndex === index ? { ...row, end_date: event.currentTarget.value } : row) }))} />
                      <Select label={t("Severity") || "Severity"} data={[
                        { value: "low", label: t("Low") || "Low" },
                        { value: "moderate", label: t("Moderate") || "Moderate" },
                        { value: "high", label: t("High") || "High" },
                      ]} value={constraint.severity} onChange={(value) => value && setPlan((current) => ({ ...current, constraints: current.constraints.map((row, rowIndex) => rowIndex === index ? { ...row, severity: value as PlannerConstraint["severity"] } : row) }))} />
                      <Select label={t("Impact") || "Impact"} data={[
                        { value: "reduce", label: t("Reduce load") || "Reduce load" },
                        { value: "avoid_intensity", label: t("Avoid intensity") || "Avoid intensity" },
                        { value: "rest", label: t("Rest only") || "Rest only" },
                      ]} value={constraint.impact} onChange={(value) => value && setPlan((current) => ({ ...current, constraints: current.constraints.map((row, rowIndex) => rowIndex === index ? { ...row, impact: value as PlannerConstraint["impact"] } : row) }))} />
                    </SimpleGrid>
                    <Textarea label={t("Constraint notes") || "Constraint notes"} minRows={2} value={constraint.notes || ""} onChange={(event) => setPlan((current) => ({ ...current, constraints: current.constraints.map((row, rowIndex) => rowIndex === index ? { ...row, notes: event.currentTarget.value } : row) }))} />
                  </Stack>
                </Card>
              ))}
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Text fw={700}>{t("Periodization settings") || "Periodization settings"}</Text>

              <Paper withBorder radius="md" p="sm" bg={isDark ? "dark.6" : "indigo.0"} style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-indigo-2)" }}>
                <Stack gap="xs">
                  <Select
                    label={t("Periodization model") || "Periodization model"}
                    data={Object.entries(PERIODIZATION_MODEL_INFO).map(([value, info]) => ({ value, label: info.label }))}
                    value={plan.periodization.periodization_model}
                    onChange={(value) => value && setPlan((current) => ({ ...current, periodization: { ...current.periodization, periodization_model: value as PeriodizationConfig["periodization_model"] } }))}
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
                <NumberInput label={t("Weekly hours target") || "Weekly hours target"} value={plan.periodization.weekly_hours_target} min={1} max={40} step={0.5} onChange={(value) => setPlan((current) => ({ ...current, periodization: { ...current.periodization, weekly_hours_target: Number(value) || 1 } }))} />
                <NumberInput label={t("Longest session minutes") || "Longest session minutes"} value={plan.periodization.longest_session_minutes} min={30} max={600} step={10} onChange={(value) => setPlan((current) => ({ ...current, periodization: { ...current.periodization, longest_session_minutes: Number(value) || 30 } }))} />
                <NumberInput label={t("Training days per week") || "Training days per week"} value={plan.periodization.training_days_per_week} min={2} max={7} step={1} onChange={(value) => setPlan((current) => ({ ...current, periodization: { ...current.periodization, training_days_per_week: Number(value) || 2 } }))} />
                <NumberInput label={t("Recovery week frequency") || "Recovery week frequency"} value={plan.periodization.recovery_week_frequency} min={2} max={6} step={1} onChange={(value) => setPlan((current) => ({ ...current, periodization: { ...current.periodization, recovery_week_frequency: Number(value) || 2 } }))} />
              </SimpleGrid>
              <Select label={t("Taper profile") || "Taper profile"} data={[
                { value: "short", label: t("Short") || "Short" },
                { value: "standard", label: t("Standard") || "Standard" },
                { value: "extended", label: t("Extended") || "Extended" },
              ]} value={plan.periodization.taper_profile} onChange={(value) => value && setPlan((current) => ({ ...current, periodization: { ...current.periodization, taper_profile: value as PeriodizationConfig["taper_profile"] } }))} />
            </Stack>
          </Paper>

          <Paper withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={700}>{t("Generate and apply") || "Generate and apply"}</Text>
                <Select value={replaceGenerated} onChange={(value) => setReplaceGenerated(value || "replace")} data={[
                  { value: "replace", label: t("Replace prior generated workouts") || "Replace prior generated workouts" },
                  { value: "preserve", label: t("Keep prior generated workouts") || "Keep prior generated workouts" },
                ]} w={260} />
              </Group>
              <Group>
                <Button variant="default" onClick={() => previewMutation.mutate()} loading={previewMutation.isPending}>{t("Preview periodization") || "Preview periodization"}</Button>
                <Button variant="light" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>{t("Save framework") || "Save framework"}</Button>
                <Button onClick={() => applyMutation.mutate()} loading={applyMutation.isPending}>{t("Apply to calendar") || "Apply to calendar"}</Button>
              </Group>
            </Stack>
          </Paper>

          {preview && (
            <Stack gap="md">
              {/* ── Summary stat cards ── */}
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                {summaryCards.map((card) => (
                  <Paper key={card.label} withBorder radius="md" p="sm" shadow="xs">
                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>{card.label}</Text>
                    <Text fw={800} size="xl">{card.value}</Text>
                  </Paper>
                ))}
              </SimpleGrid>

              {/* ── Periodization model badge ── */}
              {preview.summary?.periodization_model_label && (
                <Paper withBorder radius="md" p="sm" bg={isDark ? "dark.6" : "indigo.0"} style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-indigo-2)" }}>
                  <Group gap="xs">
                    <ThemeIcon size="sm" variant="light" color="indigo" radius="xl"><IconBarbell size={12} /></ThemeIcon>
                    <Text size="sm" fw={600}>{preview.summary.periodization_model_label}</Text>
                    <Text size="xs" c="dimmed" style={{ flex: 1 }}>{preview.summary.periodization_model_description}</Text>
                  </Group>
                </Paper>
              )}

              {/* ── Visual phase timeline ── */}
              <Paper withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Group gap="xs">
                    <ThemeIcon size="sm" variant="light" color="blue" radius="xl"><IconTrendingUp size={12} /></ThemeIcon>
                    <Text fw={700} size="sm">{t("Phase timeline") || "Phase timeline"}</Text>
                  </Group>
                  <Box style={{ display: "flex", borderRadius: 6, overflow: "hidden", height: 32 }}>
                    {preview.micro_cycles.map((week: Record<string, any>, idx: number) => {
                      const phase = String(week.phase || "transition");
                      const color = PHASE_COLORS[phase] || PHASE_COLORS.transition;
                      const totalWeeks = preview.micro_cycles.length;
                      const widthPct = 100 / totalWeeks;
                      return (
                        <Tooltip key={idx} label={`W${week.week_index} · ${phase} · ${week.target_hours}h`} withArrow>
                          <Box
                            style={{
                              width: `${widthPct}%`,
                              minWidth: 4,
                              background: color,
                              transition: "opacity 150ms",
                              cursor: "pointer",
                              borderRight: idx < totalWeeks - 1 ? `1px solid ${isDark ? "var(--mantine-color-dark-7)" : "#fff"}` : undefined,
                            }}
                          />
                        </Tooltip>
                      );
                    })}
                  </Box>
                  <Group gap="md" wrap="wrap">
                    {Object.entries(PHASE_COLORS).filter(([phase]) => preview.micro_cycles.some((w: Record<string, any>) => w.phase === phase)).map(([phase, color]) => (
                      <Group key={phase} gap={4}>
                        <Box style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                        <Text size="xs" tt="capitalize">{phase}</Text>
                      </Group>
                    ))}
                  </Group>
                </Stack>
              </Paper>

              {/* ── Weekly load progression chart ── */}
              {(preview.load_progression || []).length > 0 && (
                <Paper withBorder radius="md" p="md">
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <ThemeIcon size="sm" variant="light" color="orange" radius="xl"><IconChartBar size={12} /></ThemeIcon>
                        <Text fw={700} size="sm">{t("Weekly training load") || "Weekly training load"}</Text>
                      </Group>
                      <Tooltip label={t("Acute:Chronic Workload Ratio — optimal range 0.8-1.3 (Hulin et al., 2014)") || "ACWR — optimal range 0.8-1.3"} withArrow>
                        <Badge variant="light" size="sm" leftSection={<IconInfoCircle size={10} />}>ACWR</Badge>
                      </Tooltip>
                    </Group>
                    {(() => {
                      const loads = (preview.load_progression || []) as Array<Record<string, any>>;
                      const maxLoad = Math.max(...loads.map((w) => Number(w.training_load || 0)), 1);
                      return (
                        <Box style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120, padding: "0 4px" }}>
                          {loads.map((week, idx) => {
                            const load = Number(week.training_load || 0);
                            const heightPct = (load / maxLoad) * 100;
                            const phase = String(week.phase || "transition");
                            const color = PHASE_COLORS[phase] || PHASE_COLORS.transition;
                            const acwr = Number(week.acwr || 1);
                            const acwrColor = week.acwr_zone === "danger" ? "red" : week.acwr_zone === "optimal" ? "green" : "yellow";
                            return (
                              <Tooltip key={idx} label={`W${week.week_index} · ${phase} · ${week.target_hours}h · Load: ${load} · ACWR: ${acwr}`} withArrow>
                                <Box style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                  <Box
                                    style={{
                                      width: "100%",
                                      maxWidth: 24,
                                      height: `${Math.max(heightPct, 4)}%`,
                                      background: color,
                                      borderRadius: "3px 3px 0 0",
                                      position: "relative",
                                    }}
                                  />
                                  <Box style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--mantine-color-${acwrColor}-5)` }} />
                                </Box>
                              </Tooltip>
                            );
                          })}
                        </Box>
                      );
                    })()}
                    <Group justify="space-between">
                      <Text size="10px" c="dimmed">{t("Week") || "Week"} 1</Text>
                      <Group gap={8}>
                        <Group gap={3}><Box style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mantine-color-green-5)" }} /><Text size="10px" c="dimmed">ACWR 0.8-1.3</Text></Group>
                        <Group gap={3}><Box style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mantine-color-yellow-5)" }} /><Text size="10px" c="dimmed">&lt;0.8</Text></Group>
                        <Group gap={3}><Box style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mantine-color-red-5)" }} /><Text size="10px" c="dimmed">&gt;1.5</Text></Group>
                      </Group>
                      <Text size="10px" c="dimmed">{t("Week") || "Week"} {(preview.load_progression || []).length}</Text>
                    </Group>
                  </Stack>
                </Paper>
              )}

              {/* ── Tabbed detail view ── */}
              <Tabs defaultValue="races" variant="outline" radius="md">
                <Tabs.List>
                  <Tabs.Tab value="races" leftSection={<IconFlag size={14} />}>{t("Races") || "Races"}</Tabs.Tab>
                  <Tabs.Tab value="phases" leftSection={<IconCircle size={14} />}>{t("Phases") || "Phases"}</Tabs.Tab>
                  <Tabs.Tab value="weeks" leftSection={<IconTarget size={14} />}>{t("Weeks") || "Weeks"}</Tabs.Tab>
                  <Tabs.Tab value="workouts" leftSection={<IconBarbell size={14} />}>{t("Workouts") || "Workouts"}</Tabs.Tab>
                </Tabs.List>

                {/* ── Races tab ── */}
                <Tabs.Panel value="races" pt="sm">
                  <Stack gap="sm">
                    {preview.countdowns.length === 0 && <Text size="sm" c="dimmed">{t("No races configured") || "No races configured"}</Text>}
                    {preview.countdowns.map((countdown: Record<string, any>, index: number) => (
                      <Paper key={`cd-${index}`} withBorder radius="md" p="sm">
                        <Group justify="space-between" wrap="nowrap">
                          <Stack gap={2}>
                            <Group gap="xs">
                              <Badge size="sm" variant="filled" color={countdown.priority === "A" ? "red" : countdown.priority === "B" ? "orange" : "gray"}>{countdown.priority}</Badge>
                              <Text fw={600} size="sm">{countdown.name}</Text>
                            </Group>
                            <Text size="xs" c="dimmed">{countdown.date} · {t("Taper starts") || "Taper starts"}: {countdown.taper_starts_on}</Text>
                          </Stack>
                          <Stack gap={0} align="flex-end">
                            <Text fw={800} size="lg" c={Number(countdown.days_until) <= 14 ? "red" : undefined}>{countdown.days_until}</Text>
                            <Text size="10px" c="dimmed">{t("days") || "days"}</Text>
                          </Stack>
                        </Group>
                      </Paper>
                    ))}

                    {preview.season_blocks.length > 0 && (
                      <>
                        <Text fw={700} size="sm" mt="xs">{t("Season blocks") || "Season blocks"}</Text>
                        {preview.season_blocks.map((block: Record<string, any>, index: number) => (
                          <Group key={`blk-${index}`} justify="space-between" align="flex-start" py={4}>
                            <Stack gap={0}>
                              <Text fw={600} size="sm">{block.label}</Text>
                              <Text size="xs" c="dimmed">{block.start_date} → {block.end_date}</Text>
                            </Stack>
                            <Text size="xs" c="dimmed" maw="50%">{block.focus}</Text>
                          </Group>
                        ))}
                      </>
                    )}
                  </Stack>
                </Tabs.Panel>

                {/* ── Phases / Macro+Meso tab ── */}
                <Tabs.Panel value="phases" pt="sm">
                  <Stack gap="md">
                    <Text fw={700} size="sm">{t("Macro cycles") || "Macro cycles"}</Text>
                    {preview.macro_cycles.map((macro: Record<string, any>, idx: number) => {
                      const phase = String(macro.dominant_phase || "base");
                      const color = PHASE_COLORS[phase] || PHASE_COLORS.transition;
                      return (
                        <Paper key={`macro-${idx}`} withBorder radius="md" p="sm" style={{ borderLeft: `4px solid ${color}` }}>
                          <Group justify="space-between" align="flex-start" wrap="nowrap">
                            <Stack gap={2}>
                              <Group gap="xs">
                                <Badge size="xs" variant="light" style={{ background: `${color}22`, color }}>{phase}</Badge>
                                <Text fw={600} size="sm">{macro.label}</Text>
                              </Group>
                              <Text size="xs" c="dimmed">{macro.start_date} → {macro.end_date} · {macro.weeks} {t("weeks") || "weeks"}</Text>
                              <Text size="xs">{macro.focus}</Text>
                            </Stack>
                          </Group>
                        </Paper>
                      );
                    })}

                    <Text fw={700} size="sm">{t("Meso cycles") || "Meso cycles"}</Text>
                    {preview.meso_cycles.map((meso: Record<string, any>, idx: number) => (
                      <Paper key={`meso-${idx}`} withBorder radius="md" p="sm">
                        <Group justify="space-between" wrap="nowrap">
                          <Stack gap={2}>
                            <Text fw={600} size="sm">{meso.label}</Text>
                            <Text size="xs" c="dimmed">{meso.start_date} → {meso.end_date} · {meso.weeks} {t("weeks") || "weeks"}</Text>
                            <Text size="xs">{meso.focus}</Text>
                          </Stack>
                          <Stack gap={0} align="flex-end">
                            <Text size="sm" fw={700}>{meso.average_target_hours}h</Text>
                            <Text size="10px" c="dimmed">{t("avg/week") || "avg/week"}</Text>
                          </Stack>
                        </Group>
                        {(meso.phases || []).length > 0 && (
                          <Group gap={4} mt={4}>
                            {(meso.phases as string[]).map((ph: string, i: number) => (
                              <Box key={i} style={{ width: 8, height: 8, borderRadius: 2, background: PHASE_COLORS[ph] || PHASE_COLORS.transition }} />
                            ))}
                          </Group>
                        )}
                      </Paper>
                    ))}
                  </Stack>
                </Tabs.Panel>

                {/* ── Weeks / Micro cycles tab ── */}
                <Tabs.Panel value="weeks" pt="sm">
                  <Stack gap="xs">
                    {preview.micro_cycles.map((week: Record<string, any>, idx: number) => {
                      const phase = String(week.phase || "transition");
                      const color = PHASE_COLORS[phase] || PHASE_COLORS.transition;
                      const dist = (week.intensity_distribution || {}) as Record<string, number>;
                      return (
                        <Paper key={`wk-${idx}`} withBorder radius="md" p="sm" style={{ borderLeft: `4px solid ${color}` }}>
                          <Group justify="space-between" align="flex-start" wrap="nowrap">
                            <Stack gap={2} style={{ flex: 1 }}>
                              <Group gap="xs">
                                <Badge size="xs" variant="light" style={{ background: `${color}22`, color }}>{phase}</Badge>
                                <Text fw={600} size="sm">{t("Week") || "Week"} {week.week_index}</Text>
                                <Badge size="xs" variant="light">{week.target_hours}h</Badge>
                                {week.countdown_days != null && (
                                  <Text size="10px" c="dimmed">{week.countdown_days}d to race</Text>
                                )}
                              </Group>
                              <Text size="xs" c="dimmed">{week.week_start} → {week.week_end}</Text>
                              {week.phase_goal && <Text size="xs" fw={500}>{week.phase_goal}</Text>}
                              {week.phase_rationale && <Text size="10px" c="dimmed" fs="italic">{week.phase_rationale}</Text>}
                              {!!week.constraints?.length && (
                                <Group gap={4} mt={2}>
                                  <IconAlertTriangle size={12} color="var(--mantine-color-orange-5)" />
                                  <Text size="xs" c="orange">{(week.constraints as string[]).join(", ")}</Text>
                                </Group>
                              )}
                            </Stack>
                            {Object.keys(dist).length > 0 && (
                              <Stack gap={2} miw={100} align="flex-end">
                                <Text size="10px" c="dimmed" fw={600}>{t("Zones") || "Zones"}</Text>
                                {Object.entries(dist).map(([zone, pct]) => (
                                  <Group key={zone} gap={4} wrap="nowrap">
                                    <Text size="10px" w={22} ta="right" c="dimmed">{zone}</Text>
                                    <Progress value={Number(pct) * 100} size={6} style={{ flex: 1, minWidth: 40 }} color={zone === "Z1" ? "cyan" : zone === "Z2" ? "blue" : zone === "Z3" ? "yellow" : zone === "Z4" ? "orange" : "red"} />
                                    <Text size="10px" w={28} ta="right">{Math.round(Number(pct) * 100)}%</Text>
                                  </Group>
                                ))}
                              </Stack>
                            )}
                          </Group>
                        </Paper>
                      );
                    })}
                  </Stack>
                </Tabs.Panel>

                {/* ── Workouts tab ── */}
                <Tabs.Panel value="workouts" pt="sm">
                  <Paper withBorder radius="md" p="sm">
                    <ScrollArea>
                      <Table striped highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>{t("Date") || "Date"}</Table.Th>
                            <Table.Th>{t("Session") || "Session"}</Table.Th>
                            <Table.Th>{t("Phase") || "Phase"}</Table.Th>
                            <Table.Th>{t("Intensity") || "Intensity"}</Table.Th>
                            <Table.Th>{t("Duration") || "Duration"}</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {preview.generated_workouts.slice(0, 30).map((row: Record<string, any>, index: number) => {
                            const phase = String(row.planning_context?.phase || "-");
                            return (
                              <Table.Tr key={`workout-${index}`}>
                                <Table.Td><Text size="xs">{row.date}</Text></Table.Td>
                                <Table.Td><Text size="xs" fw={500}>{row.title}</Text></Table.Td>
                                <Table.Td>
                                  <Badge size="xs" variant="light" style={{ background: `${PHASE_COLORS[phase] || "#94A3B8"}22`, color: PHASE_COLORS[phase] || "#94A3B8" }}>
                                    {phase}
                                  </Badge>
                                </Table.Td>
                                <Table.Td><Text size="xs">{row.planned_intensity || "-"}</Text></Table.Td>
                                <Table.Td><Text size="xs">{row.planned_duration} min</Text></Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    {preview.generated_workouts.length > 30 && (
                      <Text size="xs" c="dimmed" ta="center" mt="xs">
                        {t("Showing first 30 of") || "Showing first 30 of"} {preview.generated_workouts.length} {t("workouts") || "workouts"}
                      </Text>
                    )}
                  </Paper>
                </Tabs.Panel>
              </Tabs>
            </Stack>
          )}
        </Stack>
      </ScrollArea>
  );

  if (inline) return content;

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="min(620px, 100vw)" title={t("Season Planner") || "Season Planner"} padding="md">
      {content}
    </Drawer>
  );
}

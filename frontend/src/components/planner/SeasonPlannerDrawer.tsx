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
  Table,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus, IconTrash } from "@tabler/icons-react";
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

type Props = {
  opened: boolean;
  onClose: () => void;
  me: User;
  athletes: User[];
  selectedAthleteId?: number | null;
};

export default function SeasonPlannerDrawer({ opened, onClose, me, athletes, selectedAthleteId }: Props) {
  const queryClient = useQueryClient();
  const { t } = useI18n();

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

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="min(620px, 100vw)" title={t("Season Planner") || "Season Planner"} padding="md">
      <ScrollArea h="calc(100vh - 90px)" offsetScrollbars>
        <Stack gap="md" pb="xl">
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
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                      <TextInput label={t("Race name") || "Race name"} value={race.name} onChange={(event) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, name: event.currentTarget.value } : row) }))} />
                      <TextInput label={t("Race date") || "Race date"} type="date" value={race.date} onChange={(event) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, date: event.currentTarget.value } : row) }))} />
                      <Select label={t("Priority") || "Priority"} data={["A", "B", "C"]} value={race.priority} onChange={(value) => value && setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, priority: value as "A" | "B" | "C" } : row) }))} />
                    </SimpleGrid>
                    <Textarea label={t("Race notes") || "Race notes"} minRows={2} value={race.notes || ""} onChange={(event) => setPlan((current) => ({ ...current, goal_races: current.goal_races.map((row, index) => index === raceIndex ? { ...row, notes: event.currentTarget.value } : row) }))} />

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
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                {summaryCards.map((card) => (
                  <Card key={card.label} withBorder radius="md">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{card.label}</Text>
                    <Text fw={800} size="xl">{card.value}</Text>
                  </Card>
                ))}
              </SimpleGrid>

              <Paper withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Text fw={700}>{t("Race countdowns") || "Race countdowns"}</Text>
                  {preview.countdowns.length === 0 ? <Text size="sm" c="dimmed">{t("No races configured") || "No races configured"}</Text> : null}
                  {preview.countdowns.map((countdown, index) => (
                    <Group key={`countdown-${index}`} justify="space-between" wrap="nowrap">
                      <Box>
                        <Text fw={600}>{countdown.name}</Text>
                        <Text size="sm" c="dimmed">{countdown.date} · {t("Taper starts") || "Taper starts"}: {countdown.taper_starts_on}</Text>
                      </Box>
                      <Badge size="lg" variant="light">{countdown.priority} · {countdown.days_until}d</Badge>
                    </Group>
                  ))}
                </Stack>
              </Paper>

              <Paper withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Text fw={700}>{t("Season blocks") || "Season blocks"}</Text>
                  {preview.season_blocks.map((block, index) => (
                    <Group key={`block-${index}`} justify="space-between" align="flex-start">
                      <Box>
                        <Text fw={600}>{block.label}</Text>
                        <Text size="sm" c="dimmed">{block.start_date} - {block.end_date}</Text>
                      </Box>
                      <Text size="sm" c="dimmed">{block.focus}</Text>
                    </Group>
                  ))}
                </Stack>
              </Paper>

              <SimpleGrid cols={{ base: 1, lg: 2 }}>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="xs">
                    <Text fw={700}>{t("Meso cycles") || "Meso cycles"}</Text>
                    {preview.meso_cycles.map((row, index) => (
                      <Box key={`meso-${index}`}>
                        <Text fw={600}>{row.label}</Text>
                        <Text size="sm" c="dimmed">{row.start_date} - {row.end_date} · {row.weeks} {t("weeks") || "weeks"}</Text>
                        <Text size="sm">{row.focus}</Text>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
                <Paper withBorder radius="md" p="md">
                  <Stack gap="xs">
                    <Text fw={700}>{t("Micro cycles") || "Micro cycles"}</Text>
                    {preview.micro_cycles.slice(0, 10).map((row, index) => (
                      <Box key={`micro-${index}`}>
                        <Group justify="space-between">
                          <Text fw={600}>{t("Week") || "Week"} {row.week_index} · {row.phase}</Text>
                          <Badge variant="light">{row.target_hours}h</Badge>
                        </Group>
                        <Text size="sm" c="dimmed">{row.week_start} - {row.week_end}</Text>
                        <Text size="sm">{row.focus}</Text>
                        {!!row.constraints?.length && <Text size="xs" c="orange">{row.constraints.join(", ")}</Text>}
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              </SimpleGrid>

              <Paper withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Text fw={700}>{t("Generated workouts sample") || "Generated workouts sample"}</Text>
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
                      {preview.generated_workouts.slice(0, 16).map((row, index) => (
                        <Table.Tr key={`workout-${index}`}>
                          <Table.Td>{row.date}</Table.Td>
                          <Table.Td>{row.title}</Table.Td>
                          <Table.Td>{row.planning_context?.phase || "-"}</Table.Td>
                          <Table.Td>{row.planned_intensity || "-"}</Table.Td>
                          <Table.Td>{row.planned_duration} min</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Stack>
              </Paper>
            </Stack>
          )}
        </Stack>
      </ScrollArea>
    </Drawer>
  );
}

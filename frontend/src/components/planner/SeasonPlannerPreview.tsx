import {
  Badge,
  Box,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBarbell,
  IconCalendar,
  IconChartBar,
  IconCircle,
  IconFlag,
  IconInfoCircle,
  IconTarget,
  IconTrendingUp,
} from "@tabler/icons-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeasonPlanPreview } from "../../api/planning";

const PHASE_COLORS: Record<string, string> = {
  base: "#3B82F6",
  build: "#F59E0B",
  peak: "#EF4444",
  taper: "#A855F7",
  race: "#EC4899",
  recovery: "#22C55E",
  transition: "#94A3B8",
};

const PRIORITY_BORDER: Record<string, string> = {
  A: "#EF4444",
  B: "#F59E0B",
  C: "#6366F1",
};

type Props = {
  preview: SeasonPlanPreview;
  isDark: boolean;
  t: (s: string) => string;
};

export default function SeasonPlannerPreview({ preview, isDark, t }: Props) {
  const ui = {
    cardBg:  isDark ? "rgba(22, 34, 58, 0.62)" : "rgba(255,255,255,0.92)",
    border:  isDark ? "rgba(148,163,184,0.28)" : "rgba(15,23,42,0.14)",
    textDim: isDark ? "#9FB0C8" : "#52617A",
    axisColor: isDark ? "#64748B" : "#94A3B8",
    gridColor: isDark ? "rgba(148,163,184,0.12)" : "rgba(15,23,42,0.08)",
  };

  const summaryCards = [
    { label: t("Weeks") || "Weeks", value: String(preview.summary?.total_weeks || 0), icon: <IconCalendar size={14} />, color: "blue" },
    { label: t("Races") || "Races", value: String(preview.summary?.race_count || 0), icon: <IconFlag size={14} />, color: "orange" },
    { label: t("Constraints") || "Constraints", value: String(preview.summary?.constraint_count || 0), icon: <IconAlertTriangle size={14} />, color: "yellow" },
    { label: t("Generated workouts") || "Generated workouts", value: String(preview.summary?.generated_workout_count || 0), icon: <IconBarbell size={14} />, color: "cyan" },
  ];

  const loadData = (preview.load_progression || []) as Array<Record<string, any>>;

  return (
    <Stack gap="md">
      {/* Summary stat cards */}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {summaryCards.map((card) => (
          <Paper key={card.label} withBorder radius="md" p="sm" shadow="xs" bg={ui.cardBg} style={{ borderColor: ui.border }}>
            <Group gap="xs" mb={4}>
              <ThemeIcon size="xs" variant="light" color={card.color} radius="xl">
                {card.icon}
              </ThemeIcon>
              <Text size="10px" c="dimmed" tt="uppercase" fw={700}>{card.label}</Text>
            </Group>
            <Text fw={800} size="xl">{card.value}</Text>
          </Paper>
        ))}
      </SimpleGrid>

      {/* Periodization model badge */}
      {preview.summary?.periodization_model_label && (
        <Paper withBorder radius="md" p="sm" bg={isDark ? "dark.6" : "indigo.0"} style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-indigo-2)" }}>
          <Group gap="xs">
            <ThemeIcon size="sm" variant="light" color="indigo" radius="xl"><IconBarbell size={12} /></ThemeIcon>
            <Text size="sm" fw={600}>{preview.summary.periodization_model_label}</Text>
            <Text size="xs" c="dimmed" style={{ flex: 1 }}>{preview.summary.periodization_model_description}</Text>
          </Group>
        </Paper>
      )}

      {/* Phase timeline */}
      <Paper withBorder radius="md" p="md" bg={ui.cardBg} style={{ borderColor: ui.border }}>
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
                <Tooltip
                  key={idx}
                  label={`W${week.week_index} · ${phase} · ${week.target_hours}h · ${week.week_start}`}
                  withArrow
                >
                  <Box
                    style={{
                      width: `${widthPct}%`,
                      minWidth: 4,
                      background: color,
                      transition: "opacity 150ms",
                      cursor: "pointer",
                      borderRight: idx < totalWeeks - 1 ? `1px solid ${isDark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.5)"}` : undefined,
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
          <Group gap="md" wrap="wrap">
            {Object.entries(PHASE_COLORS)
              .filter(([phase]) => preview.micro_cycles.some((w: Record<string, any>) => w.phase === phase))
              .map(([phase, color]) => (
                <Group key={phase} gap={4}>
                  <Box style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                  <Text size="xs" tt="capitalize">{phase}</Text>
                </Group>
              ))}
          </Group>
        </Stack>
      </Paper>

      {/* Weekly load progression — recharts */}
      {loadData.length > 0 && (
        <Paper withBorder radius="md" p="md" bg={ui.cardBg} style={{ borderColor: ui.border }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="orange" radius="xl"><IconChartBar size={12} /></ThemeIcon>
                <Text fw={700} size="sm">{t("Weekly training load") || "Weekly training load"}</Text>
              </Group>
              <Tooltip
                label={t("Acute:Chronic Workload Ratio — optimal range 0.8-1.3 (Hulin et al., 2014)") || "ACWR — optimal range 0.8-1.3"}
                withArrow
                multiline
                maw={260}
              >
                <Badge variant="light" size="sm" leftSection={<IconInfoCircle size={10} />}>ACWR</Badge>
              </Tooltip>
            </Group>

            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={loadData} margin={{ top: 4, right: 32, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={ui.gridColor} vertical={false} />
                <XAxis
                  dataKey="week_index"
                  tick={{ fontSize: 10, fill: ui.axisColor }}
                  tickLine={false}
                  axisLine={false}
                  label={{ value: t("Week") || "Week", position: "insideBottom", offset: -2, fontSize: 10, fill: ui.axisColor }}
                />
                <YAxis
                  yAxisId="load"
                  tick={{ fontSize: 10, fill: ui.axisColor }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <YAxis
                  yAxisId="acwr"
                  orientation="right"
                  domain={[0, 2.5]}
                  tick={{ fontSize: 10, fill: ui.axisColor }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <RechartsTooltip
                  contentStyle={{
                    background: isDark ? "#1e2a3e" : "#fff",
                    border: `1px solid ${ui.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: any, name: string) => {
                    if (name === "acwr") return [Number(value).toFixed(2), "ACWR"];
                    return [value, t("Load") || "Load"];
                  }}
                  labelFormatter={(label) => `${t("Week") || "Week"} ${label}`}
                />
                <ReferenceLine yAxisId="acwr" y={0.8} stroke="#22C55E" strokeDasharray="4 3" strokeOpacity={0.7} />
                <ReferenceLine yAxisId="acwr" y={1.3} stroke="#F59E0B" strokeDasharray="4 3" strokeOpacity={0.7} />
                <ReferenceLine yAxisId="acwr" y={1.5} stroke="#EF4444" strokeDasharray="4 3" strokeOpacity={0.6} />
                <Bar yAxisId="load" dataKey="training_load" radius={[3, 3, 0, 0]} maxBarSize={24}>
                  {loadData.map((entry, idx) => (
                    <Cell key={idx} fill={PHASE_COLORS[entry.phase] || PHASE_COLORS.transition} />
                  ))}
                </Bar>
                <Line
                  yAxisId="acwr"
                  dataKey="acwr"
                  type="monotone"
                  dot={false}
                  strokeWidth={2}
                  stroke="#94A3B8"
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>

            <Group gap={12} justify="flex-end">
              <Group gap={4}><Box style={{ width: 8, height: 2, background: "#22C55E" }} /><Text size="10px" c="dimmed">ACWR 0.8</Text></Group>
              <Group gap={4}><Box style={{ width: 8, height: 2, background: "#F59E0B" }} /><Text size="10px" c="dimmed">ACWR 1.3</Text></Group>
              <Group gap={4}><Box style={{ width: 8, height: 2, background: "#EF4444" }} /><Text size="10px" c="dimmed">ACWR 1.5</Text></Group>
            </Group>
          </Stack>
        </Paper>
      )}

      {/* Tabbed detail view */}
      <Tabs defaultValue="races" variant="outline" radius="md">
        <Tabs.List>
          <Tabs.Tab value="races" leftSection={<IconFlag size={14} />}>{t("Races") || "Races"}</Tabs.Tab>
          <Tabs.Tab value="phases" leftSection={<IconCircle size={14} />}>{t("Phases") || "Phases"}</Tabs.Tab>
          <Tabs.Tab value="weeks" leftSection={<IconTarget size={14} />}>{t("Weeks") || "Weeks"}</Tabs.Tab>
          <Tabs.Tab value="workouts" leftSection={<IconBarbell size={14} />}>{t("Workouts") || "Workouts"}</Tabs.Tab>
        </Tabs.List>

        {/* Races tab */}
        <Tabs.Panel value="races" pt="sm">
          <Stack gap="sm">
            {preview.countdowns.length === 0 && (
              <Text size="sm" c="dimmed">{t("No races configured") || "No races configured"}</Text>
            )}
            {preview.countdowns.map((countdown: Record<string, any>, index: number) => {
              const priorityColor = PRIORITY_BORDER[countdown.priority] || PRIORITY_BORDER.C;
              return (
                <Paper
                  key={`cd-${index}`}
                  withBorder
                  radius="md"
                  p="sm"
                  bg={ui.cardBg}
                  style={{ borderColor: ui.border, borderLeft: `4px solid ${priorityColor}` }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Group gap="xs">
                        <ThemeIcon size="xs" variant="light" radius="xl" style={{ background: `${priorityColor}22`, color: priorityColor }}>
                          <IconFlag size={10} />
                        </ThemeIcon>
                        <Badge size="sm" variant="filled" color={countdown.priority === "A" ? "red" : countdown.priority === "B" ? "orange" : "indigo"}>
                          {countdown.priority}
                        </Badge>
                        <Text fw={600} size="sm">{countdown.name}</Text>
                      </Group>
                      <Text size="xs" c="dimmed">{countdown.date} · {t("Taper starts") || "Taper starts"}: {countdown.taper_starts_on}</Text>
                    </Stack>
                    <Stack gap={0} align="flex-end">
                      <Text fw={800} size="lg" c={Number(countdown.days_until) <= 14 ? "red" : undefined}>
                        {countdown.days_until}
                      </Text>
                      <Text size="10px" c="dimmed">{t("days") || "days"}</Text>
                    </Stack>
                  </Group>
                </Paper>
              );
            })}

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

        {/* Phases / Macro+Meso tab */}
        <Tabs.Panel value="phases" pt="sm">
          <Stack gap="md">
            <Text fw={700} size="sm">{t("Macro cycles") || "Macro cycles"}</Text>
            {preview.macro_cycles.map((macro: Record<string, any>, idx: number) => {
              const phase = String(macro.dominant_phase || "base");
              const color = PHASE_COLORS[phase] || PHASE_COLORS.transition;
              return (
                <Paper
                  key={`macro-${idx}`}
                  withBorder
                  radius="md"
                  p="sm"
                  bg={ui.cardBg}
                  style={{ borderColor: ui.border, borderLeft: `4px solid ${color}` }}
                >
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
              <Paper key={`meso-${idx}`} withBorder radius="md" p="sm" bg={ui.cardBg} style={{ borderColor: ui.border }}>
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

        {/* Weeks / Micro cycles tab */}
        <Tabs.Panel value="weeks" pt="sm">
          <Stack gap="xs">
            {preview.micro_cycles.map((week: Record<string, any>, idx: number) => {
              const phase = String(week.phase || "transition");
              const color = PHASE_COLORS[phase] || PHASE_COLORS.transition;
              const dist = (week.intensity_distribution || {}) as Record<string, number>;
              return (
                <Paper
                  key={`wk-${idx}`}
                  withBorder
                  radius="md"
                  p="sm"
                  bg={ui.cardBg}
                  style={{ borderColor: ui.border, borderLeft: `4px solid ${color}` }}
                >
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2} style={{ flex: 1 }}>
                      <Group gap="xs">
                        <Badge size="xs" variant="light" style={{ background: `${color}22`, color }}>{phase}</Badge>
                        <Text fw={600} size="sm">{t("Week") || "Week"} {week.week_index}</Text>
                        <Badge size="xs" variant="light">{week.target_hours}h</Badge>
                        {week.countdown_days != null && (
                          <Text size="10px" c="dimmed">{week.countdown_days}{t("d to race") || "d to race"}</Text>
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
                            <Box style={{ flex: 1, minWidth: 40, height: 6, borderRadius: 3, background: isDark ? "rgba(148,163,184,0.2)" : "rgba(15,23,42,0.1)" }}>
                              <Box style={{
                                width: `${Math.round(Number(pct) * 100)}%`,
                                height: "100%",
                                borderRadius: 3,
                                background: zone === "Z1" ? "var(--mantine-color-cyan-5)" : zone === "Z2" ? "var(--mantine-color-blue-5)" : zone === "Z3" ? "var(--mantine-color-yellow-5)" : zone === "Z4" ? "var(--mantine-color-orange-5)" : "var(--mantine-color-red-5)",
                              }} />
                            </Box>
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

        {/* Workouts tab */}
        <Tabs.Panel value="workouts" pt="sm">
          <Paper withBorder radius="md" p="sm" bg={ui.cardBg} style={{ borderColor: ui.border }}>
            <ScrollArea h={420}>
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
                  {(preview.generated_workouts as Array<Record<string, any>>).map((row, index) => {
                    const phase = String(row.planning_context?.phase || "-");
                    return (
                      <Table.Tr key={`workout-${index}`}>
                        <Table.Td><Text size="xs">{row.date}</Text></Table.Td>
                        <Table.Td><Text size="xs" fw={500}>{row.title}</Text></Table.Td>
                        <Table.Td>
                          <Badge
                            size="xs"
                            variant="light"
                            style={{ background: `${PHASE_COLORS[phase] || "#94A3B8"}22`, color: PHASE_COLORS[phase] || "#94A3B8" }}
                          >
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
            <Text size="xs" c="dimmed" ta="right" mt={4}>
              {preview.generated_workouts.length} {t("workouts") || "workouts"}
            </Text>
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

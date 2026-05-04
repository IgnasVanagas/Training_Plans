import { ActionIcon, Badge, Card, Divider, Group, Modal, Paper, Progress, ScrollArea, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";
import { formatDuration } from "./formatters";
import { ActivityDetail } from "../../types/activityDetail";
import { useI18n } from "../../i18n/I18nProvider";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
};

type ExecutionTraceRow = {
    key: string;
    label: string;
    available: boolean;
    weightPct: number;
    componentScorePct: number | null;
    weightedPoints: number | null;
    normalizedContributionPct: number | null;
    note: string | null;
};

type ExecutionTraceMeta = {
    usedWeightPct: number;
    weightedTotalPoints: number;
    normalizationDivisor: number;
    reconstructedScorePct: number | null;
    thresholds: Array<{ status: string; minScorePct: number }>;
};

interface ComparisonPanelProps {
    activity: ActivityDetail;
    executionTraceRows: ExecutionTraceRow[];
    executionTraceMeta: ExecutionTraceMeta;
    executionInfoOpen: boolean;
    setExecutionInfoOpen: (v: boolean) => void;
    formatPace: (speed: number) => string;
    ui: UiTokens;
}

const clampPercent = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
};

const resolveMatchColor = (value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "gray";
    if (value >= 90) return "teal";
    if (value >= 75) return "blue";
    if (value >= 60) return "yellow";
    return "red";
};

const resolveExecutionStatusColor = (status: string | null | undefined) => {
    switch ((status || "").toLowerCase()) {
        case "great":
            return "teal";
        case "good":
            return "green";
        case "ok":
            return "lime";
        case "fair":
            return "yellow";
        case "subpar":
            return "orange";
        case "poor":
            return "red";
        default:
            return "gray";
    }
};

const formatMinutesLabel = (value: number | null | undefined) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "-";
    return formatDuration(Math.round(numeric * 60), true);
};

const formatDistanceLabel = (value: number | null | undefined) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return "-";
    return `${numeric.toFixed(numeric >= 100 ? 0 : 1)} km`;
};

const formatSignedValue = (value: number | null | undefined, digits: number, suffix: string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "-";
    return `${numeric > 0 ? "+" : ""}${numeric.toFixed(digits)} ${suffix}`;
};

const toTitleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

type ComparisonMetricCardProps = {
    title: string;
    matchPct: number | null | undefined;
    plannedValue: string;
    actualValue: string;
    detailLabel?: string;
    detailValue?: string | null;
    note?: string | null;
    ui: UiTokens;
};

const ComparisonMetricCard = ({
    title,
    matchPct,
    plannedValue,
    actualValue,
    detailLabel,
    detailValue,
    note,
    ui,
}: ComparisonMetricCardProps) => {
    const progressValue = clampPercent(matchPct);
    const hasScore = typeof matchPct === "number" && Number.isFinite(matchPct);

    return (
        <Card withBorder radius="md" p="md" bg={ui.surfaceAlt} style={{ borderColor: ui.border, height: "100%" }}>
            <Group justify="space-between" align="flex-start" mb="md" gap="sm">
                <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text size="xs" c={ui.textDim} tt="uppercase" fw={700}>{title}</Text>
                    <Text size="xl" fw={800} c={ui.textMain}>{hasScore ? `${Math.round(matchPct || 0)}%` : "-"}</Text>
                </Stack>
                {detailValue ? (
                    <Badge variant="light" color="gray">
                        {detailLabel ? `${detailLabel}: ${detailValue}` : detailValue}
                    </Badge>
                ) : null}
            </Group>
            <Progress value={progressValue} color={resolveMatchColor(matchPct)} radius="xl" size="sm" mb="md" />
            <SimpleGrid cols={2} spacing="sm">
                <Stack gap={2}>
                    <Text size="xs" c={ui.textDim}>Planned</Text>
                    <Text fw={700} c={ui.textMain}>{plannedValue}</Text>
                </Stack>
                <Stack gap={2}>
                    <Text size="xs" c={ui.textDim}>Actual</Text>
                    <Text fw={700} c={ui.textMain}>{actualValue}</Text>
                </Stack>
            </SimpleGrid>
            {note ? <Text size="xs" c={ui.textDim} mt="md">{note}</Text> : null}
        </Card>
    );
};

export const ComparisonPanel = ({
    activity,
    executionTraceRows,
    executionTraceMeta,
    executionInfoOpen,
    setExecutionInfoOpen,
    formatPace,
    ui,
}: ComparisonPanelProps) => {
    const { t } = useI18n();
    const pc = activity.planned_comparison!;

    const plannedDurationMin = Number(pc.planned?.duration_min);
    const actualDurationMin = Number(pc.actual?.duration_min);
    const plannedDistanceKm = Number(pc.planned?.distance_km);
    const actualDistanceKm = Number(pc.actual?.distance_km);
    const hasPlannedDistance = Boolean(
        pc.summary?.has_planned_distance
        ?? (Number.isFinite(plannedDistanceKm) && plannedDistanceKm > 0)
    );
    const durationDeltaMin = Number.isFinite(actualDurationMin) && Number.isFinite(plannedDurationMin)
        ? actualDurationMin - plannedDurationMin
        : Number(pc.summary?.duration_delta_min);
    const distanceDeltaKm = Number.isFinite(actualDistanceKm) && Number.isFinite(plannedDistanceKm)
        ? actualDistanceKm - plannedDistanceKm
        : Number(pc.summary?.distance_delta_km);

    const formatSecondsPerKm = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainder = Math.round(seconds % 60);
        return `${minutes}:${remainder.toString().padStart(2, "0")}/km`;
    };

    const formatPlannedTarget = (target?: { type?: string | null; value?: number | null; min?: number | null; max?: number | null; zone?: number | null } | null) => {
        if (!target) return "-";
        const value = Number(target.value);
        if (Number.isFinite(value) && value > 0) {
            if (target.type === "heart_rate") return `${Math.round(value)} bpm`;
            if (target.type === "power") return `${Math.round(value)} W`;
            if (target.type === "pace") {
                if (value > 20) return formatSecondsPerKm(value);
                return formatPace(value);
            }
            return `${Math.round(value)}`;
        }

        const min = Number(target.min);
        const max = Number(target.max);
        if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) {
            if (target.type === "heart_rate") return `${Math.round(min)}-${Math.round(max)} bpm`;
            if (target.type === "power") return `${Math.round(min)}-${Math.round(max)} W`;
            if (target.type === "pace") return `${formatPace(min)} - ${formatPace(max)}`;
        }

        if (target.zone) return `${t("Zone")} ${target.zone}`;
        return "-";
    };

    const formatActualIntensity = (row: NonNullable<NonNullable<ActivityDetail["planned_comparison"]>["splits"]>[number]) => {
        const actual = row.actual;
        if (!actual) return "-";
        const type = row.planned?.target?.type;
        if (type === "heart_rate") return actual.avg_hr ? `${Math.round(actual.avg_hr)} bpm` : "-";
        if (type === "power") return actual.avg_power ? `${Math.round(actual.avg_power)} W` : "-";
        if (type === "pace" && actual.avg_speed) return formatPace(actual.avg_speed);
        if (activity.sport === "running" && actual.avg_speed) return formatPace(actual.avg_speed);
        if (actual.avg_power) return `${Math.round(actual.avg_power)} W`;
        if (actual.avg_hr) return `${Math.round(actual.avg_hr)} bpm`;
        return "-";
    };

    const derivedWorkoutType = (() => {
        const structure = Array.isArray(pc.planned?.structure) ? pc.planned.structure : [];
        if (structure.length > 0 || (pc.splits?.length || 0) > 1) return t("Structured workout");
        if (pc.summary?.split_importance === "low") return t("Steady workout");
        return t("Open workout");
    })();

    const firstPlannedTarget = (pc.splits || [])
        .map((row) => formatPlannedTarget(row.planned?.target))
        .find((value) => value && value !== "-") || null;

    const plannedGoal = pc.planned?.intensity || firstPlannedTarget || t("Not specified");
    const executionStatus = (pc.summary?.execution_status || "").toString().toLowerCase();
    const executionStatusLabel = executionStatus ? t(toTitleCase(executionStatus)) : "-";
    const executionStatusColor = resolveExecutionStatusColor(executionStatus);
    const executionScore = Number(pc.summary?.execution_score_pct);
    const intensityMatch = Number(pc.summary?.intensity_match_pct);
    const executionSummaryText = pc.intensity?.note || pc.summary?.split_note || t("Only available components are included in the execution score.");
    const executionRows = executionTraceRows.map((row) => ({
        ...row,
        scoreImpact: row.weightedPoints != null && executionTraceMeta.normalizationDivisor > 0
            ? row.weightedPoints / executionTraceMeta.normalizationDivisor
            : null,
    }));

    return (
        <>
            <Paper withBorder p="md" radius="lg" mb="sm" bg={ui.surface} style={{ borderColor: ui.border }}>
                <Stack gap="md">
                    <Group justify="space-between" align="flex-start" gap="md">
                        <Stack gap={6} style={{ minWidth: 0 }}>
                            <Group gap="xs" align="center" wrap="wrap">
                                <Title order={5} c={ui.textMain}>{t("Planned vs Actual")}</Title>
                                <Badge variant="light" color={executionStatusColor}>{executionStatusLabel}</Badge>
                            </Group>
                            <Text size="lg" fw={800} c={ui.textMain} lineClamp={2}>{pc.workout_title}</Text>
                            <Group gap="xs" wrap="wrap">
                                <Badge variant="light" color="cyan">{t("Planned workout type")}: {derivedWorkoutType}</Badge>
                                {pc.sport_type ? <Badge variant="light" color="blue">{pc.sport_type}</Badge> : null}
                                {pc.planned?.intensity ? <Badge variant="outline" color="gray">{pc.planned.intensity}</Badge> : null}
                            </Group>
                        </Stack>
                        <Stack gap={2} align="flex-end">
                            <Text size="xs" c={ui.textDim} tt="uppercase" fw={700}>{t("Execution score")}</Text>
                            <Text size="lg" fw={800} c={ui.textMain}>
                                {Number.isFinite(executionScore) ? `${executionScore.toFixed(1)}%` : "-"}
                            </Text>
                        </Stack>
                    </Group>

                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                        <Paper withBorder radius="md" p="md" bg={ui.surfaceAlt} style={{ borderColor: ui.border, height: "100%" }}>
                            <Stack gap="sm">
                                <Text size="xs" c={ui.textDim} tt="uppercase" fw={700}>{t("Planned session")}</Text>
                                <SimpleGrid cols={hasPlannedDistance ? 2 : 1} spacing="sm">
                                    <Stack gap={2}>
                                        <Text size="xs" c={ui.textDim}>{t("Duration")}</Text>
                                        <Text fw={700} c={ui.textMain}>{formatMinutesLabel(plannedDurationMin)}</Text>
                                    </Stack>
                                    {hasPlannedDistance ? (
                                        <Stack gap={2}>
                                            <Text size="xs" c={ui.textDim}>{t("Distance")}</Text>
                                            <Text fw={700} c={ui.textMain}>{formatDistanceLabel(plannedDistanceKm)}</Text>
                                        </Stack>
                                    ) : null}
                                </SimpleGrid>
                                <Divider color={ui.border} />
                                <Stack gap={4}>
                                    <Text size="xs" c={ui.textDim} tt="uppercase" fw={700}>{t("Workout goal")}</Text>
                                    <Text fw={700} c={ui.textMain}>{plannedGoal}</Text>
                                    {pc.planned?.description ? (
                                        <Text size="sm" c={ui.textDim} lineClamp={3}>{pc.planned.description}</Text>
                                    ) : null}
                                </Stack>
                            </Stack>
                        </Paper>

                        <Paper withBorder radius="md" p="md" bg={ui.surfaceAlt} style={{ borderColor: ui.border, height: "100%" }}>
                            <Stack gap="sm">
                                <Group justify="space-between" align="flex-start" gap="sm">
                                    <Stack gap={2}>
                                        <Text size="xs" c={ui.textDim} tt="uppercase" fw={700}>{t("Execution summary")}</Text>
                                        <Text size="xl" fw={800} c={ui.textMain}>{Number.isFinite(executionScore) ? `${executionScore.toFixed(1)}%` : "-"}</Text>
                                    </Stack>
                                    <ActionIcon variant="subtle" size="sm" onClick={() => setExecutionInfoOpen(true)} aria-label={t("Execution status info")}>
                                        <IconHelpCircle size={16} />
                                    </ActionIcon>
                                </Group>
                                <Progress
                                    value={Number.isFinite(executionScore) ? clampPercent(executionScore) : 0}
                                    color={executionStatusColor}
                                    radius="xl"
                                    size="sm"
                                />
                                <SimpleGrid cols={hasPlannedDistance ? 2 : 1} spacing="sm">
                                    <Stack gap={2}>
                                        <Text size="xs" c={ui.textDim}>{t("Duration")}</Text>
                                        <Text fw={700} c={ui.textMain}>{formatMinutesLabel(actualDurationMin)}</Text>
                                    </Stack>
                                    {hasPlannedDistance ? (
                                        <Stack gap={2}>
                                            <Text size="xs" c={ui.textDim}>{t("Distance")}</Text>
                                            <Text fw={700} c={ui.textMain}>{formatDistanceLabel(actualDistanceKm)}</Text>
                                        </Stack>
                                    ) : null}
                                </SimpleGrid>
                                <Divider color={ui.border} />
                                <SimpleGrid cols={2} spacing="sm">
                                    <Stack gap={2}>
                                        <Text size="xs" c={ui.textDim} tt="uppercase" fw={700}>{t("Target")}</Text>
                                        <Text size="sm" fw={700} c={ui.textMain}>{plannedGoal}</Text>
                                    </Stack>
                                    <Stack gap={2}>
                                        <Text size="xs" c={ui.textDim} tt="uppercase" fw={700}>{t("Outcome")}</Text>
                                        <Text size="sm" fw={700} c={ui.textMain}>{executionStatusLabel}</Text>
                                    </Stack>
                                </SimpleGrid>
                                <Text size="sm" c={ui.textDim}>{executionSummaryText}</Text>
                            </Stack>
                        </Paper>
                    </SimpleGrid>

                    <SimpleGrid cols={{ base: 1, md: hasPlannedDistance ? 3 : 2 }} spacing="sm">
                        <ComparisonMetricCard
                            title={t("Duration Match")}
                            matchPct={pc.summary?.duration_match_pct}
                            plannedValue={formatMinutesLabel(plannedDurationMin)}
                            actualValue={formatMinutesLabel(actualDurationMin)}
                            detailLabel={t("Delta")}
                            detailValue={formatSignedValue(durationDeltaMin, 1, "min")}
                            ui={ui}
                        />
                        {hasPlannedDistance ? (
                            <ComparisonMetricCard
                                title={t("Distance Match")}
                                matchPct={pc.summary?.distance_match_pct}
                                plannedValue={formatDistanceLabel(plannedDistanceKm)}
                                actualValue={formatDistanceLabel(actualDistanceKm)}
                                detailLabel={t("Delta")}
                                detailValue={formatSignedValue(distanceDeltaKm, 2, "km")}
                                ui={ui}
                            />
                        ) : null}
                        <ComparisonMetricCard
                            title={t("Intensity Match")}
                            matchPct={pc.summary?.intensity_match_pct}
                            plannedValue={plannedGoal}
                            actualValue={Number.isFinite(intensityMatch) ? `${Math.round(intensityMatch)}%` : t("Data unavailable")}
                            note={pc.intensity?.note || pc.summary?.split_note || null}
                            ui={ui}
                        />
                    </SimpleGrid>

                    {!!executionRows.length && (
                        <Paper withBorder radius="md" p="md" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                            <Group justify="space-between" align="flex-start" gap="sm" mb="sm">
                                <Stack gap={4}>
                                    <Text size="sm" fw={700} c={ui.textMain}>{t("How this score was built")}</Text>
                                    <Text size="xs" c={ui.textDim}>
                                        {t("Score formula: available component scores are weighted and normalized to the metrics that were present on this activity.")}
                                    </Text>
                                </Stack>
                                <Badge variant="light">{t("Traceable weights")}</Badge>
                            </Group>
                            <Stack gap="xs">
                                {executionRows.map((row) => (
                                    <Paper key={`exec-trace-${row.key}`} withBorder radius="md" p="sm" bg={ui.surface} style={{ borderColor: ui.border }}>
                                        <Group justify="space-between" align="flex-start" gap="md">
                                            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                                                <Group gap="xs" wrap="wrap">
                                                    <Text size="sm" fw={700} c={ui.textMain}>{t(row.label)}</Text>
                                                    <Badge variant="light" color={row.available ? "teal" : "gray"}>
                                                        {row.available ? t("Used in score") : t("Not used")}
                                                    </Badge>
                                                </Group>
                                                <Text size="xs" c={ui.textDim}>{t("Weight")}: {row.weightPct.toFixed(1)}%</Text>
                                            </Stack>
                                            <Stack gap={2} align="flex-end">
                                                <Text size="sm" fw={700} c={ui.textMain}>
                                                    {row.componentScorePct != null ? `${row.componentScorePct.toFixed(1)}%` : "-"}
                                                </Text>
                                                <Text size="xs" c={ui.textDim}>
                                                    {row.scoreImpact != null ? `${t("Score impact")}: ${row.scoreImpact.toFixed(1)} pts` : "-"}
                                                </Text>
                                            </Stack>
                                        </Group>
                                        {row.available && row.componentScorePct != null ? (
                                            <Progress
                                                value={clampPercent(row.componentScorePct)}
                                                color={resolveMatchColor(row.componentScorePct)}
                                                radius="xl"
                                                size="sm"
                                                mt="sm"
                                            />
                                        ) : null}
                                        {!row.available && row.note ? (
                                            <Text size="xs" c={ui.textDim} mt="sm">{t(row.note) || row.note}</Text>
                                        ) : null}
                                    </Paper>
                                ))}
                            </Stack>
                            <Group mt="sm" gap="md">
                                <Text size="xs" c={ui.textDim}>{t("Used weight")}: {executionTraceMeta.usedWeightPct.toFixed(1)}%</Text>
                                <Text size="xs" c={ui.textDim}>{t("Weighted total")}: {executionTraceMeta.weightedTotalPoints.toFixed(2)}</Text>
                                <Text size="xs" c={ui.textDim}>
                                    {t("Execution score")}: {executionTraceMeta.reconstructedScorePct != null ? `${executionTraceMeta.reconstructedScorePct.toFixed(1)}%` : "-"}
                                </Text>
                            </Group>
                        </Paper>
                    )}

                    {!!pc.splits?.length && (
                        <Paper withBorder radius="md" p="md" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                            <Group justify="space-between" align="flex-start" gap="sm" mb="xs">
                                <Stack gap={4}>
                                    <Text size="sm" fw={700} c={ui.textMain}>{t("Planned breakdown")}</Text>
                                    {pc.summary?.split_note ? <Text size="xs" c={ui.textDim}>{pc.summary.split_note}</Text> : null}
                                </Stack>
                                {pc.summary?.split_importance === "low" ? (
                                    <Badge variant="light" color="cyan">{t("Steady workout")}</Badge>
                                ) : null}
                            </Group>
                            <ScrollArea offsetScrollbars>
                                <Table striped highlightOnHover withTableBorder withColumnBorders>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>{t("Split")}</Table.Th>
                                            <Table.Th>{t("Planned")}</Table.Th>
                                            <Table.Th>{t("Actual")}</Table.Th>
                                            <Table.Th>{t("Planned Intensity")}</Table.Th>
                                            <Table.Th>{t("Actual Intensity")}</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {pc.splits.slice(0, 20).map((row) => (
                                            <Table.Tr key={`cmp-split-${row.split}`}>
                                                <Table.Td>
                                                    <Stack gap={0}>
                                                        <Text fw={700}>{row.split}</Text>
                                                        {row.planned?.category ? <Text size="xs" c={ui.textDim}>{row.planned.category}</Text> : null}
                                                    </Stack>
                                                </Table.Td>
                                                <Table.Td>{row.planned?.planned_duration_s ? formatDuration(row.planned.planned_duration_s, true) : "-"}</Table.Td>
                                                <Table.Td>{row.actual?.actual_duration_s ? formatDuration(row.actual.actual_duration_s, true) : "-"}</Table.Td>
                                                <Table.Td>{formatPlannedTarget(row.planned?.target)}</Table.Td>
                                                <Table.Td>{formatActualIntensity(row)}</Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            </ScrollArea>
                        </Paper>
                    )}
                </Stack>
            </Paper>
            <Modal
                opened={executionInfoOpen}
                onClose={() => setExecutionInfoOpen(false)}
                title={t("Workout Execution Status")}
                size="md"
                centered
            >
                <Stack gap="xs">
                    <Text size="sm" c={ui.textDim}>
                        {t("Execution status is a weighted workout-quality score built from available metrics: duration match, distance match (when planned), intensity match, and split adherence (when splits are relevant).")}
                    </Text>
                    <Text size="sm" c={ui.textDim}>
                        {t("If a workout is steady-state (for example a regular Z2 ride), intensity quality is prioritized over auto-split count.")}
                    </Text>
                    <Text size="sm" fw={700}>{t("Status levels (best to worst):")}</Text>
                    <Text size="sm">
                        {[
                            t("Great"),
                            t("Good"),
                            t("Ok"),
                            t("Fair"),
                            t("Subpar"),
                            t("Poor"),
                            t("Incomplete"),
                        ].join(", ")}.
                    </Text>
                    <Text size="sm" c={ui.textDim}>
                        {t("Incomplete is used when key execution data is missing or the session is not sufficiently complete for reliable scoring.")}
                    </Text>
                    {!!executionRows.length && (
                        <>
                            <Text size="sm" fw={700}>{t("Traceability breakdown")}</Text>
                            <ScrollArea offsetScrollbars>
                                <Table striped highlightOnHover withTableBorder withColumnBorders>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>{t("Component")}</Table.Th>
                                            <Table.Th>{t("Score")}</Table.Th>
                                            <Table.Th>{t("Weight")}</Table.Th>
                                            <Table.Th>{t("Weighted points")}</Table.Th>
                                            <Table.Th>{t("Score impact")}</Table.Th>
                                            <Table.Th>{t("In Score")}</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {executionRows.map((row) => (
                                            <Table.Tr key={`exec-modal-${row.key}`}>
                                                <Table.Td>{t(row.label)}</Table.Td>
                                                <Table.Td>{row.componentScorePct != null ? `${row.componentScorePct.toFixed(1)}%` : "-"}</Table.Td>
                                                <Table.Td>{row.weightPct.toFixed(1)}%</Table.Td>
                                                <Table.Td>{row.weightedPoints != null ? row.weightedPoints.toFixed(2) : "-"}</Table.Td>
                                                <Table.Td>{row.scoreImpact != null ? `${row.scoreImpact.toFixed(1)} pts` : "-"}</Table.Td>
                                                <Table.Td>{row.available ? t("Yes") : t("No")}</Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            </ScrollArea>
                            <Text size="sm" c={ui.textDim}>
                                {t("Execution score")}: {executionTraceMeta.reconstructedScorePct != null ? `${executionTraceMeta.reconstructedScorePct.toFixed(1)}%` : "-"}
                                {" · "}{t("Weighted total")}: {executionTraceMeta.weightedTotalPoints.toFixed(2)}
                                {" · "}{t("Used weight")}: {executionTraceMeta.usedWeightPct.toFixed(1)}%
                            </Text>
                            <Text size="sm" fw={700}>{t("Thresholds")}</Text>
                            <Group gap="xs" wrap="wrap">
                                {executionTraceMeta.thresholds.map((row) => (
                                    <Badge key={`exec-threshold-${row.status}`} variant="light">
                                        {t(toTitleCase(row.status))} ≥ {row.minScorePct.toFixed(0)}%
                                    </Badge>
                                ))}
                            </Group>
                        </>
                    )}
                </Stack>
            </Modal>
        </>
    );
};

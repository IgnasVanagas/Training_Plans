import { ActionIcon, Badge, Card, Group, Modal, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";
import { formatDuration } from "./formatters";
import { ActivityDetail } from "../../types/activityDetail";

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

export const ComparisonPanel = ({
    activity,
    executionTraceRows,
    executionTraceMeta,
    executionInfoOpen,
    setExecutionInfoOpen,
    formatPace,
    ui,
}: ComparisonPanelProps) => {
    const pc = activity.planned_comparison!;

    return (
        <>
            <Paper withBorder p="md" radius="lg" mb="sm" bg={ui.surface} style={{ borderColor: ui.border }}>
                <Group justify="space-between" mb="xs">
                    <Title order={5} c={ui.textMain}>Planned vs Actual</Title>
                    <Text size="xs" c={ui.textDim}>{pc.workout_title}</Text>
                </Group>
            <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="xs" mb="sm">
                {pc.summary?.has_planned_distance && (
                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Duration Delta</Text>
                    <Text fw={700}>{(pc.summary?.duration_delta_min || 0).toFixed(1)} min</Text>
                </Card>
                )}
                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Duration Match</Text>
                    <Text fw={700}>{Math.round(pc.summary?.duration_match_pct || 0)}%</Text>
                </Card>
                {pc.summary?.has_planned_distance && (
                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Distance Delta</Text>
                    <Text fw={700}>{(pc.summary?.distance_delta_km || 0).toFixed(2)} km</Text>
                </Card>
                )}
                {pc.summary?.has_planned_distance && (
                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Distance Match</Text>
                    <Text fw={700}>{Math.round(pc.summary?.distance_match_pct || 0)}%</Text>
                </Card>
                )}
                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Intensity Match</Text>
                    <Text fw={700}>{Math.round(pc.summary?.intensity_match_pct || 0)}%</Text>
                </Card>
                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                    <Group justify="space-between" align="center" gap={6}>
                        <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Workout Execution Status</Text>
                        <ActionIcon variant="subtle" size="xs" onClick={() => setExecutionInfoOpen(true)} aria-label="Execution status info">
                            <IconHelpCircle size={14} />
                        </ActionIcon>
                    </Group>
                    <Text fw={700} c={
                        pc.summary?.execution_status === 'great' || pc.summary?.execution_status === 'good'
                            ? 'green.6'
                            : pc.summary?.execution_status === 'ok' || pc.summary?.execution_status === 'fair' || pc.summary?.execution_status === 'subpar'
                                ? 'yellow.6'
                                : pc.summary?.execution_status === 'poor' || pc.summary?.execution_status === 'incomplete'
                                    ? 'red.6'
                                    : ui.textMain
                    }>
                        {(pc.summary?.execution_status || '-').toString().toUpperCase()}
                    </Text>
                </Card>
            </SimpleGrid>
            {pc.summary?.split_importance === 'low' && (
                <Text size="xs" c={ui.textDim} mb="xs">
                    {pc.summary?.split_note || pc.intensity?.note}
                </Text>
            )}
            {!!executionTraceRows.length && (
                <Paper withBorder radius="md" p="sm" mb="sm" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                    <Group justify="space-between" mb={6}>
                        <Text size="sm" fw={700} c={ui.textMain}>Execution Explainability</Text>
                        <Badge variant="light">Traceable weights</Badge>
                    </Group>
                    <Text size="xs" c={ui.textDim} mb="xs">
                        Score formula: Σ(component score × weight) / Σ(used weights).
                    </Text>
                    <Table striped highlightOnHover withTableBorder withColumnBorders>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Component</Table.Th>
                                <Table.Th>Score</Table.Th>
                                <Table.Th>Weight</Table.Th>
                                <Table.Th>Weighted Pts</Table.Th>
                                <Table.Th>Contribution</Table.Th>
                                <Table.Th>Trace</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {executionTraceRows.map((row) => (
                                <Table.Tr key={`exec-trace-${row.key}`}>
                                    <Table.Td>{row.label}</Table.Td>
                                    <Table.Td>{row.componentScorePct != null ? `${row.componentScorePct.toFixed(1)}%` : '-'}</Table.Td>
                                    <Table.Td>{row.weightPct.toFixed(1)}%</Table.Td>
                                    <Table.Td>{row.weightedPoints != null ? row.weightedPoints.toFixed(2) : '-'}</Table.Td>
                                    <Table.Td>{row.normalizedContributionPct != null ? `${row.normalizedContributionPct.toFixed(1)}%` : '-'}</Table.Td>
                                    <Table.Td>{row.available ? 'Included' : (row.note || 'Excluded')}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                    <Group mt="xs" gap="md">
                        <Text size="xs" c={ui.textDim}>Used weight: {executionTraceMeta.usedWeightPct.toFixed(1)}%</Text>
                        <Text size="xs" c={ui.textDim}>Weighted total: {executionTraceMeta.weightedTotalPoints.toFixed(2)}</Text>
                        <Text size="xs" c={ui.textDim}>Normalizer: {executionTraceMeta.normalizationDivisor.toFixed(3)}</Text>
                        <Text size="xs" c={ui.textDim}>Rebuilt score: {executionTraceMeta.reconstructedScorePct != null ? `${executionTraceMeta.reconstructedScorePct.toFixed(1)}%` : '-'}</Text>
                    </Group>
                </Paper>
            )}
            {!!pc.splits?.length && (
                <Table striped highlightOnHover withTableBorder withColumnBorders>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Split</Table.Th>
                            <Table.Th>Planned</Table.Th>
                            <Table.Th>Actual</Table.Th>
                            <Table.Th>Planned Intensity</Table.Th>
                            <Table.Th>Actual Intensity</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {pc.splits.slice(0, 20).map((row) => (
                            <Table.Tr key={`cmp-split-${row.split}`}>
                                <Table.Td>{row.split}</Table.Td>
                                <Table.Td>{row.planned?.planned_duration_s ? formatDuration(row.planned.planned_duration_s, true) : '-'}</Table.Td>
                                <Table.Td>{row.actual?.actual_duration_s ? formatDuration(row.actual.actual_duration_s, true) : '-'}</Table.Td>
                                <Table.Td>
                                    {(() => {
                                        const p = row.planned;
                                        if (!p?.target) return '-';
                                        const t = p.target;

                                        // Prioritize exact value
                                        if (t.value != null) {
                                            const val = Number(t.value);
                                            if (val > 0) {
                                                if (t.type === 'heart_rate') return `${Math.round(val)} bpm`;
                                                if (t.type === 'power') return `${Math.round(val)} W`;
                                                if (t.type === 'pace') {
                                                    // Helper to format s/km
                                                    const formatSecondsPerKm = (seconds: number) => {
                                                        const m = Math.floor(seconds / 60);
                                                        const s = Math.round(seconds % 60);
                                                        return `${m}:${s.toString().padStart(2, '0')}/km`;
                                                    };
                                                    // Heuristic: values > 20 differ from m/s (usually < 10)
                                                    if (val > 20) return formatSecondsPerKm(val);
                                                    return formatPace(val);
                                                }
                                                return `${Math.round(val)}`;
                                            }
                                        }

                                        // Range fallback
                                        if (t.min && t.max) {
                                            if (t.type === 'heart_rate') return `${t.min}-${t.max} bpm`;
                                            if (t.type === 'power') return `${t.min}-${t.max} W`;
                                            if (t.type === 'pace') return `${formatPace(Number(t.min))} - ${formatPace(Number(t.max))}`;
                                        }

                                        // Zone fallback
                                        if (t.zone) return `Zone ${t.zone}`;

                                        return '-';
                                    })()}
                                </Table.Td>
                                <Table.Td>
                                     {(() => {
                                        const actual = row.actual;
                                        if (!actual) return '-';
                                        const type = row.planned?.target?.type;
                                        if (type === 'heart_rate') return actual.avg_hr ? `${Math.round(actual.avg_hr)} bpm` : '-';
                                        if (type === 'power') return actual.avg_power ? `${Math.round(actual.avg_power)} W` : '-';
                                        // Pace target often used in running
                                        if (type === 'pace' && actual.avg_speed) return formatPace(actual.avg_speed);

                                        // Fallback priority
                                        if (activity.sport === 'running' && actual.avg_speed) return formatPace(actual.avg_speed);
                                        if (actual.avg_power) return `${Math.round(actual.avg_power)} W`;
                                        if (actual.avg_hr) return `${Math.round(actual.avg_hr)} bpm`;
                                        return '-';
                                     })()}
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            )}
        </Paper>
            <Modal
                opened={executionInfoOpen}
                onClose={() => setExecutionInfoOpen(false)}
                title="Workout Execution Status"
                size="md"
                centered
            >
                <Stack gap="xs">
                    <Text size="sm" c={ui.textDim}>
                        Execution status is a weighted workout-quality score built from available metrics:
                        duration match, distance match (when planned), intensity match, and split adherence (when splits are relevant).
                    </Text>
                    <Text size="sm" c={ui.textDim}>
                        If a workout is steady-state (for example a regular Z2 ride), intensity quality is prioritized over auto-split count.
                    </Text>
                    <Text size="sm" fw={700}>Status levels (best to worst):</Text>
                    <Text size="sm">Great, Good, Ok, Fair, Subpar, Poor, Incomplete.</Text>
                    <Text size="sm" c={ui.textDim}>
                        Incomplete is used when key execution data is missing or the session is not sufficiently complete for reliable scoring.
                    </Text>
                    {!!executionTraceRows.length && (
                        <>
                            <Text size="sm" fw={700}>Traceability breakdown</Text>
                            <Table striped highlightOnHover withTableBorder withColumnBorders>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Component</Table.Th>
                                        <Table.Th>Score</Table.Th>
                                        <Table.Th>Weight</Table.Th>
                                        <Table.Th>Weighted</Table.Th>
                                        <Table.Th>In Score</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {executionTraceRows.map((row) => (
                                    <Table.Tr key={`exec-modal-${row.key}`}>
                                        <Table.Td>{row.label}</Table.Td>
                                        <Table.Td>{row.componentScorePct != null ? `${row.componentScorePct.toFixed(1)}%` : '-'}</Table.Td>
                                        <Table.Td>{row.weightPct.toFixed(1)}%</Table.Td>
                                        <Table.Td>{row.weightedPoints != null ? row.weightedPoints.toFixed(2) : '-'}</Table.Td>
                                        <Table.Td>{row.available ? 'Yes' : 'No'}</Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                        <Text size="sm" c={ui.textDim}>
                            Reconstructed execution score: {executionTraceMeta.reconstructedScorePct != null ? `${executionTraceMeta.reconstructedScorePct.toFixed(1)}%` : '-'}
                            {' '}from weighted total {executionTraceMeta.weightedTotalPoints.toFixed(2)} and normalizer {executionTraceMeta.normalizationDivisor.toFixed(3)}.
                        </Text>
                        <Text size="sm" fw={700}>Thresholds</Text>
                        <Group gap="xs" wrap="wrap">
                            {executionTraceMeta.thresholds.map((row) => (
                                <Badge key={`exec-threshold-${row.status}`} variant="light">
                                    {row.status.toUpperCase()} ≥ {row.minScorePct.toFixed(0)}%
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

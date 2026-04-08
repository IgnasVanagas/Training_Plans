import { Box, Button, Group, Paper, Table, Text, Title } from "@mantine/core";
import { IconTrophy } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { formatDuration } from "./formatters";
import { ActivityDetail, EffortSegmentMeta } from "../../types/activityDetail";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
};

interface BestEffortsPanelProps {
    activity: ActivityDetail;
    me: any;
    rankedBestEfforts: NonNullable<ActivityDetail['best_efforts']>;
    bestEffortMetaByKey: Record<string, EffortSegmentMeta>;
    selectedEffortKey: string | null;
    onSelectEffort: (key: string) => void;
    isCyclingActivity: boolean;
    isRunningActivity: boolean;
    isDark: boolean;
    ui: UiTokens;
    t: (key: string) => string;
}

export const BestEffortsPanel = ({
    activity,
    me,
    rankedBestEfforts,
    bestEffortMetaByKey,
    selectedEffortKey,
    onSelectEffort,
    isCyclingActivity,
    isRunningActivity,
    isDark,
    ui,
    t,
}: BestEffortsPanelProps) => {
    const [showAllBestEfforts, setShowAllBestEfforts] = useState(true);

    const displayedBestEfforts = useMemo(() => {
        if (!activity?.best_efforts?.length) return [];
        if (showAllBestEfforts || rankedBestEfforts.length === 0) return activity.best_efforts;
        return rankedBestEfforts;
    }, [activity?.best_efforts, rankedBestEfforts, showAllBestEfforts]);

    const hasHiddenBestEfforts = useMemo(() => {
        const total = activity?.best_efforts?.length ?? 0;
        return total > displayedBestEfforts.length;
    }, [activity?.best_efforts?.length, displayedBestEfforts.length]);

    const hasCyclingDistEfforts = isCyclingActivity && displayedBestEfforts.some(e => e.distance);

    return (
        <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
            <Group justify="space-between" mb="md">
                <Title order={5} c={ui.textMain}>{t("Best Efforts")}</Title>
                {hasHiddenBestEfforts && (
                    <Button size="xs" variant="subtle" onClick={() => setShowAllBestEfforts(v => !v)}>
                        {showAllBestEfforts ? t('Show PRs only') : t('Show all efforts')}
                    </Button>
                )}
            </Group>
            <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <Table striped highlightOnHover withTableBorder withColumnBorders style={{ whiteSpace: 'nowrap' }}>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th></Table.Th>
                        <Table.Th>{t('Effort')}</Table.Th>
                        {isCyclingActivity && <Table.Th>{t('Power')}</Table.Th>}
                        {isCyclingActivity && me?.profile?.weight && <Table.Th>{t('W/kg')}</Table.Th>}
                        {(isRunningActivity || isCyclingActivity || hasCyclingDistEfforts) && <Table.Th>{t('Time')}</Table.Th>}
                        {isRunningActivity && <Table.Th>{t('Pace')}</Table.Th>}
                        {isCyclingActivity && <Table.Th>{t('Speed')}</Table.Th>}
                        <Table.Th>{t('Heart Rate')}</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {displayedBestEfforts.map((effort, idx) => {
                        const key = effort.window || effort.distance || String(idx);
                        const prRank = activity.personal_records?.[key];
                        const weight = me?.profile?.weight;
                        const meta = bestEffortMetaByKey[key];
                        const displayPower = effort.power ?? (meta?.avgPower != null ? Math.round(meta.avgPower) : null);
                        const displaySeconds = effort.time_seconds ?? meta?.seconds ?? null;
                        const displayMeters = effort.meters ?? meta?.meters ?? null;
                        const displayHr = effort.avg_hr ?? (meta?.avgHr != null ? Math.round(meta.avgHr) : null);
                        const displaySpeedKmh = displayMeters != null && displaySeconds != null && displaySeconds > 0
                            ? (displayMeters / 1000) / (displaySeconds / 3600)
                            : (meta?.speedKmh ?? null);
                        const medalColor = prRank === 1 ? '#f0a500' : prRank === 2 ? '#a0a0a0' : prRank === 3 ? '#cd7f32' : undefined;
                        const rankLabel = prRank === 1 ? t('PR') : prRank === 2 ? t('2nd') : prRank === 3 ? t('3rd') : undefined;
                        return (
                            <Table.Tr
                                key={key}
                                style={{
                                    cursor: meta ? 'pointer' : 'default',
                                    backgroundColor: selectedEffortKey === key ? (isDark ? 'rgba(233,90,18,0.16)' : 'rgba(233,90,18,0.10)') : undefined,
                                }}
                                onClick={() => meta && onSelectEffort(key)}
                            >
                                <Table.Td w={60} style={{ textAlign: 'center' }}>
                                    {medalColor && (
                                        <Group gap={2} wrap="nowrap" justify="center">
                                            <IconTrophy size={14} color={medalColor} />
                                            <Text size="10px" fw={700} c={medalColor}>{rankLabel}</Text>
                                        </Group>
                                    )}
                                </Table.Td>
                                <Table.Td fw={600}>{effort.window || effort.distance}</Table.Td>
                                {isCyclingActivity && <Table.Td>{displayPower != null ? `${displayPower} W` : '-'}</Table.Td>}
                                {isCyclingActivity && weight && <Table.Td>{displayPower != null ? `${(displayPower / weight).toFixed(2)} W/kg` : '-'}</Table.Td>}
                                {(isRunningActivity || isCyclingActivity || hasCyclingDistEfforts) && <Table.Td>{displaySeconds != null ? formatDuration(displaySeconds) : '-'}</Table.Td>}
                                {isRunningActivity && (
                                    <Table.Td>
                                        {displaySeconds != null && displayMeters
                                            ? (() => { const paceMinPerKm = (displaySeconds / displayMeters) * (1000 / 60); const mins = Math.floor(paceMinPerKm); const secs = Math.round((paceMinPerKm - mins) * 60); return `${mins}:${secs.toString().padStart(2, '0')} /km`; })()
                                            : '-'}
                                    </Table.Td>
                                )}
                                {isCyclingActivity && (
                                    <Table.Td>
                                        {displaySpeedKmh != null ? `${displaySpeedKmh.toFixed(1)} km/h` : '-'}
                                    </Table.Td>
                                )}
                                <Table.Td>{displayHr != null ? `${displayHr} bpm` : '-'}</Table.Td>
                            </Table.Tr>
                        );
                    })}
                </Table.Tbody>
            </Table>
            </Box>
            <Group gap="md" mt="sm">
                <Group gap={4}><IconTrophy size={12} color="#f0a500" /><Text size="xs" c="dimmed">{t('PR')}</Text></Group>
                <Group gap={4}><IconTrophy size={12} color="#a0a0a0" /><Text size="xs" c="dimmed">{t('2nd')}</Text></Group>
                <Group gap={4}><IconTrophy size={12} color="#cd7f32" /><Text size="xs" c="dimmed">{t('3rd')}</Text></Group>
            </Group>
        </Paper>
    );
};

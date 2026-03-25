import { useEffect, useState } from 'react';
import { Box, Group, Modal, Paper, Progress, Select, SimpleGrid, Stack, Text } from '@mantine/core';

export type ZoneDetailModalData = {
    title: string;
    metrics: {
        totalDistanceKm: number;
        totalDurationMin: number;
        avgPaceMinPerKm: number | null;
        maxPaceMinPerKm: number | null;
        avgHr: number | null;
        maxHr: number | null;
        cyclingAvgPower: number | null;
        cyclingMaxPower: number | null;
        cyclingNormalizedPower: number | null;
        activitiesCount: number;
        aerobicLoad: number;
        anaerobicLoad: number;
    };
    zones: {
        running: { activityCount: number; zoneSecondsByMetric: { hr: Record<string, number>; pace: Record<string, number> } };
        cycling: { activityCount: number; zoneSecondsByMetric: { hr: Record<string, number>; power: Record<string, number> } };
    };
    activities: Array<{
        id?: number;
        date: Date;
        sport: string;
        distanceKm: number;
        durationMin: number;
        avgHr?: number;
        avgPaceMinPerKm?: number | null;
        zoneSeconds: Record<string, number>;
        zoneCount: number;
    }>;
    partialData?: boolean;
    partialDataMessage?: string;
    isLoading?: boolean;
};

type Props = {
    data: ZoneDetailModalData | null;
    onClose: () => void;
};

const formatTotalMinutes = (minutes: number) => {
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h}h ${m}m`;
};

const formatPace = (minutesPerKm: number | null) => {
    if (!minutesPerKm || !Number.isFinite(minutesPerKm) || minutesPerKm <= 0) return '-';
    const mins = Math.floor(minutesPerKm);
    const secsRaw = Math.round((minutesPerKm - mins) * 60);
    const carry = secsRaw === 60 ? 1 : 0;
    const secs = secsRaw === 60 ? 0 : secsRaw;
    return `${mins + carry}:${secs.toString().padStart(2, '0')}/km`;
};

const formatAvgHr = (avgHr: number | null) => {
    if (!avgHr || !Number.isFinite(avgHr)) return '-';
    return `${Math.round(avgHr)} bpm`;
};

const formatPower = (watts: number | null) => {
    if (!watts || !Number.isFinite(watts) || watts <= 0) return '-';
    return `${Math.round(watts)} W`;
};

export default function TrainingCalendarZoneDetailModal({ data, onClose }: Props) {
    const [zoneBreakdownMode, setZoneBreakdownMode] = useState<'all' | 'sport'>('all');
    const [runningZoneMetric, setRunningZoneMetric] = useState<'hr' | 'pace'>('hr');
    const [cyclingZoneMetric, setCyclingZoneMetric] = useState<'power' | 'hr'>('power');
    const [zoneExplainModal, setZoneExplainModal] = useState<{ title: string; description: string } | null>(null);

    useEffect(() => {
        if (!data) return;
        setZoneBreakdownMode('all');
        setRunningZoneMetric('hr');
        setCyclingZoneMetric('power');
    }, [data]);

    const renderZoneBars = (zoneSeconds: Record<string, number>, zoneCount: number, metric: 'hr' | 'pace' | 'power') => {
        const values = Array.from({ length: zoneCount }, (_, idx) => zoneSeconds[`Z${idx + 1}`] || 0);
        const total = values.reduce((sum, value) => sum + value, 0);
        const zonePalette = zoneCount === 5
            ? [
                'var(--mantine-color-green-5)',
                'var(--mantine-color-lime-5)',
                'var(--mantine-color-yellow-5)',
                'var(--mantine-color-orange-5)',
                'var(--mantine-color-red-5)'
            ]
            : [
                'var(--mantine-color-green-5)',
                'var(--mantine-color-lime-5)',
                'var(--mantine-color-yellow-5)',
                'var(--mantine-color-yellow-6)',
                'var(--mantine-color-orange-5)',
                'var(--mantine-color-orange-6)',
                'var(--mantine-color-red-6)'
            ];

        const formatZoneDuration = (seconds: number) => {
            const totalMinutes = Math.max(0, Math.round((seconds || 0) / 60));
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `${hours}h ${minutes}m`;
        };

        const openZoneExplanation = (zone: number) => {
            const hrDescriptions = [
                'Very easy recovery effort. Conversation is effortless and breathing is very light.',
                'Easy aerobic endurance. Comfortable, sustainable pace for long sessions.',
                'Steady aerobic / tempo. Controlled but noticeably harder than endurance pace.',
                'Threshold-focused work. Hard effort, speaking becomes limited.',
                'High-intensity / near-max effort. Short, demanding intervals.'
            ];
            const paceDescriptions = [
                'Very easy aerobic pace.',
                'Easy endurance pace.',
                'Steady aerobic pace.',
                'Around threshold pace (LT2 vicinity).',
                'Sub-threshold to VO2 transition.',
                'VO2-focused hard pace.',
                'Neuromuscular / sprint-end pace.'
            ];
            const powerDescriptions = [
                'Active recovery (<55% FTP).',
                'Endurance (56-75% FTP).',
                'Tempo (76-90% FTP).',
                'Threshold (91-105% FTP).',
                'VO2max (106-120% FTP).',
                'Anaerobic capacity (121-150% FTP).',
                'Neuromuscular / sprint (>150% FTP).'
            ];

            const metricLabel = metric === 'hr' ? 'Heart Rate' : metric === 'pace' ? 'Pace' : 'Power';
            const description = metric === 'hr'
                ? (hrDescriptions[zone - 1] || 'Zone description unavailable.')
                : metric === 'pace'
                    ? (paceDescriptions[zone - 1] || 'Zone description unavailable.')
                    : (powerDescriptions[zone - 1] || 'Zone description unavailable.');

            setZoneExplainModal({
                title: `${metricLabel} Z${zone}`,
                description
            });
        };

        return (
            <Stack gap={4}>
                {values.map((seconds, idx) => {
                    const pct = total > 0 ? (seconds / total) * 100 : 0;
                    const zoneColor = zonePalette[idx] || 'var(--mantine-color-gray-5)';
                    const pctLabel = `${Math.round(pct)}%`;
                    return (
                        <Group key={`zone-${idx + 1}`} gap={6} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => openZoneExplanation(idx + 1)}>
                            <Box w={28}><Text size="xs">Z{idx + 1}</Text></Box>
                            <Progress value={pct} color={zoneColor} size={8} radius={4} flex={1} />
                            <Box w={112} ta="right"><Text size="xs" c="dimmed">{formatZoneDuration(seconds)} · {pctLabel}</Text></Box>
                        </Group>
                    );
                })}
            </Stack>
        );
    };

    return (
        <>
            <Modal
                opened={Boolean(data)}
                onClose={onClose}
                title={data?.title || 'Details'}
                size="lg"
            >
                {data && (
                    <Stack gap="sm">
                        {data.isLoading && (
                            <Paper withBorder p="sm" radius="sm">
                                <Text size="sm" c="dimmed">Loading additional details… currently showing available data.</Text>
                            </Paper>
                        )}

                        {data.partialData && (
                            <Paper withBorder p="sm" radius="sm" style={{ borderColor: 'var(--mantine-color-yellow-5)' }}>
                                <Text size="sm" c="yellow.7" fw={600}>Partial data</Text>
                                <Text size="sm" c="dimmed" mt={2}>
                                    {data.partialDataMessage || 'Sync is still in progress. Showing what is available right now.'}
                                </Text>
                            </Paper>
                        )}

                        <Paper withBorder p="sm" radius="sm">
                            <Group justify="space-between" align="flex-start" mb={8}>
                                <Stack gap={0}>
                                    <Text size="sm" fw={700}>Summary</Text>
                                    <Text size="xs" c="dimmed">{data.metrics.activitiesCount} activities</Text>
                                </Stack>
                                <Text size="xs" c="dimmed">
                                    Aerobic {data.metrics.aerobicLoad.toFixed(1)} · Anaerobic {data.metrics.anaerobicLoad.toFixed(1)}
                                </Text>
                            </Group>

                            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" verticalSpacing="xs">
                                <Paper withBorder p="xs" radius="sm">
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Distance</Text>
                                    <Text size="sm" fw={700}>{data.metrics.totalDistanceKm.toFixed(1)} km</Text>
                                </Paper>
                                <Paper withBorder p="xs" radius="sm">
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Duration</Text>
                                    <Text size="sm" fw={700}>{formatTotalMinutes(data.metrics.totalDurationMin)}</Text>
                                </Paper>
                                <Paper withBorder p="xs" radius="sm">
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Avg HR</Text>
                                    <Text size="sm" fw={700}>{formatAvgHr(data.metrics.avgHr)}</Text>
                                </Paper>
                                <Paper withBorder p="xs" radius="sm">
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Max HR</Text>
                                    <Text size="sm" fw={700}>{formatAvgHr(data.metrics.maxHr)}</Text>
                                </Paper>
                            </SimpleGrid>

                            {(data.metrics.avgPaceMinPerKm || data.metrics.maxPaceMinPerKm) && (
                                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">
                                    <Paper withBorder p="xs" radius="sm">
                                        <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Running Avg Pace</Text>
                                        <Text size="sm" fw={700}>{formatPace(data.metrics.avgPaceMinPerKm)}</Text>
                                    </Paper>
                                    <Paper withBorder p="xs" radius="sm">
                                        <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Running Max Pace</Text>
                                        <Text size="sm" fw={700}>{formatPace(data.metrics.maxPaceMinPerKm)}</Text>
                                    </Paper>
                                </SimpleGrid>
                            )}

                            {(data.metrics.cyclingAvgPower || data.metrics.cyclingMaxPower || data.metrics.cyclingNormalizedPower) && (
                                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" mt="xs">
                                    <Paper withBorder p="xs" radius="sm">
                                        <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Cycling Avg Power</Text>
                                        <Text size="sm" fw={700}>{formatPower(data.metrics.cyclingAvgPower)}</Text>
                                    </Paper>
                                    <Paper withBorder p="xs" radius="sm">
                                        <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Cycling Max Power</Text>
                                        <Text size="sm" fw={700}>{formatPower(data.metrics.cyclingMaxPower)}</Text>
                                    </Paper>
                                    <Paper withBorder p="xs" radius="sm">
                                        <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Weighted Avg Power (WAP)</Text>
                                        <Text size="sm" fw={700}>{formatPower(data.metrics.cyclingNormalizedPower)}</Text>
                                    </Paper>
                                </SimpleGrid>
                            )}
                        </Paper>

                        <Paper withBorder p="sm" radius="sm">
                            <Group justify="space-between" align="center">
                                <Text size="sm" fw={600}>Zone View</Text>
                                <Select
                                    size="xs"
                                    w={210}
                                    value={zoneBreakdownMode}
                                    onChange={(value) => setZoneBreakdownMode((value as 'all' | 'sport') || 'all')}
                                    data={[
                                        { value: 'all', label: 'All activities (total)' },
                                        { value: 'sport', label: 'By activity type' }
                                    ]}
                                    allowDeselect={false}
                                />
                            </Group>
                            <Group mt={8} grow>
                                <Select
                                    size="xs"
                                    label="Running metric"
                                    value={runningZoneMetric}
                                    onChange={(value) => setRunningZoneMetric((value as 'hr' | 'pace') || 'hr')}
                                    data={[
                                        { value: 'hr', label: 'Heart rate' },
                                        { value: 'pace', label: 'Pace' }
                                    ]}
                                    allowDeselect={false}
                                />
                                <Select
                                    size="xs"
                                    label="Cycling metric"
                                    value={cyclingZoneMetric}
                                    onChange={(value) => setCyclingZoneMetric((value as 'power' | 'hr') || 'power')}
                                    data={[
                                        { value: 'power', label: 'Power' },
                                        { value: 'hr', label: 'Heart rate' }
                                    ]}
                                    allowDeselect={false}
                                />
                            </Group>
                        </Paper>

                        {zoneBreakdownMode === 'all' ? (
                            <>
                                {(data.zones.running.activityCount > 0 || Object.values(data.zones.running.zoneSecondsByMetric[runningZoneMetric]).some((v) => v > 0)) && (
                                    <Paper withBorder p="sm" radius="sm">
                                        <Text size="sm" fw={600} mb={6}>Running ({runningZoneMetric === 'hr' ? 'HR' : 'Pace'})</Text>
                                        {renderZoneBars(data.zones.running.zoneSecondsByMetric[runningZoneMetric], runningZoneMetric === 'hr' ? 5 : 7, runningZoneMetric)}
                                    </Paper>
                                )}

                                {(data.zones.cycling.activityCount > 0 || Object.values(data.zones.cycling.zoneSecondsByMetric[cyclingZoneMetric]).some((v) => v > 0)) && (
                                    <Paper withBorder p="sm" radius="sm">
                                        <Text size="sm" fw={600} mb={6}>Cycling ({cyclingZoneMetric === 'power' ? 'Power' : 'HR'})</Text>
                                        {renderZoneBars(data.zones.cycling.zoneSecondsByMetric[cyclingZoneMetric], cyclingZoneMetric === 'power' ? 7 : 5, cyclingZoneMetric)}
                                    </Paper>
                                )}
                            </>
                        ) : (
                            <Paper withBorder p="sm" radius="sm">
                                <Text size="sm" fw={600} mb={6}>Activity Type · Zone Breakdown</Text>
                                <Stack gap="sm">
                                    {(data.zones.running.activityCount > 0 || Object.values(data.zones.running.zoneSecondsByMetric[runningZoneMetric]).some((v) => v > 0)) && (
                                        <Paper withBorder p="xs" radius="sm">
                                            <Group justify="space-between" mb={6}>
                                                <Text size="sm" fw={500}>Running</Text>
                                                <Text size="xs" c="dimmed">{data.zones.running.activityCount} activities</Text>
                                            </Group>
                                            {renderZoneBars(data.zones.running.zoneSecondsByMetric[runningZoneMetric], runningZoneMetric === 'hr' ? 5 : 7, runningZoneMetric)}
                                        </Paper>
                                    )}

                                    {(data.zones.cycling.activityCount > 0 || Object.values(data.zones.cycling.zoneSecondsByMetric[cyclingZoneMetric]).some((v) => v > 0)) && (
                                        <Paper withBorder p="xs" radius="sm">
                                            <Group justify="space-between" mb={6}>
                                                <Text size="sm" fw={500}>Cycling</Text>
                                                <Text size="xs" c="dimmed">{data.zones.cycling.activityCount} activities</Text>
                                            </Group>
                                            {renderZoneBars(data.zones.cycling.zoneSecondsByMetric[cyclingZoneMetric], cyclingZoneMetric === 'power' ? 7 : 5, cyclingZoneMetric)}
                                        </Paper>
                                    )}

                                    {(data.zones.running.activityCount === 0
                                        && data.zones.cycling.activityCount === 0
                                        && !Object.values(data.zones.running.zoneSecondsByMetric.hr).some((v) => v > 0)
                                        && !Object.values(data.zones.running.zoneSecondsByMetric.pace).some((v) => v > 0)
                                        && !Object.values(data.zones.cycling.zoneSecondsByMetric.hr).some((v) => v > 0)
                                        && !Object.values(data.zones.cycling.zoneSecondsByMetric.power).some((v) => v > 0)) && (
                                        <Text size="sm" c="dimmed">No zone data available for this period.</Text>
                                    )}
                                </Stack>
                            </Paper>
                        )}

                    </Stack>
                )}
            </Modal>

            <Modal
                opened={Boolean(zoneExplainModal)}
                onClose={() => setZoneExplainModal(null)}
                title={zoneExplainModal?.title || 'Zone'}
                size="sm"
                centered
            >
                <Text size="sm">{zoneExplainModal?.description}</Text>
            </Modal>
        </>
    );
}

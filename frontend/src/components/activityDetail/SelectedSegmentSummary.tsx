import { Badge, Button, Group, Paper, Table, Text } from "@mantine/core";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
    accent: string;
};

interface SelectedSegmentSummaryProps {
    stats: any | null;
    me: any;
    supportsPaceSeries: boolean;
    onClear: () => void;
    formatElapsedFromMinutes: (value: unknown) => string;
    ui: UiTokens;
    t: (key: string) => string;
}

type SummaryRow = {
    metric: string;
    avg: string | null;
    max: string | null;
};

export const SelectedSegmentSummary = ({
    stats,
    me,
    supportsPaceSeries,
    onClear,
    formatElapsedFromMinutes,
    ui,
    t,
}: SelectedSegmentSummaryProps) => {
    if (!stats) return null;

    const isImperial = me?.profile?.preferred_units === 'imperial';
    const speedUnit = isImperial ? 'mph' : 'km/h';
    const paceUnit = isImperial ? '/mi' : '/km';

    const formatPace = (value: number | null | undefined) => {
        if (!value || !Number.isFinite(value)) return null;
        const minutes = Math.floor(value);
        const seconds = Math.round((value - minutes) * 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}${paceUnit}`;
    };

    const rows: SummaryRow[] = [
        stats.avgHr != null || stats.maxHr != null
            ? {
                metric: t('Heart Rate'),
                avg: stats.avgHr != null ? `${Math.round(stats.avgHr)} bpm` : null,
                max: stats.maxHr != null ? `${Math.round(stats.maxHr)} bpm` : null,
            }
            : null,
        stats.avgPower != null || stats.maxPower != null
            ? {
                metric: t('Power'),
                avg: stats.avgPower != null ? `${Math.round(stats.avgPower)} W` : null,
                max: stats.maxPower != null ? `${Math.round(stats.maxPower)} W` : null,
            }
            : null,
        supportsPaceSeries && (stats.avgPace != null || stats.minPace != null)
            ? {
                metric: t('Pace'),
                avg: formatPace(stats.avgPace),
                max: formatPace(stats.minPace),
            }
            : null,
        !supportsPaceSeries && (stats.avgSpeed != null || stats.maxSpeed != null)
            ? {
                metric: t('Speed'),
                avg: stats.avgSpeed != null ? `${stats.avgSpeed.toFixed(1)} ${speedUnit}` : null,
                max: stats.maxSpeed != null ? `${stats.maxSpeed.toFixed(1)} ${speedUnit}` : null,
            }
            : null,
        stats.avgGradient != null || stats.maxGradient != null
            ? {
                metric: t('Gradient'),
                avg: stats.avgGradient != null ? `${stats.avgGradient.toFixed(1)}%` : null,
                max: stats.maxGradient != null ? `${stats.maxGradient.toFixed(1)}%` : null,
            }
            : null,
    ].filter((row): row is SummaryRow => row !== null);

    return (
        <Paper withBorder p="sm" radius="md" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
            <Group justify="space-between" align="flex-start" mb="sm" wrap="wrap" gap="xs">
                <Group gap="xs" wrap="wrap">
                    <Text size="xs" fw={700} c={ui.textMain}>{t('Selected segment')}</Text>
                    {stats.durationMin != null && stats.durationMin > 0 && (
                        <Badge variant="light" color="orange">{t('Duration')}: {formatElapsedFromMinutes(stats.durationMin)}</Badge>
                    )}
                    {stats.wap != null && (
                        <Badge variant="light" color="orange">{t('WAP')}: {Math.round(stats.wap)} W</Badge>
                    )}
                    {stats.elevGain != null && stats.elevGain > 0 && (
                        <Badge variant="light" color="gray">{t('Elev Gain')}: {Math.round(stats.elevGain)} m</Badge>
                    )}
                </Group>
                <Button size="compact-xs" variant="subtle" c={ui.textDim} onClick={onClear}>{t('Clear')}</Button>
            </Group>

            <Table withTableBorder withColumnBorders highlightOnHover>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>{t('Metric')}</Table.Th>
                        <Table.Th>{t('Average')}</Table.Th>
                        <Table.Th>{t('Max / Best')}</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {rows.map((row) => (
                        <Table.Tr key={row.metric}>
                            <Table.Td>
                                <Text size="sm" fw={600} c={ui.textMain}>{row.metric}</Text>
                            </Table.Td>
                            <Table.Td>
                                <Text size="sm" c={ui.textMain}>{row.avg ?? '-'}</Text>
                            </Table.Td>
                            <Table.Td>
                                <Text size="sm" c={ui.textMain}>{row.max ?? '-'}</Text>
                            </Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Paper>
    );
};
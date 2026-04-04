import { Badge, Box, Group, Paper, Table, Text, Title } from "@mantine/core";
import { IconFlame, IconMinus } from "@tabler/icons-react";
import { formatDuration } from "./formatters";
import { HardEffort, HardEffortRest } from "../../types/activityDetail";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
};

interface HardEffortsPanelProps {
    hardEfforts: HardEffort[];
    hardEffortRests: HardEffortRest[];
    selectedEffortKey: string | null;
    onSelectEffort: (key: string) => void;
    isCyclingActivity: boolean;
    isRunningActivity: boolean;
    isDark: boolean;
    ui: UiTokens;
    t: (key: string) => string;
}

export const HardEffortsPanel = ({
    hardEfforts,
    hardEffortRests,
    selectedEffortKey,
    onSelectEffort,
    isCyclingActivity,
    isRunningActivity,
    isDark,
    ui,
    t,
}: HardEffortsPanelProps) => {
    return (
        <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
            <Group justify="space-between" mb="xs">
                <Title order={5} c={ui.textMain}>{t("Hard Efforts")}</Title>
            </Group>
            <Group gap="md" mb="md" wrap="wrap">
                <Group gap={4}><Badge size="xs" color="red" variant="filled">Sprint</Badge><Text size="xs" c="dimmed">{isCyclingActivity ? '≥200% FTP' : '≥200% threshold'}</Text></Group>
                <Group gap={4}><Badge size="xs" color="orange" variant="filled">Threshold+</Badge><Text size="xs" c="dimmed">{isCyclingActivity ? '≥100% FTP, ≥30s' : '≥100% threshold, ≥30s'}</Text></Group>
                <Group gap={4}><Badge size="xs" color="yellow" variant="filled">Near Threshold</Badge><Text size="xs" c="dimmed">{isCyclingActivity ? '≥85% FTP, ≥1min' : '≥85% threshold, ≥1min'}</Text></Group>
            </Group>
            <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <Table striped highlightOnHover withTableBorder withColumnBorders style={{ whiteSpace: 'nowrap' }}>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th></Table.Th>
                        <Table.Th>{t('Category')}</Table.Th>
                        <Table.Th>{t('Duration')}</Table.Th>
                        {isCyclingActivity && <Table.Th>{t('Avg Power')}</Table.Th>}
                        {isCyclingActivity && <Table.Th>% FTP</Table.Th>}
                        {isRunningActivity && <Table.Th>{t('Avg Pace')}</Table.Th>}
                        {isRunningActivity && <Table.Th>% Threshold</Table.Th>}
                        <Table.Th>{t('Heart Rate')}</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {hardEfforts.map((effort, idx) => {
                        const catColor = effort.category === 'sprint' ? 'red' : effort.category === 'threshold_plus' ? 'orange' : 'yellow';
                        const catLabel = effort.category === 'sprint' ? 'Sprint' : effort.category === 'threshold_plus' ? 'Threshold+' : 'Near Threshold';
                        const isSelected = selectedEffortKey === effort.key;
                        const paceDisplay = effort.avgSpeedKmh && effort.avgSpeedKmh > 0
                            ? (() => { const paceMinKm = 60 / effort.avgSpeedKmh; const mins = Math.floor(paceMinKm); const secs = Math.round((paceMinKm - mins) * 60); return `${mins}:${secs.toString().padStart(2, '0')} /km`; })()
                            : null;
                        const rest = idx < hardEffortRests.length ? hardEffortRests[idx] : null;
                        return [
                            <Table.Tr
                                key={effort.key}
                                style={{
                                    cursor: 'pointer',
                                    backgroundColor: isSelected ? (isDark ? 'rgba(233,90,18,0.16)' : 'rgba(233,90,18,0.10)') : undefined,
                                }}
                                onClick={() => onSelectEffort(effort.key)}
                            >
                                <Table.Td w={36} style={{ textAlign: 'center' }}>
                                    <IconFlame size={14} color={catColor === 'red' ? '#ef4444' : catColor === 'orange' ? '#f97316' : '#eab308'} />
                                </Table.Td>
                                <Table.Td><Badge size="sm" color={catColor} variant="light">{catLabel}</Badge></Table.Td>
                                <Table.Td fw={600}>{formatDuration(effort.durationSeconds)}</Table.Td>
                                {isCyclingActivity && <Table.Td>{effort.avgPower != null ? `${Math.round(effort.avgPower)} W` : '-'}</Table.Td>}
                                {isCyclingActivity && <Table.Td>{effort.pctRef != null ? `${Math.round(effort.pctRef)}%` : '-'}</Table.Td>}
                                {isRunningActivity && <Table.Td>{paceDisplay ?? '-'}</Table.Td>}
                                {isRunningActivity && <Table.Td>{effort.pctRef != null ? `${Math.round(effort.pctRef)}%` : '-'}</Table.Td>}
                                <Table.Td>{effort.avgHr != null ? `${Math.round(effort.avgHr)} bpm` : '-'}</Table.Td>
                            </Table.Tr>,
                            rest && rest.durationSeconds > 0 ? (
                                <Table.Tr key={`rest_${idx}`} style={{ opacity: 0.55 }}>
                                    <Table.Td style={{ textAlign: 'center' }}><IconMinus size={12} /></Table.Td>
                                    <Table.Td><Text size="xs" c="dimmed" fs="italic">Rest</Text></Table.Td>
                                    <Table.Td><Text size="xs" c="dimmed">{formatDuration(rest.durationSeconds)}</Text></Table.Td>
                                    {isCyclingActivity && <Table.Td><Text size="xs" c="dimmed">{rest.avgPower != null ? `${Math.round(rest.avgPower)} W` : '-'}</Text></Table.Td>}
                                    {isCyclingActivity && <Table.Td>-</Table.Td>}
                                    {isRunningActivity && <Table.Td><Text size="xs" c="dimmed">{rest.avgSpeedKmh && rest.avgSpeedKmh > 0 ? (() => { const p = 60 / rest.avgSpeedKmh!; const m = Math.floor(p); const s = Math.round((p - m) * 60); return `${m}:${s.toString().padStart(2, '0')} /km`; })() : '-'}</Text></Table.Td>}
                                    {isRunningActivity && <Table.Td>-</Table.Td>}
                                    <Table.Td><Text size="xs" c="dimmed">{rest.avgHr != null ? `${Math.round(rest.avgHr)} bpm` : '-'}</Text></Table.Td>
                                </Table.Tr>
                            ) : null,
                        ];
                    })}
                </Table.Tbody>
            </Table>
            </Box>
        </Paper>
    );
};

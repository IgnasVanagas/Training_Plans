import { Box, Button, Chip, Group, NumberInput, Paper, SegmentedControl, Table, Text, TextInput, Title } from "@mantine/core";
import { Dispatch, SetStateAction } from "react";
import { formatDuration } from "./formatters";
import { ActivityDetail } from "../../types/activityDetail";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
};

type SplitAnnotation = {
    rpe: number | null;
    lactate_mmol_l: number | null;
    note: string;
};

type VisibleSplitStats = {
    distance: boolean;
    duration: boolean;
    total_distance: boolean;
    total_time: boolean;
    pace_or_speed: boolean;
    avg_hr: boolean;
    max_hr: boolean;
    avg_gradient: boolean;
    max_gradient: boolean;
    avg_watts: boolean;
    max_watts: boolean;
    normalized_power: boolean;
};

type SaveAnnotationPayload = Array<{
    split_type: 'metric' | 'laps';
    split_index: number;
    rpe: number | null;
    lactate_mmol_l: number | null;
    note: string | null;
}>;

interface SplitsTableProps {
    activity: ActivityDetail;
    me: any;
    splitMode: 'metric' | 'laps';
    setSplitMode: (mode: 'metric' | 'laps') => void;
    visibleSplitStats: VisibleSplitStats;
    setVisibleSplitStats: Dispatch<SetStateAction<VisibleSplitStats>>;
    splitsWithCumulativeTotals: any[];
    splitAnnotations: Record<number, SplitAnnotation>;
    setSplitAnnotations: Dispatch<SetStateAction<Record<number, SplitAnnotation>>>;
    splitAnnotationsVisible: boolean;
    setSplitAnnotationsVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
    splitAnnotationsDirty: boolean;
    setSplitAnnotationsDirty: (v: boolean) => void;
    onSaveAnnotations: (payload: SaveAnnotationPayload) => void;
    isSaving: boolean;
    formatPace: (speed: number) => string;
    isRunningActivity: boolean;
    isCyclingActivity: boolean;
    ui: UiTokens;
    t: (key: string) => string;
}

export const SplitsTable = ({
    activity,
    me,
    splitMode,
    setSplitMode,
    visibleSplitStats,
    setVisibleSplitStats,
    splitsWithCumulativeTotals,
    splitAnnotations,
    setSplitAnnotations,
    splitAnnotationsVisible,
    setSplitAnnotationsVisible,
    splitAnnotationsDirty,
    setSplitAnnotationsDirty,
    onSaveAnnotations,
    isSaving,
    formatPace,
    isRunningActivity,
    isCyclingActivity,
    ui,
    t,
}: SplitsTableProps) => {
    return (
        <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
            <Group justify="space-between" mb="md">
                <Title order={5} c={ui.textMain}>{t("Splits")}</Title>
                <Group>
                    <SegmentedControl
                        radius="md"
                        value={splitMode}
                        onChange={(v: any) => setSplitMode(v)}
                        data={[
                            { label: isRunningActivity ? '1 km' : 'Auto', value: 'metric', disabled: !activity.splits_metric?.length },
                            { label: isCyclingActivity ? 'Manual' : 'Laps', value: 'laps', disabled: !activity.laps?.length },
                        ]}
                    />
                    <Button size="xs" variant={splitAnnotationsVisible ? "filled" : "light"} onClick={() => setSplitAnnotationsVisible((v) => !v)}>
                        {splitAnnotationsVisible ? t("Hide Annotations") : t("Annotate")}
                    </Button>
                </Group>
            </Group>
            <Group gap="xs" mb="sm" wrap="wrap">
                <Text size="xs" c={ui.textDim} fw={700}>{t("Visible stats")}:</Text>
                <Chip size="xs" checked={visibleSplitStats.distance} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, distance: checked }))} variant="light">{t("Distance")}</Chip>
                <Chip size="xs" checked={visibleSplitStats.duration} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, duration: checked }))} variant="light">{t("Time")}</Chip>
                <Chip size="xs" checked={visibleSplitStats.total_distance} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, total_distance: checked }))} variant="light">{t("Total distance")}</Chip>
                <Chip size="xs" checked={visibleSplitStats.total_time} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, total_time: checked }))} variant="light">{t("Total time")}</Chip>
                <Chip size="xs" checked={visibleSplitStats.pace_or_speed} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, pace_or_speed: checked }))} variant="light">{isRunningActivity ? t('Pace') : t('Speed')}</Chip>
                <Chip size="xs" checked={visibleSplitStats.avg_hr} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, avg_hr: checked }))} variant="light">{t("Avg HR")}</Chip>
                <Chip size="xs" checked={visibleSplitStats.max_hr} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, max_hr: checked }))} variant="light">{t("Max HR")}</Chip>
                <Chip size="xs" checked={visibleSplitStats.avg_gradient} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, avg_gradient: checked }))} variant="light">{t("Avg Gradient")}</Chip>
                <Chip size="xs" checked={visibleSplitStats.max_gradient} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, max_gradient: checked }))} variant="light">{t("Max Gradient")}</Chip>
                {isCyclingActivity && (
                    <>
                        <Chip size="xs" checked={visibleSplitStats.avg_watts} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, avg_watts: checked }))} variant="light">{t("Avg W")}</Chip>
                        <Chip size="xs" checked={visibleSplitStats.max_watts} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, max_watts: checked }))} variant="light">{t("Max W")}</Chip>
                        <Chip size="xs" checked={visibleSplitStats.normalized_power} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, normalized_power: checked }))} variant="light">NP</Chip>
                    </>
                )}
            </Group>
            <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <Table style={{ whiteSpace: 'nowrap' }}>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>{t("Split")}</Table.Th>
                        {visibleSplitStats.distance && <Table.Th>{t("Distance")}</Table.Th>}
                        {visibleSplitStats.duration && <Table.Th>{t("Time")}</Table.Th>}
                        {visibleSplitStats.total_distance && <Table.Th>{t("Total distance")}</Table.Th>}
                        {visibleSplitStats.total_time && <Table.Th>{t("Total time")}</Table.Th>}
                        {visibleSplitStats.pace_or_speed && <Table.Th>{isRunningActivity ? t('Pace') : t('Avg Speed')}</Table.Th>}
                        {visibleSplitStats.avg_hr && <Table.Th>{t("Avg HR")}</Table.Th>}
                        {visibleSplitStats.max_hr && <Table.Th>{t("Max HR")}</Table.Th>}
                        {visibleSplitStats.avg_gradient && <Table.Th>{t("Avg Gradient")}</Table.Th>}
                        {visibleSplitStats.max_gradient && <Table.Th>{t("Max Gradient")}</Table.Th>}
                        {isCyclingActivity && visibleSplitStats.avg_watts && <Table.Th>{t("Avg W")}</Table.Th>}
                        {isCyclingActivity && visibleSplitStats.max_watts && <Table.Th>{t("Max W")}</Table.Th>}
                        {isCyclingActivity && visibleSplitStats.normalized_power && <Table.Th>NP</Table.Th>}
                        {splitAnnotationsVisible && <Table.Th>RPE</Table.Th>}
                        {splitAnnotationsVisible && <Table.Th>{t("Lactate")}</Table.Th>}
                        {splitAnnotationsVisible && <Table.Th>{t("Note")}</Table.Th>}
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {splitsWithCumulativeTotals.map((split: any, idx: number) => (
                        <Table.Tr key={split.split}>
                            <Table.Td>{split.split}</Table.Td>
                            {visibleSplitStats.distance && (
                                <Table.Td>
                                    {me?.profile?.preferred_units === 'imperial'
                                        ? `${((split.distance || 0) * 0.000621371).toFixed(2)} mi`
                                        : `${((split.distance || 0) / 1000).toFixed(2)} km`}
                                </Table.Td>
                            )}
                            {visibleSplitStats.duration && <Table.Td>{formatDuration(split.duration, true)}</Table.Td>}
                            {visibleSplitStats.total_distance && (
                                <Table.Td>
                                    {me?.profile?.preferred_units === 'imperial'
                                        ? `${((split.cumulative_distance || 0) * 0.000621371).toFixed(2)} mi`
                                        : `${((split.cumulative_distance || 0) / 1000).toFixed(2)} km`}
                                </Table.Td>
                            )}
                            {visibleSplitStats.total_time && <Table.Td>{formatDuration(split.cumulative_duration, true)}</Table.Td>}
                            {visibleSplitStats.pace_or_speed && (
                                <Table.Td>
                                    {isRunningActivity
                                        ? (split.avg_speed
                                            ? (me?.profile?.preferred_units === 'imperial'
                                                ? (() => { const pace = 1609.34 / (split.avg_speed * 60); const m = Math.floor(pace); const s = Math.floor((pace - m) * 60); return `${m}:${s.toString().padStart(2, '0')}/mi`; })()
                                                : formatPace(split.avg_speed))
                                            : '-')
                                        : (split.avg_speed
                                            ? (me?.profile?.preferred_units === 'imperial'
                                                ? `${(split.avg_speed * 2.23694).toFixed(1)} mph`
                                                : `${(split.avg_speed * 3.6).toFixed(1)} km/h`)
                                            : '-')}
                                </Table.Td>
                            )}
                            {visibleSplitStats.avg_hr && <Table.Td>{split.avg_hr?.toFixed(0) || '-'}</Table.Td>}
                            {visibleSplitStats.max_hr && <Table.Td>{split.max_hr?.toFixed(0) || '-'}</Table.Td>}
                            {visibleSplitStats.avg_gradient && <Table.Td>{Number.isFinite(Number(split.avg_gradient)) ? `${Number(split.avg_gradient).toFixed(1)}%` : '-'}</Table.Td>}
                            {visibleSplitStats.max_gradient && <Table.Td>{Number.isFinite(Number(split.max_gradient)) ? `${Number(split.max_gradient).toFixed(1)}%` : '-'}</Table.Td>}
                            {isCyclingActivity && visibleSplitStats.avg_watts && <Table.Td>{split.avg_watts ? `${split.avg_watts.toFixed(0)} W` : '-'}</Table.Td>}
                            {isCyclingActivity && visibleSplitStats.max_watts && <Table.Td>{split.max_watts ? `${split.max_watts.toFixed(0)} W` : '-'}</Table.Td>}
                            {isCyclingActivity && visibleSplitStats.normalized_power && <Table.Td>{split.normalized_power ? `${split.normalized_power.toFixed(0)} W` : '-'}</Table.Td>}
                            {splitAnnotationsVisible && (
                                <Table.Td>
                                    <NumberInput size="xs" w={60} min={1} max={10} allowDecimal={false}
                                        value={splitAnnotations[idx]?.rpe ?? ''}
                                        onChange={(value) => { setSplitAnnotationsDirty(true); setSplitAnnotations((prev) => ({ ...prev, [idx]: { rpe: typeof value === 'number' ? value : null, lactate_mmol_l: prev[idx]?.lactate_mmol_l ?? null, note: prev[idx]?.note ?? '' } })); }}
                                    />
                                </Table.Td>
                            )}
                            {splitAnnotationsVisible && (
                                <Table.Td>
                                    <NumberInput size="xs" w={70} min={0} max={40} decimalScale={1}
                                        value={splitAnnotations[idx]?.lactate_mmol_l ?? ''}
                                        onChange={(value) => { setSplitAnnotationsDirty(true); setSplitAnnotations((prev) => ({ ...prev, [idx]: { rpe: prev[idx]?.rpe ?? null, lactate_mmol_l: typeof value === 'number' ? value : null, note: prev[idx]?.note ?? '' } })); }}
                                    />
                                </Table.Td>
                            )}
                            {splitAnnotationsVisible && (
                                <Table.Td>
                                    <TextInput size="xs" w={120} maxLength={220}
                                        value={splitAnnotations[idx]?.note ?? ''}
                                        onChange={(e) => { setSplitAnnotationsDirty(true); setSplitAnnotations((prev) => ({ ...prev, [idx]: { rpe: prev[idx]?.rpe ?? null, lactate_mmol_l: prev[idx]?.lactate_mmol_l ?? null, note: e.currentTarget.value } })); }}
                                    />
                                </Table.Td>
                            )}
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
            </Box>
            {splitAnnotationsVisible && splitAnnotationsDirty && (
                <Group justify="flex-end" mt="xs">
                    <Button size="xs" loading={isSaving}
                        onClick={() => {
                            const splitType = splitMode === 'metric' ? 'metric' : 'laps';
                            const payload = Object.entries(splitAnnotations).map(([index, value]) => ({
                                split_type: splitType as 'metric' | 'laps',
                                split_index: Number(index),
                                rpe: value.rpe,
                                lactate_mmol_l: value.lactate_mmol_l,
                                note: value.note?.trim() ? value.note.trim() : null,
                            }));
                            onSaveAnnotations(payload);
                        }}
                    >
                        {t("Save Annotations")}
                    </Button>
                </Group>
            )}
        </Paper>
    );
};

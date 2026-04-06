import { Box, Button, Chip, Group, NumberInput, Paper, SegmentedControl, Table, Text, TextInput, Title } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { calculateNormalizedPower, formatDuration, toTimestampMs } from "./formatters";
import { ActivityDetail } from "../../types/activityDetail";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
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
    streamPoints: any[];
    isDesktopViewport: boolean;
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
    streamPoints,
    isDesktopViewport,
    onSaveAnnotations,
    isSaving,
    formatPace,
    isRunningActivity,
    isCyclingActivity,
    ui,
    t,
}: SplitsTableProps) => {
    const [splitMode, setSplitMode] = useState<'metric' | 'laps'>('metric');
    const [splitAnnotationsVisible, setSplitAnnotationsVisible] = useState(false);
    const [splitAnnotationsDirty, setSplitAnnotationsDirty] = useState(false);
    const [splitAnnotations, setSplitAnnotations] = useState<Record<number, { rpe: number | null; lactate_mmol_l: number | null; note: string }>>({});
    const [visibleSplitStats, setVisibleSplitStats] = useState({
        distance: true,
        duration: true,
        total_distance: isDesktopViewport,
        total_time: isDesktopViewport,
        pace_or_speed: true,
        avg_hr: true,
        max_hr: true,
        avg_watts: true,
        max_watts: true,
        normalized_power: true,
        avg_gradient: true,
        max_gradient: true,
    });

    // Auto-select split mode based on activity type
    useEffect(() => {
        if (!activity) return;
        const sportName = (activity.sport || '').toLowerCase();
        const isCycling = sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride') || sportName.includes('virtualride');
        const hasMetricSplits = Boolean(activity.splits_metric?.length);
        const hasLapSplits = Boolean(activity.laps?.length);
        if ((isCycling || !hasMetricSplits) && hasLapSplits) {
            setSplitMode('laps');
        } else {
            setSplitMode('metric');
        }
    }, [activity]);

    // Expand visible stats for desktop
    useEffect(() => {
        if (!isDesktopViewport) return;
        setVisibleSplitStats(prev => ({
            ...prev,
            total_distance: true,
            total_time: true,
        }));
    }, [isDesktopViewport]);

    const splitsToDisplay = useMemo(() => {
        if (!activity) return [];
        if (splitMode === 'metric') return activity.splits_metric || [];
        return (activity.laps || []).filter((l: any) => l.distance > 0);
    }, [activity, splitMode]);

    const splitsToDisplayWithPower = useMemo(() => {
        if (!activity) return [];
        const sportName = (activity.sport || '').toLowerCase();
        const isCyclingLike = sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride') || sportName.includes('virtualride');
        let cumulativeDistance = 0;

        return splitsToDisplay.map((split: any, index: number) => {
            const splitDistance = Number(split?.distance || 0);
            const startDistance = cumulativeDistance;
            const endDistance = cumulativeDistance + splitDistance;
            cumulativeDistance = endDistance;

            let segmentPoints: any[] = [];
            const startTime = toTimestampMs(split?.start_time);
            const durationSeconds = Number(split?.duration || 0);

            if (Number.isFinite(startTime) && durationSeconds > 0) {
                const endTime = startTime + durationSeconds * 1000;
                segmentPoints = streamPoints.filter((point: any) => {
                    const ts = toTimestampMs(point?.timestamp);
                    return Number.isFinite(ts) && ts >= startTime && ts < endTime;
                });
            }

            if (!segmentPoints.length && splitDistance > 0) {
                segmentPoints = streamPoints.filter((point: any) => {
                    const distance = Number(point?.distance);
                    if (!Number.isFinite(distance)) return false;
                    if (index === splitsToDisplay.length - 1) return distance >= startDistance && distance <= endDistance;
                    return distance >= startDistance && distance < endDistance;
                });
            }

            const allPowerSamples = segmentPoints
                .map((point: any) => Number(point?.power ?? -1))
                .filter((value: number) => Number.isFinite(value) && value >= 0);
            const positivePowerSamples = allPowerSamples.filter((v) => v > 0);

            const avgFromSegment = positivePowerSamples.length
                ? positivePowerSamples.reduce((sum: number, v: number) => sum + v, 0) / positivePowerSamples.length
                : null;
            const avgFromSplit = Number(split?.avg_power);
            const avgWatts = Number.isFinite(avgFromSplit) && avgFromSplit > 0 ? avgFromSplit : avgFromSegment;
            const maxWatts = positivePowerSamples.length ? Math.max(...positivePowerSamples) : null;
            let normalizedPower = calculateNormalizedPower(allPowerSamples);
            if (normalizedPower != null && avgWatts != null && normalizedPower < avgWatts) normalizedPower = avgWatts;

            const gradients: number[] = [];
            for (let i = 1; i < segmentPoints.length; i++) {
                const prev = segmentPoints[i - 1], curr = segmentPoints[i];
                const pd = Number(prev?.distance), cd = Number(curr?.distance);
                const pa = Number(prev?.altitude), ca = Number(curr?.altitude);
                if (Number.isFinite(pd) && Number.isFinite(cd) && Number.isFinite(pa) && Number.isFinite(ca) && cd - pd >= 2) {
                    const g = ((ca - pa) / (cd - pd)) * 100;
                    if (Number.isFinite(g)) gradients.push(Math.max(-35, Math.min(35, g)));
                }
            }
            const avgGradient = gradients.length ? gradients.reduce((s, v) => s + v, 0) / gradients.length : null;
            const maxGradient = gradients.length ? Math.max(...gradients) : null;

            return {
                ...split,
                avg_watts: isCyclingLike ? avgWatts : split?.avg_watts,
                max_watts: isCyclingLike ? maxWatts : split?.max_watts,
                normalized_power: isCyclingLike ? normalizedPower : split?.normalized_power,
                avg_gradient: Number.isFinite(Number(split?.avg_gradient)) ? Number(split.avg_gradient) : avgGradient,
                max_gradient: Number.isFinite(Number(split?.max_gradient)) ? Number(split.max_gradient) : maxGradient,
            };
        });
    }, [activity, splitsToDisplay, streamPoints]);

    const splitsWithCumulativeTotals = useMemo(() => {
        let cumDist = 0, cumDur = 0;
        return splitsToDisplayWithPower.map((split: any) => {
            cumDist += Number.isFinite(Number(split?.distance)) ? Number(split.distance) : 0;
            cumDur += Number.isFinite(Number(split?.duration)) ? Number(split.duration) : 0;
            return { ...split, cumulative_distance: cumDist, cumulative_duration: cumDur };
        });
    }, [splitsToDisplayWithPower]);

    // Initialise annotations from activity data whenever activity/splitMode changes
    useEffect(() => {
        const initial: Record<number, { rpe: number | null; lactate_mmol_l: number | null; note: string }> = {};
        splitsToDisplayWithPower.forEach((split: any, idx: number) => {
            initial[idx] = {
                rpe: typeof split?.rpe === 'number' ? split.rpe : null,
                lactate_mmol_l: typeof split?.lactate_mmol_l === 'number' ? split.lactate_mmol_l : null,
                note: typeof split?.note === 'string' ? split.note : '',
            };
        });
        setSplitAnnotations(initial);
    }, [activity?.id, splitMode, splitsToDisplayWithPower.length]);

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

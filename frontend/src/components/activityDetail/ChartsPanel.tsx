import { Box, Button, Chip, Group, Paper, RangeSlider, SegmentedControl, Select, Stack, Switch, Text } from "@mantine/core";
import { IconActivity } from "@tabler/icons-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dispatch, MutableRefObject, SetStateAction } from "react";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
    accent: string;
};

type VisibleSeries = {
    heart_rate: boolean;
    power: boolean;
    pace: boolean;
    speed: boolean;
    cadence: boolean;
    altitude: boolean;
};

interface ChartsPanelProps {
    me: any;
    visibleSeries: VisibleSeries;
    setVisibleSeries: Dispatch<SetStateAction<VisibleSeries>>;
    powerChartMode: 'raw' | 'avg5s';
    setPowerChartMode: (m: 'raw' | 'avg5s') => void;
    focusMode: boolean;
    setFocusMode: (v: boolean) => void;
    focusObjective: 'pacing' | 'cardio' | 'efficiency';
    setFocusObjective: (v: 'pacing' | 'cardio' | 'efficiency') => void;
    focusSeries: VisibleSeries;
    supportsPaceSeries: boolean;
    supportsSpeedSeries: boolean;
    chartDataLength: number;
    chartRenderData: any[];
    chartRange: [number, number];
    setChartRange: (r: [number, number]) => void;
    rangeLabel: [string, string];
    chartSelection: { startIdx: number; endIdx: number } | null;
    setChartSelection: (sel: { startIdx: number; endIdx: number } | null) => void;
    chartSelectionStats: any | null;
    isDraggingChartRef: MutableRefObject<boolean>;
    dragStartIdxRef: MutableRefObject<number | null>;
    hoveredPointIndexRef: MutableRefObject<number | null>;
    onMouseMove: (state: any) => void;
    onMouseLeave: () => void;
    sharedTooltipProps: object;
    formatElapsedFromMinutes: (value: unknown) => string;
    isDark: boolean;
    ui: UiTokens;
    t: (key: string) => string;
}

export const ChartsPanel = ({
    me,
    visibleSeries,
    setVisibleSeries,
    powerChartMode,
    setPowerChartMode,
    focusMode,
    setFocusMode,
    focusObjective,
    setFocusObjective,
    focusSeries,
    supportsPaceSeries,
    supportsSpeedSeries,
    chartDataLength,
    chartRenderData,
    chartRange,
    setChartRange,
    rangeLabel,
    chartSelection,
    setChartSelection,
    chartSelectionStats,
    isDraggingChartRef,
    dragStartIdxRef,
    hoveredPointIndexRef,
    onMouseMove,
    onMouseLeave,
    sharedTooltipProps,
    formatElapsedFromMinutes,
    isDark,
    ui,
    t,
}: ChartsPanelProps) => {
    return (
        <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
            <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
                <Group gap="xs" wrap="wrap">
                    <Text size="xs" fw={700} c={ui.textDim}>Show:</Text>
                    <Chip size="xs" checked={visibleSeries.heart_rate} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, heart_rate: checked }))} variant="light">Heart Rate</Chip>
                    {supportsPaceSeries && <Chip size="xs" checked={visibleSeries.pace} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, pace: checked }))} variant="light">Pace</Chip>}
                    {supportsSpeedSeries && <Chip size="xs" checked={visibleSeries.speed} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, speed: checked }))} variant="light">Speed</Chip>}
                    <Chip size="xs" checked={visibleSeries.power} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, power: checked }))} variant="light">Power</Chip>
                    <Chip size="xs" checked={visibleSeries.cadence} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, cadence: checked }))} variant="light">Cadence</Chip>
                    <Chip size="xs" checked={visibleSeries.altitude} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, altitude: checked }))} variant="light">Altitude</Chip>
                </Group>
                <Group gap="xs">
                    <SegmentedControl
                        size="xs"
                        value={powerChartMode}
                        onChange={(v) => setPowerChartMode(v as 'raw' | 'avg5s')}
                        data={[
                            { label: 'Power', value: 'raw' },
                            { label: '5s Power avg', value: 'avg5s' },
                        ]}
                    />
                    {focusMode && (
                        <Select
                            size="xs"
                            value={focusObjective}
                            onChange={(v) => v && setFocusObjective(v as typeof focusObjective)}
                            data={[
                                { value: 'pacing', label: 'Pacing' },
                                { value: 'cardio', label: 'Cardio' },
                                { value: 'efficiency', label: 'Efficiency' },
                            ]}
                            w={120}
                        />
                    )}
                    <Switch
                        size="xs"
                        label="Focus mode"
                        checked={focusMode}
                        onChange={(e) => setFocusMode(e.currentTarget.checked)}
                    />
                </Group>
            </Group>
            {chartDataLength > 0 ? (
                <Stack gap="xs">
                    <Box
                        h={360}
                        style={{ cursor: 'crosshair', userSelect: 'none' }}
                        onMouseDown={() => {
                            isDraggingChartRef.current = true;
                            dragStartIdxRef.current = hoveredPointIndexRef.current;
                            setChartSelection(null);
                        }}
                        onMouseUp={() => { isDraggingChartRef.current = false; dragStartIdxRef.current = null; }}
                        onMouseLeave={() => { isDraggingChartRef.current = false; dragStartIdxRef.current = null; }}
                    >
                        <ResponsiveContainer>
                            <LineChart data={chartRenderData} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ui.border} />
                                <XAxis dataKey="time_min" hide />
                                <YAxis yAxisId="hr" hide domain={['auto', 'auto']} />
                                <YAxis yAxisId="power" hide domain={[0, 'auto']} />
                                <YAxis yAxisId="pace" hide reversed domain={['auto', 'auto']} />
                                <YAxis yAxisId="speed" hide domain={[0, 'auto']} />
                                <YAxis yAxisId="cadence" hide domain={[0, 'auto']} />
                                <YAxis yAxisId="altitude" hide domain={['auto', 'auto']} />
                                <Tooltip
                                    {...sharedTooltipProps}
                                    content={({ active, payload }: any) => {
                                        if (isDraggingChartRef.current) return null;
                                        const point = active && payload?.[0]?.payload ? payload[0].payload : null;
                                        if (!point) return null;
                                        const speedUnit = me?.profile?.preferred_units === 'imperial' ? 'mph' : 'km/h';
                                        const paceValue = Number(point.pace);
                                        const paceText = Number.isFinite(paceValue)
                                            ? `${Math.floor(paceValue)}:${Math.floor((paceValue - Math.floor(paceValue)) * 60).toString().padStart(2, '0')}${me?.profile?.preferred_units === 'imperial' ? '/mi' : '/km'}`
                                            : '-';
                                        const powerValue = powerChartMode === 'avg5s' ? Number(point.power_5s) : Number(point.power_raw);
                                        return (
                                            <Paper withBorder p={6} radius="sm" bg={ui.surfaceAlt}>
                                                <Text size="xs" c={ui.textDim} fw={600} mb={4}>Time: {formatElapsedFromMinutes(point.time_min)}</Text>
                                                {focusSeries.heart_rate && <Text size="xs" c={ui.textMain}>HR: {Number.isFinite(Number(point.heart_rate)) ? `${Math.round(Number(point.heart_rate))} bpm` : '-'}</Text>}
                                                {focusSeries.power && <Text size="xs" c={ui.textMain}>Power: {Number.isFinite(powerValue) ? `${Math.round(powerValue)} W` : '-'}</Text>}
                                                {focusSeries.pace && <Text size="xs" c={ui.textMain}>Pace: {paceText}</Text>}
                                                {focusSeries.speed && <Text size="xs" c={ui.textMain}>Speed: {Number.isFinite(Number(point.speed_display)) ? `${Number(point.speed_display).toFixed(1)} ${speedUnit}` : '-'}</Text>}
                                                {focusSeries.cadence && <Text size="xs" c={ui.textMain}>Cadence: {Number.isFinite(Number(point.cadence)) ? `${Math.round(Number(point.cadence))} rpm` : '-'}</Text>}
                                                {focusSeries.altitude && <Text size="xs" c={ui.textMain}>Elev: {Number.isFinite(Number(point.altitude)) ? `${Math.round(Number(point.altitude))} m` : '-'}</Text>}
                                            </Paper>
                                        );
                                    }}
                                />
                                {focusSeries.heart_rate && <Line yAxisId="hr" type="monotone" dataKey="heart_rate" stroke="#fa5252" strokeWidth={1.5} dot={false} name="HR" isAnimationActive={false} connectNulls />}
                                {focusSeries.power && <Line yAxisId="power" type="monotone" dataKey={powerChartMode === 'avg5s' ? 'power_5s' : 'power_raw'} stroke="#fd7e14" strokeWidth={1.5} dot={false} name="Power" isAnimationActive={false} connectNulls />}
                                {focusSeries.pace && <Line yAxisId="pace" type="monotone" dataKey="pace" stroke="#228be6" strokeWidth={1.5} dot={false} name="Pace" isAnimationActive={false} connectNulls={false} />}
                                {focusSeries.speed && <Line yAxisId="speed" type="monotone" dataKey="speed_display" stroke="#12b886" strokeWidth={1.4} dot={false} name="Speed" isAnimationActive={false} connectNulls />}
                                {focusSeries.cadence && <Line yAxisId="cadence" type="monotone" dataKey="cadence" stroke="#40c057" strokeWidth={1.2} dot={false} name="Cadence" isAnimationActive={false} connectNulls />}
                                {focusSeries.altitude && <Line yAxisId="altitude" type="monotone" dataKey="altitude" stroke="#868e96" strokeWidth={1.2} dot={false} name="Altitude" isAnimationActive={false} connectNulls />}
                                {chartSelection && chartRenderData[chartSelection.startIdx] && chartRenderData[chartSelection.endIdx] && (
                                    <ReferenceArea
                                        yAxisId="hr"
                                        x1={chartRenderData[chartSelection.startIdx].time_min}
                                        x2={chartRenderData[chartSelection.endIdx].time_min}
                                        fill={ui.accent}
                                        fillOpacity={0.13}
                                        stroke={ui.accent}
                                        strokeOpacity={0.5}
                                        strokeWidth={1}
                                    />
                                )}
                            </LineChart>
                        </ResponsiveContainer>
                    </Box>
                    {chartSelectionStats && (() => {
                        const s = chartSelectionStats;
                        const isImperial = me?.profile?.preferred_units === 'imperial';
                        const paceUnit = isImperial ? '/mi' : '/km';
                        const speedUnit = isImperial ? 'mph' : 'km/h';
                        const fmtPace = (v: number | null) => {
                            if (!v || !Number.isFinite(v)) return null;
                            const m = Math.floor(v); const sec = Math.round((v - m) * 60);
                            return `${m}:${sec.toString().padStart(2, '0')}${paceUnit}`;
                        };
                        return (
                            <Paper withBorder px="md" py="xs" radius="md" bg={isDark ? 'rgba(233,90,18,0.08)' : 'rgba(233,90,18,0.06)'} style={{ borderColor: 'rgba(233,90,18,0.3)' }}>
                                <Group justify="space-between" mb={6}>
                                    <Text size="xs" fw={700} c={ui.accent}>Selection — {formatElapsedFromMinutes(s.durationMin)}</Text>
                                    <Button size="compact-xs" variant="subtle" c={ui.textDim} onClick={() => setChartSelection(null)}>Clear</Button>
                                </Group>
                                <Group gap="xl" wrap="wrap">
                                    {s.avgPower != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>Avg Power</Text><Text size="sm" fw={600} c={ui.textMain}>{Math.round(s.avgPower)} W</Text></Stack>}
                                    {s.wap != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>WAP</Text><Text size="sm" fw={600} c={ui.textMain}>{Math.round(s.wap)} W</Text></Stack>}
                                    {s.maxPower != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>Max Power</Text><Text size="sm" fw={600} c={ui.textMain}>{Math.round(s.maxPower)} W</Text></Stack>}
                                    {s.avgHr != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>Avg HR</Text><Text size="sm" fw={600} c={ui.textMain}>{Math.round(s.avgHr)} bpm</Text></Stack>}
                                    {s.maxHr != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>Max HR</Text><Text size="sm" fw={600} c={ui.textMain}>{Math.round(s.maxHr)} bpm</Text></Stack>}
                                    {visibleSeries.pace && s.avgPace != null && fmtPace(s.avgPace) && <Stack gap={0}><Text size="xs" c={ui.textDim}>Avg Pace</Text><Text size="sm" fw={600} c={ui.textMain}>{fmtPace(s.avgPace)}</Text></Stack>}
                                    {visibleSeries.speed && s.avgSpeed != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>Avg Speed</Text><Text size="sm" fw={600} c={ui.textMain}>{s.avgSpeed.toFixed(1)} {speedUnit}</Text></Stack>}
                                    {visibleSeries.cadence && s.avgCadence != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>Avg Cadence</Text><Text size="sm" fw={600} c={ui.textMain}>{Math.round(s.avgCadence)} rpm</Text></Stack>}
                                    {visibleSeries.altitude && s.elevGain != null && s.elevGain > 0 && <Stack gap={0}><Text size="xs" c={ui.textDim}>Elev Gain</Text><Text size="sm" fw={600} c={ui.textMain}>{Math.round(s.elevGain)} m</Text></Stack>}
                                    {visibleSeries.altitude && s.avgGradient != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>{t('Avg Gradient')}</Text><Text size="sm" fw={600} c={ui.textMain}>{s.avgGradient.toFixed(1)}%</Text></Stack>}
                                    {visibleSeries.altitude && s.maxGradient != null && <Stack gap={0}><Text size="xs" c={ui.textDim}>{t('Max Gradient')}</Text><Text size="sm" fw={600} c={ui.textMain}>{s.maxGradient.toFixed(1)}%</Text></Stack>}
                                </Group>
                            </Paper>
                        );
                    })()}
                    <Box px="xs">
                        <Group justify="space-between" mb={4}>
                            <Text size="xs" c={ui.textDim}>{rangeLabel[0]}</Text>
                            <Text size="xs" c={ui.textDim}>{rangeLabel[1]}</Text>
                        </Group>
                        <RangeSlider
                            min={0}
                            max={100}
                            step={0.5}
                            value={chartRange}
                            onChange={setChartRange}
                            size="sm"
                            thumbSize={16}
                            minRange={1}
                            label={null}
                            styles={{ thumb: { borderWidth: 2 }, track: { height: 6 } }}
                        />
                    </Box>
                </Stack>
            ) : (
                <Stack align="center" justify="center" h={200}>
                    <IconActivity size={40} color="gray" />
                    <Text c={ui.textDim}>No stream data available for this activity</Text>
                </Stack>
            )}
        </Paper>
    );
};

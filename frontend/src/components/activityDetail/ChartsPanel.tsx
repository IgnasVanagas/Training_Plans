import { Box, Chip, Group, Paper, RangeSlider, SegmentedControl, Select, Stack, Switch, Text } from "@mantine/core";
import { IconActivity } from "@tabler/icons-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dispatch, MutableRefObject, SetStateAction } from "react";
import { SelectedSegmentSummary } from "./SelectedSegmentSummary";

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
                    <Text size="xs" fw={700} c={ui.textDim}>{t("Show")}</Text>
                    <Chip size="xs" checked={visibleSeries.heart_rate} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, heart_rate: checked }))} variant="light">{t("Heart Rate")}</Chip>
                    {supportsPaceSeries && <Chip size="xs" checked={visibleSeries.pace} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, pace: checked }))} variant="light">{t("Pace")}</Chip>}
                    {supportsSpeedSeries && <Chip size="xs" checked={visibleSeries.speed} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, speed: checked }))} variant="light">{t("Speed")}</Chip>}
                    <Chip size="xs" checked={visibleSeries.power} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, power: checked }))} variant="light">{t("Power")}</Chip>
                    <Chip size="xs" checked={visibleSeries.cadence} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, cadence: checked }))} variant="light">{t("Cadence")}</Chip>
                    <Chip size="xs" checked={visibleSeries.altitude} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, altitude: checked }))} variant="light">{t("Altitude")}</Chip>
                </Group>
                <Group gap="xs">
                    <SegmentedControl
                        size="xs"
                        value={powerChartMode}
                        onChange={(v) => setPowerChartMode(v as 'raw' | 'avg5s')}
                        data={[
                            { label: t('Power'), value: 'raw' },
                            { label: t('5s Power avg'), value: 'avg5s' },
                        ]}
                    />
                    {focusMode && (
                        <Select
                            size="xs"
                            value={focusObjective}
                            onChange={(v) => v && setFocusObjective(v as typeof focusObjective)}
                            data={[
                                { value: 'pacing', label: t('Pacing') },
                                { value: 'cardio', label: t('Cardio') },
                                { value: 'efficiency', label: t('Efficiency') },
                            ]}
                            w={120}
                        />
                    )}
                    <Switch
                        size="xs"
                        label={t("Focus Mode")}
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
                        onMouseDown={(e: React.MouseEvent) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                            const idx = Math.round(ratio * (chartRenderData.length - 1));
                            isDraggingChartRef.current = true;
                            dragStartIdxRef.current = idx;
                            setChartSelection(null);
                        }}
                        onMouseMove={(e: React.MouseEvent) => {
                            if (!isDraggingChartRef.current || dragStartIdxRef.current === null) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                            const idx = Math.round(ratio * (chartRenderData.length - 1));
                            const startIdx = Math.min(dragStartIdxRef.current, idx);
                            const endIdx = Math.max(dragStartIdxRef.current, idx);
                            if (endIdx - startIdx >= 3) {
                                setChartSelection({ startIdx, endIdx });
                            } else {
                                setChartSelection(null);
                            }
                        }}
                        onMouseUp={() => { isDraggingChartRef.current = false; dragStartIdxRef.current = null; }}
                        onMouseLeave={() => { isDraggingChartRef.current = false; dragStartIdxRef.current = null; }}
                    >
                        <ResponsiveContainer>
                            <LineChart data={chartRenderData} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
                                <CartesianGrid strokeDasharray="2 5" vertical={false} stroke={isDark ? 'rgba(148,163,184,0.10)' : 'rgba(15,23,42,0.06)'} />
                                <XAxis dataKey="time_min" hide />
                                <YAxis yAxisId="selection" hide domain={[0, 1]} />
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
                                        const tooltipRows: { label: string; value: string; color: string }[] = [];
                                        if (focusSeries.heart_rate) tooltipRows.push({ label: t('HR'), value: Number.isFinite(Number(point.heart_rate)) ? `${Math.round(Number(point.heart_rate))} bpm` : '-', color: '#fa5252' });
                                        if (focusSeries.power) tooltipRows.push({ label: t('Power'), value: Number.isFinite(powerValue) ? `${Math.round(powerValue)} W` : '-', color: '#fd7e14' });
                                        if (focusSeries.pace) tooltipRows.push({ label: t('Pace'), value: paceText, color: '#228be6' });
                                        if (focusSeries.speed) tooltipRows.push({ label: t('Speed'), value: Number.isFinite(Number(point.speed_display)) ? `${Number(point.speed_display).toFixed(1)} ${speedUnit}` : '-', color: '#12b886' });
                                        if (focusSeries.cadence) tooltipRows.push({ label: t('Cadence'), value: Number.isFinite(Number(point.cadence)) ? `${Math.round(Number(point.cadence))} rpm` : '-', color: '#40c057' });
                                        if (focusSeries.altitude) tooltipRows.push({ label: t('Elev'), value: Number.isFinite(Number(point.altitude)) ? `${Math.round(Number(point.altitude))} m` : '-', color: '#868e96' });
                                        return (
                                            <div style={{
                                                background: isDark ? 'rgba(12, 22, 42, 0.88)' : 'rgba(255, 255, 255, 0.88)',
                                                backdropFilter: 'blur(10px)',
                                                WebkitBackdropFilter: 'blur(10px)',
                                                border: `1px solid ${isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.10)'}`,
                                                borderRadius: 10,
                                                padding: '8px 12px',
                                                boxShadow: isDark
                                                    ? '0 8px 24px rgba(0,0,0,0.45)'
                                                    : '0 8px 24px rgba(15,23,42,0.12)',
                                                minWidth: 130,
                                            }}>
                                                <div style={{ fontSize: 10, color: isDark ? '#9FB0C8' : '#52617A', fontWeight: 600, marginBottom: 6, letterSpacing: 0.3 }}>
                                                    {formatElapsedFromMinutes(point.time_min)}
                                                </div>
                                                {tooltipRows.map(({ label, value, color }) => (
                                                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 3 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                                            <span style={{ fontSize: 11, color: isDark ? '#9FB0C8' : '#52617A' }}>{label}</span>
                                                        </div>
                                                        <span style={{ fontSize: 11, color: isDark ? '#E2E8F0' : '#0F172A', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    }}
                                />
                                {focusSeries.heart_rate && <Line yAxisId="hr" type="monotone" dataKey="heart_rate" stroke="#fa5252" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#fa5252', style: { filter: 'drop-shadow(0 0 5px #fa5252)' } }} name="HR" isAnimationActive={false} connectNulls />}
                                {focusSeries.power && <Line yAxisId="power" type="monotone" dataKey={powerChartMode === 'avg5s' ? 'power_5s' : 'power_raw'} stroke="#fd7e14" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#fd7e14', style: { filter: 'drop-shadow(0 0 5px #fd7e14)' } }} name="Power" isAnimationActive={false} connectNulls />}
                                {focusSeries.pace && <Line yAxisId="pace" type="monotone" dataKey="pace" stroke="#228be6" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#228be6', style: { filter: 'drop-shadow(0 0 5px #228be6)' } }} name="Pace" isAnimationActive={false} connectNulls={false} />}
                                {focusSeries.speed && <Line yAxisId="speed" type="monotone" dataKey="speed_display" stroke="#12b886" strokeWidth={1.8} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#12b886', style: { filter: 'drop-shadow(0 0 5px #12b886)' } }} name="Speed" isAnimationActive={false} connectNulls />}
                                {focusSeries.cadence && <Line yAxisId="cadence" type="monotone" dataKey="cadence" stroke="#40c057" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 2, stroke: '#fff', fill: '#40c057' }} name="Cadence" isAnimationActive={false} connectNulls />}
                                {focusSeries.altitude && <Line yAxisId="altitude" type="monotone" dataKey="altitude" stroke="#868e96" strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 2, stroke: '#fff', fill: '#868e96' }} name="Altitude" isAnimationActive={false} connectNulls />}
                                {chartSelection && chartRenderData[chartSelection.startIdx] && chartRenderData[chartSelection.endIdx] && (
                                    <ReferenceArea
                                        yAxisId="selection"
                                        x1={chartRenderData[chartSelection.startIdx].time_min}
                                        x2={chartRenderData[chartSelection.endIdx].time_min}
                                        y1={0}
                                        y2={1}
                                        fill={ui.accent}
                                        fillOpacity={0.2}
                                        stroke={ui.accent}
                                        strokeOpacity={0.85}
                                        strokeWidth={1.5}
                                        ifOverflow="extendDomain"
                                    />
                                )}
                            </LineChart>
                        </ResponsiveContainer>
                    </Box>
                    {chartSelectionStats && (
                        <SelectedSegmentSummary
                            stats={chartSelectionStats}
                            me={me}
                            supportsPaceSeries={supportsPaceSeries}
                            onClear={() => setChartSelection(null)}
                            formatElapsedFromMinutes={formatElapsedFromMinutes}
                            ui={ui}
                            t={t}
                        />
                    )}
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
                    <Text c={ui.textDim}>{t("No stream data available for this activity")}</Text>
                </Stack>
            )}
        </Paper>
    );
};

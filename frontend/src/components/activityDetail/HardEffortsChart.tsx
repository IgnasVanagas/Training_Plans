import { Badge, Box, Group, Stack, Text, Tooltip } from "@mantine/core";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { HardEffort } from "../../types/activityDetail";
import { formatDuration } from "./formatters";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
};

interface HardEffortsChartProps {
    streamPoints: any[];
    hardEfforts: HardEffort[];
    selectedEffortKey: string | null;
    onSelectEffort: (key: string) => void;
    isCyclingActivity: boolean;
    isDark: boolean;
    ui: UiTokens;
    t: (key: string) => string;
}

const ZONE_COLORS = ['gray', 'blue', 'teal', 'yellow', 'orange', 'red', 'violet'] as const;
const ZONE_HEX = ['#9ca3af', '#3b82f6', '#14b8a6', '#eab308', '#f97316', '#ef4444', '#8b5cf6'];

export const HardEffortsChart = ({
    streamPoints,
    hardEfforts,
    selectedEffortKey,
    onSelectEffort,
    isCyclingActivity,
    isDark,
    ui,
    t,
}: HardEffortsChartProps) => {
    const [hoveredSegmentKey, setHoveredSegmentKey] = useState<string | null>(null);

    // Time conversion helpers for coordinate alignment
    const actStartTs = useMemo(() => {
        if (streamPoints.length === 0) return 0;
        return new Date(streamPoints[0]?.timestamp).getTime() || 0;
    }, [streamPoints]);

    const toMin = useMemo(() => {
        return (idx: number): number => {
            const s = streamPoints[Math.min(idx, streamPoints.length - 1)];
            return s?.timestamp ? (new Date(s.timestamp).getTime() - actStartTs) / 60000 : idx / 60;
        };
    }, [streamPoints, actStartTs]);

    const totalTimelineMinutes = useMemo(() => {
        if (streamPoints.length < 2) return 0;
        return Math.max(0, toMin(streamPoints.length - 1));
    }, [streamPoints, toMin]);

    const chartSeries = useMemo(() => {
        if (streamPoints.length === 0) return [] as Array<{ time_min: number; power_raw: number | null; heart_rate: number | null }>;
        return streamPoints.map((point: any, index: number) => {
            const powerRaw = Number(point?.power ?? point?.watts);
            const hr = Number(point?.heart_rate);
            return {
                time_min: toMin(index),
                power_raw: Number.isFinite(powerRaw) && powerRaw >= 0 ? powerRaw : null,
                heart_rate: Number.isFinite(hr) && hr > 0 ? hr : null,
            };
        });
    }, [streamPoints, toMin]);

    // Build timeline of effort overlays with position/width calculations
    const effortSegments = useMemo(() => {
        if (streamPoints.length === 0 || hardEfforts.length === 0 || totalTimelineMinutes <= 0) return [];
        
        const toWidthPct = (startIndex: number, endIndexExclusive: number): number => {
            const startMin = toMin(startIndex);
            const endMin = endIndexExclusive >= streamPoints.length
                ? totalTimelineMinutes
                : toMin(Math.min(endIndexExclusive, streamPoints.length - 1));
            const widthMin = Math.max(0, endMin - startMin);
            return (widthMin / totalTimelineMinutes) * 100;
        };

        const toLeftPct = (startIndex: number): number => {
            return (toMin(startIndex) / totalTimelineMinutes) * 100;
        };

        return hardEfforts.map(e => ({
            key: e.key,
            startIndex: e.startIndex,
            endIndex: e.endIndex,
            leftPct: toLeftPct(e.startIndex),
            widthPct: toWidthPct(e.startIndex, e.endIndex + 1),
            durationSeconds: e.durationSeconds,
            zone: e.zone,
            avgWatts: e.avgPower,
            avgHr: e.avgHr,
            pctRef: e.pctRef,
            avgSpeedKmh: e.avgSpeedKmh,
            wap: e.wap,
            maxPower: e.maxPower,
            maxHr: e.maxHr,
        }));
    }, [hardEfforts, streamPoints, toMin, totalTimelineMinutes]);

    const formatElapsed = (minutes: number) => formatDuration(Math.max(0, Math.round(minutes * 60)));

    if (effortSegments.length === 0 || chartSeries.length === 0) return null;

    return (
        <Box>
            <Group justify="space-between" mb={6}>
                <Text size="xs" fw={600} c={ui.textMain}>{t("Hard Efforts")}</Text>
                <Text size="xs" c={ui.textDim}>{t("Time")}</Text>
            </Group>
            <Box
                style={{
                    position: 'relative',
                    height: 300,
                    borderRadius: 10,
                    border: `1px solid ${ui.border}`,
                    overflow: 'hidden',
                    background: isDark ? 'rgba(2,6,23,0.5)' : 'rgba(248,250,252,0.95)',
                }}
            >
                <ResponsiveContainer>
                    <LineChart data={chartSeries} margin={{ top: 12, right: 12, bottom: 8, left: 8 }}>
                        <CartesianGrid strokeDasharray="3 4" vertical={false} stroke={isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.09)'} />
                        <XAxis
                            dataKey="time_min"
                            tick={{ fill: ui.textDim, fontSize: 11 }}
                            tickFormatter={(value) => formatElapsed(Number(value))}
                            minTickGap={40}
                        />
                        <YAxis
                            yAxisId="power"
                            tick={{ fill: '#f97316', fontSize: 11 }}
                            width={45}
                            domain={[0, 'auto']}
                        />
                        <YAxis
                            yAxisId="hr"
                            orientation="right"
                            tick={{ fill: '#ef4444', fontSize: 11 }}
                            width={42}
                            domain={['auto', 'auto']}
                        />
                        <RechartsTooltip
                            content={({ active, payload }: any) => {
                                if (!active || !payload?.[0]?.payload) return null;
                                const point = payload[0].payload;
                                return (
                                    <Box style={{
                                        background: isDark ? 'rgba(12,22,42,0.92)' : 'rgba(255,255,255,0.95)',
                                        border: `1px solid ${ui.border}`,
                                        borderRadius: 8,
                                        padding: '8px 10px',
                                        minWidth: 110,
                                    }}>
                                        <Text size="xs" fw={700} c={ui.textMain}>{formatElapsed(Number(point.time_min))}</Text>
                                        <Text size="xs" c="#f97316">{t('Power')}: {point.power_raw != null ? `${Math.round(point.power_raw)} W` : '-'}</Text>
                                        <Text size="xs" c="#ef4444">{t('Heart Rate')}: {point.heart_rate != null ? `${Math.round(point.heart_rate)} bpm` : '-'}</Text>
                                    </Box>
                                );
                            }}
                        />
                        {effortSegments.map((seg) => {
                            const zoneColor = ZONE_HEX[Math.max(0, Math.min(6, seg.zone - 1))];
                            const isActive = selectedEffortKey === seg.key || hoveredSegmentKey === seg.key;
                            return (
                                <ReferenceArea
                                    key={`area-${seg.key}`}
                                    x1={toMin(seg.startIndex)}
                                    x2={toMin(seg.endIndex)}
                                    fill={zoneColor}
                                    fillOpacity={isActive ? 0.24 : 0.12}
                                    stroke={zoneColor}
                                    strokeOpacity={isActive ? 0.7 : 0.35}
                                    strokeWidth={isActive ? 2 : 1}
                                    ifOverflow="extendDomain"
                                />
                            );
                        })}
                        <Line yAxisId="power" type="monotone" dataKey="power_raw" stroke="#f97316" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                        <Line yAxisId="hr" type="monotone" dataKey="heart_rate" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                    </LineChart>
                </ResponsiveContainer>

                <Box style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    {effortSegments.map((seg) => {
                        const zoneColor = ZONE_HEX[Math.max(0, Math.min(6, seg.zone - 1))];
                        const isHovered = hoveredSegmentKey === seg.key;
                        const isSelected = selectedEffortKey === seg.key;
                        return (
                            <Tooltip
                                key={`hover-${seg.key}`}
                                withinPortal
                                openDelay={40}
                                position="top"
                                multiline
                                label={
                                    <Stack gap={4}>
                                        <Group justify="space-between" wrap="nowrap" gap={10}>
                                            <Badge size="xs" color={ZONE_COLORS[Math.max(0, Math.min(6, seg.zone - 1))]} variant="filled">Z{seg.zone}</Badge>
                                            <Text size="xs" fw={700}>{formatDuration(seg.durationSeconds)}</Text>
                                        </Group>
                                        {seg.avgWatts != null && <Text size="xs">{t('Avg W')}: {Math.round(seg.avgWatts)} W</Text>}
                                        {seg.wap != null && <Text size="xs">WAP: {Math.round(seg.wap)} W</Text>}
                                        {seg.maxPower != null && <Text size="xs">{t('Max W')}: {Math.round(seg.maxPower)} W</Text>}
                                        {seg.avgHr != null && <Text size="xs">{t('Avg HR')}: {Math.round(seg.avgHr)} bpm</Text>}
                                        {seg.maxHr != null && <Text size="xs">{t('Max HR')}: {Math.round(seg.maxHr)} bpm</Text>}
                                        {seg.avgSpeedKmh != null && <Text size="xs">{t('Avg Speed')}: {seg.avgSpeedKmh.toFixed(1)} km/h</Text>}
                                        {seg.pctRef != null && (
                                            <Text size="xs">{isCyclingActivity ? '% FTP' : '% Threshold'}: {Math.round(seg.pctRef)}%</Text>
                                        )}
                                    </Stack>
                                }
                                styles={{
                                    tooltip: {
                                        background: isDark ? '#0f172a' : '#ffffff',
                                        border: `1px solid ${ui.border}`,
                                        color: ui.textMain,
                                    },
                                }}
                            >
                                <Box
                                    onMouseEnter={() => setHoveredSegmentKey(seg.key)}
                                    onMouseLeave={() => setHoveredSegmentKey(null)}
                                    onClick={() => onSelectEffort(seg.key)}
                                    style={{
                                        pointerEvents: 'auto',
                                        position: 'absolute',
                                        left: `${seg.leftPct}%`,
                                        width: `${Math.max(seg.widthPct, 0.7)}%`,
                                        top: 10,
                                        bottom: 24,
                                        borderRadius: 6,
                                        cursor: 'pointer',
                                        background: isHovered || isSelected ? `${zoneColor}30` : 'transparent',
                                        border: `1px solid ${isHovered || isSelected ? zoneColor : 'transparent'}`,
                                        boxShadow: isHovered || isSelected ? `0 0 0 1px ${zoneColor}40 inset` : 'none',
                                    }}
                                />
                            </Tooltip>
                        );
                    })}
                </Box>
            </Box>
        </Box>
    );
};


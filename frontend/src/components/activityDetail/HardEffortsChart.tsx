import { Badge, Box, Group, Stack, Text } from "@mantine/core";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, XAxis, YAxis } from "recharts";
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
const HOVER_CARD_GUTTER = 8;
const HOVER_CARD_MAX_WIDTH = 220;
const CHART_MARGIN = { top: 12, right: 12, bottom: 8, left: 8 } as const;
const POWER_AXIS_WIDTH = 45;
const HR_AXIS_WIDTH = 42;
const OVERLAY_BOTTOM_INSET = 28;
const MIN_SEGMENT_WIDTH_PCT = 0.9;

const getPointOffsetMinutes = (point: any, index: number, startTimestamp: number | null): number => {
    const pointTimestamp = point?.timestamp ? new Date(point.timestamp).getTime() : NaN;
    if (startTimestamp != null && Number.isFinite(pointTimestamp)) {
        return Math.max(0, (pointTimestamp - startTimestamp) / 60000);
    }

    const offsetSeconds = Number(point?.time_offset_seconds ?? point?.timeOffsetSeconds);
    if (Number.isFinite(offsetSeconds) && offsetSeconds >= 0) {
        return offsetSeconds / 60;
    }

    return index / 60;
};

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
    const chartFrameRef = useRef<HTMLDivElement | null>(null);
    const [chartWidth, setChartWidth] = useState(0);

    useEffect(() => {
        const element = chartFrameRef.current;
        if (!element) return;

        const updateWidth = (nextWidth: number) => {
            setChartWidth((prevWidth) => (Math.abs(prevWidth - nextWidth) < 1 ? prevWidth : nextWidth));
        };

        updateWidth(element.clientWidth);

        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver((entries) => {
            const nextWidth = entries[0]?.contentRect.width ?? element.clientWidth;
            updateWidth(nextWidth);
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, [streamPoints]);

    const timelineMinutes = useMemo(() => {
        if (streamPoints.length === 0) return [] as number[];

        const firstTimestamp = streamPoints[0]?.timestamp ? new Date(streamPoints[0].timestamp).getTime() : NaN;
        const startTimestamp = Number.isFinite(firstTimestamp) ? firstTimestamp : null;

        return streamPoints.map((point: any, index: number) => getPointOffsetMinutes(point, index, startTimestamp));
    }, [streamPoints]);

    const totalTimelineMinutes = useMemo(() => {
        if (timelineMinutes.length < 2) return 0;
        return Math.max(0, timelineMinutes[timelineMinutes.length - 1] ?? 0);
    }, [timelineMinutes]);

    const chartPlotMetrics = useMemo(() => {
        const leftInset = CHART_MARGIN.left + POWER_AXIS_WIDTH;
        const rightInset = CHART_MARGIN.right + HR_AXIS_WIDTH;
        return {
            leftInset,
            rightInset,
            plotWidth: Math.max(chartWidth - leftInset - rightInset, 0),
        };
    }, [chartWidth]);

    const chartSeries = useMemo(() => {
        if (streamPoints.length === 0) return [] as Array<{ time_min: number; power_raw: number | null; heart_rate: number | null }>;
        return streamPoints.map((point: any, index: number) => {
            const powerRaw = Number(point?.power ?? point?.watts);
            const hr = Number(point?.heart_rate);
            return {
                time_min: timelineMinutes[index] ?? index / 60,
                power_raw: Number.isFinite(powerRaw) && powerRaw >= 0 ? powerRaw : null,
                heart_rate: Number.isFinite(hr) && hr > 0 ? hr : null,
            };
        });
    }, [streamPoints, timelineMinutes]);

    // Build timeline of effort overlays with position/width calculations
    const effortSegments = useMemo(() => {
        if (streamPoints.length === 0 || hardEfforts.length === 0 || totalTimelineMinutes <= 0) return [];

        const getTimeMin = (index: number): number => {
            const safeIndex = Math.max(0, Math.min(index, timelineMinutes.length - 1));
            return timelineMinutes[safeIndex] ?? 0;
        };

        const toPct = (minutes: number): number => (minutes / totalTimelineMinutes) * 100;

        return hardEfforts.map(e => ({
            key: e.key,
            startIndex: e.startIndex,
            endIndex: e.endIndex,
            startMin: getTimeMin(e.startIndex),
            endMin: Math.max(
                getTimeMin(e.startIndex),
                e.endIndex + 1 >= timelineMinutes.length ? totalTimelineMinutes : getTimeMin(e.endIndex + 1),
            ),
            durationSeconds: e.durationSeconds,
            zone: e.zone,
            avgWatts: e.avgPower,
            avgHr: e.avgHr,
            pctRef: e.pctRef,
            avgSpeedKmh: e.avgSpeedKmh,
            wap: e.wap,
            maxPower: e.maxPower,
            maxHr: e.maxHr,
        })).map((segment) => {
            const widthMin = Math.max(0, segment.endMin - segment.startMin);
            const leftPct = Math.max(0, Math.min(toPct(segment.startMin), 100));
            const widthPct = Math.min(
                Math.max(0, 100 - leftPct),
                Math.max(toPct(widthMin), MIN_SEGMENT_WIDTH_PCT),
            );

            return {
                ...segment,
                leftPct,
                widthPct,
                centerPct: leftPct + (widthPct / 2),
            };
        });
    }, [hardEfforts, streamPoints.length, timelineMinutes, totalTimelineMinutes]);

    const hoveredSegment = useMemo(
        () => effortSegments.find((segment) => segment.key === hoveredSegmentKey) ?? null,
        [effortSegments, hoveredSegmentKey],
    );

    const hoverCardStyle = useMemo<CSSProperties | null>(() => {
        if (!hoveredSegment) return null;

        if (chartWidth > (HOVER_CARD_GUTTER * 2) && chartPlotMetrics.plotWidth > 0) {
            const cardWidth = Math.min(HOVER_CARD_MAX_WIDTH, Math.max(140, chartWidth - (HOVER_CARD_GUTTER * 2)));
            const centerPx = chartPlotMetrics.leftInset + ((hoveredSegment.centerPct / 100) * chartPlotMetrics.plotWidth);
            const leftPx = Math.max(
                HOVER_CARD_GUTTER,
                Math.min(centerPx - (cardWidth / 2), chartWidth - cardWidth - HOVER_CARD_GUTTER),
            );

            return {
                left: leftPx,
                width: cardWidth,
            };
        }

        return {
            left: `${Math.max(8, Math.min(hoveredSegment.centerPct, 92))}%`,
            transform: 'translateX(-50%)',
            width: 'min(220px, calc(100% - 16px))',
        };
    }, [chartPlotMetrics.leftInset, chartPlotMetrics.plotWidth, chartWidth, hoveredSegment]);

    const formatElapsed = (minutes: number) => formatDuration(Math.max(0, Math.round(minutes * 60)));
    const handleSegmentEnter = (key: string) => {
        setHoveredSegmentKey((prevKey) => (prevKey === key ? prevKey : key));
    };
    const handleSegmentLeave = () => {
        setHoveredSegmentKey((prevKey) => (prevKey == null ? prevKey : null));
    };

    if (effortSegments.length === 0 || chartSeries.length === 0) return null;

    return (
        <Box>
            <Group justify="space-between" mb={6}>
                <Text size="xs" fw={600} c={ui.textMain}>{t("Hard Efforts")}</Text>
                <Text size="xs" c={ui.textDim}>{t("Time")}</Text>
            </Group>
            <Box
                ref={chartFrameRef}
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
                    <LineChart data={chartSeries} margin={CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 4" vertical={false} stroke={isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.09)'} />
                        <XAxis
                            type="number"
                            dataKey="time_min"
                            domain={[0, totalTimelineMinutes]}
                            allowDataOverflow
                            scale="linear"
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
                        {effortSegments.map((seg) => {
                            const zoneColor = ZONE_HEX[Math.max(0, Math.min(6, seg.zone - 1))];
                            const isActive = selectedEffortKey === seg.key || hoveredSegmentKey === seg.key;
                            return (
                                <ReferenceArea
                                    key={`area-${seg.key}`}
                                    x1={seg.startMin}
                                    x2={seg.endMin}
                                    fill={zoneColor}
                                    fillOpacity={isActive ? 0.28 : 0.17}
                                    stroke={zoneColor}
                                    strokeOpacity={isActive ? 0.84 : 0.55}
                                    strokeWidth={isActive ? 2 : 1.4}
                                    ifOverflow="hidden"
                                />
                            );
                        })}
                        <Line yAxisId="power" type="monotone" dataKey="power_raw" stroke="#f97316" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                        <Line yAxisId="hr" type="monotone" dataKey="heart_rate" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                    </LineChart>
                </ResponsiveContainer>

                {hoveredSegment && hoverCardStyle ? (
                    <Box
                        data-testid="hard-effort-hover-card"
                        style={{
                            ...hoverCardStyle,
                            position: 'absolute',
                            top: 12,
                            zIndex: 3,
                            pointerEvents: 'none',
                            background: isDark ? 'rgba(12,22,42,0.96)' : 'rgba(255,255,255,0.96)',
                            border: `1px solid ${ui.border}`,
                            borderRadius: 8,
                            padding: '8px 10px',
                            boxShadow: isDark ? '0 10px 30px rgba(2,6,23,0.35)' : '0 10px 24px rgba(15,23,42,0.12)',
                        }}
                    >
                        <Stack gap={4}>
                            <Group justify="space-between" wrap="nowrap" gap={10}>
                                <Badge size="xs" color={ZONE_COLORS[Math.max(0, Math.min(6, hoveredSegment.zone - 1))]} variant="filled">Z{hoveredSegment.zone}</Badge>
                                <Text size="xs" fw={700} c={ui.textMain}>{formatDuration(hoveredSegment.durationSeconds)}</Text>
                            </Group>
                            <Text size="xs" c={ui.textDim}>
                                {formatElapsed(hoveredSegment.startMin)} - {formatElapsed(hoveredSegment.endMin)}
                            </Text>
                            {hoveredSegment.avgWatts != null && <Text size="xs" c={ui.textMain}>{t('Avg W')}: {Math.round(hoveredSegment.avgWatts)} W</Text>}
                            {hoveredSegment.wap != null && <Text size="xs" c={ui.textMain}>WAP: {Math.round(hoveredSegment.wap)} W</Text>}
                            {hoveredSegment.maxPower != null && <Text size="xs" c={ui.textMain}>{t('Max W')}: {Math.round(hoveredSegment.maxPower)} W</Text>}
                            {hoveredSegment.avgHr != null && <Text size="xs" c={ui.textMain}>{t('Avg HR')}: {Math.round(hoveredSegment.avgHr)} bpm</Text>}
                            {hoveredSegment.maxHr != null && <Text size="xs" c={ui.textMain}>{t('Max HR')}: {Math.round(hoveredSegment.maxHr)} bpm</Text>}
                            {hoveredSegment.avgSpeedKmh != null && <Text size="xs" c={ui.textMain}>{t('Avg Speed')}: {hoveredSegment.avgSpeedKmh.toFixed(1)} km/h</Text>}
                            {hoveredSegment.pctRef != null && (
                                <Text size="xs" c={ui.textMain}>{isCyclingActivity ? '% FTP' : '% Threshold'}: {Math.round(hoveredSegment.pctRef)}%</Text>
                            )}
                        </Stack>
                    </Box>
                ) : null}

                <Box
                    data-testid="hard-effort-overlay-frame"
                    style={{
                        position: 'absolute',
                        top: CHART_MARGIN.top,
                        left: chartPlotMetrics.leftInset,
                        width: chartPlotMetrics.plotWidth,
                        bottom: OVERLAY_BOTTOM_INSET,
                        pointerEvents: 'none',
                    }}
                >
                    {effortSegments.map((seg) => {
                        const zoneColor = ZONE_HEX[Math.max(0, Math.min(6, seg.zone - 1))];
                        const isHovered = hoveredSegmentKey === seg.key;
                        const isSelected = selectedEffortKey === seg.key;
                        return (
                            <Box
                                key={`hover-${seg.key}`}
                                data-testid={`hard-effort-region-${seg.key}`}
                                aria-label={`Hard effort ${seg.key}`}
                                onMouseEnter={() => handleSegmentEnter(seg.key)}
                                onMouseLeave={handleSegmentLeave}
                                onClick={() => onSelectEffort(seg.key)}
                                style={{
                                    pointerEvents: 'auto',
                                    position: 'absolute',
                                    left: `${seg.leftPct}%`,
                                    width: `${seg.widthPct}%`,
                                    top: 0,
                                    bottom: 0,
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    background: isHovered || isSelected ? `${zoneColor}30` : `${zoneColor}14`,
                                    border: `1px solid ${isHovered || isSelected ? `${zoneColor}cc` : `${zoneColor}70`}`,
                                    boxShadow: isSelected
                                        ? `0 0 0 1px ${zoneColor}55 inset, 0 0 16px ${zoneColor}22`
                                        : isHovered
                                        ? `0 0 0 1px ${zoneColor}44 inset`
                                        : 'none',
                                    transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
                                }}
                            />
                        );
                    })}
                </Box>
            </Box>
        </Box>
    );
};


import { Badge, Box, Stack, Text } from "@mantine/core";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
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
    isCyclingActivity: boolean;
    isRunningActivity: boolean;
    cyclingBounds: number[];
    activityId: number | string;
    isDark: boolean;
    ui: UiTokens;
}

const ZONE_COLORS = ['gray', 'blue', 'teal', 'yellow', 'orange', 'red', 'violet'] as const;
const ZONE_HEX = ['#9ca3af', '#3b82f6', '#14b8a6', '#eab308', '#f97316', '#ef4444', '#8b5cf6'];
const MAX_POINTS = 700;
const CHART_MARGIN = { top: 2, right: 5, bottom: 0, left: 5 };

const formatElapsedFromMinutes = (value: unknown): string => {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return '';
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    const s = Math.round((minutes % 1) * 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export const HardEffortsChart = ({
    streamPoints,
    hardEfforts,
    isCyclingActivity,
    isRunningActivity,
    cyclingBounds,
    activityId,
    isDark,
    ui,
}: HardEffortsChartProps) => {
    const gradientId = `p30sg_${activityId}`;

    const chartData = useMemo(() => {
        if (streamPoints.length === 0) return [];
        const startTs = new Date(streamPoints[0]?.timestamp).getTime();
        const step = Math.max(1, Math.ceil(streamPoints.length / MAX_POINTS));

        // Pre-compute 31-pt rolling average (~30s) at full resolution
        const rolling30: (number | null)[] = streamPoints.map((_: any, i: number) => {
            const lo = Math.max(0, i - 15), hi = Math.min(streamPoints.length - 1, i + 15);
            let sum = 0, cnt = 0;
            for (let j = lo; j <= hi; j++) {
                const v = Number(streamPoints[j]?.power ?? streamPoints[j]?.watts ?? 0);
                if (v > 0) { sum += v; cnt++; }
            }
            return cnt > 0 ? sum / cnt : null;
        });

        const result: any[] = [];
        for (let i = 0; i < streamPoints.length; i += step) {
            const s = streamPoints[i];
            const timeMin = s.timestamp ? (new Date(s.timestamp).getTime() - startTs) / 60000 : i / 60;
            result.push({
                time_min: timeMin,
                power_raw: Number(s.power ?? s.watts ?? 0) || null,
                power_30s: rolling30[i],
                heart_rate: Number(s.heart_rate) || null,
                cadence: (isRunningActivity && s.cadence) ? Number(s.cadence) * 2 : (Number(s.cadence) || null),
                speed_kmh: Number(s.speed) > 0.1 ? Number(s.speed) * 3.6 : null,
            });
        }
        // Always include last point
        const lastIdx = streamPoints.length - 1;
        const ls = streamPoints[lastIdx];
        const lastMin = ls.timestamp ? (new Date(ls.timestamp).getTime() - startTs) / 60000 : lastIdx / 60;
        if (result[result.length - 1]?.time_min !== lastMin) {
            result.push({
                time_min: lastMin,
                power_raw: Number(ls.power ?? ls.watts ?? 0) || null,
                power_30s: rolling30[lastIdx],
                heart_rate: Number(ls.heart_rate) || null,
                cadence: (isRunningActivity && ls.cadence) ? Number(ls.cadence) * 2 : (Number(ls.cadence) || null),
                speed_kmh: Number(ls.speed) > 0.1 ? Number(ls.speed) * 3.6 : null,
            });
        }
        return result;
    }, [streamPoints, isRunningActivity]);

    const headerSegments = useMemo(() => {
        const total = streamPoints.length;
        if (total === 0 || hardEfforts.length === 0) return [];
        const segments: Array<{
            key: string;
            isRest: boolean;
            widthPct: number;
            durationSeconds: number;
            zone: number;
            avgWatts: number | null;
            avgHr: number | null;
            pctRef: number | null;
            avgSpeedKmh: number | null;
        }> = [];
        let cursor = 0;
        for (const e of hardEfforts) {
            if (e.startIndex > cursor) {
                segments.push({
                    key: `gap_before_${e.key}`,
                    isRest: true,
                    widthPct: ((e.startIndex - cursor) / total) * 100,
                    durationSeconds: e.startIndex - cursor,
                    zone: 1,
                    avgWatts: null,
                    avgHr: null,
                    pctRef: null,
                    avgSpeedKmh: null,
                });
            }
            segments.push({
                key: e.key,
                isRest: false,
                widthPct: (e.durationSeconds / total) * 100,
                durationSeconds: e.durationSeconds,
                zone: e.zone,
                avgWatts: e.avgPower,
                avgHr: e.avgHr,
                pctRef: e.pctRef,
                avgSpeedKmh: e.avgSpeedKmh,
            });
            cursor = e.endIndex + 1;
        }
        if (cursor < total) {
            segments.push({
                key: 'tail',
                isRest: true,
                widthPct: ((total - cursor) / total) * 100,
                durationSeconds: total - cursor,
                zone: 1,
                avgWatts: null,
                avgHr: null,
                pctRef: null,
                avgSpeedKmh: null,
            });
        }
        return segments;
    }, [hardEfforts, streamPoints.length]);

    const boundaries = useMemo(() => {
        if (hardEfforts.length === 0 || streamPoints.length === 0) return [];
        const startTs = new Date(streamPoints[0]?.timestamp).getTime();
        const toMin = (idx: number): number => {
            const s = streamPoints[Math.min(idx, streamPoints.length - 1)];
            return s?.timestamp ? (new Date(s.timestamp).getTime() - startTs) / 60000 : idx / 60;
        };
        const set = new Set<number>();
        for (const e of hardEfforts) {
            if (!e.isWarmup) set.add(toMin(e.startIndex));
            set.add(toMin(e.endIndex + 1));
        }
        return Array.from(set).sort((a, b) => a - b);
    }, [hardEfforts, streamPoints]);

    const gradientStops = useMemo(() => {
        if (!isCyclingActivity || cyclingBounds.length === 0 || chartData.length === 0) return null;
        const maxVal = chartData.reduce((m: number, d: any) => (d.power_30s != null && d.power_30s > m ? d.power_30s : m), 0);
        if (maxVal === 0) return null;
        const stops: { offset: string; color: string }[] = [];
        let prevOffset = 0;
        const numBounds = Math.min(cyclingBounds.length, 6);
        for (let b = 0; b < numBounds; b++) {
            const w = cyclingBounds[b];
            // offset 0% = top of SVG = highest power; offset 100% = bottom = power 0
            const thisOffset = w >= maxVal ? 1 : 1 - w / maxVal;
            stops.push({ offset: `${(prevOffset * 100).toFixed(1)}%`, color: ZONE_HEX[b] });
            stops.push({ offset: `${(thisOffset * 100).toFixed(1)}%`, color: ZONE_HEX[b] });
            prevOffset = thisOffset;
            if (w >= maxVal) break;
        }
        if (prevOffset < 1) {
            const topZone = Math.min(numBounds, ZONE_HEX.length - 1);
            stops.push({ offset: `${(prevOffset * 100).toFixed(1)}%`, color: ZONE_HEX[topZone] });
            stops.push({ offset: '100%', color: ZONE_HEX[topZone] });
        }
        return stops;
    }, [isCyclingActivity, cyclingBounds, chartData]);

    if (chartData.length === 0) return null;

    const xDomain: [number, number] = [chartData[0].time_min, chartData[chartData.length - 1].time_min];
    const refLineStroke = isDark ? 'rgba(148,163,184,0.3)' : 'rgba(15,23,42,0.18)';
    const gridStroke = isDark ? 'rgba(148,163,184,0.07)' : 'rgba(15,23,42,0.05)';

    const refLines = boundaries.map(t => (
        <ReferenceLine key={t} x={t} stroke={refLineStroke} strokeWidth={1} />
    ));

    return (
        <Box mb="md">
            {/* Segment header row */}
            <div style={{ display: 'flex', paddingLeft: 5, paddingRight: 5, marginBottom: 2 }}>
                {headerSegments.map(seg => (
                    <div
                        key={seg.key}
                        style={{
                            width: `${seg.widthPct}%`,
                            minWidth: 0,
                            overflow: 'hidden',
                            borderLeft: `1px solid ${ui.border}`,
                            padding: '1px 3px',
                            flexShrink: 0,
                        }}
                    >
                        {!seg.isRest && seg.widthPct > 3 && (
                            <Stack gap={0}>
                                <Text size="9px" fw={700} c={ui.textDim} style={{ lineHeight: 1.3 }}>
                                    {formatDuration(seg.durationSeconds)}
                                </Text>
                                {seg.avgWatts != null && (
                                    <Text size="9px" c={ui.textDim} style={{ lineHeight: 1.3 }}>
                                        {Math.round(seg.avgWatts)}w
                                    </Text>
                                )}
                                {seg.avgHr != null && (
                                    <Text size="9px" c="#fa5252" style={{ lineHeight: 1.3 }}>
                                        {Math.round(seg.avgHr)}bpm
                                    </Text>
                                )}
                                <Badge
                                    size="xs"
                                    color={ZONE_COLORS[Math.max(0, Math.min(6, seg.zone - 1))]}
                                    variant="filled"
                                    style={{ fontSize: 8, padding: '0 2px', height: 11, width: 'fit-content' }}
                                >
                                    Z{seg.zone}
                                </Badge>
                                {seg.pctRef != null && (
                                    <Text size="9px" c={seg.pctRef >= 90 ? '#f97316' : ui.textDim} style={{ lineHeight: 1.3 }}>
                                        {Math.round(seg.pctRef)}%
                                    </Text>
                                )}
                                {seg.avgSpeedKmh != null && (
                                    <Text size="9px" c="#60a5fa" style={{ lineHeight: 1.3 }}>
                                        {seg.avgSpeedKmh.toFixed(1)}km/h
                                    </Text>
                                )}
                            </Stack>
                        )}
                    </div>
                ))}
            </div>

            {/* Panel 1 — Raw Power */}
            {isCyclingActivity && (
                <Box h={90} style={{ position: 'relative' }}>
                    <Text size="9px" c={ui.textDim} style={{ position: 'absolute', left: 6, top: 2, zIndex: 1, pointerEvents: 'none' }}>Power</Text>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={CHART_MARGIN} syncId="hardEffortsChart">
                            <XAxis dataKey="time_min" type="number" domain={xDomain} hide />
                            <YAxis hide domain={[0, 'auto']} />
                            <CartesianGrid strokeDasharray="2 4" vertical={false} stroke={gridStroke} />
                            {refLines}
                            <Line dataKey="power_raw" stroke="#a855f7" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
                        </LineChart>
                    </ResponsiveContainer>
                </Box>
            )}

            {/* Panel 2 — 30s Power (zone-colored gradient) */}
            {isCyclingActivity && (
                <Box h={90} style={{ position: 'relative' }}>
                    <Text size="9px" c={ui.textDim} style={{ position: 'absolute', left: 6, top: 2, zIndex: 1, pointerEvents: 'none' }}>30s Power</Text>
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={CHART_MARGIN} syncId="hardEffortsChart">
                            <defs>
                                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                    {gradientStops
                                        ? gradientStops.map((s, i) => (
                                            <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.8} />
                                        ))
                                        : <>
                                            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.8} />
                                            <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.6} />
                                        </>
                                    }
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="time_min" type="number" domain={xDomain} hide />
                            <YAxis hide domain={[0, 'auto']} />
                            <CartesianGrid strokeDasharray="2 4" vertical={false} stroke={gridStroke} />
                            {refLines}
                            <Area
                                dataKey="power_30s"
                                stroke="transparent"
                                fill={`url(#${gradientId})`}
                                dot={false}
                                isAnimationActive={false}
                                connectNulls
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </Box>
            )}

            {/* Panel 3 — Heart Rate */}
            <Box h={90} style={{ position: 'relative' }}>
                <Text size="9px" c={ui.textDim} style={{ position: 'absolute', left: 6, top: 2, zIndex: 1, pointerEvents: 'none' }}>Heartrate</Text>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={CHART_MARGIN} syncId="hardEffortsChart">
                        <XAxis dataKey="time_min" type="number" domain={xDomain} hide />
                        <YAxis hide domain={['auto', 'auto']} />
                        <CartesianGrid strokeDasharray="2 4" vertical={false} stroke={gridStroke} />
                        {refLines}
                        <Area
                            dataKey="heart_rate"
                            stroke="#fa5252"
                            strokeWidth={1.5}
                            fill={isDark ? 'rgba(250,82,82,0.25)' : 'rgba(250,82,82,0.15)'}
                            dot={false}
                            isAnimationActive={false}
                            connectNulls
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </Box>

            {/* Panel 4 — Cadence (with x-axis labels) */}
            <Box h={100} style={{ position: 'relative' }}>
                <Text size="9px" c={ui.textDim} style={{ position: 'absolute', left: 6, top: 2, zIndex: 1, pointerEvents: 'none' }}>Cadence</Text>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ ...CHART_MARGIN, bottom: 2 }} syncId="hardEffortsChart">
                        <XAxis
                            dataKey="time_min"
                            type="number"
                            domain={xDomain}
                            tickFormatter={formatElapsedFromMinutes}
                            tick={{ fontSize: 9, fill: ui.textDim }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis hide domain={[0, 'auto']} />
                        <CartesianGrid strokeDasharray="2 4" vertical={false} stroke={gridStroke} />
                        {refLines}
                        <Area
                            dataKey="cadence"
                            stroke="#e879f9"
                            strokeWidth={1.5}
                            fill={isDark ? 'rgba(232,121,249,0.20)' : 'rgba(232,121,249,0.12)'}
                            dot={false}
                            isAnimationActive={false}
                            connectNulls
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </Box>
        </Box>
    );
};

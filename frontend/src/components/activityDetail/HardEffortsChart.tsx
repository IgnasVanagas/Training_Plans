import { Badge, Box, Stack, Text, Tooltip } from "@mantine/core";
import { useMemo, useState } from "react";
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

    // Build timeline of efforts with position/width calculations
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
            leftPct: toLeftPct(e.startIndex),
            widthPct: toWidthPct(e.startIndex, e.endIndex + 1),
            durationSeconds: e.durationSeconds,
            zone: e.zone,
            avgWatts: e.avgPower,
            avgHr: e.avgHr,
            pctRef: e.pctRef,
            avgSpeedKmh: e.avgSpeedKmh,
        }));
    }, [hardEfforts, streamPoints, toMin, totalTimelineMinutes]);

    if (effortSegments.length === 0) return null;

    return (
        <Box>
            {/* Header: timeline label */}
            <Text size="9px" c={ui.textDim} fw={500} mb={6}>
                Hard Efforts Timeline
            </Text>

            {/* Efforts timeline bar */}
            <Box
                style={{
                    position: 'relative',
                    height: 48,
                    background: isDark ? 'rgba(15,23,42,0.4)' : 'rgba(226,232,240,0.4)',
                    borderRadius: 6,
                    border: `1px solid ${ui.border}`,
                    overflow: 'hidden',
                }}
            >
                {/* Timeline scale reference (faint background grid) */}
                <div style={{ position: 'absolute', inset: 0, opacity: 0.3, backgroundImage: isDark ? 'linear-gradient(90deg, rgba(148,163,184,0.1) 1px, transparent 1px)' : 'linear-gradient(90deg, rgba(15,23,42,0.05) 1px, transparent 1px)', backgroundSize: '10%' }} />

                {/* Individual effort bars */}
                <div style={{ position: 'absolute', inset: 6 }}>
                    {effortSegments.map(seg => {
                        const zoneColor = ZONE_HEX[Math.max(0, Math.min(6, seg.zone - 1))];
                        const isHovered = hoveredSegmentKey === seg.key;

                        return (
                            <Tooltip
                                key={seg.key}
                                withinPortal
                                label={
                                    <Stack gap={4} style={{ minWidth: 100 }}>
                                        <div>
                                            <Text size="xs" fw={700}>{formatDuration(seg.durationSeconds)}</Text>
                                        </div>
                                        {seg.avgWatts != null && (
                                            <Text size="xs" c={ui.textDim}>{Math.round(seg.avgWatts)}w</Text>
                                        )}
                                        {seg.avgHr != null && (
                                            <Text size="xs" c="#fa5252">{Math.round(seg.avgHr)}bpm</Text>
                                        )}
                                        <Badge
                                            size="xs"
                                            color={ZONE_COLORS[Math.max(0, Math.min(6, seg.zone - 1))]}
                                            variant="filled"
                                            style={{ fontSize: 10, width: 'fit-content' }}
                                        >
                                            Zone {seg.zone}
                                        </Badge>
                                        {seg.pctRef != null && (
                                            <Text size="xs" c={seg.pctRef >= 90 ? '#f97316' : ui.textDim}>
                                                {Math.round(seg.pctRef)}% FTP
                                            </Text>
                                        )}
                                        {seg.avgSpeedKmh != null && (
                                            <Text size="xs" c="#60a5fa">{seg.avgSpeedKmh.toFixed(1)}km/h</Text>
                                        )}
                                    </Stack>
                                }
                                styles={{
                                    tooltip: {
                                        background: isDark ? '#1e293b' : '#fff',
                                        border: `1px solid ${ui.border}`,
                                        color: ui.textMain,
                                    },
                                }}
                                disabled={!isHovered}
                            >
                                <div
                                    onMouseEnter={() => setHoveredSegmentKey(seg.key)}
                                    onMouseLeave={() => setHoveredSegmentKey(null)}
                                    style={{
                                        position: 'absolute',
                                        left: `${seg.leftPct}%`,
                                        width: `${seg.widthPct}%`,
                                        inset: 0,
                                        top: 0,
                                        bottom: 0,
                                        minWidth: 2,
                                        background: zoneColor,
                                        opacity: isHovered ? 0.95 : 0.75,
                                        borderRadius: 3,
                                        border: isHovered ? `2px solid ${zoneColor}` : `1px solid ${isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)'}`,
                                        cursor: 'pointer',
                                        transition: 'opacity 150ms, border 150ms',
                                        boxShadow: isHovered ? `0 0 8px ${zoneColor}40` : 'none',
                                    }}
                                />
                            </Tooltip>
                        );
                    })}
                </div>
            </Box>

            {/* Timeline labels */}
            <Stack gap={4} mt={8}>
                {effortSegments.map(seg => (
                    <div
                        key={`label-${seg.key}`}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            paddingLeft: 4,
                        }}
                    >
                        <div
                            style={{
                                width: 12,
                                height: 12,
                                background: ZONE_HEX[Math.max(0, Math.min(6, seg.zone - 1))],
                                borderRadius: 2,
                            }}
                        />
                        <Text size="xs" c={ui.textDim}>
                            {formatDuration(seg.durationSeconds)} • Zone {seg.zone}
                            {seg.avgWatts != null && ` • ${Math.round(seg.avgWatts)}w`}
                            {seg.avgHr != null && ` • ${Math.round(seg.avgHr)}bpm`}
                        </Text>
                    </div>
                ))}
            </Stack>
        </Box>
    );
};


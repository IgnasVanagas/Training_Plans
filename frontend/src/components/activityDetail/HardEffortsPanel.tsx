import { Badge, Box, Group, Paper, Table, Text, Title } from "@mantine/core";
import { IconBolt, IconFlame, IconMinus } from "@tabler/icons-react";
import { useEffect, useMemo } from "react";
import { formatDuration } from "./formatters";
import { ActivityDetail, EffortSegmentMeta, HardEffort, HardEffortRest } from "../../types/activityDetail";

type UiTokens = {
    surface: string;
    surfaceAlt: string;
    border: string;
    textMain: string;
    textDim: string;
};

interface HardEffortsPanelProps {
    activity: ActivityDetail;
    streamPoints: any[];
    zoneProfile: any;
    selectedEffortKey: string | null;
    onSelectEffort: (key: string) => void;
    onMetaChange?: (meta: Record<string, EffortSegmentMeta>) => void;
    isDark: boolean;
    ui: UiTokens;
    t: (key: string) => string;
}

const ZONE_COLORS = ['gray', 'blue', 'teal', 'yellow', 'orange', 'red', 'violet'] as const;
const ZONE_BOUNDS_DESC = ['<55%', '55-75%', '75-90%', '90-105%', '105-120%', '120-150%', '>150%'];

export const HardEffortsPanel = ({
    activity,
    streamPoints,
    zoneProfile,
    selectedEffortKey,
    onSelectEffort,
    onMetaChange,
    isDark,
    ui,
    t,
}: HardEffortsPanelProps) => {
    const sport = (activity.sport || '').toLowerCase();
    const isCyclingActivity = sport.includes('cycl') || sport.includes('bike') || sport.includes('ride');
    const isRunningActivity = sport.includes('run');

    const hardEfforts = useMemo((): HardEffort[] => {
        if (!activity || streamPoints.length < 2) return [];

        const configuredCyclingPowerBounds = (() => {
            const raw = (zoneProfile as any)?.zone_settings?.cycling?.power?.upper_bounds;
            if (!Array.isArray(raw) || raw.length === 0) return [] as number[];
            const parsed = raw
                .map((v: any) => Number(v))
                .filter((v: number) => Number.isFinite(v) && v > 0);
            if (parsed.length !== raw.length) return [] as number[];
            for (let i = 1; i < parsed.length; i++) {
                if (parsed[i] <= parsed[i - 1]) return [] as number[];
            }
            return parsed;
        })();

        let refValue: number | null = null;
        let getMetric: (p: any) => number | null;
        let isHrFallback = false;

        if (isCyclingActivity) {
            const trainingZoneFtp = Number((zoneProfile as any)?.zone_settings?.cycling?.power?.lt2 ?? (zoneProfile as any)?.ftp ?? 0);

            const fallbackPowerBounds = trainingZoneFtp > 0
                ? [trainingZoneFtp * 0.55, trainingZoneFtp * 0.75, trainingZoneFtp * 0.90, trainingZoneFtp * 1.05, trainingZoneFtp * 1.20, trainingZoneFtp * 1.50]
                : [];
            const cyclingPowerBounds = configuredCyclingPowerBounds.length > 0 ? configuredCyclingPowerBounds : fallbackPowerBounds;

            const powerSampleCount = streamPoints.reduce((count: number, p: any) => {
                const v = Number(p?.power ?? p?.watts ?? 0);
                return v > 0 ? count + 1 : count;
            }, 0);
            const hasUsablePower = powerSampleCount >= Math.max(30, Math.floor(streamPoints.length * 0.1));

            if (cyclingPowerBounds.length > 0 && hasUsablePower) {
                // Reference value is only for display (% FTP) and merge behavior tuning.
                refValue = trainingZoneFtp > 0 ? trainingZoneFtp : null;
                getMetric = (p: any) => { const v = Number(p?.power ?? p?.watts ?? 0); return v > 0 ? v : null; };
            } else {
                // Some accounts have sparse/empty power streams; use HR as a fallback.
                const cyclingLthr = Number((zoneProfile as any)?.zone_settings?.cycling?.hr?.lt2 ?? 0);
                if (cyclingLthr > 0) {
                    refValue = cyclingLthr;
                    isHrFallback = true;
                    getMetric = (p: any) => { const v = Number(p?.heart_rate ?? 0); return v > 0 ? v : null; };
                }
            }
        } else if (isRunningActivity) {
            const lt2Raw = Number((zoneProfile as any)?.zone_settings?.running?.pace?.lt2 ?? (zoneProfile as any)?.lt2 ?? 0);
            if (lt2Raw > 0) {
                refValue = 1000 / (lt2Raw * 60);
                getMetric = (p: any) => { const v = Number(p?.speed ?? 0); return v > 0.1 ? v : null; };
            } else {
                const lthr = Number((zoneProfile as any)?.zone_settings?.running?.hr?.lt2 ?? 0);
                if (lthr > 0) {
                    refValue = lthr;
                    isHrFallback = true;
                    getMetric = (p: any) => { const v = Number(p?.heart_rate ?? 0); return v > 0 ? v : null; };
                }
            }
        }

        if (!refValue) return [];
        const ref = refValue;

        const zoneBounds = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50];
        const getZone = (value: number): number => {
            if (isCyclingActivity && !isHrFallback) {
                const raw = (zoneProfile as any)?.zone_settings?.cycling?.power?.upper_bounds;
                const parsed = Array.isArray(raw)
                    ? raw.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v) && v > 0)
                    : [];
                if (parsed.length > 0) {
                    for (let z = 0; z < parsed.length; z++) if (value < parsed[z]) return z + 1;
                    return parsed.length + 1;
                }
            }
            const ratio = value;
            for (let z = 0; z < zoneBounds.length; z++) if (ratio < zoneBounds[z]) return z + 1;
            return 7;
        };

        const cyclingBounds = (() => {
            const raw = (zoneProfile as any)?.zone_settings?.cycling?.power?.upper_bounds;
            if (!Array.isArray(raw) || raw.length === 0) return [] as number[];
            const parsed = raw
                .map((v: any) => Number(v))
                .filter((v: number) => Number.isFinite(v) && v > 0);
            return parsed.length === raw.length ? parsed : [];
        })();

        // 31-point rolling average (±15 samples, ~30s) — main effort detection
        const smoothed31: (number | null)[] = streamPoints.map((_: any, i: number) => {
            const lo = Math.max(0, i - 15), hi = Math.min(streamPoints.length - 1, i + 15);
            let sum = 0, cnt = 0;
            for (let j = lo; j <= hi; j++) {
                const v = getMetric(streamPoints[j]);
                if (v != null) { sum += v; cnt++; }
            }
            return cnt > 0 ? sum / cnt : null;
        });

        // 7-point rolling average (±3 samples, ~6s) — sprint detection only
        const smoothed7: (number | null)[] = streamPoints.map((_: any, i: number) => {
            const lo = Math.max(0, i - 3), hi = Math.min(streamPoints.length - 1, i + 3);
            let sum = 0, cnt = 0;
            for (let j = lo; j <= hi; j++) {
                const v = getMetric(streamPoints[j]);
                if (v != null) { sum += v; cnt++; }
            }
            return cnt > 0 ? sum / cnt : null;
        });

        // Prefix sums
        const pPow: number[] = [0];
        const pHr: number[] = [0];
        const pSpd: number[] = [0];
        for (let i = 0; i < streamPoints.length; i++) {
            const p = streamPoints[i];
            pPow.push(pPow[i] + (Number(p?.power ?? p?.watts ?? 0) || 0));
            pHr.push(pHr[i] + (Number(p?.heart_rate ?? 0) || 0));
            pSpd.push(pSpd[i] + (Number(p?.speed ?? 0) || 0));
        }

        const calcSegmentStats = (start: number, end: number) => {
            const n = end - start + 1;
            const sumPow = pPow[end + 1] - pPow[start];
            const sumHr = pHr[end + 1] - pHr[start];
            const sumSpd = pSpd[end + 1] - pSpd[start];
            let sumPowFourth = 0, maxPow = 0, maxHrVal = 0, hrCnt = 0, spdCnt = 0, powCnt = 0;
            for (let j = start; j <= end; j++) {
                const p = streamPoints[j];
                if (!p) continue;
                const pow = Number(p?.power ?? p?.watts ?? 0);
                const hr = Number(p?.heart_rate ?? 0);
                const spd = Number(p?.speed ?? 0);
                if (pow > 0) {
                    powCnt++;
                    sumPowFourth += Math.pow(pow, 4);
                    if (pow > maxPow) maxPow = pow;
                }
                if (hr > 0) { hrCnt++; if (hr > maxHrVal) maxHrVal = hr; }
                if (spd > 0.1) spdCnt++;
            }
            return {
                avgPower: sumPow > 0 ? sumPow / n : null,
                wap: powCnt > 0 ? Math.pow(sumPowFourth / powCnt, 0.25) : null,
                maxPower: maxPow > 0 ? maxPow : null,
                avgHr: hrCnt > 0 ? sumHr / hrCnt : null,
                maxHr: maxHrVal > 0 ? maxHrVal : null,
                avgSpeedKmh: spdCnt > 0 ? (sumSpd / spdCnt) * 3.6 : null,
            };
        };

        // Avg raw metric in index range (for gap quality check)
        const avgMetricInRange = (start: number, end: number): number => {
            let sum = 0, cnt = 0;
            for (let j = start; j <= end; j++) {
                const v = getMetric(streamPoints[j]);
                if (v != null) { sum += v; cnt++; }
            }
            return cnt > 0 ? sum / cnt : 0;
        };

        // === MAIN EFFORT DETECTION (Z4+, ≥60s) ===
        // Step 1: raw above-threshold streaks using 31-pt smoothing
        const effortThreshold = (isCyclingActivity && !isHrFallback && cyclingBounds.length >= 3)
            ? cyclingBounds[2]
            : ref * 0.90;
        const rawSegs: { start: number; end: number }[] = [];
        {
            let segStart = -1;
            for (let i = 0; i <= smoothed31.length; i++) {
                const v = i < smoothed31.length ? smoothed31[i] : null;
                const above = v != null && v >= effortThreshold;
                if (above && segStart === -1) segStart = i;
                else if (!above && segStart !== -1) {
                    rawSegs.push({ start: segStart, end: i - 1 });
                    segStart = -1;
                }
            }
        }

        // Step 2: Adaptive-gap merge.
        // Gap avg metric >= 85% FTP: active rest → bridge up to 240s.
        // Gap avg metric <  85% FTP: easy section → bridge only 25s (smoothing artifact tolerance).
        // 85% keeps intra-interval rests at 87-93% FTP merged while transitions at <85% split cleanly.
        const activeRestThreshold = (isCyclingActivity && !isHrFallback && cyclingBounds.length >= 3)
            ? ((cyclingBounds[1] ?? cyclingBounds[2]) + cyclingBounds[2]) / 2
            : ref * 0.85;
        const mergeGapActive = 240;
        const mergeGapEasy = 25;
        const merged: { start: number; end: number }[] = [];
        for (const seg of rawSegs) {
            if (merged.length === 0) { merged.push({ ...seg }); continue; }
            const last = merged[merged.length - 1];
            const gapS = last.end + 1;
            const gapE = seg.start - 1;
            if (gapS > gapE) { last.end = seg.end; continue; } // adjacent
            const gapLen = gapE - gapS + 1;
            const gapAvg = avgMetricInRange(gapS, gapE);
            const maxGap = gapAvg >= activeRestThreshold ? mergeGapActive : mergeGapEasy;
            if (gapLen <= maxGap) last.end = seg.end;
            else merged.push({ ...seg });
        }

        // Step 3: trim each merged segment's boundaries using the tighter 7-pt smoothed signal.
        // The 31-pt window halos ~15s into low-power sections on each side; the 7-pt window
        // tracks power more closely and gives accurate start/end boundaries.
        // Step 4: filter by minimum 60-second duration.
        const mainEfforts = merged
            .map(seg => {
                let { start, end } = seg;
                while (start < end && (smoothed7[start] == null || (smoothed7[start] as number) < effortThreshold)) start++;
                while (end > start && (smoothed7[end] == null || (smoothed7[end] as number) < effortThreshold)) end--;
                return { start, end };
            })
            .filter(s => s.end - s.start + 1 >= 60);

        // === SPRINT DETECTION (Z6+ = ≥120% FTP, brief) ===
        // Use shorter (7-pt) smoothing so brief power spikes aren't washed out.
        const sprintThreshold = (isCyclingActivity && !isHrFallback && cyclingBounds.length >= 5)
            ? cyclingBounds[4]
            : ref * 1.20;
        const minSprintDuration = 8; // seconds
        const sprintSegs: { start: number; end: number }[] = [];
        {
            let segStart = -1;
            for (let i = 0; i <= smoothed7.length; i++) {
                const v = i < smoothed7.length ? smoothed7[i] : null;
                const above = v != null && v >= sprintThreshold;
                if (above && segStart === -1) segStart = i;
                else if (!above && segStart !== -1) {
                    const segLen = i - segStart;
                    if (segLen >= minSprintDuration) {
                        // Validate: actual raw average must be ≥110% FTP (Z5+) to be a genuine sprint.
                        // The 7-pt smoothed window "halos" around real peaks, creating edge segments
                        // where the segment average is much lower than the smoothed threshold.
                        const avgRaw = avgMetricInRange(segStart, i - 1);
                        const minSprintAvg = (isCyclingActivity && !isHrFallback && cyclingBounds.length >= 4)
                            ? cyclingBounds[3]
                            : ref * 1.10;
                        if (avgRaw >= minSprintAvg) sprintSegs.push({ start: segStart, end: i - 1 });
                    }
                    segStart = -1;
                }
            }
        }
        // Remove any sprint that overlaps at all with a main effort (edge halo removal)
        const standaloneSprints = sprintSegs.filter(sp =>
            !mainEfforts.some(s => s.start <= sp.end && sp.start <= s.end)
        );

        // Combine and sort chronologically
        type RawEntry = { start: number; end: number; isSprint: boolean };
        const allSegs: RawEntry[] = [
            ...mainEfforts.map(s => ({ ...s, isSprint: false })),
            ...standaloneSprints.map(s => ({ ...s, isSprint: true })),
        ].sort((a, b) => a.start - b.start);

        const kept: HardEffort[] = allSegs.map((seg, idx) => {
            const stats = calcSegmentStats(seg.start, seg.end);
            const refForPct = isHrFallback ? stats.avgHr : (isCyclingActivity ? stats.avgPower : (stats.avgSpeedKmh != null ? stats.avgSpeedKmh / 3.6 : null));
            const ratio = refForPct != null ? refForPct / ref : 0;
            const zoneInput = (isCyclingActivity && !isHrFallback)
                ? (stats.avgPower ?? 0)
                : ratio;
            return {
                key: `effort_${idx}`,
                zone: getZone(zoneInput),
                isSprint: seg.isSprint,
                startIndex: seg.start,
                endIndex: seg.end,
                centerIndex: Math.round((seg.start + seg.end) / 2),
                durationSeconds: seg.end - seg.start + 1,
                ...stats,
                pctRef: ref > 0 && refForPct != null ? ratio * 100 : null,
            };
        });

        // Drop sprints below Z5 (105% FTP). The 7-pt window halos extend segments into
        // surrounding coasting samples, diluting the average down to Z4/Z1 even when the
        // actual spike was genuine. A "sprint" at Z4 or below is not meaningful.
        const validKept = kept.filter(e => !e.isSprint || e.zone >= 5);

        // Re-key after filtering so indices stay contiguous
        validKept.forEach((e, i) => { if (!e.isWarmup) e.key = `effort_${i}`; });

        const kept2 = validKept;

        // Pre-interval warmup row
        if (kept2.length > 0 && kept2[0].startIndex > 30) {
            const wEnd = kept2[0].startIndex - 1;
            const wStats = calcSegmentStats(0, wEnd);
            const wRefForPct = isHrFallback ? wStats.avgHr : (isCyclingActivity ? wStats.avgPower : (wStats.avgSpeedKmh != null ? wStats.avgSpeedKmh / 3.6 : null));
            const wRatio = wRefForPct != null ? wRefForPct / ref : 0;
            const wZoneInput = (isCyclingActivity && !isHrFallback)
                ? (wStats.avgPower ?? 0)
                : wRatio;
            kept2.unshift({
                key: 'warmup',
                zone: getZone(wZoneInput),
                isWarmup: true,
                startIndex: 0,
                endIndex: wEnd,
                centerIndex: Math.floor(wEnd / 2),
                durationSeconds: kept2[0].startIndex,
                ...wStats,
                pctRef: ref > 0 && wRefForPct != null ? wRatio * 100 : null,
            });
        }

        return kept2;
    }, [activity, streamPoints, zoneProfile, isCyclingActivity, isRunningActivity]);

    const hardEffortRests = useMemo((): HardEffortRest[] => {
        if (hardEfforts.length < 2) return [];
        const ftp = isCyclingActivity ? Number(activity?.ftp_at_time ?? (zoneProfile as any)?.ftp ?? 0) : 0;
        const zoneBounds = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50];
        const getZone = (ratio: number): number => {
            for (let z = 0; z < zoneBounds.length; z++) if (ratio < zoneBounds[z]) return z + 1;
            return 7;
        };
        const rests: HardEffortRest[] = [];
        for (let i = 0; i < hardEfforts.length - 1; i++) {
            const restStart = hardEfforts[i].endIndex + 1;
            const restEnd = hardEfforts[i + 1].startIndex - 1;
            if (restEnd < restStart) {
                rests.push({ durationSeconds: 0, avgHr: null, avgPower: null, avgSpeedKmh: null, zone: 1 });
                continue;
            }
            const n = restEnd - restStart + 1;
            let sumPow = 0, sumHr = 0, sumSpd = 0, hrCnt = 0, spdCnt = 0;
            for (let j = restStart; j <= restEnd; j++) {
                const p = streamPoints[j];
                if (!p) continue;
                sumPow += Number(p?.power ?? p?.watts ?? 0);
                const hr = Number(p?.heart_rate ?? 0);
                const spd = Number(p?.speed ?? 0);
                if (hr > 0) { sumHr += hr; hrCnt++; }
                if (spd > 0.1) { sumSpd += spd; spdCnt++; }
            }
            const avgPower = sumPow > 0 ? sumPow / n : null;
            const ratio = (ftp > 0 && avgPower != null) ? avgPower / ftp : 0;
            rests.push({
                durationSeconds: n,
                avgHr: hrCnt > 0 ? sumHr / hrCnt : null,
                avgPower,
                avgSpeedKmh: spdCnt > 0 ? (sumSpd / spdCnt) * 3.6 : null,
                zone: getZone(ratio),
            });
        }
        return rests;
    }, [hardEfforts, streamPoints, activity, zoneProfile, isCyclingActivity]);

    const hardEffortMetaByKey = useMemo((): Record<string, EffortSegmentMeta> => {
        const result: Record<string, EffortSegmentMeta> = {};
        for (const e of hardEfforts) {
            result[e.key] = {
                startIndex: e.startIndex,
                endIndex: e.endIndex,
                centerIndex: e.centerIndex,
                seconds: e.durationSeconds,
                meters: e.avgSpeedKmh != null ? (e.avgSpeedKmh / 3.6) * e.durationSeconds : null,
                avgPower: e.avgPower,
                avgHr: e.avgHr,
                speedKmh: e.avgSpeedKmh,
            };
        }
        // Recovery segments — so recovery rows can also be focused on map/chart
        for (let i = 0; i < hardEfforts.length - 1; i++) {
            const restStart = hardEfforts[i].endIndex + 1;
            const restEnd = hardEfforts[i + 1].startIndex - 1;
            if (restEnd >= restStart) {
                result[`rest_${i}`] = {
                    startIndex: restStart,
                    endIndex: restEnd,
                    centerIndex: Math.round((restStart + restEnd) / 2),
                    seconds: restEnd - restStart + 1,
                    meters: null,
                    avgPower: null,
                    avgHr: null,
                    speedKmh: null,
                };
            }
        }
        return result;
    }, [hardEfforts]);

    useEffect(() => {
        onMetaChange?.(hardEffortMetaByKey);
    }, [hardEffortMetaByKey, onMetaChange]);

    if (hardEfforts.length === 0) {
        return (
            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                <Text c={ui.textDim} size="sm">{t('No significant efforts detected.')}</Text>
            </Paper>
        );
    }

    return (
        <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
            <Group justify="space-between" mb="xs">
                <Title order={5} c={ui.textMain}>{t("Hard Efforts")}</Title>
            </Group>
            <Group gap="md" mb="md" wrap="wrap">
                {[1,2,3,4,5,6,7].map(z => (
                    <Group key={z} gap={4}>
                        <Badge size="xs" color={ZONE_COLORS[z-1]} variant="filled">Z{z}</Badge>
                        <Text size="xs" c="dimmed">{ZONE_BOUNDS_DESC[z-1]} FTP</Text>
                    </Group>
                ))}
            </Group>
            <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <Table striped highlightOnHover withTableBorder withColumnBorders style={{ whiteSpace: 'nowrap' }}>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th></Table.Th>
                        <Table.Th>{t('Zone')}</Table.Th>
                        <Table.Th>{t('Duration')}</Table.Th>
                        {isCyclingActivity && <Table.Th>Avg W</Table.Th>}
                            {isCyclingActivity && <Table.Th>WAP</Table.Th>}
                        {isCyclingActivity && <Table.Th>Max W</Table.Th>}
                        {isCyclingActivity && <Table.Th>% FTP</Table.Th>}
                        {isRunningActivity && <Table.Th>{t('Avg Pace')}</Table.Th>}
                        {isRunningActivity && <Table.Th>% Threshold</Table.Th>}
                        <Table.Th>Avg HR</Table.Th>
                        <Table.Th>Max HR</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {hardEfforts.map((effort, idx) => {
                        const zoneColor = ZONE_COLORS[Math.max(0, Math.min(6, effort.zone - 1))];
                        const isSelected = selectedEffortKey === effort.key;
                        const paceDisplay = effort.avgSpeedKmh && effort.avgSpeedKmh > 0
                            ? (() => { const p = 60 / effort.avgSpeedKmh; const m = Math.floor(p); const s = Math.round((p - m) * 60); return `${m}:${s.toString().padStart(2, '0')} /km`; })()
                            : null;
                        const rest = idx < hardEffortRests.length ? hardEffortRests[idx] : null;
                        const iconColor = zoneColor === 'red' ? '#ef4444' :
                            zoneColor === 'orange' ? '#f97316' :
                            zoneColor === 'yellow' ? '#eab308' :
                            zoneColor === 'violet' ? '#8b5cf6' :
                            zoneColor === 'teal' ? '#14b8a6' :
                            zoneColor === 'blue' ? '#3b82f6' : '#9ca3af';
                        const restKey = `rest_${idx}`;
                        const isRestSelected = selectedEffortKey === restKey;
                        return [
                            <Table.Tr
                                key={effort.key}
                                style={{
                                    cursor: 'pointer',
                                    backgroundColor: isSelected ? (isDark ? 'rgba(233,90,18,0.16)' : 'rgba(233,90,18,0.10)') : undefined,
                                    fontStyle: effort.isWarmup ? 'italic' : undefined,
                                }}
                                onClick={() => onSelectEffort(effort.key)}
                            >
                                <Table.Td w={36} style={{ textAlign: 'center' }}>
                                    {effort.isSprint
                                        ? <IconBolt size={14} color={iconColor} />
                                        : <IconFlame size={14} color={iconColor} />
                                    }
                                </Table.Td>
                                <Table.Td>
                                    <Group gap={4}>
                                        <Badge size="sm" color={zoneColor} variant={effort.isWarmup ? 'outline' : 'light'}>
                                            Z{effort.zone}
                                        </Badge>
                                        {effort.isSprint && <Text size="xs" c="dimmed" fs="italic">sprint</Text>}
                                    </Group>
                                </Table.Td>
                                <Table.Td fw={effort.isWarmup ? 400 : 600}>{formatDuration(effort.durationSeconds)}</Table.Td>
                                {isCyclingActivity && <Table.Td>{effort.avgPower != null ? `${Math.round(effort.avgPower)} W` : '-'}</Table.Td>}
                                {isCyclingActivity && <Table.Td>{effort.wap != null ? `${Math.round(effort.wap)} W` : '-'}</Table.Td>}
                                {isCyclingActivity && <Table.Td>{effort.maxPower != null ? `${Math.round(effort.maxPower)} W` : '-'}</Table.Td>}
                                {isCyclingActivity && <Table.Td>{effort.pctRef != null ? `${Math.round(effort.pctRef)}%` : '-'}</Table.Td>}
                                {isRunningActivity && <Table.Td>{paceDisplay ?? '-'}</Table.Td>}
                                {isRunningActivity && <Table.Td>{effort.pctRef != null ? `${Math.round(effort.pctRef)}%` : '-'}</Table.Td>}
                                <Table.Td>{effort.avgHr != null ? `${Math.round(effort.avgHr)} bpm` : '-'}</Table.Td>
                                <Table.Td>{effort.maxHr != null ? `${Math.round(effort.maxHr)} bpm` : '-'}</Table.Td>
                            </Table.Tr>,
                            rest && rest.durationSeconds > 0 ? (
                                <Table.Tr
                                    key={restKey}
                                    style={{
                                        opacity: isRestSelected ? 1 : 0.55,
                                        cursor: 'pointer',
                                        backgroundColor: isRestSelected ? (isDark ? 'rgba(233,90,18,0.16)' : 'rgba(233,90,18,0.10)') : undefined,
                                    }}
                                    onClick={() => onSelectEffort(restKey)}
                                >
                                    <Table.Td style={{ textAlign: 'center' }}><IconMinus size={12} /></Table.Td>
                                    <Table.Td>
                                        <Group gap={4}>
                                            <Badge size="xs" color={ZONE_COLORS[Math.max(0, Math.min(6, (rest.zone ?? 1) - 1))]} variant="light">Z{rest.zone ?? 1}</Badge>
                                            <Text size="xs" c="dimmed" fs="italic">recovery</Text>
                                        </Group>
                                    </Table.Td>
                                    <Table.Td><Text size="xs" c="dimmed">{formatDuration(rest.durationSeconds)}</Text></Table.Td>
                                    {isCyclingActivity && <Table.Td><Text size="xs" c="dimmed">{rest.avgPower != null ? `${Math.round(rest.avgPower)} W` : '-'}</Text></Table.Td>}
                                    {isCyclingActivity && <Table.Td>-</Table.Td>}
                                    {isCyclingActivity && <Table.Td>-</Table.Td>}
                                    {isCyclingActivity && <Table.Td>-</Table.Td>}
                                    {isRunningActivity && <Table.Td><Text size="xs" c="dimmed">{rest.avgSpeedKmh && rest.avgSpeedKmh > 0 ? (() => { const p = 60 / rest.avgSpeedKmh!; const m = Math.floor(p); const s = Math.round((p - m) * 60); return `${m}:${s.toString().padStart(2, '0')} /km`; })() : '-'}</Text></Table.Td>}
                                    {isRunningActivity && <Table.Td>-</Table.Td>}
                                    <Table.Td><Text size="xs" c="dimmed">{rest.avgHr != null ? `${Math.round(rest.avgHr)} bpm` : '-'}</Text></Table.Td>
                                    <Table.Td>-</Table.Td>
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

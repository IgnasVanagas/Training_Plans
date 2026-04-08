import { ActionIcon, Anchor, AppShell, Box, Button, Card, Container, Grid, Group, Paper, SimpleGrid, Stack, Tabs, Text, Title, Badge, SegmentedControl, Chip, Table, ThemeIcon, useComputedColorScheme, Modal, TextInput, Tooltip as MantineTooltip } from "@mantine/core";
import { IconArrowLeft, IconBolt, IconHeart, IconMap, IconClock, IconActivity, IconHelpCircle, IconTrophy, IconArrowsMaximize, IconExternalLink, IconShare } from "@tabler/icons-react";
import ShareToChatModal from "../components/ShareToChatModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine } from 'recharts';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip as LeafletTooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from "../api/client";
import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from 'leaflet';
import { calculateNormalizedPower, formatDuration, formatZoneDuration } from "../components/activityDetail/formatters";
import { ActivityDetail, EffortSegmentMeta, RouteInteractivePoint } from "../types/activityDetail";
import { MapFitBounds, MapPanTo, MapRouteInteractionLayer, toDistanceLabel, getHeatColor } from "../components/activityDetail/mapHelpers";
import { ActivityDetailSkeleton } from "../components/common/SkeletonScreens";
import SupportContactButton from "../components/common/SupportContactButton";
import { formatHrZoneLabel, getHrZoneClassifierBounds } from "../utils/hrZones";
import { useI18n } from "../i18n/I18nProvider";
import { readSnapshot, writeSnapshot } from "../utils/localSnapshot";
import { extractApiErrorMessage } from "./dashboard/utils";
import { CommentsPanel } from "../components/activityDetail/CommentsPanel";
import { SessionFeedbackPanel } from "../components/activityDetail/SessionFeedbackPanel";
import { ComparisonPanel } from "../components/activityDetail/ComparisonPanel";
import { SplitsTable } from "../components/activityDetail/SplitsTable";
import { ChartsPanel } from "../components/activityDetail/ChartsPanel";
import { HardEffortsPanel } from "../components/activityDetail/HardEffortsPanel";
import { BestEffortsPanel } from "../components/activityDetail/BestEffortsPanel";
import { FullscreenMapModal } from "../components/activityDetail/FullscreenMapModal";
import { SelectedSegmentSummary } from "../components/activityDetail/SelectedSegmentSummary";
import { getPersonalRecords } from "../api/activities";

// Fix Leaflet icon issue
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

export const ActivityDetailPage = () => {
    const { t } = useI18n();
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const isDark = useComputedColorScheme('light') === 'dark';
    const ui = useMemo(() => ({
        pageBg: isDark ? '#081226' : '#F4F7FC',
        headerBg: isDark ? '#0E1A30' : '#FFFFFF',
        surface: isDark ? '#12223E' : '#FFFFFF',
        surfaceAlt: isDark ? '#182B4B' : '#F8FAFF',
        border: isDark ? 'rgba(148,163,184,0.28)' : '#DCE6F7',
        textMain: isDark ? '#E2E8F0' : '#0F172A',
        textDim: isDark ? '#9FB0C8' : '#52617A',
        accent: '#E95A12'
    }), [isDark]);
    const sharedTooltipProps = useMemo(() => ({
        isAnimationActive: false,
        cursor: { stroke: ui.border, strokeWidth: 1 },
        wrapperStyle: { outline: 'none' },
        contentStyle: {
            backgroundColor: ui.surfaceAlt,
            borderColor: ui.border,
            borderRadius: 10,
            color: ui.textMain,
        },
        labelStyle: { color: ui.textDim, fontWeight: 600 },
        itemStyle: { color: ui.textMain },
    }), [ui.border, ui.surfaceAlt, ui.textDim, ui.textMain]);
    const formatElapsedFromMinutes = (value: unknown) => {
        const minutes = Number(value);
        if (!Number.isFinite(minutes) || minutes < 0) return '-';
        const totalSeconds = Math.round(minutes * 60);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };
    const [graphMode, setGraphMode] = useState<'standard' | 'power_curve' | 'hr_zones' | 'pace_zones' | 'power_zones'>('hr_zones');
    const isDesktopViewport = useMediaQuery('(min-width: 62em)');
    const [activeSection, setActiveSection] = useState<'overview' | 'charts' | 'analysis' | 'laps' | 'best_efforts' | 'comparison'>('overview');
    const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
    const hoveredPointIndexRef = useRef<number | null>(null);
    const pendingHoveredPointIndexRef = useRef<number | null>(null);
    const hoveredPointRafRef = useRef<number | null>(null);
    const [effortsSplitsView, setEffortsSplitsView] = useState<'efforts' | 'splits'>('efforts');
    const [focusMode, setFocusMode] = useState(false);
    const [focusObjective, setFocusObjective] = useState<'pacing' | 'cardio' | 'efficiency'>('pacing');
    const [completionPulse, setCompletionPulse] = useState(false);
    const [visibleSeries, setVisibleSeries] = useState({
        heart_rate: true,
        power: true,
        pace: true,
        speed: false,
        cadence: false,
        altitude: false,
    });
    const [powerChartMode, setPowerChartMode] = useState<'raw' | 'avg5s'>('raw');
    const [activityRpe, setActivityRpe] = useState<number | null>(null);
    const [activityNotes, setActivityNotes] = useState('');
    const [mapFullscreen, setMapFullscreen] = useState(false);
    const [fsMapIndex, setFsMapIndex] = useState<number | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [showDangerZone, setShowDangerZone] = useState(false);
    const [zoneInfoOpen, setZoneInfoOpen] = useState(false);
    const [zoneInfoTitle, setZoneInfoTitle] = useState('');
    const [zoneInfoBody, setZoneInfoBody] = useState('');
    const [executionInfoOpen, setExecutionInfoOpen] = useState(false);
    const [selectedEffortKey, setSelectedEffortKey] = useState<string | null>(null);
    const [selectedEffortStreamIndex, setSelectedEffortStreamIndex] = useState<number | null>(null);
    const [mapHeatMetric, setMapHeatMetric] = useState<'none' | 'speed' | 'heart_rate' | 'power' | 'gradient'>('none');
    const [mapHoveredChartIndex, setMapHoveredChartIndex] = useState<number | null>(null);
    const [fsVisibleMetrics, setFsVisibleMetrics] = useState({ altitude: true, heart_rate: false, pace: false, power: false, cadence: false });
    const mapDragStartChartIndexRef = useRef<number | null>(null);
    const isDraggingMapRef = useRef(false);
    const fsDragStartIdxRef = useRef<number | null>(null);
    const isFsDraggingRef = useRef(false);
    const desktopDefaultsAppliedRef = useRef(false);

    useEffect(() => {
        if (!isDesktopViewport || desktopDefaultsAppliedRef.current) return;

        setVisibleSeries((prev) => ({
            ...prev,
            heart_rate: true,
            power: true,
            pace: true,
        }));

        desktopDefaultsAppliedRef.current = true;
    }, [isDesktopViewport]);

    const { data: me } = useQuery({
        queryKey: ['me'],
        queryFn: async () => {
             const res = await api.get("/users/me");
             return res.data;
        }
    });

    const { data: selfPermissions } = useQuery({
        queryKey: ['athlete-permissions-self', me?.id],
        enabled: Boolean(me?.id && me?.role === 'athlete'),
        queryFn: async () => {
            const res = await api.get(`/users/athletes/${me?.id}/permissions`);
            return res.data;
        }
    });

    const canDeleteActivity = me?.role === 'coach' || Boolean(selfPermissions?.permissions?.allow_delete_activities);

    const returnState = (location.state || {}) as {
        returnTo?: string;
        activeTab?: 'dashboard' | 'activities' | 'plan' | 'settings';
        selectedAthleteId?: string | null;
        calendarDate?: string | null;
        focusEffort?: { type: 'window' | 'distance'; key: string };
    };

    const handleBack = () => {
        if (returnState.returnTo) {
            navigate(returnState.returnTo, {
                state: {
                    activeTab: returnState.activeTab,
                    selectedAthleteId: returnState.selectedAthleteId,
                    calendarDate: returnState.calendarDate
                }
            });
            return;
        }
        navigate(-1);
    };

    const deleteActivityMutation = useMutation({
        mutationFn: async () => {
            await api.delete(`/activities/${id}`);
        },
        onMutate: async () => {
            await queryClient.cancelQueries({ queryKey: ['activity', id] });
            await queryClient.cancelQueries({ queryKey: ['activities'] });
            const previousActivity = queryClient.getQueryData(['activity', id]);
            const previousActivitiesQueries: [unknown[], unknown][] = [];
            queryClient.getQueriesData<unknown[]>({ queryKey: ['activities'] }).forEach(([qk, qd]) => {
                previousActivitiesQueries.push([qk as unknown[], qd]);
                queryClient.setQueryData(qk as unknown[], (old: any[]) =>
                    old ? old.filter((a) => a.id !== Number(id)) : old
                );
            });
            queryClient.removeQueries({ queryKey: ['activity', id] });
            navigate(-1);
            return { previousActivity, previousActivitiesQueries };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
        },
        onError: (_err, _vars, context) => {
            if (context?.previousActivity) queryClient.setQueryData(['activity', id], context.previousActivity);
            context?.previousActivitiesQueries?.forEach(([qk, qd]) => queryClient.setQueryData(qk as unknown[], qd as any));
            notifications.show({ color: 'red', title: 'Delete failed', message: 'Could not delete activity. Please try again.', position: 'bottom-right' });
        },
    });

    const updateActivityMutation = useMutation({
        mutationFn: async (payload: { rpe?: number | null; lactate_mmol_l?: number | null; notes?: string | null; split_annotations?: Array<{ split_type: 'metric' | 'laps'; split_index: number; rpe?: number | null; lactate_mmol_l?: number | null; note?: string | null }> }) => {
            const res = await api.patch<ActivityDetail>(`/activities/${id}`, payload);
            return res.data;
        },
        onMutate: async (payload) => {
            await queryClient.cancelQueries({ queryKey: ['activity', id] });
            const previous = queryClient.getQueryData<ActivityDetail>(['activity', id]);
            if (previous) queryClient.setQueryData(['activity', id], { ...previous, ...payload });
            return { previous };
        },
        onSuccess: (updated) => {
            queryClient.setQueryData(['activity', id], updated);
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) queryClient.setQueryData(['activity', id], context.previous);
        },
    });

    const reparseMutation = useMutation({
        mutationFn: async () => {
            await api.post(`/activities/${id}/reparse`);
        },
        onSuccess: () => {
            try { window.localStorage.removeItem(`activity:${id}`); } catch {}
            queryClient.removeQueries({ queryKey: ['activity', id] });
            queryClient.refetchQueries({ queryKey: ['activity', id] });
            queryClient.invalidateQueries({ queryKey: ['activities'] });
        },
        onError: (error) => {
            notifications.show({ color: 'red', title: 'Re-parse failed', message: extractApiErrorMessage(error) });
        },
    });
    
    const { data: activity, isLoading, isError, refetch } = useQuery({
        queryKey: ['activity', id],
           initialData: () => readSnapshot<ActivityDetail>(`activity:${id}`),
           queryFn: async () => {
               const res = await api.get<ActivityDetail>(`/activities/${id}`);
               writeSnapshot(`activity:${id}`, res.data);
               return res.data;
           },
           staleTime: 1000 * 60 * 5,
           gcTime: 1000 * 60 * 30,
           placeholderData: (prev) => prev,
           refetchOnMount: false,
           retry: 2,
           retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    });

    const viewedAthleteId = Number(activity?.athlete_id || 0);
    const shouldFetchViewedAthlete = Boolean(
        me?.role === 'coach'
        && viewedAthleteId > 0
        && viewedAthleteId !== me?.id,
    );
    const { data: viewedAthlete } = useQuery({
        queryKey: ['athlete', viewedAthleteId],
        enabled: shouldFetchViewedAthlete,
        queryFn: async () => {
            const res = await api.get(`/users/athletes/${viewedAthleteId}`);
            return res.data;
        },
        staleTime: 60_000,
    });
    const zoneProfile = viewedAthlete?.profile || me?.profile;

    const streamPoints = useMemo(() => {
        if (!activity?.streams) return [];
        if (Array.isArray(activity.streams)) return activity.streams;
        if (Array.isArray(activity.streams?.data)) return activity.streams.data;
        return [];
    }, [activity]);

    const { data: prData } = useQuery({
        queryKey: ['personal-records-cycling', activity?.athlete_id],
        queryFn: () => getPersonalRecords('cycling', me?.id !== activity?.athlete_id ? activity?.athlete_id : null),
        enabled: !!activity?.power_curve && ['cycl', 'bike', 'ride'].some(w => (activity?.sport || '').toLowerCase().includes(w)),
        staleTime: 5 * 60 * 1000,
    });

    const rankedBestEfforts = useMemo(() => {
        const allEfforts = activity?.best_efforts;
        if (!allEfforts?.length) return [];

        return allEfforts.filter((effort, idx) => {
            const key = effort.window || effort.distance || String(idx);
            const rank = activity?.personal_records?.[key];
            return typeof rank === 'number' && rank >= 1 && rank <= 3;
        });
    }, [activity?.best_efforts, activity?.personal_records]);

    const bestEffortMetaByKey = useMemo(() => {
        const empty: Record<string, EffortSegmentMeta> = {};
        const efforts = activity?.best_efforts;
        if (!efforts?.length || streamPoints.length < 2) return empty;

        const dist = streamPoints.map((p: any) => {
            const val = Number(p?.distance);
            return Number.isFinite(val) ? val : null;
        });
        let lastDistance = 0;
        const filledDist: number[] = [];
        for (let i = 0; i < dist.length; i += 1) {
            const value = dist[i];
            if (value == null) {
                filledDist.push(lastDistance);
                continue;
            }
            lastDistance = value;
            filledDist.push(value);
        }

        const power = streamPoints.map((p: any) => {
            const val = Number(p?.power ?? p?.watts ?? p?.avg_watts);
            return Number.isFinite(val) && val >= 0 ? val : 0;
        });
        const hr = streamPoints.map((p: any) => {
            const val = Number(p?.heart_rate);
            return Number.isFinite(val) && val > 0 ? val : 0;
        });
        const pPow = [0];
        const pHr = [0];
        for (let i = 0; i < streamPoints.length; i += 1) {
            pPow.push(pPow[i] + power[i]);
            pHr.push(pHr[i] + hr[i]);
        }

        const calcMeta = (start: number, end: number): EffortSegmentMeta => {
            const safeStart = Math.max(0, Math.min(start, streamPoints.length - 1));
            const safeEnd = Math.max(safeStart, Math.min(end, streamPoints.length - 1));
            const sampleCount = safeEnd - safeStart + 1;
            const seconds = sampleCount > 0 ? sampleCount : null;
            const metersRaw = filledDist[safeEnd] - filledDist[safeStart];
            const meters = Number.isFinite(metersRaw) && metersRaw > 0 ? metersRaw : null;
            const avgPowerRaw = sampleCount > 0 ? (pPow[safeEnd + 1] - pPow[safeStart]) / sampleCount : NaN;
            const avgHrRaw = sampleCount > 0 ? (pHr[safeEnd + 1] - pHr[safeStart]) / sampleCount : NaN;
            const avgPower = Number.isFinite(avgPowerRaw) && avgPowerRaw > 0 ? avgPowerRaw : null;
            const avgHr = Number.isFinite(avgHrRaw) && avgHrRaw > 0 ? avgHrRaw : null;
            const speedKmh = meters && seconds && seconds > 0 ? ((meters / 1000) / (seconds / 3600)) : null;
            return {
                startIndex: safeStart,
                endIndex: safeEnd,
                centerIndex: Math.round((safeStart + safeEnd) / 2),
                seconds,
                meters,
                avgPower,
                avgHr,
                speedKmh: speedKmh && Number.isFinite(speedKmh) ? speedKmh : null,
            };
        };

        const metaByKey: Record<string, EffortSegmentMeta> = {};

        efforts.forEach((effort, idx) => {
            const key = effort.window || effort.distance || String(idx);

            if (typeof effort.seconds === 'number' && effort.seconds > 0) {
                const windowSize = Math.max(1, Math.round(effort.seconds));
                if (streamPoints.length >= windowSize) {
                    let bestStart = 0;
                    let bestAvg = -1;
                    for (let start = 0; start + windowSize <= streamPoints.length; start += 1) {
                        const endExclusive = start + windowSize;
                        const avg = (pPow[endExclusive] - pPow[start]) / windowSize;
                        if (avg > bestAvg) {
                            bestAvg = avg;
                            bestStart = start;
                        }
                    }
                    metaByKey[key] = calcMeta(bestStart, bestStart + windowSize - 1);
                    return;
                }
            }

            if (typeof effort.meters === 'number' && effort.meters > 0) {
                let bestStart = -1;
                let bestEnd = -1;
                let bestSeconds = Number.POSITIVE_INFINITY;
                let end = 0;

                for (let start = 0; start < streamPoints.length; start += 1) {
                    while (end < streamPoints.length && (filledDist[end] - filledDist[start]) < effort.meters!) {
                        end += 1;
                    }
                    if (end < streamPoints.length) {
                        const elapsed = end - start;
                        if (elapsed > 0 && elapsed < bestSeconds) {
                            bestSeconds = elapsed;
                            bestStart = start;
                            bestEnd = end;
                        }
                    }
                }

                if (bestStart >= 0 && bestEnd >= bestStart) {
                    metaByKey[key] = calcMeta(bestStart, bestEnd);
                }
            }
        });

        return metaByKey;
    }, [activity?.best_efforts, streamPoints]);

    // Populated by HardEffortsPanel via onMetaChange — used for chart/map effort focusing
    const hardEffortMetaRef = useRef<Record<string, EffortSegmentMeta>>({});


    const routePositions = useMemo(() => {
        return streamPoints
            .filter((p: any) => p.lat && p.lon)
            .map((p: any) => [p.lat, p.lon] as [number, number]);
    }, [streamPoints]);

    const chartData = useMemo(() => {
        if (!activity || streamPoints.length === 0) return [];
        const startTs = new Date(streamPoints[0]?.timestamp).getTime();
        const isRunningLike = (activity.sport || '').toLowerCase().includes('run');
        const speedUnitFactor = me?.profile?.preferred_units === 'imperial' ? 2.23694 : 3.6;

        const base = streamPoints.map((s: any, index: number) => {
            let pace = null;
            if (isRunningLike && s.speed && s.speed > 0.1) {
                // m/s to min/km or min/mi
                const mpm = s.speed * 60; // meters per minute
                if (me?.profile?.preferred_units === 'imperial') {
                    // 1 mile = ~1609.34 m
                    pace = 1609.34 / mpm;
                } else {
                    pace = 1000 / mpm;
                }
                
                if (pace > 20) pace = null; // Filter outliers (walking/stopped)
            }
            
            // Calculate time in minutes from actual timestamps if available
            let timeMin = index / 60; // fallback
            if (s.timestamp) {
                const ts = new Date(s.timestamp).getTime();
                if (!isNaN(ts)) {
                    timeMin = (ts - startTs) / 60000;
                }
            }

            const prev = index > 0 ? streamPoints[index - 1] : null;
            const prevDistance = Number(prev?.distance);
            const currDistance = Number(s?.distance);
            const prevAltitude = Number(prev?.altitude);
            const currAltitude = Number(s?.altitude);
            let gradientPct: number | null = null;
            if (
                Number.isFinite(prevDistance)
                && Number.isFinite(currDistance)
                && Number.isFinite(prevAltitude)
                && Number.isFinite(currAltitude)
            ) {
                const distanceDeltaM = currDistance - prevDistance;
                if (distanceDeltaM >= 2) {
                    gradientPct = ((currAltitude - prevAltitude) / distanceDeltaM) * 100;
                    if (Number.isFinite(gradientPct)) {
                        gradientPct = Math.max(-35, Math.min(35, gradientPct));
                    }
                }
            }

            return {
                ...s, 
                stream_index: index,
                // Keep numbers for Charting
                distance_km: s.distance 
                    ? (me?.profile?.preferred_units === 'imperial' ? s.distance * 0.000621371 : s.distance / 1000)
                    : 0, 
                time_min: timeMin,
                pace,
                speed_display: Number.isFinite(Number(s.speed)) && Number(s.speed) > 0 ? Number(s.speed) * speedUnitFactor : null,
                power_raw: Number.isFinite(Number(s.power)) ? Number(s.power) : null,
                // running cadence is typically doubled in FIT files (steps per minute vs revolutions)
                // BUT garmin/fit often stores 1-sided vs 2-sided differently. 
                // Usually for running, if cadence is < 120 it's likely single sided steps, > 120 is both steps.
                // Standard convention in runners is steps per minute (SPM), usually 150-190.
                // If the stream data is already full SPM (e.g. 170), use it. 
                // However, user reports "wrong in graph" implying it might be halved (showing ~85-90 instead of ~170-180).
                // Let's multiply by 2 if sport is running and cadence seems low (e.g., < 120 avg).
                // Actually safer to check sport:
                cadence: (activity.sport === 'running' && s.cadence) ? Number(s.cadence) * 2 : Number(s.cadence),
                gradient_pct: gradientPct,
            };
        });

        const smoothed: any[] = [];
        for (let index = 0; index < base.length; index += 1) {
            const point = base[index];
            const start = Math.max(0, index - 4);
            let sum = 0;
            let count = 0;
            for (let i = start; i <= index; i += 1) {
                const value = base[i]?.power_raw;
                if (Number.isFinite(value)) {
                    sum += Number(value);
                    count += 1;
                }
            }
            smoothed.push({
                ...point,
                power_5s: count > 0 ? sum / count : null,
            });
        }
        return smoothed;
    }, [activity, streamPoints, me?.profile?.preferred_units]);

    // --- Range slider for chart zoom (replaces laggy Brush) ---
    const [chartRange, setChartRange] = useState<[number, number]>([0, 100]);
    const visibleChartData = useMemo(() => {
        if (chartData.length === 0) return [];
        const startIdx = Math.round((chartRange[0] / 100) * (chartData.length - 1));
        const endIdx = Math.round((chartRange[1] / 100) * (chartData.length - 1));
        return chartData.slice(startIdx, endIdx + 1);
    }, [chartData, chartRange]);
    const chartRenderData = useMemo(() => {
        const MAX_RENDER_POINTS = 1400;
        if (visibleChartData.length <= MAX_RENDER_POINTS) return visibleChartData;

        const step = Math.max(1, Math.ceil(visibleChartData.length / MAX_RENDER_POINTS));
        const sampled: any[] = [];
        for (let i = 0; i < visibleChartData.length; i += step) {
            sampled.push(visibleChartData[i]);
        }
        const lastPoint = visibleChartData[visibleChartData.length - 1];
        if (sampled[sampled.length - 1] !== lastPoint) {
            sampled.push(lastPoint);
        }
        return sampled;
    }, [visibleChartData]);
    // Reset range when activity changes
    useEffect(() => { setChartRange([0, 100]); }, [activity?.id]);
    const rangeLabel = useMemo(() => {
        if (chartData.length === 0) return ['0', '0'] as [string, string];
        const startIdx = Math.round((chartRange[0] / 100) * (chartData.length - 1));
        const endIdx = Math.round((chartRange[1] / 100) * (chartData.length - 1));
        const fmt = (idx: number) => {
            const t = chartData[idx]?.time_min;
            return t != null ? formatElapsedFromMinutes(t) : '';
        };
        return [fmt(startIdx), fmt(endIdx)] as [string, string];
    }, [chartData, chartRange]);

    const hoveredPoint = useMemo(() => {
        if (hoveredPointIndex === null) return null;
        return chartRenderData[hoveredPointIndex] || null;
    }, [chartRenderData, hoveredPointIndex]);

    // Drag-to-select on chart
    const [chartSelection, setChartSelection] = useState<{ startIdx: number; endIdx: number } | null>(null);
    const isDraggingChartRef = useRef(false);
    const dragStartIdxRef = useRef<number | null>(null);
    useEffect(() => { setChartSelection(null); }, [activity?.id]);
    useEffect(() => { setChartSelection(null); }, [chartRange]);
    useEffect(() => { setMapHoveredChartIndex(null); }, [activity?.id]);
    useEffect(() => { setMapHoveredChartIndex(null); }, [chartRange]);

    const chartSelectionStats = useMemo(() => {
        if (!chartSelection) return null;
        const { startIdx, endIdx } = chartSelection;
        const slice = chartRenderData.slice(startIdx, endIdx + 1);
        if (slice.length < 2) return null;

        const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
        const maximum = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : null;

        const powers = slice.map((p: any) => Number(p.power_raw)).filter((v: number) => v > 0 && Number.isFinite(v));
        const hrs = slice.map((p: any) => Number(p.heart_rate)).filter((v: number) => v > 0 && Number.isFinite(v));
        const paces = slice.map((p: any) => Number(p.pace)).filter((v: number) => v > 0 && Number.isFinite(v));
        const speeds = slice.map((p: any) => Number(p.speed_display)).filter((v: number) => v > 0 && Number.isFinite(v));
        const cadences = slice.map((p: any) => Number(p.cadence)).filter((v: number) => v > 0 && Number.isFinite(v));
        const altitudes = slice.map((p: any) => Number(p.altitude)).filter((v: number) => Number.isFinite(v));
        const gradients = slice.map((p: any) => Number(p.gradient_pct)).filter((v: number) => Number.isFinite(v));

        const wap = powers.length > 0
            ? Math.pow(powers.map((p: number) => Math.pow(p, 4)).reduce((s: number, v: number) => s + v, 0) / powers.length, 0.25)
            : null;

        const elevGain = altitudes.length > 1
            ? altitudes.slice(1).reduce((sum: number, alt: number, i: number) => {
                const diff = alt - altitudes[i];
                return diff > 0 ? sum + diff : sum;
            }, 0)
            : null;

        const durationMin = (slice[slice.length - 1]?.time_min ?? 0) - (slice[0]?.time_min ?? 0);

        const avgGradient = avg(gradients);
        const maxGradient = maximum(gradients);

        return {
            durationMin,
            avgPower: avg(powers),
            maxPower: maximum(powers),
            wap,
            avgHr: avg(hrs),
            maxHr: maximum(hrs),
            avgPace: avg(paces),
            minPace: paces.length > 0 ? Math.min(...paces) : null,
            avgSpeed: avg(speeds),
            maxSpeed: maximum(speeds),
            avgCadence: avg(cadences),
            elevGain,
            avgGradient,
            maxGradient,
        };
    }, [chartSelection, chartRenderData]);

    const interactiveMapRoutePoints = useMemo<RouteInteractivePoint[]>(() => {
        return chartRenderData
            .map((point: any, chartIndex: number) => ({
                chartIndex,
                lat: Number(point?.lat),
                lon: Number(point?.lon),
            }))
            .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    }, [chartRenderData]);

    const selectedChartRoutePositions = useMemo<[number, number][]>(() => {
        if (!chartSelection) return [];
        const points: [number, number][] = [];
        for (let i = chartSelection.startIdx; i <= chartSelection.endIdx; i += 1) {
            const sample = chartRenderData[i];
            if (Number.isFinite(Number(sample?.lat)) && Number.isFinite(Number(sample?.lon))) {
                points.push([Number(sample.lat), Number(sample.lon)]);
            }
        }
        return points;
    }, [chartSelection, chartRenderData]);

    const getMapHeatMetricValue = useCallback((point: any): number | null => {
        if (mapHeatMetric === 'none') return null;

        if (mapHeatMetric === 'speed') {
            const speedDisplay = Number(point?.speed_display);
            if (Number.isFinite(speedDisplay) && speedDisplay > 0) return speedDisplay;
            const speedRaw = Number(point?.speed);
            if (Number.isFinite(speedRaw) && speedRaw > 0) return speedRaw;
            return null;
        }

        if (mapHeatMetric === 'heart_rate') {
            const hr = Number(point?.heart_rate);
            return Number.isFinite(hr) && hr > 0 ? hr : null;
        }

        if (mapHeatMetric === 'power') {
            const powerRaw = Number(point?.power_raw);
            if (Number.isFinite(powerRaw) && powerRaw > 0) return powerRaw;
            const power = Number(point?.power);
            return Number.isFinite(power) && power > 0 ? power : null;
        }

        const gradient = Number(point?.gradient_pct);
        return Number.isFinite(gradient) ? gradient : null;
    }, [mapHeatMetric]);

    const mapHeatRange = useMemo(() => {
        if (mapHeatMetric === 'none') return null;
        const values = chartData
            .map((point: any) => getMapHeatMetricValue(point))
            .filter((value: number | null): value is number => value != null);
        if (values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        let min = sorted[Math.floor((sorted.length - 1) * 0.05)];
        let max = sorted[Math.floor((sorted.length - 1) * 0.95)];
        if (!(max > min)) {
            min = sorted[0];
            max = sorted[sorted.length - 1];
        }
        return { min, max };
    }, [chartData, mapHeatMetric, getMapHeatMetricValue]);

    const mapHeatSegments = useMemo(() => {
        if (mapHeatMetric === 'none' || !mapHeatRange) return [] as Array<{ positions: [number, number][]; color: string }>;
        // Merge consecutive same-color points into a single polyline to reduce Leaflet layer count (5 discrete buckets → O(transitions) instead of O(n))
        const segments: Array<{ positions: [number, number][]; color: string }> = [];
        let currentColor: string | null = null;
        let currentPositions: [number, number][] = [];
        const flush = () => { if (currentPositions.length > 1 && currentColor) segments.push({ positions: currentPositions, color: currentColor }); currentColor = null; currentPositions = []; };
        for (let i = 1; i < chartData.length; i += 1) {
            const left = chartData[i - 1];
            const right = chartData[i];
            const leftLat = Number(left?.lat);
            const leftLon = Number(left?.lon);
            const rightLat = Number(right?.lat);
            const rightLon = Number(right?.lon);
            if (!Number.isFinite(leftLat) || !Number.isFinite(leftLon) || !Number.isFinite(rightLat) || !Number.isFinite(rightLon)) { flush(); continue; }
            const rawValue = getMapHeatMetricValue(right);
            if (rawValue == null) { flush(); continue; }
            const color = getHeatColor(rawValue, mapHeatRange.min, mapHeatRange.max);
            if (color === currentColor) {
                currentPositions.push([rightLat, rightLon]);
            } else {
                flush();
                currentColor = color;
                currentPositions = [[leftLat, leftLon], [rightLat, rightLon]];
            }
        }
        flush();
        return segments;
    }, [chartData, mapHeatMetric, mapHeatRange, getMapHeatMetricValue]);

    const mapHoveredPoint = useMemo(() => {
        if (mapHoveredChartIndex == null) return null;
        return chartRenderData[mapHoveredChartIndex] || null;
    }, [mapHoveredChartIndex, chartRenderData]);

    const handleMapHover = useCallback((chartIndex: number | null) => {
        setMapHoveredChartIndex(chartIndex);
        if (isDraggingMapRef.current) return;
        if (chartIndex === null) {
            hoveredPointIndexRef.current = null;
            setHoveredPointIndex(null);
            return;
        }
        hoveredPointIndexRef.current = chartIndex;
        setHoveredPointIndex(chartIndex);
    }, []);

    const handleMapDragStart = useCallback((chartIndex: number) => {
        isDraggingMapRef.current = true;
        mapDragStartChartIndexRef.current = chartIndex;
        setChartSelection({ startIdx: chartIndex, endIdx: chartIndex });
    }, []);

    const handleMapDrag = useCallback((chartIndex: number) => {
        const startIndex = mapDragStartChartIndexRef.current;
        if (startIndex == null) return;
        const startIdx = Math.min(startIndex, chartIndex);
        const endIdx = Math.max(startIndex, chartIndex);
        if (endIdx - startIdx < 1) return;
        setChartSelection({ startIdx, endIdx });
    }, []);

    const handleMapDragEnd = useCallback(() => {
        isDraggingMapRef.current = false;
        mapDragStartChartIndexRef.current = null;
    }, []);

    /* Fullscreen map: only points with GPS coords, for elevation graph + marker */
    const gpsChartData = useMemo(() => {
        if (!activity) return [];
        const sport = (activity.sport || '').toLowerCase();
        const isCycling = sport.includes('cycl') || sport.includes('bike') || sport.includes('ride');
        return chartData
            .filter((p: any) => p.lat && p.lon)
            .map((p: any) => {
                return {
                    stream_index: p.stream_index,
                    lat: p.lat,
                    lon: p.lon,
                    altitude: p.altitude ?? null,
                    heart_rate: p.heart_rate ?? null,
                    power: p.power ?? null,
                    speedKmh: Number.isFinite(Number(p.speed)) ? Number(p.speed) * 3.6 : null,
                    paceDisplay: !isCycling && Number.isFinite(Number(p.pace))
                        ? `${Math.floor(Number(p.pace))}:${Math.floor((Number(p.pace) - Math.floor(Number(p.pace))) * 60).toString().padStart(2, '0')}/km`
                        : null,
                    gradient_pct: Number.isFinite(Number(p.gradient_pct)) ? Number(p.gradient_pct) : null,
                    timeMin: Number(p.time_min || 0),
                    distance_km: p.distance ? p.distance / 1000 : 0,
                };
            });
    }, [activity, chartData]);

    const focusedEffortMarkerPos = useMemo<[number, number] | null>(() => {
        if (selectedEffortStreamIndex == null || streamPoints.length === 0) return null;
        const maxRadius = Math.max(streamPoints.length, 1);
        for (let radius = 0; radius < maxRadius; radius += 1) {
            const left = selectedEffortStreamIndex - radius;
            if (left >= 0) {
                const p = streamPoints[left];
                if (p?.lat && p?.lon) return [p.lat, p.lon];
            }
            if (radius === 0) continue;
            const right = selectedEffortStreamIndex + radius;
            if (right < streamPoints.length) {
                const p = streamPoints[right];
                if (p?.lat && p?.lon) return [p.lat, p.lon];
            }
        }
        return null;
    }, [selectedEffortStreamIndex, streamPoints]);

    const selectedEffortRoutePositions = useMemo<[number, number][]>(() => {
        if (!selectedEffortKey) return [];
        const meta = bestEffortMetaByKey[selectedEffortKey] ?? hardEffortMetaRef.current[selectedEffortKey];
        if (!meta) return [];

        const points: [number, number][] = [];
        for (let i = meta.startIndex; i <= meta.endIndex; i += 1) {
            const sample = streamPoints[i];
            if (sample?.lat && sample?.lon) {
                points.push([sample.lat, sample.lon]);
            }
        }
        return points;
    }, [selectedEffortKey, bestEffortMetaByKey, streamPoints]);

    const activeMapMarkerPoint = useMemo(() => {
        if (mapHoveredPoint) return mapHoveredPoint;
        if (!focusedEffortMarkerPos) return null;
        return {
            lat: focusedEffortMarkerPos[0],
            lon: focusedEffortMarkerPos[1],
            time_min: null,
            distance_km: null,
            heart_rate: null,
            speed_display: null,
            pace: null,
            power: null,
            altitude: null,
            gradient_pct: null,
        };
    }, [mapHoveredPoint, focusedEffortMarkerPos]);

    const activeMapMarkerPos = useMemo<[number, number] | null>(() => {
        if (!activeMapMarkerPoint) return null;
        if (!Number.isFinite(Number(activeMapMarkerPoint?.lat)) || !Number.isFinite(Number(activeMapMarkerPoint?.lon))) return null;
        return [Number(activeMapMarkerPoint.lat), Number(activeMapMarkerPoint.lon)];
    }, [activeMapMarkerPoint]);

    const focusEffortByKey = useCallback((effortKey: string, openFullscreenMap = true) => {
        const meta = bestEffortMetaByKey[effortKey] ?? hardEffortMetaRef.current[effortKey];
        if (!meta) return;
        setSelectedEffortKey(effortKey);
        setSelectedEffortStreamIndex(meta.centerIndex);

        if (openFullscreenMap) {
            setMapFullscreen(true);
            let fsIdx = -1;
            for (let i = 0; i < gpsChartData.length; i += 1) {
                if (gpsChartData[i].stream_index === meta.centerIndex) {
                    fsIdx = i;
                    break;
                }
            }
            if (fsIdx >= 0) {
                setFsMapIndex(fsIdx);
                return;
            }
            const midpointDistance = meta.meters != null
                ? meta.meters / 2 + Number(streamPoints[meta.startIndex]?.distance || 0)
                : Number(streamPoints[meta.centerIndex]?.distance || 0);
            if (Number.isFinite(midpointDistance)) {
                let nearestIdx = -1;
                let nearestDelta = Number.POSITIVE_INFINITY;
                for (let idx = 0; idx < gpsChartData.length; idx += 1) {
                    const point = gpsChartData[idx];
                    const d = Number(point.distance_km) * 1000;
                    const delta = Math.abs(d - midpointDistance);
                    if (delta < nearestDelta) {
                        nearestDelta = delta;
                        nearestIdx = idx;
                    }
                }
                setFsMapIndex(nearestIdx >= 0 ? nearestIdx : null);
            }
        }
    }, [bestEffortMetaByKey, gpsChartData, streamPoints]);

    const selectedEffortElevBounds = useMemo<{ x1: number; x2: number } | null>(() => {
        if (!selectedEffortKey) return null;
        const meta = bestEffortMetaByKey[selectedEffortKey] ?? hardEffortMetaRef.current[selectedEffortKey];
        if (!meta) return null;
        let x1: number | null = null;
        let x2: number | null = null;
        for (const pt of gpsChartData) {
            if (pt.stream_index >= meta.startIndex && pt.stream_index <= meta.endIndex) {
                if (x1 === null) x1 = pt.distance_km;
                x2 = pt.distance_km;
            }
        }
        if (x1 === null || x2 === null) return null;
        return { x1, x2 };
    }, [selectedEffortKey, bestEffortMetaByKey, gpsChartData]);

    const fsMapPoint = useMemo(() => {
        if (fsMapIndex === null || !chartRenderData[fsMapIndex]) return null;
        const p = chartRenderData[fsMapIndex];
        const isImperial = me?.profile?.preferred_units === 'imperial';
        const sport = (activity?.sport || '').toLowerCase();
        const isCycling = sport.includes('cycl') || sport.includes('bike') || sport.includes('ride');
        return {
            timeMin: Number(p.time_min || 0),
            heart_rate: p.heart_rate ?? null,
            paceDisplay: !isCycling && Number.isFinite(Number(p.pace))
                ? `${Math.floor(Number(p.pace))}:${Math.floor((Number(p.pace) - Math.floor(Number(p.pace))) * 60).toString().padStart(2, '0')}${isImperial ? '/mi' : '/km'}`
                : null,
            speedKmh: Number.isFinite(Number(p.speed_display))
                ? (isImperial ? Number(p.speed_display) * 1.60934 : Number(p.speed_display))
                : null,
            power: p.power ?? null,
            altitude: p.altitude ?? null,
            gradient_pct: p.gradient_pct ?? null,
            lat: p.lat,
            lon: p.lon,
        };
    }, [fsMapIndex, chartRenderData, me?.profile?.preferred_units, activity?.sport]);

    const fullscreenMarkerPoint = useMemo(() => {
        if (mapHoveredPoint) {
            const sport = (activity?.sport || '').toLowerCase();
            const isCycling = sport.includes('cycl') || sport.includes('bike') || sport.includes('ride');
            return {
                timeMin: Number(mapHoveredPoint.time_min || 0),
                heart_rate: mapHoveredPoint.heart_rate ?? null,
                paceDisplay: !isCycling && Number.isFinite(Number(mapHoveredPoint.pace))
                    ? `${Math.floor(Number(mapHoveredPoint.pace))}:${Math.floor((Number(mapHoveredPoint.pace) - Math.floor(Number(mapHoveredPoint.pace))) * 60).toString().padStart(2, '0')}/km`
                    : null,
                speedKmh: Number.isFinite(Number(mapHoveredPoint.speed_display))
                    ? (me?.profile?.preferred_units === 'imperial' ? Number(mapHoveredPoint.speed_display) * 1.60934 : Number(mapHoveredPoint.speed_display))
                    : null,
                power: mapHoveredPoint.power ?? null,
                altitude: mapHoveredPoint.altitude ?? null,
                gradient_pct: mapHoveredPoint.gradient_pct ?? null,
                lat: mapHoveredPoint.lat,
                lon: mapHoveredPoint.lon,
            };
        }
        return fsMapPoint;
    }, [mapHoveredPoint, fsMapPoint, me?.profile?.preferred_units, activity?.sport]);

    const fullscreenMarkerPos = useMemo<[number, number] | null>(() => {
        if (!fullscreenMarkerPoint) return null;
        if (!Number.isFinite(Number(fullscreenMarkerPoint.lat)) || !Number.isFinite(Number(fullscreenMarkerPoint.lon))) return null;
        return [Number(fullscreenMarkerPoint.lat), Number(fullscreenMarkerPoint.lon)];
    }, [fullscreenMarkerPoint]);

    const handleFsElevationMove = useCallback((state: any) => {
        const idx = state?.activeTooltipIndex;
        if (typeof idx === 'number' && Number.isFinite(idx)) {
            setFsMapIndex(idx);
        }
    }, []);

    const handleFsElevationLeave = useCallback(() => {
        setFsMapIndex(null);
    }, []);

    const handleFsChartMove = useCallback((state: any) => {
        const idx = state?.activeTooltipIndex;
        if (typeof idx !== 'number' || !Number.isFinite(idx)) return;
        if (isFsDraggingRef.current) return;
        setFsMapIndex(idx);
    }, []);

    const handleFsChartLeave = useCallback(() => {
        isFsDraggingRef.current = false;
        fsDragStartIdxRef.current = null;
        setFsMapIndex(null);
    }, []);

    const handleSharedChartMouseMove = (state: any) => {
        const idx = state?.activeTooltipIndex;
        if (typeof idx !== 'number' || !Number.isFinite(idx)) return;

        // Suppress hover tooltip while dragging (selection handled by native Box events)
        if (isDraggingChartRef.current) return;

        if (idx === hoveredPointIndexRef.current || idx === pendingHoveredPointIndexRef.current) return;
        pendingHoveredPointIndexRef.current = idx;
        if (hoveredPointRafRef.current !== null) return;
        hoveredPointRafRef.current = window.requestAnimationFrame(() => {
            hoveredPointRafRef.current = null;
            const next = pendingHoveredPointIndexRef.current;
            pendingHoveredPointIndexRef.current = null;
            if (typeof next !== 'number' || !Number.isFinite(next)) return;
            if (next === hoveredPointIndexRef.current) return;
            hoveredPointIndexRef.current = next;
            setHoveredPointIndex(next);
        });
    };

    const handleSharedChartMouseLeave = () => {
        pendingHoveredPointIndexRef.current = null;
        if (hoveredPointRafRef.current !== null) {
            window.cancelAnimationFrame(hoveredPointRafRef.current);
            hoveredPointRafRef.current = null;
        }
        if (hoveredPointIndexRef.current === null) return;
        hoveredPointIndexRef.current = null;
        setHoveredPointIndex(null);
    };

    useEffect(() => {
        return () => {
            if (hoveredPointRafRef.current !== null) {
                window.cancelAnimationFrame(hoveredPointRafRef.current);
                hoveredPointRafRef.current = null;
            }
        };
    }, []);

    const renderMetricTooltip = (
        point: any,
        valueLabel: string,
        value: string,
    ) => {
        if (!point) return null;
        return (
            <Paper withBorder p={6} radius="sm" bg={ui.surfaceAlt}>
                <Text size="xs" c={ui.textDim} fw={600} mb={4}>
                    {formatElapsedFromMinutes(point.time_min)}
                </Text>
                <Text size="xs" c={ui.textMain}>
                    {valueLabel}: {value}
                </Text>
            </Paper>
        );
    };

    const hrTooltipContent = () => {
        const point = hoveredPoint;
        if (!point) return null;
        const value = Number(point.heart_rate);
        return renderMetricTooltip(point, 'HR', Number.isFinite(value) ? `${Math.round(value)} bpm` : '-');
    };

    const paceTooltipContent = () => {
        const point = hoveredPoint;
        if (!point) return null;
        const value = Number(point.pace);
        if (!Number.isFinite(value)) return renderMetricTooltip(point, 'Pace', '-');
        const m = Math.floor(value);
        const s = Math.floor((value - m) * 60);
        return renderMetricTooltip(point, 'Pace', `${m}:${s.toString().padStart(2, '0')}${me?.profile?.preferred_units === 'imperial' ? '/mi' : '/km'}`);
    };

    const powerTooltipContent = () => {
        const point = hoveredPoint;
        if (!point) return null;
        const value = Number(point.power);
        return renderMetricTooltip(point, 'Power', Number.isFinite(value) ? `${Math.round(value)} W` : '-');
    };

    const cadenceTooltipContent = () => {
        const point = hoveredPoint;
        if (!point) return null;
        const value = Number(point.cadence);
        return renderMetricTooltip(point, 'Cadence', Number.isFinite(value) ? `${Math.round(value)} rpm` : '-');
    };

    const altitudeTooltipContent = () => {
        const point = hoveredPoint;
        if (!point) return null;
        const value = Number(point.altitude);
        return renderMetricTooltip(point, 'Elev', Number.isFinite(value) ? `${Math.round(value)} m` : '-');
    };

    const supportsPaceSeries = useMemo(() => {
        const sportName = (activity?.sport || '').toLowerCase();
        return sportName.includes('run');
    }, [activity?.sport]);

    const supportsSpeedSeries = useMemo(() => {
        return chartData.some((point: any) => Number.isFinite(Number(point?.speed_display)) && Number(point.speed_display) > 0);
    }, [chartData]);

    const plannedSummary = activity?.planned_comparison?.summary;

    const executionTraceRows = useMemo(() => {
        const traceRows = plannedSummary?.execution_trace?.components;
        if (Array.isArray(traceRows) && traceRows.length > 0) {
            return traceRows.map((row) => {
                const weightPctRaw = Number(row?.weight_pct);
                const weightFractionRaw = Number(row?.weight_fraction);
                const weightPct = Number.isFinite(weightPctRaw)
                    ? weightPctRaw
                    : (Number.isFinite(weightFractionRaw) ? weightFractionRaw * 100 : 0);

                const componentScoreRaw = Number(row?.component_score_pct);
                const weightedPointsRaw = Number(row?.weighted_points);
                const normalizedContributionRaw = Number(row?.normalized_contribution_pct);

                return {
                    key: (row?.key || '').toString() || 'unknown',
                    label: (row?.label || row?.key || 'Component').toString(),
                    available: Boolean(row?.available),
                    weightPct,
                    componentScorePct: Number.isFinite(componentScoreRaw) ? componentScoreRaw : null,
                    weightedPoints: Number.isFinite(weightedPointsRaw) ? weightedPointsRaw : null,
                    normalizedContributionPct: Number.isFinite(normalizedContributionRaw) ? normalizedContributionRaw : null,
                    note: row?.note || null,
                };
            });
        }

        const fallbackWeights: Record<string, number> = {
            duration: 35,
            distance: 20,
            intensity: 35,
            splits: 10,
        };
        const fallbackLabels: Record<string, string> = {
            duration: 'Duration Match',
            distance: 'Distance Match',
            intensity: 'Intensity Match',
            splits: 'Split Adherence',
        };
        const components = plannedSummary?.execution_components || {};

        return Object.entries(fallbackWeights).map(([key, weightPct]) => {
            const raw = Number((components as Record<string, number>)[key]);
            const available = Number.isFinite(raw);
            const weightedPoints = available ? (raw * weightPct) / 100 : null;
            return {
                key,
                label: fallbackLabels[key] || key,
                available,
                weightPct,
                componentScorePct: available ? raw : null,
                weightedPoints,
                normalizedContributionPct: null,
                note: available ? null : 'Excluded from this score because data is unavailable or not applicable.',
            };
        });
    }, [plannedSummary]);

    const executionTraceMeta = useMemo(() => {
        const trace = plannedSummary?.execution_trace;
        const usedWeightPctRaw = Number(trace?.used_weight_pct);
        const weightedTotalRaw = Number(trace?.weighted_total_points);
        const normalizationDivisorRaw = Number(trace?.normalization_divisor);

        const usedWeightPct = Number.isFinite(usedWeightPctRaw)
            ? usedWeightPctRaw
            : executionTraceRows
                .filter((row) => row.available)
                .reduce((sum, row) => sum + row.weightPct, 0);

        const weightedTotalPoints = Number.isFinite(weightedTotalRaw)
            ? weightedTotalRaw
            : executionTraceRows
                .map((row) => row.weightedPoints)
                .filter((val): val is number => typeof val === 'number' && Number.isFinite(val))
                .reduce((sum, value) => sum + value, 0);

        const normalizationDivisor = Number.isFinite(normalizationDivisorRaw)
            ? normalizationDivisorRaw
            : (usedWeightPct > 0 ? usedWeightPct / 100 : 0);

        const reconstructedScorePct = normalizationDivisor > 0
            ? weightedTotalPoints / normalizationDivisor
            : null;

        const thresholds = Array.isArray(trace?.status_thresholds) && trace?.status_thresholds.length > 0
            ? trace.status_thresholds
                  .map((row) => ({
                      status: (row?.status || '').toString(),
                      minScorePct: Number(row?.min_score_pct),
                  }))
                  .filter((row) => row.status && Number.isFinite(row.minScorePct))
            : [
                  { status: 'great', minScorePct: 92 },
                  { status: 'good', minScorePct: 82 },
                  { status: 'ok', minScorePct: 72 },
                  { status: 'fair', minScorePct: 62 },
                  { status: 'subpar', minScorePct: 50 },
                  { status: 'poor', minScorePct: 35 },
                  { status: 'incomplete', minScorePct: 0 },
              ];

        return {
            usedWeightPct,
            weightedTotalPoints,
            normalizationDivisor,
            reconstructedScorePct,
            thresholds,
        };
    }, [executionTraceRows, plannedSummary]);

    const HR_ZONE_COLORS = ['#22C55E', '#84CC16', '#EAB308', '#F59E0B', '#F97316', '#EF4444', '#B91C1C'];

    const hrZoneData = useMemo(() => {
        const maxHr = Number(zoneProfile?.max_hr || activity?.max_hr || 190);
        const sport = (activity?.sport || '').toLowerCase();
        const sportKey = sport.includes('cycl') || sport.includes('bike') || sport.includes('ride')
            ? 'cycling'
            : sport.includes('swim')
                ? 'swimming'
                : 'running';
        const { rows, upperBounds } = getHrZoneClassifierBounds(zoneProfile, sportKey, maxHr);
        const zoneCount = rows.length;
        const zoneSeconds = Object.fromEntries(Array.from({ length: zoneCount }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;

        const classifyHr = (hr: number): number => {
            for (let i = 0; i < upperBounds.length; i += 1) {
                if (hr <= upperBounds[i]) return i + 1;
            }
            return Math.max(1, zoneCount);
        };

        const hrSamples = streamPoints
            .map((sample: any) => ({
                hr: Number(sample?.heart_rate || 0),
                ts: sample?.timestamp ? new Date(sample.timestamp).getTime() : NaN,
            }))
            .filter((sample: { hr: number }) => Number.isFinite(sample.hr) && sample.hr > 0);

        if (hrSamples.length > 0) {
            const fallbackSeconds = activity?.duration && activity.duration > 0
                ? Math.max(0.25, activity.duration / Math.max(hrSamples.length, 1))
                : 1;

            for (let i = 0; i < hrSamples.length; i += 1) {
                const current = hrSamples[i];
                const next = hrSamples[i + 1];

                let sampleSeconds = fallbackSeconds;
                if (Number.isFinite(current.ts) && Number.isFinite(next?.ts)) {
                    const delta = (Number(next.ts) - Number(current.ts)) / 1000;
                    if (Number.isFinite(delta) && delta > 0) {
                        sampleSeconds = Math.min(5, Math.max(0.25, delta));
                    }
                }

                const zone = classifyHr(current.hr);
                zoneSeconds[`Z${zone}`] += sampleSeconds;
            }
        } else if (activity?.average_hr && activity?.duration) {
            const zone = classifyHr(Number(activity.average_hr));
            zoneSeconds[`Z${zone}`] += Math.round(activity.duration);
        }

        return Array.from({ length: zoneCount }, (_, idx) => {
            const zone = `Z${idx + 1}`;
            const range = formatHrZoneLabel(zoneProfile, sportKey, idx + 1, maxHr) || '-';
            return { zone, seconds: zoneSeconds[zone] || 0, range };
        });
    }, [activity, streamPoints, zoneProfile]);

    const POWER_CURVE_KEY_LABELS = new Set(['1s','5s','10s','30s','1min','5min','10min','20min','30min','60min','90min','120min']);
    const _pcLabelToSec = (label: string): number => {
        const m = label.match(/^(\d+)(s|min)$/);
        if (!m) return 0;
        return Number(m[1]) * (m[2] === 'min' ? 60 : 1);
    };
    const prPowerMap = useMemo(() => {
        if (!prData?.power) return {} as Record<string, number>;
        const out: Record<string, number> = {};
        for (const [w, entries] of Object.entries(prData.power as Record<string, Array<{value: number}>>)) {
            const best = entries[0]?.value;
            if (best) out[w] = best;
        }
        return out;
    }, [prData]);
    const powerCurveData = useMemo(() => {
        if (!activity?.power_curve) return [];
        return Object.entries(activity.power_curve)
            .map(([label, watts]) => ({
                label,
                watts,
                prWatts: prPowerMap[label] ?? null,
            }))
            .sort((a, b) => _pcLabelToSec(a.label) - _pcLabelToSec(b.label));
    }, [activity, prPowerMap]);

    const runningPaceZoneData = useMemo(() => {
        const sportName = (activity?.sport || '').toLowerCase();
        if (!sportName.includes('run')) return [];

        const zoneSeconds = Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
        const lt2PaceMinPerKm = Number(me?.profile?.lt2) || (activity?.avg_speed ? 1000 / (activity.avg_speed * 60) : 0);

        const paceZoneFromSpeed = (speed: number) => {
            if (!speed || speed <= 0 || !lt2PaceMinPerKm) return null;
            const paceMinPerKm = 1000 / (speed * 60);
            const pct = (paceMinPerKm / lt2PaceMinPerKm) * 100;
            if (pct >= 120) return 'Z1';
            if (pct >= 110) return 'Z2';
            if (pct >= 103) return 'Z3';
            if (pct >= 97) return 'Z4';
            if (pct >= 90) return 'Z5';
            if (pct >= 84) return 'Z6';
            return 'Z7';
        };

        const validSpeedSamples = streamPoints
            .map((sample: any) => Number(sample?.speed || 0))
            .filter((speed: number) => Number.isFinite(speed) && speed > 0.1);

        if (validSpeedSamples.length > 0) {
            const secondsPerSample = activity?.duration && activity.duration > 0 ? activity.duration / validSpeedSamples.length : 1;
            validSpeedSamples.forEach((speed: number) => {
                const zone = paceZoneFromSpeed(speed);
                if (zone) zoneSeconds[zone] += Math.round(secondsPerSample);
            });
        } else if (activity?.avg_speed && activity.duration) {
            const zone = paceZoneFromSpeed(activity.avg_speed);
            if (zone) zoneSeconds[zone] += Math.round(activity.duration);
        }

        return Array.from({ length: 7 }, (_, idx) => {
            const key = `Z${idx + 1}`;
            return {
                zone: key,
                seconds: zoneSeconds[key]
            };
        });
    }, [activity, streamPoints, me?.profile?.lt2]);

    const cyclingPowerZoneData = useMemo(() => {
        const sportName = (activity?.sport || '').toLowerCase();
        if (!sportName.includes('cycl') && !sportName.includes('bike') && !sportName.includes('ride')) return [];

        const zoneSeconds = Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;

        let ftp = Number(activity?.ftp_at_time || me?.profile?.ftp || 0);
        if (ftp <= 0 && activity?.power_curve?.['20min']) {
            ftp = Number(activity.power_curve['20min']) * 0.95;
        }
        if (ftp <= 0 && activity?.average_watts) {
            ftp = Number(activity.average_watts) / 0.75;
        }

        const zoneFromPower = (watts: number) => {
            if (!ftp || ftp <= 0) return null;
            const pct = (watts / ftp) * 100;
            if (pct <= 55) return 'Z1';
            if (pct <= 75) return 'Z2';
            if (pct <= 90) return 'Z3';
            if (pct <= 105) return 'Z4';
            if (pct <= 120) return 'Z5';
            if (pct <= 150) return 'Z6';
            return 'Z7';
        };

        const validPowerSamples = streamPoints
            .map((sample: any) => Number(sample?.power ?? sample?.watts ?? sample?.avg_watts ?? -1))
            .filter((watts: number) => Number.isFinite(watts) && watts >= 0);

        if (ftp > 0 && validPowerSamples.length > 0) {
            const secondsPerSample = activity?.duration && activity.duration > 0 ? activity.duration / validPowerSamples.length : 1;
            validPowerSamples.forEach((watts: number) => {
                const zone = zoneFromPower(watts);
                if (zone) zoneSeconds[zone] += Math.round(secondsPerSample);
            });
        } else if (ftp > 0 && activity?.average_watts && activity?.duration) {
            const zone = zoneFromPower(activity.average_watts);
            if (zone) zoneSeconds[zone] += Math.round(activity.duration);
        }

        return Array.from({ length: 7 }, (_, idx) => {
            const key = `Z${idx + 1}`;
            return {
                zone: key,
                seconds: zoneSeconds[key]
            };
        });
    }, [activity, streamPoints, me?.profile?.ftp]);

    const openZoneExplanation = (metric: 'hr' | 'pace' | 'power', zone: string) => {
        const metricLabel = metric === 'hr' ? 'Heart Rate' : metric === 'pace' ? 'Pace' : 'Power';
        const zoneNum = Number(zone.replace('Z', ''));
        if (!Number.isFinite(zoneNum)) return;

        const hrDescriptions = [
            'Very easy recovery effort. Conversation is effortless and breathing is very light.',
            'Easy aerobic endurance. Comfortable, sustainable pace for long sessions.',
            'Steady aerobic / tempo. Controlled but noticeably harder than endurance pace.',
            'Threshold-focused work. Hard effort, speaking becomes limited.',
            'High-intensity / near-max effort. Short, demanding intervals.',
            'Very high intensity. Approaching maximal aerobic capacity.',
            'Maximal effort. All-out sprint or peak intensity.'
        ];

        const paceDescriptions = [
            'Very easy aerobic pace.',
            'Easy endurance pace.',
            'Steady aerobic pace.',
            'Around threshold pace (LT2 vicinity).',
            'Sub-threshold to VO2 transition.',
            'VO2-focused hard pace.',
            'Neuromuscular / sprint-end pace.'
        ];

        const powerDescriptions = [
            'Active recovery (<55% FTP).',
            'Endurance (56-75% FTP).',
            'Tempo (76-90% FTP).',
            'Threshold (91-105% FTP).',
            'VO2max (106-120% FTP).',
            'Anaerobic capacity (121-150% FTP).',
            'Neuromuscular / sprint (>150% FTP).'
        ];

        const body = metric === 'hr'
            ? (hrDescriptions[zoneNum - 1] || 'Zone description unavailable.')
            : metric === 'pace'
                ? (paceDescriptions[zoneNum - 1] || 'Zone description unavailable.')
                : (powerDescriptions[zoneNum - 1] || 'Zone description unavailable.');

        setZoneInfoTitle(`${metricLabel} ${zone}`);
        setZoneInfoBody(body);
        setZoneInfoOpen(true);
    };
    
    const formatPace = (speed: number) => {
        if (!speed || speed <= 0) return '-';
        const pace = 1000 / (speed * 60); // min/km
        const m = Math.floor(pace);
        const s = Math.floor((pace - m) * 60);
        return `${m}:${s.toString().padStart(2, '0')}/km`;
    };

    const overallNormalizedPower = useMemo(() => {
        const powerSamples = streamPoints
            .map((sample: any) => Number(sample?.power ?? -1))
            .filter((value: number) => Number.isFinite(value) && value >= 0);
        return calculateNormalizedPower(powerSamples);
    }, [streamPoints]);

    const cyclingPerfMetrics = useMemo(() => {
        if (!activity) return null;
        const sport = (activity.sport || '').toLowerCase();
        const isCycling = sport.includes('cycl') || sport.includes('bike') || sport.includes('ride') || sport.includes('virtualride');
        if (!isCycling) return null;
        const np = overallNormalizedPower;
        const ftp = activity.ftp_at_time ?? (me?.profile?.ftp as number | undefined | null);
        if (!np || !ftp || ftp <= 0) return null;
        const intensityFactor = np / ftp;
        const durationSec = activity.duration ?? 0;
        const tss = durationSec > 0 ? (durationSec * np * intensityFactor) / (ftp * 3600) * 100 : null;
        const avgWatts = activity.average_watts;
        const vi = avgWatts && avgWatts > 0 ? np / avgWatts : null;
        return { intensityFactor, tss, vi };
    }, [activity, overallNormalizedPower, me?.profile?.ftp]);

    useEffect(() => {
        if (!activity) return;
        setActivityRpe(activity.rpe ?? null);
        setActivityNotes(activity.notes || '');
    }, [activity?.id, activity?.rpe, activity?.notes]);

    // Auto-select efforts vs splits view based on available data
    useEffect(() => {
        if (!activity) return;
        const hasEfforts = Boolean(activity.best_efforts?.length);
        const hasSplits = Boolean(activity.splits_metric?.length || activity.laps?.length);
        if (hasEfforts) {
            setEffortsSplitsView('efforts');
        } else if (hasSplits) {
            setEffortsSplitsView('splits');
        }
    }, [activity]);

    useEffect(() => {
        const key = returnState.focusEffort?.key;
        if (!key || !activity?.best_efforts?.length) return;
        if (!bestEffortMetaByKey[key]) return;
        setActiveSection('best_efforts');
        focusEffortByKey(key, true);
    }, [activity?.id, activity?.best_efforts?.length, bestEffortMetaByKey, returnState.focusEffort?.key, focusEffortByKey]);
    
    // Calculated Stats for activities where backend summary is missing (legacy compat)
    const derivedStats = useMemo(() => {
        if (!activity || !activity.streams || activity.max_hr) return null;
        
        let max_hr = 0;
        let max_watts = 0;
        let max_cadence = 0;
        let max_speed = 0;
        let sum_cadence = 0;
        let count_cadence = 0;
        let total_ascent = 0;
        let prev_alt: number | null = null;
        let total_calories = 0;
        
        activity.streams.forEach((s: any) => {
            if (s.heart_rate && s.heart_rate > max_hr) max_hr = s.heart_rate;
            if (s.power && s.power > max_watts) max_watts = s.power;
            if (s.cadence && s.cadence > max_cadence) max_cadence = s.cadence;
            if (s.speed && s.speed > max_speed) max_speed = s.speed;
            
            if (s.cadence && s.cadence > 0) {
                sum_cadence += s.cadence;
                count_cadence++;
            }
            
            if (s.altitude !== undefined && s.altitude !== null) {
                if (prev_alt !== null && s.altitude > prev_alt) {
                    total_ascent += (s.altitude - prev_alt);
                }
                prev_alt = s.altitude;
            }
        });
        
        // Calories estimate if missing (very rough: W * sec / 1000 * 1.1)
        if (!activity.total_calories && activity.average_watts && activity.duration) {
            total_calories = (activity.average_watts * activity.duration / 1000) * 1.1; // roughly kJ to kcal? No, 1 kJ ~ 0.24 kcal. 
            // Wait, 1 Ws = 1 J. 1000 Ws = 1 kJ. 
            // Efficiency ~20-25%. So Energy Expended (kcal) ~= Work (kJ).
            // Usually 1:1 ratio is a good approximation for cycling. 
            // For running it's weight * dist. 
            // Let's rely on backend for correct calc, this is just fallback.
            // Using 1:1 Work(kJ) -> kcal
             total_calories = (activity.average_watts * activity.duration) / 1000;
        }

        return {
            max_hr,
            max_watts,
            max_cadence,
            max_speed,
            avg_cadence: count_cadence > 0 ? sum_cadence / count_cadence : 0,
            total_elevation_gain: total_ascent,
            total_calories
        };
    }, [activity]);

    const displayStats = {
        ...activity,
        max_hr: activity?.max_hr || derivedStats?.max_hr,
        max_watts: activity?.max_watts || derivedStats?.max_watts,
        max_cadence: activity?.max_cadence || derivedStats?.max_cadence,
        max_speed: activity?.max_speed || derivedStats?.max_speed,
        avg_cadence: activity?.avg_cadence || derivedStats?.avg_cadence,
        total_elevation_gain: activity?.total_elevation_gain || derivedStats?.total_elevation_gain,
        total_calories: activity?.total_calories || derivedStats?.total_calories
    };

    useEffect(() => {
        setCompletionPulse(true);
        const timer = window.setTimeout(() => setCompletionPulse(false), 900);
        return () => window.clearTimeout(timer);
    }, [activity?.id]);

    useEffect(() => {
        if (supportsPaceSeries) return;
        setVisibleSeries((prev) => (prev.pace ? { ...prev, pace: false } : prev));
    }, [supportsPaceSeries]);

    useEffect(() => {
        if (supportsSpeedSeries) return;
        setVisibleSeries((prev) => (prev.speed ? { ...prev, speed: false } : prev));
    }, [supportsSpeedSeries]);

    const focusSeries = useMemo(() => {
        if (!focusMode) {
            return {
                ...visibleSeries,
                pace: supportsPaceSeries ? visibleSeries.pace : false,
                speed: supportsSpeedSeries ? visibleSeries.speed : false,
            };
        }
        if (focusObjective === 'cardio') {
            return {
                heart_rate: true,
                power: false,
                pace: supportsPaceSeries,
                speed: false,
                cadence: false,
                altitude: false
            };
        }
        if (focusObjective === 'efficiency') {
            return {
                heart_rate: true,
                power: true,
                pace: false,
                speed: false,
                cadence: true,
                altitude: false
            };
        }
        return {
            heart_rate: true,
            power: false,
            pace: supportsPaceSeries,
            speed: true,
            cadence: false,
            altitude: true
        };
    }, [focusMode, focusObjective, visibleSeries, supportsPaceSeries, supportsSpeedSeries]);


    if (isLoading) return <ActivityDetailSkeleton />;
    if (isError || !activity) {
        return (
            <Container my={60}>
                <Stack align="center" gap="md">
                    <Text c="red" fw={500}>{t("Error loading activity.")}</Text>
                    <Text size="sm" c="dimmed">{t("The server may be temporarily unavailable. Please try again.")}</Text>
                    <Group>
                        <Button variant="light" onClick={handleBack} leftSection={<IconArrowLeft size={16} />}>
                            {t("Go back")}
                        </Button>
                        <Button variant="filled" onClick={() => refetch()}>
                            {t("Retry")}
                        </Button>
                    </Group>
                    <SupportContactButton
                        buttonText={t("Contact support")}
                        pageLabel="Activity detail"
                        errorMessage={t("Error loading activity.")}
                    />
                </Stack>
            </Container>
        );
    }

    const sportName = (activity.sport || '').toLowerCase();
    const isRunningActivity = sportName.includes('run');
    const isCyclingActivity = sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride') || sportName.includes('virtualride');

    const centerPos = routePositions.length > 0 ? routePositions[Math.floor(routePositions.length / 2)] : [51.505, -0.09] as [number, number];

    return (
        <AppShell header={{ height: 60 }} padding="md">
            <AppShell.Header
                p="md"
                style={{
                    background: ui.headerBg,
                    borderBottom: `1px solid ${ui.border}`
                }}
            >
                <Group justify="space-between" style={{ flex: 1 }}>
                    <Group>
                        <ActionIcon variant="subtle" onClick={handleBack} radius="md" color="gray"><IconArrowLeft size={18} /></ActionIcon>
                        <Title order={4} c={ui.textMain}>{activity.filename}</Title>
                        <Text size="sm" c={ui.textDim} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <IconClock size={14} />
                            {(() => {
                                const raw = streamPoints[0]?.timestamp || activity.created_at;
                                if (!raw) return '';
                                const dt = new Date(raw);
                                if (Number.isNaN(dt.getTime())) return '';
                                const tz = me?.profile?.timezone || undefined;
                                return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: tz })
                                    + ' ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz });
                            })()}
                        </Text>
                        <Badge color={activity.sport === 'running' ? 'green' : 'blue'} variant="light">{activity.sport || 'activity'}</Badge>
                        {activity.is_deleted && <Badge color="red" variant="light">Deleted</Badge>}
                        {activity.strava_activity_url && (
                            <Anchor href={activity.strava_activity_url} target="_blank" rel="noopener noreferrer" size="xs" fw={600} c="#FC5200" style={{ textDecoration: 'underline' }}>
                                {t("View on Strava")} <IconExternalLink size={12} style={{ verticalAlign: 'middle' }} />
                            </Anchor>
                        )}
                    </Group>
                    <MantineTooltip label={t("Share to Chat")}>
                        <ActionIcon variant="light" color="indigo" radius="md" onClick={() => setShareModalOpen(true)}>
                            <IconShare size={16} />
                        </ActionIcon>
                    </MantineTooltip>
                </Group>
            </AppShell.Header>
            <AppShell.Main bg={ui.pageBg}>
                <Container size="xl" py="sm" px={{ base: "xs", sm: "md" }}>
                    {completionPulse && (
                        <Paper withBorder p="sm" mb="md" bg={isDark ? 'rgba(124,255,178,0.1)' : 'green.0'} style={{ borderColor: ui.border }} radius="lg">
                            <Group justify="space-between">
                                <Text fw={600} size="sm">Workout complete</Text>
                                <Text size="xs" c="dimmed">Planned vs actual is ready to review</Text>
                            </Group>
                        </Paper>
                    )}
                    <SimpleGrid cols={{ base: 2, sm: 2, md: 4 }} mb="md" spacing="sm" verticalSpacing="sm">
                        <Card
                            withBorder
                            padding="lg"
                            radius="lg"
                            bg={ui.surfaceAlt}
                            style={{ borderColor: ui.border }}
                        >
                            <ThemeIcon size="lg" radius="md" variant="light" color="blue" mb="xs">
                                <IconMap size={20} />
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Distance</Text>
                            <Text size="xl" fw={800} c={ui.textMain}>
                                {me?.profile?.preferred_units === 'imperial' 
                                    ? <>{(activity.distance * 0.000621371).toFixed(2)} mi</>
                                    : <>{(activity.distance / 1000).toFixed(2)} km</>
                                }
                            </Text>
                        </Card>
                        <Card
                            withBorder
                            padding="lg"
                            radius="lg"
                            bg={ui.surfaceAlt}
                            style={{ borderColor: ui.border }}
                        >
                            <ThemeIcon size="lg" radius="md" variant="light" color="yellow" mb="xs">
                                <IconClock size={20} />
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Moving Time</Text>
                            <Text size="xl" fw={800} c={ui.textMain}>{formatDuration(activity.moving_time ?? activity.duration)}</Text>
                        </Card>
                         <Card
                            withBorder
                            padding="lg"
                            radius="lg"
                            bg={ui.surfaceAlt}
                            style={{ borderColor: ui.border }}
                        >
                            <ThemeIcon size="lg" radius="md" variant="light" color={activity.sport === 'running' ? "cyan" : "orange"} mb="xs">
                                {activity.sport === 'running' ? <IconActivity size={20} /> : <IconBolt size={20} />}
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{activity.sport === 'running' ? 'Avg Pace' : 'Avg Power'}</Text>
                            <Text size="xl" fw={800} c={ui.textMain}>
                                {activity.sport === 'running' 
                                    ? formatPace(activity.avg_speed).replace('/km', '')
                                    : (activity.average_watts ? activity.average_watts.toFixed(0) + ' W' : '-')}
                            </Text>
                        </Card>
                         <Card
                            withBorder
                            padding="lg"
                            radius="lg"
                            bg={ui.surfaceAlt}
                            style={{ borderColor: ui.border }}
                        >
                            <ThemeIcon size="lg" radius="md" variant="light" color="red" mb="xs">
                                <IconHeart size={20} />
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Avg HR</Text>
                            <Text size="xl" fw={800} c={ui.textMain}>{activity.average_hr?.toFixed(0) || '-'} bpm</Text>
                        </Card>
                    </SimpleGrid>

                    <Tabs
                        value={activeSection === 'analysis' ? (graphMode === 'standard' ? 'hr_zones' : graphMode) : activeSection}
                        onChange={(v) => {
                            if (!v) return;
                            if (v === 'hr_zones' || v === 'power_curve' || v === 'pace_zones' || v === 'power_zones') {
                                setGraphMode(v);
                                setActiveSection('analysis');
                                return;
                            }
                            setActiveSection(v as typeof activeSection);
                        }}
                        mb="md"
                    >
                        <Tabs.List mb="md">
                            <Tabs.Tab value="overview">Overview</Tabs.Tab>
                            <Tabs.Tab value="charts">Charts</Tabs.Tab>
                            <Tabs.Tab value="hr_zones" disabled={hrZoneData.every((z) => z.seconds <= 0)}>HR Zones</Tabs.Tab>
                            <Tabs.Tab value="power_curve" disabled={!activity.power_curve}>Power Curve</Tabs.Tab>
                            {isRunningActivity ? <Tabs.Tab value="pace_zones" disabled={runningPaceZoneData.every((z) => z.seconds <= 0)}>Pace Zones</Tabs.Tab> : null}
                            {isCyclingActivity ? <Tabs.Tab value="power_zones" disabled={cyclingPowerZoneData.every((z) => z.seconds <= 0)}>Power Zones</Tabs.Tab> : null}
                            {(activity.splits_metric?.length || activity.laps?.length) ? <Tabs.Tab value="laps">Laps</Tabs.Tab> : null}
                            {(isCyclingActivity || isRunningActivity) && streamPoints.length > 2 ? <Tabs.Tab value="hard_efforts">Hard Efforts</Tabs.Tab> : null}
                            {activity.best_efforts?.length ? <Tabs.Tab value="best_efforts">Best Efforts</Tabs.Tab> : null}
                            {activity.planned_comparison ? <Tabs.Tab value="comparison">Comparison</Tabs.Tab> : null}
                        </Tabs.List>

                        {/* OVERVIEW TAB */}
                        <Tabs.Panel value="overview">
                            <Grid gutter="md">
                                <Grid.Col span={{ base: 12, md: 8 }}>
                                    <Stack gap="sm">
                                        {/* Detailed Stats */}
                                        <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                            <Title order={5} mb="md" c={ui.textMain}>Detailed Stats</Title>
                                            <Stack gap="xs">
                                                 <Group justify="space-between">
                                                    <Text size="sm" c={ui.textDim}>Total Time</Text>
                                                    <Text size="sm" fw={700} c={ui.textMain}>{formatDuration(activity.duration)}</Text>
                                                 </Group>
                                                 {activity.moving_time && activity.moving_time !== activity.duration && (
                                                 <Group justify="space-between">
                                                    <Text size="sm" c={ui.textDim}>Moving Time</Text>
                                                    <Text size="sm" fw={700} c={ui.textMain}>{formatDuration(activity.moving_time)}</Text>
                                                 </Group>
                                                 )}
                                                 <Group justify="space-between">
                                                    <Text size="sm" c={ui.textDim}>{activity.sport === 'running' ? 'Avg Pace' : 'Avg Speed'}</Text>
                                                    <Text size="sm" fw={700} c={ui.textMain}>
                                                        {activity.sport === 'running'
                                                            ? formatPace(activity.avg_speed)
                                                            : ((activity.avg_speed || 0) * 3.6).toFixed(1) + " km/h"}
                                                    </Text>
                                                 </Group>
                                                 {activity.max_speed && (
                                                    <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>{activity.sport === 'running' ? 'Max Pace' : 'Max Speed'}</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>
                                                            {activity.sport === 'running'
                                                                ? formatPace(activity.max_speed)
                                                                : (activity.max_speed * 3.6).toFixed(1) + " km/h"}
                                                        </Text>
                                                    </Group>
                                                 )}
                                                 {activity.average_hr && (
                                                     <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Avg Heart Rate</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{activity.average_hr.toFixed(0)} bpm</Text>
                                                     </Group>
                                                 )}
                                                 {activity.max_hr != null && (
                                                     <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Max Heart Rate</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{activity.max_hr.toFixed(0)} bpm</Text>
                                                     </Group>
                                                 )}
                                                 {activity.total_elevation_gain != null && (
                                                     <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Elevation Gain</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{activity.total_elevation_gain.toFixed(0)} m</Text>
                                                     </Group>
                                                 )}
                                                 {activity.average_watts != null && activity.average_watts > 0 && (
                                                     <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Avg Power</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{activity.average_watts.toFixed(0)} W</Text>
                                                     </Group>
                                                 )}
                                                 {activity.average_watts != null && activity.average_watts > 0 && activity.weight_at_time != null && activity.weight_at_time > 0 && (
                                                     <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Avg Power (w/kg)</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{(activity.average_watts / activity.weight_at_time).toFixed(2)} w/kg</Text>
                                                     </Group>
                                                 )}
                                                 {activity.max_watts != null && activity.max_watts > 0 && (
                                                     <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Max Power</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{activity.max_watts.toFixed(0)} W</Text>
                                                     </Group>
                                                 )}
                                                 {isCyclingActivity && overallNormalizedPower != null && (
                                                     <Group justify="space-between">
                                                        <Group gap={4} align="center">
                                                          <Text size="sm" c={ui.textDim}>Weighted Avg Power (WAP)</Text>
                                                          <MantineTooltip label="Average power misleads on variable rides (hilly/coasting). WAP weights intense surges more heavily by raising 30-second rolling averages to the 4th power. A big gap between WAP and Avg Power means the ride was 'surgy' and metabolically expensive." multiline w={280} withArrow>
                                                            <IconHelpCircle size={13} style={{ cursor: 'help', opacity: 0.55 }} />
                                                          </MantineTooltip>
                                                        </Group>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{overallNormalizedPower.toFixed(0)} W</Text>
                                                     </Group>
                                                 )}
                                                 {isCyclingActivity && cyclingPerfMetrics?.intensityFactor != null && (
                                                     <Group justify="space-between">
                                                        <Group gap={4} align="center">
                                                          <Text size="sm" c={ui.textDim}>Relative Intensity (RI)</Text>
                                                          <MantineTooltip label="WAP ÷ FTP. ≤0.75: Recovery/Endurance. 0.85–0.95: Tempo/Sweet Spot. 1.0+: Hard interval or short race effort. Tells you how hard this session was relative to your current fitness level." multiline w={280} withArrow>
                                                            <IconHelpCircle size={13} style={{ cursor: 'help', opacity: 0.55 }} />
                                                          </MantineTooltip>
                                                        </Group>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{cyclingPerfMetrics.intensityFactor.toFixed(2)}</Text>
                                                     </Group>
                                                 )}
                                                 {isCyclingActivity && cyclingPerfMetrics?.tss != null && (
                                                     <Group justify="space-between">
                                                        <Group gap={4} align="center">
                                                          <Text size="sm" c={ui.textDim}>Training Load (TL)</Text>
                                                          <MantineTooltip label="Combines duration and intensity: (seconds × WAP × RI) / (FTP × 3600) × 100. A value of 100 equals riding at your threshold for exactly 1 hour. The universal currency for comparing a 4-hour easy ride to a 1-hour brutal interval session." multiline w={280} withArrow>
                                                            <IconHelpCircle size={13} style={{ cursor: 'help', opacity: 0.55 }} />
                                                          </MantineTooltip>
                                                        </Group>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{cyclingPerfMetrics.tss.toFixed(0)}</Text>
                                                     </Group>
                                                 )}
                                                 {isCyclingActivity && cyclingPerfMetrics?.vi != null && (
                                                     <Group justify="space-between">
                                                        <Group gap={4} align="center">
                                                          <Text size="sm" c={ui.textDim}>Variability Index (VI)</Text>
                                                          <MantineTooltip label="WAP ÷ Avg Power. 1.0–1.05: Steady time-trial/triathlon effort. 1.2+: Highly variable criterium/mountain bike. High values indicate frequent anaerobic bursts and fast-twitch fiber recruitment." multiline w={280} withArrow>
                                                            <IconHelpCircle size={13} style={{ cursor: 'help', opacity: 0.55 }} />
                                                          </MantineTooltip>
                                                        </Group>
                                                        <Text size="sm" fw={700} c={ui.textMain}>{cyclingPerfMetrics.vi.toFixed(2)}</Text>
                                                     </Group>
                                                 )}
                                                 {activity.avg_cadence != null && (
                                                     <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Avg Cadence</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>
                                                            {activity.sport === 'running' && activity.avg_cadence < 120
                                                                ? (activity.avg_cadence * 2).toFixed(0)
                                                                : activity.avg_cadence.toFixed(0)} {activity.sport === 'running' ? 'spm' : 'rpm'}
                                                        </Text>
                                                     </Group>
                                                 )}
                                                 {activity.max_cadence != null && (
                                                     <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Max Cadence</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>
                                                            {activity.sport === 'running' && activity.max_cadence < 120
                                                                ? (activity.max_cadence * 2).toFixed(0)
                                                                : activity.max_cadence.toFixed(0)} {activity.sport === 'running' ? 'spm' : 'rpm'}
                                                        </Text>
                                                     </Group>
                                                 )}
                                                 <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Calories</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>
                                                            {activity.total_calories ? activity.total_calories.toFixed(0) : ((activity.average_watts || 0) * activity.duration / 1000 * 1.1).toFixed(0)} kcal (Est)
                                                        </Text>
                                                 </Group>
                                                 <Group justify="space-between">
                                                        <Text size="sm" c={ui.textDim}>Training Load (TL)</Text>
                                                        <Text size="sm" fw={700} c={ui.textMain}>
                                                            +{(activity.aerobic_load || 0).toFixed(1)} Aer · +{(activity.anaerobic_load || 0).toFixed(1)} Ana
                                                        </Text>
                                                 </Group>
                                            </Stack>
                                        </Paper>
                                        {rankedBestEfforts.length > 0 && (
                                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                                <Group justify="space-between" mb="sm">
                                                    <Title order={5} c={ui.textMain}>Top Efforts</Title>
                                                    {(activity.best_efforts?.length ?? 0) > rankedBestEfforts.length && (
                                                        <Button size="xs" variant="subtle" onClick={() => setActiveSection('best_efforts')}>View all</Button>
                                                    )}
                                                </Group>
                                                <Stack gap="xs">
                                                    {rankedBestEfforts.slice(0, 3).map((effort, idx) => {
                                                        const key = effort.window || effort.distance || String(idx);
                                                        const prRank = activity.personal_records?.[key];
                                                        const medalColor = prRank === 1 ? '#f0a500' : prRank === 2 ? '#a0a0a0' : '#cd7f32';
                                                        return (
                                                            <Group key={key} justify="space-between">
                                                                <Group gap="xs">
                                                                    <IconTrophy size={14} color={medalColor} />
                                                                    <Badge size="xs" variant="light" color={prRank === 1 ? 'yellow' : prRank === 2 ? 'gray' : 'orange'}>
                                                                        {prRank === 1 ? 'PR' : prRank === 2 ? '2nd' : '3rd'}
                                                                    </Badge>
                                                                    <Text size="sm" fw={600} c={ui.textMain}>{effort.window || effort.distance}</Text>
                                                                </Group>
                                                                <Group gap="sm">
                                                                    {isCyclingActivity && effort.power != null && (
                                                                        <Text size="sm" c={ui.textDim}>{effort.power} W</Text>
                                                                    )}
                                                                    {isRunningActivity && effort.time_seconds != null && (
                                                                        <Text size="sm" c={ui.textDim}>{formatDuration(effort.time_seconds)}</Text>
                                                                    )}
                                                                    {effort.avg_hr != null && (
                                                                        <Text size="sm" c={ui.textDim}>{effort.avg_hr} bpm</Text>
                                                                    )}
                                                                </Group>
                                                            </Group>
                                                        );
                                                    })}
                                                </Stack>
                                            </Paper>
                                        )}
                                        <CommentsPanel entityType="activity" entityId={Number(id)} athleteId={activity.athlete_id} />
                                    </Stack>
                                </Grid.Col>

                                {/* RIGHT COLUMN */}
                                <Grid.Col span={{ base: 12, md: 4 }}>
                                    <Stack>
                                        <SessionFeedbackPanel
                                            activityId={Number(id)}
                                            initialActivity={activity}
                                            canEdit={me?.id === activity.athlete_id}
                                        />
                                        <SegmentedControl
                                            size="xs"
                                            value={mapHeatMetric}
                                            onChange={(value) => setMapHeatMetric(value as typeof mapHeatMetric)}
                                            data={[
                                                { label: t('Map metric: None'), value: 'none' },
                                                { label: t('Speed'), value: 'speed' },
                                                { label: t('Heart Rate'), value: 'heart_rate' },
                                                { label: t('Power'), value: 'power' },
                                                { label: t('Gradient'), value: 'gradient' },
                                            ]}
                                        />
                                        {routePositions.length > 0 && !mapFullscreen ? (
                                            <Box style={{ position: 'relative' }}>
                                                <Paper withBorder radius="lg" style={{ overflow: "hidden", borderColor: ui.border }} h={350}>
                                                    <MapContainer center={centerPos} zoom={13} style={{ height: '100%', width: '100%' }}>
                                                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                                                        {mapHeatSegments.length > 0 ? (
                                                            mapHeatSegments.map((segment, index) => (
                                                                <Polyline key={`overview-heat-${index}`} positions={segment.positions} color={segment.color} weight={5} opacity={0.92} />
                                                            ))
                                                        ) : (
                                                            <Polyline positions={routePositions} color="blue" weight={4} />
                                                        )}
                                                        {selectedEffortRoutePositions.length > 1 && (
                                                            <Polyline positions={selectedEffortRoutePositions} color={ui.accent} weight={7} opacity={0.95} />
                                                        )}
                                                        {selectedChartRoutePositions.length > 1 && (
                                                            <Polyline positions={selectedChartRoutePositions} color={ui.accent} weight={7} opacity={0.95} />
                                                        )}
                                                        <MapRouteInteractionLayer
                                                            points={interactiveMapRoutePoints}
                                                            onHover={handleMapHover}
                                                        />
                                                        {activeMapMarkerPos && <MapPanTo position={activeMapMarkerPos} />}
                                                        {activeMapMarkerPos && (
                                                            <CircleMarker center={activeMapMarkerPos} radius={7} pathOptions={{ color: '#fff', fillColor: ui.accent, fillOpacity: 1, weight: 2 }}>
                                                                <LeafletTooltip direction="top" offset={[0, -8]}>
                                                                    <Stack gap={2}>
                                                                        {activeMapMarkerPoint?.time_min != null && (
                                                                            <Text size="xs">{formatElapsedFromMinutes(activeMapMarkerPoint.time_min)} elapsed</Text>
                                                                        )}
                                                                        {activeMapMarkerPoint?.distance_km != null && (
                                                                            <Text size="xs">{toDistanceLabel(activeMapMarkerPoint.distance_km)}</Text>
                                                                        )}
                                                                        {activeMapMarkerPoint?.heart_rate != null && <Text size="xs">HR: {Math.round(Number(activeMapMarkerPoint.heart_rate))} bpm</Text>}
                                                                        {activeMapMarkerPoint?.speed_display != null && <Text size="xs">{t('Speed')}: {Number(activeMapMarkerPoint.speed_display).toFixed(1)} {me?.profile?.preferred_units === 'imperial' ? 'mph' : 'km/h'}</Text>}
                                                                        {activeMapMarkerPoint?.power != null && Number(activeMapMarkerPoint.power) > 0 && <Text size="xs">{t('Power')}: {Math.round(Number(activeMapMarkerPoint.power))} W</Text>}
                                                                        {activeMapMarkerPoint?.altitude != null && <Text size="xs">{t('Elev')}: {Math.round(Number(activeMapMarkerPoint.altitude))} m</Text>}
                                                                        {activeMapMarkerPoint?.gradient_pct != null && <Text size="xs">{t('Gradient')}: {Number(activeMapMarkerPoint.gradient_pct).toFixed(1)}%</Text>}
                                                                        {!mapHoveredPoint && <Text size="xs">{t('Selected effort')}</Text>}
                                                                    </Stack>
                                                                </LeafletTooltip>
                                                            </CircleMarker>
                                                        )}
                                                    </MapContainer>
                                                </Paper>
                                                <ActionIcon
                                                    size="sm"
                                                    variant="white"
                                                    radius="sm"
                                                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 1000, boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}
                                                    onClick={() => setMapFullscreen(true)}
                                                    aria-label="Fullscreen map"
                                                >
                                                    <IconArrowsMaximize size={14} />
                                                </ActionIcon>
                                            </Box>
                                        ) : (
                                            <Paper withBorder p="xl" radius="lg" h={200} bg={ui.surface} style={{ borderColor: ui.border }}>
                                                <Stack align="center" justify="center" h="100%">
                                                    <IconMap size={40} color="gray" />
                                                    <Text c={ui.textDim}>No map data available (Virtual Ride or Indoor)</Text>
                                                </Stack>
                                            </Paper>
                                        )}
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
                                    </Stack>
                                </Grid.Col>
                            </Grid>
                        </Tabs.Panel>

                        {/* CHARTS TAB */}
                        <Tabs.Panel value="charts">
                            <ChartsPanel
                                me={me}
                                visibleSeries={visibleSeries}
                                setVisibleSeries={setVisibleSeries}
                                powerChartMode={powerChartMode}
                                setPowerChartMode={setPowerChartMode}
                                focusMode={focusMode}
                                setFocusMode={setFocusMode}
                                focusObjective={focusObjective}
                                setFocusObjective={setFocusObjective}
                                focusSeries={focusSeries}
                                supportsPaceSeries={supportsPaceSeries}
                                supportsSpeedSeries={supportsSpeedSeries}
                                chartDataLength={chartData.length}
                                chartRenderData={chartRenderData}
                                chartRange={chartRange}
                                setChartRange={setChartRange}
                                rangeLabel={rangeLabel}
                                chartSelection={chartSelection}
                                setChartSelection={setChartSelection}
                                chartSelectionStats={chartSelectionStats}
                                isDraggingChartRef={isDraggingChartRef}
                                dragStartIdxRef={dragStartIdxRef}
                                hoveredPointIndexRef={hoveredPointIndexRef}
                                onMouseMove={handleSharedChartMouseMove}
                                onMouseLeave={handleSharedChartMouseLeave}
                                sharedTooltipProps={sharedTooltipProps}
                                formatElapsedFromMinutes={formatElapsedFromMinutes}
                                isDark={isDark}
                                ui={ui}
                                t={t}
                            />
                        </Tabs.Panel>

                        {/* ANALYSIS TABS */}
                        <Tabs.Panel value="analysis">
                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Box w="100%" mih={300}>
                                    {(graphMode === 'hr_zones' || graphMode === 'standard') && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <BarChart data={hrZoneData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="zone" />
                                                    <YAxis label={{ value: 'Duration', angle: -90, position: 'insideLeft' }} tickFormatter={(val) => formatZoneDuration(Number(val) || 0)} />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: number, _: string, item: any) => [`${formatZoneDuration(Number(val) || 0)}  ·  ${item?.payload?.range || ''}`, 'Time in Zone']} />
                                                    <Bar dataKey="seconds" name="Time in Zone" onClick={(entry: any) => entry?.zone && openZoneExplanation('hr', entry.zone)}>
                                                        {hrZoneData.map((_entry, index) => (
                                                            <Cell key={`hr-cell-${index}`} fill={HR_ZONE_COLORS[index] || '#fa5252'} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                            <Group mt="sm" gap="xs" wrap="wrap">
                                                {hrZoneData.map((z, index) => (
                                                    <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('hr', z.zone)} readOnly variant="light" size="xs" styles={{ label: { borderColor: HR_ZONE_COLORS[index] } }}>{z.zone}: {z.range}</Chip>
                                                ))}
                                            </Group>
                                        </Box>
                                    )}
                                    {graphMode === 'power_curve' && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <LineChart data={powerCurveData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} tickFormatter={(v: string) => POWER_CURVE_KEY_LABELS.has(v) ? v : ''} />
                                                    <YAxis />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: any, name: string) => [val != null ? `${val} W` : '-', name]} />
                                                    <Line type="monotone" dataKey="watts" stroke="#fd7e14" strokeWidth={2} dot={false} name="This Activity" />
                                                    {Object.keys(prPowerMap).length > 0 && (
                                                        <Line type="monotone" dataKey="prWatts" stroke="#228be6" strokeWidth={1.5} dot={false} name="All-time Best" strokeDasharray="4 2" connectNulls />
                                                    )}
                                                    {Object.entries(activity.personal_records ?? {}).map(([key, rank]) =>
                                                        rank === 1 && POWER_CURVE_KEY_LABELS.has(key) ? (
                                                            <ReferenceLine key={key} x={key} stroke="#f0a500" strokeOpacity={0.7} strokeDasharray="3 3" label={{ value: 'PR', fill: '#f0a500', fontSize: 9, position: 'insideTopRight' }} />
                                                        ) : null
                                                    )}
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </Box>
                                    )}
                                    {graphMode === 'pace_zones' && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <BarChart data={runningPaceZoneData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="zone" />
                                                    <YAxis label={{ value: 'Duration', angle: -90, position: 'insideLeft' }} tickFormatter={(val) => formatZoneDuration(Number(val) || 0)} />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: number) => [formatZoneDuration(Number(val) || 0), 'Time']} />
                                                    <Bar dataKey="seconds" fill="#228be6" name="Pace Zone Time" onClick={(entry: any) => entry?.zone && openZoneExplanation('pace', entry.zone)} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                            <Group mt="sm" gap="xs" wrap="wrap">
                                                {runningPaceZoneData.map((z) => (
                                                    <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('pace', z.zone)} readOnly variant="light" size="xs">{z.zone}</Chip>
                                                ))}
                                            </Group>
                                        </Box>
                                    )}
                                    {graphMode === 'power_zones' && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <BarChart data={cyclingPowerZoneData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="zone" />
                                                    <YAxis label={{ value: 'Duration', angle: -90, position: 'insideLeft' }} tickFormatter={(val) => formatZoneDuration(Number(val) || 0)} />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: number) => [formatZoneDuration(Number(val) || 0), 'Time']} />
                                                    <Bar dataKey="seconds" fill="#fd7e14" name="Power Zone Time" onClick={(entry: any) => entry?.zone && openZoneExplanation('power', entry.zone)} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                            <Group mt="sm" gap="xs" wrap="wrap">
                                                {cyclingPowerZoneData.map((z) => (
                                                    <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('power', z.zone)} readOnly variant="light" size="xs">{z.zone}</Chip>
                                                ))}
                                            </Group>
                                        </Box>
                                    )}
                                </Box>
                            </Paper>
                        </Tabs.Panel>
                        <Tabs.Panel value="hr_zones">
                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Box w="100%" mih={300}>
                                    {(graphMode === 'hr_zones' || graphMode === 'standard') && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <BarChart data={hrZoneData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="zone" />
                                                    <YAxis label={{ value: 'Duration', angle: -90, position: 'insideLeft' }} tickFormatter={(val) => formatZoneDuration(Number(val) || 0)} />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: number, _: string, item: any) => [`${formatZoneDuration(Number(val) || 0)}  ·  ${item?.payload?.range || ''}`, 'Time in Zone']} />
                                                    <Bar dataKey="seconds" name="Time in Zone" onClick={(entry: any) => entry?.zone && openZoneExplanation('hr', entry.zone)}>
                                                        {hrZoneData.map((_entry, index) => (
                                                            <Cell key={`hr-cell-${index}`} fill={HR_ZONE_COLORS[index] || '#fa5252'} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                            <Group mt="sm" gap="xs" wrap="wrap">
                                                {hrZoneData.map((z, index) => (
                                                    <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('hr', z.zone)} readOnly variant="light" size="xs" styles={{ label: { borderColor: HR_ZONE_COLORS[index] } }}>{z.zone}: {z.range}</Chip>
                                                ))}
                                            </Group>
                                        </Box>
                                    )}
                                </Box>
                            </Paper>
                        </Tabs.Panel>
                        <Tabs.Panel value="power_curve">
                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Box w="100%" mih={300}>
                                    {graphMode === 'power_curve' && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <LineChart data={powerCurveData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} tickFormatter={(v: string) => POWER_CURVE_KEY_LABELS.has(v) ? v : ''} />
                                                    <YAxis />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: any, name: string) => [val != null ? `${val} W` : '-', name]} />
                                                    <Line type="monotone" dataKey="watts" stroke="#fd7e14" strokeWidth={2} dot={false} name="This Activity" />
                                                    {Object.keys(prPowerMap).length > 0 && (
                                                        <Line type="monotone" dataKey="prWatts" stroke="#228be6" strokeWidth={1.5} dot={false} name="All-time Best" strokeDasharray="4 2" connectNulls />
                                                    )}
                                                    {Object.entries(activity.personal_records ?? {}).map(([key, rank]) =>
                                                        rank === 1 && POWER_CURVE_KEY_LABELS.has(key) ? (
                                                            <ReferenceLine key={key} x={key} stroke="#f0a500" strokeOpacity={0.7} strokeDasharray="3 3" label={{ value: 'PR', fill: '#f0a500', fontSize: 9, position: 'insideTopRight' }} />
                                                        ) : null
                                                    )}
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </Box>
                                    )}
                                </Box>
                            </Paper>
                        </Tabs.Panel>
                        <Tabs.Panel value="pace_zones">
                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Box w="100%" mih={300}>
                                    {graphMode === 'pace_zones' && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <BarChart data={runningPaceZoneData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="zone" />
                                                    <YAxis label={{ value: 'Duration', angle: -90, position: 'insideLeft' }} tickFormatter={(val) => formatZoneDuration(Number(val) || 0)} />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: number) => [formatZoneDuration(Number(val) || 0), 'Time']} />
                                                    <Bar dataKey="seconds" fill="#228be6" name="Pace Zone Time" onClick={(entry: any) => entry?.zone && openZoneExplanation('pace', entry.zone)} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                            <Group mt="sm" gap="xs" wrap="wrap">
                                                {runningPaceZoneData.map((z) => (
                                                    <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('pace', z.zone)} readOnly variant="light" size="xs">{z.zone}</Chip>
                                                ))}
                                            </Group>
                                        </Box>
                                    )}
                                </Box>
                            </Paper>
                        </Tabs.Panel>
                        <Tabs.Panel value="power_zones">
                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Box w="100%" mih={300}>
                                    {graphMode === 'power_zones' && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <BarChart data={cyclingPowerZoneData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="zone" />
                                                    <YAxis label={{ value: 'Duration', angle: -90, position: 'insideLeft' }} tickFormatter={(val) => formatZoneDuration(Number(val) || 0)} />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: number) => [formatZoneDuration(Number(val) || 0), 'Time']} />
                                                    <Bar dataKey="seconds" fill="#fd7e14" name="Power Zone Time" onClick={(entry: any) => entry?.zone && openZoneExplanation('power', entry.zone)} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                            <Group mt="sm" gap="xs" wrap="wrap">
                                                {cyclingPowerZoneData.map((z) => (
                                                    <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('power', z.zone)} readOnly variant="light" size="xs">{z.zone}</Chip>
                                                ))}
                                            </Group>
                                        </Box>
                                    )}
                                </Box>
                            </Paper>
                        </Tabs.Panel>

                        {/* HARD EFFORTS TAB */}
                        {(isCyclingActivity || isRunningActivity) && streamPoints.length > 2 ? (
                        <Tabs.Panel value="hard_efforts">
                            <HardEffortsPanel
                                activity={activity}
                                streamPoints={streamPoints}
                                zoneProfile={zoneProfile}
                                selectedEffortKey={selectedEffortKey}
                                onSelectEffort={(key) => focusEffortByKey(key, true)}
                                onMetaChange={(meta) => { hardEffortMetaRef.current = meta; }}
                                isDark={isDark}
                                ui={ui}
                                t={t}
                            />
                        </Tabs.Panel>
                        ) : null}

                        {/* LAPS TAB */}
                        {(activity.splits_metric?.length || activity.laps?.length) ? (
                        <Tabs.Panel value="laps">
                            <SplitsTable
                                activity={activity}
                                me={me}
                                streamPoints={streamPoints}
                                isDesktopViewport={Boolean(isDesktopViewport)}
                                onSaveAnnotations={(payload) => {
                                    updateActivityMutation.mutate({ split_annotations: payload });
                                }}
                                isSaving={updateActivityMutation.isPending}
                                formatPace={formatPace}
                                isRunningActivity={isRunningActivity}
                                isCyclingActivity={isCyclingActivity}
                                ui={ui}
                                t={t}
                            />
                        </Tabs.Panel>
                        ) : null}

                        {/* BEST EFFORTS TAB */}
                        {activity.best_efforts?.length ? (
                        <Tabs.Panel value="best_efforts">
                            <BestEffortsPanel
                                activity={activity}
                                me={me}
                                rankedBestEfforts={rankedBestEfforts}
                                bestEffortMetaByKey={bestEffortMetaByKey}
                                selectedEffortKey={selectedEffortKey}
                                onSelectEffort={(key) => focusEffortByKey(key, true)}
                                isCyclingActivity={isCyclingActivity}
                                isRunningActivity={isRunningActivity}
                                isDark={isDark}
                                ui={ui}
                                t={t}
                            />
                        </Tabs.Panel>
                        ) : null}

                        {/* COMPARISON TAB */}
                        {activity.planned_comparison ? (
                        <Tabs.Panel value="comparison">
                            <ComparisonPanel
                                activity={activity}
                                executionTraceRows={executionTraceRows}
                                executionTraceMeta={executionTraceMeta}
                                executionInfoOpen={executionInfoOpen}
                                setExecutionInfoOpen={setExecutionInfoOpen}
                                formatPace={formatPace}
                                ui={ui}
                            />
                        </Tabs.Panel>
                        ) : null}

                    </Tabs>

                    {canDeleteActivity && (
                        <Paper withBorder p="sm" radius="lg" mt="sm" bg={ui.surface} style={{ borderColor: ui.border }}>
                            <Stack gap={6}>
                                <Group justify="center">
                                    <Button
                                        variant="subtle"
                                        size="compact-xs"
                                        color="gray"
                                        onClick={() => setShowDangerZone((prev) => !prev)}
                                    >
                                        {showDangerZone ? 'Hide Danger Zone' : 'Show Danger Zone'}
                                    </Button>
                                </Group>
                                {showDangerZone && (
                                    <Stack gap="xs">
                                        <Group justify="space-between" align="center">
                                            <Text size="xs" c="dimmed">{t("Re-parse activity from original file.")}</Text>
                                            <Button
                                                variant="light"
                                                size="xs"
                                                loading={reparseMutation.isPending}
                                                onClick={() => reparseMutation.mutate()}
                                            >
                                                {t("Re-parse")}
                                            </Button>
                                        </Group>
                                        <Group justify="space-between" align="center">
                                            <Text size="xs" c="dimmed">Delete this activity permanently.</Text>
                                            <Button
                                                color="red"
                                                variant="light"
                                                size="xs"
                                                onClick={() => {
                                                    setDeleteConfirmText('');
                                                    setDeleteConfirmOpen(true);
                                                }}
                                            >
                                                Delete Activity
                                            </Button>
                                        </Group>
                                    </Stack>
                                )}
                            </Stack>
                        </Paper>
                    )}
                </Container>

                {/* Strava API Brand Guidelines: "Powered by Strava" attribution */}
                {activity.strava_activity_url && (
                    <Container size="xl" py="xs">
                        <Group justify="flex-end" gap="xs">
                            <Text size="xs" c="dimmed">{t("Powered by Strava")}</Text>
                            <Anchor href={activity.strava_activity_url} target="_blank" rel="noopener noreferrer" size="xs" fw={600} c="#FC5200" style={{ textDecoration: 'underline' }}>
                                {t("View on Strava")}
                            </Anchor>
                        </Group>
                    </Container>
                )}

                <ShareToChatModal
                    opened={shareModalOpen}
                    onClose={() => setShareModalOpen(false)}
                    shareText={[
                        `${activity.filename} — ${activity.sport || 'activity'}`,
                        `Distance: ${(activity.distance / 1000).toFixed(2)} km  |  Duration: ${formatDuration(activity.duration)}${activity.average_hr ? `  |  Avg HR: ${Math.round(activity.average_hr)} bpm` : ''}${activity.average_watts ? `  |  Avg Power: ${Math.round(activity.average_watts)} W` : ''}`,
                    ].join('\n')}
                />

                <Modal opened={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="Confirm delete" centered>
                    <Stack>
                        <Text size="sm">Type DELETE to confirm removing this activity. This action cannot be undone.</Text>
                        <TextInput
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.currentTarget.value)}
                            placeholder="Type DELETE"
                        />
                        <Group justify="flex-end">
                            <Button variant="default" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
                            <Button
                                color="red"
                                loading={deleteActivityMutation.isPending}
                                disabled={deleteConfirmText.trim() !== 'DELETE'}
                                onClick={() => {
                                    deleteActivityMutation.mutate(undefined, {
                                        onSuccess: () => {
                                            setDeleteConfirmOpen(false);
                                        }
                                    });
                                }}
                            >
                                Permanently Delete
                            </Button>
                        </Group>
                    </Stack>
                </Modal>

                <Modal opened={zoneInfoOpen} onClose={() => setZoneInfoOpen(false)} title={zoneInfoTitle} centered>
                    <Text size="sm">{zoneInfoBody}</Text>
                </Modal>

                <FullscreenMapModal
                    opened={mapFullscreen}
                    onClose={() => { setMapFullscreen(false); setFsMapIndex(null); }}
                    routePositions={routePositions}
                    centerPos={centerPos}
                    mapHeatSegments={mapHeatSegments}
                    selectedEffortRoutePositions={selectedEffortRoutePositions}
                    selectedChartRoutePositions={selectedChartRoutePositions}
                    interactiveMapRoutePoints={interactiveMapRoutePoints}
                    onMapHover={handleMapHover}
                    fullscreenMarkerPos={fullscreenMarkerPos}
                    fullscreenMarkerPoint={fullscreenMarkerPoint}
                    chartSelectionStats={chartSelectionStats}
                    onClearSelection={() => setChartSelection(null)}
                    mapHeatMetric={mapHeatMetric}
                    setMapHeatMetric={setMapHeatMetric}
                    fsVisibleMetrics={fsVisibleMetrics}
                    setFsVisibleMetrics={setFsVisibleMetrics}
                    supportsPaceSeries={supportsPaceSeries}
                    supportsSpeedSeries={supportsSpeedSeries}
                    chartRenderData={chartRenderData}
                    chartSelection={chartSelection}
                    setChartSelection={setChartSelection}
                    onFsChartMove={handleFsChartMove}
                    onFsChartLeave={handleFsChartLeave}
                    isFsDraggingRef={isFsDraggingRef}
                    fsDragStartIdxRef={fsDragStartIdxRef}
                    me={me}
                    formatElapsedFromMinutes={formatElapsedFromMinutes}
                    isDark={isDark}
                    ui={ui}
                    t={t}
                />
            </AppShell.Main>
        </AppShell>
    );
};


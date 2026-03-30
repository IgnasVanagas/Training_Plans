import { ActionIcon, Anchor, AppShell, Box, Button, Card, Container, Grid, Group, Paper, RangeSlider, Select, SimpleGrid, Stack, Switch, Tabs, Text, Title, Badge, SegmentedControl, Chip, Table, ThemeIcon, useComputedColorScheme, NumberInput, Modal, TextInput, Tooltip as MantineTooltip } from "@mantine/core";
import { IconArrowLeft, IconBolt, IconHeart, IconMap, IconClock, IconActivity, IconHelpCircle, IconTrophy, IconArrowsMaximize, IconExternalLink, IconShare } from "@tabler/icons-react";
import ShareToChatModal from "../components/ShareToChatModal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, ReferenceLine } from 'recharts';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from "../api/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from 'leaflet';
import { formatDuration, formatZoneDuration } from "../components/activityDetail/formatters";
import { ActivityDetailSkeleton } from "../components/common/SkeletonScreens";
import SupportContactButton from "../components/common/SupportContactButton";
import { useI18n } from "../i18n/I18nProvider";
import { readSnapshot, writeSnapshot } from "../utils/localSnapshot";
import { CommentsPanel } from "../components/activityDetail/CommentsPanel";
import { SessionFeedbackPanel } from "../components/activityDetail/SessionFeedbackPanel";
import { getPersonalRecords } from "../api/activities";

// Fix Leaflet icon issue
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

type ActivityDetail = {
  id: number;
  athlete_id: number;
  filename: string;
  created_at: string;
  sport: string;
  distance: number;
  duration: number;
  moving_time?: number | null;
  avg_speed: number;
  average_hr: number;
  average_watts: number;
    streams: any;
  power_curve: Record<string, number> | null;
  hr_zones: Record<string, number> | null;
  best_efforts: Array<{
    window?: string; seconds?: number; power?: number;
    distance?: string; meters?: number; time_seconds?: number;
    avg_hr?: number | null; elevation?: number;
  }> | null;
  personal_records: Record<string, number> | null;
  laps: any[] | null;
  splits_metric: any[] | null;
  max_hr?: number;
  max_speed?: number;
  max_watts?: number;
  max_cadence?: number;
  avg_cadence?: number;
  total_elevation_gain?: number;
  total_calories?: number;
    is_deleted?: boolean;
    aerobic_load?: number;
    anaerobic_load?: number;
    total_load_impact?: number;
    rpe?: number | null;
    lactate_mmol_l?: number | null;
    notes?: string | null;
    ftp_at_time?: number | null;
    weight_at_time?: number | null;
    strava_activity_url?: string | null;
    planned_comparison?: {
        workout_id: number;
        workout_title: string;
        summary?: {
            has_planned_distance?: boolean | null;
            duration_delta_min?: number | null;
            distance_delta_km?: number | null;
            duration_match_pct?: number | null;
            distance_match_pct?: number | null;
            intensity_match_pct?: number | null;
            intensity_status?: 'green' | 'yellow' | 'red' | string | null;
            execution_score_pct?: number | null;
            execution_status?: 'great' | 'good' | 'ok' | 'fair' | 'subpar' | 'poor' | 'incomplete' | string | null;
            execution_components?: Record<string, number> | null;
            execution_trace?: {
                model_version?: string | null;
                scoring_basis?: string | null;
                used_weight_pct?: number | null;
                weighted_total_points?: number | null;
                normalization_divisor?: number | null;
                components?: Array<{
                    key?: string | null;
                    label?: string | null;
                    available?: boolean | null;
                    weight_fraction?: number | null;
                    weight_pct?: number | null;
                    component_score_pct?: number | null;
                    weighted_points?: number | null;
                    normalized_contribution_pct?: number | null;
                    note?: string | null;
                }>;
                status_thresholds?: Array<{
                    status?: string | null;
                    min_score_pct?: number | null;
                }>;
            } | null;
            split_importance?: 'high' | 'low' | string | null;
            split_note?: string | null;
        };
        intensity?: {
            note?: string | null;
        } | null;
        splits?: Array<{
            split: number;
            planned?: {
                planned_duration_s?: number | null;
                category?: string | null;
                target?: {
                    type?: string | null;
                    value?: number | null;
                    min?: number | null;
                    max?: number | null;
                    zone?: number | null;
                } | null;
            } | null;
            actual?: {
                actual_duration_s?: number | null;
                avg_hr?: number | null;
                avg_power?: number | null;
                avg_speed?: number | null;
            } | null;
            delta_duration_s?: number | null;
            delta_duration_pct?: number | null;
        }>;
    } | null;
};

/* ── Fullscreen map helpers ── */

const MapFitBounds = ({ positions }: { positions: [number, number][] }) => {
    const map = useMap();
    useEffect(() => {
        if (positions.length > 1) {
            map.fitBounds(L.latLngBounds(positions.map(p => L.latLng(p[0], p[1]))), { padding: [30, 30] });
        }
    }, [map, positions]);
    return null;
};

const MapPanTo = ({ position }: { position: [number, number] | null }) => {
    const map = useMap();
    const lastPan = useRef<string | null>(null);
    useEffect(() => {
        if (!position) return;
        const key = `${position[0].toFixed(5)},${position[1].toFixed(5)}`;
        if (lastPan.current !== key) {
            lastPan.current = key;
            // Don't pan on every hover — only if marker is outside visible bounds
            if (!map.getBounds().contains(L.latLng(position[0], position[1]))) {
                map.panTo(L.latLng(position[0], position[1]), { animate: true, duration: 0.3 });
            }
        }
    }, [map, position]);
    return null;
};

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
    const formatTooltipDistance = (value: unknown) => {
        const distance = Number(value);
        if (!Number.isFinite(distance)) return '-';
        return `${distance.toFixed(3)} ${me?.profile?.preferred_units === 'imperial' ? 'mi' : 'km'}`;
    };
    const [graphMode, setGraphMode] = useState<'standard' | 'power_curve' | 'hr_zones' | 'pace_zones' | 'power_zones'>('hr_zones');
    const [activeSection, setActiveSection] = useState<'overview' | 'charts' | 'analysis' | 'laps' | 'best_efforts' | 'comparison'>('overview');
    const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
    const hoveredPointIndexRef = useRef<number | null>(null);
    const pendingHoveredPointIndexRef = useRef<number | null>(null);
    const hoveredPointRafRef = useRef<number | null>(null);
    const [splitMode, setSplitMode] = useState<'metric' | 'laps'>('metric');
    const [effortsSplitsView, setEffortsSplitsView] = useState<'efforts' | 'splits'>('efforts');
    const [focusMode, setFocusMode] = useState(false);
    const [focusObjective, setFocusObjective] = useState<'pacing' | 'cardio' | 'efficiency'>('pacing');
    const [completionPulse, setCompletionPulse] = useState(false);
    const [visibleSplitStats, setVisibleSplitStats] = useState({
        distance: true,
        duration: true,
        pace_or_speed: true,
        avg_hr: true,
        max_hr: true,
        avg_watts: true,
        max_watts: true,
        normalized_power: true,
    });
    const [visibleSeries, setVisibleSeries] = useState({
        heart_rate: true,
        power: true,
        pace: true,
        cadence: false,
        altitude: false
    });
    const [activityRpe, setActivityRpe] = useState<number | null>(null);
    const [activityNotes, setActivityNotes] = useState('');
    const [splitAnnotationsVisible, setSplitAnnotationsVisible] = useState(false);
    const [splitAnnotationsDirty, setSplitAnnotationsDirty] = useState(false);
    const [splitAnnotations, setSplitAnnotations] = useState<Record<number, { rpe: number | null; lactate_mmol_l: number | null; note: string }>>({});
    const [showAllBestEfforts, setShowAllBestEfforts] = useState(true);
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
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
            queryClient.invalidateQueries({ queryKey: ['activity', id] });
        }
    });

    const updateActivityMutation = useMutation({
        mutationFn: async (payload: { rpe?: number | null; lactate_mmol_l?: number | null; notes?: string | null; split_annotations?: Array<{ split_type: 'metric' | 'laps'; split_index: number; rpe?: number | null; lactate_mmol_l?: number | null; note?: string | null }> }) => {
            const res = await api.patch<ActivityDetail>(`/activities/${id}`, payload);
            return res.data;
        },
        onSuccess: (updated) => {
            queryClient.setQueryData(['activity', id], updated);
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
        }
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
        }
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

    const displayedBestEfforts = useMemo(() => {
        if (!activity?.best_efforts?.length) return [];
        if (showAllBestEfforts || rankedBestEfforts.length === 0) return activity.best_efforts;
        return rankedBestEfforts;
    }, [activity?.best_efforts, rankedBestEfforts, showAllBestEfforts]);

    const hasHiddenBestEfforts = useMemo(() => {
        const total = activity?.best_efforts?.length ?? 0;
        return total > displayedBestEfforts.length;
    }, [activity?.best_efforts?.length, displayedBestEfforts.length]);

    const routePositions = useMemo(() => {
        return streamPoints
            .filter((p: any) => p.lat && p.lon)
            .map((p: any) => [p.lat, p.lon] as [number, number]);
    }, [streamPoints]);

    const chartData = useMemo(() => {
        if (!activity || streamPoints.length === 0) return [];
        const startTs = new Date(streamPoints[0]?.timestamp).getTime();
        const isRunningLike = (activity.sport || '').toLowerCase().includes('run');

        return streamPoints.map((s: any, index: number) => {
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

            return {
                ...s, 
                // Keep numbers for Charting
                distance_km: s.distance 
                    ? (me?.profile?.preferred_units === 'imperial' ? s.distance * 0.000621371 : s.distance / 1000)
                    : 0, 
                time_min: timeMin,
                pace,
                // running cadence is typically doubled in FIT files (steps per minute vs revolutions)
                // BUT garmin/fit often stores 1-sided vs 2-sided differently. 
                // Usually for running, if cadence is < 120 it's likely single sided steps, > 120 is both steps.
                // Standard convention in runners is steps per minute (SPM), usually 150-190.
                // If the stream data is already full SPM (e.g. 170), use it. 
                // However, user reports "wrong in graph" implying it might be halved (showing ~85-90 instead of ~170-180).
                // Let's multiply by 2 if sport is running and cadence seems low (e.g., < 120 avg).
                // Actually safer to check sport:
                cadence: (activity.sport === 'running' && s.cadence) ? Number(s.cadence) * 2 : Number(s.cadence)
            };
        });
    }, [activity, streamPoints, me?.profile?.preferred_units]);

    // --- Range slider for chart zoom (replaces laggy Brush) ---
    const [chartRange, setChartRange] = useState<[number, number]>([0, 100]);
    const visibleChartData = useMemo(() => {
        if (chartData.length === 0) return [];
        const startIdx = Math.round((chartRange[0] / 100) * (chartData.length - 1));
        const endIdx = Math.round((chartRange[1] / 100) * (chartData.length - 1));
        return chartData.slice(startIdx, endIdx + 1);
    }, [chartData, chartRange]);
    // Reset range when activity changes
    useEffect(() => { setChartRange([0, 100]); }, [activity?.id]);
    const rangeLabel = useMemo(() => {
        if (chartData.length === 0) return ['0', '0'];
        const startIdx = Math.round((chartRange[0] / 100) * (chartData.length - 1));
        const endIdx = Math.round((chartRange[1] / 100) * (chartData.length - 1));
        const unitLabel = me?.profile?.preferred_units === 'imperial' ? 'mi' : 'km';
        const fmt = (idx: number) => {
            const d = chartData[idx]?.distance_km;
            return d != null ? `${Number(d).toFixed(1)} ${unitLabel}` : '';
        };
        return [fmt(startIdx), fmt(endIdx)];
    }, [chartData, chartRange, me?.profile?.preferred_units]);

    const hoveredPoint = useMemo(() => {
        if (hoveredPointIndex === null) return null;
        return visibleChartData[hoveredPointIndex] || null;
    }, [visibleChartData, hoveredPointIndex]);

    /* Fullscreen map: only points with GPS coords, for elevation graph + marker */
    const gpsChartData = useMemo(() => {
        if (!activity) return [];
        const startTs = streamPoints[0]?.timestamp ? new Date(streamPoints[0].timestamp).getTime() : 0;
        const isRunning = (activity.sport || '').toLowerCase().includes('run');
        return streamPoints
            .filter((p: any) => p.lat && p.lon)
            .map((p: any) => {
                let timeMin = 0;
                if (p.timestamp && startTs) {
                    timeMin = (new Date(p.timestamp).getTime() - startTs) / 60000;
                }
                let paceDisplay: string | null = null;
                let speedKmh: number | null = null;
                if (p.speed && p.speed > 0.1) {
                    speedKmh = p.speed * 3.6;
                    if (isRunning) {
                        const mpm = p.speed * 60;
                        const paceVal = 1000 / mpm;
                        if (paceVal <= 20) {
                            const pm = Math.floor(paceVal);
                            const ps = Math.round((paceVal - pm) * 60);
                            paceDisplay = `${pm}:${ps.toString().padStart(2, '0')}/km`;
                        }
                    }
                }
                return {
                    lat: p.lat,
                    lon: p.lon,
                    altitude: p.altitude ?? null,
                    heart_rate: p.heart_rate ?? null,
                    power: p.power ?? null,
                    speedKmh,
                    paceDisplay,
                    timeMin,
                    distance_km: p.distance ? p.distance / 1000 : 0,
                };
            });
    }, [activity, streamPoints]);

    const fsMapPoint = useMemo(() => {
        if (fsMapIndex === null || !gpsChartData[fsMapIndex]) return null;
        return gpsChartData[fsMapIndex];
    }, [fsMapIndex, gpsChartData]);

    const fsMapMarkerPos = useMemo<[number, number] | null>(() => {
        if (!fsMapPoint) return null;
        return [fsMapPoint.lat, fsMapPoint.lon];
    }, [fsMapPoint]);

    const handleFsElevationMove = useCallback((state: any) => {
        const idx = state?.activeTooltipIndex;
        if (typeof idx === 'number' && Number.isFinite(idx)) {
            setFsMapIndex(idx);
        }
    }, []);

    const handleFsElevationLeave = useCallback(() => {
        setFsMapIndex(null);
    }, []);

    const handleSharedChartMouseMove = (state: any) => {
        const idx = state?.activeTooltipIndex;
        if (typeof idx !== 'number' || !Number.isFinite(idx)) return;
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
                    {formatTooltipDistance(point.distance_km)}
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

    const HR_ZONE_COLORS = ['#22C55E', '#84CC16', '#EAB308', '#F97316', '#EF4444'];

    const hrZoneData = useMemo(() => {
        const zoneSeconds = Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;

        const maxHr = Number(me?.profile?.max_hr || activity?.max_hr || 190);

        // Resolve profile HR zone upper bounds (absolute bpm)
        const sport = (activity?.sport || '').toLowerCase();
        const sportKey = sport.includes('cycl') || sport.includes('bike') || sport.includes('ride') ? 'cycling' : 'running';
        const upperBounds: number[] | undefined = (me?.profile as any)?.zone_settings?.[sportKey]?.hr?.upper_bounds;

        const classifyHr = (hr: number): number => {
            if (upperBounds?.length) {
                for (let i = 0; i < upperBounds.length; i++) {
                    if (hr <= upperBounds[i]) return i + 1;
                }
                return upperBounds.length;
            }
            const ratio = hr / maxHr;
            return ratio < 0.6 ? 1 : ratio < 0.7 ? 2 : ratio < 0.8 ? 3 : ratio < 0.9 ? 4 : 5;
        };

        const validHrSamples = streamPoints
            .map((sample: any) => Number(sample?.heart_rate || 0))
            .filter((hr: number) => Number.isFinite(hr) && hr > 0);

        if (validHrSamples.length > 0 && (upperBounds?.length || maxHr > 0)) {
            const sampleSeconds = activity?.duration && activity.duration > 0 ? activity.duration / validHrSamples.length : 1;
            validHrSamples.forEach((hr: number) => {
                const zone = classifyHr(hr);
                zoneSeconds[`Z${zone}`] += Math.round(sampleSeconds);
            });
        } else if (activity?.hr_zones && typeof activity.hr_zones === 'object' && Object.keys(activity.hr_zones).length > 0) {
            for (let zone = 1; zone <= 5; zone += 1) {
                zoneSeconds[`Z${zone}`] += Number((activity.hr_zones as any)[`Z${zone}`] || 0);
            }
        } else if (activity?.average_hr && activity?.duration) {
            const zone = classifyHr(Number(activity.average_hr));
            zoneSeconds[`Z${zone}`] += Math.round(activity.duration);
        }

        return Array.from({ length: 5 }, (_, idx) => {
            const zone = `Z${idx + 1}`;
            return { zone, seconds: zoneSeconds[zone] || 0 };
        });
    }, [activity, streamPoints, me?.profile?.max_hr, me?.profile]);

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
            'High-intensity / near-max effort. Short, demanding intervals.'
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

    const toTimestampMs = (value: any) => {
        if (!value) return NaN;
        if (typeof value === 'number') return value;
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'string') {
            const hasTimezone = /([zZ]|[+\-]\d{2}:\d{2})$/.test(value);
            const normalized = hasTimezone ? value : `${value}Z`;
            const ms = Date.parse(normalized);
            return Number.isFinite(ms) ? ms : NaN;
        }
        return NaN;
    };

    const calculateNormalizedPower = (powerSamples: number[]) => {
        if (!powerSamples.length) return null;
        const windowSize = Math.min(30, powerSamples.length);
        let rollingSum = 0;
        const rollingAverages: number[] = [];

        powerSamples.forEach((sample, index) => {
            rollingSum += sample;
            if (index >= windowSize) {
                rollingSum -= powerSamples[index - windowSize];
            }
            if (index >= windowSize - 1) {
                rollingAverages.push(rollingSum / windowSize);
            }
        });

        const source = rollingAverages.length ? rollingAverages : powerSamples;
        const meanFourth = source.reduce((sum, value) => sum + Math.pow(value, 4), 0) / source.length;
        return Math.pow(meanFourth, 0.25);
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

    const splitsToDisplay = useMemo(() => {
        if (!activity) return [];
        if (splitMode === 'metric') return activity.splits_metric || [];
        // Filter out empty laps if necessary
        return (activity.laps || []).filter(l => l.distance > 0);
    }, [activity, splitMode]);

    const splitsToDisplayWithPower = useMemo(() => {
        if (!activity) return [];
        const sportName = (activity.sport || '').toLowerCase();
        const isCyclingLike = sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride') || sportName.includes('virtualride');
        if (!isCyclingLike) return splitsToDisplay;

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
            const positivePowerSamples = allPowerSamples.filter((value) => value > 0);

            const avgFromSegment = positivePowerSamples.length
                ? positivePowerSamples.reduce((sum: number, value: number) => sum + value, 0) / positivePowerSamples.length
                : null;
            const avgFromSplit = Number(split?.avg_power);
            const avgWatts = Number.isFinite(avgFromSplit) && avgFromSplit > 0 ? avgFromSplit : avgFromSegment;

            const maxWatts = positivePowerSamples.length ? Math.max(...positivePowerSamples) : null;
            let normalizedPower = calculateNormalizedPower(allPowerSamples);
            if (normalizedPower != null && avgWatts != null && normalizedPower < avgWatts) {
                normalizedPower = avgWatts;
            }

            return {
                ...split,
                avg_watts: avgWatts,
                max_watts: maxWatts,
                normalized_power: normalizedPower,
            };
        });
    }, [activity, splitsToDisplay, streamPoints]);

    useEffect(() => {
        if (!activity) return;
        setActivityRpe(activity.rpe ?? null);
        setActivityNotes(activity.notes || '');
    }, [activity?.id, activity?.rpe, activity?.notes]);

    useEffect(() => {
        const initial: Record<number, { rpe: number | null; lactate_mmol_l: number | null; note: string }> = {};
        splitsToDisplayWithPower.forEach((split: any, idx: number) => {
            initial[idx] = {
                rpe: typeof split?.rpe === 'number' ? split.rpe : null,
                lactate_mmol_l: typeof split?.lactate_mmol_l === 'number' ? split.lactate_mmol_l : null,
                note: typeof split?.note === 'string' ? split.note : ''
            };
        });
        setSplitAnnotations(initial);
    }, [activity?.id, splitMode, splitsToDisplayWithPower.length]);

    useEffect(() => {
        if (!activity) return;
        const sportName = (activity.sport || '').toLowerCase();
        const isCycling = sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride') || sportName.includes('virtualride');
        const hasMetricSplits = Boolean(activity.splits_metric?.length);
        const hasLapSplits = Boolean(activity.laps?.length);

        if ((isCycling || !hasMetricSplits) && hasLapSplits) {
            setSplitMode('laps');
            return;
        }

        setSplitMode('metric');
    }, [activity]);

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
        setShowAllBestEfforts(true);
    }, [activity?.id]);
    
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

    const focusSeries = useMemo(() => {
        if (!focusMode) {
            return {
                ...visibleSeries,
                pace: supportsPaceSeries ? visibleSeries.pace : false,
            };
        }
        if (focusObjective === 'cardio') {
            return {
                heart_rate: true,
                power: false,
                pace: supportsPaceSeries,
                cadence: false,
                altitude: false
            };
        }
        if (focusObjective === 'efficiency') {
            return {
                heart_rate: true,
                power: true,
                pace: false,
                cadence: true,
                altitude: false
            };
        }
        return {
            heart_rate: true,
            power: false,
            pace: supportsPaceSeries,
            cadence: false,
            altitude: true
        };
    }, [focusMode, focusObjective, visibleSeries, supportsPaceSeries]);


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

                    <Tabs value={activeSection} onChange={(v) => setActiveSection(v as typeof activeSection)} mb="md">
                        <Tabs.List mb="md">
                            <Tabs.Tab value="overview">Overview</Tabs.Tab>
                            <Tabs.Tab value="charts">Charts</Tabs.Tab>
                            <Tabs.Tab value="analysis">Analysis</Tabs.Tab>
                            {(activity.splits_metric?.length || activity.laps?.length) ? <Tabs.Tab value="laps">Laps</Tabs.Tab> : null}
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
                                        {routePositions.length > 0 && !mapFullscreen ? (
                                            <Box style={{ position: 'relative' }}>
                                                <Paper withBorder radius="lg" style={{ overflow: "hidden", borderColor: ui.border }} h={350}>
                                                    <MapContainer center={centerPos} zoom={13} style={{ height: '100%', width: '100%' }}>
                                                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                                                        <Polyline positions={routePositions} color="blue" weight={4} />
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
                                    </Stack>
                                </Grid.Col>
                            </Grid>
                        </Tabs.Panel>

                        {/* CHARTS TAB */}
                        <Tabs.Panel value="charts">
                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Group justify="space-between" mb="md" wrap="wrap" gap="sm">
                                    <Group gap="xs" wrap="wrap">
                                        <Text size="xs" fw={700} c={ui.textDim}>Show:</Text>
                                        <Chip size="xs" checked={visibleSeries.heart_rate} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, heart_rate: checked }))} variant="light">Heart Rate</Chip>
                                        {supportsPaceSeries && <Chip size="xs" checked={visibleSeries.pace} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, pace: checked }))} variant="light">Pace</Chip>}
                                        <Chip size="xs" checked={visibleSeries.power} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, power: checked }))} variant="light">Power</Chip>
                                        <Chip size="xs" checked={visibleSeries.cadence} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, cadence: checked }))} variant="light">Cadence</Chip>
                                        <Chip size="xs" checked={visibleSeries.altitude} onChange={(checked) => setVisibleSeries((prev) => ({ ...prev, altitude: checked }))} variant="light">Altitude</Chip>
                                    </Group>
                                    <Group gap="xs">
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
                                {chartData.length > 0 ? (
                                    <Stack gap="xs">
                                        {focusSeries.heart_rate && (
                                            <Box h={160}>
                                                <ResponsiveContainer>
                                                    <AreaChart data={visibleChartData} onMouseMove={handleSharedChartMouseMove} onMouseLeave={handleSharedChartMouseLeave}>
                                                        <defs>
                                                            <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#fa5252" stopOpacity={0.3} />
                                                                <stop offset="95%" stopColor="#fa5252" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ui.border} />
                                                        <XAxis dataKey="distance_km" hide />
                                                        <YAxis width={35} tick={{ fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v) => `${Math.round(v)}`} />
                                                        <Tooltip content={hrTooltipContent} />
                                                        <Area type="monotone" dataKey="heart_rate" stroke="#fa5252" fill="url(#hrGrad)" strokeWidth={1.5} dot={false} name="HR" isAnimationActive={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </Box>
                                        )}
                                        {focusSeries.pace && (
                                            <Box h={160}>
                                                <ResponsiveContainer>
                                                    <AreaChart data={visibleChartData} onMouseMove={handleSharedChartMouseMove} onMouseLeave={handleSharedChartMouseLeave}>
                                                        <defs>
                                                            <linearGradient id="paceGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#228be6" stopOpacity={0.3} />
                                                                <stop offset="95%" stopColor="#228be6" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ui.border} />
                                                        <XAxis dataKey="distance_km" hide />
                                                        <YAxis width={35} tick={{ fontSize: 10 }} reversed tickFormatter={(v) => { const m = Math.floor(v); const s = Math.round((v - m) * 60); return `${m}:${s.toString().padStart(2, '0')}`; }} />
                                                        <Tooltip content={paceTooltipContent} />
                                                        <Area type="monotone" dataKey="pace" stroke="#228be6" fill="url(#paceGrad)" strokeWidth={1.5} dot={false} name="Pace" isAnimationActive={false} connectNulls={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </Box>
                                        )}
                                        {focusSeries.power && (
                                            <Box h={160}>
                                                <ResponsiveContainer>
                                                    <AreaChart data={visibleChartData} onMouseMove={handleSharedChartMouseMove} onMouseLeave={handleSharedChartMouseLeave}>
                                                        <defs>
                                                            <linearGradient id="powerGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#fd7e14" stopOpacity={0.3} />
                                                                <stop offset="95%" stopColor="#fd7e14" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ui.border} />
                                                        <XAxis dataKey="distance_km" hide />
                                                        <YAxis width={35} tick={{ fontSize: 10 }} domain={[0, 'auto']} tickFormatter={(v) => `${Math.round(v)}`} />
                                                        <Tooltip content={powerTooltipContent} />
                                                        <Area type="monotone" dataKey="power" stroke="#fd7e14" fill="url(#powerGrad)" strokeWidth={1.5} dot={false} name="Power" isAnimationActive={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </Box>
                                        )}
                                        {focusSeries.cadence && (
                                            <Box h={120}>
                                                <ResponsiveContainer>
                                                    <AreaChart data={visibleChartData} onMouseMove={handleSharedChartMouseMove} onMouseLeave={handleSharedChartMouseLeave}>
                                                        <defs>
                                                            <linearGradient id="cadenceGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#40c057" stopOpacity={0.3} />
                                                                <stop offset="95%" stopColor="#40c057" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ui.border} />
                                                        <XAxis dataKey="distance_km" hide />
                                                        <YAxis width={35} tick={{ fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v) => `${Math.round(v)}`} />
                                                        <Tooltip content={cadenceTooltipContent} />
                                                        <Area type="monotone" dataKey="cadence" stroke="#40c057" fill="url(#cadenceGrad)" strokeWidth={1.5} dot={false} name="Cadence" isAnimationActive={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </Box>
                                        )}
                                        {focusSeries.altitude && (
                                            <Box h={120}>
                                                <ResponsiveContainer>
                                                    <AreaChart data={visibleChartData} onMouseMove={handleSharedChartMouseMove} onMouseLeave={handleSharedChartMouseLeave}>
                                                        <defs>
                                                            <linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#868e96" stopOpacity={0.3} />
                                                                <stop offset="95%" stopColor="#868e96" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={ui.border} />
                                                        <XAxis dataKey="distance_km" hide />
                                                        <YAxis width={35} tick={{ fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v) => `${Math.round(v)}`} />
                                                        <Tooltip content={altitudeTooltipContent} />
                                                        <Area type="monotone" dataKey="altitude" stroke="#868e96" fill="url(#altGrad)" strokeWidth={1.5} dot={false} name="Altitude" isAnimationActive={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </Box>
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
                                        <Text c={ui.textDim}>No stream data available for this activity</Text>
                                    </Stack>
                                )}
                            </Paper>
                        </Tabs.Panel>

                        {/* ANALYSIS TAB */}
                        <Tabs.Panel value="analysis">
                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Group mb="md">
                                    <SegmentedControl
                                        radius="md"
                                        value={graphMode === 'standard' ? 'hr_zones' : graphMode}
                                        onChange={(v: any) => setGraphMode(v)}
                                        data={[
                                            { label: 'HR Zones', value: 'hr_zones', disabled: hrZoneData.every((z) => z.seconds <= 0) },
                                            { label: 'Power Curve', value: 'power_curve', disabled: !activity.power_curve },
                                            ...(isRunningActivity ? [{ label: 'Pace Zones', value: 'pace_zones', disabled: runningPaceZoneData.every((z) => z.seconds <= 0) }] : []),
                                            ...(isCyclingActivity ? [{ label: 'Power Zones', value: 'power_zones', disabled: cyclingPowerZoneData.every((z) => z.seconds <= 0) }] : []),
                                        ]}
                                    />
                                </Group>
                                <Box w="100%" mih={300}>
                                    {(graphMode === 'hr_zones' || graphMode === 'standard') && (
                                        <Box h={400} w="100%">
                                            <ResponsiveContainer>
                                                <BarChart data={hrZoneData}>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                    <XAxis dataKey="zone" />
                                                    <YAxis label={{ value: 'Duration', angle: -90, position: 'insideLeft' }} tickFormatter={(val) => formatZoneDuration(Number(val) || 0)} />
                                                    <Tooltip {...sharedTooltipProps} formatter={(val: number) => [formatZoneDuration(Number(val) || 0), 'Time']} />
                                                    <Bar dataKey="seconds" name="Time in Zone" onClick={(entry: any) => entry?.zone && openZoneExplanation('hr', entry.zone)}>
                                                        {hrZoneData.map((_entry, index) => (
                                                            <Cell key={`hr-cell-${index}`} fill={HR_ZONE_COLORS[index] || '#fa5252'} />
                                                        ))}
                                                    </Bar>
                                                </BarChart>
                                            </ResponsiveContainer>
                                            <Group mt="sm" gap="xs" wrap="wrap">
                                                {hrZoneData.map((z, index) => (
                                                    <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('hr', z.zone)} readOnly variant="light" size="xs" styles={{ label: { borderColor: HR_ZONE_COLORS[index] } }}>{z.zone}</Chip>
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

                        {/* LAPS TAB */}
                        {(activity.splits_metric?.length || activity.laps?.length) ? (
                        <Tabs.Panel value="laps">
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
                                    <Chip size="xs" checked={visibleSplitStats.pace_or_speed} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, pace_or_speed: checked }))} variant="light">{isRunningActivity ? t('Pace') : t('Speed')}</Chip>
                                    <Chip size="xs" checked={visibleSplitStats.avg_hr} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, avg_hr: checked }))} variant="light">{t("Avg HR")}</Chip>
                                    <Chip size="xs" checked={visibleSplitStats.max_hr} onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, max_hr: checked }))} variant="light">{t("Max HR")}</Chip>
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
                                            {visibleSplitStats.pace_or_speed && <Table.Th>{isRunningActivity ? t('Pace') : t('Avg Speed')}</Table.Th>}
                                            {visibleSplitStats.avg_hr && <Table.Th>{t("Avg HR")}</Table.Th>}
                                            {visibleSplitStats.max_hr && <Table.Th>{t("Max HR")}</Table.Th>}
                                            {isCyclingActivity && visibleSplitStats.avg_watts && <Table.Th>{t("Avg W")}</Table.Th>}
                                            {isCyclingActivity && visibleSplitStats.max_watts && <Table.Th>{t("Max W")}</Table.Th>}
                                            {isCyclingActivity && visibleSplitStats.normalized_power && <Table.Th>NP</Table.Th>}
                                            {splitAnnotationsVisible && <Table.Th>RPE</Table.Th>}
                                            {splitAnnotationsVisible && <Table.Th>{t("Lactate")}</Table.Th>}
                                            {splitAnnotationsVisible && <Table.Th>{t("Note")}</Table.Th>}
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {splitsToDisplayWithPower.map((split: any, idx: number) => (
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
                                        <Button size="xs" loading={updateActivityMutation.isPending}
                                            onClick={() => {
                                                const splitType = splitMode === 'metric' ? 'metric' : 'laps';
                                                const split_annotations = Object.entries(splitAnnotations).map(([index, value]) => ({
                                                    split_type: splitType as 'metric' | 'laps',
                                                    split_index: Number(index),
                                                    rpe: value.rpe,
                                                    lactate_mmol_l: value.lactate_mmol_l,
                                                    note: value.note?.trim() ? value.note.trim() : null,
                                                }));
                                                updateActivityMutation.mutate({ split_annotations }, {
                                                    onSuccess: () => setSplitAnnotationsDirty(false)
                                                });
                                            }}
                                        >
                                            {t("Save Annotations")}
                                        </Button>
                                    </Group>
                                )}
                            </Paper>
                        </Tabs.Panel>
                        ) : null}

                        {/* BEST EFFORTS TAB */}
                        {activity.best_efforts?.length ? (
                        <Tabs.Panel value="best_efforts">
                            <Paper withBorder p="md" radius="lg" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Group justify="space-between" mb="md">
                                    <Title order={5} c={ui.textMain}>{t("Best Efforts")}</Title>
                                    {hasHiddenBestEfforts && (
                                        <Button size="xs" variant="subtle" onClick={() => setShowAllBestEfforts(!showAllBestEfforts)}>
                                            {showAllBestEfforts ? t('Show PRs only') : t('Show all efforts')}
                                        </Button>
                                    )}
                                </Group>
                                <Box style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                                {(() => {
                                    const hasCyclingDistEfforts = isCyclingActivity && displayedBestEfforts.some(e => e.distance);
                                    return (
                                <Table striped highlightOnHover withTableBorder withColumnBorders style={{ whiteSpace: 'nowrap' }}>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th></Table.Th>
                                            <Table.Th>{t('Effort')}</Table.Th>
                                            {isCyclingActivity && <Table.Th>{t('Power')}</Table.Th>}
                                            {isCyclingActivity && me?.profile?.weight && <Table.Th>W/kg</Table.Th>}
                                            {(isRunningActivity || hasCyclingDistEfforts) && <Table.Th>{t('Time')}</Table.Th>}
                                            {isRunningActivity && <Table.Th>{t('Pace')}</Table.Th>}
                                            {hasCyclingDistEfforts && <Table.Th>{t('Speed')}</Table.Th>}
                                            <Table.Th>{t('Heart Rate')}</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {displayedBestEfforts.map((effort, idx) => {
                                            const key = effort.window || effort.distance || String(idx);
                                            const prRank = activity.personal_records?.[key];
                                            const weight = me?.profile?.weight;
                                            const medalColor = prRank === 1 ? '#f0a500' : prRank === 2 ? '#a0a0a0' : prRank === 3 ? '#cd7f32' : undefined;
                                            const rankLabel = prRank === 1 ? 'PR' : prRank === 2 ? '2nd' : prRank === 3 ? '3rd' : undefined;
                                            return (
                                                <Table.Tr key={key}>
                                                    <Table.Td w={60} style={{ textAlign: 'center' }}>
                                                        {medalColor && (
                                                            <Group gap={2} wrap="nowrap" justify="center">
                                                                <IconTrophy size={14} color={medalColor} />
                                                                <Text size="10px" fw={700} c={medalColor}>{rankLabel}</Text>
                                                            </Group>
                                                        )}
                                                    </Table.Td>
                                                    <Table.Td fw={600}>{effort.window || effort.distance}</Table.Td>
                                                    {isCyclingActivity && <Table.Td>{effort.power != null ? `${effort.power} W` : '-'}</Table.Td>}
                                                    {isCyclingActivity && weight && <Table.Td>{effort.power != null ? `${(effort.power / weight).toFixed(2)} W/kg` : '-'}</Table.Td>}
                                                    {(isRunningActivity || hasCyclingDistEfforts) && <Table.Td>{effort.time_seconds != null ? formatDuration(effort.time_seconds) : '-'}</Table.Td>}
                                                    {isRunningActivity && (
                                                        <Table.Td>
                                                            {effort.time_seconds != null && effort.meters
                                                                ? (() => { const paceMinPerKm = (effort.time_seconds! / effort.meters!) * (1000 / 60); const mins = Math.floor(paceMinPerKm); const secs = Math.round((paceMinPerKm - mins) * 60); return `${mins}:${secs.toString().padStart(2, '0')} /km`; })()
                                                                : '-'}
                                                        </Table.Td>
                                                    )}
                                                    {hasCyclingDistEfforts && (
                                                        <Table.Td>
                                                            {effort.time_seconds != null && effort.meters
                                                                ? `${((effort.meters / 1000) / (effort.time_seconds / 3600)).toFixed(1)} km/h`
                                                                : '-'}
                                                        </Table.Td>
                                                    )}
                                                    <Table.Td>{effort.avg_hr != null ? `${effort.avg_hr} bpm` : '-'}</Table.Td>
                                                </Table.Tr>
                                            );
                                        })}
                                    </Table.Tbody>
                                </Table>
                                    );
                                })()}
                                </Box>
                                <Group gap="md" mt="sm">
                                    <Group gap={4}><IconTrophy size={12} color="#f0a500" /><Text size="xs" c="dimmed">{t('PR')}</Text></Group>
                                    <Group gap={4}><IconTrophy size={12} color="#a0a0a0" /><Text size="xs" c="dimmed">{t('2nd')}</Text></Group>
                                    <Group gap={4}><IconTrophy size={12} color="#cd7f32" /><Text size="xs" c="dimmed">{t('3rd')}</Text></Group>
                                </Group>
                            </Paper>
                        </Tabs.Panel>
                        ) : null}

                        {/* COMPARISON TAB */}
                        {activity.planned_comparison ? (
                        <Tabs.Panel value="comparison">
                            <Paper withBorder p="md" radius="lg" mb="sm" bg={ui.surface} style={{ borderColor: ui.border }}>
                                <Group justify="space-between" mb="xs">
                                    <Title order={5} c={ui.textMain}>Planned vs Actual</Title>
                                    <Text size="xs" c={ui.textDim}>{activity.planned_comparison.workout_title}</Text>
                                </Group>
                            <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="xs" mb="sm">
                                {activity.planned_comparison.summary?.has_planned_distance && (
                                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Duration Delta</Text>
                                    <Text fw={700}>{(activity.planned_comparison.summary?.duration_delta_min || 0).toFixed(1)} min</Text>
                                </Card>
                                )}
                                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Duration Match</Text>
                                    <Text fw={700}>{Math.round(activity.planned_comparison.summary?.duration_match_pct || 0)}%</Text>
                                </Card>
                                {activity.planned_comparison.summary?.has_planned_distance && (
                                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Distance Delta</Text>
                                    <Text fw={700}>{(activity.planned_comparison.summary?.distance_delta_km || 0).toFixed(2)} km</Text>
                                </Card>
                                )}
                                {activity.planned_comparison.summary?.has_planned_distance && (
                                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Distance Match</Text>
                                    <Text fw={700}>{Math.round(activity.planned_comparison.summary?.distance_match_pct || 0)}%</Text>
                                </Card>
                                )}
                                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                                    <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Intensity Match</Text>
                                    <Text fw={700}>{Math.round(activity.planned_comparison.summary?.intensity_match_pct || 0)}%</Text>
                                </Card>
                                <Card withBorder radius="md" p="xs" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                                    <Group justify="space-between" align="center" gap={6}>
                                        <Text size="10px" c="dimmed" tt="uppercase" fw={700}>Workout Execution Status</Text>
                                        <ActionIcon variant="subtle" size="xs" onClick={() => setExecutionInfoOpen(true)} aria-label="Execution status info">
                                            <IconHelpCircle size={14} />
                                        </ActionIcon>
                                    </Group>
                                    <Text fw={700} c={
                                        activity.planned_comparison.summary?.execution_status === 'great' || activity.planned_comparison.summary?.execution_status === 'good'
                                            ? 'green.6'
                                            : activity.planned_comparison.summary?.execution_status === 'ok' || activity.planned_comparison.summary?.execution_status === 'fair' || activity.planned_comparison.summary?.execution_status === 'subpar'
                                                ? 'yellow.6'
                                                : activity.planned_comparison.summary?.execution_status === 'poor' || activity.planned_comparison.summary?.execution_status === 'incomplete'
                                                    ? 'red.6'
                                                    : ui.textMain
                                    }>
                                        {(activity.planned_comparison.summary?.execution_status || '-').toString().toUpperCase()}
                                    </Text>
                                </Card>
                            </SimpleGrid>
                            {activity.planned_comparison.summary?.split_importance === 'low' && (
                                <Text size="xs" c={ui.textDim} mb="xs">
                                    {activity.planned_comparison.summary?.split_note || activity.planned_comparison.intensity?.note}
                                </Text>
                            )}
                            {!!executionTraceRows.length && (
                                <Paper withBorder radius="md" p="sm" mb="sm" bg={ui.surfaceAlt} style={{ borderColor: ui.border }}>
                                    <Group justify="space-between" mb={6}>
                                        <Text size="sm" fw={700} c={ui.textMain}>Execution Explainability</Text>
                                        <Badge variant="light">Traceable weights</Badge>
                                    </Group>
                                    <Text size="xs" c={ui.textDim} mb="xs">
                                        Score formula: Σ(component score × weight) / Σ(used weights).
                                    </Text>
                                    <Table striped highlightOnHover withTableBorder withColumnBorders>
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>Component</Table.Th>
                                                <Table.Th>Score</Table.Th>
                                                <Table.Th>Weight</Table.Th>
                                                <Table.Th>Weighted Pts</Table.Th>
                                                <Table.Th>Contribution</Table.Th>
                                                <Table.Th>Trace</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {executionTraceRows.map((row) => (
                                                <Table.Tr key={`exec-trace-${row.key}`}>
                                                    <Table.Td>{row.label}</Table.Td>
                                                    <Table.Td>{row.componentScorePct != null ? `${row.componentScorePct.toFixed(1)}%` : '-'}</Table.Td>
                                                    <Table.Td>{row.weightPct.toFixed(1)}%</Table.Td>
                                                    <Table.Td>{row.weightedPoints != null ? row.weightedPoints.toFixed(2) : '-'}</Table.Td>
                                                    <Table.Td>{row.normalizedContributionPct != null ? `${row.normalizedContributionPct.toFixed(1)}%` : '-'}</Table.Td>
                                                    <Table.Td>{row.available ? 'Included' : (row.note || 'Excluded')}</Table.Td>
                                                </Table.Tr>
                                            ))}
                                        </Table.Tbody>
                                    </Table>
                                    <Group mt="xs" gap="md">
                                        <Text size="xs" c={ui.textDim}>Used weight: {executionTraceMeta.usedWeightPct.toFixed(1)}%</Text>
                                        <Text size="xs" c={ui.textDim}>Weighted total: {executionTraceMeta.weightedTotalPoints.toFixed(2)}</Text>
                                        <Text size="xs" c={ui.textDim}>Normalizer: {executionTraceMeta.normalizationDivisor.toFixed(3)}</Text>
                                        <Text size="xs" c={ui.textDim}>Rebuilt score: {executionTraceMeta.reconstructedScorePct != null ? `${executionTraceMeta.reconstructedScorePct.toFixed(1)}%` : '-'}</Text>
                                    </Group>
                                </Paper>
                            )}
                            {!!activity.planned_comparison.splits?.length && (
                                <Table striped highlightOnHover withTableBorder withColumnBorders>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>Split</Table.Th>
                                            <Table.Th>Planned</Table.Th>
                                            <Table.Th>Actual</Table.Th>
                                            <Table.Th>Planned Intensity</Table.Th>
                                            <Table.Th>Actual Intensity</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {activity.planned_comparison.splits.slice(0, 20).map((row) => (
                                            <Table.Tr key={`cmp-split-${row.split}`}>
                                                <Table.Td>{row.split}</Table.Td>
                                                <Table.Td>{row.planned?.planned_duration_s ? formatDuration(row.planned.planned_duration_s, true) : '-'}</Table.Td>
                                                <Table.Td>{row.actual?.actual_duration_s ? formatDuration(row.actual.actual_duration_s, true) : '-'}</Table.Td>
                                                <Table.Td>
                                                    {(() => {
                                                        const p = row.planned;
                                                        if (!p?.target) return '-';
                                                        const t = p.target;
                                                        
                                                        // Prioritize exact value
                                                        if (t.value != null) {
                                                            const val = Number(t.value);
                                                            if (val > 0) {
                                                                if (t.type === 'heart_rate') return `${Math.round(val)} bpm`;
                                                                if (t.type === 'power') return `${Math.round(val)} W`;
                                                                if (t.type === 'pace') {
                                                                    // Helper to format s/km
                                                                    const formatSecondsPerKm = (seconds: number) => {
                                                                        const m = Math.floor(seconds / 60);
                                                                        const s = Math.round(seconds % 60);
                                                                        return `${m}:${s.toString().padStart(2, '0')}/km`;
                                                                    };
                                                                    // Heuristic: values > 20 differ from m/s (usually < 10)
                                                                    if (val > 20) return formatSecondsPerKm(val);
                                                                    return formatPace(val);
                                                                }
                                                                return `${Math.round(val)}`;
                                                            }
                                                        }

                                                        // Range fallback
                                                        if (t.min && t.max) {
                                                            if (t.type === 'heart_rate') return `${t.min}-${t.max} bpm`;
                                                            if (t.type === 'power') return `${t.min}-${t.max} W`;
                                                            if (t.type === 'pace') return `${formatPace(Number(t.min))} - ${formatPace(Number(t.max))}`;
                                                        }
                                                        
                                                        // Zone fallback
                                                        if (t.zone) return `Zone ${t.zone}`;
                                                        
                                                        return '-';
                                                    })()}
                                                </Table.Td>
                                                <Table.Td>
                                                     {(() => {
                                                        const actual = row.actual;
                                                        if (!actual) return '-';
                                                        const type = row.planned?.target?.type;
                                                        if (type === 'heart_rate') return actual.avg_hr ? `${Math.round(actual.avg_hr)} bpm` : '-';
                                                        if (type === 'power') return actual.avg_power ? `${Math.round(actual.avg_power)} W` : '-';
                                                        // Pace target often used in running
                                                        if (type === 'pace' && actual.avg_speed) return formatPace(actual.avg_speed);
                                                        
                                                        // Fallback priority
                                                        if (activity.sport === 'running' && actual.avg_speed) return formatPace(actual.avg_speed);
                                                        if (actual.avg_power) return `${Math.round(actual.avg_power)} W`;
                                                        if (actual.avg_hr) return `${Math.round(actual.avg_hr)} bpm`;
                                                        return '-';
                                                     })()}
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            )}
                        </Paper>
                            <Modal
                                opened={executionInfoOpen}
                                onClose={() => setExecutionInfoOpen(false)}
                                title="Workout Execution Status"
                                size="md"
                                centered
                            >
                                <Stack gap="xs">
                                    <Text size="sm" c={ui.textDim}>
                                        Execution status is a weighted workout-quality score built from available metrics:
                                        duration match, distance match (when planned), intensity match, and split adherence (when splits are relevant).
                                    </Text>
                                    <Text size="sm" c={ui.textDim}>
                                        If a workout is steady-state (for example a regular Z2 ride), intensity quality is prioritized over auto-split count.
                                    </Text>
                                    <Text size="sm" fw={700}>Status levels (best to worst):</Text>
                                    <Text size="sm">Great, Good, Ok, Fair, Subpar, Poor, Incomplete.</Text>
                                    <Text size="sm" c={ui.textDim}>
                                        Incomplete is used when key execution data is missing or the session is not sufficiently complete for reliable scoring.
                                    </Text>
                                    {!!executionTraceRows.length && (
                                        <>
                                            <Text size="sm" fw={700}>Traceability breakdown</Text>
                                            <Table striped highlightOnHover withTableBorder withColumnBorders>
                                                <Table.Thead>
                                                    <Table.Tr>
                                                        <Table.Th>Component</Table.Th>
                                                        <Table.Th>Score</Table.Th>
                                                        <Table.Th>Weight</Table.Th>
                                                        <Table.Th>Weighted</Table.Th>
                                                        <Table.Th>In Score</Table.Th>
                                                    </Table.Tr>
                                                </Table.Thead>
                                                <Table.Tbody>
                                                    {executionTraceRows.map((row) => (
                                                    <Table.Tr key={`exec-modal-${row.key}`}>
                                                        <Table.Td>{row.label}</Table.Td>
                                                        <Table.Td>{row.componentScorePct != null ? `${row.componentScorePct.toFixed(1)}%` : '-'}</Table.Td>
                                                        <Table.Td>{row.weightPct.toFixed(1)}%</Table.Td>
                                                        <Table.Td>{row.weightedPoints != null ? row.weightedPoints.toFixed(2) : '-'}</Table.Td>
                                                        <Table.Td>{row.available ? 'Yes' : 'No'}</Table.Td>
                                                    </Table.Tr>
                                                ))}
                                            </Table.Tbody>
                                        </Table>
                                        <Text size="sm" c={ui.textDim}>
                                            Reconstructed execution score: {executionTraceMeta.reconstructedScorePct != null ? `${executionTraceMeta.reconstructedScorePct.toFixed(1)}%` : '-'}
                                            {' '}from weighted total {executionTraceMeta.weightedTotalPoints.toFixed(2)} and normalizer {executionTraceMeta.normalizationDivisor.toFixed(3)}.
                                        </Text>
                                        <Text size="sm" fw={700}>Thresholds</Text>
                                        <Group gap="xs" wrap="wrap">
                                            {executionTraceMeta.thresholds.map((row) => (
                                                <Badge key={`exec-threshold-${row.status}`} variant="light">
                                                    {row.status.toUpperCase()} ≥ {row.minScorePct.toFixed(0)}%
                                                </Badge>
                                            ))}
                                        </Group>
                                    </>
                                )}
                                </Stack>
                            </Modal>
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

                <Modal
                    opened={mapFullscreen}
                    onClose={() => { setMapFullscreen(false); setFsMapIndex(null); }}
                    size="100%"
                    padding={0}
                    withCloseButton
                    title={activity.filename}
                    styles={{ body: { height: 'calc(90vh - 60px)', padding: 0, display: 'flex', flexDirection: 'column' }, content: { height: '90vh' } }}
                >
                    {routePositions.length > 0 && (
                        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                            {/* Map */}
                            <Box style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                                <MapContainer center={centerPos} zoom={13} style={{ height: '100%', width: '100%' }}>
                                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                                    <Polyline positions={routePositions} color="blue" weight={4} opacity={0.6} />
                                    <MapFitBounds positions={routePositions} />
                                    {fsMapMarkerPos && <MapPanTo position={fsMapMarkerPos} />}
                                    {fsMapMarkerPos && (
                                        <CircleMarker center={fsMapMarkerPos} radius={8} pathOptions={{ color: '#fff', fillColor: '#E95A12', fillOpacity: 1, weight: 3 }}>
                                            {fsMapPoint && (
                                                <LeafletTooltip permanent direction="top" offset={[0, -12]}>
                                                    <div style={{ fontSize: 12, lineHeight: 1.5, minWidth: 110 }}>
                                                        <div style={{ fontWeight: 600, marginBottom: 2 }}>
                                                            {Math.floor(fsMapPoint.timeMin)}:{Math.round((fsMapPoint.timeMin % 1) * 60).toString().padStart(2, '0')} elapsed
                                                        </div>
                                                        {fsMapPoint.heart_rate != null && (
                                                            <div>HR: {fsMapPoint.heart_rate} bpm</div>
                                                        )}
                                                        {fsMapPoint.paceDisplay != null && (
                                                            <div>Pace: {fsMapPoint.paceDisplay}</div>
                                                        )}
                                                        {fsMapPoint.paceDisplay == null && fsMapPoint.speedKmh != null && (
                                                            <div>Speed: {fsMapPoint.speedKmh.toFixed(1)} km/h</div>
                                                        )}
                                                        {fsMapPoint.power != null && fsMapPoint.power > 0 && (
                                                            <div>Power: {Math.round(fsMapPoint.power)} W</div>
                                                        )}
                                                        {fsMapPoint.altitude != null && (
                                                            <div>Elev: {Math.round(fsMapPoint.altitude)} m</div>
                                                        )}
                                                    </div>
                                                </LeafletTooltip>
                                            )}
                                        </CircleMarker>
                                    )}
                                </MapContainer>
                            </Box>
                            {/* Elevation graph */}
                            {gpsChartData.length > 0 && (
                                <Box style={{ height: 120, flexShrink: 0, background: isDark ? '#0E1A30' : '#F8FAFF', borderTop: `1px solid ${ui.border}` }} px="xs">
                                    <ResponsiveContainer width="100%" height={120}>
                                        <AreaChart data={gpsChartData} onMouseMove={handleFsElevationMove} onMouseLeave={handleFsElevationLeave} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                                            <defs>
                                                <linearGradient id="fsElevGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={isDark ? '#60A5FA' : '#3B82F6'} stopOpacity={0.4} />
                                                    <stop offset="100%" stopColor={isDark ? '#60A5FA' : '#3B82F6'} stopOpacity={0.05} />
                                                </linearGradient>
                                            </defs>
                                            <XAxis dataKey="distance_km" tick={{ fontSize: 10, fill: ui.textDim }} tickFormatter={(v: number) => `${v.toFixed(1)}`} axisLine={false} tickLine={false} />
                                            <YAxis tick={{ fontSize: 10, fill: ui.textDim }} axisLine={false} tickLine={false} width={35} domain={['dataMin - 10', 'dataMax + 10']} tickFormatter={(v: number) => `${Math.round(v)}m`} />
                                            <Tooltip
                                                content={({ active, payload }) => {
                                                    if (!active || !payload?.[0]) return null;
                                                    const d = payload[0].payload;
                                                    return (
                                                        <Paper withBorder p={6} radius="sm" bg={ui.surfaceAlt} style={{ fontSize: 11 }}>
                                                            <Text size="xs" fw={600} c={ui.textDim}>{d.distance_km?.toFixed(2)} km</Text>
                                                            <Text size="xs" c={ui.textMain}>Elevation: {Math.round(d.altitude ?? 0)} m</Text>
                                                        </Paper>
                                                    );
                                                }}
                                                isAnimationActive={false}
                                                cursor={{ stroke: ui.accent, strokeWidth: 1 }}
                                            />
                                            <Area type="monotone" dataKey="altitude" stroke={isDark ? '#60A5FA' : '#3B82F6'} strokeWidth={1.5} fill="url(#fsElevGrad)" isAnimationActive={false} dot={false} connectNulls />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </Box>
                            )}
                        </Box>
                    )}
                </Modal>
            </AppShell.Main>
        </AppShell>
    );
};


import { ActionIcon, AppShell, Box, Button, Card, Container, Grid, Group, Paper, Select, SimpleGrid, Stack, Switch, Text, Title, Badge, SegmentedControl, Chip, Table, ThemeIcon, useComputedColorScheme, NumberInput, Textarea, Modal, TextInput } from "@mantine/core";
import { IconArrowLeft, IconBolt, IconHeart, IconMap, IconClock, IconActivity } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts';
import { MapContainer, TileLayer, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from "../api/client";
import { useEffect, useMemo, useState } from "react";
import L from 'leaflet';
import { formatDuration, formatZoneDuration } from "../components/activityDetail/formatters";

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
  filename: string;
  created_at: string;
  sport: string;
  distance: number;
  duration: number;
  avg_speed: number;
  average_hr: number;
  average_watts: number;
    streams: any;
  power_curve: Record<string, number> | null;
  hr_zones: Record<string, number> | null;
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
    notes?: string | null;
};

export const ActivityDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const isDark = useComputedColorScheme('light') === 'dark';
    const [graphMode, setGraphMode] = useState<'standard' | 'power_curve' | 'hr_zones' | 'pace_zones' | 'power_zones'>('standard');
    const [splitMode, setSplitMode] = useState<'metric' | 'laps'>('metric');
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
    const [splitAnnotationsOpen, setSplitAnnotationsOpen] = useState(false);
    const [splitAnnotations, setSplitAnnotations] = useState<Record<number, { lactate_mmol_l: number | null; note: string }>>({});
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [zoneInfoOpen, setZoneInfoOpen] = useState(false);
    const [zoneInfoTitle, setZoneInfoTitle] = useState('');
    const [zoneInfoBody, setZoneInfoBody] = useState('');

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
        mutationFn: async (payload: { rpe?: number | null; notes?: string | null; split_annotations?: Array<{ split_type: 'metric' | 'laps'; split_index: number; lactate_mmol_l?: number | null; note?: string | null }> }) => {
            const res = await api.patch<ActivityDetail>(`/activities/${id}`, payload);
            return res.data;
        },
        onSuccess: (updated) => {
            queryClient.setQueryData(['activity', id], updated);
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
        }
    });
    
    const { data: activity, isLoading, isError } = useQuery({
        queryKey: ['activity', id],
        queryFn: async () => {
             const res = await api.get<ActivityDetail>(`/activities/${id}`);
             return res.data;
        }
    });

    const streamPoints = useMemo(() => {
        if (!activity?.streams) return [];
        if (Array.isArray(activity.streams)) return activity.streams;
        if (Array.isArray(activity.streams?.data)) return activity.streams.data;
        return [];
    }, [activity]);

    const routePositions = useMemo(() => {
        return streamPoints
            .filter((p: any) => p.lat && p.lon)
            .map((p: any) => [p.lat, p.lon] as [number, number]);
    }, [streamPoints]);

    const chartData = useMemo(() => {
        if (!activity || streamPoints.length === 0) return [];
        const startTs = new Date(streamPoints[0]?.timestamp).getTime();

        return streamPoints.map((s: any, index: number) => {
            let pace = null;
            if (s.speed && s.speed > 0.1) {
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

    const hrZoneData = useMemo(() => {
        const zoneSeconds = Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;

        const maxHr = Number(me?.profile?.max_hr || activity?.max_hr || 190);
        const validHrSamples = streamPoints
            .map((sample: any) => Number(sample?.heart_rate || 0))
            .filter((hr: number) => Number.isFinite(hr) && hr > 0);

        if (validHrSamples.length > 0 && maxHr > 0) {
            const sampleSeconds = activity?.duration && activity.duration > 0 ? activity.duration / validHrSamples.length : 1;
            validHrSamples.forEach((hr: number) => {
                const ratio = hr / maxHr;
                const zone = ratio < 0.6 ? 1 : ratio < 0.7 ? 2 : ratio < 0.8 ? 3 : ratio < 0.9 ? 4 : 5;
                zoneSeconds[`Z${zone}`] += Math.round(sampleSeconds);
            });
        } else if (activity?.hr_zones && typeof activity.hr_zones === 'object' && Object.keys(activity.hr_zones).length > 0) {
            for (let zone = 1; zone <= 5; zone += 1) {
                zoneSeconds[`Z${zone}`] += Number((activity.hr_zones as any)[`Z${zone}`] || 0);
            }
        } else if (activity?.average_hr && activity?.duration) {
            const ratio = Number(activity.average_hr) / maxHr;
            const zone = ratio < 0.6 ? 1 : ratio < 0.7 ? 2 : ratio < 0.8 ? 3 : ratio < 0.9 ? 4 : 5;
            zoneSeconds[`Z${zone}`] += Math.round(activity.duration);
        }

        return Array.from({ length: 5 }, (_, idx) => {
            const zone = `Z${idx + 1}`;
            return { zone, seconds: zoneSeconds[zone] || 0 };
        });
    }, [activity, streamPoints, me?.profile?.max_hr]);

    const powerCurveData = useMemo(() => {
        if (!activity?.power_curve) return [];
        return Object.entries(activity.power_curve).map(([label, watts]) => ({
            label,
            watts
        }));
    }, [activity]);

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

        let ftp = Number(me?.profile?.ftp || 0);
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
            .filter((value: number) => Number.isFinite(value) && value > 0);
        return calculateNormalizedPower(powerSamples);
    }, [streamPoints]);

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

            const powerSamples = segmentPoints
                .map((point: any) => Number(point?.power ?? -1))
                .filter((value: number) => Number.isFinite(value) && value > 0);

            const avgFromSegment = powerSamples.length
                ? powerSamples.reduce((sum: number, value: number) => sum + value, 0) / powerSamples.length
                : null;
            const avgFromSplit = Number(split?.avg_power);
            const avgWatts = Number.isFinite(avgFromSplit) && avgFromSplit > 0 ? avgFromSplit : avgFromSegment;

            const maxWatts = powerSamples.length ? Math.max(...powerSamples) : null;
            const normalizedPower = calculateNormalizedPower(powerSamples);

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
        const initial: Record<number, { lactate_mmol_l: number | null; note: string }> = {};
        splitsToDisplayWithPower.forEach((split: any, idx: number) => {
            initial[idx] = {
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

    const focusSeries = useMemo(() => {
        if (!focusMode) return visibleSeries;
        if (focusObjective === 'cardio') {
            return {
                heart_rate: true,
                power: false,
                pace: true,
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
            pace: true,
            cadence: false,
            altitude: true
        };
    }, [focusMode, focusObjective, visibleSeries]);


    if (isLoading) return <Container my={60}><Text>Loading activity...</Text></Container>;
    if (isError || !activity) return <Container my={60}><Text c="red">Error loading activity.</Text></Container>;

    const sportName = (activity.sport || '').toLowerCase();
    const isRunningActivity = sportName.includes('run');
    const isCyclingActivity = sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride') || sportName.includes('virtualride');

    const centerPos = routePositions.length > 0 ? routePositions[Math.floor(routePositions.length / 2)] : [51.505, -0.09] as [number, number];

    return (
        <AppShell header={{ height: 60 }} padding="md">
            <AppShell.Header p="md">
                <Group>
                    <ActionIcon variant="light" onClick={handleBack}><IconArrowLeft /></ActionIcon>
                    <Title order={4}>{activity.filename}</Title>
                    <Badge color={activity.sport === 'running' ? 'green' : 'blue'}>{activity.sport || 'activity'}</Badge>
                    {activity.is_deleted && <Badge color="red" variant="light">Deleted</Badge>}
                    {canDeleteActivity && (
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
                    )}
                </Group>
            </AppShell.Header>
            <AppShell.Main bg="var(--mantine-color-body)">
                <Container size="xl">
                    {completionPulse && (
                        <Paper withBorder p="sm" mb="md" bg={isDark ? 'rgba(124,255,178,0.1)' : 'green.0'}>
                            <Group justify="space-between">
                                <Text fw={600} size="sm">Workout complete</Text>
                                <Text size="xs" c="dimmed">Planned vs actual is ready to review</Text>
                            </Group>
                        </Paper>
                    )}
                    <SimpleGrid cols={{ base: 1, md: 4 }} mb="lg">
                        <Card withBorder padding="lg">
                            <ThemeIcon size="lg" radius="md" variant="light" color="blue" mb="xs">
                                <IconMap size={20} />
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Distance</Text>
                            <Text size="xl" fw={700}>
                                {me?.profile?.preferred_units === 'imperial' 
                                    ? <>{(activity.distance * 0.000621371).toFixed(2)} mi</>
                                    : <>{(activity.distance / 1000).toFixed(2)} km</>
                                }
                            </Text>
                        </Card>
                        <Card withBorder padding="lg">
                            <ThemeIcon size="lg" radius="md" variant="light" color="yellow" mb="xs">
                                <IconClock size={20} />
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Duration</Text>
                            <Text size="xl" fw={700}>{formatDuration(activity.duration)}</Text>
                        </Card>
                         <Card withBorder padding="lg">
                            <ThemeIcon size="lg" radius="md" variant="light" color={activity.sport === 'running' ? "cyan" : "orange"} mb="xs">
                                {activity.sport === 'running' ? <IconActivity size={20} /> : <IconBolt size={20} />}
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{activity.sport === 'running' ? 'Avg Pace' : 'Avg Power'}</Text>
                            <Text size="xl" fw={700}>
                                {activity.sport === 'running' 
                                    ? formatPace(activity.avg_speed).replace('/km', '')
                                    : (activity.average_watts ? activity.average_watts.toFixed(0) + ' W' : '-')}
                            </Text>
                        </Card>
                         <Card withBorder padding="lg">
                            <ThemeIcon size="lg" radius="md" variant="light" color="red" mb="xs">
                                <IconHeart size={20} />
                            </ThemeIcon>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Avg HR</Text>
                            <Text size="xl" fw={700}>{activity.average_hr?.toFixed(0) || '-'} bpm</Text>
                        </Card>
                    </SimpleGrid>

                    <Paper withBorder p="md" radius="md" mb="lg">
                        <Group justify="space-between" align="flex-start" mb="sm">
                            <Stack gap={2}>
                                <Title order={5}>Session Feedback</Title>
                                <Text size="xs" c="dimmed">Keep it short: RPE and one note. Coaches can update this too.</Text>
                            </Stack>
                            <Button
                                size="xs"
                                loading={updateActivityMutation.isPending}
                                onClick={() => {
                                    updateActivityMutation.mutate({
                                        rpe: activityRpe,
                                        notes: activityNotes.trim() ? activityNotes.trim() : null
                                    });
                                }}
                            >
                                Save Feedback
                            </Button>
                        </Group>
                        <Group align="flex-start" grow>
                            <NumberInput
                                label="RPE"
                                description="1-10"
                                min={1}
                                max={10}
                                value={activityRpe === null ? undefined : activityRpe}
                                onChange={(val) => setActivityRpe(typeof val === 'number' ? val : null)}
                            />
                            <Textarea
                                label="Notes"
                                placeholder="How did this session feel?"
                                minRows={2}
                                maxLength={400}
                                value={activityNotes}
                                onChange={(e) => setActivityNotes(e.currentTarget.value)}
                            />
                        </Group>
                    </Paper>

                    <Grid gutter="lg">
                        <Grid.Col span={{ base: 12, md: 8 }}>
                             <Stack gap="lg">
                                {/* Charts Section */}
                                <Paper withBorder p="md" radius="md">
                                    <Group justify="space-between" mb="md">
                                        <Stack gap={4}>
                                            <Title order={5}>Analysis</Title>
                                            {focusMode && <Text size="xs" c="dimmed">Focus mode keeps only key signals for this review objective.</Text>}
                                        </Stack>
                                        <Group>
                                            <Select
                                                size="xs"
                                                value={focusObjective}
                                                onChange={(value) => setFocusObjective((value as 'pacing' | 'cardio' | 'efficiency') || 'pacing')}
                                                data={[
                                                    { value: 'pacing', label: 'Pacing Discipline' },
                                                    { value: 'cardio', label: 'Cardio Drift' },
                                                    { value: 'efficiency', label: 'Power Efficiency' },
                                                ]}
                                                disabled={!focusMode}
                                                w={180}
                                            />
                                            <Switch
                                                checked={focusMode}
                                                onChange={(event) => setFocusMode(event.currentTarget.checked)}
                                                label="Focus Mode"
                                            />
                                        </Group>
                                        <SegmentedControl 
                                            value={graphMode}
                                            onChange={(v: any) => setGraphMode(v)}
                                            data={[
                                                { label: 'Overview', value: 'standard'},
                                                { label: 'Power Curve', value: 'power_curve', disabled: !activity.power_curve },
                                                { label: 'HR Zones', value: 'hr_zones', disabled: hrZoneData.every((z) => z.seconds <= 0) },
                                                ...(isRunningActivity ? [{ label: 'Pace Zones', value: 'pace_zones', disabled: runningPaceZoneData.every((z) => z.seconds <= 0) }] : []),
                                                ...(isCyclingActivity ? [{ label: 'Power Zones', value: 'power_zones', disabled: cyclingPowerZoneData.every((z) => z.seconds <= 0) }] : []),
                                            ]}
                                        />
                                    </Group>
                                    
                                    <Box w="100%" mih={300}>
                                        {graphMode === 'standard' && (
                                            <>
                                                <Group mb="sm" gap="xs">
                                                    <Text size="xs" fw={700}>Show:</Text>
                                                    <Chip checked={focusSeries.heart_rate} disabled={focusMode} onChange={() => setVisibleSeries(v => ({...v, heart_rate: !v.heart_rate}))} size="xs" color="red" variant="light">Heart Rate</Chip>
                                                    <Chip checked={focusSeries.pace} disabled={focusMode} onChange={() => setVisibleSeries(v => ({...v, pace: !v.pace}))} size="xs" color="blue" variant="light">Pace</Chip>
                                                    <Chip checked={focusSeries.power} disabled={focusMode} onChange={() => setVisibleSeries(v => ({...v, power: !v.power}))} size="xs" color="orange" variant="light">Power</Chip>
                                                    <Chip checked={focusSeries.cadence} disabled={focusMode} onChange={() => setVisibleSeries(v => ({...v, cadence: !v.cadence}))} size="xs" color="cyan" variant="light">Cadence</Chip>
                                                    <Chip checked={focusSeries.altitude} disabled={focusMode} onChange={() => setVisibleSeries(v => ({...v, altitude: !v.altitude}))} size="xs" color="green" variant="light">Altitude</Chip>
                                                </Group>

                                                <Stack gap="xs">
                                                    {focusSeries.heart_rate && (
                                                        <Box h={160} w="100%">
                                                            <ResponsiveContainer>
                                                                <AreaChart data={chartData} syncId="activityGraph" margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                                    <XAxis dataKey="distance_km" hide />
                                                                    <YAxis dataKey="heart_rate" orientation="right" domain={['dataMin - 5', 'dataMax + 5']} width={40} tick={{fontSize: 10}} />
                                                                    <Tooltip 
                                                                        labelFormatter={(val) => `${Number(val).toFixed(2)} ${me?.profile?.preferred_units === 'imperial' ? 'mi' : 'km'}`}
                                                                        formatter={(val: number) => [val, 'HR']} 
                                                                    />
                                                                    <Area type="monotone" dataKey="heart_rate" stroke="#fa5252" fill="#fa5252" fillOpacity={0.15} strokeWidth={2} activeDot={{ r: 4 }} />
                                                                </AreaChart>
                                                            </ResponsiveContainer>
                                                        </Box>
                                                    )}

                                                    {focusSeries.pace && (
                                                        <Box h={160} w="100%">
                                                            <ResponsiveContainer>
                                                                <AreaChart data={chartData} syncId="activityGraph" margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                                    <XAxis dataKey="distance_km" hide />
                                                                    <YAxis 
                                                                        dataKey="pace" 
                                                                        orientation="right" 
                                                                        reversed 
                                                                        domain={['dataMin', 'dataMax']} 
                                                                        width={40} 
                                                                        tick={{fontSize: 10}}
                                                                        tickFormatter={(val) => {
                                                                            const m = Math.floor(val);
                                                                            return `${m}:${Math.floor((val-m)*60).toString().padStart(2,'0')}`;
                                                                        }}
                                                                    />
                                                                    <Tooltip 
                                                                        labelFormatter={(val) => `${Number(val).toFixed(2)} ${me?.profile?.preferred_units === 'imperial' ? 'mi' : 'km'}`}
                                                                        formatter={(val: number) => {
                                                                            const m = Math.floor(val);
                                                                            const s = Math.floor((val - m) * 60);
                                                                            return [`${m}:${s.toString().padStart(2, '0')}${me?.profile?.preferred_units === 'imperial' ? '/mi' : '/km'}`, 'Pace'];
                                                                        }} 
                                                                    />
                                                                    <Area type="monotone" dataKey="pace" stroke="#228be6" fill="#228be6" fillOpacity={0.15} strokeWidth={2} connectNulls />
                                                                </AreaChart>
                                                            </ResponsiveContainer>
                                                        </Box>
                                                    )}

                                                    {focusSeries.power && (
                                                        <Box h={160} w="100%">
                                                            <ResponsiveContainer>
                                                                <AreaChart data={chartData} syncId="activityGraph" margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                                    <XAxis dataKey="distance_km" hide />
                                                                    <YAxis dataKey="power" orientation="right" width={40} tick={{fontSize: 10}} />
                                                                    <Tooltip 
                                                                        labelFormatter={(val) => `${Number(val).toFixed(2)} ${me?.profile?.preferred_units === 'imperial' ? 'mi' : 'km'}`}
                                                                        formatter={(val: number) => [val + ' W', 'Power']} 
                                                                    />
                                                                    <Area type="monotone" dataKey="power" stroke="#fd7e14" fill="#fd7e14" fillOpacity={0.15} strokeWidth={1.5} />
                                                                </AreaChart>
                                                            </ResponsiveContainer>
                                                        </Box>
                                                    )}

                                                    {focusSeries.cadence && (
                                                        <Box h={120} w="100%">
                                                            <ResponsiveContainer>
                                                                <AreaChart data={chartData} syncId="activityGraph" margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                                    <XAxis dataKey="distance_km" hide />
                                                                    <YAxis dataKey="cadence" orientation="right" domain={['dataMin - 10', 'dataMax + 10']} width={40} tick={{fontSize: 10}} />
                                                                    <Tooltip 
                                                                        labelFormatter={(val) => `${Number(val).toFixed(2)} ${me?.profile?.preferred_units === 'imperial' ? 'mi' : 'km'}`} 
                                                                        formatter={(val: number) => [val + ' rpm', 'Cadence']}
                                                                    />
                                                                    <Area type="monotone" dataKey="cadence" stroke="#15aabf" fill="#15aabf" fillOpacity={0.1} strokeWidth={1} />
                                                                </AreaChart>
                                                            </ResponsiveContainer>
                                                        </Box>
                                                    )}

                                                    {focusSeries.altitude && (
                                                        <Box h={120} w="100%">
                                                            <ResponsiveContainer>
                                                                <AreaChart data={chartData} syncId="activityGraph" margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                                    <XAxis dataKey="distance_km" hide />
                                                                    <YAxis dataKey="altitude" orientation="right" domain={['dataMin', 'dataMax']} width={40} tick={{fontSize: 10}} />
                                                                    <Tooltip 
                                                                        labelFormatter={(val) => `${Number(val).toFixed(2)} ${me?.profile?.preferred_units === 'imperial' ? 'mi' : 'km'}`} 
                                                                        formatter={(val: number) => [Math.round(val) + ' m', 'Elev']}
                                                                    />
                                                                    <Area type="monotone" dataKey="altitude" stroke="#82ca9d" fill="#82ca9d" fillOpacity={0.1} strokeWidth={1} />
                                                                </AreaChart>
                                                            </ResponsiveContainer>
                                                        </Box>
                                                    )}
                                                    
                                                    {/* Shared Axis at bottom */}
                                                    <Box h={30} w="100%">
                                                         <ResponsiveContainer>
                                                            <AreaChart data={chartData} syncId="activityGraph" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                                                <XAxis dataKey="distance_km" orientation="bottom" tick={{fontSize: 10}} tickFormatter={(val) => val.toFixed(1) + (me?.profile?.preferred_units === 'imperial' ? ' mi' : ' km')} />
                                                                <YAxis hide domain={[0, 1]} />
                                                                {/* Transparent area to enforce X Axis points */}
                                                                <Area dataKey="distance_km" fill="none" stroke="none" /> 
                                                            </AreaChart>
                                                         </ResponsiveContainer>
                                                    </Box>
                                                </Stack>
                                            </>
                                        )}

                                        {graphMode === 'power_curve' && (
                                            <Box h={400} w="100%">
                                                <ResponsiveContainer>
                                                    <LineChart data={powerCurveData}>
                                                         <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                         <XAxis dataKey="label" />
                                                         <YAxis />
                                                         <Tooltip />
                                                         <Line type="monotone" dataKey="watts" stroke="#fd7e14" strokeWidth={3} dot={true} name="Max Power" />
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
                                                         <Tooltip formatter={(val: number) => [formatZoneDuration(Number(val) || 0), 'Time']} />
                                                         <Bar dataKey="seconds" fill="#228be6" name="Pace Zone Time" onClick={(entry: any) => entry?.zone && openZoneExplanation('pace', entry.zone)} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                                <Group mt="sm" gap="xs" wrap="wrap">
                                                    {runningPaceZoneData.map((z) => (
                                                        <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('pace', z.zone)} readOnly variant="light" size="xs">
                                                            {z.zone}
                                                        </Chip>
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
                                                        <Tooltip formatter={(val: number) => [formatZoneDuration(Number(val) || 0), 'Time']} />
                                                        <Bar dataKey="seconds" fill="#fd7e14" name="Power Zone Time" onClick={(entry: any) => entry?.zone && openZoneExplanation('power', entry.zone)} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                                <Group mt="sm" gap="xs" wrap="wrap">
                                                    {cyclingPowerZoneData.map((z) => (
                                                        <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('power', z.zone)} readOnly variant="light" size="xs">
                                                            {z.zone}
                                                        </Chip>
                                                    ))}
                                                </Group>
                                            </Box>
                                        )}
                                        
                                        {graphMode === 'hr_zones' && (
                                            <Box h={400} w="100%">
                                                <ResponsiveContainer>
                                                    <BarChart data={hrZoneData}>
                                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                                        <XAxis dataKey="zone" />
                                                        <YAxis label={{ value: 'Duration', angle: -90, position: 'insideLeft' }} tickFormatter={(val) => formatZoneDuration(Number(val) || 0)} />
                                                        <Tooltip formatter={(val: number) => [formatZoneDuration(Number(val) || 0), 'Time']} />
                                                        <Bar dataKey="seconds" fill="#fa5252" name="Time in Zone" onClick={(entry: any) => entry?.zone && openZoneExplanation('hr', entry.zone)} />
                                                    </BarChart>
                                                </ResponsiveContainer>
                                                <Group mt="sm" gap="xs" wrap="wrap">
                                                    {hrZoneData.map((z) => (
                                                        <Chip key={z.zone} checked={false} onClick={() => openZoneExplanation('hr', z.zone)} readOnly variant="light" size="xs">
                                                            {z.zone}
                                                        </Chip>
                                                    ))}
                                                </Group>
                                            </Box>
                                        )}
                                    </Box>
                                    
                                    {/* Elevation profile moved into the stack if checked, or remove separate one? */}
                                    {/* The old code had a separate elevation profile. 
                                        Since I added Altitude to the stack, I should probably remove the separate one 
                                        to avoid duplication if 'Altitude' is checked. 
                                        However, users might want to see it separately. 
                                        I'll leave it but maybe hide it if graphMode is 'standard'? 
                                        Actually, let's remove the redundant block below if I included it in the options. 
                                        I'll include it in options and Remove the standalone block.
                                    */}
                                </Paper>

                                {/* Splits Section */}
                                {!focusMode && (activity.splits_metric?.length || activity.laps?.length) && (
                                    <Paper withBorder p="md" radius="md">
                                        <Group justify="space-between" mb="md">
                                            <Title order={5}>Splits</Title>
                                            <Group>
                                                <SegmentedControl 
                                                    value={splitMode}
                                                    onChange={(v: any) => setSplitMode(v)}
                                                    data={[
                                                        { label: isRunningActivity ? '1 km' : 'Auto', value: 'metric', disabled: !activity.splits_metric?.length },
                                                        { label: isCyclingActivity ? 'Manual' : 'Laps', value: 'laps', disabled: !activity.laps?.length },
                                                    ]}
                                                />
                                                <Button size="xs" variant="light" onClick={() => setSplitAnnotationsOpen(true)}>
                                                    Annotate Splits
                                                </Button>
                                            </Group>
                                        </Group>
                                        <Group gap="xs" mb="sm" wrap="wrap">
                                            <Text size="xs" c="dimmed" fw={600}>Visible stats:</Text>
                                            <Chip
                                                size="xs"
                                                checked={visibleSplitStats.distance}
                                                onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, distance: checked }))}
                                                variant="light"
                                            >
                                                Distance
                                            </Chip>
                                            <Chip
                                                size="xs"
                                                checked={visibleSplitStats.duration}
                                                onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, duration: checked }))}
                                                variant="light"
                                            >
                                                Time
                                            </Chip>
                                            <Chip
                                                size="xs"
                                                checked={visibleSplitStats.pace_or_speed}
                                                onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, pace_or_speed: checked }))}
                                                variant="light"
                                            >
                                                {isRunningActivity ? 'Pace' : 'Speed'}
                                            </Chip>
                                            <Chip
                                                size="xs"
                                                checked={visibleSplitStats.avg_hr}
                                                onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, avg_hr: checked }))}
                                                variant="light"
                                            >
                                                Avg HR
                                            </Chip>
                                            <Chip
                                                size="xs"
                                                checked={visibleSplitStats.max_hr}
                                                onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, max_hr: checked }))}
                                                variant="light"
                                            >
                                                Max HR
                                            </Chip>
                                            {isCyclingActivity && (
                                                <>
                                                    <Chip
                                                        size="xs"
                                                        checked={visibleSplitStats.avg_watts}
                                                        onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, avg_watts: checked }))}
                                                        variant="light"
                                                    >
                                                        Avg W
                                                    </Chip>
                                                    <Chip
                                                        size="xs"
                                                        checked={visibleSplitStats.max_watts}
                                                        onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, max_watts: checked }))}
                                                        variant="light"
                                                    >
                                                        Max W
                                                    </Chip>
                                                    <Chip
                                                        size="xs"
                                                        checked={visibleSplitStats.normalized_power}
                                                        onChange={(checked) => setVisibleSplitStats((prev) => ({ ...prev, normalized_power: checked }))}
                                                        variant="light"
                                                    >
                                                        NP
                                                    </Chip>
                                                </>
                                            )}
                                        </Group>
                                        <Table>
                                            <Table.Thead>
                                                <Table.Tr>
                                                    <Table.Th>Split</Table.Th>
                                                    {visibleSplitStats.distance && <Table.Th>Distance</Table.Th>}
                                                    {visibleSplitStats.duration && <Table.Th>Time</Table.Th>}
                                                    {visibleSplitStats.pace_or_speed && <Table.Th>{isRunningActivity ? 'Pace' : 'Avg Speed'}</Table.Th>}
                                                    {visibleSplitStats.avg_hr && <Table.Th>Avg HR</Table.Th>}
                                                    {visibleSplitStats.max_hr && <Table.Th>Max HR</Table.Th>}
                                                    {isCyclingActivity && visibleSplitStats.avg_watts && <Table.Th>Avg W</Table.Th>}
                                                    {isCyclingActivity && visibleSplitStats.max_watts && <Table.Th>Max W</Table.Th>}
                                                    {isCyclingActivity && visibleSplitStats.normalized_power && <Table.Th>NP</Table.Th>}
                                                </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                                {splitsToDisplayWithPower.map((split: any) => (
                                                    <Table.Tr key={split.split}>
                                                        <Table.Td>{split.split}</Table.Td>
                                                        {visibleSplitStats.distance && (
                                                            <Table.Td>
                                                                {me?.profile?.preferred_units === 'imperial'
                                                                    ? `${((split.distance || 0) * 0.000621371).toFixed(2)} mi`
                                                                    : `${((split.distance || 0) / 1000).toFixed(2)} km`}
                                                            </Table.Td>
                                                        )}
                                                        {visibleSplitStats.duration && <Table.Td>{formatDuration(split.duration)}</Table.Td>}
                                                        {visibleSplitStats.pace_or_speed && (
                                                            <Table.Td>
                                                                {isRunningActivity
                                                                    ? (split.avg_speed
                                                                        ? (me?.profile?.preferred_units === 'imperial'
                                                                            ? (() => {
                                                                                const pace = 1609.34 / (split.avg_speed * 60);
                                                                                const m = Math.floor(pace);
                                                                                const s = Math.floor((pace - m) * 60);
                                                                                return `${m}:${s.toString().padStart(2, '0')}/mi`;
                                                                            })()
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
                                                    </Table.Tr>
                                                ))}
                                            </Table.Tbody>
                                        </Table>
                                    </Paper>
                                )}
                             </Stack>
                        </Grid.Col>
                        
                        <Grid.Col span={{ base: 12, md: focusMode ? 12 : 4 }}>
                            <Stack>
                                {/* Map */}
                                {routePositions.length > 0 ? (
                                    <Paper withBorder radius="md" style={{ overflow: "hidden" }} h={350}>
                                        <MapContainer center={centerPos} zoom={13} style={{ height: '100%', width: '100%' }}>
                                            <TileLayer
                                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                            />
                                            <Polyline positions={routePositions} color="blue" weight={4} />
                                        </MapContainer>
                                    </Paper>
                                ) : (
                                    <Paper
                                        withBorder
                                        p="xl"
                                        radius="md"
                                        h={200}
                                        bg={isDark ? 'rgba(255, 255, 255, 0.04)' : 'gray.1'}
                                    >
                                        <Stack align="center" justify="center" h="100%">
                                            <IconMap size={40} color="gray" />
                                            <Text c="dimmed">No map data available (Virtual Ride or Indoor)</Text>
                                        </Stack>
                                    </Paper>
                                )}
                                
                                {/* Detailed Stats */}
                                <Paper withBorder p="md" radius="md">
                                    <Title order={5} mb="md">Detailed Stats</Title>
                                    <Stack gap="xs">
                                         <Group justify="space-between">
                                            <Text size="sm" c="dimmed">{activity.sport === 'running' ? 'Avg Pace' : 'Avg Speed'}</Text>
                                            <Text size="sm" fw={500}>
                                                {activity.sport === 'running' 
                                                    ? formatPace(activity.avg_speed)
                                                    : ((activity.avg_speed || 0) * 3.6).toFixed(1) + " km/h"}
                                            </Text>
                                         </Group>
                                         
                                         {activity.max_speed && (
                                            <Group justify="space-between">
                                                <Text size="sm" c="dimmed">{activity.sport === 'running' ? 'Max Pace' : 'Max Speed'}</Text>
                                                <Text size="sm" fw={500}>
                                                    {activity.sport === 'running' 
                                                        ? formatPace(activity.max_speed)
                                                        : (activity.max_speed * 3.6).toFixed(1) + " km/h"}
                                                </Text>
                                            </Group>
                                         )}

                                         {activity.average_hr && (
                                             <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Avg Heart Rate</Text>
                                                <Text size="sm" fw={500}>{activity.average_hr.toFixed(0)} bpm</Text>
                                             </Group>
                                         )}
                                          
                                         {activity.max_hr != null && (
                                             <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Max Heart Rate</Text>
                                                <Text size="sm" fw={500}>{activity.max_hr.toFixed(0)} bpm</Text>
                                             </Group>
                                         )}
                                         
                                         {activity.total_elevation_gain != null && (
                                             <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Elevation Gain</Text>
                                                <Text size="sm" fw={500}>{activity.total_elevation_gain.toFixed(0)} m</Text>
                                             </Group>
                                         )}
                                         
                                         {activity.average_watts != null && activity.average_watts > 0 && (
                                             <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Avg Power</Text>
                                                <Text size="sm" fw={500}>{activity.average_watts.toFixed(0)} W</Text>
                                             </Group>
                                         )}

                                         {activity.max_watts != null && activity.max_watts > 0 && (
                                             <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Max Power</Text>
                                                <Text size="sm" fw={500}>{activity.max_watts.toFixed(0)} W</Text>
                                             </Group>
                                         )}

                                         {isCyclingActivity && overallNormalizedPower != null && (
                                             <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Normalized Power</Text>
                                                <Text size="sm" fw={500}>{overallNormalizedPower.toFixed(0)} W</Text>
                                             </Group>
                                         )}

                                         {activity.avg_cadence != null && (
                                             <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Avg Cadence</Text>
                                                <Text size="sm" fw={500}>
                                                    {activity.sport === 'running' && activity.avg_cadence < 120 
                                                        ? (activity.avg_cadence * 2).toFixed(0) 
                                                        : activity.avg_cadence.toFixed(0)} {activity.sport === 'running' ? 'spm' : 'rpm'}
                                                </Text>
                                             </Group>
                                         )}

                                         {activity.max_cadence != null && (
                                             <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Max Cadence</Text>
                                                <Text size="sm" fw={500}>
                                                     {activity.sport === 'running' && activity.max_cadence < 120 
                                                        ? (activity.max_cadence * 2).toFixed(0) 
                                                        : activity.max_cadence.toFixed(0)} {activity.sport === 'running' ? 'spm' : 'rpm'}
                                                </Text>
                                             </Group>
                                         )}

                                          <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Calories</Text>
                                                <Text size="sm" fw={500}>
                                                    {activity.total_calories ? activity.total_calories.toFixed(0) : ((activity.average_watts || 0) * activity.duration / 1000 * 1.1).toFixed(0)} kcal (Est)
                                                </Text>
                                          </Group>

                                         <Group justify="space-between">
                                                <Text size="sm" c="dimmed">Load Impact</Text>
                                                <Text size="sm" fw={500}>
                                                    +{(activity.aerobic_load || 0).toFixed(1)} Aer · +{(activity.anaerobic_load || 0).toFixed(1)} Ana
                                                </Text>
                                         </Group>
                                    </Stack>
                                </Paper>
                            </Stack>
                        </Grid.Col>
                    </Grid>
                </Container>

                <Modal
                    opened={splitAnnotationsOpen}
                    onClose={() => setSplitAnnotationsOpen(false)}
                    title="Split Annotations"
                    size="lg"
                >
                    <Stack gap="sm">
                        <Text size="xs" c="dimmed">Add optional lactate and notes for each {splitMode === 'metric' ? 'auto' : 'manual'} split.</Text>
                        <Table>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Split</Table.Th>
                                    <Table.Th>Lactate (mmol/L)</Table.Th>
                                    <Table.Th>Note</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {splitsToDisplayWithPower.map((split: any, idx: number) => (
                                    <Table.Tr key={`annot-${idx}`}>
                                        <Table.Td>{split.split || idx + 1}</Table.Td>
                                        <Table.Td>
                                            <NumberInput
                                                min={0}
                                                max={40}
                                                decimalScale={1}
                                                value={splitAnnotations[idx]?.lactate_mmol_l ?? undefined}
                                                onChange={(value) => setSplitAnnotations((prev) => ({
                                                    ...prev,
                                                    [idx]: {
                                                        lactate_mmol_l: typeof value === 'number' ? value : null,
                                                        note: prev[idx]?.note ?? ''
                                                    }
                                                }))}
                                            />
                                        </Table.Td>
                                        <Table.Td>
                                            <Textarea
                                                minRows={1}
                                                maxRows={2}
                                                maxLength={220}
                                                value={splitAnnotations[idx]?.note ?? ''}
                                                onChange={(e) => setSplitAnnotations((prev) => ({
                                                    ...prev,
                                                    [idx]: {
                                                        lactate_mmol_l: prev[idx]?.lactate_mmol_l ?? null,
                                                        note: e.currentTarget.value
                                                    }
                                                }))}
                                            />
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                        <Group justify="flex-end">
                            <Button variant="default" onClick={() => setSplitAnnotationsOpen(false)}>Cancel</Button>
                            <Button
                                loading={updateActivityMutation.isPending}
                                onClick={() => {
                                    const splitType = splitMode === 'metric' ? 'metric' : 'laps';
                                    const split_annotations = Object.entries(splitAnnotations).map(([index, value]) => ({
                                        split_type: splitType as 'metric' | 'laps',
                                        split_index: Number(index),
                                        lactate_mmol_l: value.lactate_mmol_l,
                                        note: value.note?.trim() ? value.note.trim() : null,
                                    }));
                                    updateActivityMutation.mutate({ split_annotations }, {
                                        onSuccess: () => setSplitAnnotationsOpen(false)
                                    });
                                }}
                            >
                                Save Split Annotations
                            </Button>
                        </Group>
                    </Stack>
                </Modal>

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
            </AppShell.Main>
        </AppShell>
    );
};


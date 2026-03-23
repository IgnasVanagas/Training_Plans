import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Box, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { endOfWeek, format, startOfWeek } from 'date-fns';
import { Award, Medal, Trophy } from 'lucide-react';
import api from '../../api/client';
import { PlannerGoalRace } from '../../api/planning';
import { resolveWeekAccentColor } from './activityStyling';
import { parseDate } from './dateUtils';
import { computeLoadsFromZones, deriveZonesFromActivityDetail, normalizeSport, zoneCountForSport } from './loadModel';
import { ActivityZoneSummary, CalendarEvent, ZoneSummaryResponse } from './types';
import TrainingCalendarZoneDetailModal, { ZoneDetailModalData } from './TrainingCalendarZoneDetailModal';
import { readSnapshot, writeSnapshot } from '../../utils/localSnapshot';

type WeekRange = { start: Date; end: Date; key: string };

type ZoneSummaryPanelProps = {
    monthlyOpenSignal: number;
    zoneSummary?: ZoneSummaryResponse;
    events: any[];
    weeksInMonth: WeekRange[];
    weekRowHeights?: number[];
    palette: any;
    isDark: boolean;
    activityColors: any;
    athletes?: any[];
    me?: any;
    athleteId?: number | null;
    allAthletes?: boolean;
    monthStart: Date;
    monthEnd: Date;
    weekStartDay: number;
    weekdayHeaderHeight: number;
    panelWidth: number;
    goalRaces?: PlannerGoalRace[];
};

const formatTotalMinutes = (minutes: number) => {
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h}h ${m}m`;
};

const formatAvgHr = (avgHr: number | null) => {
    if (!avgHr || !Number.isFinite(avgHr)) return '-';
    return `${Math.round(avgHr)} bpm`;
};

const speedToPaceMinPerKm = (speed: number | null | undefined) => {
    const numeric = Number(speed || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return 1000 / (numeric * 60);
};

const calculateNormalizedPower = (powerSamples: number[]) => {
    if (!powerSamples.length) return null;
    if (powerSamples.length < 30) {
        const avg = powerSamples.reduce((sum, value) => sum + value, 0) / powerSamples.length;
        return Number.isFinite(avg) ? avg : null;
    }

    const rollingAverages: number[] = [];
    for (let i = 0; i <= powerSamples.length - 30; i += 1) {
        const window = powerSamples.slice(i, i + 30);
        rollingAverages.push(window.reduce((sum, value) => sum + value, 0) / window.length);
    }
    if (!rollingAverages.length) return null;

    const meanFourth = rollingAverages.reduce((sum, value) => sum + (value ** 4), 0) / rollingAverages.length;
    const np = meanFourth ** 0.25;
    return Number.isFinite(np) ? np : null;
};

const getZonePalette = (zoneCount: number) => {
    if (zoneCount === 5) {
        return ['#22C55E', '#84CC16', '#EAB308', '#F97316', '#EF4444'];
    }
    return ['#22C55E', '#84CC16', '#EAB308', '#EAB308', '#F59E0B', '#F97316', '#EF4444'];
};

const renderStackedZoneBar = (zoneValues: number[], zoneCount: number, height: number = 8, dayCellBorder: string) => {
    const safeZones = Array.from({ length: zoneCount }, (_, idx) => Math.max(0, zoneValues[idx] || 0));
    const nonZeroZones = safeZones
        .map((seconds, idx) => ({ seconds, idx }))
        .filter((entry) => entry.seconds > 0);
    const total = nonZeroZones.reduce((acc, curr) => acc + curr.seconds, 0);
    const paletteForCount = getZonePalette(zoneCount);

    if (total <= 0) {
        return (
            <Box>
                <Box
                    h={height}
                    style={{
                        borderRadius: 999,
                        border: `1px solid ${dayCellBorder}`,
                        background: 'transparent'
                    }}
                />
            </Box>
        );
    }

    return (
        <Box>
            <Group gap={0} wrap="nowrap" style={{ borderRadius: 999, overflow: 'hidden', border: `1px solid ${dayCellBorder}` }}>
                {nonZeroZones.map(({ seconds, idx }) => {
                    const pct = (seconds / total) * 100;
                    return (
                        <Box
                            key={`stack-zone-${idx + 1}`}
                            h={height}
                            style={{
                                width: `${pct}%`,
                                background: paletteForCount[idx] || paletteForCount[paletteForCount.length - 1],
                                opacity: 1
                            }}
                        />
                    );
                })}
            </Group>
        </Box>
    );
};

const createPeriodZones = () => ({
    running: {
        activityCount: 0,
        zoneSecondsByMetric: {
            hr: Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>,
            pace: Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>
        }
    },
    cycling: {
        activityCount: 0,
        zoneSecondsByMetric: {
            hr: Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>,
            power: Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>
        }
    }
});

const hasAnyZoneValues = (zoneMap?: Record<string, number>) => {
    if (!zoneMap) return false;
    return Object.values(zoneMap).some((value) => Number(value || 0) > 0);
};

const hasAnyPeriodZoneValues = (zones: ReturnType<typeof createPeriodZones>) => {
    return [
        zones.running.zoneSecondsByMetric.hr,
        zones.running.zoneSecondsByMetric.pace,
        zones.cycling.zoneSecondsByMetric.hr,
        zones.cycling.zoneSecondsByMetric.power,
    ].some((zoneMap) => hasAnyZoneValues(zoneMap));
};

export default function TrainingCalendarZoneSummaryPanel({
    monthlyOpenSignal,
    zoneSummary,
    events,
    weeksInMonth,
    weekRowHeights,
    palette,
    isDark,
    activityColors,
    athletes,
    me,
    athleteId,
    allAthletes,
    monthStart,
    monthEnd,
    weekStartDay,
    weekdayHeaderHeight,
    panelWidth,
    goalRaces,
}: ZoneSummaryPanelProps) {
    const [zoneDetailModal, setZoneDetailModal] = useState<ZoneDetailModalData | null>(null);
    const [weeklyZoneMetricMode, setWeeklyZoneMetricMode] = useState<'hr' | 'performance'>('performance');
    const lastHandledMonthlySignalRef = useRef(0);

    const upcomingRaces = useMemo(() => {
        const today = format(new Date(), 'yyyy-MM-dd');
        return (goalRaces || [])
            .filter(r => r.date >= today)
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [goalRaces]);

    const hasZoneSeconds = (source?: Record<string, number>) => {
        if (!source) return false;
        return Object.values(source).some((value) => Number(value || 0) > 0);
    };

    const buildZoneSummaryParams = (referenceDate: Date) => {
        const params = new URLSearchParams();
        params.set('reference_date', format(referenceDate, 'yyyy-MM-dd'));
        params.set('week_start_day', weekStartDay === 0 ? 'sunday' : 'monday');
        if (athleteId) {
            params.set('athlete_id', athleteId.toString());
        } else if (allAthletes) {
            params.set('all_athletes', 'true');
        }
        return params;
    };

    const buildEnhancedMetrics = (activityEvents: any[], detailByActivityId: Map<number, any>) => {
        let maxHr = 0;
        let runningMaxSpeed = 0;
        let cyclingMaxPower = 0;
        let cyclingAvgPowerWeighted = 0;
        let cyclingAvgPowerDuration = 0;
        let cyclingNpWeighted = 0;
        let cyclingNpDuration = 0;

        const readNormalizedPower = (detail: any): number | null => {
            const direct = Number(detail?.normalized_power);
            if (Number.isFinite(direct) && direct > 0) return direct;

            const curve = Number(detail?.power_curve?.normalized_power);
            if (Number.isFinite(curve) && curve > 0) return curve;

            const streamsRaw = detail?.streams;
            const streamPoints = Array.isArray(streamsRaw)
                ? streamsRaw
                : (Array.isArray(streamsRaw?.data) ? streamsRaw.data : []);
            const powerSamples = streamPoints
                .map((point: any) => Number(point?.power ?? point?.watts ?? -1))
                .filter((value: number) => Number.isFinite(value) && value > 0);

            return calculateNormalizedPower(powerSamples);
        };

        activityEvents.forEach((event: any) => {
            const resource = event.resource as CalendarEvent;
            const activityId = toActivityIdKey(resource.id);
            const detail = activityId !== null ? detailByActivityId.get(activityId) : null;
            const sport = normalizeSport(detail?.sport || resource.sport_type || '');

            const maxHrCandidate = Number(detail?.max_hr ?? resource.avg_hr ?? 0);
            if (Number.isFinite(maxHrCandidate) && maxHrCandidate > maxHr) {
                maxHr = maxHrCandidate;
            }

            if (sport === 'running') {
                const maxSpeedCandidate = Number(detail?.max_speed ?? 0);
                if (Number.isFinite(maxSpeedCandidate) && maxSpeedCandidate > runningMaxSpeed) {
                    runningMaxSpeed = maxSpeedCandidate;
                }
            }

            if (sport === 'cycling') {
                const durationMin = Number(detail?.duration ?? resource.duration ?? 0);
                const avgPowerCandidate = Number(detail?.average_watts ?? resource.avg_watts ?? 0);
                if (Number.isFinite(avgPowerCandidate) && avgPowerCandidate > 0 && durationMin > 0) {
                    cyclingAvgPowerWeighted += avgPowerCandidate * durationMin;
                    cyclingAvgPowerDuration += durationMin;
                }

                const maxPowerCandidate = Number(detail?.max_watts ?? 0);
                if (Number.isFinite(maxPowerCandidate) && maxPowerCandidate > cyclingMaxPower) {
                    cyclingMaxPower = maxPowerCandidate;
                }

                const npCandidate = readNormalizedPower(detail);
                if (npCandidate && durationMin > 0) {
                    cyclingNpWeighted += npCandidate * durationMin;
                    cyclingNpDuration += durationMin;
                }
            }
        });

        return {
            maxHr: maxHr > 0 ? maxHr : null,
            maxPaceMinPerKm: speedToPaceMinPerKm(runningMaxSpeed),
            cyclingAvgPower: cyclingAvgPowerDuration > 0 ? (cyclingAvgPowerWeighted / cyclingAvgPowerDuration) : null,
            cyclingMaxPower: cyclingMaxPower > 0 ? cyclingMaxPower : null,
            cyclingNormalizedPower: cyclingNpDuration > 0 ? (cyclingNpWeighted / cyclingNpDuration) : null,
        };
    };

    const pickZoneSource = (...sources: Array<Record<string, number> | undefined>) => {
        for (const source of sources) {
            if (hasZoneSeconds(source)) {
                return source as Record<string, number>;
            }
        }
        return (sources.find(Boolean) as Record<string, number>) || {};
    };

    const calculateMetrics = (activityEvents: any[]) => {
        const totalDistanceKm = activityEvents.reduce((sum, evt) => sum + (evt.resource.distance || 0), 0);
        const totalDurationMin = activityEvents.reduce((sum, evt) => sum + (evt.resource.duration || 0), 0);

        const runningEvents = activityEvents.filter((evt) => (evt.resource.sport_type || '').toLowerCase().includes('run'));
        const runningDistance = runningEvents.reduce((sum, evt) => sum + (evt.resource.distance || 0), 0);
        const runningDuration = runningEvents.reduce((sum, evt) => sum + (evt.resource.duration || 0), 0);

        const avgPaceMinPerKm = runningDistance > 0 ? (runningDuration / runningDistance) : null;

        let hrWeightedSum = 0;
        let hrDurationSum = 0;
        activityEvents.forEach((evt) => {
            const duration = evt.resource.duration || 0;
            const avgHr = evt.resource.avg_hr;
            if (avgHr && duration > 0) {
                hrWeightedSum += avgHr * duration;
                hrDurationSum += duration;
            }
        });

        return {
            totalDistanceKm,
            totalDurationMin,
            avgPaceMinPerKm,
            maxPaceMinPerKm: null,
            avgHr: hrDurationSum > 0 ? (hrWeightedSum / hrDurationSum) : null,
            maxHr: null,
            cyclingAvgPower: null,
            cyclingMaxPower: null,
            cyclingNormalizedPower: null,
            activitiesCount: activityEvents.length,
            aerobicLoad: 0,
            anaerobicLoad: 0,
        };
    };

    const aggregateZonesForPeriod = (activities: ActivityZoneSummary[], periodStart: Date, periodEnd: Date) => {
        const result = createPeriodZones();

        activities.forEach((activity) => {
            const actDate = parseDate(activity.date);
            if (actDate < periodStart || actDate > periodEnd) return;

            const normalizedSport = (activity.sport || '').toLowerCase();
            const isRunning = normalizedSport.includes('run');
            const isCycling = normalizedSport.includes('cycl') || normalizedSport.includes('bike') || normalizedSport.includes('ride');

            if (isRunning) {
                result.running.activityCount += 1;
                const byMetric = activity.zone_seconds_by_metric || {};
                for (let zone = 1; zone <= 5; zone += 1) {
                    result.running.zoneSecondsByMetric.hr[`Z${zone}`] += (byMetric.hr?.[`Z${zone}`] ?? activity.zone_seconds[`Z${zone}`] ?? 0);
                }
                for (let zone = 1; zone <= 7; zone += 1) {
                    result.running.zoneSecondsByMetric.pace[`Z${zone}`] += byMetric.pace?.[`Z${zone}`] || 0;
                }
            }

            if (isCycling) {
                result.cycling.activityCount += 1;
                const byMetric = activity.zone_seconds_by_metric || {};
                for (let zone = 1; zone <= 5; zone += 1) {
                    result.cycling.zoneSecondsByMetric.hr[`Z${zone}`] += byMetric.hr?.[`Z${zone}`] || 0;
                }
                for (let zone = 1; zone <= 7; zone += 1) {
                    result.cycling.zoneSecondsByMetric.power[`Z${zone}`] += (byMetric.power?.[`Z${zone}`] ?? activity.zone_seconds[`Z${zone}`] ?? 0);
                }
            }
        });

        return result;
    };

    const summaries = zoneSummary?.athletes || [];

    const toActivityIdKey = (value: unknown): number | null => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const getZoneSeconds = (source: Record<string, number> | undefined, zone: number): number => {
        if (!source) return 0;
        const candidate = (source as any)[`Z${zone}`]
            ?? (source as any)[`z${zone}`]
            ?? (source as any)[String(zone)]
            ?? (source as any)[zone as any];
        const parsed = Number(candidate);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const completedEvents = useMemo(() => {
        return events.filter((event: any) => {
            const resource = event?.resource as CalendarEvent | undefined;
            return Boolean(resource && !resource.is_planned);
        });
    }, [events]);

    const weeksWithActivities = useMemo(() => {
        return weeksInMonth
            .filter((week) => completedEvents.some((event: any) => {
                const eventDate = event.start as Date;
                return eventDate >= week.start && eventDate <= week.end;
            }))
            .map((week) => week.key);
    }, [weeksInMonth, completedEvents]);

    const boundaryWeeksWithActivities = useMemo(() => {
        return weeksInMonth.filter((week) => {
            if (week.start >= monthStart && week.end <= monthEnd) {
                return false;
            }
            return weeksWithActivities.includes(week.key);
        });
    }, [monthEnd, monthStart, weeksInMonth, weeksWithActivities]);

    const supplementalSnapshotKey = useMemo(() => {
        const scope = athleteId ? `athlete:${athleteId}` : (allAthletes ? 'all' : 'self');
        return `zone-week-range-activities-supplemental:${scope}:${weekStartDay}:${monthStart.toISOString().slice(0, 10)}:${monthEnd.toISOString().slice(0, 10)}`;
    }, [allAthletes, athleteId, monthEnd, monthStart, weekStartDay]);

    const { data: supplementalWeekZoneActivities = [] } = useQuery({
        queryKey: ['zone-week-range-activities-supplemental', athleteId, allAthletes, weekStartDay, ...boundaryWeeksWithActivities.map((week) => week.key)],
        enabled: boundaryWeeksWithActivities.length > 0,
        staleTime: 1000 * 60 * 5,
        initialData: () => readSnapshot<ActivityZoneSummary[]>(supplementalSnapshotKey) || [],
        queryFn: async () => {
            const byId = new Map<number, ActivityZoneSummary>();

            await Promise.all(
                boundaryWeeksWithActivities.map(async (week) => {
                    const params = buildZoneSummaryParams(week.start);
                    const res = await api.get<ZoneSummaryResponse>(`/activities/zone-summary?${params.toString()}`);
                    (res.data.athletes || []).forEach((summary) => {
                        (summary.weekly_activity_zones || []).forEach((activity) => {
                            byId.set(activity.activity_id, activity);
                        });
                    });
                })
            );

            const merged = Array.from(byId.values());
            writeSnapshot(supplementalSnapshotKey, merged);
            return merged;
        }
    });

    const scopedKnownActivities = useMemo(() => {
        const byId = new Map<number, ActivityZoneSummary>();
        summaries.forEach((summary) => {
            [...(summary.weekly_activity_zones || []), ...(summary.monthly_activity_zones || [])].forEach((activity) => {
                const activityId = toActivityIdKey(activity.activity_id);
                if (activityId !== null) {
                    byId.set(activityId, activity);
                }
            });
        });
        supplementalWeekZoneActivities.forEach((activity) => {
            const activityId = toActivityIdKey(activity.activity_id);
            if (activityId !== null) {
                byId.set(activityId, activity);
            }
        });
        return Array.from(byId.values());
    }, [summaries, supplementalWeekZoneActivities]);

    const athleteProfileById = useMemo(() => {
        const byId = new Map<number, any>();
        (athletes || []).forEach((athlete: any) => {
            byId.set(athlete.id, athlete.profile || null);
        });
        if (me?.id && me?.profile) {
            byId.set(me.id, me.profile);
        }
        return byId;
    }, [athletes, me]);

    const aggregateSummaryZones = (period: 'weekly' | 'monthly', sourceSummaries: typeof summaries = summaries) => {
        const result = createPeriodZones();

        sourceSummaries.forEach((summary) => {
            const source = period === 'weekly' ? summary.weekly : summary.monthly;
            result.running.activityCount += source.sports.running.activities_count || 0;
            result.cycling.activityCount += source.sports.cycling.activities_count || 0;
            const runningByMetric = source.sports.running.zone_seconds_by_metric || {};
            const cyclingByMetric = source.sports.cycling.zone_seconds_by_metric || {};
            for (let zone = 1; zone <= 5; zone += 1) {
                result.running.zoneSecondsByMetric.hr[`Z${zone}`] += getZoneSeconds(runningByMetric.hr as Record<string, number>, zone)
                    || getZoneSeconds(source.sports.running.zone_seconds as Record<string, number>, zone);
                result.cycling.zoneSecondsByMetric.hr[`Z${zone}`] += getZoneSeconds(cyclingByMetric.hr as Record<string, number>, zone)
                    || getZoneSeconds(source.sports.cycling.zone_seconds as Record<string, number>, zone);
            }
            for (let zone = 1; zone <= 7; zone += 1) {
                result.running.zoneSecondsByMetric.pace[`Z${zone}`] += getZoneSeconds(runningByMetric.pace as Record<string, number>, zone)
                    || getZoneSeconds(source.sports.running.zone_seconds as Record<string, number>, zone);
                result.cycling.zoneSecondsByMetric.power[`Z${zone}`] += getZoneSeconds(cyclingByMetric.power as Record<string, number>, zone)
                    || getZoneSeconds(source.sports.cycling.zone_seconds as Record<string, number>, zone);
            }
        });

        return result;
    };

    const matchesWeekSummary = (periodStart: Date, periodEnd: Date) => {
        const summaryWeekStart = zoneSummary?.week?.start_date;
        const summaryWeekEnd = zoneSummary?.week?.end_date;
        if (!summaryWeekStart || !summaryWeekEnd) return false;
        return format(periodStart, 'yyyy-MM-dd') === summaryWeekStart && format(periodEnd, 'yyyy-MM-dd') === summaryWeekEnd;
    };

    const matchesMonthSummary = (periodStart: Date, periodEnd: Date) => {
        const summaryMonthStart = zoneSummary?.month?.start_date;
        const summaryMonthEnd = zoneSummary?.month?.end_date;
        if (!summaryMonthStart || !summaryMonthEnd) return false;
        return format(periodStart, 'yyyy-MM-dd') === summaryMonthStart && format(periodEnd, 'yyyy-MM-dd') === summaryMonthEnd;
    };

    const openMoreModal = async (
        title: string,
        periodStart: Date,
        periodEnd: Date
    ) => {
        type DetailActivity = {
            id?: number;
            date: Date;
            sport: string;
            distanceKm: number;
            durationMin: number;
            avgHr?: number;
            avgPaceMinPerKm?: number | null;
            zoneSeconds: Record<string, number>;
            zoneCount: number;
        };

        const scopedEvents = events.filter((event: any) => {
            const resource = event?.resource as CalendarEvent | undefined;
            if (!resource || resource.is_planned) return false;
            const eventDate = event.start as Date;
            return eventDate >= periodStart && eventDate <= periodEnd;
        });

        const metrics = calculateMetrics(scopedEvents);
        const isWholeMonthPeriod = matchesMonthSummary(periodStart, periodEnd);
        const isCurrentSummaryWeek = matchesWeekSummary(periodStart, periodEnd);
        let zones = isWholeMonthPeriod
            ? aggregateSummaryZones('monthly')
            : isCurrentSummaryWeek
                ? aggregateSummaryZones('weekly')
                : aggregateZonesForPeriod(scopedKnownActivities, periodStart, periodEnd);

        const initialActivities: DetailActivity[] = scopedEvents
            .map((event: any) => {
                const resource = event.resource as CalendarEvent;
                const distanceKm = resource.distance || 0;
                const durationMin = resource.duration || 0;
                const isRunning = (resource.sport_type || '').toLowerCase().includes('run');
                return {
                    id: resource.id,
                    date: event.start as Date,
                    sport: resource.sport_type || 'Activity',
                    distanceKm,
                    durationMin,
                    avgHr: resource.avg_hr,
                    avgPaceMinPerKm: isRunning && distanceKm > 0 ? (durationMin / distanceKm) : null,
                    zoneSeconds: {},
                    zoneCount: zoneCountForSport(resource.sport_type || ''),
                };
            })
            .sort((a: DetailActivity, b: DetailActivity) => b.date.getTime() - a.date.getTime());

        setZoneDetailModal({
            title,
            metrics: { ...metrics, aerobicLoad: 0, anaerobicLoad: 0 },
            zones,
            activities: initialActivities,
            partialData: false,
            partialDataMessage: undefined,
            isLoading: false,
        });

        if (hasAnyPeriodZoneValues(zones) || isWholeMonthPeriod || isCurrentSummaryWeek) {
            setZoneDetailModal((current) => current ? {
                ...current,
                metrics: { ...current.metrics, ...computeLoadsFromZones(zones) },
                zones,
                partialData: false,
                partialDataMessage: undefined,
                isLoading: false,
            } : current);
            return;
        }

        const isWeeklyPeriod = format(periodEnd, 'yyyy-MM-dd') === format(endOfWeek(periodStart, { weekStartsOn: weekStartDay === 0 ? 0 : 1 }), 'yyyy-MM-dd');
        if (!isWeeklyPeriod) {
            setZoneDetailModal((current) => current ? {
                ...current,
                metrics: { ...current.metrics, ...computeLoadsFromZones(zones) },
                partialData: true,
                partialDataMessage: 'No zone data is available for this period yet.',
                isLoading: false,
            } : current);
            return;
        }

        try {
            const params = buildZoneSummaryParams(periodStart);
            const res = await api.get<ZoneSummaryResponse>(`/activities/zone-summary?${params.toString()}`);
            zones = aggregateSummaryZones('weekly', res.data.athletes || []);

            setZoneDetailModal((current) => current ? {
                ...current,
                metrics: { ...current.metrics, ...computeLoadsFromZones(zones) },
                zones,
                partialData: !hasAnyPeriodZoneValues(zones),
                partialDataMessage: hasAnyPeriodZoneValues(zones) ? undefined : 'No zone data is available for this period yet.',
                isLoading: false,
            } : current);
        } catch {
            setZoneDetailModal((current) => current ? {
                ...current,
                metrics: { ...current.metrics, ...computeLoadsFromZones(zones) },
                partialData: true,
                partialDataMessage: 'Detailed zone data is unavailable right now. Showing totals from loaded activities.',
                isLoading: false,
            } : current);
        }
    };

    const knownZoneByActivityId = useMemo(() => {
        const byId = new Map<number, ActivityZoneSummary>();
        scopedKnownActivities.forEach((activity) => {
            const activityId = toActivityIdKey(activity.activity_id);
            if (activityId !== null) {
                byId.set(activityId, activity);
            }
        });
        return byId;
    }, [scopedKnownActivities]);

    const buildWeeklyDistribution = (activityEvents: any[], metricMode: 'hr' | 'performance', week: WeekRange) => {
        const zoneCount = metricMode === 'hr' ? 5 : 7;
        const totals = Array.from({ length: zoneCount }, () => 0);
        activityEvents.forEach((event: any) => {
            const resource = event.resource as CalendarEvent;
            const activityId = toActivityIdKey(resource.id);
            const known = activityId !== null ? knownZoneByActivityId.get(activityId) : undefined;
            if (!known) return;

            const byMetric = known.zone_seconds_by_metric || {};
            const fallbackSource = known.zone_seconds || {};
            const normalizedSport = normalizeSport(known.sport || resource.sport_type || '');
            const hrSource = pickZoneSource(byMetric.hr, fallbackSource);
            const runningPerformanceSource = pickZoneSource(byMetric.pace, hrSource, fallbackSource);
            const cyclingPerformanceSource = pickZoneSource(byMetric.power, hrSource, fallbackSource);
            const source = metricMode === 'hr'
                ? hrSource
                : normalizedSport === 'running'
                    ? runningPerformanceSource
                    : normalizedSport === 'cycling'
                        ? cyclingPerformanceSource
                        : fallbackSource;

            for (let zone = 1; zone <= zoneCount; zone += 1) {
                totals[zone - 1] += getZoneSeconds(source, zone);
            }
        });

        if (totals.some((value) => value > 0)) {
            return { totals, zoneCount };
        }

        if (matchesWeekSummary(week.start, week.end)) {
            const summaryZones = aggregateSummaryZones('weekly');
            for (let zone = 1; zone <= zoneCount; zone += 1) {
                if (metricMode === 'hr') {
                    totals[zone - 1] = getZoneSeconds(summaryZones.running.zoneSecondsByMetric.hr, zone)
                        + getZoneSeconds(summaryZones.cycling.zoneSecondsByMetric.hr, zone);
                    continue;
                }

                const performanceTotal = getZoneSeconds(summaryZones.running.zoneSecondsByMetric.pace, zone)
                    + getZoneSeconds(summaryZones.cycling.zoneSecondsByMetric.power, zone);

                totals[zone - 1] = performanceTotal > 0
                    ? performanceTotal
                    : getZoneSeconds(summaryZones.running.zoneSecondsByMetric.hr, zone)
                        + getZoneSeconds(summaryZones.cycling.zoneSecondsByMetric.hr, zone);
            }
        }

        return { totals, zoneCount };
    };

    useEffect(() => {
        if (monthlyOpenSignal <= 0 || monthlyOpenSignal === lastHandledMonthlySignalRef.current) return;
        lastHandledMonthlySignalRef.current = monthlyOpenSignal;
        void openMoreModal(
            format(monthStart, 'MMMM yyyy'),
            monthStart,
            monthEnd
        );
    }, [monthlyOpenSignal, monthEnd, monthStart]);

    const weeklyRowsTemplate = useMemo(() => {
        if (weekRowHeights && weekRowHeights.length === weeksInMonth.length && weekRowHeights.length > 0) {
            return weekRowHeights.map((value) => `${Math.max(1, value)}px`).join(' ');
        }
        return `repeat(${Math.max(weeksInMonth.length, 1)}, minmax(0, 1fr))`;
    }, [weekRowHeights, weeksInMonth.length]);

    return (
        <Stack w={panelWidth} miw={panelWidth} h="100%" gap={0} style={{ overflow: 'hidden' }}>
            <Box
                h={weekdayHeaderHeight}
                px={10}
                style={{
                    border: `1px solid ${palette.headerBorder}`,
                    borderBottom: 'none',
                    borderRadius: '12px 12px 0 0',
                    background: palette.panelBg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}
            >
                <Text size="10px" fw={800} c={palette.textDim} style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Weekly Totals
                </Text>
                <SegmentedControl
                    size="xs"
                    radius="md"
                    value={weeklyZoneMetricMode}
                    onChange={(value) => setWeeklyZoneMetricMode(value as 'hr' | 'performance')}
                    data={[
                        { value: 'hr', label: 'HR' },
                        { value: 'performance', label: 'Pace/Power' }
                    ]}
                />
            </Box>

            <Box
                flex={1}
                style={{
                    border: `1px solid ${palette.headerBorder}`,
                    borderRadius: upcomingRaces.length > 0 ? '0' : '0 0 12px 12px',
                    borderBottom: upcomingRaces.length > 0 ? 'none' : `1px solid ${palette.headerBorder}`,
                    background: palette.panelBg,
                    backdropFilter: 'blur(14px)',
                    display: 'grid',
                    gridTemplateRows: weeklyRowsTemplate,
                    overflow: 'hidden',
                    minHeight: 0
                }}
            >
                {weeksInMonth.map((week, index) => {
                    const weekEvents = completedEvents.filter((event: any) => {
                        const eventDate = event.start as Date;
                        return eventDate >= week.start && eventDate <= week.end;
                    });
                    const weekMetrics = calculateMetrics(weekEvents);

                    const accentColor = resolveWeekAccentColor(weekEvents.map((evt: any) => evt.resource as CalendarEvent), activityColors);
                    const { totals: weekZones, zoneCount: weekZoneCount } = buildWeeklyDistribution(weekEvents, weeklyZoneMetricMode, week);
                    const weekAvgHr = formatAvgHr(weekMetrics.avgHr);

                    return (
                        <Box
                            key={week.key}
                            style={{
                                padding: '8px 10px',
                                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.7)',
                                borderTop: index === 0 ? 'none' : `1px solid ${palette.dayCellBorder}`,
                                borderLeft: `3px solid ${accentColor}`,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                fontFamily: '"Inter", sans-serif',
                                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                                cursor: 'pointer',
                                minHeight: 0
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-1px)';
                                e.currentTarget.style.boxShadow = isDark
                                    ? '0 8px 18px -16px rgba(148, 163, 184, 0.9)'
                                    : '0 10px 20px -18px rgba(15, 23, 42, 0.45)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'none';
                                e.currentTarget.style.boxShadow = 'none';
                            }}
                            onClick={() => { void openMoreModal(
                                `${format(week.start, 'MMM d')} - ${format(week.end, 'MMM d')}`,
                                week.start,
                                week.end
                            ); }}
                        >
                            <Group justify="space-between" align="center" wrap="nowrap">
                                <Stack gap={1} miw={0}>
                                    <Text size="10px" fw={800} c={isDark ? '#F8FAFC' : '#0F172A'} style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                        {format(week.start, 'MMM d')} - {format(week.end, 'MMM d')}
                                    </Text>
                                    <Text size="sm" fw={800} c={isDark ? '#E2E8F0' : '#1E293B'} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {weekMetrics.totalDistanceKm.toFixed(1)} km / {formatTotalMinutes(weekMetrics.totalDurationMin)}
                                    </Text>
                                    <Text size="10px" fw={700} c={palette.textDim} style={{ opacity: 0.88 }}>
                                        Avg HR: {weekAvgHr}
                                    </Text>
                                </Stack>
                                <Text size="10px" fw={700} c={palette.textDim}>Open</Text>
                            </Group>
                            <Box mt={5}>{renderStackedZoneBar(weekZones, weekZoneCount, 8, palette.dayCellBorder)}</Box>
                        </Box>
                    );
                })}
            </Box>

            {upcomingRaces.length > 0 && (
                <Box
                    px={10}
                    py={6}
                    style={{
                        border: `1px solid ${palette.headerBorder}`,
                        borderTop: 'none',
                        borderRadius: '0 0 12px 12px',
                        background: palette.panelBg,
                        flexShrink: 0,
                    }}
                >
                    <Text size="9px" fw={800} c={palette.textDim} mb={4} style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Upcoming Races
                    </Text>
                    <Stack gap={3}>
                        {upcomingRaces.slice(0, 4).map((race, idx) => {
                            const RaceIcon = race.priority === 'A' ? Trophy : race.priority === 'B' ? Medal : Award;
                            const iconColor = race.priority === 'A' ? '#DC2626' : race.priority === 'B' ? '#D97706' : '#2563EB';
                            const daysUntil = Math.max(0, Math.ceil((parseDate(race.date).getTime() - Date.now()) / 86400000));
                            return (
                                <Group key={idx} gap={5} wrap="nowrap" justify="space-between">
                                    <Group gap={5} wrap="nowrap" style={{ minWidth: 0 }}>
                                        <RaceIcon size={10} color={iconColor} style={{ flexShrink: 0 }} />
                                        <Text size="xs" fw={idx === 0 ? 700 : 500} c={idx === 0 ? palette.text : palette.textDim} truncate>
                                            {format(parseDate(race.date), 'MMM d')} · {race.name}
                                        </Text>
                                    </Group>
                                    <Text size="xs" fw={idx === 0 ? 700 : 400} c={idx === 0 ? iconColor : palette.textDim} style={{ flexShrink: 0 }}>
                                        {daysUntil}d
                                    </Text>
                                </Group>
                            );
                        })}
                    </Stack>
                </Box>
            )}

            <TrainingCalendarZoneDetailModal
                data={zoneDetailModal}
                onClose={() => setZoneDetailModal(null)}
            />
        </Stack>
    );
}

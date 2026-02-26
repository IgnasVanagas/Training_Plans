import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Box, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { endOfWeek, format, startOfWeek } from 'date-fns';
import api from '../../api/client';
import { resolveWeekAccentColor } from './activityStyling';
import { parseDate } from './dateUtils';
import { computeLoadsFromZones, deriveZonesFromActivityDetail, normalizeSport, zoneCountForSport } from './loadModel';
import { ActivityZoneSummary, CalendarEvent, ZoneSummaryResponse } from './types';
import TrainingCalendarZoneDetailModal, { ZoneDetailModalData } from './TrainingCalendarZoneDetailModal';

type WeekRange = { start: Date; end: Date; key: string };

type ZoneSummaryPanelProps = {
    monthlyOpenSignal: number;
    zoneSummary?: ZoneSummaryResponse;
    events: any[];
    weeksInMonth: WeekRange[];
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
    const total = safeZones.reduce((acc, curr) => acc + curr, 0);
    const showMixedPlaceholder = total === 0;
    const paletteForCount = getZonePalette(zoneCount);

    return (
        <Box>
            <Group gap={0} wrap="nowrap" style={{ borderRadius: 999, overflow: 'hidden', border: `1px solid ${dayCellBorder}` }}>
                {safeZones.map((seconds, idx) => {
                    const pct = showMixedPlaceholder ? (100 / zoneCount) : (seconds / total) * 100;
                    return (
                        <Box
                            key={`stack-zone-${idx + 1}`}
                            h={height}
                            style={{
                                width: `${pct}%`,
                                minWidth: 3,
                                background: paletteForCount[idx] || paletteForCount[paletteForCount.length - 1],
                                opacity: showMixedPlaceholder ? 0.45 : 1
                            }}
                        />
                    );
                })}
            </Group>
        </Box>
    );
};

export default function TrainingCalendarZoneSummaryPanel({
    monthlyOpenSignal,
    zoneSummary,
    events,
    weeksInMonth,
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
}: ZoneSummaryPanelProps) {
    const [zoneDetailModal, setZoneDetailModal] = useState<ZoneDetailModalData | null>(null);
    const [weeklyZoneMetricMode, setWeeklyZoneMetricMode] = useState<'hr' | 'performance'>('performance');
    const lastHandledMonthlySignalRef = useRef(0);

    const hasZoneSeconds = (source?: Record<string, number>) => {
        if (!source) return false;
        return Object.values(source).some((value) => Number(value || 0) > 0);
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
        const result = {
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
        };

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
        return events.filter((event: any) => !(event.resource as CalendarEvent).is_planned);
    }, [events]);

    const weeksWithActivities = useMemo(() => {
        return weeksInMonth
            .filter((week) => completedEvents.some((event: any) => {
                const eventDate = event.start as Date;
                return eventDate >= week.start && eventDate <= week.end;
            }))
            .map((week) => week.key);
    }, [weeksInMonth, completedEvents]);

    const { data: supplementalWeekZoneActivities = [] } = useQuery({
        queryKey: ['zone-week-range-activities-supplemental', athleteId, allAthletes, weekStartDay, ...weeksWithActivities],
        enabled: weeksWithActivities.length > 0,
        staleTime: 1000 * 60 * 5,
        queryFn: async () => {
            const byId = new Map<number, ActivityZoneSummary>();

            await Promise.all(
                weeksWithActivities.map(async (weekKey) => {
                    const params = new URLSearchParams();
                    params.set('reference_date', weekKey);
                    params.set('week_start_day', weekStartDay === 0 ? 'sunday' : 'monday');
                    if (athleteId) {
                        params.set('athlete_id', athleteId.toString());
                    } else if (allAthletes) {
                        params.set('all_athletes', 'true');
                    }

                    const res = await api.get<ZoneSummaryResponse>(`/activities/zone-summary?${params.toString()}`);
                    (res.data.athletes || []).forEach((summary) => {
                        (summary.weekly_activity_zones || []).forEach((activity) => {
                            byId.set(activity.activity_id, activity);
                        });
                    });
                })
            );

            return Array.from(byId.values());
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

    const aggregateSummaryZones = (period: 'weekly' | 'monthly') => {
        const running = {
            activityCount: 0,
            zoneSecondsByMetric: {
                hr: Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>,
                pace: Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>
            }
        };
        const cycling = {
            activityCount: 0,
            zoneSecondsByMetric: {
                hr: Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>,
                power: Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>
            }
        };

        summaries.forEach((summary) => {
            const source = period === 'weekly' ? summary.weekly : summary.monthly;
            running.activityCount += source.sports.running.activities_count || 0;
            cycling.activityCount += source.sports.cycling.activities_count || 0;
            const runningByMetric = source.sports.running.zone_seconds_by_metric || {};
            const cyclingByMetric = source.sports.cycling.zone_seconds_by_metric || {};
            for (let zone = 1; zone <= 5; zone += 1) {
                running.zoneSecondsByMetric.hr[`Z${zone}`] += getZoneSeconds(runningByMetric.hr as Record<string, number>, zone)
                    || getZoneSeconds(source.sports.running.zone_seconds as Record<string, number>, zone);
                cycling.zoneSecondsByMetric.hr[`Z${zone}`] += getZoneSeconds(cyclingByMetric.hr as Record<string, number>, zone)
                    || getZoneSeconds(source.sports.cycling.zone_seconds as Record<string, number>, zone);
            }
            for (let zone = 1; zone <= 7; zone += 1) {
                running.zoneSecondsByMetric.pace[`Z${zone}`] += getZoneSeconds(runningByMetric.pace as Record<string, number>, zone)
                    || getZoneSeconds(source.sports.running.zone_seconds as Record<string, number>, zone);
                cycling.zoneSecondsByMetric.power[`Z${zone}`] += getZoneSeconds(cyclingByMetric.power as Record<string, number>, zone)
                    || getZoneSeconds(source.sports.cycling.zone_seconds as Record<string, number>, zone);
            }
        });

        return { running, cycling };
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
            const resource = event.resource as CalendarEvent;
            if (resource.is_planned) return false;
            const eventDate = event.start as Date;
            return eventDate >= periodStart && eventDate <= periodEnd;
        });

        const metrics = calculateMetrics(scopedEvents);
        let zones = aggregateZonesForPeriod(scopedKnownActivities, periodStart, periodEnd);

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
            partialData: true,
            partialDataMessage: 'Data is still syncing from Strava. Showing available activities and current totals; values will expand as sync completes.',
            isLoading: true,
        });

        try {
        const detailByActivityId = new Map<number, any>();

        await Promise.all(
            scopedEvents.map(async (event: any) => {
                const resource = event.resource as CalendarEvent;
                const activityId = toActivityIdKey(resource.id);
                if (activityId === null) return;
                try {
                    const detailRes = await api.get(`/activities/${activityId}`);
                    detailByActivityId.set(activityId, detailRes.data);
                } catch {
                    // Keep graceful degradation when detail endpoint fails for some activities
                }
            })
        );

        const perActivityZones = new Map<number, { sport: string; zoneSecondsByMetric: Record<string, Record<string, number> | undefined> }>();

        const knownByActivityId = new Map<number, ActivityZoneSummary>(
            scopedKnownActivities
                .map((activity) => {
                    const activityId = toActivityIdKey(activity.activity_id);
                    return activityId !== null ? [activityId, activity] : null;
                })
                .filter((entry): entry is [number, ActivityZoneSummary] => Boolean(entry))
        );

        knownByActivityId.forEach((known, activityId) => {
            perActivityZones.set(activityId, {
                sport: known.sport,
                zoneSecondsByMetric: {
                    ...(known.zone_seconds_by_metric || {})
                }
            });
        });

        const hasAnyMetricSeconds = (data?: Record<string, number>) => {
            if (!data) return false;
            return Object.values(data).some((value) => Number(value || 0) > 0);
        };

        const needsDerivedZones = (resource: CalendarEvent, known?: ActivityZoneSummary) => {
            if (!resource.id || !known) return true;
            const normalizedSport = normalizeSport(known.sport || resource.sport_type || '');
            const byMetric = known.zone_seconds_by_metric || {};
            if (normalizedSport === 'running') {
                const hasHr = hasAnyMetricSeconds(byMetric.hr);
                const hasPace = hasAnyMetricSeconds(byMetric.pace);
                return !hasHr || !hasPace;
            }
            if (normalizedSport === 'cycling') {
                const hasHr = hasAnyMetricSeconds(byMetric.hr);
                const hasPower = hasAnyMetricSeconds(byMetric.power);
                return !hasHr || !hasPower;
            }
            return true;
        };

        const fallbackCandidates = scopedEvents.filter((event: any) => {
            const resource = event.resource as CalendarEvent;
            if (!resource.id) return false;
            const known = knownByActivityId.get(resource.id);
            return needsDerivedZones(resource, known);
        });

        if (fallbackCandidates.length > 0) {
            fallbackCandidates.forEach((event: any) => {
                const resource = event.resource as CalendarEvent;
                const activityId = toActivityIdKey(resource.id);
                if (activityId === null) return;
                const detail = detailByActivityId.get(activityId);
                if (!detail) return;
                const profile = athleteProfileById.get(resource.user_id || -1);
                const derived = deriveZonesFromActivityDetail(detail, profile);
                perActivityZones.set(activityId, {
                    sport: derived.sport,
                    zoneSecondsByMetric: derived.zoneSecondsByMetric || {}
                });
            });
        }

        zones = {
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
        };

        scopedEvents.forEach((event: any) => {
            const resource = event.resource as CalendarEvent;
            const activityId = toActivityIdKey(resource.id);
            if (activityId === null) return;
            const known = knownByActivityId.get(activityId);
            const mapped = perActivityZones.get(activityId);
            const normalizedSport = normalizeSport(mapped?.sport || known?.sport || resource.sport_type || '');

            if (normalizedSport === 'running') {
                zones.running.activityCount += 1;
                const fallbackZoneSource = known?.zone_seconds || {};
                const hrSource = pickZoneSource(mapped?.zoneSecondsByMetric?.hr, known?.zone_seconds_by_metric?.hr, fallbackZoneSource);
                const paceSource = pickZoneSource(mapped?.zoneSecondsByMetric?.pace, known?.zone_seconds_by_metric?.pace, hrSource, fallbackZoneSource);
                for (let zone = 1; zone <= 5; zone += 1) {
                    const key = `Z${zone}`;
                    zones.running.zoneSecondsByMetric.hr[key] += getZoneSeconds(hrSource, zone);
                }
                for (let zone = 1; zone <= 7; zone += 1) {
                    const key = `Z${zone}`;
                    zones.running.zoneSecondsByMetric.pace[key] += getZoneSeconds(paceSource, zone);
                }
            }

            if (normalizedSport === 'cycling') {
                zones.cycling.activityCount += 1;
                const fallbackZoneSource = known?.zone_seconds || {};
                const hrSource = pickZoneSource(mapped?.zoneSecondsByMetric?.hr, known?.zone_seconds_by_metric?.hr, fallbackZoneSource);
                const powerSource = pickZoneSource(mapped?.zoneSecondsByMetric?.power, known?.zone_seconds_by_metric?.power, hrSource, fallbackZoneSource);
                for (let zone = 1; zone <= 5; zone += 1) {
                    const key = `Z${zone}`;
                    zones.cycling.zoneSecondsByMetric.hr[key] += getZoneSeconds(hrSource, zone);
                }
                for (let zone = 1; zone <= 7; zone += 1) {
                    const key = `Z${zone}`;
                    zones.cycling.zoneSecondsByMetric.power[key] += getZoneSeconds(powerSource, zone);
                }
            }
        });

        const hasPerActivityZoneSeconds = [
            ...Object.values(zones.running.zoneSecondsByMetric.hr),
            ...Object.values(zones.running.zoneSecondsByMetric.pace),
            ...Object.values(zones.cycling.zoneSecondsByMetric.hr),
            ...Object.values(zones.cycling.zoneSecondsByMetric.power)
        ].some((value) => Number(value || 0) > 0);

        if (!hasPerActivityZoneSeconds) {
            const periodStartKey = format(periodStart, 'yyyy-MM-dd');
            const periodEndKey = format(periodEnd, 'yyyy-MM-dd');
            const monthStartKey = format(monthStart, 'yyyy-MM-dd');
            const monthEndKey = format(monthEnd, 'yyyy-MM-dd');
            const summaryWeekStart = zoneSummary?.week?.start_date;
            const summaryWeekEnd = zoneSummary?.week?.end_date;

            if (periodStartKey === monthStartKey && periodEndKey === monthEndKey) {
                zones = aggregateSummaryZones('monthly');
            } else if (summaryWeekStart && summaryWeekEnd && periodStartKey === summaryWeekStart && periodEndKey === summaryWeekEnd) {
                zones = aggregateSummaryZones('weekly');
            }
        }

        const activities: DetailActivity[] = scopedEvents
            .map((event: any) => {
                const resource = event.resource as CalendarEvent;
                const distanceKm = resource.distance || 0;
                const durationMin = resource.duration || 0;
                const isRunning = (resource.sport_type || '').toLowerCase().includes('run');
                const knownZones = resource.id ? perActivityZones.get(resource.id) : null;
                const resolvedSport = normalizeSport(knownZones?.sport || resource.sport_type || '');
                const zoneCount = zoneCountForSport(resolvedSport);
                const defaultMetricZones = resolvedSport === 'running'
                    ? (knownZones?.zoneSecondsByMetric?.hr || {})
                    : (knownZones?.zoneSecondsByMetric?.power || {});
                return {
                    id: resource.id,
                    date: event.start as Date,
                    sport: resource.sport_type || 'Activity',
                    distanceKm,
                    durationMin,
                    avgHr: resource.avg_hr,
                    avgPaceMinPerKm: isRunning && distanceKm > 0 ? (durationMin / distanceKm) : null,
                    zoneSeconds: defaultMetricZones,
                    zoneCount
                };
            })
            .sort((a: DetailActivity, b: DetailActivity) => b.date.getTime() - a.date.getTime());

        const hasMissingStreamData = scopedEvents.some((event: any) => {
            const resource = event.resource as CalendarEvent;
            const activityId = toActivityIdKey(resource.id);
            if (activityId === null) return true;

            const detail = detailByActivityId.get(activityId);
            if (!detail) return true;

            const streamPoints = Array.isArray(detail?.streams)
                ? detail.streams
                : (Array.isArray(detail?.streams?.data) ? detail.streams.data : []);

            return !Array.isArray(streamPoints) || streamPoints.length === 0;
        });

        const isPartialData = scopedEvents.length > 0 && hasMissingStreamData;
        const enhancedMetrics = buildEnhancedMetrics(scopedEvents, detailByActivityId);

        setZoneDetailModal({
            title,
            metrics: { ...metrics, ...enhancedMetrics, ...computeLoadsFromZones(zones) },
            zones,
            activities,
            partialData: isPartialData,
            partialDataMessage: isPartialData
                ? 'Some activities in this period still do not have stream data. Values will update as stream sync completes.'
                : undefined,
            isLoading: false,
        });
        } catch {
            setZoneDetailModal((current) => {
                if (!current) {
                    return {
                        title,
                        metrics: { ...metrics, aerobicLoad: 0, anaerobicLoad: 0 },
                        zones,
                        activities: initialActivities,
                        partialData: true,
                        partialDataMessage: 'Data is still syncing from Strava. Showing available activities and current totals; values will expand as sync completes.',
                        isLoading: false,
                    };
                }
                return {
                    ...current,
                    partialData: true,
                    partialDataMessage: 'Data is still syncing from Strava. Showing available activities and current totals; values will expand as sync completes.',
                    isLoading: false,
                };
            });
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

    const buildWeeklyDistribution = (activityEvents: any[], metricMode: 'hr' | 'performance') => {
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
                    borderRadius: '0 0 12px 12px',
                    background: palette.panelBg,
                    backdropFilter: 'blur(14px)',
                    display: 'grid',
                    gridTemplateRows: `repeat(${Math.max(weeksInMonth.length, 1)}, minmax(0, 1fr))`,
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
                    const { totals: weekZones, zoneCount: weekZoneCount } = buildWeeklyDistribution(weekEvents, weeklyZoneMetricMode);
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

            <TrainingCalendarZoneDetailModal
                data={zoneDetailModal}
                onClose={() => setZoneDetailModal(null)}
            />
        </Stack>
    );
}

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths, addWeeks } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import api from '../api/client';
import { DayNote, getDayNotesRange } from '../api/dayNotes';
import { Award, Bandage, CalendarOff, HeartPulse, Medal, Plane, Trophy } from 'lucide-react';
import { getLatestSeasonPlan, PlannerConstraint, saveSeasonPlan, SeasonPlan } from '../api/planning';
import { useI18n } from '../i18n/I18nProvider';
import { SavedWorkout } from '../types/workout';
import { Group, Stack, Text, Box, useComputedColorScheme, Paper, Badge, Popover, Divider } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useMediaQuery } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import CalendarHeader from './calendar/CalendarHeader';
import { parseDate } from './calendar/dateUtils';
import { ORIGAMI_ACTIVITY_COLORS, ORIGAMI_THEME } from './calendar/theme';
import { resolveActivityAccentColor } from './calendar/activityStyling';
import { BulkEditModal, DayDetailsModal, WorkoutEditModal } from './calendar/TrainingCalendarModals';
import { Activity, DuplicateSelectModal } from './ActivitiesView';
import TrainingCalendarZoneSummaryPanel from './calendar/TrainingCalendarZoneSummaryPanel';

import { CalendarWeekSkeleton, CalendarMonthSkeleton } from './common/SkeletonScreens';
import ContinuousCalendarGrid from './calendar/ContinuousCalendarGrid';
import {
    AthletePermissionsResponse,
    CalendarEvent,
    ZoneSummaryResponse,
} from './calendar/types';
import {
    buildQuickWorkoutDescription,
    buildQuickWorkoutStructure,
    buildQuickWorkoutZoneDetails,
} from './calendar/quickWorkout';
import { parseWorkoutText, isParseError } from './calendar/parseWorkoutText';
import { athleteLabel, normalizePlan } from './planner/seasonPlanUtils';
import { readSnapshot, writeSnapshot } from '../utils/localSnapshot';

// Constants for exact alignment
const WEEKDAY_HEADER_HEIGHT = 36;
const WEEKLY_TOTALS_PANEL_WIDTH = 324;

type CalendarPlanningAction =
    | { type: 'goal_race'; priority: 'A' | 'B' | 'C'; label: string; sport_type?: string; distance_km?: number | null; expected_time?: string; location?: string; notes?: string }
    | { type: 'constraint'; kind: PlannerConstraint['kind']; label: string; severity: PlannerConstraint['severity']; impact: PlannerConstraint['impact'] };

type CalendarPlanningMarker =
    | { type: 'goal_race'; priority: 'A' | 'B' | 'C'; label: string; sport_type?: string | null; distance_km?: number | null; expected_time?: string | null; location?: string | null; notes?: string | null; _raceIndex?: number; date?: string }
    | { type: 'constraint'; kind: PlannerConstraint['kind']; label: string; severity?: string; impact?: string; notes?: string | null; start_date?: string; end_date?: string; _constraintIndex?: number };

type PendingPlanningMarker = {
    requestId: string;
    athleteId: number;
    action: CalendarPlanningAction;
    startDate: string;
    endDate: string;
};

type PlanningActionMutationInput = {
    action: CalendarPlanningAction;
    targetAthleteId: number;
    targetAthlete: any;
    dateRange: { startDate: string; endDate: string };
};

const UpcomingRacePill = ({ race, idx, isDark }: { race: any; idx: number; isDark: boolean }) => {
    const RaceIcon = race.priority === 'A' ? Trophy : race.priority === 'B' ? Medal : Award;
    const iconColor = race.priority === 'A' ? '#DC2626' : race.priority === 'B' ? '#D97706' : '#2563EB';
    const daysUntil = Math.max(0, Math.ceil((parseDate(race.date).getTime() - Date.now()) / 86400000));
    const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
    const bg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
    const textColor = isDark ? '#E2E8F0' : '#1E293B';
    const dimColor = isDark ? '#9FB0C8' : '#52617A';
    const surfaceBg = isDark ? '#12223E' : '#FFFFFF';

    return (
        <Popover position="bottom-start" withArrow shadow="md" withinPortal>
            <Popover.Target>
                <Group
                    key={idx}
                    gap={5}
                    wrap="nowrap"
                    style={{ padding: '3px 8px', borderRadius: 8, border: `1px solid ${borderColor}`, background: bg, cursor: 'pointer' }}
                >
                    <RaceIcon size={11} color={iconColor} style={{ flexShrink: 0 }} />
                    <Text size="xs" fw={idx === 0 ? 700 : 500} style={{ color: textColor, whiteSpace: 'nowrap' }}>
                        {format(parseDate(race.date), 'MMM d')} · {race.name}
                    </Text>
                    <Text size="xs" fw={700} style={{ color: iconColor, whiteSpace: 'nowrap' }}>{daysUntil}d</Text>
                </Group>
            </Popover.Target>
            <Popover.Dropdown style={{ background: surfaceBg, border: `1px solid ${borderColor}`, borderRadius: 10, minWidth: 220 }}>
                <Group gap={6} mb={8}>
                    <RaceIcon size={14} color={iconColor} />
                    <Text size="sm" fw={700} style={{ color: textColor }}>{race.name}</Text>
                    <Badge size="xs" variant="light" color={race.priority === 'A' ? 'red' : race.priority === 'B' ? 'orange' : 'blue'}>
                        {race.priority}-Race
                    </Badge>
                </Group>
                <Divider mb={8} />
                <Stack gap={4}>
                    <Group justify="space-between">
                        <Text size="xs" style={{ color: dimColor }}>Date</Text>
                        <Text size="xs" fw={600} style={{ color: textColor }}>{format(parseDate(race.date), 'MMMM d, yyyy')}</Text>
                    </Group>
                    <Group justify="space-between">
                        <Text size="xs" style={{ color: dimColor }}>Days away</Text>
                        <Text size="xs" fw={600} style={{ color: iconColor }}>{daysUntil} days</Text>
                    </Group>
                    {race.sport_type && (
                        <Group justify="space-between">
                            <Text size="xs" style={{ color: dimColor }}>Sport</Text>
                            <Text size="xs" fw={600} style={{ color: textColor }}>{race.sport_type}</Text>
                        </Group>
                    )}
                    {race.distance_km != null && (
                        <Group justify="space-between">
                            <Text size="xs" style={{ color: dimColor }}>Distance</Text>
                            <Text size="xs" fw={600} style={{ color: textColor }}>{race.distance_km} km</Text>
                        </Group>
                    )}
                    {race.expected_time && (
                        <Group justify="space-between">
                            <Text size="xs" style={{ color: dimColor }}>Goal time</Text>
                            <Text size="xs" fw={600} style={{ color: textColor }}>{race.expected_time}</Text>
                        </Group>
                    )}
                    {race.location && (
                        <Group justify="space-between">
                            <Text size="xs" style={{ color: dimColor }}>Location</Text>
                            <Text size="xs" fw={600} style={{ color: textColor }}>{race.location}</Text>
                        </Group>
                    )}
                    {race.notes && (
                        <Box mt={4}>
                            <Text size="xs" style={{ color: dimColor }} mb={2}>Notes</Text>
                            <Text size="xs" style={{ color: textColor }}>{race.notes}</Text>
                        </Box>
                    )}
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
};

const buildPlanningMarkerVisual = (marker: CalendarPlanningMarker) => {
    if (marker.type === 'goal_race') {
        if (marker.priority === 'A') {
            return { Icon: Trophy, color: '#DC2626', shortLabel: 'A', title: marker.label };
        }
        if (marker.priority === 'B') {
            return { Icon: Medal, color: '#D97706', shortLabel: 'B', title: marker.label };
        }
        return { Icon: Award, color: '#2563EB', shortLabel: 'C', title: marker.label };
    }

    if (marker.kind === 'travel') {
        return { Icon: Plane, color: '#0EA5E9', shortLabel: '', title: marker.label };
    }
    if (marker.kind === 'sickness') {
        return { Icon: HeartPulse, color: '#DC2626', shortLabel: '', title: marker.label };
    }
    if (marker.kind === 'injury') {
        return { Icon: Bandage, color: '#F97316', shortLabel: '', title: marker.label };
    }
    return { Icon: CalendarOff, color: '#7C3AED', shortLabel: '', title: marker.label };
};

const sortCalendarRows = (rows: any[]) => {
    return [...rows].sort((left, right) => {
        const leftTime = left?.start instanceof Date ? left.start.getTime() : 0;
        const rightTime = right?.start instanceof Date ? right.start.getTime() : 0;
        if (rightTime !== leftTime) {
            return rightTime - leftTime;
        }
        const leftId = String(left?.resource?.id ?? '');
        const rightId = String(right?.resource?.id ?? '');
        return rightId.localeCompare(leftId);
    });
};

const buildDateRangeTitle = (start: Date, end: Date) => {
    const startKey = format(start, 'yyyy-MM-dd');
    const endKey = format(end, 'yyyy-MM-dd');
    if (startKey === endKey) {
        return format(start, 'MMMM do, yyyy');
    }
    return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
};

export const TrainingCalendar = ({ 
    athleteId, 
    allAthletes, 
    athletes, 
    initialViewDate,
    draggedWorkout,
    onWorkoutDrop,
    actionButtons,
}: { 
    athleteId?: number | null, 
    allAthletes?: boolean, 
    athletes?: any[], 
    initialViewDate?: string | null,
    draggedWorkout?: SavedWorkout | null,
    onWorkoutDrop?: (workout: SavedWorkout, date: Date) => void,
    actionButtons?: React.ReactNode,
}) => {
    const estimatePlannedDurationMinutesFromStructure = (nodes: any[]): number | undefined => {
        if (!Array.isArray(nodes) || nodes.length === 0) return undefined;

        const estimateNodeSeconds = (node: any): number => {
            if (!node || typeof node !== 'object') return 0;
            if (node.type === 'repeat') {
                const repeats = Math.max(1, Number(node.repeats) || 1);
                const childSeconds = Array.isArray(node.steps)
                    ? node.steps.reduce((sum: number, child: any) => sum + estimateNodeSeconds(child), 0)
                    : 0;
                return childSeconds * repeats;
            }
            if (node.type !== 'block') return 0;
            const durationType = node.duration?.type;
            const rawValue = Number(node.duration?.value || 0);
            if (!Number.isFinite(rawValue) || rawValue <= 0) return 0;

            if (durationType === 'time') return rawValue;
            if (durationType === 'distance') return rawValue * 0.2;
            return 0;
        };

        const totalSeconds = nodes.reduce((sum: number, node: any) => sum + estimateNodeSeconds(node), 0);
        if (totalSeconds <= 0) return undefined;
        return Math.max(1, Math.round(totalSeconds / 60));
    };

    const navigate = useNavigate();
    const { t } = useI18n();
    const isDark = useComputedColorScheme('light') === 'dark';
    const isMobileViewport = useMediaQuery('(max-width: 62em)');
    const palette = isDark ? ORIGAMI_THEME.dark : ORIGAMI_THEME.light;
    const activityColors = isDark ? ORIGAMI_ACTIVITY_COLORS.dark : ORIGAMI_ACTIVITY_COLORS.light;
    const queryClient = useQueryClient();
    const { data: me } = useQuery({
        queryKey: ["me"],
        queryFn: async () => {
            const response = await api.get("/users/me");
            return response.data;
        },
        staleTime: 1000 * 60 * 30
    });

    const { data: selfPermissions } = useQuery({
        queryKey: ['athlete-permissions-self', me?.id],
        enabled: Boolean(me?.id && me?.role === 'athlete'),
        queryFn: async () => {
            const res = await api.get<AthletePermissionsResponse>(`/users/athletes/${me?.id}/permissions`);
            return res.data;
        }
    });

    const canEditWorkouts = me?.role === 'coach' || Boolean(selfPermissions?.permissions?.allow_edit_workouts);
    const canDeleteWorkouts = me?.role === 'coach' || me?.role === 'athlete';

    const weekStartDay = me?.profile?.week_start_day === 'sunday' ? 0 : 1;

    const [opened, { open, close }] = useDisclosure(false);
    const [selectedEvent, setSelectedEvent] = useState<Partial<CalendarEvent>>({ sport_type: 'Cycling' });
    const [duplicateModalActivity, setDuplicateModalActivity] = useState<Activity | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [bulkEditOpened, setBulkEditOpened] = useState(false);
    const [bulkWeekKey, setBulkWeekKey] = useState<string | null>(null);
    const [bulkShiftDays, setBulkShiftDays] = useState(0);
    const [bulkDurationScale, setBulkDurationScale] = useState(100);
    const [bulkZoneDelta, setBulkZoneDelta] = useState(0);
    const [bulkAthleteScope, setBulkAthleteScope] = useState<string>('all');
    const [bulkApplying, setBulkApplying] = useState(false);
    const parsedInitialViewDate = useMemo(() => {
        if (!initialViewDate) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(initialViewDate)) {
            const parsedDateOnly = parseDate(initialViewDate);
            return Number.isNaN(parsedDateOnly.getTime()) ? null : parsedDateOnly;
        }
        const parsed = new Date(initialViewDate);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }, [initialViewDate]);

    const [viewDate, setViewDate] = useState(parsedInitialViewDate || new Date());
    const [currentView, setCurrentView] = useState<'month' | 'week'>(isMobileViewport ? 'week' : 'month');
    const monthGridRef = React.useRef<HTMLDivElement | null>(null);
    const gridScrollRef = React.useRef<HTMLDivElement | null>(null);
    const [weekRowHeights, setWeekRowHeights] = useState<number[]>([]);
    const [continuousVisibleWeeks, setContinuousVisibleWeeks] = useState<Array<{ start: Date; end: Date; key: string }>>([]);

    /** How many weeks to show in the continuous grid (responsive) */
    const visibleWeekCount = isMobileViewport ? 3 : 4;

    const athleteById = useMemo(() => {
        const map = new Map<number, any>();
        (athletes || []).forEach((athlete: any) => {
            map.set(athlete.id, athlete);
        });
        return map;
    }, [athletes]);

    const [optimisticPlanningMarkers, setOptimisticPlanningMarkers] = useState<PendingPlanningMarker[]>([]);

    const calendarSeasonPlanAthleteId = useMemo(() => {
        if (allAthletes) return null;
        if (athleteId) return athleteId;
        return me?.id ?? null;
    }, [allAthletes, athleteId, me?.id]);

    const { data: calendarSeasonPlan } = useQuery({
        queryKey: ['season-plan', calendarSeasonPlanAthleteId],
        enabled: Boolean(calendarSeasonPlanAthleteId),
        queryFn: () => getLatestSeasonPlan(calendarSeasonPlanAthleteId),
        staleTime: 1000 * 60,
    });

    useEffect(() => {
        if (parsedInitialViewDate) {
            setViewDate(parsedInitialViewDate);
        }
    }, [parsedInitialViewDate]);

    // Fetch Events logic
    const fetchEvents = useCallback(async (start: Date, end: Date) => {
        const startStr = format(start, 'yyyy-MM-dd');
        const endStr = format(end, 'yyyy-MM-dd');
        let url = `/calendar/?start_date=${startStr}&end_date=${endStr}`;
        if (athleteId) {
            url += `&athlete_id=${athleteId}`;
        } else if (allAthletes) {
            url += `&all_athletes=true`;
        }
        const res = await api.get(url);
        return (Array.isArray(res.data) ? res.data : []).filter((evt: CalendarEvent | null | undefined) => {
            if (!evt || typeof evt !== 'object') return false;
            if (!evt.date) return false;
            return true;
        }).map((evt: CalendarEvent) => {
            let title = evt.title;
            if (allAthletes && evt.user_id) {
                const a = athleteById.get(evt.user_id);
                if (a) {
                    const p = a.profile;
                    const name = (p?.first_name || p?.last_name) 
                        ? `${p.first_name || ''} ${p.last_name || ''}`.trim() 
                        : a.email;
                    title = `${name}: ${title}`;
                }
            }
            return {
                ...evt,
                title,
                start: parseDate(evt.date),
                end: parseDate(evt.date), // All day events
                allDay: true,
                resource: evt
            };
        });
    }, [athleteId, allAthletes, athleteById]);

    // Snap viewDate to the first of its month so the query key only changes
    // when the user crosses a month boundary — not on every weekly scroll tick.
    const viewMonthKey = format(viewDate, 'yyyy-MM');

    // Snap fetch centre to the **half-year** boundary of the current viewDate
    // so the calendar query key only changes 2× per year instead of every
    // month-boundary scroll tick.  This prevents activities from flickering
    // or disappearing when the user scrolls past month/quarter edges.
    // Returns a stable string so downstream memos don't re-run on every month change.
    const fetchHalfYearKey = useMemo(() => {
        const h = viewDate.getMonth() < 6 ? 0 : 6;
        return `${viewDate.getFullYear()}-${String(h + 1).padStart(2, '0')}-01`;
    }, [viewMonthKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const rangeBounds = useMemo(() => {
        // Parse the stable half-year anchor string back to a Date
        const anchor = parseDate(fetchHalfYearKey);
        // Fetch a wide window (±7 months) from the half-year anchor so the
        // continuous scroll grid (±26 weeks ≈ ±6 months) always has data.
        const rangeStart = startOfWeek(startOfMonth(addMonths(anchor, -7)), { weekStartsOn: weekStartDay as any });
        const rangeEnd = endOfWeek(endOfMonth(addMonths(anchor, 7)), { weekStartsOn: weekStartDay as any });
        return {
            start: rangeStart,
            end: rangeEnd,
        };
    }, [fetchHalfYearKey, weekStartDay]);

    const toEventDate = (value: unknown, fallbackDate?: string): Date | null => {
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = new Date(value);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed;
            }
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                const localParsed = parseDate(value);
                if (!Number.isNaN(localParsed.getTime())) {
                    return localParsed;
                }
            }
        }
        if (fallbackDate) {
            const fallback = parseDate(fallbackDate);
            if (!Number.isNaN(fallback.getTime())) {
                return fallback;
            }
        }
        return null;
    };

    const normalizeCalendarEvent = (event: any) => {
        if (!event || !event.resource) return null;
        const start = toEventDate(event.start, event.resource?.date);
        const end = toEventDate(event.end, event.resource?.date) || start;
        if (!start || !end) return null;
        return {
            ...event,
            start,
            end,
            allDay: event.allDay ?? true,
        };
    };

    const rangeStartStr = useMemo(() => format(rangeBounds.start, 'yyyy-MM-dd'), [rangeBounds]);
    const rangeEndStr = useMemo(() => format(rangeBounds.end, 'yyyy-MM-dd'), [rangeBounds]);

    const { data: events = [], isLoading: eventsLoading, isFetching: eventsFetching } = useQuery({
        queryKey: ['calendar', rangeStartStr, rangeEndStr, athleteId, allAthletes],
        queryFn: async () => {
            const rows = await fetchEvents(rangeBounds.start, rangeBounds.end);
            const safeRows = rows
                .map(normalizeCalendarEvent)
                .filter((event): event is any => Boolean(event));
            return safeRows;
        },
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 30,
        placeholderData: (prev) => prev,
        refetchOnMount: 'always',
    });

    const buildCalendarDisplayResource = useCallback((resource: CalendarEvent): CalendarEvent => {
        let title = resource.title;
        if (allAthletes && resource.user_id) {
            const athlete = athleteById.get(resource.user_id);
            if (athlete) {
                const profile = athlete.profile;
                const name = (profile?.first_name || profile?.last_name)
                    ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
                    : athlete.email;
                title = `${name}: ${title}`;
            }
        }
        return { ...resource, title };
    }, [allAthletes, athleteById]);

    /* ── Day notes for calendar range ── */
    const { data: dayNotesRange = [] } = useQuery({
        queryKey: ['day-notes-range', rangeStartStr, rangeEndStr, athleteId],
        queryFn: () => getDayNotesRange(rangeStartStr, rangeEndStr, athleteId || undefined),
        staleTime: 1000 * 60 * 2,
        placeholderData: (prev) => prev,
    });
    const notesByDate = useMemo(() => {
        const map = new Map<string, DayNote[]>();
        for (const note of dayNotesRange) {
            const list = map.get(note.date) || [];
            list.push(note);
            map.set(note.date, list);
        }
        return map;
    }, [dayNotesRange]);

    const buildCalendarEventEnvelope = useCallback((resource: CalendarEvent) => {
        const displayResource = buildCalendarDisplayResource(resource);
        const eventDate = parseDate(displayResource.date);
        return {
            ...displayResource,
            start: eventDate,
            end: eventDate,
            allDay: true,
            resource: displayResource,
        };
    }, [buildCalendarDisplayResource]);

    const calendarQueryContainsDate = useCallback((queryKey: readonly unknown[], dateKey: string) => {
        const start = typeof queryKey?.[1] === 'string' ? queryKey[1] : null;
        const end = typeof queryKey?.[2] === 'string' ? queryKey[2] : null;
        if (!start || !end) return true;
        return dateKey >= start && dateKey <= end;
    }, []);

    const snapshotCalendarQueries = useCallback(() => {
        return queryClient.getQueriesData<any[]>({ queryKey: ['calendar'] });
    }, [queryClient]);

    const restoreCalendarSnapshots = useCallback((snapshots: Array<[readonly unknown[], any[] | undefined]>) => {
        snapshots.forEach(([queryKey, data]) => {
            queryClient.setQueryData(queryKey, data);
        });
    }, [queryClient]);

    const upsertCalendarResourceInQueries = useCallback((resource: CalendarEvent, previousId?: number | string) => {
        const envelope = buildCalendarEventEnvelope(resource);
        snapshotCalendarQueries().forEach(([queryKey, current]) => {
            if (!Array.isArray(current)) return;

            let next = current.filter((row: any) => (
                row?.resource?.id !== resource.id
                && row?.resource?.id !== previousId
            ));

            if (calendarQueryContainsDate(queryKey, resource.date)) {
                next = sortCalendarRows([envelope, ...next]);
            }

            queryClient.setQueryData(queryKey, next);
        });
    }, [buildCalendarEventEnvelope, calendarQueryContainsDate, queryClient, snapshotCalendarQueries]);

    const removeCalendarResourceFromQueries = useCallback((resourceId: number | string) => {
        snapshotCalendarQueries().forEach(([queryKey, current]) => {
            if (!Array.isArray(current)) return;
            queryClient.setQueryData(
                queryKey,
                current.filter((row: any) => row?.resource?.id !== resourceId),
            );
        });
    }, [queryClient, snapshotCalendarQueries]);

    const buildNextSeasonPlanForAction = useCallback((
        basePlanRaw: SeasonPlan | null | undefined,
        targetAthlete: any,
        action: CalendarPlanningAction,
        dateRange: { startDate: string; endDate: string },
    ) => {
        const sportType = targetAthlete?.profile?.main_sport || me?.profile?.main_sport || 'Cycling';
        const nextPlan = normalizePlan(basePlanRaw || null, sportType, athleteLabel(targetAthlete));

        if (!basePlanRaw) {
            nextPlan.target_metrics = [];
            nextPlan.goal_races = [];
            nextPlan.constraints = [];
        }

        nextPlan.season_start = nextPlan.season_start <= dateRange.startDate ? nextPlan.season_start : dateRange.startDate;
        nextPlan.season_end = nextPlan.season_end >= dateRange.endDate ? nextPlan.season_end : dateRange.endDate;

        if (action.type === 'goal_race') {
            const nextRace = {
                name: `${action.label} ${format(parseDate(dateRange.startDate), 'MMM d')}`,
                date: dateRange.startDate,
                priority: action.priority,
                sport_type: action.sport_type || '',
                distance_km: action.distance_km ?? null,
                expected_time: action.expected_time || '',
                location: action.location || '',
                notes: action.notes || '',
                target_metrics: [],
            };
            const existingRaceIndex = nextPlan.goal_races.findIndex((race) => race.date === dateRange.startDate);
            nextPlan.goal_races = existingRaceIndex >= 0
                ? nextPlan.goal_races.map((race, index) => index === existingRaceIndex ? { ...race, ...nextRace } : race)
                : [...nextPlan.goal_races, nextRace];
            nextPlan.goal_races.sort((left, right) => left.date.localeCompare(right.date));
            return nextPlan;
        }

        const nextConstraint = {
            name: action.label,
            kind: action.kind,
            start_date: dateRange.startDate,
            end_date: dateRange.endDate,
            severity: action.severity,
            impact: action.impact,
            notes: '',
        };
        const existingConstraintIndex = nextPlan.constraints.findIndex((constraint) => (
            constraint.kind === action.kind
            && constraint.start_date === dateRange.startDate
            && constraint.end_date === dateRange.endDate
        ));
        nextPlan.constraints = existingConstraintIndex >= 0
            ? nextPlan.constraints.map((constraint, index) => index === existingConstraintIndex ? { ...constraint, ...nextConstraint } : constraint)
            : [...nextPlan.constraints, nextConstraint];
        nextPlan.constraints.sort((left, right) => {
            const dateCompare = left.start_date.localeCompare(right.start_date);
            if (dateCompare !== 0) return dateCompare;
            return left.kind.localeCompare(right.kind);
        });
        return nextPlan;
    }, [me?.profile?.main_sport]);

    // Track whether we've ever successfully loaded events so we never
    // unmount the grid during a background refetch (query key change).
    const calendarEverLoaded = useRef(false);
    if (events.length > 0) calendarEverLoaded.current = true;
    const isInitialCalendarLoading = !calendarEverLoaded.current && (eventsLoading || eventsFetching) && events.length === 0;

    // The continuous grid handles per-day event limiting internally.
    // This alias keeps compatibility with the week view and effect dependencies.
    const calendarEvents = events;

    const zoneSummarySnapKey = `zone-summary:${athleteId || 'self'}:${allAthletes ? 'all' : 'single'}:${weekStartDay}:${viewMonthKey}`;
    const { data: zoneSummary } = useQuery({
        queryKey: ['zone-summary', viewMonthKey, athleteId, allAthletes, weekStartDay],
        initialData: () => readSnapshot<ZoneSummaryResponse>(zoneSummarySnapKey) ?? undefined,
        queryFn: async () => {
            const params = new URLSearchParams();
            params.set('reference_date', format(viewDate, 'yyyy-MM-dd'));
            params.set('week_start_day', weekStartDay === 0 ? 'sunday' : 'monday');
            if (athleteId) {
                params.set('athlete_id', athleteId.toString());
            } else if (allAthletes) {
                params.set('all_athletes', 'true');
            }
            const res = await api.get<ZoneSummaryResponse>(`/activities/zone-summary?${params.toString()}`);
            writeSnapshot(zoneSummarySnapKey, res.data);
            return res.data;
        },
        staleTime: 1000 * 60 * 5,
        placeholderData: (prev) => prev,
    });

    const [dayEvents, setDayEvents] = useState<CalendarEvent[]>([]);
    const [dayModalOpen, { open: openDayModal, close: closeDayModal }] = useDisclosure(false);
    const [selectedDayTitle, setSelectedDayTitle] = useState('');
    const [selectedDateRange, setSelectedDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
    const [dayCreateError, setDayCreateError] = useState<string | null>(null);
    const [quickWorkout, setQuickWorkout] = useState({
        sport_type: 'Cycling',
        zone: 2,
        mode: 'time' as 'time' | 'distance',
        minutes: 45,
        distanceKm: 10,
    });
    const [textWorkoutInput, setTextWorkoutInput] = useState('');

    const createMutation = useMutation({
        mutationFn: (newWorkout: CalendarEvent) => {
            let url = '/calendar/';
            const targetId = newWorkout.user_id || athleteId;
            if (targetId) url += `?athlete_id=${targetId}`;
            return api.post(url, newWorkout);
        },
        onMutate: async (newWorkout: CalendarEvent) => {
            setSaveError(null);
            await queryClient.cancelQueries({ queryKey: ['calendar'] });
            const snapshots = snapshotCalendarQueries();
            const tempId = -Date.now();
            upsertCalendarResourceInQueries({
                ...newWorkout,
                id: tempId,
                is_planned: true,
                compliance_status: 'planned',
            });
            close();
            return { snapshots, tempId };
        },
        onSuccess: (response: any, _vars, context) => {
            upsertCalendarResourceInQueries({ ...(response.data || response), is_planned: true }, context?.tempId);
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] });
        },
        onError: (error: any, _vars, context) => {
            if (context?.snapshots) {
                restoreCalendarSnapshots(context.snapshots);
            }
            const message = error?.response?.data?.detail || error?.message || 'Could not create workout';
            setSaveError(message);
            notifications.show({
                color: 'red',
                title: t('Could not save workout') || 'Could not save workout',
                message,
            });
        },
    });

    const updateMutation = useMutation({
        mutationFn: (vars: { id: number; data: Partial<CalendarEvent> }) => api.patch(`/calendar/${vars.id}`, vars.data),
        onMutate: async (vars: { id: number; data: Partial<CalendarEvent> }) => {
            setSaveError(null);
            await queryClient.cancelQueries({ queryKey: ['calendar'] });
            const snapshots = snapshotCalendarQueries();
            const existing = events.find((event: any) => event?.resource?.id === vars.id)?.resource as CalendarEvent | undefined;
            if (existing) {
                upsertCalendarResourceInQueries({ ...existing, ...vars.data, is_planned: true }, vars.id);
            }
            return { snapshots, existing };
        },
        onSuccess: (response: any, vars, context) => {
            upsertCalendarResourceInQueries({ ...(context?.existing || {}), ...(response.data || response), is_planned: true }, vars.id);
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] });
        },
        onError: (error: any, _vars, context) => {
            if (context?.snapshots) {
                restoreCalendarSnapshots(context.snapshots);
            }
            const message = error?.response?.data?.detail || error?.message || 'Could not update workout';
            setSaveError(message);
            notifications.show({
                color: 'red',
                title: t('Could not save workout') || 'Could not save workout',
                message,
            });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api.delete(`/calendar/${id}`),
        onMutate: async (id: number) => {
            await queryClient.cancelQueries({ queryKey: ['calendar'] });
            const snapshots = snapshotCalendarQueries();
            removeCalendarResourceFromQueries(id);
            close();
            return { snapshots };
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] });
        },
        onError: (error: any, id, context) => {
            const status = error?.response?.status;
            if (status === 404) {
                void queryClient.invalidateQueries({ queryKey: ['calendar'] });
                close();
                return;
            }
            if (context?.snapshots) {
                restoreCalendarSnapshots(context.snapshots);
            }
            notifications.show({
                color: 'red',
                title: t('Could not delete workout') || 'Could not delete workout',
                message: error?.response?.data?.detail || error?.message || 'Please try again.',
            });
        },
    });

    const planningActionMutation = useMutation({
        mutationFn: async (input: PlanningActionMutationInput) => {
            const cachedPlan = queryClient.getQueryData<SeasonPlan | null>(['season-plan', input.targetAthleteId]);
            const existingPlan = cachedPlan ?? await getLatestSeasonPlan(input.targetAthleteId);
            const nextPlan = buildNextSeasonPlanForAction(existingPlan, input.targetAthlete, input.action, input.dateRange);
            return saveSeasonPlan(nextPlan, input.targetAthleteId);
        },
        onMutate: async (input: PlanningActionMutationInput) => {
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            setDayCreateError(null);
            setOptimisticPlanningMarkers((current) => [...current, {
                requestId,
                athleteId: input.targetAthleteId,
                action: input.action,
                startDate: input.dateRange.startDate,
                endDate: input.dateRange.endDate,
            }]);
            closeDayModal();
            return { requestId };
        },
        onSuccess: (data, input, context) => {
            setOptimisticPlanningMarkers((current) => current.filter((item) => item.requestId !== context?.requestId));
            queryClient.setQueryData(['season-plan', input.targetAthleteId], data);
            void queryClient.invalidateQueries({ queryKey: ['season-plan', input.targetAthleteId] });
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] });
            notifications.show({
                color: 'green',
                title: t('Saved to season plan') || 'Saved to season plan',
                message: input.action.type === 'goal_race'
                    ? `${input.action.label} ${t('saved on calendar date') || 'saved on calendar date'}`
                    : `${input.action.label} ${t('saved for selected dates') || 'saved for selected dates'}`,
            });
        },
        onError: (error: any, _input, context) => {
            setOptimisticPlanningMarkers((current) => current.filter((item) => item.requestId !== context?.requestId));
            notifications.show({
                color: 'red',
                title: t('Could not save to season plan') || 'Could not save to season plan',
                message: error?.response?.data?.detail || error?.message || (t('Could not save to season plan') || 'Could not save to season plan'),
            });
        },
    });

    const seasonPlanUpdateMutation = useMutation({
        mutationFn: async (input: { type: 'update_race' | 'delete_race' | 'update_constraint' | 'delete_constraint'; index: number; data?: any }) => {
            const targetAthleteId = calendarSeasonPlanAthleteId;
            if (!targetAthleteId) throw new Error('No athlete selected');
            const cached = queryClient.getQueryData<SeasonPlan | null>(['season-plan', targetAthleteId]);
            const existing = cached ?? await getLatestSeasonPlan(targetAthleteId);
            if (!existing) throw new Error('No season plan found');
            const sportType = me?.profile?.main_sport || 'Cycling';
            const plan = normalizePlan(existing, sportType);

            if (input.type === 'delete_race') {
                plan.goal_races = plan.goal_races.filter((_: any, i: number) => i !== input.index);
            } else if (input.type === 'update_race' && input.data) {
                plan.goal_races = plan.goal_races.map((r: any, i: number) => i === input.index ? { ...r, ...input.data } : r);
            } else if (input.type === 'delete_constraint') {
                plan.constraints = plan.constraints.filter((_: any, i: number) => i !== input.index);
            } else if (input.type === 'update_constraint' && input.data) {
                plan.constraints = plan.constraints.map((c: any, i: number) => i === input.index ? { ...c, ...input.data } : c);
            }

            return saveSeasonPlan(plan, targetAthleteId);
        },
        onSuccess: (data) => {
            queryClient.setQueryData(['season-plan', calendarSeasonPlanAthleteId], data);
            void queryClient.invalidateQueries({ queryKey: ['season-plan', calendarSeasonPlanAthleteId] });
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
            void queryClient.invalidateQueries({ queryKey: ['dashboard-calendar'] });
            notifications.show({ color: 'green', title: t('Season plan updated') || 'Season plan updated', message: '' });
        },
        onError: (error: any) => {
            notifications.show({
                color: 'red',
                title: t('Could not update season plan') || 'Could not update season plan',
                message: error?.response?.data?.detail || error?.message || '',
            });
        },
    });

    const handleSeasonPlanItemUpdate = useCallback((action: { type: 'update_race' | 'delete_race' | 'update_constraint' | 'delete_constraint'; index: number; data?: any }) => {
        seasonPlanUpdateMutation.mutate(action);
    }, [seasonPlanUpdateMutation]);

    const onEventDrop = useCallback(async ({ event, start }: any) => {
        if (!canEditWorkouts) return;
        const dateStr = format(start, 'yyyy-MM-dd');
        if (!event.resource.is_planned) return;

        if (event.resource.date !== dateStr && event.resource.id) {
            updateMutation.mutate({ id: event.resource.id, data: { date: dateStr } });
        }
    }, [updateMutation, canEditWorkouts]);

    const onDropFromOutside = useCallback(({ start }: { start: string | Date }) => {
        if (!canEditWorkouts) return;
        const startDate = typeof start === 'string' ? new Date(start) : start;
        if (draggedWorkout) {
            const dateStr = format(startDate, 'yyyy-MM-dd');
            const newEvent: CalendarEvent = {
                title: draggedWorkout.title,
                date: dateStr,
                sport_type: draggedWorkout.sport_type,
                structure: draggedWorkout.structure,
                description: draggedWorkout.description,
                is_planned: true,
                user_id: athleteId || (athletes && athletes.length > 0 ? athletes[0].id : undefined),
                planned_duration: 60,
                recurrence: null,
            };
            createMutation.mutate(newEvent);

            if (onWorkoutDrop) onWorkoutDrop(draggedWorkout, startDate);
        }
    }, [draggedWorkout, onWorkoutDrop, canEditWorkouts, athleteId, athletes, createMutation]);

    const handleSelectSlot = useCallback(({ start }: any) => {
        setSelectedEvent({ 
            date: format(start, 'yyyy-MM-dd'),
            sport_type: 'Cycling', 
            planned_duration: 60,
            title: 'New Workout',
            is_planned: true,
            user_id: athleteId || (athletes && athletes.length > 0 ? athletes[0].id : undefined),
            recurrence: undefined,
        });
        open();
    }, [open, athleteId, athletes]);

    const handleSelectEvent = useCallback((event: any) => {
        if (event.resource.is_more_indicator) {
            const dateValue = parseDate(event.resource.date);
            const dateStr = format(dateValue, 'yyyy-MM-dd');
            const dayEvts = events.filter((e: any) => e.resource.date === dateStr);

            setDayEvents(dayEvts.map((e: any) => e.resource));
            setSelectedDayTitle(format(dateValue, 'MMMM do, yyyy'));
            setSelectedDateRange({ startDate: dateStr, endDate: dateStr });
            setSelectedEvent({
                date: dateStr,
                sport_type: 'Cycling',
                planned_duration: 60,
                title: 'New Workout',
                user_id: athleteId || undefined,
                structure: [],
                recurrence: undefined,
            });
            setDayCreateError(null);
            openDayModal();
            return;
        }

        if (!event.resource.is_planned) {
            if (event.resource.id) {
                if ((event.resource.duplicate_recordings_count ?? 0) > 0) {
                    const res = event.resource;
                    setDuplicateModalActivity({
                        id: res.id!,
                        filename: res.title,
                        sport: res.sport_type ?? null,
                        created_at: res.date,
                        distance: res.distance != null ? res.distance * 1000 : null,
                        duration: res.duration != null ? res.duration * 60 : null,
                        avg_speed: res.avg_speed ?? null,
                        average_hr: res.avg_hr ?? null,
                        average_watts: res.avg_watts ?? null,
                        athlete_id: res.user_id!,
                        duplicate_recordings_count: res.duplicate_recordings_count ?? null,
                        duplicate_of_id: null,
                    });
                    return;
                }
                navigate(`/dashboard/activities/${event.resource.id}`, {
                    state: {
                        returnTo: athleteId ? `/dashboard/athlete/${athleteId}` : '/dashboard',
                        activeTab: athleteId ? undefined : 'plan',
                        selectedAthleteId: athleteId ? athleteId.toString() : null,
                        calendarDate: format(viewDate, 'yyyy-MM-dd')
                    }
                });
            }
            return;
        }
        if (!canEditWorkouts) {
            return;
        }
        setSelectedEvent(event.resource);
        open();
    }, [open, navigate, canEditWorkouts, events, openDayModal]);

    const handleSave = () => {
        if (!canEditWorkouts) {
            return;
        }
        if (!selectedEvent.date) {
            setSaveError('Please set a workout date first. Your draft is safe.');
            return;
        }
        const selectedDate = parseDate(selectedEvent.date);
        const selectedDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (!selectedEvent.id && selectedDay < today) {
            setSaveError('Creating workouts for yesterday or earlier is disabled.');
            return;
        }
        if (!selectedEvent.title || !selectedEvent.title.trim()) {
            setSaveError('Add a workout title so your athlete can recognize this session quickly.');
            return;
        }
        if (selectedEvent.structure && Array.isArray(selectedEvent.structure) && selectedEvent.structure.length === 0) {
            setSaveError('Your workout has no steps yet. Add at least one block or quick workout so we can save it.');
            return;
        }
        setSaveError(null);
        const computedDuration = estimatePlannedDurationMinutesFromStructure(selectedEvent.structure as any[]);
        const payload = {
            ...selectedEvent,
            planned_duration: computedDuration ?? selectedEvent.planned_duration,
        };
        if (selectedEvent.id) {
            updateMutation.mutate({ id: selectedEvent.id, data: payload });
            close();
        } else {
             // Create
             // @ts-ignore
             createMutation.mutate(payload as CalendarEvent);
        }
    };

    const handleSlotSelection = useCallback(({ start, slots }: any) => {
        const slotDates = (Array.isArray(slots) && slots.length > 0 ? slots : [start])
            .map((value: Date | string) => typeof value === 'string' ? new Date(value) : value)
            .filter((value: Date) => !Number.isNaN(value.getTime()))
            .sort((left: Date, right: Date) => left.getTime() - right.getTime());

        const startDate = slotDates[0] || (typeof start === 'string' ? new Date(start) : start);
        const endDate = slotDates[slotDates.length - 1] || startDate;
        const startDateStr = format(startDate, 'yyyy-MM-dd');
        const endDateStr = format(endDate, 'yyyy-MM-dd');
        const selectedEvents = events.filter((e: any) => e.resource.date >= startDateStr && e.resource.date <= endDateStr);
        
        setDayEvents(selectedEvents.map((e: any) => e.resource));
        setSelectedDayTitle(buildDateRangeTitle(startDate, endDate));
        setSelectedDateRange({ startDate: startDateStr, endDate: endDateStr });

        setSelectedEvent({ 
            date: startDateStr,
            sport_type: 'Cycling', 
            planned_duration: 60,
            title: 'New Workout',
            user_id: athleteId || undefined,
            structure: [],
            recurrence: undefined,
        });

        setDayCreateError(null);

        setQuickWorkout({
            sport_type: 'Cycling',
            zone: 2,
            mode: 'time',
            minutes: 45,
            distanceKm: 10
        });
        
        openDayModal();
    }, [events, openDayModal, athleteId]);

    const coachNeedsAthleteSelection = Boolean(
        me?.role === 'coach' &&
        !athleteId &&
        athletes &&
        athletes.length > 0
    );

    const ensureAthleteSelectedForCreate = () => {
        if (coachNeedsAthleteSelection && !selectedEvent.user_id) {
            setDayCreateError('Please select an athlete first.');
            return false;
        }
        setDayCreateError(null);
        return true;
    };

    const buildPlanningActionInput = useCallback((action: CalendarPlanningAction): PlanningActionMutationInput | null => {
        if (!canEditWorkouts) {
            setDayCreateError(t('Coach has disabled workout editing for your account.') || 'Coach has disabled workout editing for your account.');
            return null;
        }
        if (!ensureAthleteSelectedForCreate()) {
            return null;
        }
        if (!selectedDateRange) {
            setDayCreateError(t('Please select a date first.') || 'Please select a date first.');
            return null;
        }

        const targetAthleteId = selectedEvent.user_id || athleteId || (athletes && athletes.length > 0 ? athletes[0].id : undefined) || me?.id;
        if (!targetAthleteId) {
            setDayCreateError(t('Choose athlete') || 'Choose athlete');
            return null;
        }

        const targetAthlete = athleteById.get(targetAthleteId) || (me?.id === targetAthleteId ? me : undefined);
        return {
            action,
            targetAthleteId,
            targetAthlete,
            dateRange: selectedDateRange,
        };
    }, [athleteId, athleteById, athletes, canEditWorkouts, ensureAthleteSelectedForCreate, me, selectedDateRange, selectedEvent.user_id, t]);

    const handleCreateQuickWorkout = () => {
        if (!canEditWorkouts) {
            return;
        }
        if (selectedEvent.date) {
            const selectedDate = parseDate(selectedEvent.date);
            const selectedDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (selectedDay < today) {
                setDayCreateError('Creating workouts for yesterday or earlier is disabled.');
                return;
            }
        }
        if (!ensureAthleteSelectedForCreate()) {
            return;
        }

        const targetAthleteId = selectedEvent.user_id || athleteId || (athletes && athletes.length > 0 ? athletes[0].id : undefined);
        const quickAthlete = (athletes || []).find((athlete: any) => athlete.id === targetAthleteId);
        const quickProfile = quickAthlete?.profile || me?.profile;
        const targetDetails = buildQuickWorkoutZoneDetails(quickWorkout.sport_type, quickWorkout.zone, quickProfile);

        const durationMinutes = quickWorkout.mode === 'time' ? quickWorkout.minutes : Math.round((quickWorkout.distanceKm || 0) * 5);
        const structure = buildQuickWorkoutStructure(
            quickWorkout.mode,
            quickWorkout.sport_type,
            quickWorkout.zone,
            quickWorkout.minutes,
            quickWorkout.distanceKm
        );
        const payload: CalendarEvent = {
            title: `Z${quickWorkout.zone} ${quickWorkout.sport_type} Quick Workout`,
            date: selectedEvent.date || format(new Date(), 'yyyy-MM-dd'),
            sport_type: quickWorkout.sport_type,
            planned_duration: durationMinutes,
            planned_distance: quickWorkout.mode === 'distance' ? quickWorkout.distanceKm : undefined,
            planned_intensity: `Zone ${quickWorkout.zone}`,
            description: buildQuickWorkoutDescription(
                quickWorkout.mode,
                quickWorkout.minutes,
                quickWorkout.distanceKm,
                quickWorkout.zone,
                targetDetails
            ),
            user_id: targetAthleteId,
            structure,
            is_planned: true,
            recurrence: selectedEvent.recurrence || undefined,
        };

        createMutation.mutate(payload);
        closeDayModal();
    };

    const handleCreateTextWorkout = () => {
        if (!canEditWorkouts) return;
        if (selectedEvent.date) {
            const selectedDate = parseDate(selectedEvent.date);
            const selectedDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (selectedDay < today) {
                setDayCreateError('Creating workouts for yesterday or earlier is disabled.');
                return;
            }
        }
        if (!ensureAthleteSelectedForCreate()) return;

        const result = parseWorkoutText(textWorkoutInput, quickWorkout.sport_type);
        if (isParseError(result)) {
            setDayCreateError(result.error);
            return;
        }

        const targetAthleteId = selectedEvent.user_id || athleteId || (athletes && athletes.length > 0 ? athletes[0].id : undefined);
        const payload: CalendarEvent = {
            title: `${result.title} ${quickWorkout.sport_type}`,
            date: selectedEvent.date || format(new Date(), 'yyyy-MM-dd'),
            sport_type: quickWorkout.sport_type,
            planned_duration: result.durationMinutes,
            description: textWorkoutInput,
            user_id: targetAthleteId,
            structure: result.structure,
            is_planned: true,
            recurrence: selectedEvent.recurrence || undefined,
        };

        createMutation.mutate(payload);
        setTextWorkoutInput('');
        closeDayModal();
    };

    const handleCreateRestDay = () => {
        if (!canEditWorkouts) return;
        if (selectedEvent.date) {
            const selectedDate = parseDate(selectedEvent.date);
            const selectedDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (selectedDay < today) {
                setDayCreateError('Creating rest days for yesterday or earlier is disabled.');
                return;
            }
        }
        if (!ensureAthleteSelectedForCreate()) return;

        const targetAthleteId = selectedEvent.user_id || athleteId || (athletes && athletes.length > 0 ? athletes[0].id : undefined);
        const payload: CalendarEvent = {
            title: 'Rest Day',
            date: selectedEvent.date || format(new Date(), 'yyyy-MM-dd'),
            sport_type: 'Rest',
            planned_duration: 0,
            planned_intensity: 'Rest',
            description: 'Scheduled rest day — recover and recharge.',
            user_id: targetAthleteId,
            structure: [],
            is_planned: true,
            recurrence: selectedEvent.recurrence || undefined,
        };

        createMutation.mutate(payload);
        closeDayModal();
    };

    const handleDownloadPlannedWorkout = async (workoutId: number) => {
        try {
            const response = await api.get(`/calendar/${workoutId}/download`, { responseType: 'blob' });
            const blob = new Blob([response.data], { type: 'text/calendar;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `planned-workout-${workoutId}.ics`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to download planned workout', error);
        }
    };

    const handleLibrarySelect = (workout: SavedWorkout) => {
        if (!canEditWorkouts) {
            return;
        }

        if (selectedEvent.date) {
            const selectedDate = parseDate(selectedEvent.date);
            const selectedDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (selectedDay < today) {
                setDayCreateError('Creating workouts for yesterday or earlier is disabled.');
                return;
            }
        }
        if (!ensureAthleteSelectedForCreate()) {
            return;
        }

        const targetAthleteId = selectedEvent.user_id || athleteId || (athletes && athletes.length > 0 ? athletes[0].id : undefined);
        const dateStr = selectedEvent.date || format(new Date(), 'yyyy-MM-dd');

        const newEvent: CalendarEvent = {
            title: workout.title,
            date: dateStr,
            sport_type: workout.sport_type,
            structure: workout.structure,
            description: workout.description,
            is_planned: true,
            user_id: targetAthleteId,
            planned_duration: 60, // Default duration
            planned_distance: undefined,
            planned_intensity: undefined,
            recurrence: selectedEvent.recurrence || undefined,
        };

        createMutation.mutate(newEvent);
        closeDayModal();
    };

    const planningMarkersByDate = useMemo(() => {
        const byDate = new Map<string, CalendarPlanningMarker[]>();

        const addMarker = (dateKey: string, marker: CalendarPlanningMarker) => {
            const existing = byDate.get(dateKey) || [];
            byDate.set(dateKey, [...existing, marker]);
        };

        const addConstraintRange = (startDate: string, endDate: string, marker: CalendarPlanningMarker) => {
            let cursor = parseDate(startDate);
            const end = parseDate(endDate);
            while (cursor <= end) {
                addMarker(format(cursor, 'yyyy-MM-dd'), marker);
                const next = new Date(cursor);
                next.setDate(cursor.getDate() + 1);
                cursor = next;
            }
        };

        (calendarSeasonPlan?.goal_races || []).forEach((race, raceIndex) => {
            addMarker(race.date, {
                type: 'goal_race',
                priority: race.priority,
                label: race.name || `${race.priority} race`,
                sport_type: race.sport_type,
                distance_km: race.distance_km,
                expected_time: race.expected_time,
                location: race.location,
                notes: race.notes,
                _raceIndex: raceIndex,
                date: race.date,
            });
        });

        (calendarSeasonPlan?.constraints || []).forEach((constraint, constraintIndex) => {
            addConstraintRange(constraint.start_date, constraint.end_date, {
                type: 'constraint',
                kind: constraint.kind,
                label: constraint.name || constraint.kind,
                severity: constraint.severity,
                impact: constraint.impact,
                notes: constraint.notes,
                start_date: constraint.start_date,
                end_date: constraint.end_date,
                _constraintIndex: constraintIndex,
            });
        });

        optimisticPlanningMarkers
            .filter((marker) => marker.athleteId === calendarSeasonPlanAthleteId)
            .forEach((marker) => {
                if (marker.action.type === 'goal_race') {
                    addMarker(marker.startDate, {
                        type: 'goal_race',
                        priority: marker.action.priority,
                        label: marker.action.label,
                    });
                    return;
                }

                addConstraintRange(marker.startDate, marker.endDate, {
                    type: 'constraint',
                    kind: marker.action.kind,
                    label: marker.action.label,
                });
            });

        return byDate;
    }, [calendarSeasonPlan, calendarSeasonPlanAthleteId, optimisticPlanningMarkers]);

    const handleQuickPlanningAction = useCallback((action: CalendarPlanningAction) => {
        const input = buildPlanningActionInput(action);
        if (!input) {
            return;
        }
        planningActionMutation.mutate(input);
    }, [buildPlanningActionInput, planningActionMutation]);

    const formatTotalMinutes = (minutes: number) => {
        const total = Math.max(0, Math.round(minutes));
        const h = Math.floor(total / 60);
        const m = total % 60;
        return `${h}h ${m}m`;
    };

    // Use viewMonthKey (string) as dependency so these only recalculate at
    // actual month boundaries, not on every scroll-tick viewDate change.
    const monthStart = useMemo(() => new Date(viewDate.getFullYear(), viewDate.getMonth(), 1), [viewMonthKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const monthEnd = useMemo(() => new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0), [viewMonthKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const weekStart = useMemo(() => startOfWeek(viewDate, { weekStartsOn: weekStartDay as any }), [viewDate, weekStartDay]);
    const weekEnd = useMemo(() => endOfWeek(viewDate, { weekStartsOn: weekStartDay as any }), [viewDate, weekStartDay]);

    const weeksInMonth = useMemo(() => {
        // In continuous view, use the weeks reported by the grid.
        if (currentView !== 'week' && continuousVisibleWeeks.length > 0) {
            return continuousVisibleWeeks;
        }
        // Fallback: compute from month boundaries
        const first = startOfWeek(monthStart, { weekStartsOn: weekStartDay as any });
        const last = endOfWeek(monthEnd, { weekStartsOn: weekStartDay as any });
        const weeks: Array<{ start: Date; end: Date; key: string }> = [];
        let current = new Date(first);

        while (current <= last) {
            const end = new Date(current);
            end.setDate(current.getDate() + 6);
            weeks.push({
                start: new Date(current),
                end,
                key: format(current, 'yyyy-MM-dd')
            });
            const next = new Date(current);
            next.setDate(current.getDate() + 7);
            current = next;
        }
        return weeks;
    }, [currentView, continuousVisibleWeeks, monthStart, monthEnd, weekStartDay]);

    const monthlyCompletedEvents = useMemo(() => {
        return events.filter((event: any) => {
            if (!event || !event.resource) return false;
            const resource = event.resource as CalendarEvent;
            if (resource.is_planned) return false;
            const eventDate = event.start as Date;
            return eventDate >= monthStart && eventDate <= monthEnd;
        });
    }, [events, monthEnd, monthStart]);

    const monthlyHeaderMetrics = useMemo(() => {
        let totalDistanceKm = 0;
        let totalDurationMin = 0;
        let totalLoad = 0;
        monthlyCompletedEvents.forEach((evt: any) => {
            totalDistanceKm += evt.resource.distance || 0;
            totalDurationMin += evt.resource.duration || 0;
            totalLoad += evt.resource.training_load || 0;
        });
        return { totalDistanceKm, totalDurationMin, totalLoad };
    }, [monthlyCompletedEvents]);

    const monthlyHeaderLabel = useMemo(() => {
        const base = `${monthlyHeaderMetrics.totalDistanceKm.toFixed(1)} km / ${formatTotalMinutes(monthlyHeaderMetrics.totalDurationMin)}`;
        return monthlyHeaderMetrics.totalLoad > 0 ? `${base} / ${monthlyHeaderMetrics.totalLoad.toFixed(0)} TL` : base;
    }, [monthlyHeaderMetrics.totalDistanceKm, monthlyHeaderMetrics.totalDurationMin, monthlyHeaderMetrics.totalLoad]);

    const weeklyEvents = useMemo(() => {
        return events
            .filter((event: any) => {
                const eventDate = event.start as Date;
                return eventDate >= weekStart && eventDate <= weekEnd;
            })
            .sort((a: any, b: any) => (a.start as Date).getTime() - (b.start as Date).getTime());
    }, [events, weekStart, weekEnd]);

    const weeklyCompleted = useMemo(() => weeklyEvents.filter((event: any) => event?.resource && !(event.resource as CalendarEvent).is_planned), [weeklyEvents]);
    const weeklyTotals = useMemo(() => {
        let totalDistanceKm = 0;
        let totalDurationMin = 0;
        let totalLoad = 0;
        weeklyCompleted.forEach((event: any) => {
            const resource = event.resource as CalendarEvent;
            totalDistanceKm += resource.distance || 0;
            totalDurationMin += resource.duration || 0;
            totalLoad += resource.training_load || 0;
        });
        return { totalDistanceKm, totalDurationMin, totalLoad };
    }, [weeklyCompleted]);

    const formatPaceFromSpeed = (speed?: number | null) => {
        if (!speed || speed <= 0) return '-';
        const paceDecimal = 1000 / (speed * 60);
        const mins = Math.floor(paceDecimal);
        const secs = Math.round((paceDecimal - mins) * 60);
        return `${mins}:${secs.toString().padStart(2, '0')}/km`;
    };

    const isCyclingSport = (sport?: string) => {
        const token = (sport || '').toLowerCase();
        return token.includes('cycl') || token.includes('bike') || token.includes('ride') || token.includes('virtual');
    };

    const [monthlyOpenSignal, setMonthlyOpenSignal] = useState(0);

    const handleMonthlyTotalsOpen = useCallback(() => {
        setMonthlyOpenSignal((prev) => prev + 1);
    }, []);

    const athleteOptions = useMemo(() => (athletes || []).map((athlete: any) => ({
        value: athlete.id.toString(),
        label: athlete.profile?.first_name
            ? `${athlete.profile.first_name} ${athlete.profile.last_name || ''}`.trim()
            : athlete.email
    })), [athletes]);

    const applyZoneDelta = (value: string | undefined, delta: number) => {
        if (!value || delta === 0) return value;
        const match = value.match(/(\d+)/);
        if (!match) return value;
        const nextZone = Math.max(1, Math.min(7, Number(match[1]) + delta));
        return value.replace(match[1], String(nextZone));
    };

    const applyBulkEdit = async () => {
        if (!bulkWeekKey) return;
        const weekStart = parseDate(bulkWeekKey);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        const selectedAthleteId = bulkAthleteScope !== 'all' ? Number(bulkAthleteScope) : null;
        const targetEvents = events
            .map((row: any) => row?.resource as CalendarEvent)
            .filter((row: CalendarEvent | undefined): row is CalendarEvent => Boolean(row && row.date))
            .filter((row: CalendarEvent) => {
                if (!row.is_planned || !row.id) return false;
                const eventDate = parseDate(row.date);
                if (eventDate < weekStart || eventDate > weekEnd) return false;
                if (selectedAthleteId && row.user_id !== selectedAthleteId) return false;
                return true;
            });

        if (targetEvents.length === 0) {
            setSaveError('No planned workouts matched this week and scope. Try a different week or athlete filter.');
            return;
        }

        setBulkApplying(true);
        try {
            await Promise.all(targetEvents.map(async (row: CalendarEvent) => {
                const originalDate = parseDate(row.date);
                const shiftedDate = new Date(originalDate);
                shiftedDate.setDate(originalDate.getDate() + bulkShiftDays);
                const nextDuration = Math.max(5, Math.round((row.planned_duration || 30) * (bulkDurationScale / 100)));
                const payload: Partial<CalendarEvent> = {
                    date: format(shiftedDate, 'yyyy-MM-dd'),
                    planned_duration: nextDuration,
                    planned_intensity: applyZoneDelta(row.planned_intensity, bulkZoneDelta),
                    title: applyZoneDelta(row.title, bulkZoneDelta)
                };
                await api.patch(`/calendar/${row.id}`, payload);
            }));

            await queryClient.invalidateQueries({ queryKey: ['calendar'] });
            setBulkEditOpened(false);
            setSaveError(null);
        } catch {
            setSaveError('Bulk edit did not fully apply. Nothing is lost — please retry once, then adjust manually if needed.');
        } finally {
            setBulkApplying(false);
        }
    };

    const activeAthlete = selectedEvent.user_id ? athleteById.get(selectedEvent.user_id) : undefined;
    const athleteProfile = activeAthlete?.profile || me?.profile;
    const athleteName = activeAthlete
        ? (activeAthlete.profile?.first_name
            ? `${activeAthlete.profile.first_name} ${activeAthlete.profile.last_name || ''}`.trim()
            : activeAthlete.email)
        : (me?.profile?.first_name ? `${me.profile.first_name} ${me.profile.last_name || ''}`.trim() : me?.email);

    const handleCloseDayModal = useCallback(() => {
        setDayCreateError(null);
        setSelectedDateRange(null);
        closeDayModal();
    }, [closeDayModal]);

    const upcomingRacesNode = useMemo(() => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const races = (calendarSeasonPlan?.goal_races || [])
            .filter((r: any) => r.date >= today)
            .sort((a: any, b: any) => a.date.localeCompare(b.date))
            .slice(0, 2);
        if (!races.length) return null;
        return (
            <Group gap={6} wrap="nowrap">
                {races.map((race: any, idx: number) => (
                    <UpcomingRacePill key={idx} race={race} idx={idx} isDark={isDark} />
                ))}
            </Group>
        );
    }, [calendarSeasonPlan, isDark]);

    return (
        <Stack
            p={isMobileViewport ? 6 : 10}
            gap={0}
            h="100%"
            bg={palette.background}
            maw={2480}
            mx="auto"
            w="100%"
            style={{ overflow: 'hidden', minHeight: 0 }}
        >
            <CalendarHeader
                date={viewDate}
                onNavigate={setViewDate}
                currentView={currentView}
                onViewChange={setCurrentView}
                monthlyTotalsLabel={monthlyHeaderLabel}
                onMonthlyTotalsClick={handleMonthlyTotalsOpen}
                actionButtons={upcomingRacesNode ?? actionButtons}
            />
            
            <Group align="stretch" gap={8} wrap={isMobileViewport ? 'wrap' : 'nowrap'} style={{ flex: 1, minHeight: 0 }}>
                {currentView === 'week' ? (
                    <Box style={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 0,
                        padding: isMobileViewport ? 6 : 10,
                        overflowY: 'auto',
                        border: `1px solid ${palette.headerBorder}`,
                        borderRadius: 12,
                        overflow: 'hidden',
                        background: palette.panelBg,
                        backdropFilter: 'blur(14px)',
                        height: '100%',
                        boxShadow: isDark ? '0 28px 56px -40px rgba(15, 23, 42, 0.9)' : '0 28px 56px -44px rgba(15, 23, 42, 0.45)',
                    }}>
                        {isInitialCalendarLoading ? (
                            <CalendarWeekSkeleton />
                        ) : (
                        <Stack gap="sm">
                            <Paper withBorder p="sm" radius="md" bg={palette.cardBg} style={{ borderColor: palette.cardBorder }}>
                                <Group justify="space-between" align="center">
                                    <Text size="xs" fw={800} c={palette.textDim} style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                        {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d')}
                                    </Text>
                                    <Text size="sm" fw={800} c={palette.textMain}>
                                        {weeklyTotals.totalDistanceKm.toFixed(1)} km / {formatTotalMinutes(weeklyTotals.totalDurationMin)}{weeklyTotals.totalLoad > 0 ? ` / ${weeklyTotals.totalLoad.toFixed(0)} TL` : ''}
                                    </Text>
                                </Group>
                            </Paper>

                            {weeklyEvents.length === 0 && !eventsFetching ? (
                                <Paper withBorder p="md" radius="md" bg={palette.cardBg} style={{ borderColor: palette.cardBorder }}>
                                    <Text size="sm" c={palette.textDim}>{t('No activities for this week.') || 'No activities for this week.'}</Text>
                                </Paper>
                            ) : weeklyEvents.length === 0 ? null : (
                                weeklyEvents.map((event: any) => {
                                    const resource = event.resource as CalendarEvent;
                                    const accent = resolveActivityAccentColor(activityColors as any, resource.sport_type, resource.title);
                                    const durationText = formatTotalMinutes(resource.is_planned ? (resource.planned_duration || 0) : (resource.duration || 0));
                                    const distanceKm = resource.is_planned ? (resource.planned_distance || 0) : (resource.distance || 0);
                                    const metricText = resource.is_planned
                                        ? (resource.planned_intensity || '-')
                                        : isCyclingSport(resource.sport_type)
                                            ? `${resource.avg_watts ? Math.round(resource.avg_watts) : '-'} W`
                                            : formatPaceFromSpeed(resource.avg_speed);
                                    const hrText = resource.is_planned
                                        ? null
                                        : `${resource.avg_hr ? Math.round(resource.avg_hr) : '-'} bpm`;

                                    return (
                                        <Paper
                                            key={`${resource.id || resource.date}-${resource.title}`}
                                            withBorder
                                            p="sm"
                                            radius="md"
                                            bg={palette.cardBg}
                                            style={{ borderColor: palette.cardBorder, borderLeft: `4px solid ${accent}`, cursor: 'pointer' }}
                                            onClick={() => handleSelectEvent(event)}
                                        >
                                            <Group justify="space-between" align="center" wrap="nowrap" mb={4}>
                                                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                                                    <Text fw={800} size={isMobileViewport ? 'md' : 'lg'} c={palette.textMain} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {resource.title}
                                                    </Text>
                                                    <Badge size="sm" variant="light" color={resource.is_planned ? 'violet' : 'gray'}>
                                                        {resource.is_planned ? 'PLANNED' : 'COMPLETED'}
                                                    </Badge>
                                                </Group>
                                                <Text fw={800} size={isMobileViewport ? 'lg' : 'xl'} c={palette.textDim}>
                                                    {durationText}
                                                </Text>
                                            </Group>
                                            <Text size={isMobileViewport ? 'sm' : 'md'} c={palette.textDim}>
                                                {distanceKm > 0 ? `${distanceKm.toFixed(1)}km` : '-'} · {metricText}{hrText ? ` · ${hrText}` : ''}
                                            </Text>
                                            {resource.is_planned && resource.planning_context?.phase && (
                                                <Text size="xs" c={palette.textDim}>
                                                    {resource.planning_context.phase.toUpperCase()}
                                                    {resource.planning_context.countdown_days != null ? ` · ${resource.planning_context.countdown_days}d` : ''}
                                                    {resource.planning_context.anchor_race?.name ? ` · ${resource.planning_context.anchor_race.name}` : ''}
                                                </Text>
                                            )}
                                            {resource.is_planned && resource.created_by_name && (
                                                <Text size="xs" c={palette.textDim}>Created by {resource.created_by_name}</Text>
                                            )}
                                        </Paper>
                                    );
                                })
                            )}
                        </Stack>
                        )}
                    </Box>
                ) : (
                    !isMobileViewport ? (
                        <TrainingCalendarZoneSummaryPanel
                            monthlyOpenSignal={monthlyOpenSignal}
                            zoneSummary={zoneSummary}
                            events={events}
                            weeksInMonth={weeksInMonth}
                            weekRowHeights={weekRowHeights}
                            palette={palette}
                            isDark={isDark}
                            activityColors={activityColors}
                            athletes={athletes}
                            me={me}
                            athleteId={athleteId}
                            allAthletes={allAthletes}
                            monthStart={monthStart}
                            monthEnd={monthEnd}
                            weekStartDay={weekStartDay}
                            weekdayHeaderHeight={WEEKDAY_HEADER_HEIGHT}
                            panelWidth={WEEKLY_TOTALS_PANEL_WIDTH}
                            gridScrollRef={gridScrollRef}
                            isLoading={isInitialCalendarLoading}
                        >
                            {({ renderWeekRow, headerContent }) => (
                                <Box ref={monthGridRef} style={{
                                    flex: 1,
                                    minWidth: 0,
                                    minHeight: 0,
                                    border: `1px solid ${palette.headerBorder}`,
                                    borderRadius: 12,
                                    overflow: 'hidden',
                                    background: palette.panelBg,
                                    backdropFilter: 'blur(14px)',
                                    height: '100%',
                                    boxShadow: isDark ? '0 28px 56px -40px rgba(15, 23, 42, 0.9)' : '0 28px 56px -44px rgba(15, 23, 42, 0.45)',
                                }}>
                                    {isInitialCalendarLoading ? (
                                        <CalendarMonthSkeleton />
                                    ) : (
                                        <ContinuousCalendarGrid
                                            viewDate={viewDate}
                                            onViewDateChange={setViewDate}
                                            weekStartDay={weekStartDay}
                                            events={events}
                                            visibleWeeks={visibleWeekCount}
                                            palette={palette}
                                            isDark={isDark}
                                            activityColors={activityColors}
                                            preferredUnits={me?.profile?.preferred_units}
                                            planningMarkersByDate={planningMarkersByDate}
                                            buildPlanningMarkerVisual={buildPlanningMarkerVisual}
                                            onSelectEvent={handleSelectEvent}
                                            onSelectSlot={handleSlotSelection}
                                            onEventDrop={onEventDrop}
                                            onDropFromOutside={onDropFromOutside}
                                            canEditWorkouts={canEditWorkouts}
                                            gridRef={monthGridRef}
                                            scrollContainerRef={gridScrollRef}
                                            onWeekRowHeights={setWeekRowHeights}
                                            onVisibleWeeks={setContinuousVisibleWeeks}
                                            selectedDateRange={selectedDateRange}
                                            isMobile={isMobileViewport}
                                            weekSuffixWidth={WEEKLY_TOTALS_PANEL_WIDTH}
                                            weekSuffixHeader={headerContent}
                                            renderWeekSuffix={(week, idx) => renderWeekRow(week as any, idx)}
                                            notesByDate={notesByDate}
                                        />
                                    )}
                                </Box>
                            )}
                        </TrainingCalendarZoneSummaryPanel>
                    ) : (
                        <Box ref={monthGridRef} style={{
                            flex: 1,
                            minWidth: 0,
                            minHeight: 0,
                            border: `1px solid ${palette.headerBorder}`,
                            borderRadius: 12,
                            overflow: 'hidden',
                            background: palette.panelBg,
                            backdropFilter: 'blur(14px)',
                            height: '100%',
                            boxShadow: isDark ? '0 28px 56px -40px rgba(15, 23, 42, 0.9)' : '0 28px 56px -44px rgba(15, 23, 42, 0.45)',
                        }}>
                            {isInitialCalendarLoading ? (
                                <CalendarMonthSkeleton />
                            ) : (
                                <ContinuousCalendarGrid
                                    viewDate={viewDate}
                                    onViewDateChange={setViewDate}
                                    weekStartDay={weekStartDay}
                                    events={events}
                                    visibleWeeks={visibleWeekCount}
                                    palette={palette}
                                    isDark={isDark}
                                    activityColors={activityColors}
                                    preferredUnits={me?.profile?.preferred_units}
                                    planningMarkersByDate={planningMarkersByDate}
                                    buildPlanningMarkerVisual={buildPlanningMarkerVisual}
                                    onSelectEvent={handleSelectEvent}
                                    onSelectSlot={handleSlotSelection}
                                    onEventDrop={onEventDrop}
                                    onDropFromOutside={onDropFromOutside}
                                    canEditWorkouts={canEditWorkouts}
                                    gridRef={monthGridRef}
                                    scrollContainerRef={gridScrollRef}
                                    onWeekRowHeights={setWeekRowHeights}
                                    onVisibleWeeks={setContinuousVisibleWeeks}
                                    selectedDateRange={selectedDateRange}
                                    isMobile={isMobileViewport}
                                    notesByDate={notesByDate}
                                />
                            )}
                        </Box>
                    )
                )}
            </Group>
            
            <DayDetailsModal
                opened={dayModalOpen}
                onClose={handleCloseDayModal}
                selectedDayTitle={selectedDayTitle}
                dayEvents={dayEvents}
                selectedDateRange={selectedDateRange}
                planningMarkersByDate={planningMarkersByDate}
                isDark={isDark}
                activityColors={activityColors}
                palette={palette}
                athleteId={athleteId}
                viewDate={viewDate}
                onPlannedSelect={(event: CalendarEvent) => {
                    setSelectedEvent(event);
                    open();
                }}
                onDownloadPlannedWorkout={handleDownloadPlannedWorkout}
                onDuplicateSelect={(event: CalendarEvent) => {
                    const res = event;
                    setDuplicateModalActivity({
                        id: res.id!,
                        filename: res.title,
                        sport: res.sport_type ?? null,
                        created_at: res.date,
                        distance: res.distance != null ? res.distance * 1000 : null,
                        duration: res.duration != null ? res.duration * 60 : null,
                        avg_speed: res.avg_speed ?? null,
                        average_hr: res.avg_hr ?? null,
                        average_watts: res.avg_watts ?? null,
                        athlete_id: res.user_id!,
                        duplicate_recordings_count: res.duplicate_recordings_count ?? null,
                        duplicate_of_id: null,
                    });
                }}
                coachNeedsAthleteSelection={coachNeedsAthleteSelection}
                athleteOptions={athleteOptions}
                selectedEvent={selectedEvent}
                setSelectedEvent={setSelectedEvent}
                setDayCreateError={setDayCreateError}
                quickWorkout={quickWorkout}
                setQuickWorkout={setQuickWorkout}
                canEditWorkouts={canEditWorkouts}
                ensureAthleteSelectedForCreate={ensureAthleteSelectedForCreate}
                onQuickPlanningAction={handleQuickPlanningAction}
                planningActionPending={planningActionMutation.isPending}
                onSeasonPlanItemUpdate={handleSeasonPlanItemUpdate}
                seasonPlanUpdatePending={seasonPlanUpdateMutation.isPending}
                calendarSeasonPlan={calendarSeasonPlan}
                onOpenWorkoutBuilder={open}
                onCreateQuickWorkout={handleCreateQuickWorkout}
                onCreateTextWorkout={handleCreateTextWorkout}
                textWorkoutInput={textWorkoutInput}
                setTextWorkoutInput={setTextWorkoutInput}
                onCreateRestDay={handleCreateRestDay}
                onLibrarySelect={handleLibrarySelect}
                dayCreateError={dayCreateError}
            />

            <BulkEditModal
                opened={bulkEditOpened}
                onClose={() => setBulkEditOpened(false)}
                weeksInMonth={weeksInMonth}
                bulkWeekKey={bulkWeekKey}
                setBulkWeekKey={setBulkWeekKey}
                athleteOptions={athleteOptions}
                bulkAthleteScope={bulkAthleteScope}
                setBulkAthleteScope={setBulkAthleteScope}
                bulkShiftDays={bulkShiftDays}
                setBulkShiftDays={setBulkShiftDays}
                bulkDurationScale={bulkDurationScale}
                setBulkDurationScale={setBulkDurationScale}
                bulkZoneDelta={bulkZoneDelta}
                setBulkZoneDelta={setBulkZoneDelta}
                bulkApplying={bulkApplying}
                onApply={() => void applyBulkEdit()}
            />

            <WorkoutEditModal
                opened={opened}
                onClose={close}
                selectedEvent={selectedEvent}
                saveError={saveError}
                athleteOptions={athleteOptions}
                setSelectedEvent={setSelectedEvent}
                athleteName={athleteName}
                athleteProfile={athleteProfile}
                canDeleteWorkouts={canDeleteWorkouts}
                canEditWorkouts={canEditWorkouts}
                deleteMutation={deleteMutation}
                handleSave={handleSave}
            />

            <DuplicateSelectModal
                activity={duplicateModalActivity}
                onClose={() => setDuplicateModalActivity(null)}
                isDark={isDark}
                formatDistance={(m) => `${(m / 1000).toFixed(2)} km`}
                formatDurationHm={(s) => {
                    if (!s || s <= 0) return '-';
                    const h = Math.floor(s / 3600);
                    const m = Math.floor((s % 3600) / 60);
                    return h > 0 ? `${h}h ${m}m` : `${m}m`;
                }}
                onNavigate={(id) => { setDuplicateModalActivity(null); navigate(`/dashboard/activities/${id}`); }}
            />
        </Stack>
    );
};

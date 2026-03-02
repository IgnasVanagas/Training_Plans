import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { format, parse, startOfWeek, getDay, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { Group, Stack, Text, Box, useComputedColorScheme, Paper, Badge } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useMediaQuery } from '@mantine/hooks';
import { useNavigate } from 'react-router-dom';
import CalendarHeader from './calendar/CalendarHeader';
import { parseDate } from './calendar/dateUtils';
import { ORIGAMI_ACTIVITY_COLORS, ORIGAMI_THEME } from './calendar/theme';
import { CalendarEventCard } from './calendar/TrainingCalendarEventRenderers';
import { resolveActivityAccentColor } from './calendar/activityStyling';
import { BulkEditModal, DayDetailsModal, WorkoutEditModal } from './calendar/TrainingCalendarModals';
import TrainingCalendarZoneSummaryPanel from './calendar/TrainingCalendarZoneSummaryPanel';
import { buildTrainingCalendarStyles } from './calendar/trainingCalendarStyles';
import OrigamiLoadingAnimation from './common/OrigamiLoadingAnimation';
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
import { readSnapshot, writeSnapshot } from '../utils/localSnapshot';

// Setup Localizer
const locales = {
  'en-US': enUS,
};

// Localizer will be created dynamically inside the component
// const localizer = ...


const DnDCalendar = withDragAndDrop(Calendar);

// Constants for exact alignment
const WEEKDAY_HEADER_HEIGHT = 36;
const WEEKLY_TOTALS_PANEL_WIDTH = 324;

export const TrainingCalendar = ({ athleteId, allAthletes, athletes, initialViewDate }: { athleteId?: number | null, allAthletes?: boolean, athletes?: any[], initialViewDate?: string | null }) => {
    const navigate = useNavigate();
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
    const localizer = useMemo(() => dateFnsLocalizer({
        format,
        parse,
        startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: weekStartDay as any }),
        getDay,
        locales,
    }), [weekStartDay]);

    const [opened, { open, close }] = useDisclosure(false);
    const [selectedEvent, setSelectedEvent] = useState<Partial<CalendarEvent>>({ sport_type: 'Cycling' });
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
        const parsed = new Date(initialViewDate);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }, [initialViewDate]);

    const [viewDate, setViewDate] = useState(parsedInitialViewDate || new Date());
    const [currentView, setCurrentView] = useState<'month' | 'week'>(isMobileViewport ? 'week' : 'month');
    const monthGridRef = React.useRef<HTMLDivElement | null>(null);
    const [weekRowHeights, setWeekRowHeights] = useState<number[]>([]);

    const athleteById = useMemo(() => {
        const map = new Map<number, any>();
        (athletes || []).forEach((athlete: any) => {
            map.set(athlete.id, athlete);
        });
        return map;
    }, [athletes]);

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

    const rangeBounds = useMemo(() => {
        if (currentView === 'week') {
            return {
                start: startOfWeek(viewDate, { weekStartsOn: weekStartDay as any }),
                end: endOfWeek(viewDate, { weekStartsOn: weekStartDay as any }),
            };
        }

        const monthStartVisible = startOfWeek(startOfMonth(viewDate), { weekStartsOn: weekStartDay as any });
        const monthEndVisible = endOfWeek(endOfMonth(viewDate), { weekStartsOn: weekStartDay as any });
        return {
            start: monthStartVisible,
            end: monthEndVisible,
        };
    }, [currentView, viewDate, weekStartDay]);

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

    const { data: events = [], isLoading: eventsLoading, isFetching: eventsFetching } = useQuery({
        queryKey: ['calendar', currentView, format(rangeBounds.start, 'yyyy-MM-dd'), format(rangeBounds.end, 'yyyy-MM-dd'), athleteId, allAthletes],
        initialData: () => {
            const snapKey = `calendar:${currentView}:${format(rangeBounds.start, 'yyyy-MM-dd')}:${format(rangeBounds.end, 'yyyy-MM-dd')}:${athleteId || 'self'}:${allAthletes ? 'all' : 'single'}`;
            const snap = readSnapshot<any[]>(snapKey) || [];
            return snap
                .map(normalizeCalendarEvent)
                .filter((event): event is any => Boolean(event));
        },
        queryFn: async () => {
            const rows = await fetchEvents(rangeBounds.start, rangeBounds.end);
            const safeRows = rows
                .map(normalizeCalendarEvent)
                .filter((event): event is any => Boolean(event));
            const snapKey = `calendar:${currentView}:${format(rangeBounds.start, 'yyyy-MM-dd')}:${format(rangeBounds.end, 'yyyy-MM-dd')}:${athleteId || 'self'}:${allAthletes ? 'all' : 'single'}`;
            writeSnapshot(snapKey, safeRows);
            return safeRows;
        },
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 30,
        placeholderData: (prev) => prev,
        refetchOnMount: 'always',
    });

    const isInitialCalendarLoading = (eventsLoading || eventsFetching) && events.length === 0;

    const calendarEvents = useMemo(() => {
        if (currentView === 'week') {
            return events;
        }

        const byDate = new Map<string, any[]>();
        events.forEach((event: any) => {
            const dateKey = event.resource?.date;
            if (!dateKey) return;
            const list = byDate.get(dateKey) || [];
            list.push(event);
            byDate.set(dateKey, list);
        });

        const limited: any[] = [];
        byDate.forEach((dateEvents, dateKey) => {
            if (dateEvents.length <= 2) {
                limited.push(...dateEvents);
                return;
            }

            const first = dateEvents[0];
            const hiddenCount = dateEvents.length - 1;
            const dayDate = parseDate(dateKey);

            limited.push(first);
            limited.push({
                id: `more-${dateKey}`,
                title: `+${hiddenCount}`,
                start: dayDate,
                end: dayDate,
                allDay: true,
                resource: {
                    id: -1,
                    date: dateKey,
                    title: `+${hiddenCount}`,
                    is_planned: false,
                    is_more_indicator: true,
                    hidden_count: hiddenCount,
                } as CalendarEvent,
            });
        });

        return limited;
    }, [events, currentView]);

    const { data: zoneSummary } = useQuery({
        queryKey: ['zone-summary', format(viewDate, 'yyyy-MM-dd'), athleteId, allAthletes, weekStartDay],
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
            return res.data;
        },
        staleTime: 1000 * 60,
    });

    const createMutation = useMutation({
        mutationFn: (newWorkout: CalendarEvent) => {
             let url = '/calendar/';
             // Prioritize the user_id set in the form (Dropdown), fall back to prop athleteId
             const targetId = newWorkout.user_id || athleteId;
             if (targetId) url += `?athlete_id=${targetId}`;
             return api.post(url, newWorkout);
        },
        onSuccess: () => {
             queryClient.invalidateQueries({ queryKey: ['calendar'] });
             close();
        }
    });

    const updateMutation = useMutation({
        mutationFn: (vars: { id: number, data: Partial<CalendarEvent> }) => api.patch(`/calendar/${vars.id}`, vars.data),
        onSuccess: () => {
             queryClient.invalidateQueries({ queryKey: ['calendar'] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id: number) => api.delete(`/calendar/${id}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
            close();
        }
    });

    const onEventDrop = useCallback(async ({ event, start }: any) => {
        if (!canEditWorkouts) return;
        const dateStr = format(start, 'yyyy-MM-dd');
        // Prevent moving completed activities for now? Or allow?
        // Let's allow if the backend supports it (Activity update), but currently backend only supports PlannedWorkout update.
        // So check is_planned
        if (!event.resource.is_planned) return;

        if (event.resource.date !== dateStr && event.resource.id) {
            updateMutation.mutate({ id: event.resource.id, data: { date: dateStr } });
        }
    }, [updateMutation, canEditWorkouts]);

    const [dayEvents, setDayEvents] = useState<CalendarEvent[]>([]);
    const [dayModalOpen, { open: openDayModal, close: closeDayModal }] = useDisclosure(false);
    const [selectedDayTitle, setSelectedDayTitle] = useState("");
    const [dayCreateError, setDayCreateError] = useState<string | null>(null);
    const [quickWorkout, setQuickWorkout] = useState({
        sport_type: 'Cycling',
        zone: 2,
        mode: 'time' as 'time' | 'distance',
        minutes: 45,
        distanceKm: 10
    });

    const handleSelectSlot = useCallback(({ start }: any) => {
        setSelectedEvent({ 
            date: format(start, 'yyyy-MM-dd'),
            sport_type: 'Cycling', 
            planned_duration: 60,
            title: 'New Workout',
            is_planned: true,
            user_id: athleteId || (athletes && athletes.length > 0 ? athletes[0].id : undefined)
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
            setDayCreateError(null);
            openDayModal();
            return;
        }

        if (!event.resource.is_planned) {
            if (event.resource.id) {
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
        if (selectedEvent.id) {
            updateMutation.mutate({ id: selectedEvent.id, data: selectedEvent });
            close();
        } else {
             // Create
             // @ts-ignore
             createMutation.mutate(selectedEvent as CalendarEvent);
        }
    };

     const RealEventComponent = useCallback(({ event }: any) => (
         <CalendarEventCard
            event={event}
            activityColors={activityColors}
            isDark={isDark}
            palette={palette}
            preferredUnits={me?.profile?.preferred_units}
         />
        ), [activityColors, isDark, me?.profile?.preferred_units, palette]);
    const handleSlotSelection = useCallback(({ start }: any) => {
        const dateStr = format(start, 'yyyy-MM-dd');
        const dayEvts = events.filter((e: any) => e.resource.date === dateStr);
        
        setDayEvents(dayEvts.map((e: any) => e.resource));
        setSelectedDayTitle(format(start, 'MMMM do, yyyy'));

        setSelectedEvent({ 
            date: dateStr,
            sport_type: 'Cycling', 
            planned_duration: 60,
            title: 'New Workout',
            user_id: athleteId || undefined,
            structure: []
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
    }, [events, openDayModal, athleteId, athletes]);

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
            is_planned: true
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

    const formatTotalMinutes = (minutes: number) => {
        const total = Math.max(0, Math.round(minutes));
        const h = Math.floor(total / 60);
        const m = total % 60;
        return `${h}h ${m}m`;
    };

    const monthStart = useMemo(() => new Date(viewDate.getFullYear(), viewDate.getMonth(), 1), [viewDate]);
    const monthEnd = useMemo(() => new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0), [viewDate]);
    const weekStart = useMemo(() => startOfWeek(viewDate, { weekStartsOn: weekStartDay as any }), [viewDate, weekStartDay]);
    const weekEnd = useMemo(() => endOfWeek(viewDate, { weekStartsOn: weekStartDay as any }), [viewDate, weekStartDay]);

    const weeksInMonth = useMemo(() => {
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
    }, [monthStart, monthEnd, weekStartDay]);

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
        monthlyCompletedEvents.forEach((evt: any) => {
            totalDistanceKm += evt.resource.distance || 0;
            totalDurationMin += evt.resource.duration || 0;
        });
        return { totalDistanceKm, totalDurationMin };
    }, [monthlyCompletedEvents]);

    const monthlyHeaderLabel = useMemo(() => {
        return `${monthlyHeaderMetrics.totalDistanceKm.toFixed(1)} km / ${formatTotalMinutes(monthlyHeaderMetrics.totalDurationMin)}`;
    }, [monthlyHeaderMetrics.totalDistanceKm, monthlyHeaderMetrics.totalDurationMin]);

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
        weeklyCompleted.forEach((event: any) => {
            const resource = event.resource as CalendarEvent;
            totalDistanceKm += resource.distance || 0;
            totalDurationMin += resource.duration || 0;
        });
        return { totalDistanceKm, totalDurationMin };
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

    const measureWeekRowHeights = useCallback(() => {
        if (currentView !== 'month') {
            setWeekRowHeights([]);
            return;
        }

        const host = monthGridRef.current;
        if (!host) return;

        const rows = Array.from(host.querySelectorAll('.rbc-month-row')) as HTMLElement[];
        if (rows.length === 0) {
            setWeekRowHeights([]);
            return;
        }

        const nextHeights = rows.map((row) => Math.round(row.getBoundingClientRect().height));
        setWeekRowHeights((prev) => {
            const sameLength = prev.length === nextHeights.length;
            const sameValues = sameLength && prev.every((value, index) => Math.abs(value - nextHeights[index]) <= 1);
            return sameValues ? prev : nextHeights;
        });
    }, [currentView]);

    useEffect(() => {
        if (currentView !== 'month' || isInitialCalendarLoading) {
            return;
        }

        const frame = window.requestAnimationFrame(measureWeekRowHeights);
        const host = monthGridRef.current;
        if (!host) {
            return () => window.cancelAnimationFrame(frame);
        }

        const observer = new ResizeObserver(() => {
            measureWeekRowHeights();
        });

        observer.observe(host);
        const monthView = host.querySelector('.rbc-month-view') as HTMLElement | null;
        if (monthView) {
            observer.observe(monthView);
        }

        const handleResize = () => measureWeekRowHeights();
        window.addEventListener('resize', handleResize);

        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', handleResize);
            observer.disconnect();
        };
    }, [
        currentView,
        isInitialCalendarLoading,
        viewDate,
        calendarEvents.length,
        isMobileViewport,
        measureWeekRowHeights,
    ]);

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

    // Custom Date Header for Calendar Cells
    const CustomDateHeader = useCallback(({ date }: { date: Date, label: string }) => {
        const isToday = date.toDateString() === new Date().toDateString();
        return (
            <Group justify="space-between" align="flex-start" p={4} h="100%">
                 <Text 
                    size="xs" 
                    fw={700}
                    style={{
                        color: isToday ? activityColors.default : palette.textDim,
                        opacity: isToday ? 1 : 0.72,
                        transition: 'color 0.2s ease',
                        cursor: 'default'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.color = palette.textMain;
                        e.currentTarget.style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.color = isToday ? activityColors.default : palette.textDim;
                        e.currentTarget.style.opacity = isToday ? '1' : '0.72';
                    }}
                >
                    {format(date, 'MMM d').toUpperCase()}
                </Text>
            </Group>
        );
    }, [activityColors.default, palette.textDim, palette.textMain]);

    const calendarComponents = useMemo(() => ({
        event: RealEventComponent,
        month: {
            dateHeader: CustomDateHeader,
        }
    }), [CustomDateHeader, RealEventComponent]);

    const emptyDayPropGetter = useCallback(() => ({ style: {} }), []);

    const calendarStyles = useMemo(() => buildTrainingCalendarStyles({
        isDark,
        weekdayHeaderHeight: WEEKDAY_HEADER_HEIGHT,
        palette,
    }), [isDark, palette]);

    return (
        <Stack
            p={isMobileViewport ? 6 : 10}
            gap={0}
            h={isMobileViewport ? 'auto' : 'calc(100vh - 132px)'}
            bg={palette.background}
            maw={2480}
            mx="auto"
            w="100%"
            style={{ overflow: isMobileViewport ? 'visible' : 'hidden' }}
        >
            <style>{calendarStyles}</style>
            
            <CalendarHeader
                date={viewDate}
                onNavigate={setViewDate}
                currentView={currentView}
                onViewChange={setCurrentView}
                monthlyTotalsLabel={monthlyHeaderLabel}
                onMonthlyTotalsClick={handleMonthlyTotalsOpen}
                monthlyTotalsWidth={WEEKLY_TOTALS_PANEL_WIDTH}
            />
            
            <Group align="stretch" gap={8} wrap={isMobileViewport ? 'wrap' : 'nowrap'} style={{ flex: 1, minHeight: 0 }}>
                {currentView === 'week' ? (
                    <Box className="calendar-grid-wrapper" style={{ flex: 1, minWidth: 0, padding: isMobileViewport ? 6 : 10, overflowY: 'auto' }}>
                        {isInitialCalendarLoading ? (
                            <Paper withBorder p="md" radius="md" bg={palette.cardBg} style={{ borderColor: palette.cardBorder }}>
                                <OrigamiLoadingAnimation label="Loading calendar..." minHeight={300} />
                            </Paper>
                        ) : (
                        <Stack gap="sm">
                            <Paper withBorder p="sm" radius="md" bg={palette.cardBg} style={{ borderColor: palette.cardBorder }}>
                                <Group justify="space-between" align="center">
                                    <Text size="xs" fw={800} c={palette.textDim} style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                        {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d')}
                                    </Text>
                                    <Text size="sm" fw={800} c={palette.textMain}>
                                        {weeklyTotals.totalDistanceKm.toFixed(1)} km / {formatTotalMinutes(weeklyTotals.totalDurationMin)}
                                    </Text>
                                </Group>
                            </Paper>

                            {weeklyEvents.length === 0 ? (
                                <Paper withBorder p="md" radius="md" bg={palette.cardBg} style={{ borderColor: palette.cardBorder }}>
                                    <Text size="sm" c={palette.textDim}>No activities for this week.</Text>
                                </Paper>
                            ) : (
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
                    <>
                        <Box ref={monthGridRef} className="calendar-grid-wrapper" style={{ flex: 1, minWidth: 0, overflowX: isMobileViewport ? 'auto' : 'hidden' }}>
                            {isInitialCalendarLoading ? (
                                <Paper withBorder p="md" radius="md" bg={palette.cardBg} style={{ borderColor: palette.cardBorder, margin: 10 }}>
                                    <OrigamiLoadingAnimation label="Loading calendar..." minHeight={360} />
                                </Paper>
                            ) : (
                                <Box style={{ minWidth: isMobileViewport ? 760 : 0 }}>
                                    <DnDCalendar
                                        localizer={localizer}
                                        events={calendarEvents}
                                        startAccessor={(e: any) => e.start}
                                        endAccessor={(e: any) => e.end}
                                        onEventDrop={onEventDrop}
                                        selectable
                                        onSelectSlot={handleSlotSelection}
                                        onSelectEvent={handleSelectEvent}
                                        views={[Views.MONTH]}
                                        defaultView={Views.MONTH}
                                        toolbar={false}
                                        onNavigate={(date) => setViewDate(date)}
                                        date={viewDate}
                                        popup
                                        components={calendarComponents}
                                        dayPropGetter={emptyDayPropGetter}
                                    />
                                </Box>
                            )}
                        </Box>
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
                        />
                    </>
                )}
            </Group>
            
            <DayDetailsModal
                opened={dayModalOpen}
                onClose={closeDayModal}
                selectedDayTitle={selectedDayTitle}
                dayEvents={dayEvents}
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
                coachNeedsAthleteSelection={coachNeedsAthleteSelection}
                athleteOptions={athleteOptions}
                selectedEvent={selectedEvent}
                setSelectedEvent={setSelectedEvent}
                setDayCreateError={setDayCreateError}
                quickWorkout={quickWorkout}
                setQuickWorkout={setQuickWorkout}
                canEditWorkouts={canEditWorkouts}
                ensureAthleteSelectedForCreate={ensureAthleteSelectedForCreate}
                onOpenWorkoutBuilder={open}
                onCreateQuickWorkout={handleCreateQuickWorkout}
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
        </Stack>
    );
};

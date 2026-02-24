import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Calendar, dateFnsLocalizer, Views, Event as RBCEvent } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { format, parse, startOfWeek, getDay, endOfWeek } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { Alert, Modal, Button, Select, Group, Stack, Text, Badge, Paper, Container, NumberInput, Divider, Box, Progress, SegmentedControl, useComputedColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { DatePickerInput } from '@mantine/dates';
import { Activity, AlertCircle, CheckCircle, Check, Circle, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WorkoutEditor } from './builder/WorkoutEditor';
import { WorkoutNode, ConcreteStep } from '../types/workout';
import CalendarHeader from './calendar/CalendarHeader';
import { parseDate, formatMinutesHm } from './calendar/dateUtils';
import { resolveActivityAccentColor, resolveActivityBrandType, resolveActivityPillLabel, resolveWeekAccentColor } from './calendar/activityStyling';
import { ORIGAMI_ACTIVITY_COLORS, ORIGAMI_THEME } from './calendar/theme';
import SportIcon from './calendar/SportIcon';

// Setup Localizer
const locales = {
  'en-US': enUS,
};

// Localizer will be created dynamically inside the component
// const localizer = ...


const DnDCalendar = withDragAndDrop(Calendar);

interface CalendarEvent {
    id?: number;
    user_id?: number;
    title: string;
    date: string; // YYYY-MM-DD
    sport_type?: string; // 'Cycling' | 'Running' etc
    planned_duration?: number; // minutes
    planned_distance?: number;
    planned_intensity?: string;
    description?: string;
    compliance_status?: 'planned' | 'completed_green' | 'completed_yellow' | 'completed_red' | 'missed';
    matched_activity_id?: number;
    structure?: WorkoutNode[];
    
    // New fields
    is_planned?: boolean;
    duration?: number; // minutes for both
    distance?: number; // km for both
    avg_hr?: number;
    avg_watts?: number;
    avg_speed?: number;
}

interface ZoneSportSummary {
    activities_count: number;
    total_duration_minutes: number;
    total_distance_km: number;
    zone_seconds: Record<string, number>;
    zone_seconds_by_metric?: Record<string, Record<string, number>>;
}

interface ZoneBucketSummary {
    activities_count: number;
    total_duration_minutes: number;
    total_distance_km: number;
    sports: {
        running: ZoneSportSummary;
        cycling: ZoneSportSummary;
    };
}

interface AthleteZoneSummary {
    athlete_id: number;
    athlete_email?: string;
    weekly: ZoneBucketSummary;
    monthly: ZoneBucketSummary;
    weekly_activity_zones: ActivityZoneSummary[];
    monthly_activity_zones: ActivityZoneSummary[];
}

interface ActivityZoneSummary {
    activity_id: number;
    date: string;
    sport: 'running' | 'cycling' | string;
    title: string;
    duration_minutes: number;
    distance_km: number;
    zone_seconds: Record<string, number>;
    zone_seconds_by_metric?: Record<string, Record<string, number>>;
}

interface ZoneSummaryResponse {
    reference_date: string;
    week: { start_date: string; end_date: string };
    month: { start_date: string; end_date: string };
    athletes: AthleteZoneSummary[];
}

interface AthletePermissionsResponse {
    athlete_id: number;
    permissions: {
        allow_delete_activities: boolean;
        allow_delete_workouts: boolean;
        allow_edit_workouts: boolean;
    };
}

const StatusBadge = ({ status }: { status?: string }) => {
    if (!status || status === 'planned') return <Badge color="gray" variant="light" size="xs">Planned</Badge>;
    if (status === 'missed') return <Badge color="red" variant="filled" size="xs">Missed</Badge>;
    if (status === 'completed_green') return <Badge color="green" variant="filled" size="xs">Compliant</Badge>;
    if (status === 'completed_yellow') return <Badge color="yellow" variant="filled" size="xs">Deviated</Badge>;
    if (status === 'completed_red') return <Badge color="red" variant="filled" size="xs">Non-Compliant</Badge>;
    return null;
};

// Constants for exact alignment
const HEADER_HEIGHT = 40;
const WEEKDAY_HEADER_HEIGHT = 36;

const CustomMonthHeader = ({ label }: { label: string }) => {
    return (
        <Group h="100%" justify="center" align="center">
            <Text size="sm" fw={700}>{label}</Text>
        </Group>
    );
};

export const TrainingCalendar = ({ athleteId, allAthletes, athletes, initialViewDate }: { athleteId?: number | null, allAthletes?: boolean, athletes?: any[], initialViewDate?: string | null }) => {
    const navigate = useNavigate();
    const isDark = useComputedColorScheme('light') === 'dark';
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
    const canDeleteWorkouts = me?.role === 'coach' || Boolean(selfPermissions?.permissions?.allow_delete_workouts);

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

    useEffect(() => {
        if (parsedInitialViewDate) {
            setViewDate(parsedInitialViewDate);
        }
    }, [parsedInitialViewDate]);

    // Fetch Events logic
    const fetchEvents = async (start: Date, end: Date) => {
        const startStr = format(start, 'yyyy-MM-dd');
        const endStr = format(end, 'yyyy-MM-dd');
        let url = `/calendar/?start_date=${startStr}&end_date=${endStr}`;
        if (athleteId) {
            url += `&athlete_id=${athleteId}`;
        } else if (allAthletes) {
            url += `&all_athletes=true`;
        }
        const res = await api.get(url);
        return res.data.map((evt: CalendarEvent) => {
            let title = evt.title;
            if (allAthletes && athletes) {
                const a = athletes.find((u: any) => u.id === evt.user_id);
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
    };

    // Calculate fetch range based on viewDate (simplification: fetch +/- 1 month)
    // In real app, Calendar's onRangeChange provides bounds
    const startRange = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    const endRange = new Date(viewDate.getFullYear(), viewDate.getMonth() + 2, 0);

    const { data: events = [] } = useQuery({
        queryKey: ['calendar', format(viewDate, 'yyyy-MM'), athleteId, allAthletes], // Added athleteId to queryKey
        queryFn: () => fetchEvents(startRange, endRange)
    });

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
        }
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
    }, [open, navigate, canEditWorkouts]);

    const handleSave = () => {
        if (!canEditWorkouts) {
            return;
        }
        if (!selectedEvent.date) {
            setSaveError('Please set a workout date first. Your draft is safe.');
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

    // Custom Event Renderer
    const EventComponent = ({ event }: any) => {
        const r = event.resource as CalendarEvent;
        // ... (rest of implementation)
        return null; // Will replace below 
    };

    // Replace the null return above with actual implementation since we're replacing the whole block
    const RealEventComponent = ({ event }: any) => {
         const r = event.resource as CalendarEvent;
            const activityType = resolveActivityBrandType(r.sport_type, r.title);
         const accentColor = resolveActivityAccentColor(activityColors, r.sport_type, r.title);
            const isCompleted = !r.is_planned;
            const isPlanned = Boolean(r.is_planned);
            const cardShadow = isDark
                     ? `0 10px 22px -20px ${accentColor}CC`
                     : '0 12px 26px -22px rgba(30, 64, 175, 0.34)';

         const formatDist = (val?: number | null) => {
             if (!val) return '-';
             if (me?.profile?.preferred_units === 'imperial') {
                 return `${(val * 0.621371).toFixed(1)}mi`;
             }
             return `${val.toFixed(1)}km`;
         };

         const formatDuration = (minutes?: number | null) => formatMinutesHm(minutes);

         const formatClockTime = (dt?: Date) => {
             if (!dt) return '';
             const hours = dt.getHours();
             const mins = dt.getMinutes();
             if (hours === 0 && mins === 0) return '';
             return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
         };

         const timeLabel = formatClockTime(event.start);
         const durationLabel = r.is_planned ? formatDuration(r.planned_duration) : formatDuration(r.duration);
         const distanceLabel = r.is_planned ? formatDist(r.planned_distance) : formatDist(r.distance);
         const primaryMetric = (distanceLabel !== '-' && durationLabel !== '-')
            ? `${distanceLabel} / ${durationLabel}`
            : distanceLabel !== '-'
                ? distanceLabel
                : (durationLabel !== '-' ? durationLabel : '—');
         const metricParts = [timeLabel].filter(Boolean);
         const pillBg = isDark ? `${accentColor}24` : `${accentColor}1A`;

         return (
             <Box
                 p="4px 6px"
                 style={{ 
                     backgroundColor: isPlanned ? (isDark ? 'rgba(30, 41, 59, 0.42)' : 'rgba(248, 250, 252, 0.88)') : palette.cardBg,
                     backdropFilter: 'blur(10px)',
                     WebkitBackdropFilter: 'blur(10px)',
                     border: `1px ${isPlanned ? 'dashed' : 'solid'} ${isPlanned ? `${accentColor}77` : palette.cardBorder}`,
                     borderLeft: `3px solid ${accentColor}`,
                     borderRadius: '8px',
                     position: 'relative',
                     overflow: 'hidden',
                     transition: 'all 0.2s ease',
                     cursor: 'pointer',
                     fontFamily: '"Inter", sans-serif',
                     boxShadow: cardShadow,
                     opacity: isPlanned ? 0.9 : 1,
                     minHeight: 28
                 }}
                 onMouseEnter={(e) => {
                     e.currentTarget.style.transform = 'translateY(-1px)';
                     e.currentTarget.style.boxShadow = isDark
                        ? `0 16px 34px -20px ${accentColor}EE`
                        : '0 22px 52px -20px rgba(15, 23, 42, 0.40)';
                     e.currentTarget.style.borderColor = `${accentColor}AA`;
                 }}
                 onMouseLeave={(e) => {
                     e.currentTarget.style.transform = 'none';
                     e.currentTarget.style.boxShadow = cardShadow;
                     e.currentTarget.style.borderColor = isPlanned ? `${accentColor}77` : palette.cardBorder;
                 }}
             >
                 <Group gap={5} wrap="nowrap" align="center" pl={1}>
                    <Box style={{ color: accentColor }}>
                        {isCompleted ? <Check size={14} /> : <Circle size={12} />}
                    </Box>
                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                        <Group justify="space-between" align="center" wrap="nowrap" gap={6}>
                            <Text size="xs" fw={900} c={palette.textMain} style={{ lineHeight: 1.1, letterSpacing: '-0.01em' }}>
                                {primaryMetric}
                            </Text>
                            <Badge
                                size="sm"
                                radius="sm"
                                variant="light"
                                styles={{
                                    root: {
                                        background: pillBg,
                                        color: accentColor,
                                        border: `1px solid ${accentColor}33`,
                                        fontWeight: 700,
                                        textTransform: 'none',
                                        paddingInline: 6,
                                        lineHeight: 1.1
                                    }
                                }}
                            >
                                {resolveActivityPillLabel(r.sport_type, r.title)}
                            </Badge>
                        </Group>
                        <Group gap={5} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
                            <SportIcon sport={r.sport_type || 'Activity'} size={12} />
                            <Text size="10px" fw={700} c={palette.textDim} style={{ opacity: 0.86, textTransform: 'uppercase', letterSpacing: 0.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {r.title || (activityType === 'run' ? 'Run' : 'Session')}
                            </Text>
                            {metricParts.length > 0 && (
                                <Text size="10px" fw={600} c={palette.textDim} style={{ opacity: 0.8, whiteSpace: 'nowrap' }}>
                                    · {metricParts.join(' · ')}
                                </Text>
                            )}
                        </Group>
                    </Stack>
                 </Group>
             </Box>
         );
    }



    // Day Click Modal
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

    // Custom toolbar to likely allow better navigation if needed, 
    // but default is fine. Drilldown is key.
    
    // Override 'onDrillDown' or 'onSelectSlot' with 'day view' navigation disabled preference?
    // User requested: "click on calendar specific date all activities done on that day should pop up"
    // Usually big-calendar drills down to 'Day View' when clicking "Show More" or header.
    // Clicking empty slot -> Select Slot. 
    // We want clicking the CELL itself or navigating to day view to trigger modal?
    // Easiest: onSelectSlot with slot having bounds? OR custom DateCellWrapper?
    
    // Actually, onSelectSlot is called when clicking background.
    // BUT normally it's used for creation. 
    // If we want to show activities, we can merge creation into this "Day Modal" or have separate?
    // User asked "all activities done on that day should pop up".
    
    const handleDayClick = useCallback((date: Date, eventsOnDay: CalendarEvent[]) => {
        setDayEvents(eventsOnDay);
        setSelectedDayTitle(format(date, 'MMMM do, yyyy'));
        openDayModal();
    }, [openDayModal]);
    
    // We can intercept onDrillDown? Or just use onSelectSlot (if slot selection is day).
    // Let's modify onSelectSlot to open a modal that HAS "Add Workout" button AND lists existing events.
    
    const handleSlotSelection = useCallback(({ start, action }: any) => {
        // Find events on this day from the main events list
        const dateStr = format(start, 'yyyy-MM-dd');
        const dayEvts = events.filter((e: any) => e.resource.date === dateStr);
        
        setDayEvents(dayEvts.map((e: any) => e.resource));
        setSelectedDayTitle(format(start, 'MMMM do, yyyy'));
        
        // Also prepare selected event for creation if they choose to add
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

    const formatPaceFromMinutesPerKm = (minutesPerKm: number) => {
        if (!Number.isFinite(minutesPerKm) || minutesPerKm <= 0) return '-';
        const mins = Math.floor(minutesPerKm);
        const secsRaw = Math.round((minutesPerKm - mins) * 60);
        const carry = secsRaw === 60 ? 1 : 0;
        const secs = secsRaw === 60 ? 0 : secsRaw;
        return `${mins + carry}:${secs.toString().padStart(2, '0')}/km`;
    };

    const buildQuickWorkoutZoneDetails = (sportType: string, zone: number, profile: any) => {
        const normalizedSport = (sportType || '').toLowerCase();

        if (normalizedSport.includes('run')) {
            const lt2 = Number(profile?.lt2 || 0);
            if (lt2 > 0) {
                const paceRanges: Array<[number, number]> = [
                    [135, 120],
                    [120, 110],
                    [110, 103],
                    [103, 97],
                    [97, 90],
                    [90, 84],
                    [84, 75]
                ];
                const idx = Math.max(1, Math.min(paceRanges.length, zone)) - 1;
                const [slowPct, fastPct] = paceRanges[idx];
                const slow = formatPaceFromMinutesPerKm((lt2 * slowPct) / 100);
                const fast = formatPaceFromMinutesPerKm((lt2 * fastPct) / 100);
                return `Pace ${slow}-${fast}`;
            }

            const maxHr = Number(profile?.max_hr || 0);
            if (maxHr > 0) {
                const hrRanges: Array<[number, number]> = [
                    [50, 60],
                    [60, 70],
                    [70, 80],
                    [80, 90],
                    [90, 95],
                    [95, 100]
                ];
                const idx = Math.max(1, Math.min(hrRanges.length, zone)) - 1;
                const [low, high] = hrRanges[idx];
                return `HR ${Math.round((maxHr * low) / 100)}-${Math.round((maxHr * high) / 100)} bpm`;
            }

            return '';
        }

        const ftp = Number(profile?.ftp || 0);
        if (ftp > 0) {
            const powerRanges: Array<[number, number]> = [
                [50, 55],
                [56, 75],
                [76, 90],
                [91, 105],
                [106, 120],
                [121, 150],
                [151, 200]
            ];
            const idx = Math.max(1, Math.min(powerRanges.length, zone)) - 1;
            const [low, high] = powerRanges[idx];
            return `Power ${Math.round((ftp * low) / 100)}-${Math.round((ftp * high) / 100)} W`;
        }

        return '';
    };

    const quickWorkoutZoneBounds = (sportType: string, zone: number) => {
        const normalizedSport = (sportType || '').toLowerCase();
        if (normalizedSport.includes('run')) {
            const hrRanges: Array<[number, number]> = [
                [50, 60],
                [60, 70],
                [70, 80],
                [80, 90],
                [90, 100]
            ];
            const idx = Math.max(1, Math.min(hrRanges.length, zone)) - 1;
            const [min, max] = hrRanges[idx];
            return { min, max, targetType: 'heart_rate_zone' as const };
        }

        const powerRanges: Array<[number, number]> = [
            [50, 55],
            [56, 75],
            [76, 90],
            [91, 105],
            [106, 120],
            [121, 150],
            [151, 200]
        ];
        const idx = Math.max(1, Math.min(powerRanges.length, zone)) - 1;
        const [min, max] = powerRanges[idx];
        return { min, max, targetType: 'power' as const };
    };

    const quickWorkoutStep = (
        category: 'warmup' | 'work' | 'cooldown',
        durationType: 'time' | 'distance',
        durationValue: number,
        sportType: string,
        zone: number
    ): ConcreteStep => {
        const boundedZone = Math.max(1, zone);
        const zoneBounds = quickWorkoutZoneBounds(sportType, boundedZone);
        return {
            id: Math.random().toString(36).slice(2, 11),
            type: 'block',
            category,
            duration: {
                type: durationType,
                value: durationValue
            },
            target: {
                type: zoneBounds.targetType,
                zone: boundedZone,
                min: zoneBounds.min,
                max: zoneBounds.max,
                unit: '%'
            }
        };
    };

    const buildQuickWorkoutStructure = (
        mode: 'time' | 'distance',
        sportType: string,
        zone: number,
        minutes: number,
        distanceKm: number
    ): WorkoutNode[] => {
        if (mode === 'time') {
            const totalSeconds = Math.max(300, Math.round(minutes * 60));
            const warmupSeconds = Math.min(900, Math.max(300, Math.round(totalSeconds * 0.2)));
            const cooldownSeconds = Math.min(600, Math.max(300, Math.round(totalSeconds * 0.15)));
            const mainSeconds = Math.max(300, totalSeconds - warmupSeconds - cooldownSeconds);

            return [
                quickWorkoutStep('warmup', 'time', warmupSeconds, sportType, Math.max(1, zone - 1)),
                quickWorkoutStep('work', 'time', mainSeconds, sportType, zone),
                quickWorkoutStep('cooldown', 'time', cooldownSeconds, sportType, Math.max(1, zone - 1))
            ];
        }

        const totalMeters = Math.max(1000, Math.round(distanceKm * 1000));
        const warmupMeters = Math.min(3000, Math.max(1000, Math.round(totalMeters * 0.2)));
        const cooldownMeters = Math.min(2000, Math.max(500, Math.round(totalMeters * 0.15)));
        const mainMeters = Math.max(1000, totalMeters - warmupMeters - cooldownMeters);

        return [
            quickWorkoutStep('warmup', 'distance', warmupMeters, sportType, Math.max(1, zone - 1)),
            quickWorkoutStep('work', 'distance', mainMeters, sportType, zone),
            quickWorkoutStep('cooldown', 'distance', cooldownMeters, sportType, Math.max(1, zone - 1))
        ];
    };

    const handleCreateQuickWorkout = () => {
        if (!canEditWorkouts) {
            return;
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
            description: quickWorkout.mode === 'time'
                ? `Quick workout: ${formatMinutesHm(quickWorkout.minutes)} in zone ${quickWorkout.zone}${targetDetails ? ` (${targetDetails})` : ''}`
                : `Quick workout: ${quickWorkout.distanceKm} km in zone ${quickWorkout.zone}${targetDetails ? ` (${targetDetails})` : ''}`,
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
            // Keep lightweight; avoid blocking modal flow.
            console.error('Failed to download planned workout', error);
        }
    };

    // Re-use EventComponent logic for list items
    const DayEventItem = ({ r }: { r: CalendarEvent }) => {
        // ... styling copy ...
        let borderColor = 'transparent';
        let bgColor = isDark ? 'rgba(255,255,255,0.04)' : 'var(--mantine-color-gray-1)';

        if (!r.is_planned) {
            bgColor = isDark ? 'rgba(51, 154, 240, 0.2)' : 'var(--mantine-color-blue-0)'; 
            borderColor = 'var(--mantine-color-blue-5)'; 
        } else {
             switch(r.compliance_status) {
                case 'completed_green': borderColor = 'var(--mantine-color-green-6)'; bgColor = isDark ? 'rgba(64, 192, 87, 0.16)' : 'var(--mantine-color-green-0)'; break;
                case 'completed_yellow': borderColor = 'var(--mantine-color-yellow-6)'; bgColor = isDark ? 'rgba(250, 176, 5, 0.16)' : 'var(--mantine-color-yellow-0)'; break;
                case 'completed_red': borderColor = 'var(--mantine-color-red-6)'; bgColor = isDark ? 'rgba(250, 82, 82, 0.16)' : 'var(--mantine-color-red-0)'; break;
                case 'missed': borderColor = 'var(--mantine-color-red-6)'; bgColor = isDark ? 'rgba(250, 82, 82, 0.16)' : 'var(--mantine-color-red-0)'; break;
            }
        }
        
         const formatSpeed = (speed: number | undefined, sport?: string) => {
            if (!speed) return '';
            if (sport?.toLowerCase().includes('run')) {
                if (speed === 0) return '-:--';
                const paceDec = 1000 / (speed * 60);
                const mins = Math.floor(paceDec);
                const secs = Math.round((paceDec - mins) * 60);
                return `${mins}:${secs.toString().padStart(2, '0')}/km`;
            }
            const kmh = speed * 3.6;
            return `${kmh.toFixed(1)} km/h`;
        };

        return (
            <Paper
                onClick={() => {
                    if (!r.is_planned) {
                        if (r.id) {
                            navigate(`/dashboard/activities/${r.id}`, {
                                state: {
                                    returnTo: athleteId ? `/dashboard/athlete/${athleteId}` : '/dashboard',
                                    activeTab: athleteId ? undefined : 'plan',
                                    selectedAthleteId: athleteId ? athleteId.toString() : null,
                                    calendarDate: format(viewDate, 'yyyy-MM-dd')
                                }
                            });
                            closeDayModal();
                        }
                        return;
                    }
                    setSelectedEvent(r);
                    closeDayModal();
                    open();
                }}
                style={{ border: `1px solid ${borderColor}` }}
                bg={bgColor}
                p={8}
                radius="sm"
                mb={8}
            >
                <Group justify="space-between">
                    <Group gap="xs">
                        <SportIcon sport={r.sport_type || 'other'} />
                        <Text fw={500} size="sm">{r.title}</Text>
                        {!r.is_planned && <Badge size="xs" variant="outline">Completed</Badge>}
                    </Group>
                    <Text size="xs" c="dimmed">
                        {r.is_planned ? formatMinutesHm(r.planned_duration) : formatMinutesHm(r.duration)}
                    </Text>
                </Group>
                {!r.is_planned && (
                    <Text size="xs" mt={4}>
                       {(r.distance || 0).toFixed(1)}km · {formatSpeed(r.avg_speed, r.sport_type)}
                    </Text>
                )}
                {r.is_planned && r.id && (
                    <Group justify="flex-end" mt={6}>
                        <Button
                            size="xs"
                            variant="subtle"
                            leftSection={<Download size={14} />}
                            onClick={(event) => {
                                event.stopPropagation();
                                handleDownloadPlannedWorkout(r.id as number);
                            }}
                        >
                            Download
                        </Button>
                    </Group>
                )}
            </Paper>
        );
    }



    const formatTotalMinutes = (minutes: number) => {
        const total = Math.max(0, Math.round(minutes));
        const h = Math.floor(total / 60);
        const m = total % 60;
        return `${h}h ${m}m`;
    };

    const formatPace = (minutesPerKm: number | null) => {
        if (!minutesPerKm || !Number.isFinite(minutesPerKm) || minutesPerKm <= 0) return '-';
        const mins = Math.floor(minutesPerKm);
        const secsRaw = Math.round((minutesPerKm - mins) * 60);
        const carry = secsRaw === 60 ? 1 : 0;
        const secs = secsRaw === 60 ? 0 : secsRaw;
        return `${mins + carry}:${secs.toString().padStart(2, '0')}/km`;
    };

    const formatAvgHr = (avgHr: number | null) => {
        if (!avgHr || !Number.isFinite(avgHr)) return '-';
        return `${Math.round(avgHr)} bpm`;
    };

    const getZonePalette = (zoneCount: number) => {
        if (zoneCount === 5) {
            return ['#64748B', '#3B82F6', '#22C55E', '#EAB308', '#EF4444'];
        }
        return ['#6366F1', '#3B82F6', '#06B6D4', '#22C55E', '#EAB308', '#F97316', '#EF4444'];
    };

    const renderStackedZoneBar = (zoneValues: number[], zoneCount: number, height: number = 8) => {
        const safeZones = Array.from({ length: zoneCount }, (_, idx) => Math.max(0, zoneValues[idx] || 0));
        const total = safeZones.reduce((acc, curr) => acc + curr, 0);
        const showMixedPlaceholder = total === 0;
        const paletteForCount = getZonePalette(zoneCount);

        return (
            <Box>
                <Group gap={0} wrap="nowrap" style={{ borderRadius: 999, overflow: 'hidden', border: `1px solid ${palette.dayCellBorder}` }}>
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

    const renderZoneBars = (zoneSeconds: Record<string, number>, zoneCount: number, metric: 'hr' | 'pace' | 'power') => {
        const values = Array.from({ length: zoneCount }, (_, idx) => zoneSeconds[`Z${idx + 1}`] || 0);
        const total = values.reduce((sum, value) => sum + value, 0);
        const zonePalette = zoneCount === 5
            ? [
                'var(--mantine-color-blue-5)',
                'var(--mantine-color-cyan-5)',
                'var(--mantine-color-green-5)',
                'var(--mantine-color-yellow-5)',
                'var(--mantine-color-red-5)'
            ]
            : [
                'var(--mantine-color-indigo-5)',
                'var(--mantine-color-blue-5)',
                'var(--mantine-color-cyan-5)',
                'var(--mantine-color-green-5)',
                'var(--mantine-color-yellow-5)',
                'var(--mantine-color-orange-5)',
                'var(--mantine-color-red-5)'
            ];

        const formatZoneDuration = (seconds: number) => {
            const totalMinutes = Math.max(0, Math.round((seconds || 0) / 60));
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            return `${hours}h ${minutes}m`;
        };

        const openZoneExplanation = (zone: number) => {
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

            const metricLabel = metric === 'hr' ? 'Heart Rate' : metric === 'pace' ? 'Pace' : 'Power';
            const description = metric === 'hr'
                ? (hrDescriptions[zone - 1] || 'Zone description unavailable.')
                : metric === 'pace'
                    ? (paceDescriptions[zone - 1] || 'Zone description unavailable.')
                    : (powerDescriptions[zone - 1] || 'Zone description unavailable.');

            setZoneExplainModal({
                title: `${metricLabel} Z${zone}`,
                description
            });
        };

        return (
            <Stack gap={4}>
                {values.map((seconds, idx) => {
                    const pct = total > 0 ? (seconds / total) * 100 : 0;
                    const zoneColor = zonePalette[idx] || 'var(--mantine-color-gray-5)';
                    return (
                        <Group key={`zone-${idx + 1}`} gap={6} wrap="nowrap" style={{ cursor: 'pointer' }} onClick={() => openZoneExplanation(idx + 1)}>
                            <Box w={28}><Text size="xs">Z{idx + 1}</Text></Box>
                            <Progress value={pct} color={zoneColor} size={8} radius={4} flex={1} />
                            <Box w={70} ta="right"><Text size="xs" c="dimmed">{formatZoneDuration(seconds)}</Text></Box>
                        </Group>
                    );
                })}
            </Stack>
        );
    };

    const monthStart = useMemo(() => new Date(viewDate.getFullYear(), viewDate.getMonth(), 1), [viewDate]);
    const monthEnd = useMemo(() => new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0), [viewDate]);

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

    const { data: weekRangeZoneActivities = [] } = useQuery({
        queryKey: ['zone-week-range-activities', athleteId, allAthletes, weekStartDay, ...weeksInMonth.map((week) => week.key)],
        enabled: weeksInMonth.length > 0,
        queryFn: async () => {
            const byId = new Map<number, ActivityZoneSummary>();

            await Promise.all(
                weeksInMonth.map(async (week) => {
                    const params = new URLSearchParams();
                    params.set('reference_date', week.key);
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

    const [zoneDetailModal, setZoneDetailModal] = useState<{
        title: string;
        metrics: {
            totalDistanceKm: number;
            totalDurationMin: number;
            avgPaceMinPerKm: number | null;
            avgHr: number | null;
            activitiesCount: number;
            aerobicLoad: number;
            anaerobicLoad: number;
        };
        zones: {
            running: { activityCount: number; zoneSecondsByMetric: { hr: Record<string, number>; pace: Record<string, number> } };
            cycling: { activityCount: number; zoneSecondsByMetric: { hr: Record<string, number>; power: Record<string, number> } };
        };
        activities: Array<{
            id?: number;
            date: Date;
            sport: string;
            distanceKm: number;
            durationMin: number;
            avgHr?: number;
            avgPaceMinPerKm?: number | null;
            zoneSeconds: Record<string, number>;
            zoneCount: number;
        }>;
    } | null>(null);
    const [zoneBreakdownMode, setZoneBreakdownMode] = useState<'all' | 'sport'>('all');
    const [runningZoneMetric, setRunningZoneMetric] = useState<'hr' | 'pace'>('hr');
    const [cyclingZoneMetric, setCyclingZoneMetric] = useState<'power' | 'hr'>('power');
    const [weeklyZoneMetricMode, setWeeklyZoneMetricMode] = useState<'hr' | 'performance'>('performance');
    const [zoneExplainModal, setZoneExplainModal] = useState<{ title: string; description: string } | null>(null);

    const completedEventsForAthlete = (athleteUserId: number, periodStart: Date, periodEnd: Date) => {
        return events.filter((event: any) => {
            const resource = event.resource as CalendarEvent;
            if (resource.is_planned) return false;
            if (resource.user_id !== athleteUserId) return false;
            const evtDate = event.start as Date;
            return evtDate >= periodStart && evtDate <= periodEnd;
        });
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
            avgHr: hrDurationSum > 0 ? (hrWeightedSum / hrDurationSum) : null,
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

    const ZoneSummaryPanel = () => {
        const summaries = zoneSummary?.athletes || [];
        const scopedKnownActivities = useMemo(() => {
            const byId = new Map<number, ActivityZoneSummary>();
            summaries.forEach((summary) => {
                [...(summary.weekly_activity_zones || []), ...(summary.monthly_activity_zones || [])].forEach((activity) => {
                    byId.set(activity.activity_id, activity);
                });
            });
            weekRangeZoneActivities.forEach((activity) => {
                byId.set(activity.activity_id, activity);
            });
            return Array.from(byId.values());
        }, [summaries, weekRangeZoneActivities]);

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

        const safeNumber = (value: any, fallback = 0) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : fallback;
        };

        const runningZoneIndex = (hr: number, maxHr: number) => {
            const ratio = hr / maxHr;
            if (ratio < 0.6) return 1;
            if (ratio < 0.7) return 2;
            if (ratio < 0.8) return 3;
            if (ratio < 0.9) return 4;
            return 5;
        };

        const runningPaceZoneIndex = (paceMinPerKm: number, lt2: number) => {
            if (!lt2 || lt2 <= 0) return null;
            const bounds = [lt2 * 0.84, lt2 * 0.90, lt2 * 0.97, lt2 * 1.03, lt2 * 1.10, lt2 * 1.20];
            for (let idx = bounds.length - 1; idx >= 0; idx -= 1) {
                if (paceMinPerKm >= bounds[idx]) {
                    return bounds.length - idx;
                }
            }
            return 7;
        };

        const cyclingZoneIndex = (watts: number, ftp: number) => {
            const ratio = (watts / ftp) * 100;
            if (ratio <= 55) return 1;
            if (ratio <= 75) return 2;
            if (ratio <= 90) return 3;
            if (ratio <= 105) return 4;
            if (ratio <= 120) return 5;
            if (ratio <= 150) return 6;
            return 7;
        };

        const hasAnyZoneSeconds = (zoneSeconds: Record<string, number>) => Object.values(zoneSeconds).some((value) => value > 0);

        const normalizeSport = (sport: string | undefined | null): 'running' | 'cycling' | 'other' => {
            const lowered = (sport || '').toLowerCase();
            if (lowered.includes('run')) return 'running';
            if (lowered.includes('cycl') || lowered.includes('bike') || lowered.includes('ride')) return 'cycling';
            return 'other';
        };

        const zoneCountForSport = (sport: string | undefined | null) => {
            const normalized = normalizeSport(sport);
            if (normalized === 'running') return 5;
            if (normalized === 'cycling') return 7;
            return 0;
        };

        const deriveZonesFromActivityDetail = (detail: any, profile?: any) => {
            const sportName = (detail?.sport || '').toLowerCase();
            const sport = sportName.includes('run') ? 'running'
                : (sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride')) ? 'cycling'
                    : 'other';

            const runningHrZones = Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
            const runningPaceZones = Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
            const cyclingHrZones = Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
            const cyclingPowerZones = Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
            const durationSeconds = safeNumber(detail?.duration, 0);

            const streamsRaw = detail?.streams;
            const streamPoints = Array.isArray(streamsRaw)
                ? streamsRaw
                : (Array.isArray(streamsRaw?.data) ? streamsRaw.data : []);

            if (sport === 'running') {
                const maxHr = safeNumber(profile?.max_hr, 190);
                const hrSamples = streamPoints
                    .map((point: any) => safeNumber(point?.heart_rate, -1))
                    .filter((value: number) => value > 0);

                if (hrSamples.length > 0 && maxHr > 0 && durationSeconds > 0) {
                    const secondsPerSample = durationSeconds / hrSamples.length;
                    hrSamples.forEach((hr: number) => {
                        const zone = runningZoneIndex(hr, maxHr);
                        runningHrZones[`Z${zone}`] += secondsPerSample;
                    });
                } else if (detail?.hr_zones && typeof detail.hr_zones === 'object') {
                    for (let zone = 1; zone <= 5; zone += 1) {
                        runningHrZones[`Z${zone}`] += safeNumber(detail.hr_zones[`Z${zone}`], 0);
                    }
                }

                const lt2 = safeNumber(profile?.lt2, 0);
                const speedSamples = streamPoints
                    .map((point: any) => safeNumber(point?.speed, -1))
                    .filter((value: number) => value > 0.1);
                if (lt2 > 0 && speedSamples.length > 0 && durationSeconds > 0) {
                    const secondsPerSample = durationSeconds / speedSamples.length;
                    speedSamples.forEach((speed: number) => {
                        const paceMinPerKm = 1000 / (speed * 60);
                        const zone = runningPaceZoneIndex(paceMinPerKm, lt2);
                        if (zone) runningPaceZones[`Z${zone}`] += secondsPerSample;
                    });
                }

                return {
                    sport,
                    zoneSecondsByMetric: {
                        hr: runningHrZones,
                        pace: runningPaceZones
                    }
                };
            }

            if (sport === 'cycling') {
                let ftp = safeNumber(profile?.ftp, 0);
                const powerCurve = detail?.power_curve && typeof detail.power_curve === 'object'
                    ? detail.power_curve
                    : (streamsRaw?.power_curve && typeof streamsRaw.power_curve === 'object' ? streamsRaw.power_curve : null);

                if (ftp <= 0 && powerCurve) {
                    ftp = safeNumber(powerCurve['20min'], 0) * 0.95;
                }

                const powerSamples = streamPoints
                    .map((point: any) => safeNumber(point?.power, -1))
                    .filter((value: number) => value >= 0);

                if (ftp > 0 && powerSamples.length > 0 && durationSeconds > 0) {
                    const secondsPerSample = durationSeconds / powerSamples.length;
                    powerSamples.forEach((watts: number) => {
                        const zone = cyclingZoneIndex(watts, ftp);
                        cyclingPowerZones[`Z${zone}`] += secondsPerSample;
                    });
                }

                const maxHr = safeNumber(profile?.max_hr, 190);
                const hrSamples = streamPoints
                    .map((point: any) => safeNumber(point?.heart_rate, -1))
                    .filter((value: number) => value > 0);
                if (hrSamples.length > 0 && maxHr > 0 && durationSeconds > 0) {
                    const secondsPerSample = durationSeconds / hrSamples.length;
                    hrSamples.forEach((hr: number) => {
                        const zone = runningZoneIndex(hr, maxHr);
                        cyclingHrZones[`Z${zone}`] += secondsPerSample;
                    });
                }

                return {
                    sport,
                    zoneSecondsByMetric: {
                        hr: cyclingHrZones,
                        power: cyclingPowerZones
                    }
                };
            }

            return {
                sport: 'other',
                zoneSecondsByMetric: {}
            };
        };

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
                    running.zoneSecondsByMetric.hr[`Z${zone}`] += (runningByMetric.hr?.[`Z${zone}`] ?? source.sports.running.zone_seconds?.[`Z${zone}`] ?? 0);
                    cycling.zoneSecondsByMetric.hr[`Z${zone}`] += cyclingByMetric.hr?.[`Z${zone}`] || 0;
                }
                for (let zone = 1; zone <= 7; zone += 1) {
                    running.zoneSecondsByMetric.pace[`Z${zone}`] += runningByMetric.pace?.[`Z${zone}`] || 0;
                    cycling.zoneSecondsByMetric.power[`Z${zone}`] += (cyclingByMetric.power?.[`Z${zone}`] ?? source.sports.cycling.zone_seconds?.[`Z${zone}`] ?? 0);
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

            const athleteIds = summaries.map((summary) => summary.athlete_id);
            const scopedEvents = events.filter((event: any) => {
                const resource = event.resource as CalendarEvent;
                if (resource.is_planned) return false;
                if (!athleteIds.includes(resource.user_id || -1)) return false;
                const eventDate = event.start as Date;
                return eventDate >= periodStart && eventDate <= periodEnd;
            });

            const metrics = calculateMetrics(scopedEvents);
            let zones = aggregateZonesForPeriod(scopedKnownActivities, periodStart, periodEnd);

            const computeLoadsFromZones = (inputZones: typeof zones) => {
                const runWeights = [1, 2, 3, 4, 5];
                const runAerobicFractions = [0.95, 0.9, 0.75, 0.55, 0.35];
                const bikeWeights = [1, 2, 3, 4, 6, 8, 10];
                const bikeAerobicFractions = [0.97, 0.92, 0.82, 0.7, 0.52, 0.35, 0.2];

                let aerobic = 0;
                let anaerobic = 0;

                runWeights.forEach((weight, idx) => {
                    const zoneKey = `Z${idx + 1}`;
                    const minutes = (inputZones.running.zoneSecondsByMetric.hr[zoneKey] || 0) / 60;
                    const trimp = minutes * weight;
                    const frac = runAerobicFractions[idx];
                    aerobic += trimp * frac;
                    anaerobic += trimp * (1 - frac);
                });

                bikeWeights.forEach((weight, idx) => {
                    const zoneKey = `Z${idx + 1}`;
                    const minutes = (inputZones.cycling.zoneSecondsByMetric.power[zoneKey] || 0) / 60;
                    const trimp = minutes * weight;
                    const frac = bikeAerobicFractions[idx];
                    aerobic += trimp * frac;
                    anaerobic += trimp * (1 - frac);
                });

                const hasTime = (Object.values(inputZones.running.zoneSecondsByMetric.hr).reduce((a, b) => a + b, 0)
                    + Object.values(inputZones.cycling.zoneSecondsByMetric.power).reduce((a, b) => a + b, 0)) > 0;
                if (hasTime) {
                    if (aerobic <= 0) aerobic = 0.1;
                    if (anaerobic <= 0) anaerobic = 0.1;
                }

                return { aerobicLoad: Number(aerobic.toFixed(1)), anaerobicLoad: Number(anaerobic.toFixed(1)) };
            };
            const perActivityZones = new Map<number, { sport: string; zoneSecondsByMetric: Record<string, Record<string, number> | undefined> }>();

            const knownByActivityId = new Map<number, ActivityZoneSummary>(
                scopedKnownActivities.map((activity) => [activity.activity_id, activity])
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
                await Promise.all(
                    fallbackCandidates.map(async (event: any) => {
                        const resource = event.resource as CalendarEvent;
                        if (!resource.id) return;
                        try {
                            const detailRes = await api.get(`/activities/${resource.id}`);
                            const profile = athleteProfileById.get(resource.user_id || -1);
                            const derived = deriveZonesFromActivityDetail(detailRes.data, profile);
                            perActivityZones.set(resource.id, {
                                sport: derived.sport,
                                zoneSecondsByMetric: derived.zoneSecondsByMetric || {}
                            });
                        } catch {
                            // Keep summary-based zones when detail lookup fails
                        }
                    })
                );

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
                if (!resource.id) return;
                const known = knownByActivityId.get(resource.id);
                const mapped = perActivityZones.get(resource.id);
                const normalizedSport = normalizeSport(mapped?.sport || known?.sport || resource.sport_type || '');

                if (normalizedSport === 'running') {
                    zones.running.activityCount += 1;
                    const hrSource = mapped?.zoneSecondsByMetric?.hr || known?.zone_seconds_by_metric?.hr || {};
                    const paceSource = mapped?.zoneSecondsByMetric?.pace || known?.zone_seconds_by_metric?.pace || {};
                    for (let zone = 1; zone <= 5; zone += 1) {
                        const key = `Z${zone}`;
                        zones.running.zoneSecondsByMetric.hr[key] += Number(hrSource?.[key] || 0);
                    }
                    for (let zone = 1; zone <= 7; zone += 1) {
                        const key = `Z${zone}`;
                        zones.running.zoneSecondsByMetric.pace[key] += Number(paceSource?.[key] || 0);
                    }
                }

                if (normalizedSport === 'cycling') {
                    zones.cycling.activityCount += 1;
                    const hrSource = mapped?.zoneSecondsByMetric?.hr || known?.zone_seconds_by_metric?.hr || {};
                    const powerSource = mapped?.zoneSecondsByMetric?.power || known?.zone_seconds_by_metric?.power || {};
                    for (let zone = 1; zone <= 5; zone += 1) {
                        const key = `Z${zone}`;
                        zones.cycling.zoneSecondsByMetric.hr[key] += Number(hrSource?.[key] || 0);
                    }
                    for (let zone = 1; zone <= 7; zone += 1) {
                        const key = `Z${zone}`;
                        zones.cycling.zoneSecondsByMetric.power[key] += Number(powerSource?.[key] || 0);
                    }
                }
            });

            const noPerActivityZones = zones.running.activityCount === 0 && zones.cycling.activityCount === 0;
            if (noPerActivityZones) {
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

            setZoneBreakdownMode('all');
            setRunningZoneMetric('hr');
            setCyclingZoneMetric('power');
            setZoneDetailModal({ title, metrics: { ...metrics, ...computeLoadsFromZones(zones) }, zones, activities });
        };

        const knownZoneByActivityId = useMemo(() => {
            const byId = new Map<number, ActivityZoneSummary>();
            scopedKnownActivities.forEach((activity) => {
                byId.set(activity.activity_id, activity);
            });
            return byId;
        }, [scopedKnownActivities]);

        const buildWeeklyDistribution = (activityEvents: any[], metricMode: 'hr' | 'performance') => {
            const zoneCount = metricMode === 'hr' ? 5 : 7;
            const totals = Array.from({ length: zoneCount }, () => 0);
            activityEvents.forEach((event: any) => {
                const resource = event.resource as CalendarEvent;
                const known = resource.id ? knownZoneByActivityId.get(resource.id) : undefined;
                if (!known) return;

                const byMetric = known.zone_seconds_by_metric || {};
                const normalizedSport = normalizeSport(known.sport || resource.sport_type || '');
                const source = metricMode === 'hr'
                    ? (byMetric.hr || {})
                    : normalizedSport === 'running'
                        ? (byMetric.pace || {})
                        : normalizedSport === 'cycling'
                            ? (byMetric.power || {})
                            : {};

                for (let zone = 1; zone <= zoneCount; zone += 1) {
                    const key = `Z${zone}`;
                    totals[zone - 1] += Number(source?.[key] || 0);
                }
            });
            return { totals, zoneCount };
        };

        return (
            <Stack w={324} miw={324} h="100%" gap={0} style={{ overflow: 'hidden' }}>
                <Box
                    h={WEEKDAY_HEADER_HEIGHT}
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
                        const weekEvents = events.filter((event: any) => {
                            const resource = event.resource as CalendarEvent;
                            if (resource.is_planned) return false;
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
                                <Box mt={5}>{renderStackedZoneBar(weekZones, weekZoneCount, 8)}</Box>
                            </Box>
                        );
                    })}
                </Box>

                <Modal
                    opened={Boolean(zoneDetailModal)}
                    onClose={() => setZoneDetailModal(null)}
                    title={zoneDetailModal?.title || 'Details'}
                    size="lg"
                >
                    {zoneDetailModal && (
                        <Stack gap="sm">
                            <Paper withBorder p="sm" radius="sm">
                                <Text size="sm" fw={600} mb={4}>Summary</Text>
                                <Text size="sm">
                                    {zoneDetailModal.metrics.totalDistanceKm.toFixed(1)} km · {formatTotalMinutes(zoneDetailModal.metrics.totalDurationMin)} · {formatPace(zoneDetailModal.metrics.avgPaceMinPerKm)} · {formatAvgHr(zoneDetailModal.metrics.avgHr)}
                                </Text>
                                <Text size="sm" mt={4}>
                                    Aerobic load: {zoneDetailModal.metrics.aerobicLoad.toFixed(1)} · Anaerobic load: {zoneDetailModal.metrics.anaerobicLoad.toFixed(1)}
                                </Text>
                                <Text size="xs" c="dimmed" mt={4}>{zoneDetailModal.metrics.activitiesCount} activities</Text>
                            </Paper>

                            <Paper withBorder p="sm" radius="sm">
                                <Group justify="space-between" align="center">
                                    <Text size="sm" fw={600}>Zone View</Text>
                                    <Select
                                        size="xs"
                                        w={210}
                                        value={zoneBreakdownMode}
                                        onChange={(value) => setZoneBreakdownMode((value as 'all' | 'sport') || 'all')}
                                        data={[
                                            { value: 'all', label: 'All activities (total)' },
                                            { value: 'sport', label: 'By activity type' }
                                        ]}
                                        allowDeselect={false}
                                    />
                                </Group>
                                <Group mt={8} grow>
                                    <Select
                                        size="xs"
                                        label="Running metric"
                                        value={runningZoneMetric}
                                        onChange={(value) => setRunningZoneMetric((value as 'hr' | 'pace') || 'hr')}
                                        data={[
                                            { value: 'hr', label: 'Heart rate' },
                                            { value: 'pace', label: 'Pace' }
                                        ]}
                                        allowDeselect={false}
                                    />
                                    <Select
                                        size="xs"
                                        label="Cycling metric"
                                        value={cyclingZoneMetric}
                                        onChange={(value) => setCyclingZoneMetric((value as 'power' | 'hr') || 'power')}
                                        data={[
                                            { value: 'power', label: 'Power' },
                                            { value: 'hr', label: 'Heart rate' }
                                        ]}
                                        allowDeselect={false}
                                    />
                                </Group>
                            </Paper>

                            {zoneBreakdownMode === 'all' ? (
                                <>
                                    {(zoneDetailModal.zones.running.activityCount > 0 || Object.values(zoneDetailModal.zones.running.zoneSecondsByMetric[runningZoneMetric]).some((v) => v > 0)) && (
                                        <Paper withBorder p="sm" radius="sm">
                                            <Text size="sm" fw={600} mb={6}>Running ({runningZoneMetric === 'hr' ? 'HR' : 'Pace'})</Text>
                                            {renderZoneBars(zoneDetailModal.zones.running.zoneSecondsByMetric[runningZoneMetric], runningZoneMetric === 'hr' ? 5 : 7, runningZoneMetric)}
                                        </Paper>
                                    )}

                                    {(zoneDetailModal.zones.cycling.activityCount > 0 || Object.values(zoneDetailModal.zones.cycling.zoneSecondsByMetric[cyclingZoneMetric]).some((v) => v > 0)) && (
                                        <Paper withBorder p="sm" radius="sm">
                                            <Text size="sm" fw={600} mb={6}>Cycling ({cyclingZoneMetric === 'power' ? 'Power' : 'HR'})</Text>
                                            {renderZoneBars(zoneDetailModal.zones.cycling.zoneSecondsByMetric[cyclingZoneMetric], cyclingZoneMetric === 'power' ? 7 : 5, cyclingZoneMetric)}
                                        </Paper>
                                    )}
                                </>
                            ) : (
                                <Paper withBorder p="sm" radius="sm">
                                    <Text size="sm" fw={600} mb={6}>Activity Type · Zone Breakdown</Text>
                                    <Stack gap="sm">
                                        {(zoneDetailModal.zones.running.activityCount > 0 || Object.values(zoneDetailModal.zones.running.zoneSecondsByMetric[runningZoneMetric]).some((v) => v > 0)) && (
                                            <Paper withBorder p="xs" radius="sm">
                                                <Group justify="space-between" mb={6}>
                                                    <Text size="sm" fw={500}>Running</Text>
                                                    <Text size="xs" c="dimmed">{zoneDetailModal.zones.running.activityCount} activities</Text>
                                                </Group>
                                                {renderZoneBars(zoneDetailModal.zones.running.zoneSecondsByMetric[runningZoneMetric], runningZoneMetric === 'hr' ? 5 : 7, runningZoneMetric)}
                                            </Paper>
                                        )}

                                        {(zoneDetailModal.zones.cycling.activityCount > 0 || Object.values(zoneDetailModal.zones.cycling.zoneSecondsByMetric[cyclingZoneMetric]).some((v) => v > 0)) && (
                                            <Paper withBorder p="xs" radius="sm">
                                                <Group justify="space-between" mb={6}>
                                                    <Text size="sm" fw={500}>Cycling</Text>
                                                    <Text size="xs" c="dimmed">{zoneDetailModal.zones.cycling.activityCount} activities</Text>
                                                </Group>
                                                {renderZoneBars(zoneDetailModal.zones.cycling.zoneSecondsByMetric[cyclingZoneMetric], cyclingZoneMetric === 'power' ? 7 : 5, cyclingZoneMetric)}
                                            </Paper>
                                        )}

                                        {(zoneDetailModal.zones.running.activityCount === 0
                                            && zoneDetailModal.zones.cycling.activityCount === 0
                                            && !Object.values(zoneDetailModal.zones.running.zoneSecondsByMetric.hr).some((v) => v > 0)
                                            && !Object.values(zoneDetailModal.zones.running.zoneSecondsByMetric.pace).some((v) => v > 0)
                                            && !Object.values(zoneDetailModal.zones.cycling.zoneSecondsByMetric.hr).some((v) => v > 0)
                                            && !Object.values(zoneDetailModal.zones.cycling.zoneSecondsByMetric.power).some((v) => v > 0)) && (
                                            <Text size="sm" c="dimmed">No zone data available for this period.</Text>
                                        )}
                                    </Stack>
                                </Paper>
                            )}
                        </Stack>
                    )}
                </Modal>

                <Modal
                    opened={Boolean(zoneExplainModal)}
                    onClose={() => setZoneExplainModal(null)}
                    title={zoneExplainModal?.title || 'Zone'}
                    size="sm"
                    centered
                >
                    <Text size="sm">{zoneExplainModal?.description}</Text>
                </Modal>
            </Stack>
        );
    };

    const athleteOptions = (athletes || []).map((athlete: any) => ({
        value: athlete.id.toString(),
        label: athlete.profile?.first_name
            ? `${athlete.profile.first_name} ${athlete.profile.last_name || ''}`.trim()
            : athlete.email
    }));

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
            .map((row: any) => row.resource as CalendarEvent)
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

    const activeAthlete = (athletes || []).find((athlete: any) => athlete.id === selectedEvent.user_id);
    const athleteProfile = activeAthlete?.profile || me?.profile;
    const athleteName = activeAthlete
        ? (activeAthlete.profile?.first_name
            ? `${activeAthlete.profile.first_name} ${activeAthlete.profile.last_name || ''}`.trim()
            : activeAthlete.email)
        : (me?.profile?.first_name ? `${me.profile.first_name} ${me.profile.last_name || ''}`.trim() : me?.email);

    // Custom Date Header for Calendar Cells
    const CustomDateHeader = ({ date, label }: { date: Date, label: string }) => {
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
    };

    return (
        <Stack p={10} gap={0} h="calc(100vh - 132px)" bg={palette.background} maw={2480} mx="auto" w="100%" style={{ overflow: 'hidden' }}>
            <style>{`
                .rbc-calendar {
                    font-family: 'Inter', sans-serif;
                    height: 100% !important;
                }
                .rbc-month-view {
                    border: none !important;
                    background: transparent;
                    height: 100% !important;
                }
                .rbc-month-header {
                    min-height: ${WEEKDAY_HEADER_HEIGHT}px;
                }
                .rbc-header {
                    background: transparent !important;
                    border-bottom: 1px solid ${palette.headerBorder} !important;
                    color: ${palette.textDim};
                    text-transform: uppercase;
                    font-size: 0.68rem;
                    letter-spacing: 0.9px;
                    padding: 8px 0 !important;
                    font-weight: 700;
                }
                .rbc-month-row {
                    background: transparent !important;
                    border-top: 1px solid ${palette.dayCellBorder} !important;
                    overflow: hidden !important;
                    min-height: 0 !important;
                    flex: 1 1 0 !important;
                }
                .rbc-month-row:first-of-type {
                    border-top: none !important;
                }
                .rbc-day-bg {
                    background: transparent !important;
                    border-left: 1px solid ${palette.dayCellBorder} !important;
                }
                .rbc-day-bg:first-of-type {
                   border-left: none !important;
                }
                .rbc-date-cell {
                    padding: 4px 6px 2px !important;
                }
                .rbc-off-range-bg {
                    background: ${palette.offRangeBg} !important;
                }
                .rbc-off-range {
                    color: ${palette.offRangeText} !important;
                }
                .rbc-today {
                    background: ${palette.todayBg} !important;
                }
                .rbc-row-content {
                    z-index: 4;
                    padding-bottom: 1px;
                    min-height: 0 !important;
                }
                .rbc-row-segment {
                    padding: 1px 2px !important;
                }
                .calendar-grid-wrapper {
                    border: 1px solid ${palette.headerBorder};
                    border-radius: 12px;
                    overflow: hidden;
                    background: ${palette.panelBg};
                    backdrop-filter: blur(14px);
                    min-height: 0;
                    height: 100%;
                    box-shadow: ${isDark ? '0 28px 56px -40px rgba(15, 23, 42, 0.9)' : '0 28px 56px -44px rgba(15, 23, 42, 0.45)'};
                }
                .rbc-event {
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    border-radius: 0 !important;
                }
                .rbc-event-content {
                    margin: 0 !important;
                    line-height: 1.15;
                }
                .rbc-show-more {
                    font-size: 10px !important;
                    font-weight: 700 !important;
                    color: ${palette.textDim} !important;
                }
            `}</style>
            
            <CalendarHeader date={viewDate} onNavigate={setViewDate} />
            
            <Group align="stretch" gap={8} wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
                <Box className="calendar-grid-wrapper" style={{ flex: 1, minWidth: 0 }}>
                    <DnDCalendar
                        localizer={localizer}
                        events={events}
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
                        components={{
                            event: RealEventComponent,
                            month: {
                                dateHeader: CustomDateHeader,
                            }
                        }}
                        dayPropGetter={() => {
                            return { style: {} };
                        }}
                    />
                </Box>
                <ZoneSummaryPanel />
            </Group>
            
            <Modal opened={dayModalOpen} onClose={closeDayModal} title={selectedDayTitle}>
                <Stack>
                     {dayEvents.length === 0 ? (
                         <Text c="dimmed" size="sm" ta="center" py="md">No activities for this day.</Text>
                     ) : (
                         dayEvents.map((evt, i) => <DayEventItem key={i} r={evt} />)
                     )}

                     <Divider label="Create" labelPosition="center" />

                     {coachNeedsAthleteSelection && (
                        <Select
                            label="Assign to Athlete"
                            placeholder="Select athlete"
                            data={athleteOptions}
                            value={selectedEvent.user_id?.toString()}
                            onChange={(val) => {
                                setSelectedEvent({ ...selectedEvent, user_id: val ? Number(val) : undefined });
                                setDayCreateError(null);
                            }}
                            searchable
                        />
                     )}

                     <Group grow>
                        <Select
                            label="Sport"
                            data={['Cycling', 'Running']}
                            value={quickWorkout.sport_type}
                            onChange={(value) => {
                                if (!value) return;
                                const zoneMax = value === 'Running' ? 5 : 7;
                                const nextZone = Math.min(quickWorkout.zone, zoneMax);
                                setQuickWorkout({ ...quickWorkout, sport_type: value, zone: nextZone });
                            }}
                        />
                        <NumberInput
                            label="Zone"
                            min={1}
                            max={quickWorkout.sport_type === 'Running' ? 5 : 7}
                            value={quickWorkout.zone}
                            onChange={(value) => {
                                const numericValue = typeof value === 'number' ? value : Number(value || 1);
                                const zoneMax = quickWorkout.sport_type === 'Running' ? 5 : 7;
                                setQuickWorkout({ ...quickWorkout, zone: Math.max(1, Math.min(zoneMax, numericValue)) });
                            }}
                        />
                     </Group>

                     <Group grow>
                        <Select
                            label="Quick Workout Type"
                            data={[
                                { value: 'time', label: 'Time in Zone' },
                                { value: 'distance', label: 'Distance in Zone (km)' }
                            ]}
                            value={quickWorkout.mode}
                            onChange={(value) => {
                                if (!value) return;
                                setQuickWorkout({ ...quickWorkout, mode: value as 'time' | 'distance' });
                            }}
                        />

                        {quickWorkout.mode === 'time' ? (
                            <Group grow align="end">
                                <NumberInput
                                    label="Hours"
                                    min={0}
                                    step={1}
                                    value={Math.floor((quickWorkout.minutes || 0) / 60)}
                                    onChange={(value) => {
                                        const hours = Math.max(0, typeof value === 'number' ? value : Number(value || 0));
                                        const currentMinutesRemainder = Math.max(0, (quickWorkout.minutes || 0) % 60);
                                        const totalMinutes = Math.max(5, Math.round(hours * 60 + currentMinutesRemainder));
                                        setQuickWorkout({ ...quickWorkout, minutes: totalMinutes });
                                    }}
                                />
                                <NumberInput
                                    label="Minutes"
                                    min={0}
                                    max={59}
                                    step={5}
                                    value={Math.max(0, (quickWorkout.minutes || 0) % 60)}
                                    description={formatMinutesHm(quickWorkout.minutes)}
                                    onChange={(value) => {
                                        const mins = Math.max(0, Math.min(59, typeof value === 'number' ? value : Number(value || 0)));
                                        const currentHours = Math.floor((quickWorkout.minutes || 0) / 60);
                                        const totalMinutes = Math.max(5, Math.round(currentHours * 60 + mins));
                                        setQuickWorkout({ ...quickWorkout, minutes: totalMinutes });
                                    }}
                                />
                            </Group>
                        ) : (
                            <NumberInput
                                label="Distance (km)"
                                min={1}
                                step={0.5}
                                value={quickWorkout.distanceKm}
                                onChange={(value) => {
                                    const numericValue = typeof value === 'number' ? value : Number(value || 0);
                                    setQuickWorkout({ ...quickWorkout, distanceKm: Math.max(1, numericValue) });
                                }}
                            />
                        )}
                     </Group>

                     <Group grow>
                        <Button leftSection={<Activity size={16}/>} variant="light" onClick={() => {
                            if (!canEditWorkouts) {
                                return;
                            }
                            if (!ensureAthleteSelectedForCreate()) {
                                return;
                            }
                            closeDayModal();
                            open();
                        }} disabled={!canEditWorkouts}>
                            Open Workout Builder
                        </Button>

                        <Button onClick={handleCreateQuickWorkout} disabled={!canEditWorkouts}>
                            Add Quick Workout
                        </Button>
                     </Group>

                     {!canEditWorkouts && <Text c="dimmed" size="sm">Coach has disabled workout editing for your account.</Text>}
                     {dayCreateError && <Text c="red" size="sm">{dayCreateError}</Text>}
                </Stack>
            </Modal>

            <Modal
                opened={bulkEditOpened}
                onClose={() => setBulkEditOpened(false)}
                title="Bulk Edit Training Week"
                size="md"
            >
                <Stack>
                    <Text size="sm" c="dimmed">
                        Apply one change across a full week with one action. Preview scope first, then commit.
                    </Text>
                    <Select
                        label="Week"
                        data={weeksInMonth.map((week) => ({
                            value: week.key,
                            label: `${format(week.start, 'MMM d')} - ${format(week.end, 'MMM d')}`
                        }))}
                        value={bulkWeekKey}
                        onChange={setBulkWeekKey}
                        placeholder="Select week"
                    />
                    {athleteOptions.length > 0 && (
                        <Select
                            label="Athlete Scope"
                            data={[{ value: 'all', label: 'All athletes' }, ...athleteOptions]}
                            value={bulkAthleteScope}
                            onChange={(value) => setBulkAthleteScope(value || 'all')}
                        />
                    )}
                    <Group grow>
                        <NumberInput
                            label="Shift Days"
                            value={bulkShiftDays}
                            min={-2}
                            max={2}
                            onChange={(value) => setBulkShiftDays(typeof value === 'number' ? value : 0)}
                        />
                        <NumberInput
                            label="Duration Scale (%)"
                            value={bulkDurationScale}
                            min={70}
                            max={140}
                            step={5}
                            onChange={(value) => setBulkDurationScale(typeof value === 'number' ? value : 100)}
                        />
                    </Group>
                    <NumberInput
                        label="Zone Delta"
                        description="Use -1 for easier week, +1 for progression"
                        value={bulkZoneDelta}
                        min={-2}
                        max={2}
                        onChange={(value) => setBulkZoneDelta(typeof value === 'number' ? value : 0)}
                    />
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setBulkEditOpened(false)}>Cancel</Button>
                        <Button loading={bulkApplying} onClick={() => void applyBulkEdit()} disabled={!bulkWeekKey}>
                            Apply Changes
                        </Button>
                    </Group>
                </Stack>
            </Modal>

            <Modal 
                opened={opened} 
                onClose={close} 
                title={selectedEvent.id ? "Edit Workout" : "Plan Workout"} 
                size="90%"
                centered
                styles={{
                    content: {
                        maxWidth: '1200px',
                        maxHeight: '92vh',
                        overflow: 'auto'
                    },
                    body: {
                        overflowX: 'hidden'
                    }
                }}
                transitionProps={{ transition: 'fade', duration: 200 }}
            >
                <Container fluid p={0}>
                    <Stack gap="sm" mb="md">
                        {saveError && (
                            <Alert color="orange" variant="light">
                                {saveError}
                            </Alert>
                        )}
                        <Group grow>
                            {athleteOptions.length > 0 && (
                                <Select
                                    label="Assign to Athlete"
                                    placeholder="Select athlete"
                                    data={athleteOptions}
                                    value={selectedEvent.user_id?.toString()}
                                    onChange={(val) => setSelectedEvent({ ...selectedEvent, user_id: val ? Number(val) : undefined })}
                                    searchable
                                />
                            )}

                            <DatePickerInput
                                label="Date"
                                value={selectedEvent.date ? new Date(selectedEvent.date) : null}
                                onChange={(value) => {
                                    if (!value) return;
                                    setSelectedEvent({ ...selectedEvent, date: format(value, 'yyyy-MM-dd') });
                                }}
                            />
                        </Group>
                    </Stack>

                        <WorkoutEditor
                            structure={selectedEvent.structure || []}
                            onChange={(structure) => setSelectedEvent({ ...selectedEvent, structure })}
                            sportType={selectedEvent.sport_type}
                            workoutName={selectedEvent.title || ''}
                            description={selectedEvent.description || ''}
                            intensityType={selectedEvent.planned_intensity || 'Custom'}
                            athleteName={athleteName}
                            athleteProfile={athleteProfile}
                            onWorkoutNameChange={(title) => setSelectedEvent({ ...selectedEvent, title })}
                            onDescriptionChange={(description) => setSelectedEvent({ ...selectedEvent, description })}
                            onIntensityTypeChange={(planned_intensity) => setSelectedEvent({ ...selectedEvent, planned_intensity })}
                            onSportTypeChange={(sport_type) => setSelectedEvent({ ...selectedEvent, sport_type })}
                        />
            </Container>
                
            <Paper
                component="footer"
                withBorder
                p="md"
                mt="xl"
                style={{
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 10,
                    backgroundColor: 'var(--mantine-color-body)',
                    borderColor: 'var(--mantine-color-default-border)'
                }}
            >
                <Group justify="flex-end">
                    {selectedEvent.id && canDeleteWorkouts && (
                        <Button
                            color="red"
                            variant="light"
                            mr="auto"
                            loading={deleteMutation.isPending}
                            onClick={() => {
                                if (!selectedEvent.id) return;
                                deleteMutation.mutate(selectedEvent.id);
                            }}
                        >
                            Delete Workout
                        </Button>
                    )}
                    <Button variant="default" onClick={close}>Cancel</Button>
                    <Button
                        onClick={handleSave}
                        leftSection={<CheckCircle size={16}/>}
                        disabled={!canEditWorkouts}
                        radius={4}
                        style={{
                            backgroundImage: 'linear-gradient(135deg, var(--mantine-color-orange-5), var(--mantine-color-pink-6))',
                            border: 'none'
                        }}
                    >
                        Save Workout
                    </Button>
                </Group>
            </Paper>
        </Modal>
        </Stack>
    );
};

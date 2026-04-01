import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { format, addDays, startOfWeek, addWeeks, getMonth, getYear, getDate } from 'date-fns';
import { MessageSquareText } from 'lucide-react';
import { CalendarEventCard, NoteChip } from './TrainingCalendarEventRenderers';
import { CalendarEvent } from './types';

/** How many weeks to render before/after the anchor week */
const BUFFER_WEEKS = 26;

export type ContinuousCalendarGridProps = {
    viewDate: Date;
    onViewDateChange: (d: Date) => void;
    weekStartDay: number;
    events: any[];
    visibleWeeks: number;
    palette: any;
    isDark: boolean;
    activityColors: any;
    preferredUnits?: string | null;
    planningMarkersByDate: Map<string, any[]>;
    buildPlanningMarkerVisual: (marker: any) => { Icon: any; color: string; title: string; shortLabel?: string };
    /* callbacks */
    onSelectEvent: (event: any) => void;
    onSelectSlot: (args: { start: Date; slots: Date[] }) => void;
    onEventDrop: (args: { event: any; start: Date }) => void;
    onDropFromOutside: (args: { start: Date }) => void;
    canEditWorkouts: boolean;
    /** Ref forwarded so parent can measure week row heights */
    gridRef?: React.RefObject<HTMLDivElement | null>;
    /** Ref exposed so parent can synchronize sidebar scroll */
    scrollContainerRef?: React.MutableRefObject<HTMLDivElement | null>;
    /** Notify parent of rendered week row heights (all rendered weeks) */
    onWeekRowHeights?: (heights: number[]) => void;
    /** Notify parent of all rendered weeks (for sidebar) */
    onVisibleWeeks?: (weeks: Array<{ start: Date; end: Date; key: string }>) => void;
    selectedDateRange?: { startDate: string; endDate: string } | null;
    /** Mobile viewport — enables horizontal swipe for days */
    isMobile?: boolean;
    /** Inline weekly totals — width of the suffix column */
    weekSuffixWidth?: number;
    /** Render function for each week's suffix cell (weekly totals) */
    renderWeekSuffix?: (week: { start: Date; end: Date; key: string }, weekIndex: number) => React.ReactNode;
    /** Header content for the suffix column */
    weekSuffixHeader?: React.ReactNode;
    /** Day notes indexed by date key (yyyy-MM-dd) */
    notesByDate?: Map<string, any[]>;
};

/* ── Helpers ── */
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildWeeks(anchorDate: Date, weekStartsOn: number, bufferBefore: number, bufferAfter: number) {
    const anchorWeekStart = startOfWeek(anchorDate, { weekStartsOn: weekStartsOn as 0 | 1 });
    const firstWeekStart = addWeeks(anchorWeekStart, -bufferBefore);
    const totalWeeks = bufferBefore + 1 + bufferAfter;
    const weeks: Array<{ start: Date; days: Date[]; key: string }> = [];
    for (let i = 0; i < totalWeeks; i++) {
        const ws = addWeeks(firstWeekStart, i);
        const days: Date[] = [];
        for (let d = 0; d < 7; d++) days.push(addDays(ws, d));
        weeks.push({ start: ws, days, key: format(ws, 'yyyy-MM-dd') });
    }
    return weeks;
}

function groupEventsByDate(events: any[]) {
    const map = new Map<string, any[]>();
    for (const evt of events) {
        const dateKey = evt.resource?.date || evt.date;
        if (!dateKey) continue;
        const list = map.get(dateKey) || [];
        list.push(evt);
        map.set(dateKey, list);
    }
    return map;
}

/* ── Component ── */
const ContinuousCalendarGrid: React.FC<ContinuousCalendarGridProps> = ({
    viewDate,
    onViewDateChange,
    weekStartDay,
    events,
    visibleWeeks,
    palette,
    isDark,
    activityColors,
    preferredUnits,
    planningMarkersByDate,
    buildPlanningMarkerVisual,
    onSelectEvent,
    onSelectSlot,
    onEventDrop,
    onDropFromOutside,
    canEditWorkouts,
    gridRef,
    scrollContainerRef,
    onWeekRowHeights,
    onVisibleWeeks,
    selectedDateRange,
    isMobile,
    weekSuffixWidth,
    renderWeekSuffix,
    weekSuffixHeader,
    notesByDate,
}) => {
    const hasSuffix = !!(renderWeekSuffix && weekSuffixWidth && !isMobile);
    const scrollRef = useRef<HTMLDivElement>(null);
    const weekRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

    /** Helper: compute the week-start key for a date */
    const getWeekKey = useCallback(
        (d: Date) => format(startOfWeek(d, { weekStartsOn: weekStartDay as 0 | 1 }), 'yyyy-MM-dd'),
        [weekStartDay],
    );

    /**
     * Anchor stored as a string key ("yyyy-MM-dd") so React's setState bailout
     * prevents re-renders when the logical anchor hasn't changed.
     */
    const [anchorKey, setAnchorKey] = useState(() => getWeekKey(viewDate));
    const anchorDate = useMemo(() => {
        const [y, m, d] = anchorKey.split('-').map(Number);
        return new Date(y, m - 1, d);
    }, [anchorKey]);

    const suppressScrollUpdate = useRef(false);
    const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Stable ref so scroll handler doesn't depend on viewDate */
    const viewDateRef = useRef(viewDate);
    viewDateRef.current = viewDate;
    /** Tracks whether a viewDate change originated from the scroll handler */
    const scrollInitiated = useRef(false);
    /** Stable ref for the weeks→Date mapping so handleScroll doesn't depend on `weeks` */
    const weekMapRef = useRef<Map<string, Date>>(new Map());
    /** Throttle timer for viewDate updates from scroll */
    const viewDateThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingViewDate = useRef<Date | null>(null);

    // Build the list of weeks to render
    const weeks = useMemo(
        () => buildWeeks(anchorDate, weekStartDay, BUFFER_WEEKS, BUFFER_WEEKS),
        [anchorDate, weekStartDay],
    );

    // The anchor week index (center)
    const anchorWeekIdx = BUFFER_WEEKS;

    // Keep weekMap ref in sync with weeks array
    useMemo(() => {
        const map = new Map<string, Date>();
        for (const w of weeks) map.set(w.key, w.start);
        weekMapRef.current = map;
    }, [weeks]);

    // Group events by date for fast lookup
    const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

    /**
     * Preserve scroll position when event content changes (rows resize).
     * Before React paints, we re-anchor the scroll so the visible week row
     * stays in the same visual position.
     */
    const reAnchorContext = useRef<{ weekKey: string; scrollOffset: number } | null>(null);
    // Snapshot the visual anchor BEFORE DOM changes from new events are committed.
    const prevEventsRef = useRef(events);
    if (events !== prevEventsRef.current) {
        prevEventsRef.current = events;
        const el = scrollRef.current;
        if (el && el.scrollTop > 0) {
            // Find the top-visible week row
            for (const week of weeks) {
                const refRow = weekRowRefs.current.get(week.key);
                if (refRow && refRow.offsetTop + refRow.offsetHeight > el.scrollTop) {
                    reAnchorContext.current = { weekKey: week.key, scrollOffset: el.scrollTop - refRow.offsetTop };
                    break;
                }
            }
        }
    }

    // Build weekday header labels starting from weekStartDay
    const weekdayHeaders = useMemo(() => {
        const labels: string[] = [];
        for (let i = 0; i < 7; i++) labels.push(WEEKDAY_LABELS[(weekStartDay + i) % 7]);
        return labels;
    }, [weekStartDay]);

    /** Suppress scroll-handler feedback for a duration after programmatic scroll */
    const suppressFor = useCallback((ms: number) => {
        suppressScrollUpdate.current = true;
        if (suppressTimer.current) clearTimeout(suppressTimer.current);
        suppressTimer.current = setTimeout(() => { suppressScrollUpdate.current = false; }, ms);
    }, []);

    /* ── scroll to anchor week (only on external navigation or first mount) ── */
    const lastAnchorKey = useRef(anchorKey);
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        // Skip if anchor hasn't actually changed (shouldn't happen with string state, but be safe)
        if (lastAnchorKey.current === anchorKey && el.scrollTop > 0) {
            return;
        }
        lastAnchorKey.current = anchorKey;
        const anchorRow = weekRowRefs.current.get(weeks[anchorWeekIdx]?.key);
        if (anchorRow) {
            suppressFor(400);
            el.scrollTop = anchorRow.offsetTop - 36;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anchorKey]);

    /* ── Restore scroll position when event data changes and row heights shift ── */
    useLayoutEffect(() => {
        const ctx = reAnchorContext.current;
        if (!ctx) return;
        reAnchorContext.current = null;
        const el = scrollRef.current;
        if (!el) return;
        const row = weekRowRefs.current.get(ctx.weekKey);
        if (row) {
            const desired = row.offsetTop + ctx.scrollOffset;
            if (Math.abs(el.scrollTop - desired) > 2) {
                suppressFor(200);
                el.scrollTop = desired;
            }
        }
    }, [eventsByDate, suppressFor]);

    /* ── When viewDate changes externally (header nav), re-anchor ── */
    useEffect(() => {
        // Skip re-anchoring when the viewDate change came from the scroll handler
        if (scrollInitiated.current) {
            scrollInitiated.current = false;
            return;
        }
        const vk = getWeekKey(viewDate);
        if (vk !== anchorKey) {
            lastAnchorKey.current = ''; // force the layoutEffect to scroll
            setAnchorKey(vk);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewDate, weekStartDay]);

    /* ── scroll handler — update viewDate to match visible center ── */
    /* Uses refs (weekMapRef, viewDateRef) instead of `weeks` so the callback
       and its event listener stay stable across re-renders. */
    const onViewDateChangeRef = useRef(onViewDateChange);
    onViewDateChangeRef.current = onViewDateChange;
    const getWeekKeyRef = useRef(getWeekKey);
    getWeekKeyRef.current = getWeekKey;

    const flushPendingViewDate = useCallback(() => {
        const d = pendingViewDate.current;
        if (d) {
            pendingViewDate.current = null;
            scrollInitiated.current = true;
            onViewDateChangeRef.current(d);
        }
    }, []);

    const handleScroll = useCallback(() => {
        if (suppressScrollUpdate.current) return;
        const el = scrollRef.current;
        if (!el) return;
        const scrollCenter = el.scrollTop + el.clientHeight / 2;
        let closestKey: string | null = null;
        let closestDist = Infinity;
        weekRowRefs.current.forEach((row, key) => {
            const mid = row.offsetTop + row.offsetHeight / 2;
            const dist = Math.abs(mid - scrollCenter);
            if (dist < closestDist) {
                closestDist = dist;
                closestKey = key;
            }
        });
        if (closestKey) {
            const currentViewKey = getWeekKeyRef.current(viewDateRef.current);
            if (closestKey !== currentViewKey) {
                const weekStart = weekMapRef.current.get(closestKey);
                if (weekStart) {
                    // Throttle parent re-renders: batch viewDate updates at ~8 Hz
                    pendingViewDate.current = weekStart;
                    if (!viewDateThrottleRef.current) {
                        viewDateThrottleRef.current = setTimeout(() => {
                            viewDateThrottleRef.current = null;
                            flushPendingViewDate();
                        }, 120);
                    }
                }
            }
        }
    }, [flushPendingViewDate]);

    /* Attach scroll listener once and keep it stable */
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        let raf: number;
        const onScroll = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(handleScroll);
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            el.removeEventListener('scroll', onScroll);
            cancelAnimationFrame(raf);
            if (viewDateThrottleRef.current) {
                clearTimeout(viewDateThrottleRef.current);
                viewDateThrottleRef.current = null;
            }
            // Flush any pending viewDate on unmount
            flushPendingViewDate();
        };
    }, [handleScroll, flushPendingViewDate]);

    /* Native scrolling — no custom wheel handler; the browser provides
       smooth momentum/inertia scrolling out of the box. */

    /* ── Expose scroll container ref to parent ── */
    useEffect(() => {
        if (scrollContainerRef) scrollContainerRef.current = scrollRef.current;
    });

    /* ── Measure & report ALL week row heights ── */
    useEffect(() => {
        if (!onWeekRowHeights) return;
        const el = scrollRef.current;
        if (!el) return;
        const measure = () => {
            const heights: number[] = [];
            for (const week of weeks) {
                const row = weekRowRefs.current.get(week.key);
                heights.push(row ? Math.round(row.getBoundingClientRect().height) : 0);
            }
            onWeekRowHeights(heights);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [weeks, onWeekRowHeights]);

    /* ── Notify parent of ALL rendered weeks ── */
    useEffect(() => {
        if (!onVisibleWeeks) return;
        const result: Array<{ start: Date; end: Date; key: string }> = weeks.map((w) => ({
            start: w.start,
            end: addDays(w.start, 6),
            key: w.key,
        }));
        onVisibleWeeks(result);
    }, [weeks, onVisibleWeeks]);

    /* ── DnD state ── */
    const [dragOverDate, setDragOverDate] = useState<string | null>(null);
    const [draggingEventId, setDraggingEventId] = useState<number | null>(null);

    const handleDayDragOver = useCallback((e: React.DragEvent, dateKey: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverDate(dateKey);
    }, []);

    const handleDayDrop = useCallback((e: React.DragEvent, date: Date) => {
        e.preventDefault();
        setDragOverDate(null);
        if (draggingEventId) {
            // Internal event drag
            const draggedEvent = events.find((ev: any) => ev.resource?.id === draggingEventId);
            if (draggedEvent) {
                onEventDrop({ event: draggedEvent, start: date });
            }
            setDraggingEventId(null);
        } else {
            // Drop from outside (library)
            onDropFromOutside({ start: date });
        }
    }, [draggingEventId, events, onEventDrop, onDropFromOutside]);

    const handleDayDragLeave = useCallback(() => {
        setDragOverDate(null);
    }, []);

    const handleEventDragStart = useCallback((e: React.DragEvent, eventId: number) => {
        setDraggingEventId(eventId);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(eventId));
    }, []);

    /* ── Day click (slot selection) ── */
    const handleDayClick = useCallback((date: Date, e: React.MouseEvent) => {
        // Only trigger if clicking the cell background, not an event card
        if ((e.target as HTMLElement).closest('[data-calendar-event]')) return;
        onSelectSlot({ start: date, slots: [date] });
    }, [onSelectSlot]);

    /* ── Today marker ── */
    const todayKey = format(new Date(), 'yyyy-MM-dd');

    /* ── Determine which month-year labels to inject ── */
    const monthHeaders = useMemo(() => {
        const headers = new Map<number, string>(); // weekIndex → label
        for (let i = 0; i < weeks.length; i++) {
            const firstDay = weeks[i].days[0];
            if (i === 0) {
                headers.set(i, format(firstDay, 'MMMM yyyy'));
                continue;
            }
            const prevFirstDay = weeks[i - 1].days[0];
            if (getMonth(firstDay) !== getMonth(prevFirstDay) || getYear(firstDay) !== getYear(prevFirstDay)) {
                headers.set(i, format(firstDay, 'MMMM yyyy'));
            }
        }
        return headers;
    }, [weeks]);

    const setWeekRowRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
        if (el) weekRowRefs.current.set(key, el);
        else weekRowRefs.current.delete(key);
    }, []);

    return (
        <Box
            ref={gridRef as React.RefObject<HTMLDivElement> | undefined}
            style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
                overflowX: isMobile ? 'auto' : 'hidden',
                overflowY: 'hidden',
                WebkitOverflowScrolling: 'touch' as any,
            }}
        >
            <Box style={{ ...(isMobile ? { minWidth: 770 } : {}), display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Weekday column headers + optional suffix header */}
            <Box style={{ display: 'flex', borderBottom: `1px solid ${palette.headerBorder}`, minHeight: 36, flexShrink: 0 }}>
                <Box style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: isMobile ? 'repeat(7, minmax(110px, 1fr))' : 'repeat(7, 1fr)' }}>
                    {weekdayHeaders.map((label) => (
                        <Box
                            key={label}
                            style={{
                                textAlign: 'center',
                                padding: '8px 0',
                                color: palette.textDim,
                                textTransform: 'uppercase',
                                fontSize: '0.68rem',
                                letterSpacing: '0.9px',
                                fontWeight: 700,
                                fontFamily: '"Inter", sans-serif',
                            }}
                        >
                            {label}
                        </Box>
                    ))}
                </Box>
                {hasSuffix && weekSuffixHeader && (
                    <Box style={{ width: weekSuffixWidth, flexShrink: 0, borderLeft: `1px solid ${palette.headerBorder}`, display: 'flex', alignItems: 'center' }}>
                        {weekSuffixHeader}
                    </Box>
                )}
            </Box>

            {/* Scrollable weeks container */}
            <Box
                ref={scrollRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    minHeight: 0,
                    scrollbarWidth: 'thin',
                }}
            >
                {weeks.map((week, weekIdx) => {
                    const monthLabel = monthHeaders.get(weekIdx);
                    return (
                        <Box key={week.key} ref={setWeekRowRef(week.key)}>
                            {/* Month boundary label */}
                            {monthLabel && (
                                <Box
                                    style={{
                                        padding: '8px 12px 4px',
                                        position: 'sticky',
                                        top: 0,
                                        zIndex: 10,
                                        background: palette.panelBg || palette.background,
                                        backdropFilter: 'blur(12px)',
                                        borderBottom: `1px solid ${palette.dayCellBorder || palette.headerBorder}`,
                                    }}
                                >
                                    <Text
                                        size="xs"
                                        fw={800}
                                        c={palette.textMain}
                                        style={{
                                            letterSpacing: '0.08em',
                                            textTransform: 'uppercase',
                                            fontFamily: '"Inter", sans-serif',
                                        }}
                                    >
                                        {monthLabel}
                                    </Text>
                                </Box>
                            )}

                            {/* Week row — 7 day cells + optional suffix */}
                            <Box style={{ display: 'flex', borderBottom: `1px solid ${palette.dayCellBorder || palette.headerBorder}` }}>
                            <Box
                                data-week-key={week.key}
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    display: 'grid',
                                    gridTemplateColumns: isMobile ? 'repeat(7, minmax(110px, 1fr))' : 'repeat(7, 1fr)',
                                    gridTemplateRows: '1fr',
                                    height: isMobile ? 120 : 110,
                                    ...(isMobile ? { minWidth: 770 } : {}),
                                }}
                            >
                                {week.days.map((day) => {
                                    const dateKey = format(day, 'yyyy-MM-dd');
                                    const dayEvents = eventsByDate.get(dateKey) || [];
                                    const isToday = dateKey === todayKey;
                                    const isSelected = selectedDateRange
                                        ? dateKey >= selectedDateRange.startDate && dateKey <= selectedDateRange.endDate
                                        : false;
                                    const isDragOver = dragOverDate === dateKey;
                                    const markers = planningMarkersByDate.get(dateKey) || [];
                                    const dayNotes = notesByDate?.get(dateKey);

                                    // Limit to 2 items total (activities + notes), show +N more
                                    const MAX_SHOWN = 2;
                                    const shownEvents = dayEvents.slice(0, MAX_SHOWN);
                                    const shownNotes = (dayNotes || []).slice(0, Math.max(0, MAX_SHOWN - shownEvents.length));
                                    const hiddenCount = (dayEvents.length - shownEvents.length) + ((dayNotes?.length || 0) - shownNotes.length);

                                    return (
                                        <Box
                                            key={dateKey}
                                            onClick={(e) => handleDayClick(day, e)}
                                            onDragOver={(e) => handleDayDragOver(e, dateKey)}
                                            onDrop={(e) => handleDayDrop(e, day)}
                                            onDragLeave={handleDayDragLeave}
                                            style={{
                                                borderLeft: `1px solid ${palette.dayCellBorder || palette.headerBorder}`,
                                                padding: 0,
                                                cursor: 'pointer',
                                                transition: 'background-color 0.16s ease',
                                                background: isDragOver
                                                    ? (isDark ? 'rgba(59, 130, 246, 0.18)' : 'rgba(59, 130, 246, 0.12)')
                                                    : isToday
                                                        ? (palette.todayBg || (isDark ? 'rgba(59, 130, 246, 0.08)' : 'rgba(59, 130, 246, 0.06)'))
                                                        : isSelected
                                                            ? (isDark ? 'rgba(59, 130, 246, 0.14)' : 'rgba(59, 130, 246, 0.10)')
                                                            : getMonth(day) % 2 === 0
                                                                ? (isDark ? 'rgba(30, 41, 66, 0.45)' : 'rgba(241, 245, 249, 0.70)')
                                                                : 'transparent',
                                                position: 'relative',
                                                height: '100%',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                overflow: 'hidden',
                                            }}
                                        >
                                            {/* Day header */}
                                            <Stack gap={2} p={4} style={{ flexShrink: 0 }}>
                                                <Group justify="space-between" align="flex-start" wrap="nowrap">
                                                    <Text
                                                        size="xs"
                                                        fw={700}
                                                        style={{
                                                            color: isToday ? (activityColors?.default || '#3B82F6') : palette.textDim,
                                                            opacity: isToday ? 1 : 0.72,
                                                            fontFamily: '"Inter", sans-serif',
                                                        }}
                                                    >
                                                        {getDate(day) === 1 ? format(day, 'MMM d') : format(day, 'd')}
                                                    </Text>
                                                    {dayNotes && dayNotes.length > 0 && shownNotes.length === 0 && (
                                                        <MessageSquareText size={12} style={{ color: isDark ? '#60A5FA' : '#3B82F6', flexShrink: 0, opacity: 0.8 }} />
                                                    )}
                                                </Group>
                                                {markers.length > 0 && (
                                                    <Group gap={4} wrap="nowrap">
                                                        {markers.slice(0, 3).map((marker, idx) => {
                                                            const visual = buildPlanningMarkerVisual(marker);
                                                            const Icon = visual.Icon;
                                                            return (
                                                                <Group
                                                                    key={`${dateKey}-${marker.label}-${idx}`}
                                                                    gap={3}
                                                                    wrap="nowrap"
                                                                    title={visual.title}
                                                                    style={{
                                                                        borderRadius: 999,
                                                                        padding: '2px 6px',
                                                                        background: isDark ? 'rgba(15, 23, 42, 0.78)' : 'rgba(255, 255, 255, 0.88)',
                                                                        border: `1px solid ${visual.color}55`,
                                                                        color: visual.color,
                                                                        width: 'fit-content',
                                                                    }}
                                                                >
                                                                    <Icon size={16} />
                                                                    {visual.shortLabel && (
                                                                        <Text size="11px" fw={800} c={visual.color} style={{ lineHeight: 1 }}>
                                                                            {visual.shortLabel}
                                                                        </Text>
                                                                    )}
                                                                </Group>
                                                            );
                                                        })}
                                                        {markers.length > 3 && (
                                                            <Text size="11px" fw={700} c={palette.textDim}>+{markers.length - 3}</Text>
                                                        )}
                                                    </Group>
                                                )}
                                            </Stack>

                                            {/* Events */}
                                            <Stack gap={1} px={2} pb={2} style={{ flex: 1, minHeight: 0 }}>
                                                {shownEvents.map((evt: any) => {
                                                    const resource = evt.resource as CalendarEvent;
                                                    const evtId = resource.id;
                                                    return (
                                                        <Box
                                                            key={evtId || `${dateKey}-${resource.title}`}
                                                            data-calendar-event
                                                            draggable={canEditWorkouts && resource.is_planned}
                                                            onDragStart={
                                                                canEditWorkouts && resource.is_planned && evtId
                                                                    ? (e) => handleEventDragStart(e, evtId)
                                                                    : undefined
                                                            }
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onSelectEvent(evt);
                                                            }}
                                                        >
                                                            <CalendarEventCard
                                                                event={evt}
                                                                activityColors={activityColors}
                                                                isDark={isDark}
                                                                palette={palette}
                                                                preferredUnits={preferredUnits}
                                                            />
                                                        </Box>
                                                    );
                                                })}
                                                {shownNotes.map((note: any, idx: number) => (
                                                    <Box
                                                        key={`note-${note.id || idx}`}
                                                        data-calendar-event
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onSelectEvent({ resource: { id: -2, date: dateKey, title: note.content, is_planned: false, _is_note: true } });
                                                        }}
                                                    >
                                                        <NoteChip note={note} isDark={isDark} palette={palette} />
                                                    </Box>
                                                ))}
                                                {hiddenCount > 0 && (
                                                    <Box
                                                        data-calendar-event
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            // Build a "+N more" event and pass it to onSelectEvent
                                                            onSelectEvent({
                                                                resource: {
                                                                    id: -1,
                                                                    date: dateKey,
                                                                    title: `+${hiddenCount}`,
                                                                    is_planned: false,
                                                                    is_more_indicator: true,
                                                                    hidden_count: hiddenCount,
                                                                },
                                                            });
                                                        }}
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            cursor: 'pointer',
                                                            padding: '2px 4px',
                                                        }}
                                                    >
                                                        <Box
                                                            style={{
                                                                width: 22,
                                                                height: 22,
                                                                borderRadius: 999,
                                                                border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(71, 85, 105, 0.35)'}`,
                                                                background: isDark ? 'rgba(62, 79, 111, 0.52)' : 'rgba(226, 232, 240, 0.9)',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                            }}
                                                        >
                                                            <Text size="10px" fw={800} c={palette.textMain}>+{hiddenCount}</Text>
                                                        </Box>
                                                    </Box>
                                                )}
                                            </Stack>
                                        </Box>
                                    );
                                })}
                            </Box>
                            {hasSuffix && (
                                <Box style={{ width: weekSuffixWidth, flexShrink: 0, borderLeft: `1px solid ${palette.dayCellBorder || palette.headerBorder}` }}>
                                    {renderWeekSuffix!({ start: week.start, end: addDays(week.start, 6), key: week.key }, weekIdx)}
                                </Box>
                            )}
                            </Box>
                        </Box>
                    );
                })}
            </Box>
            </Box>
        </Box>
    );
};

export default ContinuousCalendarGrid;

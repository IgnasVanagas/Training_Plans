import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { format, addDays, startOfWeek, addWeeks, getMonth, getYear } from 'date-fns';
import { CalendarEventCard } from './TrainingCalendarEventRenderers';
import { CalendarEvent } from './types';

/** How many weeks to render before/after the anchor week */
const BUFFER_WEEKS = 12;

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
    /** Notify parent of rendered week row heights */
    onWeekRowHeights?: (heights: number[]) => void;
    /** Notify parent of which weeks are visible (for sidebar) */
    onVisibleWeeks?: (weeks: Array<{ start: Date; end: Date; key: string }>) => void;
    selectedDateRange?: { startDate: string; endDate: string } | null;
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
    onWeekRowHeights,
    onVisibleWeeks,
    selectedDateRange,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const weekRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [anchorDate, setAnchorDate] = useState(viewDate);
    const suppressScrollUpdate = useRef(false);
    const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Stable ref so scroll handler doesn't depend on viewDate */
    const viewDateRef = useRef(viewDate);
    viewDateRef.current = viewDate;
    /** Tracks whether a viewDate change originated from the scroll handler */
    const scrollInitiated = useRef(false);
    /** Context for preserving visual position during edge re-anchors */
    const reAnchorContext = useRef<{ weekKey: string; scrollOffset: number } | null>(null);

    // Build the list of weeks to render
    const weeks = useMemo(
        () => buildWeeks(anchorDate, weekStartDay, BUFFER_WEEKS, BUFFER_WEEKS),
        [anchorDate, weekStartDay],
    );

    // The anchor week index (center)
    const anchorWeekIdx = BUFFER_WEEKS;

    // Group events by date for fast lookup
    const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

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

    /* ── scroll to anchor week (runs before paint to avoid flicker) ── */
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (reAnchorContext.current) {
            // Edge re-anchor: preserve visual scroll position
            const { weekKey, scrollOffset } = reAnchorContext.current;
            reAnchorContext.current = null;
            suppressFor(300);
            const row = weekRowRefs.current.get(weekKey);
            if (row) el.scrollTop = row.offsetTop + scrollOffset;
        } else {
            // External navigation or initial load: scroll to anchor
            const anchorRow = weekRowRefs.current.get(weeks[anchorWeekIdx]?.key);
            if (anchorRow) {
                suppressFor(300);
                el.scrollTop = anchorRow.offsetTop - 36; // minus header height
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [anchorDate]);

    /* ── When viewDate changes externally (header nav), re-anchor ── */
    useEffect(() => {
        // Skip re-anchoring when the viewDate change came from the scroll handler
        if (scrollInitiated.current) {
            scrollInitiated.current = false;
            return;
        }
        const vk = format(startOfWeek(viewDate, { weekStartsOn: weekStartDay as 0 | 1 }), 'yyyy-MM-dd');
        const ak = format(startOfWeek(anchorDate, { weekStartsOn: weekStartDay as 0 | 1 }), 'yyyy-MM-dd');
        if (vk !== ak) {
            setAnchorDate(viewDate);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewDate, weekStartDay]);

    /* ── scroll handler — update viewDate to match visible center ── */
    const handleScroll = useCallback(() => {
        if (suppressScrollUpdate.current) return;
        const el = scrollRef.current;
        if (!el) return;
        const scrollCenter = el.scrollTop + el.clientHeight / 2;
        let closest: { key: string; dist: number; start: Date } | null = null;
        weekRowRefs.current.forEach((row, key) => {
            const mid = row.offsetTop + row.offsetHeight / 2;
            const dist = Math.abs(mid - scrollCenter);
            if (!closest || dist < closest.dist) {
                const week = weeks.find((w) => w.key === key);
                if (week) closest = { key, dist, start: week.start };
            }
        });
        if (closest) {
            const ck = (closest as { key: string; dist: number; start: Date }).key;
            const cs = (closest as { key: string; dist: number; start: Date }).start;
            const currentAnchorKey = format(startOfWeek(viewDateRef.current, { weekStartsOn: weekStartDay as 0 | 1 }), 'yyyy-MM-dd');
            if (ck !== currentAnchorKey) {
                // Mark as scroll-originated so the viewDate sync effect skips re-anchoring
                scrollInitiated.current = true;
                onViewDateChange(cs);
            }

            // If near edges, re-anchor to get more buffer weeks (preserve scroll position)
            if (el.scrollTop < 200 || el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
                const refRow = weekRowRefs.current.get(ck);
                if (refRow) {
                    reAnchorContext.current = { weekKey: ck, scrollOffset: el.scrollTop - refRow.offsetTop };
                }
                setAnchorDate(cs);
            }
        }
    }, [weeks, weekStartDay, onViewDateChange, suppressFor]);

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
        };
    }, [handleScroll]);

    /* ── Measure & report week row heights ── */
    useEffect(() => {
        if (!onWeekRowHeights) return;
        const el = scrollRef.current;
        if (!el) return;
        const measure = () => {
            const viewWeekStart = startOfWeek(viewDate, { weekStartsOn: weekStartDay as 0 | 1 });
            const heights: number[] = [];
            for (let i = 0; i < visibleWeeks; i++) {
                const wk = format(addWeeks(viewWeekStart, i), 'yyyy-MM-dd');
                const row = weekRowRefs.current.get(wk);
                heights.push(row ? Math.round(row.getBoundingClientRect().height) : 0);
            }
            onWeekRowHeights(heights);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [viewDate, weekStartDay, visibleWeeks, onWeekRowHeights]);

    /* ── Notify parent of visible weeks ── */
    useEffect(() => {
        if (!onVisibleWeeks) return;
        const viewWeekStart = startOfWeek(viewDate, { weekStartsOn: weekStartDay as 0 | 1 });
        const result: Array<{ start: Date; end: Date; key: string }> = [];
        for (let i = 0; i < visibleWeeks; i++) {
            const ws = addWeeks(viewWeekStart, i);
            result.push({
                start: ws,
                end: addDays(ws, 6),
                key: format(ws, 'yyyy-MM-dd'),
            });
        }
        onVisibleWeeks(result);
    }, [viewDate, weekStartDay, visibleWeeks, onVisibleWeeks]);

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
                overflow: 'hidden',
            }}
        >
            {/* Weekday column headers */}
            <Box
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    borderBottom: `1px solid ${palette.headerBorder}`,
                    minHeight: 36,
                    flexShrink: 0,
                }}
            >
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

            {/* Scrollable weeks container */}
            <Box
                ref={scrollRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    minHeight: 0,
                    /* hide scrollbar for cleaner look */
                    scrollbarWidth: 'thin',
                }}
            >
                {weeks.map((week, weekIdx) => {
                    const monthLabel = monthHeaders.get(weekIdx);
                    return (
                        <React.Fragment key={week.key}>
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

                            {/* Week row — 7 day cells */}
                            <Box
                                ref={setWeekRowRef(week.key)}
                                data-week-key={week.key}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(7, 1fr)',
                                    borderBottom: `1px solid ${palette.dayCellBorder || palette.headerBorder}`,
                                    minHeight: 80,
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

                                    // Limit to 2 events, show +N more
                                    const shownEvents = dayEvents.slice(0, 2);
                                    const hiddenCount = dayEvents.length - 2;

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
                                                            : 'transparent',
                                                position: 'relative',
                                                minHeight: 80,
                                                display: 'flex',
                                                flexDirection: 'column',
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
                                                        {format(day, 'd')}
                                                    </Text>
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
                        </React.Fragment>
                    );
                })}
            </Box>
        </Box>
    );
};

export default ContinuousCalendarGrid;

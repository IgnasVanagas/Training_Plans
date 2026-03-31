import { format } from 'date-fns';
import { Activity, AlertTriangle, Award, Bandage, CalendarOff, CheckCircle, ChevronDown, Download, HelpCircle, HeartPulse, Medal, Moon, Pencil, Plane, Trash2, Trophy, X } from 'lucide-react';
import { ActionIcon, Alert, Box, Button, Container, Divider, Group, Menu, Modal, MultiSelect, NumberInput, Paper, Select, SimpleGrid, Stack, SegmentedControl, Text, TextInput, Textarea, ThemeIcon, Tooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkoutEditor } from '../builder/WorkoutEditor';
import api from '../../api/client';

import { CalendarEvent, WorkoutRecurrenceRule } from './types';
import { formatMinutesHm, parseDate } from './dateUtils';
import { DayEventItem } from './TrainingCalendarEventRenderers';
import { useI18n } from '../../i18n/I18nProvider';
import { getDayNotes, upsertDayNote, deleteDayNote, DayNote } from '../../api/dayNotes';
import { parseWorkoutText, isParseError } from './parseWorkoutText';

const weekdayOptions = (t: (value: string) => string) => [
  { value: '0', label: t('Monday') || 'Monday' },
  { value: '1', label: t('Tuesday') || 'Tuesday' },
  { value: '2', label: t('Wednesday') || 'Wednesday' },
  { value: '3', label: t('Thursday') || 'Thursday' },
  { value: '4', label: t('Friday') || 'Friday' },
  { value: '5', label: t('Saturday') || 'Saturday' },
  { value: '6', label: t('Sunday') || 'Sunday' },
];

const buildDefaultRecurrence = (dateValue?: string): WorkoutRecurrenceRule => {
  const parsedDate = dateValue ? parseDate(dateValue) : new Date();
  const weekday = Number.isNaN(parsedDate.getTime()) ? new Date().getDay() : parsedDate.getDay();
  const normalizedWeekday = (weekday + 6) % 7;
  return {
    frequency: 'weekly',
    interval_weeks: 1,
    weekdays: [normalizedWeekday],
    span_weeks: 12,
    exception_dates: [],
  };
};

const RecurringWorkoutFields = ({
  selectedEvent,
  setSelectedEvent,
  disabled,
}: {
  selectedEvent: Partial<CalendarEvent>;
  setSelectedEvent: (next: Partial<CalendarEvent>) => void;
  disabled?: boolean;
}) => {
  const { t } = useI18n();
  const recurrence = selectedEvent.recurrence || null;
  const mode = recurrence ? 'weekly' : 'once';

  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Box>
            <Text fw={600}>{t('Repeat workout') || 'Repeat workout'}</Text>
            <Text size="xs" c="dimmed">
              {t('Create a weekly series and skip specific dates when needed.') || 'Create a weekly series and skip specific dates when needed.'}
            </Text>
          </Box>
          <SegmentedControl
            value={mode}
            onChange={(value) => {
              if (value === 'once') {
                setSelectedEvent({ ...selectedEvent, recurrence: undefined });
                return;
              }
              setSelectedEvent({
                ...selectedEvent,
                recurrence: recurrence || buildDefaultRecurrence(selectedEvent.date),
              });
            }}
            data={[
              { label: t('One-time') || 'One-time', value: 'once' },
              { label: t('Weekly') || 'Weekly', value: 'weekly' },
            ]}
            disabled={disabled}
          />
        </Group>

        {recurrence && (
          <>
            <MultiSelect
              label={t('Weekdays') || 'Weekdays'}
              data={weekdayOptions(t)}
              value={(recurrence.weekdays || []).map((value) => String(value))}
              onChange={(value) => setSelectedEvent({
                ...selectedEvent,
                recurrence: {
                  ...recurrence,
                  weekdays: value.map((item) => Number(item)).sort((left, right) => left - right),
                },
              })}
              searchable={false}
              clearable={false}
              disabled={disabled}
            />

            <Group grow>
              <NumberInput
                label={t('Repeat every (weeks)') || 'Repeat every (weeks)'}
                min={1}
                max={12}
                value={recurrence.interval_weeks || 1}
                onChange={(value) => setSelectedEvent({
                  ...selectedEvent,
                  recurrence: {
                    ...recurrence,
                    interval_weeks: Math.max(1, typeof value === 'number' ? value : Number(value || 1)),
                  },
                })}
                disabled={disabled}
              />

              <NumberInput
                label={t('Total weeks') || 'Total weeks'}
                min={1}
                max={104}
                value={recurrence.span_weeks || 12}
                onChange={(value) => setSelectedEvent({
                  ...selectedEvent,
                  recurrence: {
                    ...recurrence,
                    span_weeks: Math.max(1, typeof value === 'number' ? value : Number(value || 12)),
                  },
                })}
                disabled={disabled}
              />
            </Group>

            <DatePickerInput
              type="multiple"
              label={t('Exception dates') || 'Exception dates'}
              description={t('Skip these dates without breaking the series.') || 'Skip these dates without breaking the series.'}
              value={(recurrence.exception_dates || []).map((value) => new Date(value))}
              onChange={(value) => setSelectedEvent({
                ...selectedEvent,
                recurrence: {
                  ...recurrence,
                  exception_dates: value
                    .filter((item): item is Date => item instanceof Date && !Number.isNaN(item.getTime()))
                    .map((item) => format(item, 'yyyy-MM-dd')),
                },
              })}
              disabled={disabled}
            />
          </>
        )}
      </Stack>
    </Paper>
  );
};

export const DayDetailsModal = ({
  opened,
  onClose,
  selectedDayTitle,
  dayEvents,
  selectedDateRange,
  planningMarkersByDate,
  isDark,
  athleteId,
  viewDate,
  onPlannedSelect,
  onDownloadPlannedWorkout,
  coachNeedsAthleteSelection,
  athleteOptions,
  selectedEvent,
  setSelectedEvent,
  setDayCreateError,
  quickWorkout,
  setQuickWorkout,
  canEditWorkouts,
  ensureAthleteSelectedForCreate,
  onQuickPlanningAction,
  planningActionPending,
  onSeasonPlanItemUpdate,
  seasonPlanUpdatePending,
  calendarSeasonPlan,
  onOpenWorkoutBuilder,
  onCreateQuickWorkout,
  onCreateRestDay,
  onLibrarySelect,
  dayCreateError,
  activityColors,
  palette,
  onDuplicateSelect,
  textWorkoutInput,
  setTextWorkoutInput,
  onCreateTextWorkout,
}: any) => {
  const { t } = useI18n();
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [createMode, setCreateMode] = useState<'quick' | 'text'>('text');
  const [editingMarker, setEditingMarker] = useState<{ type: string; index: number } | null>(null);
  const [editDraft, setEditDraft] = useState<any>(null);
  const [pendingRaceAction, setPendingRaceAction] = useState<{ type: 'goal_race'; priority: 'A' | 'B' | 'C'; label: string } | null>(null);
  const [pendingRaceDraft, setPendingRaceDraft] = useState<{ name: string; sport_type: string; distance_km: number | null; expected_time: string; location: string; notes: string } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const noteDateKey = selectedDateRange?.startDate || null;
  const notesQuery = useQuery({
    queryKey: ['day-notes', noteDateKey, athleteId],
    queryFn: () => getDayNotes(noteDateKey!, athleteId || undefined),
    enabled: opened && !!noteDateKey,
    staleTime: 30_000,
  });

  const upsertNoteMutation = useMutation({
    mutationFn: async (content: string) => upsertDayNote(noteDateKey!, content, athleteId || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['day-notes', noteDateKey, athleteId] });
      queryClient.invalidateQueries({ queryKey: ['day-notes-range'] });
      setNoteText('');
      setEditingNoteId(null);
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: number) => deleteDayNote(noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['day-notes', noteDateKey, athleteId] });
      queryClient.invalidateQueries({ queryKey: ['day-notes-range'] });
    },
  });

  // Reset note editing when modal closes
  useEffect(() => {
    if (!opened) {
      setNoteText('');
      setEditingNoteId(null);
    }
  }, [opened]);

  const isRangeSelection = Boolean(
    selectedDateRange?.startDate &&
    selectedDateRange?.endDate &&
    selectedDateRange.startDate !== selectedDateRange.endDate,
  );

  const dayMarkers = useMemo(() => {
    if (!planningMarkersByDate || !selectedDateRange?.startDate) return [];
    const markers: any[] = [];
    const seen = new Set<string>();
    let cursor = new Date(selectedDateRange.startDate + 'T00:00:00');
    const end = new Date((selectedDateRange.endDate || selectedDateRange.startDate) + 'T00:00:00');
    while (cursor <= end) {
      const key = format(cursor, 'yyyy-MM-dd');
      const items = planningMarkersByDate.get(key) || [];
      for (const m of items) {
        const uniqueKey = m.type === 'goal_race'
          ? `race-${m._raceIndex}`
          : `constraint-${m._constraintIndex}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          markers.push(m);
        }
      }
      cursor = new Date(cursor.getTime() + 86400000);
    }
    return markers;
  }, [planningMarkersByDate, selectedDateRange]);

  const startEditing = useCallback((marker: any) => {
    if (marker.type === 'goal_race') {
      const race = calendarSeasonPlan?.goal_races?.[marker._raceIndex];
      if (race) {
        setEditDraft({ ...race });
        setEditingMarker({ type: 'race', index: marker._raceIndex });
      }
    } else {
      const constraint = calendarSeasonPlan?.constraints?.[marker._constraintIndex];
      if (constraint) {
        setEditDraft({ ...constraint });
        setEditingMarker({ type: 'constraint', index: marker._constraintIndex });
      }
    }
  }, [calendarSeasonPlan]);

  const cancelEditing = useCallback(() => {
    setEditingMarker(null);
    setEditDraft(null);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingMarker || !editDraft || !onSeasonPlanItemUpdate) return;
    if (editingMarker.type === 'race') {
      onSeasonPlanItemUpdate({ type: 'update_race', index: editingMarker.index, data: editDraft });
    } else {
      onSeasonPlanItemUpdate({ type: 'update_constraint', index: editingMarker.index, data: editDraft });
    }
    setEditingMarker(null);
    setEditDraft(null);
  }, [editingMarker, editDraft, onSeasonPlanItemUpdate]);

  const deleteItem = useCallback((marker: any) => {
    if (!onSeasonPlanItemUpdate) return;
    if (marker.type === 'goal_race' && marker._raceIndex != null) {
      onSeasonPlanItemUpdate({ type: 'delete_race', index: marker._raceIndex });
    } else if (marker._constraintIndex != null) {
      onSeasonPlanItemUpdate({ type: 'delete_constraint', index: marker._constraintIndex });
    }
  }, [onSeasonPlanItemUpdate]);

  const planningOptions = useMemo(() => {
    const items = [
      { label: t('Travel') || 'Travel', icon: Plane, action: { type: 'constraint', kind: 'travel', label: t('Travel') || 'Travel', severity: 'moderate', impact: 'reduce' } },
      { label: t('Sickness') || 'Sickness', icon: HeartPulse, action: { type: 'constraint', kind: 'sickness', label: t('Sickness') || 'Sickness', severity: 'high', impact: 'rest' } },
      { label: t('Injury') || 'Injury', icon: Bandage, action: { type: 'constraint', kind: 'injury', label: t('Injury') || 'Injury', severity: 'high', impact: 'rest' } },
      { label: t('Holiday') || 'Holiday', icon: CalendarOff, action: { type: 'constraint', kind: 'unavailable', label: t('Holiday') || 'Holiday', severity: 'moderate', impact: 'reduce' } },
    ];

    if (isRangeSelection) {
      return items;
    }

    return [
      { label: t('A race') || 'A race', icon: Trophy, action: { type: 'goal_race', priority: 'A', label: t('A race') || 'A race' } },
      { label: t('B race') || 'B race', icon: Medal, action: { type: 'goal_race', priority: 'B', label: t('B race') || 'B race' } },
      { label: t('C race') || 'C race', icon: Award, action: { type: 'goal_race', priority: 'C', label: t('C race') || 'C race' } },
      ...items,
    ];
  }, [isRangeSelection, t]);

  return (
  <Modal
    opened={opened}
    onClose={onClose}
    title={selectedDayTitle}
    size="lg"
    fullScreen={isMobile}
    styles={{ content: { fontFamily: '"Inter", sans-serif' } }}
  >
    <Stack gap="md">
      {/* ── Planning markers (races, constraints) ── */}
      {dayMarkers.length > 0 && (
        <Stack gap="xs">
          {dayMarkers.map((marker: any, idx: number) => {
            const isRace = marker.type === 'goal_race';
            const markerIndex = isRace ? marker._raceIndex : marker._constraintIndex;
            const isEditing = editingMarker && (
              (isRace && editingMarker.type === 'race' && editingMarker.index === markerIndex) ||
              (!isRace && editingMarker.type === 'constraint' && editingMarker.index === markerIndex)
            );
            const IconComp = isRace
              ? (marker.priority === 'A' ? Trophy : marker.priority === 'B' ? Medal : Award)
              : (marker.kind === 'travel' ? Plane : marker.kind === 'sickness' ? HeartPulse : marker.kind === 'injury' ? Bandage : CalendarOff);
            const color = isRace
              ? (marker.priority === 'A' ? '#DC2626' : marker.priority === 'B' ? '#D97706' : '#2563EB')
              : (marker.kind === 'travel' ? '#0EA5E9' : marker.kind === 'sickness' ? '#DC2626' : marker.kind === 'injury' ? '#F97316' : '#7C3AED');

            if (isEditing && editDraft) {
              return (
                <Paper key={`marker-edit-${idx}`} withBorder radius="md" p="sm" style={{ borderLeft: `3px solid ${color}` }}>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <IconComp size={18} color={color} />
                        <Text fw={600} size="sm">{isRace ? (t('Edit race') || 'Edit race') : (t('Edit constraint') || 'Edit constraint')}</Text>
                      </Group>
                      <Group gap={4}>
                        <ActionIcon size="sm" variant="light" color="green" onClick={saveEdit} loading={seasonPlanUpdatePending}>
                          <CheckCircle size={14} />
                        </ActionIcon>
                        <ActionIcon size="sm" variant="subtle" onClick={cancelEditing}>
                          <X size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>
                    {isRace ? (
                      <>
                        <SimpleGrid cols={2}>
                          <TextInput label={t('Race name') || 'Race name'} value={editDraft.name || ''} onChange={(e) => setEditDraft({ ...editDraft, name: e.currentTarget.value })} />
                          <TextInput label={t('Race date') || 'Race date'} type="date" value={editDraft.date || ''} onChange={(e) => setEditDraft({ ...editDraft, date: e.currentTarget.value })} />
                        </SimpleGrid>
                        <SimpleGrid cols={3}>
                          <Select label={t('Priority') || 'Priority'} data={['A', 'B', 'C']} value={editDraft.priority || 'C'} onChange={(v) => v && setEditDraft({ ...editDraft, priority: v })} />
                          <Select label={t('Sport') || 'Sport'} data={[{ value: 'Cycling', label: t('Cycling') || 'Cycling' }, { value: 'Running', label: t('Running') || 'Running' }]} value={editDraft.sport_type || ''} onChange={(v) => setEditDraft({ ...editDraft, sport_type: v || '' })} clearable placeholder={t('Select sport') || 'Select sport'} />
                          <TextInput label={t('Location') || 'Location'} value={editDraft.location || ''} onChange={(e) => setEditDraft({ ...editDraft, location: e.currentTarget.value })} />
                        </SimpleGrid>
                        <SimpleGrid cols={2}>
                          <NumberInput label={t('Distance') || 'Distance'} value={editDraft.distance_km ?? ''} onChange={(v) => setEditDraft({ ...editDraft, distance_km: typeof v === 'number' ? v : null })} min={0} step={0.1} suffix=" km" />
                          <TextInput label={t('Expected time') || 'Expected time'} placeholder="hh:mm:ss" value={editDraft.expected_time || ''} onChange={(e) => setEditDraft({ ...editDraft, expected_time: e.currentTarget.value })} />
                        </SimpleGrid>
                        <Textarea label={t('Details') || 'Details'} minRows={2} value={editDraft.notes || ''} onChange={(e) => setEditDraft({ ...editDraft, notes: e.currentTarget.value })} />
                      </>
                    ) : (
                      <>
                        <SimpleGrid cols={2}>
                          <TextInput label={t('Label') || 'Label'} value={editDraft.name || ''} onChange={(e) => setEditDraft({ ...editDraft, name: e.currentTarget.value })} />
                          <Select label={t('Type') || 'Type'} data={[
                            { value: 'injury', label: t('Injury') || 'Injury' },
                            { value: 'travel', label: t('Travel') || 'Travel' },
                            { value: 'sickness', label: t('Sickness') || 'Sickness' },
                            { value: 'unavailable', label: t('Unavailable') || 'Unavailable' },
                          ]} value={editDraft.kind || 'travel'} onChange={(v) => v && setEditDraft({ ...editDraft, kind: v })} />
                        </SimpleGrid>
                        <SimpleGrid cols={2}>
                          <TextInput label={t('Start') || 'Start'} type="date" value={editDraft.start_date || ''} onChange={(e) => setEditDraft({ ...editDraft, start_date: e.currentTarget.value })} />
                          <TextInput label={t('End') || 'End'} type="date" value={editDraft.end_date || ''} onChange={(e) => setEditDraft({ ...editDraft, end_date: e.currentTarget.value })} />
                        </SimpleGrid>
                        <SimpleGrid cols={2}>
                          <Select label={t('Severity') || 'Severity'} data={[
                            { value: 'low', label: t('Low') || 'Low' },
                            { value: 'moderate', label: t('Moderate') || 'Moderate' },
                            { value: 'high', label: t('High') || 'High' },
                          ]} value={editDraft.severity || 'moderate'} onChange={(v) => v && setEditDraft({ ...editDraft, severity: v })} />
                          <Select label={t('Impact') || 'Impact'} data={[
                            { value: 'reduce', label: t('Reduce load') || 'Reduce load' },
                            { value: 'avoid_intensity', label: t('Avoid intensity') || 'Avoid intensity' },
                            { value: 'rest', label: t('Rest only') || 'Rest only' },
                          ]} value={editDraft.impact || 'reduce'} onChange={(v) => v && setEditDraft({ ...editDraft, impact: v })} />
                        </SimpleGrid>
                        <Textarea label={t('Notes') || 'Notes'} minRows={2} value={editDraft.notes || ''} onChange={(e) => setEditDraft({ ...editDraft, notes: e.currentTarget.value })} />
                      </>
                    )}
                  </Stack>
                </Paper>
              );
            }

            return (
              <Paper key={`marker-${idx}`} withBorder radius="md" p="sm" style={{ borderLeft: `3px solid ${color}` }}>
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <IconComp size={20} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Group gap="xs" wrap="nowrap">
                      <Text fw={600} size="sm">{marker.label}</Text>
                      {isRace && <Text size="xs" c={color} fw={700}>{t('Priority') || 'Priority'} {marker.priority}</Text>}
                      {!isRace && marker.severity && <Text size="xs" c="dimmed" tt="capitalize">{marker.severity} · {marker.impact}</Text>}
                    </Group>
                    {isRace && (
                      <Group gap="md" mt={4}>
                        {marker.sport_type && <Text size="xs" c="dimmed">{marker.sport_type}</Text>}
                        {marker.distance_km != null && <Text size="xs" c="dimmed">{marker.distance_km} km</Text>}
                        {marker.expected_time && <Text size="xs" c="dimmed">{marker.expected_time}</Text>}
                        {marker.location && <Text size="xs" c="dimmed">{marker.location}</Text>}
                      </Group>
                    )}
                    {!isRace && marker.start_date && marker.end_date && marker.start_date !== marker.end_date && (
                      <Text size="xs" c="dimmed" mt={2}>{marker.start_date} — {marker.end_date}</Text>
                    )}
                    {marker.notes && <Text size="xs" c="dimmed" mt={2}>{marker.notes}</Text>}
                  </Box>
                  {canEditWorkouts && markerIndex != null && (
                    <Group gap={4} style={{ flexShrink: 0 }}>
                      <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => startEditing(marker)} title={t('Edit') || 'Edit'}>
                        <Pencil size={14} />
                      </ActionIcon>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => deleteItem(marker)} loading={seasonPlanUpdatePending} title={t('Delete') || 'Delete'}>
                        <Trash2 size={14} />
                      </ActionIcon>
                    </Group>
                  )}
                </Group>
              </Paper>
            );
          })}
        </Stack>
      )}
      {(() => {
        const selectedDate = selectedEvent?.date ? new Date(selectedEvent.date) : null;
        const normalizedSelected = selectedDate ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()) : null;
        const today = new Date();
        const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const isPastCreationDate = Boolean(normalizedSelected && normalizedSelected < normalizedToday);

        return (
          <>
            {dayEvents.length > 0 && (
              dayEvents.map((evt: CalendarEvent) => (
                <DayEventItem
                  key={evt.id ?? `${evt.date}-${evt.title}`}
                  r={evt}
                  isDark={isDark}
                  activityColors={activityColors}
                  palette={palette}
                  athleteId={athleteId}
                  viewDate={viewDate}
                  onPlannedSelect={(event) => {
                    onPlannedSelect(event);
                    onClose();
                  }}
                  onCloseDayModal={onClose}
                  onDownloadPlannedWorkout={onDownloadPlannedWorkout}
                  onDuplicateSelect={onDuplicateSelect}
                />
              ))
            )}

            {!isPastCreationDate && (
              <>
                {coachNeedsAthleteSelection && (
                  <Select
                    label={t('Assign to Athlete') || 'Assign to Athlete'}
                    placeholder={t('Select athlete') || 'Select athlete'}
                    data={athleteOptions}
                    value={selectedEvent.user_id?.toString()}
                    onChange={(val) => {
                      setSelectedEvent({ ...selectedEvent, user_id: val ? Number(val) : undefined });
                      setDayCreateError(null);
                    }}
                    searchable
                  />
                )}

                {!isRangeSelection && (
                  <>
                    {/* ── Workout creation card ── */}
                    <Box
                      style={{
                        borderRadius: 12,
                        border: `1px solid ${isDark ? 'rgba(0,195,245,0.22)' : 'rgba(0,145,181,0.18)'}`,
                        overflow: 'hidden',
                        background: isDark ? 'rgba(0,195,245,0.025)' : 'rgba(0,145,181,0.02)',
                      }}
                    >
                      <Box
                        style={{
                          padding: '10px 14px',
                          borderBottom: `1px solid ${isDark ? 'rgba(0,195,245,0.12)' : 'rgba(0,145,181,0.10)'}`,
                          background: isDark ? 'rgba(0,195,245,0.06)' : 'rgba(0,145,181,0.045)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          flexWrap: 'wrap',
                        }}
                      >
                        <Text
                          size="xs"
                          fw={800}
                          tt="uppercase"
                          style={{ letterSpacing: '0.07em', color: isDark ? '#00c3f5' : '#007a96', whiteSpace: 'nowrap' }}
                        >
                          {t('Add Workout') || 'Add Workout'}
                        </Text>
                        <SegmentedControl
                          value={createMode}
                          onChange={(val: any) => setCreateMode(val)}
                          data={[
                            { label: '✦ Text Builder', value: 'text' },
                            { label: t('Quick') || 'Quick', value: 'quick' },
                          ]}
                          size="xs"
                          styles={{ root: { background: 'transparent' } }}
                        />
                      </Box>

                      <Box p="md">
                        {createMode === 'text' && (() => {
                          const textParseResult = textWorkoutInput?.trim() ? parseWorkoutText(textWorkoutInput, quickWorkout.sport_type) : null;
                          const textParseOk = textParseResult && !isParseError(textParseResult) ? textParseResult : null;
                          const textParseErr = textParseResult && isParseError(textParseResult) ? textParseResult : null;
                          return (
                            <Stack gap="sm">
                              <Select
                                label={t('Sport') || 'Sport'}
                                data={['Cycling', 'Running', 'Strength Training']}
                                value={quickWorkout.sport_type}
                                onChange={(value) => {
                                  if (!value) return;
                                  setQuickWorkout({ ...quickWorkout, sport_type: value });
                                }}
                              />
                              <Textarea
                                label={
                                  <Group gap={4} align="center">
                                    <span>{t('Workout shorthand') || 'Workout shorthand'}</span>
                                    <Tooltip
                                      label={
                                        <Stack gap={4}>
                                          <Text size="xs" fw={600}>{'Supported syntax'}</Text>
                                          <Text size="xs">{'Durations: 15min, 5km, 800m, 2h, 30s'}</Text>
                                          <Text size="xs">{'Intervals: 3x5min@200w/4min'}</Text>
                                          <Text size="xs">{'Targets: @200w @4:30 @Z3 @150bpm @RPE7'}</Text>
                                          <Text size="xs">{'Keywords: wu, cd, rest (or auto-detected)'}</Text>
                                          <Text size="xs">{'Separate segments with +'}</Text>
                                          <Text size="xs" c="dimmed" mt={2}>{'Examples:'}</Text>
                                          <Text size="xs" ff="monospace">{'15min wu + 3x5min@200w/4min + 10min cd'}</Text>
                                          <Text size="xs" ff="monospace">{'15min + 5x1km/1min + 10min'}</Text>
                                        </Stack>
                                      }
                                      multiline
                                      w={300}
                                      position="top"
                                      withArrow
                                    >
                                      <span style={{ display: 'inline-flex', cursor: 'help' }}>
                                        <HelpCircle size={14} style={{ opacity: 0.5 }} />
                                      </span>
                                    </Tooltip>
                                  </Group>
                                }
                                placeholder="e.g. 15min + 3x5min@200w/4min + 10min"
                                value={textWorkoutInput || ''}
                                onChange={(e) => setTextWorkoutInput(e.currentTarget.value)}
                                autosize
                                minRows={2}
                                maxRows={4}
                                styles={{ input: { fontFamily: 'monospace', fontSize: '13px' } }}
                              />
                              {textParseOk && (
                                <Paper withBorder p="xs" radius="md" style={{ borderLeft: '3px solid #22c55e' }}>
                                  <Group gap="xs">
                                    <CheckCircle size={14} style={{ color: '#22c55e' }} />
                                    <Text size="sm" fw={600}>{textParseOk.title} {quickWorkout.sport_type}</Text>
                                  </Group>
                                  <Text size="xs" c="dimmed" mt={2}>
                                    {textParseOk.structure.length} {t('steps') || 'steps'} · ~{textParseOk.durationMinutes}{t('min') || 'min'}
                                  </Text>
                                </Paper>
                              )}
                              {textParseErr && (
                                <Text size="xs" c="red">{textParseErr.error}</Text>
                              )}
                              <Group grow>
                                <Button
                                  leftSection={<Activity size={15} />}
                                  variant="subtle"
                                  c="#E95A12"
                                  onClick={() => {
                                    if (!canEditWorkouts) return;
                                    if (!ensureAthleteSelectedForCreate()) return;
                                    onClose();
                                    onOpenWorkoutBuilder();
                                  }}
                                  disabled={!canEditWorkouts}
                                >
                                  {t('Open Workout Builder') || 'Open Workout Builder'}
                                </Button>
                                <Button
                                  onClick={onCreateTextWorkout}
                                  disabled={!canEditWorkouts || !textParseOk}
                                  styles={{ root: { background: '#E95A12', border: 'none' } }}
                                >
                                  {t('Add Workout') || 'Add Workout'}
                                </Button>
                              </Group>
                            </Stack>
                          );
                        })()}

                        {createMode === 'quick' && (
                          <Stack gap="sm">
                            <SimpleGrid cols={2}>
                              <Select
                                label={t('Sport') || 'Sport'}
                                data={['Cycling', 'Running', 'Strength Training']}
                                value={quickWorkout.sport_type}
                                onChange={(value) => {
                                  if (!value) return;
                                  const zoneMax = value === 'Running' ? 5 : 7;
                                  const nextZone = Math.min(quickWorkout.zone, zoneMax);
                                  setQuickWorkout({ ...quickWorkout, sport_type: value, zone: nextZone });
                                }}
                              />
                              {quickWorkout.sport_type !== 'Strength Training' && (
                                <NumberInput
                                  label={t('Zone') || 'Zone'}
                                  min={1}
                                  max={quickWorkout.sport_type === 'Running' ? 5 : 7}
                                  value={quickWorkout.zone}
                                  onChange={(value) => {
                                    const numericValue = typeof value === 'number' ? value : Number(value || 1);
                                    const zoneMax = quickWorkout.sport_type === 'Running' ? 5 : 7;
                                    setQuickWorkout({ ...quickWorkout, zone: Math.max(1, Math.min(zoneMax, numericValue)) });
                                  }}
                                />
                              )}
                            </SimpleGrid>

                            {quickWorkout.sport_type === 'Strength Training' ? (
                              <SimpleGrid cols={2}>
                                <NumberInput
                                  label="RPE"
                                  min={1}
                                  max={10}
                                  value={quickWorkout.zone}
                                  onChange={(value) => {
                                    const numericValue = typeof value === 'number' ? value : Number(value || 5);
                                    setQuickWorkout({ ...quickWorkout, zone: Math.max(1, Math.min(10, numericValue)) });
                                  }}
                                />
                                <Group grow align="end">
                                  <NumberInput
                                    label={t('Hours') || 'Hours'}
                                    min={0}
                                    step={1}
                                    value={Math.floor((quickWorkout.minutes || 0) / 60)}
                                    onChange={(value) => {
                                      const hours = Math.max(0, typeof value === 'number' ? value : Number(value || 0));
                                      const rem = Math.max(0, (quickWorkout.minutes || 0) % 60);
                                      setQuickWorkout({ ...quickWorkout, minutes: Math.max(5, Math.round(hours * 60 + rem)) });
                                    }}
                                  />
                                  <NumberInput
                                    label={t('Minutes') || 'Minutes'}
                                    min={0}
                                    max={59}
                                    step={5}
                                    value={Math.max(0, (quickWorkout.minutes || 0) % 60)}
                                    description={formatMinutesHm(quickWorkout.minutes)}
                                    onChange={(value) => {
                                      const mins = Math.max(0, Math.min(59, typeof value === 'number' ? value : Number(value || 0)));
                                      const hours = Math.floor((quickWorkout.minutes || 0) / 60);
                                      setQuickWorkout({ ...quickWorkout, minutes: Math.max(5, Math.round(hours * 60 + mins)) });
                                    }}
                                  />
                                </Group>
                              </SimpleGrid>
                            ) : (
                              <SimpleGrid cols={2}>
                                <Select
                                  label={t('Quick Workout Type') || 'Quick Workout Type'}
                                  data={[
                                    { value: 'time', label: t('Time in Zone') || 'Time in Zone' },
                                    { value: 'distance', label: t('Distance in Zone (km)') || 'Distance in Zone (km)' },
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
                                      label={t('Hours') || 'Hours'}
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
                                      label={t('Minutes') || 'Minutes'}
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
                                    label={t('Distance (km)') || 'Distance (km)'}
                                    min={1}
                                    step={0.5}
                                    value={quickWorkout.distanceKm}
                                    onChange={(value) => {
                                      const numericValue = typeof value === 'number' ? value : Number(value || 0);
                                      setQuickWorkout({ ...quickWorkout, distanceKm: Math.max(1, numericValue) });
                                    }}
                                  />
                                )}
                              </SimpleGrid>
                            )}

                            <Group grow>
                              <Button
                                leftSection={<Activity size={15} />}
                                variant="subtle"
                                c="#E95A12"
                                onClick={() => {
                                  if (!canEditWorkouts) return;
                                  if (!ensureAthleteSelectedForCreate()) return;
                                  onClose();
                                  onOpenWorkoutBuilder();
                                }}
                                disabled={!canEditWorkouts}
                              >
                                {t('Open Workout Builder') || 'Open Workout Builder'}
                              </Button>
                              <Button
                                onClick={onCreateQuickWorkout}
                                disabled={!canEditWorkouts}
                                styles={{ root: { background: '#E95A12', border: 'none' } }}
                              >
                                {t('Add Workout') || 'Add Workout'}
                              </Button>
                            </Group>
                          </Stack>
                        )}

                      </Box>
                    </Box>

                    <RecurringWorkoutFields
                        selectedEvent={selectedEvent}
                        setSelectedEvent={setSelectedEvent}
                        disabled={!canEditWorkouts}
                      />

                    <Button
                      variant="subtle"
                      color="gray"
                      leftSection={<Moon size={16} />}
                      fullWidth
                      onClick={onCreateRestDay}
                      disabled={!canEditWorkouts}
                    >
                      {t('Rest Day') || 'Rest Day'}
                    </Button>
                  </>
                )}

                {/* ── Calendar planning actions ── */}
                <Stack gap="xs">
                  <Divider
                    label={
                      <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.06em' }} c="dimmed">
                        {isRangeSelection ? (t('Plan this range') || 'Plan this range') : (t('Plan this day') || 'Plan this day')}
                      </Text>
                    }
                    labelPosition="left"
                  />
                  <Text size="xs" c="dimmed">
                    {isRangeSelection
                      ? (t('Save this date range as travel, sickness, injury, or holiday for planning.') || 'Save this date range as travel, sickness, injury, or holiday for planning.')
                      : (t('Add a goal race or availability marker directly from the calendar.') || 'Add a goal race or availability marker directly from the calendar.')}
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    {planningOptions.map((option) => (
                      <Button
                        key={option.label}
                        variant={pendingRaceAction?.priority === (option.action as any).priority && option.action.type === 'goal_race' ? 'filled' : 'subtle'}
                        color="gray"
                        size="xs"
                        leftSection={<option.icon size={13} />}
                        onClick={() => {
                          if (option.action.type === 'goal_race') {
                            setPendingRaceAction(option.action as any);
                            setPendingRaceDraft({ name: '', sport_type: '', distance_km: null, expected_time: '', location: '', notes: '' });
                          } else {
                            setPendingRaceAction(null);
                            onQuickPlanningAction(option.action);
                          }
                        }}
                        loading={planningActionPending}
                        disabled={!canEditWorkouts || planningActionPending}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Group>

                  {pendingRaceAction && pendingRaceDraft && (
                    <Paper withBorder radius="md" p="sm">
                      <Stack gap="xs">
                        <Text fw={600} size="sm">
                          {pendingRaceAction.priority === 'A' ? t('A race') || 'A race' : pendingRaceAction.priority === 'B' ? t('B race') || 'B race' : t('C race') || 'C race'}
                          {' — '}{t('Race details') || 'Race details'}
                        </Text>
                        <SimpleGrid cols={2}>
                          <TextInput
                            label={t('Race name') || 'Race name'}
                            placeholder={t('Race name') || 'Race name'}
                            value={pendingRaceDraft.name}
                            onChange={(e) => setPendingRaceDraft({ ...pendingRaceDraft, name: e.currentTarget.value })}
                          />
                          <Select
                            label={t('Sport') || 'Sport'}
                            data={[
                              { value: 'Cycling', label: t('Cycling') || 'Cycling' },
                              { value: 'Running', label: t('Running') || 'Running' },
                              { value: 'Triathlon', label: t('Triathlon') || 'Triathlon' },
                              { value: 'Swimming', label: t('Swimming') || 'Swimming' },
                            ]}
                            value={pendingRaceDraft.sport_type || null}
                            onChange={(v) => setPendingRaceDraft({ ...pendingRaceDraft, sport_type: v || '' })}
                            clearable
                            placeholder={t('Select sport') || 'Select sport'}
                          />
                        </SimpleGrid>
                        <SimpleGrid cols={2}>
                          <NumberInput
                            label={t('Distance') || 'Distance'}
                            value={pendingRaceDraft.distance_km ?? ''}
                            onChange={(v) => setPendingRaceDraft({ ...pendingRaceDraft, distance_km: typeof v === 'number' ? v : null })}
                            min={0}
                            step={0.1}
                            suffix=" km"
                          />
                          <TextInput
                            label={t('Expected time') || 'Expected time'}
                            placeholder="hh:mm:ss"
                            value={pendingRaceDraft.expected_time}
                            onChange={(e) => setPendingRaceDraft({ ...pendingRaceDraft, expected_time: e.currentTarget.value })}
                          />
                        </SimpleGrid>
                        <TextInput
                          label={t('Location') || 'Location'}
                          placeholder={t('Location') || 'Location'}
                          value={pendingRaceDraft.location}
                          onChange={(e) => setPendingRaceDraft({ ...pendingRaceDraft, location: e.currentTarget.value })}
                        />
                        <Textarea
                          label={t('Details') || 'Details'}
                          minRows={2}
                          value={pendingRaceDraft.notes}
                          onChange={(e) => setPendingRaceDraft({ ...pendingRaceDraft, notes: e.currentTarget.value })}
                        />
                        <Group justify="flex-end" gap="xs">
                          <Button variant="subtle" size="xs" onClick={() => setPendingRaceAction(null)}>
                            {t('Cancel') || 'Cancel'}
                          </Button>
                          <Button
                            size="xs"
                            onClick={() => {
                              onQuickPlanningAction({
                                ...pendingRaceAction,
                                label: pendingRaceDraft.name || pendingRaceAction.label,
                                sport_type: pendingRaceDraft.sport_type || undefined,
                                distance_km: pendingRaceDraft.distance_km,
                                expected_time: pendingRaceDraft.expected_time || undefined,
                                location: pendingRaceDraft.location || undefined,
                                notes: pendingRaceDraft.notes || undefined,
                              });
                              setPendingRaceAction(null);
                            }}
                            loading={planningActionPending}
                          >
                            {t('Add race') || 'Add race'}
                          </Button>
                        </Group>
                      </Stack>
                    </Paper>
                  )}
                </Stack>

                {!canEditWorkouts && <Text c="dimmed" size="sm">{t('Coach has disabled workout editing for your account.') || 'Coach has disabled workout editing for your account.'}</Text>}
                {dayCreateError && <Text c="red" size="sm">{dayCreateError}</Text>}
              </>
            )}

            {/* ── Day Notes ── */}
            <Stack gap="xs">
              <Divider
                label={
                  <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.06em' }} c="dimmed">
                    {t('Day notes') || 'Day notes'}
                  </Text>
                }
                labelPosition="left"
              />
              {(notesQuery.data || []).map((note: DayNote) => (
                <Paper key={note.id} withBorder radius="md" p="xs" style={{ borderLeft: '3px solid var(--mantine-color-blue-5)' }}>
                  {editingNoteId === note.id ? (
                    <Stack gap="xs">
                      <Textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.currentTarget.value)}
                        minRows={2}
                        autosize
                      />
                      <Group justify="flex-end" gap="xs">
                        <Button variant="subtle" size="xs" onClick={() => { setEditingNoteId(null); setNoteText(''); }}>
                          {t('Cancel') || 'Cancel'}
                        </Button>
                        <Button size="xs" onClick={() => upsertNoteMutation.mutate(noteText)} loading={upsertNoteMutation.isPending} disabled={!noteText.trim()}>
                          {t('Save') || 'Save'}
                        </Button>
                      </Group>
                    </Stack>
                  ) : (
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" mb={2}>
                          <Text size="xs" fw={600} c="blue">{note.author_name || '?'}</Text>
                          <Text size="xs" c="dimmed">{note.author_role === 'coach' ? (t('Coach') || 'Coach') : (t('Athlete') || 'Athlete')}</Text>
                        </Group>
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{note.content}</Text>
                      </Box>
                      <Group gap={4} style={{ flexShrink: 0 }}>
                        <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => { setEditingNoteId(note.id); setNoteText(note.content); }} title={t('Edit') || 'Edit'}>
                          <Pencil size={14} />
                        </ActionIcon>
                        <ActionIcon size="sm" variant="subtle" color="red" onClick={() => deleteNoteMutation.mutate(note.id)} loading={deleteNoteMutation.isPending} title={t('Delete') || 'Delete'}>
                          <Trash2 size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>
                  )}
                </Paper>
              ))}
              {editingNoteId === null && (
                <Group gap="xs" align="flex-end">
                  <Textarea
                    placeholder={t('Add a note for this day...') || 'Add a note for this day...'}
                    value={noteText}
                    onChange={(e) => setNoteText(e.currentTarget.value)}
                    minRows={1}
                    autosize
                    style={{ flex: 1 }}
                  />
                  <Button size="xs" variant="light" onClick={() => upsertNoteMutation.mutate(noteText)} loading={upsertNoteMutation.isPending} disabled={!noteText.trim()}>
                    {t('Add note') || 'Add note'}
                  </Button>
                </Group>
              )}
            </Stack>
          </>
        );
      })()}
    </Stack>
  </Modal>
  );
};

export const BulkEditModal = ({
  opened,
  onClose,
  weeksInMonth,
  bulkWeekKey,
  setBulkWeekKey,
  athleteOptions,
  bulkAthleteScope,
  setBulkAthleteScope,
  bulkShiftDays,
  setBulkShiftDays,
  bulkDurationScale,
  setBulkDurationScale,
  bulkZoneDelta,
  setBulkZoneDelta,
  bulkApplying,
  onApply,
}: any) => (
  <Modal opened={opened} onClose={onClose} title="Bulk Edit Training Week" size="md">
    <Stack>
      <Text size="sm" c="dimmed">Apply one change across a full week with one action. Preview scope first, then commit.</Text>
      <Select
        label="Week"
        data={weeksInMonth.map((week: any) => ({
          value: week.key,
          label: `${format(week.start, 'MMM d')} - ${format(week.end, 'MMM d')}`,
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
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button loading={bulkApplying} onClick={onApply} disabled={!bulkWeekKey}>Apply Changes</Button>
      </Group>
    </Stack>
  </Modal>
);

export const WorkoutEditModal = ({
  opened,
  onClose,
  selectedEvent,
  saveError,
  athleteOptions,
  setSelectedEvent,
  athleteName,
  athleteProfile,
  canDeleteWorkouts,
  canEditWorkouts,
  deleteMutation,
  handleSave,
}: any) => {
  const { t } = useI18n();
  const isMobileEdit = useMediaQuery('(max-width: 48em)');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDownloadWorkout = () => {
    if (!selectedEvent.title && !selectedEvent.structure?.length) return;
    const steps = selectedEvent.structure || [];
    const sportMap: Record<string, string> = { running: 'run', cycling: 'bike', swimming: 'swim' };
    const sport = sportMap[(selectedEvent.sport_type || '').toLowerCase()] || 'other';

    const renderStep = (step: any, indent: string): string => {
      if (step.type === 'repeat') {
        const inner = (step.steps || []).map((s: any) => renderStep(s, indent + '    ')).join('\n');
        return `${indent}<Repeat>${step.repeats || 1}</Repeat>\n${inner}`;
      }
      const dur = step.duration;
      let durTag = '';
      if (dur?.type === 'time' && dur.value) durTag = `<Duration>${dur.value}</Duration>`;
      else if (dur?.type === 'distance' && dur.value) durTag = `<Distance>${dur.value}</Distance>`;
      else durTag = '<Duration>0</Duration>';

      const target = step.target;
      let targetTags = '';
      if (target?.type === 'heart_rate_zone' && target.zone) {
        const zones: Record<number, [number, number]> = { 1: [0.5, 0.6], 2: [0.6, 0.7], 3: [0.7, 0.8], 4: [0.8, 0.9], 5: [0.9, 1.0] };
        const [lo, hi] = zones[target.zone] || [0, 1];
        targetTags = `<FlatRide><PercentHR>${lo}</PercentHR></FlatRide>`;
      } else if (target?.type === 'power' && target.min != null && target.max != null) {
        const avg = ((target.min + target.max) / 2) / (athleteProfile?.ftp || 200);
        targetTags = `<FlatRide><Power>${avg.toFixed(2)}</Power></FlatRide>`;
      } else {
        targetTags = '<FlatRide><Power>0.50</Power></FlatRide>';
      }

      const catMap: Record<string, string> = { warmup: 'Warmup', work: 'SteadyState', recovery: 'Cooldown', cooldown: 'Cooldown' };
      const tag = catMap[step.category] || 'SteadyState';
      return `${indent}<${tag}>${durTag}${targetTags}</${tag}>`;
    };

    const stepsXml = steps.map((s: any) => renderStep(s, '    ')).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<workout_file>\n  <name>${(selectedEvent.title || 'Workout').replace(/[<>&]/g, '')}</name>\n  <description>${(selectedEvent.description || '').replace(/[<>&]/g, '')}</description>\n  <sportType>${sport}</sportType>\n  <workout>\n${stepsXml}\n  </workout>\n</workout_file>`;

    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(selectedEvent.title || 'workout').replace(/[^a-zA-Z0-9_-]/g, '_')}.zwo`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadFit = async () => {
    if (!selectedEvent.id) return;
    try {
      const response = await api.get(`/calendar/${selectedEvent.id}/download-fit`, { responseType: 'blob' });
      const disposition = response.headers['content-disposition'] || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `${(selectedEvent.title || 'workout').replace(/[^a-zA-Z0-9_-]/g, '_')}.fit`;
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent fail — workout may not have structure
    }
  };

  return (
  <Modal
    opened={opened}
    onClose={onClose}
    title={selectedEvent.id ? (t('Edit Workout') || 'Edit Workout') : (t('Plan Workout') || 'Plan Workout')}
    size="90%"
    fullScreen={isMobileEdit}
    centered={!isMobileEdit}
    styles={{
      content: { maxWidth: '1200px', maxHeight: isMobileEdit ? undefined : '92vh', overflow: 'auto', fontFamily: '"Inter", sans-serif' },
      body: { overflowX: 'hidden' },
    }}
    transitionProps={{ transition: 'fade', duration: 200 }}
  >
    <Container fluid p={0}>
      <Stack gap="sm" mb="md">
        {saveError && <Alert color="orange" variant="light">{saveError}</Alert>}
        <Group grow>
          {athleteOptions.length > 0 && (
            <Select
              label={t('Assign to Athlete') || 'Assign to Athlete'}
              placeholder={t('Select athlete') || 'Select athlete'}
              data={athleteOptions}
              value={selectedEvent.user_id?.toString()}
              onChange={(val) => setSelectedEvent({ ...selectedEvent, user_id: val ? Number(val) : undefined })}
              searchable
            />
          )}

          <DatePickerInput
            label={t('Date') || 'Date'}
            value={selectedEvent.date ? new Date(selectedEvent.date) : null}
            onChange={(value: Date | null) => {
              if (!value) return;
              setSelectedEvent({ ...selectedEvent, date: format(value, 'yyyy-MM-dd') });
            }}
          />
        </Group>

        {!selectedEvent.id && (
          <RecurringWorkoutFields
            selectedEvent={selectedEvent}
            setSelectedEvent={setSelectedEvent}
            disabled={!canEditWorkouts}
          />
        )}

        {selectedEvent.id && selectedEvent.recurrence && (
          <Paper withBorder p="sm" radius="md">
            <Text fw={600}>{t('Recurring workout') || 'Recurring workout'}</Text>
            <Text size="xs" c="dimmed">
              {(t('This workout belongs to a weekly series. Editing here changes only this occurrence, so you can use it as an exception.') || 'This workout belongs to a weekly series. Editing here changes only this occurrence, so you can use it as an exception.')}
            </Text>
          </Paper>
        )}
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
        borderColor: 'var(--mantine-color-default-border)',
      }}
    >
      <Group justify="flex-end">
        {selectedEvent.id && canDeleteWorkouts && (
          <Button
            color="red"
            variant="light"
            mr="auto"
            loading={deleteMutation.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            {t('Delete Workout') || 'Delete Workout'}
          </Button>
        )}
        {selectedEvent.id && selectedEvent.structure?.length > 0 && (
          <Menu position="top-end" withinPortal>
            <Menu.Target>
              <Button
                variant="light"
                leftSection={<Download size={16} />}
                rightSection={<ChevronDown size={14} />}
              >
                {t('Download') || 'Download'}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={handleDownloadFit}>
                {t('FIT file (Garmin, Wahoo)') || 'FIT file (Garmin, Wahoo)'}
              </Menu.Item>
              <Menu.Item onClick={handleDownloadWorkout}>
                {t('ZWO file (Zwift, TrainerRoad)') || 'ZWO file (Zwift, TrainerRoad)'}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
        <Button variant="default" onClick={onClose}>{t('Cancel') || 'Cancel'}</Button>
        <Button
          onClick={handleSave}
          leftSection={<CheckCircle size={16} />}
          disabled={!canEditWorkouts}
          radius={4}
          style={{
            background: '#E95A12',
            border: 'none',
          }}
        >
          {t('Save Workout') || 'Save Workout'}
        </Button>
      </Group>
    </Paper>

    <Modal
      opened={confirmDelete}
      onClose={() => setConfirmDelete(false)}
      title={
        <Group gap="xs">
          <ThemeIcon size="md" radius="xl" variant="light" color="red">
            <AlertTriangle size={14} />
          </ThemeIcon>
          <Text fw={700} size="sm">{t('Delete Workout') || 'Delete Workout'}</Text>
        </Group>
      }
      centered
      radius="md"
      size="sm"
      overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t('Are you sure you want to delete this planned workout? This action cannot be undone.') || 'Are you sure you want to delete this planned workout? This action cannot be undone.'}
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" size="sm" onClick={() => setConfirmDelete(false)}>
            {t('Cancel') || 'Cancel'}
          </Button>
          <Button color="red" size="sm" loading={deleteMutation.isPending} onClick={() => {
            if (!selectedEvent.id) return;
            deleteMutation.mutate(selectedEvent.id);
            setConfirmDelete(false);
          }}>
            {t('Confirm') || 'Confirm'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  </Modal>
  );
};

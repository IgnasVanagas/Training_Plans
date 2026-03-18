import { format } from 'date-fns';
import { Activity, Award, Bandage, CalendarOff, CheckCircle, HeartPulse, Medal, Plane, Trophy } from 'lucide-react';
import { Alert, Box, Button, Container, Divider, Group, Modal, MultiSelect, NumberInput, Paper, Select, Stack, SegmentedControl, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useMemo, useState } from 'react';
import { WorkoutEditor } from '../builder/WorkoutEditor';
import { WorkoutLibrary } from '../library/WorkoutLibrary';
import { CalendarEvent, WorkoutRecurrenceRule } from './types';
import { formatMinutesHm, parseDate } from './dateUtils';
import { DayEventItem } from './TrainingCalendarEventRenderers';
import { useI18n } from '../../i18n/I18nProvider';

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
        <Group justify="space-between" align="flex-end">
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
  onOpenWorkoutBuilder,
  onCreateQuickWorkout,
  onLibrarySelect,
  dayCreateError,
  activityColors,
  palette,
}: any) => {
  const { t } = useI18n();
  const [createMode, setCreateMode] = useState<'quick' | 'library'>('quick');
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
      const key = cursor.toISOString().slice(0, 10);
      const items = planningMarkersByDate.get(key) || [];
      for (const m of items) {
        const id = `${m.type}-${m.label}-${key}`;
        if (!seen.has(id)) {
          seen.add(id);
          markers.push(m);
        }
      }
      cursor = new Date(cursor.getTime() + 86400000);
    }
    return markers;
  }, [planningMarkersByDate, selectedDateRange]);

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
    styles={{ content: { fontFamily: '"Inter", sans-serif' } }}
  >
    <Stack>
      {dayMarkers.length > 0 && (
        <Stack gap="xs">
          {dayMarkers.map((marker: any, idx: number) => {
            const isRace = marker.type === 'goal_race';
            const IconComp = isRace
              ? (marker.priority === 'A' ? Trophy : marker.priority === 'B' ? Medal : Award)
              : (marker.kind === 'travel' ? Plane : marker.kind === 'sickness' ? HeartPulse : marker.kind === 'injury' ? Bandage : CalendarOff);
            const color = isRace
              ? (marker.priority === 'A' ? '#DC2626' : marker.priority === 'B' ? '#D97706' : '#2563EB')
              : (marker.kind === 'travel' ? '#0EA5E9' : marker.kind === 'sickness' ? '#DC2626' : marker.kind === 'injury' ? '#F97316' : '#7C3AED');

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
                    mb="xs"
                  />
                )}

                <Stack gap="xs" mb="sm">
                  <Text fw={600}>{t('Calendar actions') || 'Calendar actions'}</Text>
                  <Text size="sm" c="dimmed">
                    {isRangeSelection
                      ? (t('Save this date range as travel, sickness, injury, or holiday for planning.') || 'Save this date range as travel, sickness, injury, or holiday for planning.')
                      : (t('Add a goal race or availability marker directly from the calendar.') || 'Add a goal race or availability marker directly from the calendar.')}
                  </Text>
                  <Group gap="xs">
                    {planningOptions.map((option) => (
                      <Button
                        key={option.label}
                        variant="light"
                        size="xs"
                        leftSection={<option.icon size={14} />}
                        onClick={() => onQuickPlanningAction(option.action)}
                        loading={planningActionPending}
                        disabled={!canEditWorkouts || planningActionPending}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Group>
                </Stack>

                {!isRangeSelection && (
                  <>
                    <Divider my="xs" />

                    <SegmentedControl 
                        value={createMode}
                        onChange={(val: any) => setCreateMode(val)}
                        data={[
                            { label: t('Create Workout') || 'Create Workout', value: 'quick' },
                            { label: t('Library') || 'Library', value: 'library' }
                        ]}
                        fullWidth
                        mb="sm"
                    />

                    <RecurringWorkoutFields
                      selectedEvent={selectedEvent}
                      setSelectedEvent={setSelectedEvent}
                      disabled={!canEditWorkouts}
                    />

                    {createMode === 'quick' ? (
                      <>
                    <Group grow>
                      <Select
                        label={t('Sport') || 'Sport'}
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
                    </Group>

                    <Group grow>
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
                    </Group>

                    <Group grow>
                      <Button
                        leftSection={<Activity size={16} />}
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
                      </>
                    ) : (
                        <Box h={400} style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 4 }}>
                             <WorkoutLibrary 
                                 onSelect={(workout) => {
                                     if (!canEditWorkouts) return;
                                     if (!ensureAthleteSelectedForCreate()) return;
                                     onLibrarySelect(workout);
                                     onClose();
                                 }}
                             />
                        </Box>
                    )}
                  </>
                )}

                {!canEditWorkouts && <Text c="dimmed" size="sm">{t('Coach has disabled workout editing for your account.') || 'Coach has disabled workout editing for your account.'}</Text>}
                {dayCreateError && <Text c="red" size="sm">{dayCreateError}</Text>}
              </>
            )}
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

  return (
  <Modal
    opened={opened}
    onClose={onClose}
    title={selectedEvent.id ? (t('Edit Workout') || 'Edit Workout') : (t('Plan Workout') || 'Plan Workout')}
    size="90%"
    centered
    styles={{
      content: { maxWidth: '1200px', maxHeight: '92vh', overflow: 'auto', fontFamily: '"Inter", sans-serif' },
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
            onClick={() => {
              if (!selectedEvent.id) return;
              deleteMutation.mutate(selectedEvent.id);
            }}
          >
            {t('Delete Workout') || 'Delete Workout'}
          </Button>
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
  </Modal>
  );
};

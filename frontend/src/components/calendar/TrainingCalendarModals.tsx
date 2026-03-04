import { format } from 'date-fns';
import { Activity, CheckCircle } from 'lucide-react';
import { Alert, Box, Button, Container, Divider, Group, Modal, NumberInput, Paper, Select, Stack, SegmentedControl, Text } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useState } from 'react';
import { WorkoutEditor } from '../builder/WorkoutEditor';
import { WorkoutLibrary } from '../library/WorkoutLibrary';
import { CalendarEvent } from './types';
import { formatMinutesHm } from './dateUtils';
import { DayEventItem } from './TrainingCalendarEventRenderers';

export const DayDetailsModal = ({
  opened,
  onClose,
  selectedDayTitle,
  dayEvents,
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
  onOpenWorkoutBuilder,
  onCreateQuickWorkout,
  onLibrarySelect,
  dayCreateError,
  activityColors,
  palette,
}: any) => {
  const [createMode, setCreateMode] = useState<'quick' | 'library'>('quick');

  return (
  <Modal
    opened={opened}
    onClose={onClose}
    title={selectedDayTitle}
    size="lg"
    styles={{ content: { fontFamily: '"Inter", sans-serif' } }}
  >
    <Stack>
      {(() => {
        const selectedDate = selectedEvent?.date ? new Date(selectedEvent.date) : null;
        const normalizedSelected = selectedDate ? new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()) : null;
        const today = new Date();
        const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const isPastCreationDate = Boolean(normalizedSelected && normalizedSelected < normalizedToday);

        return (
          <>
            {dayEvents.length === 0 ? (
              <Text c="dimmed" size="sm" ta="center" py="md">No activities for this day.</Text>
            ) : (
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
                    mb="xs"
                  />
                )}

                <SegmentedControl 
                    value={createMode}
                    onChange={(val: any) => setCreateMode(val)}
                    data={[
                        { label: 'Quick Workout', value: 'quick' },
                        { label: 'Library', value: 'library' }
                    ]}
                    fullWidth
                    mb="sm"
                />

                {createMode === 'quick' ? (
                  <>
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
                      { value: 'distance', label: 'Distance in Zone (km)' },
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
                    Open Workout Builder
                  </Button>

                  <Button
                    onClick={onCreateQuickWorkout}
                    disabled={!canEditWorkouts}
                    styles={{ root: { background: '#E95A12', border: 'none' } }}
                  >
                    Add Quick Workout
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

                {!canEditWorkouts && <Text c="dimmed" size="sm">Coach has disabled workout editing for your account.</Text>}
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
}: any) => (
  <Modal
    opened={opened}
    onClose={onClose}
    title={selectedEvent.id ? 'Edit Workout' : 'Plan Workout'}
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
            onChange={(value: Date | null) => {
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
            Delete Workout
          </Button>
        )}
        <Button variant="default" onClick={onClose}>Cancel</Button>
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
          Save Workout
        </Button>
      </Group>
    </Paper>
  </Modal>
);

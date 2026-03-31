import { Alert, Badge, Button, Group, NumberInput, Paper, SegmentedControl, Select, Stack, Text, TextInput, Textarea, ThemeIcon, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { Dropzone, FileWithPath } from '@mantine/dropzone';
import { IconCheck, IconFile, IconRocket, IconUpload, IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../api/client';
import { createManualActivity } from '../../api/activities';
import { useI18n } from '../../i18n/I18nProvider';

type Props = {
  onUploaded?: () => void;
};

function parseDuration(value: string): number | null {
  const parts = value.split(':').map(Number);
  if (parts.length === 3 && parts.every((p) => !isNaN(p))) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts.every((p) => !isNaN(p))) {
    return parts[0] * 3600 + parts[1] * 60;
  }
  return null;
}

export default function ActivityUploadPanel({ onUploaded }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'upload' | 'manual'>('upload');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showCompletionPulse, setShowCompletionPulse] = useState(false);
  const [reflection, setReflection] = useState('');

  // Manual form state
  const [sport, setSport] = useState('running');
  const [manualDate, setManualDate] = useState<Date | null>(new Date());
  const [durationStr, setDurationStr] = useState('');
  const [distance, setDistance] = useState<number | string>('');
  const [avgHr, setAvgHr] = useState<number | string>('');
  const [rpe, setRpe] = useState<number | string>('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const sportOptions = [
    { value: 'running', label: t('Running') || 'Running' },
    { value: 'cycling', label: t('Cycling') || 'Cycling' },
    { value: 'swimming', label: t('Swimming') || 'Swimming' },
    { value: 'triathlon', label: t('Triathlon') || 'Triathlon' },
    { value: 'strength_training', label: t('Strength Training') || 'Strength Training' },
    { value: 'other', label: t('Other') || 'Other' },
  ];

  const isStrength = sport === 'strength_training';

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/activities/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      setUploadError(null);
      setShowCompletionPulse(true);
      notifications.show({
        color: 'teal',
        title: 'Workout captured',
        message: 'Session saved. Add a quick reflection so your coach can adapt tomorrow’s plan.',
        position: 'bottom-right'
      });
      window.setTimeout(() => setShowCompletionPulse(false), 1200);
      onUploaded?.();
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail || 'Upload failed';
      const lowered = String(detail).toLowerCase();
      if (lowered.includes('garmin')) {
        setUploadError('Garmin is taking longer than usual. Your workout is safe and we’ll keep retrying in the background.');
        return;
      }
      if (lowered.includes('format') || lowered.includes('parse')) {
        setUploadError('We could not read this file format yet. Try a fresh FIT/GPX export and we’ll keep your progress intact.');
        return;
      }
      setUploadError('We hit a sync issue, but your momentum is not lost. Try again in a moment.');
    }
  });

  const handleDrop = (files: FileWithPath[]) => {
    if (files.length > 0) uploadMutation.mutate(files[0]);
  };

  const manualMutation = useMutation({
    mutationFn: createManualActivity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      setManualError(null);
      setShowCompletionPulse(true);
      notifications.show({
        color: 'teal',
        title: t('Activity saved') || 'Activity saved',
        message: t('Manual activity logged successfully.') || 'Manual activity logged successfully.',
        position: 'bottom-right'
      });
      window.setTimeout(() => setShowCompletionPulse(false), 1200);
      setDurationStr('');
      setDistance('');
      setAvgHr('');
      setRpe('');
      setManualNotes('');
      onUploaded?.();
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail || 'Failed to save activity';
      setManualError(String(detail));
    }
  });

  const handleManualSubmit = () => {
    setManualError(null);
    const seconds = parseDuration(durationStr);
    if (!seconds || seconds <= 0) {
      setManualError(t('Enter a valid duration (hh:mm:ss)') || 'Enter a valid duration (hh:mm:ss)');
      return;
    }
    if (!manualDate) {
      setManualError(t('Select a date') || 'Select a date');
      return;
    }
    const dateStr = `${manualDate.getFullYear()}-${String(manualDate.getMonth() + 1).padStart(2, '0')}-${String(manualDate.getDate()).padStart(2, '0')}`;
    manualMutation.mutate({
      sport,
      date: dateStr,
      duration: seconds,
      distance: distance !== '' ? Number(distance) : undefined,
      average_hr: avgHr !== '' ? Number(avgHr) : undefined,
      rpe: rpe !== '' ? Number(rpe) : undefined,
      notes: manualNotes.trim() || undefined,
    });
  };

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={mode}
        onChange={(v) => setMode(v as 'upload' | 'manual')}
        data={[
          { value: 'upload', label: t('Upload file') || 'Upload file' },
          { value: 'manual', label: t('Log manually') || 'Log manually' },
        ]}
        fullWidth
      />

      {mode === 'upload' ? (
        <>
          <Paper withBorder p="md" radius="md" shadow="sm" style={{ fontFamily: '"Inter", sans-serif' }}>
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Group gap="sm">
                  <ThemeIcon color="orange" variant="light" radius="xl" size="lg">
                    <IconUpload size={18} />
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Title order={3}>{t('Upload Activity') || 'Upload Activity'}</Title>
                    <Text size="sm" c="dimmed">{t('Bring in your latest session from FIT or GPX in one step.') || 'Bring in your latest session from FIT or GPX in one step.'}</Text>
                  </Stack>
                </Group>
                <Group gap={6}>
                  <Badge variant="light" color="gray">FIT</Badge>
                  <Badge variant="light" color="gray">GPX</Badge>
                  <Badge variant="light" color="gray">10MB max</Badge>
                </Group>
              </Group>

              <Dropzone
                onDrop={handleDrop}
                onReject={() => setUploadError('File rejected. Please upload a valid FIT or GPX file under 10MB.')}
                maxSize={10 * 1024 * 1024}
                p="xl"
                radius="md"
                bg="var(--mantine-color-body)"
                style={{
                  border: '1px dashed var(--mantine-color-orange-4)',
                  cursor: 'pointer',
                  transition: 'all 180ms ease'
                }}
              >
                <Group justify="center" gap="lg" mih={170} style={{ pointerEvents: 'none' }}>
                  <Dropzone.Accept>
                    <ThemeIcon size={54} radius="xl" color="teal" variant="light">
                      <IconCheck size={28} />
                    </ThemeIcon>
                  </Dropzone.Accept>
                  <Dropzone.Reject>
                    <ThemeIcon size={54} radius="xl" color="red" variant="light">
                      <IconX size={28} />
                    </ThemeIcon>
                  </Dropzone.Reject>
                  <Dropzone.Idle>
                    <ThemeIcon size={54} radius="xl" color="orange" variant="light">
                      <IconFile size={28} />
                    </ThemeIcon>
                  </Dropzone.Idle>

                  <Stack gap={2} align="center">
                    <Text size="lg" fw={600} ta="center">{t('Drop your activity file here') || 'Drop your activity file here'}</Text>
                    <Text size="sm" c="dimmed" ta="center">{t('or click to browse files from your device') || 'or click to browse files from your device'}</Text>
                  </Stack>
                </Group>
              </Dropzone>
            </Stack>
          </Paper>

          {uploadError && (
            <Alert color="orange" variant="light" title="Sync paused">
              {uploadError}
            </Alert>
          )}
          {uploadMutation.isPending && <Text>{t('Uploading and processing...') || 'Uploading and processing...'}</Text>}
        </>
      ) : (
        <Paper withBorder p="md" radius="md" shadow="sm">
          <Stack gap="sm">
            <Select
              label={t('Sport') || 'Sport'}
              data={sportOptions}
              value={sport}
              onChange={(v) => v && setSport(v)}
            />
            <DateInput
              label={t('Date') || 'Date'}
              value={manualDate}
              onChange={setManualDate}
              maxDate={new Date()}
            />
            <TextInput
              label={t('Duration') || 'Duration'}
              placeholder="hh:mm:ss"
              value={durationStr}
              onChange={(e) => setDurationStr(e.currentTarget.value)}
              required
            />
            {!isStrength && (
              <NumberInput
                label={`${t('Distance') || 'Distance'} (km)`}
                value={distance}
                onChange={setDistance}
                min={0}
                decimalScale={2}
                step={0.1}
              />
            )}
            {!isStrength && (
              <NumberInput
                label={`${t('Average heart rate') || 'Average heart rate'} (bpm)`}
                value={avgHr}
                onChange={setAvgHr}
                min={20}
                max={250}
              />
            )}
            <NumberInput
              label="RPE"
              value={rpe}
              onChange={setRpe}
              min={1}
              max={10}
            />
            <Textarea
              label={t('Notes') || 'Notes'}
              placeholder={t('How did the session feel?') || 'How did the session feel?'}
              value={manualNotes}
              onChange={(e) => setManualNotes(e.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={4}
            />
            {manualError && (
              <Alert color="red" variant="light">
                {manualError}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setMode('upload')}>
                {t('Cancel') || 'Cancel'}
              </Button>
              <Button color="orange" loading={manualMutation.isPending} onClick={handleManualSubmit}>
                {t('Save activity') || 'Save activity'}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {showCompletionPulse && (
        <Paper withBorder p="sm" radius="md" bg="teal.0" style={{ transition: 'all 220ms ease' }}>
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconCheck size={16} color="teal" />
              <Text fw={600} size="sm">{t('Activity saved') || 'Activity saved'}</Text>
            </Group>
            <IconRocket size={16} color="teal" />
          </Group>
        </Paper>
      )}

      <Paper withBorder p="sm" radius="md">
        <Text size="sm" fw={600}>{t('Coach feedback loop') || 'Coach feedback loop'}</Text>
        <Text size="xs" c="dimmed" mb={6}>{t('How did this session feel? A short note helps your coach tune your next workout.') || 'How did this session feel? A short note helps your coach tune your next workout.'}</Text>
        <Group>
          <TextInput
            value={reflection}
            onChange={(e) => setReflection(e.currentTarget.value)}
            placeholder={t('RPE, mood, soreness (optional)') || 'RPE, mood, soreness (optional)'}
            flex={1}
          />
          <Button
            size="xs"
            variant="subtle"
            color="orange"
            onClick={() => {
              notifications.show({
                color: 'blue',
                title: t('Coach notified') || 'Coach notified',
                message: reflection.trim()
                  ? t('Reflection sent. Your coach can respond with plan adjustments.') || 'Reflection sent. Your coach can respond with plan adjustments.'
                  : t('Session sent to coach as On Plan. Add reflection anytime.') || 'Session sent to coach as On Plan. Add reflection anytime.',
                position: 'bottom-right'
              });
              setReflection('');
            }}
          >
            {t('Send') || 'Send'}
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}

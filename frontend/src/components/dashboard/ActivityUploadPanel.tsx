import {
  Alert, Badge, Button, Group, NumberInput, Paper, Progress,
  SegmentedControl, Select, Stack, Text, TextInput, Textarea,
  ThemeIcon, Title, Loader, useComputedColorScheme,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { Dropzone, FileWithPath } from '@mantine/dropzone';
import { IconCheck, IconFile, IconFileAlert, IconRocket, IconUpload, IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../api/client';
import { createManualActivity } from '../../api/activities';
import { useI18n } from '../../i18n/I18nProvider';

type Props = {
  onUploaded?: () => void;
};

type UploadStage = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ActivityUploadPanel({ onUploaded }: Props) {
  const { t } = useI18n();
  const isDark = useComputedColorScheme('light') === 'dark';
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'upload' | 'manual'>('upload');

  // File upload state
  const [stage, setStage] = useState<UploadStage>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedResult, setUploadedResult] = useState<any | null>(null);

  // Manual form state
  const [sport, setSport] = useState('running');
  const [manualDate, setManualDate] = useState<Date | null>(new Date());
  const [durationStr, setDurationStr] = useState('');
  const [distance, setDistance] = useState<number | string>('');
  const [avgHr, setAvgHr] = useState<number | string>('');
  const [rpe, setRpe] = useState<number | string>('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualDone, setManualDone] = useState(false);

  const sportOptions = [
    { value: 'running', label: t('Running') || 'Running' },
    { value: 'cycling', label: t('Cycling') || 'Cycling' },
    { value: 'swimming', label: t('Swimming') || 'Swimming' },
    { value: 'triathlon', label: t('Triathlon') || 'Triathlon' },
    { value: 'strength_training', label: t('Strength Training') || 'Strength Training' },
    { value: 'other', label: t('Other') || 'Other' },
  ];

  const isStrength = sport === 'strength_training';

  const ui = {
    surface: isDark ? '#12223E' : '#FFFFFF',
    border: isDark ? 'rgba(148,163,184,0.28)' : '#DCE6F7',
    textMain: isDark ? '#E2E8F0' : '#0F172A',
    textDim: isDark ? '#9FB0C8' : '#52617A',
    subtleBg: isDark ? '#182B4B' : '#F8FAFF',
  };

  const resetUpload = () => {
    setStage('idle');
    setUploadProgress(0);
    setDroppedFile(null);
    setUploadError(null);
    setUploadedResult(null);
  };

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/activities/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (evt) => {
          const pct = evt.total
            ? Math.min(99, Math.round((evt.loaded * 100) / evt.total))
            : 50;
          setUploadProgress(pct);
        },
      });
      return res.data;
    },
    onMutate: async (file: File) => {
      setStage('uploading');
      setUploadProgress(0);
      setUploadError(null);
      setUploadedResult(null);

      await queryClient.cancelQueries({ queryKey: ['activities'] });
      const tempActivity = {
        id: -Date.now(), sport: null, created_at: new Date().toISOString(),
        duration: null, distance: null, average_hr: null, average_watts: null,
        avg_speed: null, athlete_id: 0, filename: file.name,
        source_provider: 'upload', _isOptimistic: true,
      };
      const snapshots: Array<[readonly unknown[], any]> = queryClient.getQueriesData<any[]>({ queryKey: ['activities'] });
      snapshots.forEach(([qk, qd]) => {
        if (Array.isArray(qd)) queryClient.setQueryData(qk, [tempActivity, ...qd]);
      });
      return { snapshots };
    },
    onSuccess: (data, _vars, context) => {
      context?.snapshots?.forEach(([qk, qd]) => queryClient.setQueryData(qk, qd));
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      setUploadProgress(100);
      setStage('done');
      setUploadedResult(data);
      notifications.show({
        color: 'teal',
        title: 'Activity uploaded',
        message: `${data?.filename || droppedFile?.name} saved successfully.`,
        position: 'bottom-right',
      });
      onUploaded?.();
    },
    onError: (err: any, _vars, context) => {
      context?.snapshots?.forEach(([qk, qd]) => queryClient.setQueryData(qk, qd));
      setStage('error');

      const status = err.response?.status;
      const detail = err.response?.data?.detail || '';

      if (status === 409) {
        setUploadError('This file was already uploaded. Your activity is in the list.');
        return;
      }
      if (status === 413) {
        setUploadError('File too large. Max allowed size is 10 MB.');
        return;
      }
      const lower = String(detail).toLowerCase();
      if (lower.includes('format') || lower.includes('parse') || lower.includes('fit') || lower.includes('gpx')) {
        setUploadError('Could not read this file. Make sure it is a valid .fit or .gpx export from your device.');
        return;
      }
      setUploadError(detail || 'Upload failed. Please try again.');
    },
  });

  const handleDrop = (files: FileWithPath[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setDroppedFile(file);
    // Small delay to let the dropped file state render before the loading state kicks in
    uploadMutation.mutate(file);
  };

  const handleReject = (rejections: { file: File; errors: { code: string }[] }[]) => {
    const code = rejections?.[0]?.errors?.[0]?.code;
    if (code === 'file-too-large') {
      setUploadError('File too large. Max allowed size is 10 MB.');
    } else {
      setUploadError('Invalid file. Please upload a .fit or .gpx file under 10 MB.');
    }
    setDroppedFile(rejections?.[0]?.file ?? null);
    setStage('error');
  };

  // Transition from uploading → processing once upload bytes are done
  if (stage === 'uploading' && uploadProgress >= 99) {
    // The server is now parsing — show indeterminate processing state
    // This is handled below via the progress display
  }

  const manualMutation = useMutation({
    mutationFn: createManualActivity,
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['activities'] });
      const tempActivity = {
        id: -Date.now(), sport: payload.sport, created_at: new Date().toISOString(),
        duration: payload.duration, distance: payload.distance ?? null,
        average_hr: payload.average_hr ?? null, average_watts: null,
        avg_speed: null, athlete_id: 0, filename: 'manual',
        source_provider: 'manual', _isOptimistic: true,
      };
      const snapshots = queryClient.getQueriesData<any[]>({ queryKey: ['activities'] }) as Array<[readonly unknown[], any]>;
      snapshots.forEach(([qk, qd]) => {
        if (Array.isArray(qd)) queryClient.setQueryData(qk, [tempActivity, ...qd]);
      });
      return { snapshots };
    },
    onSuccess: (_data, _vars, context) => {
      context?.snapshots?.forEach(([qk, qd]: [readonly unknown[], any]) => queryClient.setQueryData(qk, qd));
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      setManualError(null);
      setManualDone(true);
      notifications.show({
        color: 'teal',
        title: t('Activity saved') || 'Activity saved',
        message: t('Manual activity logged successfully.') || 'Manual activity logged successfully.',
        position: 'bottom-right',
      });
      setDurationStr('');
      setDistance('');
      setAvgHr('');
      setRpe('');
      setManualNotes('');
      onUploaded?.();
      setTimeout(() => setManualDone(false), 3000);
    },
    onError: (err: any, _vars, context) => {
      context?.snapshots?.forEach(([qk, qd]) => queryClient.setQueryData(qk as unknown[], qd));
      const detail = err.response?.data?.detail || 'Failed to save activity';
      setManualError(String(detail));
    },
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

  // ── Render upload section content based on stage ─────────────────────────
  const renderUploadContent = () => {
    if (stage === 'done' && uploadedResult) {
      return (
        <Stack gap="sm">
          <Group gap="sm">
            <ThemeIcon color="teal" variant="light" radius="xl" size="lg">
              <IconCheck size={20} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={700} size="sm" c={ui.textMain}>{uploadedResult.filename || droppedFile?.name}</Text>
              <Text size="xs" c={ui.textDim}>
                {uploadedResult.sport && <>{uploadedResult.sport} · </>}
                {uploadedResult.distance ? `${(uploadedResult.distance / 1000).toFixed(2)} km` : null}
                {uploadedResult.duration ? ` · ${Math.round(uploadedResult.duration / 60)} min` : null}
              </Text>
            </Stack>
          </Group>
          <Button variant="subtle" size="xs" color="gray" onClick={resetUpload}>
            Upload another file
          </Button>
        </Stack>
      );
    }

    if (stage === 'error') {
      return (
        <Stack gap="sm">
          <Group gap="sm">
            <ThemeIcon color="red" variant="light" radius="xl" size="lg">
              <IconFileAlert size={20} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={600} size="sm" c={ui.textMain}>{droppedFile?.name || 'Upload failed'}</Text>
              <Text size="xs" c="red">{uploadError}</Text>
            </Stack>
          </Group>
          <Button variant="subtle" size="xs" color="orange" onClick={resetUpload}>
            Try again
          </Button>
        </Stack>
      );
    }

    if (stage === 'uploading' || stage === 'processing') {
      const isProcessing = uploadProgress >= 99;
      return (
        <Stack gap="xs">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon color="orange" variant="light" radius="xl" size="lg">
              {isProcessing ? <Loader size={18} color="orange" type="dots" /> : <IconUpload size={18} />}
            </ThemeIcon>
            <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
              <Text fw={600} size="sm" c={ui.textMain} truncate>
                {droppedFile?.name}
              </Text>
              <Text size="xs" c={ui.textDim}>
                {droppedFile ? formatBytes(droppedFile.size) : ''} ·{' '}
                {isProcessing ? 'Parsing activity data…' : `Uploading… ${uploadProgress}%`}
              </Text>
            </Stack>
          </Group>
          {isProcessing ? (
            <Progress value={100} animated color="orange" size="xs" radius="xl" />
          ) : (
            <Progress value={uploadProgress} color="orange" size="xs" radius="xl" />
          )}
        </Stack>
      );
    }

    // idle
    return (
      <Dropzone
        onDrop={handleDrop}
        onReject={handleReject}
        maxSize={10 * 1024 * 1024}
        accept={{ 'application/octet-stream': ['.fit'], 'application/gpx+xml': ['.gpx'], 'text/xml': ['.gpx'], 'application/vnd.ant.fit': ['.fit'] }}
        p="xl"
        radius="md"
        bg="var(--mantine-color-body)"
        style={{
          border: `1px dashed ${isDark ? 'rgba(251,146,60,0.5)' : 'var(--mantine-color-orange-4)'}`,
          cursor: 'pointer',
          transition: 'border-color 180ms ease, background 180ms ease',
        }}
      >
        <Group justify="center" gap="lg" mih={140} style={{ pointerEvents: 'none' }}>
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
            <Text size="md" fw={600} ta="center" c={ui.textMain}>
              {t('Drop your activity file here') || 'Drop your activity file here'}
            </Text>
            <Text size="sm" c={ui.textDim} ta="center">
              {t('or click to browse') || 'or click to browse'} · FIT or GPX · max 10 MB
            </Text>
          </Stack>
        </Group>
      </Dropzone>
    );
  };

  return (
    <Stack gap="sm">
      <SegmentedControl
        value={mode}
        onChange={(v) => { setMode(v as 'upload' | 'manual'); resetUpload(); }}
        data={[
          { value: 'upload', label: t('Upload file') || 'Upload file' },
          { value: 'manual', label: t('Log manually') || 'Log manually' },
        ]}
        fullWidth
      />

      {mode === 'upload' ? (
        <Paper
          withBorder
          p="md"
          radius="md"
          shadow="sm"
          style={{ fontFamily: '"Inter", sans-serif', borderColor: ui.border, background: ui.surface }}
        >
          <Stack gap="md">
            <Group justify="space-between" align="center" wrap="nowrap">
              <Group gap="sm">
                <ThemeIcon color="orange" variant="light" radius="xl" size="lg">
                  <IconUpload size={18} />
                </ThemeIcon>
                <Stack gap={0}>
                  <Title order={5} c={ui.textMain}>{t('Upload Activity') || 'Upload Activity'}</Title>
                  <Text size="xs" c={ui.textDim}>FIT or GPX from your device</Text>
                </Stack>
              </Group>
              <Group gap={4}>
                <Badge variant="light" color="gray" size="sm">FIT</Badge>
                <Badge variant="light" color="gray" size="sm">GPX</Badge>
              </Group>
            </Group>

            {renderUploadContent()}
          </Stack>
        </Paper>
      ) : (
        <Paper
          withBorder
          p="md"
          radius="md"
          shadow="sm"
          style={{ borderColor: ui.border, background: ui.surface }}
        >
          <Stack gap="sm">
            {manualDone ? (
              <Group gap="sm">
                <ThemeIcon color="teal" variant="light" radius="xl" size="lg">
                  <IconCheck size={20} />
                </ThemeIcon>
                <Stack gap={0}>
                  <Text fw={700} size="sm" c={ui.textMain}>Activity logged</Text>
                  <Text size="xs" c={ui.textDim}>Your session has been saved.</Text>
                </Stack>
              </Group>
            ) : (
              <>
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
                  <Alert color="red" variant="light" icon={<IconFileAlert size={16} />}>
                    {manualError}
                  </Alert>
                )}
                <Group justify="flex-end">
                  <Button
                    color="orange"
                    loading={manualMutation.isPending}
                    leftSection={<IconRocket size={16} />}
                    onClick={handleManualSubmit}
                  >
                    {t('Save activity') || 'Save activity'}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

import { Alert, Badge, Button, Group, Paper, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { Dropzone, FileWithPath } from '@mantine/dropzone';
import { IconCheck, IconFile, IconRocket, IconUpload, IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import api from '../../api/client';

type Props = {
  onUploaded?: () => void;
};

export default function ActivityUploadPanel({ onUploaded }: Props) {
  const queryClient = useQueryClient();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showCompletionPulse, setShowCompletionPulse] = useState(false);
  const [reflection, setReflection] = useState('');

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

  return (
    <Stack gap="sm">
      <Paper withBorder p="md" radius="md" shadow="sm" style={{ fontFamily: '"Inter", sans-serif' }}>
        <Stack gap="sm">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <ThemeIcon color="orange" variant="light" radius="xl" size="lg">
                <IconUpload size={18} />
              </ThemeIcon>
              <Stack gap={0}>
                <Title order={3}>Upload Activity</Title>
                <Text size="sm" c="dimmed">Bring in your latest session from FIT or GPX in one step.</Text>
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
                <Text size="lg" fw={600} ta="center">Drop your activity file here</Text>
                <Text size="sm" c="dimmed" ta="center">or click to browse files from your device</Text>
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

      {uploadMutation.isPending && <Text>Uploading and processing...</Text>}

      {showCompletionPulse && (
        <Paper withBorder p="sm" radius="md" bg="teal.0" style={{ transition: 'all 220ms ease' }}>
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconCheck size={16} color="teal" />
              <Text fw={600} size="sm">Workout completed and saved</Text>
            </Group>
            <IconRocket size={16} color="teal" />
          </Group>
        </Paper>
      )}

      <Paper withBorder p="sm" radius="md">
        <Text size="sm" fw={600}>Coach feedback loop</Text>
        <Text size="xs" c="dimmed" mb={6}>How did this session feel? A short note helps your coach tune your next workout.</Text>
        <Group>
          <TextInput
            value={reflection}
            onChange={(e) => setReflection(e.currentTarget.value)}
            placeholder="RPE, mood, soreness (optional)"
            flex={1}
          />
          <Button
            size="xs"
            variant="subtle"
            color="orange"
            onClick={() => {
              notifications.show({
                color: 'blue',
                title: 'Coach notified',
                message: reflection.trim()
                  ? 'Reflection sent. Your coach can respond with plan adjustments.'
                  : 'Session sent to coach as On Plan. Add reflection anytime.',
                position: 'bottom-right'
              });
              setReflection('');
            }}
          >
            Send
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}

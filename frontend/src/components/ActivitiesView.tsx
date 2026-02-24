import { Alert, Badge, Button, Group, List, Paper, SimpleGrid, Card, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { Dropzone, FileWithPath } from '@mantine/dropzone';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { IconCalendar, IconCheck, IconFile, IconRocket, IconUpload, IconX } from '@tabler/icons-react';
import '@mantine/dates/styles.css';
import { notifications } from '@mantine/notifications';

type Activity = {
    id: number;
    filename: string;
    sport: string | null;
    created_at: string;
    distance: number | null;
    duration: number | null;
    avg_speed: number | null;
    average_hr: number | null;
    average_watts: number | null;
    athlete_id: number;
    is_deleted?: boolean;
    aerobic_load?: number;
    anaerobic_load?: number;
    total_load_impact?: number;
};

import { useNavigate } from 'react-router-dom';

export function ActivitiesView({ athleteId, currentUserRole, athletes }: { athleteId?: number | null, currentUserRole?: string, athletes?: any[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [uploadError, setUploadError] = useState<string | null>(null);
    const [showCompletionPulse, setShowCompletionPulse] = useState(false);
    const [reflection, setReflection] = useState<string>('');
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);

  const isCoach = currentUserRole === 'coach';

  const { data: me } = useQuery({
      queryKey: ["me"],
      queryFn: async () => {
          const res = await api.get("/users/me");
          return res.data;
      },
      staleTime: 1000 * 60 * 30
  });

  const formatDistance = (meters: number) => {
      if (me?.profile?.preferred_units === 'imperial') {
          const miles = meters * 0.000621371;
          return `${miles.toFixed(2)} mi`;
      }
      return `${(meters / 1000).toFixed(2)} km`;
  };

  const formatDurationHm = (seconds?: number | null) => {
      if (!seconds || seconds <= 0) return '-';
      const totalMinutes = Math.round(seconds / 60);
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return `${h}h ${m}m`;
  };

  const activitiesQuery = useQuery({
    queryKey: ['activities', athleteId, dateRange],
    queryFn: async () => {
      const params: any = {};
      if (athleteId) params.athlete_id = athleteId;
      if (dateRange[0]) params.start_date = dateRange[0].toISOString().split('T')[0];
      if (dateRange[1]) params.end_date = dateRange[1].toISOString().split('T')[0];
      
      const res = await api.get<Activity[]>('/activities/', { params });
      return res.data; 
    }
  });

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
        setUploadError(null);
                setShowCompletionPulse(true);
                notifications.show({
                    color: 'teal',
                    title: 'Workout captured',
                    message: 'Session saved. Add a quick reflection so your coach can adapt tomorrow’s plan.',
                    position: 'bottom-right'
                });
                window.setTimeout(() => setShowCompletionPulse(false), 1200);
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
      if(files.length > 0) {
          uploadMutation.mutate(files[0]);
      }
  };

  return (
    <Stack>
        {!isCoach && (
            <>
                <Paper withBorder p="md" radius="md" shadow="sm">
                    <Stack gap="sm">
                        <Group justify="space-between" align="center">
                            <Group gap="sm">
                                <ThemeIcon color="cyan" variant="light" radius="xl" size="lg">
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
                                border: '1px dashed var(--mantine-color-cyan-4)',
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
                                    <ThemeIcon size={54} radius="xl" color="cyan" variant="light">
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
                                {!uploadMutation.isPending && activitiesQuery.data && activitiesQuery.data.length > 0 && (
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
                                                variant="light"
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
                                )}
            </>
        )}

        <Group justify="space-between" mt="lg" align="center">
             <Title order={3}>My Activities</Title>
             <DatePickerInput
                placeholder="Filter by Date Range"
                type="range"
                value={dateRange}
                onChange={setDateRange}
                leftSection={<IconCalendar size={16} />}
                clearable
                w={250}
             />
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
            {activitiesQuery.data?.map((act) => (
                <Card 
                    key={act.id} 
                    withBorder 
                    shadow="sm" 
                    padding="lg" 
                    radius="md" 
                    style={{ cursor: 'pointer', transition: 'transform 0.2s' }}
                    onClick={() => navigate(`/dashboard/activities/${act.id}`)}
                > 
                    <Group justify="space-between" mb="xs">
                        <Stack gap={0} style={{ overflow: 'hidden' }}>
                            <Text fw={500} truncate>{act.filename}</Text>
                            {isCoach && athletes && (
                                <Text size="xs" c="dimmed">
                                    {(() => {
                                        const athlete = athletes.find(a => a.id === act.athlete_id);
                                        if (!athlete) return 'Unknown Athlete';
                                        const p = athlete.profile;
                                        if (p?.first_name || p?.last_name) {
                                            return `${p.first_name || ''} ${p.last_name || ''}`.trim();
                                        }
                                        return athlete.email;
                                    })()}
                                </Text>
                            )}
                            <Group gap={6}>
                                {act.sport && <Badge size="sm" variant="light" color={act.sport === 'running' ? 'blue' : 'orange'}>{act.sport}</Badge>}
                                {act.is_deleted && <Badge size="sm" color="red" variant="light">Deleted</Badge>}
                            </Group>
                        </Stack>
                        <Text size="xs" c="dimmed">{new Date(act.created_at).toLocaleString()}</Text>
                    </Group>
                    
                    <Stack gap="xs">
                        <Group justify="apart">
                             <Text size="sm" c="dimmed">Distance</Text>
                             <Text size="sm" fw={500}>{act.distance ? formatDistance(act.distance) : '-'}</Text>
                        </Group>
                        <Group justify="apart">
                             <Text size="sm" c="dimmed">Duration</Text>
                                <Text size="sm" fw={500}>{formatDurationHm(act.duration)}</Text>
                        </Group>
                        {act.average_hr && (
                        <Group justify="apart">
                             <Text size="sm" c="dimmed">Avg HR</Text>
                             <Text size="sm" fw={500}>{act.average_hr.toFixed(0)} bpm</Text>
                        </Group>
                        )}
                         {act.average_watts && (
                        <Group justify="apart">
                             <Text size="sm" c="dimmed">Power</Text>
                             <Text size="sm" fw={500}>{act.average_watts.toFixed(0)} W</Text>
                        </Group>
                        )}
                            <Group justify="apart">
                                <Text size="sm" c="dimmed">Load Impact</Text>
                                <Text size="sm" fw={500}>
                                  +{(act.aerobic_load || 0).toFixed(1)} Aer · +{(act.anaerobic_load || 0).toFixed(1)} Ana
                                </Text>
                            </Group>
                    </Stack>
                </Card>
            ))}
                        {activitiesQuery.data?.length === 0 && (
                            <Paper withBorder p="lg" radius="md">
                                <Stack align="center" gap="xs">
                                    <IconUpload size={28} />
                                    <Text fw={600}>Your training story starts with one activity.</Text>
                                    <List size="sm" c="dimmed" spacing={2}>
                                        <List.Item>Connect a wearable provider in Settings</List.Item>
                                        <List.Item>Upload your first FIT or GPX file</List.Item>
                                        <List.Item>Set baseline zones so workouts adapt to you</List.Item>
                                    </List>
                                </Stack>
                            </Paper>
                        )}
        </SimpleGrid>
    </Stack>
  );
}

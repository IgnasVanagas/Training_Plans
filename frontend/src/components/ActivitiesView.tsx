import { Badge, Group, List, Paper, SimpleGrid, Card, Stack, Text, Title, Box, useComputedColorScheme } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { IconCalendar, IconUpload } from '@tabler/icons-react';
import '@mantine/dates/styles.css';
import ActivityUploadPanel from './dashboard/ActivityUploadPanel';
import { ORIGAMI_ACTIVITY_COLORS } from './calendar/theme';
import { resolveActivityAccentColor, resolveActivityPillLabel } from './calendar/activityStyling';
import OrigamiLoadingAnimation from './common/OrigamiLoadingAnimation';

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

const toLocalDateKey = (value: Date): string => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export function ActivitiesView({
    athleteId,
    currentUserRole,
    athletes,
    showUploadSection = true,
}: {
    athleteId?: number | null,
    currentUserRole?: string,
    athletes?: any[],
    showUploadSection?: boolean,
}) {
  const navigate = useNavigate();
    const isDark = useComputedColorScheme('light') === 'dark';
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
        const ui = {
                pageBg: isDark ? '#081226' : '#F4F7FC',
                panelBg: isDark ? '#12223E' : '#FFFFFF',
                cardBg: isDark ? '#182B4B' : '#FFFFFF',
                cardSubtleBg: isDark ? '#142746' : '#F8FAFF',
                border: isDark ? 'rgba(148,163,184,0.28)' : '#DCE6F7',
                textMain: isDark ? '#E2E8F0' : '#0F172A',
                textDim: isDark ? '#9FB0C8' : '#52617A',
        } as const;
            const activityColors = isDark ? ORIGAMI_ACTIVITY_COLORS.dark : ORIGAMI_ACTIVITY_COLORS.light;

        const cardStyle = {
                borderColor: ui.border,
                background: ui.cardBg,
                fontFamily: '"Inter", sans-serif'
        } as const;

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
    if (dateRange[0]) params.start_date = toLocalDateKey(dateRange[0]);
    if (dateRange[1]) params.end_date = toLocalDateKey(dateRange[1]);
      
      const res = await api.get<Activity[]>('/activities/', { params });
      return res.data; 
        },
        staleTime: 1000 * 60,
  });

    const isInitialActivitiesLoading = (activitiesQuery.isLoading || activitiesQuery.isFetching) && !activitiesQuery.data;

  return (
        <Stack style={{ fontFamily: '"Inter", sans-serif' }} bg={ui.pageBg} p={6} gap="sm">
        {!isCoach && showUploadSection && (
            <>
                <ActivityUploadPanel />
            </>
        )}

        <Paper
            withBorder
            radius="lg"
            p="md"
            bg={ui.panelBg}
            style={{ borderColor: ui.border }}
        >
        <Group justify="space-between" align="center">
             <Title order={3} c={ui.textMain}>My Activities</Title>
             <DatePickerInput
                placeholder="Filter by Date Range"
                type="range"
                value={dateRange}
                onChange={setDateRange}
                leftSection={<IconCalendar size={16} />}
                clearable
                w={270}
                radius="md"
                styles={{
                    input: {
                        borderColor: ui.border,
                        background: ui.cardSubtleBg,
                        color: ui.textMain,
                    }
                }}
             />
        </Group>
        </Paper>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" verticalSpacing="sm">
            {isInitialActivitiesLoading && (
                <Paper withBorder p="lg" radius="lg" style={{ ...cardStyle, gridColumn: '1 / -1' }}>
                    <OrigamiLoadingAnimation label="Loading activities..." minHeight={220} />
                </Paper>
            )}
            {activitiesQuery.data?.map((act) => {
                const accentColor = resolveActivityAccentColor(
                    activityColors as any,
                    act.sport || undefined,
                    act.filename
                );
                const pillLabel = resolveActivityPillLabel(act.sport || undefined, act.filename);

                return (
                <Card 
                    key={act.id} 
                    withBorder 
                    shadow="xs"
                    padding="lg" 
                    radius="lg"
                    bg={ui.cardBg}
                    style={{
                        cursor: 'pointer',
                        transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
                        ...cardStyle,
                        borderLeft: `4px solid ${accentColor}`,
                    }}
                    onClick={() => navigate(`/dashboard/activities/${act.id}`)}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = isDark
                            ? '0 8px 20px rgba(2, 6, 23, 0.35)'
                            : '0 10px 22px rgba(15, 23, 42, 0.08)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                    }}
                > 
                    <Group justify="space-between" mb="xs">
                        <Stack gap={0} style={{ overflow: 'hidden' }}>
                            <Text fw={700} c={ui.textMain} truncate>{act.filename}</Text>
                            {isCoach && athletes && (
                                <Text size="xs" c={ui.textDim}>
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
                                {(act.sport || act.filename) && (
                                    <Badge
                                        size="sm"
                                        variant="light"
                                        style={{
                                            background: `${accentColor}22`,
                                            border: `1px solid ${accentColor}55`,
                                            color: accentColor,
                                            textTransform: 'uppercase',
                                            letterSpacing: 0.2,
                                            fontWeight: 700,
                                        }}
                                    >
                                        {pillLabel}
                                    </Badge>
                                )}
                                {act.is_deleted && <Badge size="sm" color="red" variant="light">Deleted</Badge>}
                            </Group>
                        </Stack>
                        <Text size="xs" c={ui.textDim}>{new Date(act.created_at).toLocaleString()}</Text>
                    </Group>
                    
                    <Box
                        p="xs"
                        style={{
                            borderRadius: 10,
                            background: ui.cardSubtleBg,
                            border: `1px solid ${ui.border}`,
                        }}
                    >
                    <Stack gap={6}>
                        <Group justify="apart">
                             <Text size="sm" c={ui.textDim}>Distance</Text>
                             <Text size="sm" fw={700} c={ui.textMain}>{act.distance ? formatDistance(act.distance) : '-'}</Text>
                        </Group>
                        <Group justify="apart">
                             <Text size="sm" c={ui.textDim}>Duration</Text>
                                <Text size="sm" fw={700} c={ui.textMain}>{formatDurationHm(act.duration)}</Text>
                        </Group>
                        {act.average_hr && (
                        <Group justify="apart">
                             <Text size="sm" c={ui.textDim}>Avg HR</Text>
                             <Text size="sm" fw={700} c={ui.textMain}>{act.average_hr.toFixed(0)} bpm</Text>
                        </Group>
                        )}
                         {act.average_watts && (
                        <Group justify="apart">
                             <Text size="sm" c={ui.textDim}>Power</Text>
                             <Text size="sm" fw={700} c={ui.textMain}>{act.average_watts.toFixed(0)} W</Text>
                        </Group>
                        )}
                            <Group justify="apart">
                                <Text size="sm" c={ui.textDim}>Load Impact</Text>
                                <Text size="sm" fw={700} c={ui.textMain}>
                                  +{(act.aerobic_load || 0).toFixed(1)} Aer · +{(act.anaerobic_load || 0).toFixed(1)} Ana
                                </Text>
                            </Group>
                    </Stack>
                    </Box>
                </Card>
                );
            })}
                        {!isInitialActivitiesLoading && activitiesQuery.data?.length === 0 && (
                            <Paper withBorder p="lg" radius="lg" style={cardStyle}>
                                <Stack align="center" gap="xs">
                                    <IconUpload size={28} />
                                    <Text fw={700} c={ui.textMain}>Your training story starts with one activity.</Text>
                                    <List size="sm" c={ui.textDim} spacing={2}>
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

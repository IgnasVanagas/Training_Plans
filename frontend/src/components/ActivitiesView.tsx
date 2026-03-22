import { Badge, Group, List, Modal, Paper, SimpleGrid, Card, Stack, Text, Title, Box, Button, Tooltip, useComputedColorScheme } from '@mantine/core';
import { IconCopy, IconStar } from '@tabler/icons-react';
import { DatePickerInput } from '@mantine/dates';
import { useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { IconCalendar, IconUpload } from '@tabler/icons-react';
import '@mantine/dates/styles.css';
import ActivityUploadPanel from './dashboard/ActivityUploadPanel';
import { ORIGAMI_ACTIVITY_COLORS } from './calendar/theme';
import { resolveActivityAccentColor, resolveActivityPillLabel } from './calendar/activityStyling';
import { ActivitiesListSkeleton } from './common/SkeletonScreens';
import { readSnapshot, writeSnapshot } from '../utils/localSnapshot';

export type Activity = {
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
    duplicate_recordings_count?: number | null;
    duplicate_of_id?: number | null;
    source_provider?: string | null;
    file_type?: string | null;
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
    const isMobile = useMediaQuery('(max-width: 48em)');
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
    const [offset, setOffset] = useState(0);
    const [loadedActivities, setLoadedActivities] = useState<Activity[]>([]);
    const [hasMoreActivities, setHasMoreActivities] = useState(true);
    const [duplicateModalActivity, setDuplicateModalActivity] = useState<Activity | null>(null);
    const PAGE_SIZE = 40;
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

    const rangeStartKey = dateRange[0] ? toLocalDateKey(dateRange[0]) : 'na';
    const rangeEndKey = dateRange[1] ? toLocalDateKey(dateRange[1]) : 'na';

    useEffect(() => {
        setOffset(0);
        setLoadedActivities([]);
        setHasMoreActivities(true);
    }, [athleteId, rangeStartKey, rangeEndKey]);

    const activitiesQuery = useQuery({
        queryKey: ['activities', athleteId, rangeStartKey, rangeEndKey, offset],
        initialData: () => {
                        if (offset !== 0) return undefined;
                        const key = `activities:${athleteId || 'self'}:${rangeStartKey}:${rangeEndKey}`;
                        return readSnapshot<Activity[]>(key);
        },
    queryFn: async () => {
      const params: any = {};
      if (athleteId) params.athlete_id = athleteId;
            if (dateRange[0]) params.start_date = toLocalDateKey(dateRange[0]);
            if (dateRange[1]) params.end_date = toLocalDateKey(dateRange[1]);
            params.include_load_metrics = false;
                        params.limit = PAGE_SIZE;
                        params.offset = offset;
      
      const res = await api.get<Activity[]>('/activities/', { params });
                        if (offset === 0) {
                                const key = `activities:${athleteId || 'self'}:${rangeStartKey}:${rangeEndKey}`;
                                writeSnapshot(key, res.data);
                        }
      return res.data; 
        },
                staleTime: 1000 * 60 * 5,
                gcTime: 1000 * 60 * 30,
                placeholderData: (prev) => prev,
                refetchOnMount: 'always',
  });

    useEffect(() => {
        const page = activitiesQuery.data;
        if (!page) return;

        setLoadedActivities((prev) => {
            if (offset === 0) return page;
            const byId = new Map<number, Activity>();
            prev.forEach((activity) => byId.set(activity.id, activity));
            page.forEach((activity) => byId.set(activity.id, activity));
            return Array.from(byId.values()).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        });
        setHasMoreActivities(page.length === PAGE_SIZE);
    }, [activitiesQuery.data, offset]);

    const visibleActivities = useMemo(() => loadedActivities, [loadedActivities]);

    const isInitialActivitiesLoading = (activitiesQuery.isLoading || activitiesQuery.isFetching) && visibleActivities.length === 0;
    const isLoadingOlder = offset > 0 && activitiesQuery.isFetching;

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
        <Group justify="space-between" align={isMobile ? 'stretch' : 'center'} wrap={isMobile ? 'wrap' : 'nowrap'}>
             <Title order={3} c={ui.textMain}>My Activities</Title>
             <DatePickerInput
                placeholder="Filter by Date Range"
                type="range"
                value={dateRange}
                onChange={setDateRange}
                leftSection={<IconCalendar size={16} />}
                clearable
                w={isMobile ? '100%' : 270}
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
                <ActivitiesListSkeleton count={6} />
            )}
            {visibleActivities.map((act) => {
                const accentColor = resolveActivityAccentColor(
                    activityColors as any,
                    act.sport || undefined,
                    act.filename
                );
                const pillLabel = resolveActivityPillLabel(act.sport || undefined, act.filename);

                const hasDuplicates = (act.duplicate_recordings_count ?? 0) > 0;

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
                    onClick={() => {
                        if (hasDuplicates) {
                            setDuplicateModalActivity(act);
                        } else {
                            navigate(`/dashboard/activities/${act.id}`);
                        }
                    }}
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
                                {hasDuplicates && (
                                    <Badge size="sm" color="orange" variant="light" leftSection={<IconCopy size={10} />}>
                                        {(act.duplicate_recordings_count ?? 0) + 1} recordings
                                    </Badge>
                                )}
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
                        {!isInitialActivitiesLoading && visibleActivities.length === 0 && (
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
                        {visibleActivities.length > 0 && (
                            <Paper withBorder p="md" radius="lg" style={{ ...cardStyle, gridColumn: '1 / -1' }}>
                                <Group justify="center">
                                    <Button
                                        variant="light"
                                        onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
                                        disabled={!hasMoreActivities || isLoadingOlder}
                                        loading={isLoadingOlder}
                                    >
                                        {hasMoreActivities ? 'Load older activities' : 'No older activities'}
                                    </Button>
                                </Group>
                            </Paper>
                        )}
        </SimpleGrid>

        <DuplicateSelectModal
            activity={duplicateModalActivity}
            onClose={() => setDuplicateModalActivity(null)}
            isDark={isDark}
            formatDistance={formatDistance}
            formatDurationHm={formatDurationHm}
            onNavigate={(id) => { setDuplicateModalActivity(null); navigate(`/dashboard/activities/${id}`); }}
        />
    </Stack>
  );
}

export type DuplicateSelectModalProps = {
    activity: Activity | null;
    onClose: () => void;
    isDark: boolean;
    formatDistance: (m: number) => string;
    formatDurationHm: (s?: number | null) => string;
    onNavigate: (id: number) => void;
};

const PROVIDER_LABELS: Record<string, string> = {
    strava: 'Strava',
    garmin: 'Garmin',
    wahoo: 'Wahoo',
    polar: 'Polar',
    zwift: 'Zwift',
    suunto: 'Suunto',
    coros: 'Coros',
};

function formatProvider(provider?: string | null, fileType?: string): string {
    if (provider && PROVIDER_LABELS[provider.toLowerCase()]) {
        return PROVIDER_LABELS[provider.toLowerCase()];
    }
    if (fileType) return `.${fileType.toLowerCase()}`;
    return 'file';
}

export function DuplicateSelectModal({ activity, onClose, isDark, formatDistance, formatDurationHm, onNavigate }: DuplicateSelectModalProps) {
    const queryClient = useQueryClient();
    const [allRecordings, setAllRecordings] = useState<Activity[]>([]);
    const [primaryId, setPrimaryId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!activity) return;
        setPrimaryId(activity.id);
        setAllRecordings([activity]);
        setLoading(true);
        api.get<Activity[]>(`/activities/${activity.id}/duplicates`)
            .then(res => setAllRecordings([activity, ...res.data]))
            .finally(() => setLoading(false));
    }, [activity?.id]);

    const deleteMutation = useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/activities/${id}`);
        },
        onSuccess: (_, id) => {
            const remaining = allRecordings.filter(r => r.id !== id);
            setAllRecordings(remaining);
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            if (remaining.length <= 1) {
                onClose();
            }
        },
    });

    const makePrimaryMutation = useMutation({
        mutationFn: async (id: number) => {
            await api.post(`/activities/${id}/make-primary`);
        },
        onSuccess: (_, id) => {
            setPrimaryId(id);
            queryClient.invalidateQueries({ queryKey: ['activities'] });
        },
    });

    // Primary first, then the rest
    const recordings = [
        ...allRecordings.filter(r => r.id === primaryId),
        ...allRecordings.filter(r => r.id !== primaryId),
    ];

    const cardBg = isDark ? '#182B4B' : '#FFFFFF';
    const border = isDark ? 'rgba(148,163,184,0.28)' : '#DCE6F7';

    return (
        <Modal
            opened={Boolean(activity)}
            onClose={onClose}
            title="Multiple recordings detected"
            size="md"
            centered
        >
            <Stack gap="sm">
                <Text size="sm" c="dimmed">
                    This workout was recorded on multiple devices. Choose which recording to keep as primary, or delete the ones you don't need.
                </Text>

                {loading ? (
                    <Text size="sm" c="dimmed">Loading recordings…</Text>
                ) : (
                    recordings.map((rec) => {
                        const isPrimary = rec.id === primaryId;
                        const sourceLabel = formatProvider(rec.source_provider, rec.file_type);
                        return (
                            <Paper
                                key={rec.id}
                                withBorder
                                p="sm"
                                radius="md"
                                style={{ borderColor: isPrimary ? '#3B82F6' : border, background: cardBg }}
                            >
                                <Group justify="space-between" wrap="nowrap">
                                    <Stack gap={2} style={{ flex: 1, overflow: 'hidden' }}>
                                        <Group gap={6} wrap="nowrap">
                                            <Text fw={600} size="sm" truncate style={{ flex: 1 }}>{rec.filename}</Text>
                                            <Badge size="xs" color="gray" variant="outline" style={{ flexShrink: 0 }}>{sourceLabel}</Badge>
                                            {isPrimary && <Badge size="xs" color="blue" variant="light" style={{ flexShrink: 0 }}>Primary</Badge>}
                                        </Group>
                                        <Text size="xs" c="dimmed">
                                            {new Date(rec.created_at.endsWith('Z') ? rec.created_at : rec.created_at + 'Z').toLocaleString()} · {rec.duration ? formatDurationHm(rec.duration) : '-'} · {rec.distance ? formatDistance(rec.distance) : '-'}
                                            {rec.average_hr ? ` · ${rec.average_hr.toFixed(0)} bpm` : ''}
                                        </Text>
                                    </Stack>
                                    <Group gap={6} wrap="nowrap">
                                        <Button size="xs" variant="light" onClick={() => onNavigate(rec.id)}>
                                            View
                                        </Button>
                                        {!isPrimary && (
                                            <Tooltip label="Make this the primary recording">
                                                <Button
                                                    size="xs"
                                                    variant="light"
                                                    color="yellow"
                                                    leftSection={<IconStar size={12} />}
                                                    loading={makePrimaryMutation.isPending && makePrimaryMutation.variables === rec.id}
                                                    onClick={() => makePrimaryMutation.mutate(rec.id)}
                                                >
                                                    Primary
                                                </Button>
                                            </Tooltip>
                                        )}
                                        <Button
                                            size="xs"
                                            color="red"
                                            variant="subtle"
                                            loading={deleteMutation.isPending && deleteMutation.variables === rec.id}
                                            onClick={() => deleteMutation.mutate(rec.id)}
                                        >
                                            Delete
                                        </Button>
                                    </Group>
                                </Group>
                            </Paper>
                        );
                    })
                )}
            </Stack>
        </Modal>
    );
}

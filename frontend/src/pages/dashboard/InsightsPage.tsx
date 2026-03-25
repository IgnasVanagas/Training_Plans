import { useState, useMemo } from 'react';
import {
  Alert, Box, Button, Card, Group, Loader, Paper, SimpleGrid, Stack, Text, Title, ThemeIcon,
} from '@mantine/core';
import {
  IconActivity, IconBolt, IconHeart, IconRun, IconTargetArrow,
} from '@tabler/icons-react';
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  Legend, ResponsiveContainer, Brush,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import api from '../../api/client';
import { MetricKey, TrainingStatus, User } from './types';
import { formatDuration, formatMinutesHm } from './utils';
import { CoachComparisonPanel } from '../../components/CoachComparisonPanel';

type TrendPoint = {
  date: string;
  fitness: number;
  fatigue: number;
  form: number;
  load: number;
};

type Props = {
  isDark: boolean;
  me: User;
  trainingStatus?: TrainingStatus;
  wellnessSummary: any;
  onSelectMetric: (metric: MetricKey) => void;
  athleteId?: number | null;
  athletes?: any[];
};

const RANGE_OPTIONS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: '365d', days: 365 },
];

const InsightsPage = ({
  isDark,
  me,
  trainingStatus,
  wellnessSummary,
  onSelectMetric,
  athleteId,
  athletes = [],
}: Props) => {
  const [rangeDays, setRangeDays] = useState(180);
  const cardBg = isDark ? 'rgba(22, 34, 58, 0.62)' : 'rgba(255, 255, 255, 0.92)';
  const cardBorder = isDark ? 'rgba(148, 163, 184, 0.26)' : 'rgba(15, 23, 42, 0.14)';

  const trendQuery = useQuery({
    queryKey: ['performance-trend', rangeDays, athleteId],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(rangeDays) });
      if (athleteId) params.set('athlete_id', String(athleteId));
      const res = await api.get<{ data: TrendPoint[] }>(`/activities/performance-trend?${params}`);
      return res.data.data;
    },
    staleTime: 5 * 60_000,
  });

  const weeklyBars = useMemo(() => {
    if (!trendQuery.data) return [];
    const byWeek: Record<string, { week: string; load: number }> = {};
    trendQuery.data.forEach((pt) => {
      const weekKey = format(parseISO(pt.date), 'yyyy-\'W\'II');
      const weekLabel = format(parseISO(pt.date), 'MMM d');
      if (!byWeek[weekKey]) byWeek[weekKey] = { week: weekLabel, load: 0 };
      byWeek[weekKey].load += pt.load;
    });
    return Object.values(byWeek).map((w) => ({ ...w, load: Math.round(w.load) }));
  }, [trendQuery.data]);

  const tsb = trainingStatus?.tsb ?? 0;
  const trainingStatusColor = tsb > 15 ? 'green' : tsb < -25 ? 'red' : tsb < -10 ? 'orange' : tsb > 5 ? 'teal' : 'blue';

  const chartData = trendQuery.data?.map((pt) => ({
    ...pt,
    dateLabel: format(parseISO(pt.date), 'MMM d'),
  })) ?? [];

  const axisColor = isDark ? '#94a3b8' : '#64748b';
  const gridColor = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.07)';

  return (
    <Stack gap="lg">
      {/* Fitness snapshot */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {me.profile?.main_sport === 'running' ? (
          <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ borderColor: cardBorder }}>
            <Group justify="space-between" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>LT2</Text>
              <IconRun size={20} color="green" />
            </Group>
            <Text fw={700} size="xl">
              {me.profile?.lt2
                ? (me.profile.preferred_units === 'imperial'
                  ? formatDuration(me.profile.lt2 * 1.60934)
                  : formatDuration(me.profile.lt2))
                : '-'}
            </Text>
            <Text size="xs" c="dimmed" mt="xs">{me.profile?.preferred_units === 'imperial' ? 'min/mi' : 'min/km'}</Text>
          </Card>
        ) : (
          <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: 'pointer', borderColor: cardBorder }} onClick={() => onSelectMetric('ftp')}>
            <Group justify="space-between" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>FTP</Text>
              <IconBolt size={20} color="orange" />
            </Group>
            <Text fw={700} size="xl">{me.profile?.ftp ?? '-'}</Text>
            <Text size="xs" c="dimmed" mt="xs">Watts</Text>
          </Card>
        )}

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: 'pointer', borderColor: cardBorder }} onClick={() => onSelectMetric('rhr')}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Resting HR</Text>
            <IconHeart size={20} color="red" />
          </Group>
          <Text fw={700} size="xl">{wellnessSummary?.resting_hr?.value ?? me.profile?.resting_hr ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">BPM</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: 'pointer', borderColor: cardBorder }} onClick={() => onSelectMetric('hrv')}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>HRV</Text>
            <IconHeart size={20} color="violet" />
          </Group>
          <Text fw={700} size="xl">{wellnessSummary?.hrv?.value ?? me.profile?.hrv_ms ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">ms</Text>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: 'pointer', borderColor: cardBorder }} onClick={() => onSelectMetric('aerobic_load')}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Fatigue</Text>
            <IconActivity size={20} color="#E95A12" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus?.atl?.toFixed(1) ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">Short-term load (7d avg)</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: 'pointer', borderColor: cardBorder }} onClick={() => onSelectMetric('anaerobic_load')}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Fitness</Text>
            <IconBolt size={20} color="#2563eb" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus?.ctl?.toFixed(1) ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">Long-term load (42d avg)</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: 'pointer', borderColor: cardBorder }} onClick={() => onSelectMetric('training_status')}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Form</Text>
            <ThemeIcon color={trainingStatusColor} variant="light" size="sm" radius="xl">
              <IconTargetArrow size={13} />
            </ThemeIcon>
          </Group>
          <Text fw={700} size="xl">{trainingStatus?.training_status ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">
            Balance {tsb >= 0 ? '+' : ''}{trainingStatus?.tsb?.toFixed(1) ?? '-'}
          </Text>
        </Card>
      </SimpleGrid>

      {/* Performance Trend Chart */}
      <Paper withBorder p="md" radius="md" bg={cardBg} style={{ borderColor: cardBorder }}>
        <Group justify="space-between" mb="md" align="center">
          <Stack gap={0}>
            <Text fw={700} size="sm">Performance Trend</Text>
            <Text size="xs" c="dimmed">Fitness · Fatigue · Form · Daily Load</Text>
          </Stack>
          <Group gap="xs">
            {RANGE_OPTIONS.map((opt) => (
              <Button
                key={opt.days}
                size="xs"
                variant={rangeDays === opt.days ? 'filled' : 'subtle'}
                color={rangeDays === opt.days ? 'blue' : 'gray'}
                onClick={() => setRangeDays(opt.days)}
              >
                {opt.label}
              </Button>
            ))}
          </Group>
        </Group>

        {trendQuery.isLoading ? (
          <Group justify="center" h={300}><Loader size="sm" /></Group>
        ) : trendQuery.isError ? (
          <Alert color="red">Failed to load trend data.</Alert>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} width={36} />
              <YAxis yAxisId="trend" orientation="left" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} width={36} />
              <RechartTooltip
                contentStyle={{ background: isDark ? '#0f172a' : '#fff', border: `1px solid ${cardBorder}`, borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, name: string) => [value.toFixed(1), name]}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="load" dataKey="load" name="Daily TL" fill="#3b82f6" opacity={0.35} barSize={4} />
              <Area yAxisId="trend" type="monotone" dataKey="fitness" name="Fitness" stroke="#22c55e" fill="#22c55e" fillOpacity={0.12} strokeWidth={2} dot={false} />
              <Area yAxisId="trend" type="monotone" dataKey="fatigue" name="Fatigue" stroke="#f97316" fill="#f97316" fillOpacity={0.10} strokeWidth={2} dot={false} />
              <Line yAxisId="trend" type="monotone" dataKey="form" name="Form" stroke="#a855f7" strokeWidth={2} dot={false} strokeDasharray="4 2" />
              <Brush dataKey="dateLabel" height={20} travellerWidth={6} stroke={isDark ? '#334155' : '#cbd5e1'} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Paper>

      {/* Weekly Training Load bar chart */}
      {weeklyBars.length > 0 && (
        <Paper withBorder p="md" radius="md" bg={cardBg} style={{ borderColor: cardBorder }}>
          <Text fw={700} size="sm" mb="md">Weekly Training Load</Text>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={weeklyBars} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis dataKey="week" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} width={36} />
              <RechartTooltip
                contentStyle={{ background: isDark ? '#0f172a' : '#fff', border: `1px solid ${cardBorder}`, borderRadius: 8, fontSize: 12 }}
                formatter={(value: number) => [value, 'Weekly TL']}
              />
              <Bar dataKey="load" name="Weekly TL" fill="#00c3f5" radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </Paper>
      )}
    </Stack>
  );
};

export default InsightsPage;

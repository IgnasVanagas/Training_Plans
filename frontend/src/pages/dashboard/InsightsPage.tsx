import { useState, useMemo } from 'react';
import {
  Alert, Box, Button, Card, Group, Loader, Paper, SimpleGrid, Stack, Text, Title, ThemeIcon, Tooltip, UnstyledButton,
} from '@mantine/core';
import {
  IconActivity, IconBolt, IconHeart, IconRun, IconTargetArrow, IconHelpCircle,
} from '@tabler/icons-react';
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  Legend, ResponsiveContainer, Brush, ReferenceLine,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import api from '../../api/client';
import { MetricKey, TrainingStatus, User } from './types';
import { formatDuration, formatMinutesHm } from './utils';


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
  const [activeExplanation, setActiveExplanation] = useState<string | null>(null);

  const SERIES_INFO = [
    { color: '#3b82f6', label: 'Daily TL', tip: 'Daily Training Load — the total aerobic and anaerobic stress from all activities on a given day. It is the raw input that drives both Fitness and Fatigue. A high-load day will spike Fatigue quickly; repeated high-load days over months build Fitness.' },
    { color: '#22c55e', label: 'Fitness', tip: 'Long-term load — a 42-day exponential rolling average of daily Training Load. Represents the size of your aerobic engine. It builds slowly with consistent training and decays slowly with rest. The only way to grow it is sustained training over months.' },
    { color: '#f97316', label: 'Fatigue', tip: 'Short-term load — a 7-day exponential rolling average of daily Training Load. Represents how tired you are right now. Rises quickly after hard blocks and falls quickly with recovery. A rising Fatigue means you are accumulating stress faster than you can absorb it.' },
    { color: '#a855f7', label: 'Form', tip: 'Fitness minus Fatigue. Positive = fresh and ready to perform. Negative = fatigued from recent hard training. The sweet spot for racing is +5 to +15. Below −25 means you are over-reached. Continuously positive means you are under-training.' },
  ] as const;
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
          <Card shadow="sm" radius="lg" withBorder padding="lg" bg={cardBg}
            style={{ borderColor: cardBorder, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.10)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
          >
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
          <Card shadow="sm" radius="lg" withBorder padding="lg" bg={cardBg}
            style={{ cursor: 'pointer', borderColor: cardBorder, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
            onClick={() => onSelectMetric('ftp')}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.10)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
          >
            <Group justify="space-between" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>FTP</Text>
              <IconBolt size={20} color="orange" />
            </Group>
            <Text fw={700} size="xl">{me.profile?.ftp ?? '-'}</Text>
            <Text size="xs" c="dimmed" mt="xs">Watts</Text>
          </Card>
        )}

        <Card shadow="sm" radius="lg" withBorder padding="lg" bg={cardBg}
          style={{ cursor: 'pointer', borderColor: cardBorder, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
          onClick={() => onSelectMetric('rhr')}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.10)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
        >
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Resting HR</Text>
            <IconHeart size={20} color="red" />
          </Group>
          <Text fw={700} size="xl">{wellnessSummary?.resting_hr?.value ?? me.profile?.resting_hr ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">BPM</Text>
        </Card>

        <Card shadow="sm" radius="lg" withBorder padding="lg" bg={cardBg}
          style={{ cursor: 'pointer', borderColor: cardBorder, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
          onClick={() => onSelectMetric('hrv')}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.10)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
        >
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>HRV</Text>
            <IconHeart size={20} color="violet" />
          </Group>
          <Text fw={700} size="xl">{wellnessSummary?.hrv?.value ?? me.profile?.hrv_ms ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">ms</Text>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Card shadow="sm" radius="lg" withBorder padding="lg" bg={cardBg}
          style={{ cursor: 'pointer', borderColor: cardBorder, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
          onClick={() => onSelectMetric('aerobic_load')}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.10)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
        >
          <Group justify="space-between" mb="xs">
            <Group gap={4} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Fatigue</Text>
              <Tooltip label="Your short-term load — a 7-day exponential rolling average of daily Training Load. It tells you how tired you are right now. A rising Fatigue means you are accumulating stress faster than you can absorb it." multiline w={260} withArrow>
                <IconHelpCircle size={13} style={{ cursor: 'help', opacity: 0.5 }} />
              </Tooltip>
            </Group>
            <IconActivity size={20} color="#E95A12" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus?.atl?.toFixed(1) ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">Short-term load (7d avg)</Text>
        </Card>

        <Card shadow="sm" radius="lg" withBorder padding="lg" bg={cardBg}
          style={{ cursor: 'pointer', borderColor: cardBorder, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
          onClick={() => onSelectMetric('anaerobic_load')}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.10)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
        >
          <Group justify="space-between" mb="xs">
            <Group gap={4} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Fitness</Text>
              <Tooltip label="Your long-term load — a 42-day exponential rolling average of daily Training Load. It represents the size of your aerobic engine. It builds slowly and decays slowly; consistent training over months is the only way to grow it." multiline w={260} withArrow>
                <IconHelpCircle size={13} style={{ cursor: 'help', opacity: 0.5 }} />
              </Tooltip>
            </Group>
            <IconBolt size={20} color="#2563eb" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus?.ctl?.toFixed(1) ?? '-'}</Text>
          <Text size="xs" c="dimmed" mt="xs">Long-term load (42d avg)</Text>
        </Card>

        <Card shadow="sm" radius="lg" withBorder padding="lg" bg={cardBg}
          style={{ cursor: 'pointer', borderColor: cardBorder, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}
          onClick={() => onSelectMetric('training_status')}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.10)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = ''; }}
        >
          <Group justify="space-between" mb="xs">
            <Group gap={4} align="center">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Form</Text>
              <Tooltip label="Fitness minus Fatigue. Positive = fresh and ready to perform. Negative = fatigued from recent hard training. The sweet spot for racing is +5 to +15. Below −25 means you are over-reached. Continuously positive means you are under-training." multiline w={260} withArrow>
                <IconHelpCircle size={13} style={{ cursor: 'help', opacity: 0.5 }} />
              </Tooltip>
            </Group>
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
          <Stack gap={6}>
            <Text fw={700} size="sm">Performance Trend</Text>
            <Group gap={4} wrap="wrap">
              {SERIES_INFO.map(({ color, label }) => {
                const isActive = activeExplanation === label;
                return (
                  <UnstyledButton
                    key={label}
                    onClick={() => setActiveExplanation(isActive ? null : label)}
                    style={{
                      borderRadius: 6,
                      padding: '3px 7px',
                      border: `1px solid ${isActive ? color : 'transparent'}`,
                      background: isActive ? (isDark ? `${color}22` : `${color}14`) : 'transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <Group gap={5} align="center">
                      <Box style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                      <Text size="xs" c={isActive ? 'inherit' : 'dimmed'} fw={isActive ? 600 : 400}>{label}</Text>
                      <IconHelpCircle size={12} style={{ opacity: isActive ? 0.7 : 0.4 }} />
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Group>
            {activeExplanation && (() => {
              const info = SERIES_INFO.find((s) => s.label === activeExplanation);
              if (!info) return null;
              return (
                <Paper p="xs" radius="sm" style={{ borderLeft: `3px solid ${info.color}`, background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                  <Group justify="space-between" mb={4}>
                    <Group gap={6}>
                      <Box style={{ width: 8, height: 8, borderRadius: 2, background: info.color }} />
                      <Text size="xs" fw={700}>{info.label}</Text>
                    </Group>
                    <UnstyledButton onClick={() => setActiveExplanation(null)}>
                      <Text size="xs" c="dimmed" lh={1}>✕</Text>
                    </UnstyledButton>
                  </Group>
                  <Text size="xs" c="dimmed" lh={1.5}>{info.tip}</Text>
                </Paper>
              );
            })()}
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
              <defs>
                <linearGradient id="fitnessGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="fatigueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f97316" stopOpacity={0.30} />
                  <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.15} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 5" stroke={gridColor} />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} width={36} />
              <YAxis yAxisId="trend" orientation="left" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} width={36} />
              <RechartTooltip
                contentStyle={{
                  background: isDark ? 'rgba(12,22,42,0.92)' : 'rgba(255,255,255,0.92)',
                  backdropFilter: 'blur(10px)',
                  border: `1px solid ${cardBorder}`,
                  borderRadius: 10,
                  fontSize: 12,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                }}
                formatter={(value: number, name: string) => {
                  const info = SERIES_INFO.find((s) => s.label === name);
                  return [
                    <span style={{ color: info?.color ?? 'inherit', fontWeight: 700 }}>{Number(value).toFixed(1)}</span>,
                    name,
                  ];
                }}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Legend
                content={({ payload }) => (
                  <Group gap={4} justify="center" wrap="wrap" style={{ marginTop: 4 }}>
                    {(payload || []).map((entry: any) => {
                      const isActive = activeExplanation === entry.value;
                      const info = SERIES_INFO.find((s) => s.label === entry.value);
                      if (!info) return null;
                      return (
                        <UnstyledButton
                          key={entry.value}
                          onClick={() => setActiveExplanation(isActive ? null : entry.value)}
                          style={{
                            borderRadius: 5,
                            padding: '2px 6px',
                            border: `1px solid ${isActive ? info.color : 'transparent'}`,
                            background: isActive ? (isDark ? `${info.color}22` : `${info.color}14`) : 'transparent',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <Group gap={4} align="center">
                            <Box style={{ width: 9, height: 9, borderRadius: 2, background: info.color, flexShrink: 0 }} />
                            <Text size="xs" c={isActive ? 'inherit' : 'dimmed'} fw={isActive ? 600 : 400}>{entry.value}</Text>
                            <IconHelpCircle size={11} style={{ opacity: isActive ? 0.7 : 0.35 }} />
                          </Group>
                        </UnstyledButton>
                      );
                    })}
                  </Group>
                )}
              />
              <ReferenceLine yAxisId="trend" y={0} stroke={isDark ? 'rgba(148,163,184,0.25)' : 'rgba(15,23,42,0.15)'} strokeDasharray="3 4" />
              <Bar yAxisId="load" dataKey="load" name="Daily TL" fill="url(#loadGrad)" barSize={8} radius={[2, 2, 0, 0]} />
              <Area yAxisId="trend" type="monotone" dataKey="fitness" name="Fitness" stroke="#22c55e" strokeWidth={2.5} fill="url(#fitnessGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#22c55e' }} />
              <Area yAxisId="trend" type="monotone" dataKey="fatigue" name="Fatigue" stroke="#f97316" strokeWidth={2.5} fill="url(#fatigueGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#f97316' }} />
              <Line yAxisId="trend" type="monotone" dataKey="form" name="Form" stroke="#a855f7" strokeWidth={2} dot={false} strokeDasharray="4 2" activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#a855f7' }} />
              <Brush dataKey="dateLabel" height={20} travellerWidth={6} stroke={isDark ? '#334155' : '#cbd5e1'} fill={isDark ? '#1e293b' : '#f8fafc'} />
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

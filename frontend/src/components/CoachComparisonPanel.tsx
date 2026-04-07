import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Divider,
  Group,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Slider,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
} from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import { useMediaQuery } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { IconArrowsDiff, IconCalendarStats, IconChartBar, IconChartLine, IconInfoCircle, IconAdjustmentsHorizontal, IconAlertTriangle } from '@tabler/icons-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import api from '../api/client';
import ZoneBars from './coachComparison/ZoneBars';
import {
  compareValue,
  cyclingZoneFromPower,
  formatMinutes,
  formatName,
  formatPace,
  normalizeSport,
  parseMonthLabel,
  parseWeekLabel,
  runningZoneFromHr,
  safeNum,
  toMonthKey,
  toWeekKey,
} from './coachComparison/utils';
import { useI18n } from '../i18n/I18nProvider';

type AthleteLike = {
  id: number;
  email: string;
  profile?: {
    first_name?: string | null;
    last_name?: string | null;
    ftp?: number | null;
    lt2?: number | null;
    max_hr?: number | null;
  } | null;
};

type ActivityListItem = {
  id: number;
  athlete_id: number;
  filename: string;
  sport?: string | null;
  created_at: string;
  distance?: number | null;
  duration?: number | null;
  moving_time?: number | null;
  average_hr?: number | null;
  average_watts?: number | null;
  avg_speed?: number | null;
  rpe?: number | null;
  lactate_mmol_l?: number | null;
  notes?: string | null;
  total_load_impact?: number | null;
};

type ActivityDetail = ActivityListItem & {
  streams?: any[];
  power_curve?: Record<string, number> | null;
  hr_zones?: Record<string, number> | null;
  pace_curve?: Record<string, number> | null;
  splits_metric?: any[] | null;
  laps?: any[] | null;
  total_elevation_gain?: number | null;
  total_calories?: number | null;
  aerobic_load?: number | null;
  anaerobic_load?: number | null;
  planned_comparison?: {
    summary?: {
      execution_score_pct?: number | null;
      execution_status?: string | null;
    } | null;
  } | null;
};

const COMPARISON_ACTIVITY_FETCH_LIMIT = 500;

type AnalysisMode = 'workouts' | 'weeks' | 'months';

type Aggregate = {
  activitiesCount: number;
  totalMinutes: number;
  totalDistanceKm: number;
  avgHr: number | null;
  avgPower: number | null;
  weightedAvgPower: number | null;
  totalLoadImpact: number;
  runningZones: Record<string, number>;
  cyclingZones: Record<string, number>;
  best20mPower: number | null;
  best20mPace: number | null;
  keySessions: ActivityDetail[];
  // Unused fields (for backwards compatibility with UI)
  activeDays?: number;
  avgSessionMinutes?: number;
  densestDayMinutes?: number;
  avgRpe?: number | null;
  avgLactate?: number | null;
  feedbackCoveragePct?: number;
  noteCoveragePct?: number;
  lactateCoveragePct?: number;
  estimatedFtp?: number | null;
  estimatedLt2MinPerKm?: number | null;
  aerobicLoad?: number;
  anaerobicLoad?: number;
  weekdayMinutes?: Record<string, number>;
  sportMix?: Record<string, number>;
  longestSession?: ActivityDetail | null;
};

type PeriodAggregate = {
  activitiesCount: number;
  totalMinutes: number;
  totalDistanceKm: number;
  totalLoadImpact: number;
  aerobicLoad: number;
  anaerobicLoad: number;
  avgLoadPerSession: number;
  avgHr: number | null;
  avgPower: number | null;
};

type SplitRow = {
  split: number;
  durationSec: number;
  distanceM: number;
  avgHr: number | null;
  avgPower: number | null;
  avgSpeed: number | null;
  rpe: number | null;
  lactate: number | null;
  note: string | null;
};

type SplitMetricVisibility = {
  distance: boolean;
  intensity: boolean;
  hr: boolean;
  feedback: boolean;
  delta: boolean;
};

const weekdayKeys = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const emptyRunningZones = () => Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
const emptyCyclingZones = () => Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
const emptyWeekdayMinutes = () => Object.fromEntries(weekdayKeys.map((key) => [key, 0])) as Record<string, number>;

const formatDistanceKm = (value: number) => `${value.toFixed(1)} km`;

const DEFAULT_SPLIT_METRICS_DESKTOP: SplitMetricVisibility = {
  distance: true,
  intensity: true,
  hr: true,
  feedback: true,
  delta: true,
};

const DEFAULT_SPLIT_METRICS_MOBILE: SplitMetricVisibility = {
  distance: false,
  intensity: true,
  hr: true,
  feedback: false,
  delta: true,
};

const isSplitMetricVisibility = (value: unknown): value is SplitMetricVisibility => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return ['distance', 'intensity', 'hr', 'feedback', 'delta'].every((key) => typeof candidate[key] === 'boolean');
};

const formatDeltaPct = (left: number, right: number) => {
  if (!Number.isFinite(left) || left <= 0 || !Number.isFinite(right)) return '-';
  const delta = ((right - left) / left) * 100;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
};

const getComparisonDirection = (left: number | null, right: number | null, lowerBetter = false) => {
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) return 'neutral' as const;
  const delta = right - left;
  if (Math.abs(delta) < 0.0001) return 'neutral' as const;
  const better = lowerBetter ? delta < 0 : delta > 0;
  return better ? 'better' as const : 'worse' as const;
};

const extractBestCurveValue = (curve: Record<string, number> | null | undefined, keys: string[]) => {
  for (const key of keys) {
    const value = safeNum(curve?.[key]);
    if (value > 0) return value;
  }
  return null;
};

const extractZonesForDetail = (detail: ActivityDetail, athlete?: AthleteLike) => {
  const sport = normalizeSport(detail.sport);
  // Use moving_time if available, fallback to duration
  const durationSeconds = safeNum(detail.moving_time || detail.duration);
  const running = emptyRunningZones();
  const cycling = emptyCyclingZones();

  if (sport === 'running') {
    if (detail.hr_zones) {
      for (let zone = 1; zone <= 5; zone += 1) {
        running[`Z${zone}`] += safeNum(detail.hr_zones[`Z${zone}`]);
      }
    } else if (athlete?.profile?.max_hr && detail.average_hr) {
      const zone = runningZoneFromHr(detail.average_hr, athlete.profile.max_hr);
      running[`Z${zone}`] += durationSeconds;
    }
  }

  if (sport === 'cycling') {
    const ftp = athlete?.profile?.ftp || null;
    const powerSamples = Array.isArray(detail.streams)
      ? detail.streams.map((row) => safeNum((row as any)?.power)).filter((value) => value > 0)
      : [];

    if (ftp && powerSamples.length > 0) {
      const secondsPerSample = durationSeconds > 0 ? durationSeconds / powerSamples.length : 1;
      powerSamples.forEach((watts) => {
        const zone = cyclingZoneFromPower(watts, ftp);
        cycling[`Z${zone}`] += secondsPerSample;
      });
    } else if (ftp && detail.average_watts) {
      const zone = cyclingZoneFromPower(detail.average_watts, ftp);
      cycling[`Z${zone}`] += durationSeconds;
    }
  }

  return { sport, running, cycling };
};

const extractSplits = (detail: ActivityDetail): SplitRow[] => {
  const sportName = (detail.sport || '').toLowerCase();
  const isCycling = sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride') || sportName.includes('virtualride');
  const hasLaps = Array.isArray(detail.laps) && detail.laps.length > 0;
  const hasMetric = Array.isArray(detail.splits_metric) && detail.splits_metric.length > 0;

  // Prefer laps for cycling (or when no metric splits), matching ActivityDetailPage behavior
  const source = (isCycling || !hasMetric) && hasLaps
    ? detail.laps!
    : hasMetric
      ? detail.splits_metric!
      : hasLaps
        ? detail.laps!
        : [];

  return source
    .map((row: any, index: number) => ({
      split: Number(row?.split || index + 1),
      durationSec: safeNum(row?.duration || row?.elapsed_time || row?.moving_time),
      distanceM: safeNum(row?.distance),
      avgHr: safeNum(row?.avg_hr || row?.average_heartrate) || null,
      avgPower: safeNum(row?.avg_power || row?.average_watts) || null,
      avgSpeed: safeNum(row?.avg_speed || row?.average_speed) || null,
      rpe: safeNum(row?.rpe) || null,
      lactate: safeNum(row?.lactate_mmol_l) || null,
      note: typeof row?.note === 'string' && row.note.trim() ? row.note.trim() : null,
    }))
    .filter((row) => row.durationSec > 0 || row.distanceM > 0 || row.avgHr != null || row.avgPower != null || row.avgSpeed != null);
};

const normalizeStreams = (value: unknown): any[] => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const maybeData = (value as { data?: unknown }).data;
    if (Array.isArray(maybeData)) return maybeData;
  }
  return [];
};

const buildAggregate = (details: ActivityDetail[], athleteMap: Map<number, AthleteLike>): Aggregate => {
  const aggregate: Aggregate = {
    activitiesCount: 0,
    totalMinutes: 0,
    totalDistanceKm: 0,
    avgHr: null,
    avgPower: null,
    weightedAvgPower: null,
    totalLoadImpact: 0,
    runningZones: emptyRunningZones(),
    cyclingZones: emptyCyclingZones(),
    best20mPower: null,
    best20mPace: null,
    keySessions: [],
  };

  let hrWeighted = 0;
  let hrMinutes = 0;
  let powerWeighted = 0;
  let powerMinutes = 0;
  let best20mPower = 0;
  let best20mSpeed = 0;

  const rankedSessions = details
    .slice()
    .sort((left, right) => (safeNum(right.total_load_impact) || safeNum(right.duration)) - (safeNum(left.total_load_impact) || safeNum(left.duration)));

  details.forEach((detail) => {
    const athlete = athleteMap.get(detail.athlete_id);
    // Use moving_time if available, fallback to duration
    const durationMinutes = safeNum(detail.moving_time || detail.duration) / 60;
    const distanceKm = safeNum(detail.distance) / 1000;

    aggregate.activitiesCount += 1;
    aggregate.totalMinutes += durationMinutes;
    aggregate.totalDistanceKm += distanceKm;
    aggregate.totalLoadImpact += safeNum(detail.total_load_impact);

    if (detail.average_hr && durationMinutes > 0) {
      hrWeighted += detail.average_hr * durationMinutes;
      hrMinutes += durationMinutes;
    }

    if (detail.average_watts && durationMinutes > 0) {
      powerWeighted += detail.average_watts * durationMinutes;
      powerMinutes += durationMinutes;
    }

    const power20 = safeNum(extractBestCurveValue(detail.power_curve, ['20min', '1200s', '1800s']));
    if (power20 > best20mPower) best20mPower = power20;

    const speed20 = safeNum(extractBestCurveValue(detail.pace_curve, ['20min', '1200s', '1800s']));
    if (speed20 > best20mSpeed) best20mSpeed = speed20;

    const zones = extractZonesForDetail(detail, athlete);
    for (let zone = 1; zone <= 5; zone += 1) {
      aggregate.runningZones[`Z${zone}`] += zones.running[`Z${zone}`] || 0;
    }
    for (let zone = 1; zone <= 7; zone += 1) {
      aggregate.cyclingZones[`Z${zone}`] += zones.cycling[`Z${zone}`] || 0;
    }
  });

  aggregate.avgHr = hrMinutes > 0 ? hrWeighted / hrMinutes : null;
  aggregate.avgPower = powerMinutes > 0 ? powerWeighted / powerMinutes : null;
  aggregate.weightedAvgPower = powerMinutes > 0 ? powerWeighted / powerMinutes : null;
  aggregate.best20mPower = best20mPower > 0 ? best20mPower : null;
  aggregate.best20mPace = best20mSpeed > 0 ? (1000 / (best20mSpeed * 60)) : null;
  aggregate.keySessions = rankedSessions.slice(0, 1);

  return aggregate;
};

const dominantZone = (zones: Record<string, number>) => {
  let winner = 'Z1';
  let seconds = 0;
  Object.entries(zones).forEach(([key, value]) => {
    if (value > seconds) {
      winner = key;
      seconds = value;
    }
  });
  const total = Object.values(zones).reduce((sum, value) => sum + value, 0);
  return { zone: winner, sharePct: total > 0 ? (seconds / total) * 100 : 0 };
};

const buildPeriodAggregate = (rows: ActivityListItem[]): PeriodAggregate => {
  let durationWeightedHr = 0;
  let durationWeightedPower = 0;
  let durationMinutesForHr = 0;
  let durationMinutesForPower = 0;

  const aggregate: PeriodAggregate = {
    activitiesCount: rows.length,
    totalMinutes: 0,
    totalDistanceKm: 0,
    totalLoadImpact: 0,
    aerobicLoad: 0,
    anaerobicLoad: 0,
    avgLoadPerSession: 0,
    avgHr: null,
    avgPower: null,
  };

  rows.forEach((row) => {
    const minutes = safeNum(row.moving_time || row.duration) / 60;
    const distanceKm = safeNum(row.distance) / 1000;
    const totalLoad = safeNum(row.total_load_impact);
    const aerobic = safeNum((row as any).aerobic_load);
    const anaerobic = safeNum((row as any).anaerobic_load);

    aggregate.totalMinutes += minutes;
    aggregate.totalDistanceKm += distanceKm;
    aggregate.totalLoadImpact += totalLoad;
    aggregate.aerobicLoad += aerobic;
    aggregate.anaerobicLoad += anaerobic;

    if (row.average_hr != null && minutes > 0) {
      durationWeightedHr += safeNum(row.average_hr) * minutes;
      durationMinutesForHr += minutes;
    }

    if (row.average_watts != null && minutes > 0) {
      durationWeightedPower += safeNum(row.average_watts) * minutes;
      durationMinutesForPower += minutes;
    }
  });

  aggregate.avgHr = durationMinutesForHr > 0 ? durationWeightedHr / durationMinutesForHr : null;
  aggregate.avgPower = durationMinutesForPower > 0 ? durationWeightedPower / durationMinutesForPower : null;
  aggregate.avgLoadPerSession = aggregate.activitiesCount > 0 ? aggregate.totalLoadImpact / aggregate.activitiesCount : 0;
  return aggregate;
};

const toIsoDateKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const resolvePeriodBounds = (mode: AnalysisMode, periodKey: string | null): { days: number; endDate: string } | null => {
  if (mode === 'workouts' || !periodKey) return null;

  if (mode === 'weeks') {
    const start = new Date(`${periodKey}T00:00:00`);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      days: 7,
      endDate: toIsoDateKey(end),
    };
  }

  const monthStart = new Date(`${periodKey}-01T00:00:00`);
  if (Number.isNaN(monthStart.getTime())) return null;
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const dayCount = Math.max(1, Math.floor((monthEnd.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  return {
    days: Math.min(60, dayCount),
    endDate: toIsoDateKey(monthEnd),
  };
};

const MetricComparison = ({ label, leftVal, rightVal, suffix, lowerBetter, decimals }: {
  label: string; leftVal: number | null; rightVal: number | null; suffix?: string; lowerBetter?: boolean; decimals?: number;
}) => {
  const d = decimals ?? 1;
  const fmt = (v: number) => v.toFixed(d);
  const delta = leftVal != null && rightVal != null ? rightVal - leftVal : null;
  const noChange = delta != null && Math.abs(delta) < Math.pow(10, -d) / 2;
  const improved = delta != null && !noChange ? (lowerBetter ? delta < 0 : delta > 0) : null;
  const deltaColor = improved == null || noChange ? 'dimmed' : improved ? 'teal' : 'red';
  return (
    <Paper withBorder p="xs" radius="sm">
      <Text size="10px" c="dimmed" tt="uppercase" mb={4}>{label}</Text>
      <Group gap={4} wrap="nowrap" align="center" justify="space-between">
        <Stack gap={0} align="center" style={{ flex: 1 }}>
          <Text fw={700} size="sm" style={{ color: '#E95A12' }}>{leftVal != null ? `${fmt(leftVal)}${suffix || ''}` : '-'}</Text>
          <Text size="9px" c="dimmed">A</Text>
        </Stack>
        <Text size="xs" fw={700} c={deltaColor} style={{ minWidth: 36, textAlign: 'center' }}>
          {delta != null && !noChange ? `${delta > 0 ? '+' : ''}${fmt(delta)}` : '—'}
        </Text>
        <Stack gap={0} align="center" style={{ flex: 1 }}>
          <Text fw={700} size="sm" style={{ color: '#6E4BF3' }}>{rightVal != null ? `${fmt(rightVal)}${suffix || ''}` : '-'}</Text>
          <Text size="9px" c="dimmed">B</Text>
        </Stack>
      </Group>
    </Paper>
  );
};

const WorkoutSummaryTable = ({ detail, title, t, sideColor }: { detail: ActivityDetail; title: string; t: (value: string) => string; sideColor?: string }) => {
  const isRunning = normalizeSport(detail.sport) === 'running';
  const bestPower5 = extractBestCurveValue(detail.power_curve, ['5s']);
  const bestPower60 = extractBestCurveValue(detail.power_curve, ['1min', '60s']);
  const bestPower300 = extractBestCurveValue(detail.power_curve, ['5min', '300s']);
  const bestPower1200 = extractBestCurveValue(detail.power_curve, ['20min', '1200s']);
  const bestPace1200 = extractBestCurveValue(detail.pace_curve, ['20min', '1200s']);

  return (
    <Paper withBorder p="sm" radius="md" style={sideColor ? { borderLeft: `4px solid ${sideColor}` } : undefined}>
      <Stack gap="sm">
        <Group justify="space-between">
          <Box>
            <Text size="xs" c="dimmed">{title}</Text>
            <Text fw={700}>{detail.filename}</Text>
            <Text size="xs" c="dimmed">{new Date(detail.created_at).toLocaleString()}</Text>
          </Box>
          <Stack gap={4} align="flex-end">
            <Badge variant="light">{normalizeSport(detail.sport)}</Badge>
            {detail.planned_comparison?.summary?.execution_status && (
              <Badge variant="dot">{`${t('Execution') || 'Execution'} ${detail.planned_comparison.summary.execution_status}`}</Badge>
            )}
          </Stack>
        </Group>

        <SimpleGrid cols={2} spacing="xs">
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Duration') || 'Duration'}</Text>
            <Text fw={700}>{formatMinutes(safeNum(detail.duration) / 60)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Distance') || 'Distance'}</Text>
            <Text fw={700}>{formatDistanceKm(safeNum(detail.distance) / 1000)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average HR') || 'Average HR'}</Text>
            <Text fw={700}>{detail.average_hr ? `${Math.round(detail.average_hr)} bpm` : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{isRunning ? (t('Average Pace') || 'Average Pace') : (t('Average Power') || 'Average Power')}</Text>
            <Text fw={700}>{isRunning ? formatPace(detail.avg_speed ? 1000 / (detail.avg_speed * 60) : null) : (detail.average_watts ? `${Math.round(detail.average_watts)} W` : '-')}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Training Load (TL)') || 'Training Load (TL)'}</Text>
            <Text fw={700}>{safeNum(detail.total_load_impact).toFixed(1)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Feedback') || 'Feedback'}</Text>
            <Text fw={700}>{detail.rpe != null ? `RPE ${detail.rpe}` : '-'}{detail.lactate_mmol_l != null ? ` · ${detail.lactate_mmol_l.toFixed(1)} mmol/L` : ''}</Text>
          </Paper>
        </SimpleGrid>

        <Table withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('Signal') || 'Signal'}</Table.Th>
              <Table.Th>{t('Value') || 'Value'}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>{t('Elevation Gain') || 'Elevation Gain'}</Table.Td>
              <Table.Td>{detail.total_elevation_gain ? `${Math.round(detail.total_elevation_gain)} m` : '-'}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>{t('Calories') || 'Calories'}</Table.Td>
              <Table.Td>{detail.total_calories ? `${Math.round(detail.total_calories)} kcal` : '-'}</Table.Td>
            </Table.Tr>
            {!isRunning && (
              <>
                <Table.Tr>
                  <Table.Td>{t('Peak 5s Power') || 'Peak 5s Power'}</Table.Td>
                  <Table.Td>{bestPower5 ? `${Math.round(bestPower5)} W` : '-'}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>{t('Peak 1min Power') || 'Peak 1min Power'}</Table.Td>
                  <Table.Td>{bestPower60 ? `${Math.round(bestPower60)} W` : '-'}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>{t('Peak 5min Power') || 'Peak 5min Power'}</Table.Td>
                  <Table.Td>{bestPower300 ? `${Math.round(bestPower300)} W` : '-'}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td>{t('Peak 20min Power') || 'Peak 20min Power'}</Table.Td>
                  <Table.Td>{bestPower1200 ? `${Math.round(bestPower1200)} W` : '-'}</Table.Td>
                </Table.Tr>
              </>
            )}
            {isRunning && (
              <Table.Tr>
                <Table.Td>{t('Best 20min Pace Proxy') || 'Best 20min Pace Proxy'}</Table.Td>
                <Table.Td>{bestPace1200 ? formatPace(1000 / (bestPace1200 * 60)) : '-'}</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>

        {detail.notes && detail.notes.trim() && (
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Coach Notes') || 'Coach Notes'}</Text>
            <Text size="sm">{detail.notes}</Text>
          </Paper>
        )}
      </Stack>
    </Paper>
  );
};

const PeriodSummaryTable = ({
  title,
  details,
  aggregate,
  athlete,
  sideColor,
  t,
}: {
  title: string;
  details: ActivityDetail[];
  aggregate: Aggregate;
  athlete?: AthleteLike;
  sideColor?: string;
  t: (value: string) => string;
}) => {
  const runningLeader = dominantZone(aggregate.runningZones);
  const cyclingLeader = dominantZone(aggregate.cyclingZones);

  return (
    <Paper withBorder p="sm" radius="md" style={sideColor ? { borderLeft: `4px solid ${sideColor}` } : undefined}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Text size="xs" c="dimmed">{title}</Text>
            <Text fw={700}>{athlete ? formatName(athlete) : (t('Unknown athlete') || 'Unknown athlete')}</Text>
            <Text size="xs" c="dimmed">{`${details.length} ${t('sessions loaded') || 'sessions loaded'}`}</Text>
          </Box>
          <Badge variant="light">{formatDistanceKm(aggregate.totalDistanceKm)}</Badge>
        </Group>

        <SimpleGrid cols={2} spacing="xs">
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Total time') || 'Total time'}</Text>
            <Text fw={700}>{formatMinutes(aggregate.totalMinutes)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Total distance') || 'Total distance'}</Text>
            <Text fw={700}>{formatDistanceKm(aggregate.totalDistanceKm)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Training load') || 'Training load'}</Text>
            <Text fw={700}>{aggregate.totalLoadImpact.toFixed(1)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average HR') || 'Average HR'}</Text>
            <Text fw={700}>{aggregate.avgHr ? `${Math.round(aggregate.avgHr)} bpm` : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average power') || 'Average power'}</Text>
            <Text fw={700}>{aggregate.avgPower ? `${Math.round(aggregate.avgPower)} W` : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Weighted avg power') || 'Weighted avg power'}</Text>
            <Text fw={700}>{aggregate.weightedAvgPower ? `${Math.round(aggregate.weightedAvgPower)} W` : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Best 20m power') || 'Best 20m power'}</Text>
            <Text fw={700}>{aggregate.best20mPower ? `${Math.round(aggregate.best20mPower)} W` : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Best 20m pace') || 'Best 20m pace'}</Text>
            <Text fw={700}>{aggregate.best20mPace ? formatPace(aggregate.best20mPace) : '-'}</Text>
          </Paper>
        </SimpleGrid>

        {(Object.values(aggregate.runningZones).some((value) => value > 0) || Object.values(aggregate.cyclingZones).some((value) => value > 0)) && (
          <SimpleGrid cols={2} spacing="xs">
            <Paper withBorder p="xs" radius="sm">
              <Group justify="space-between" mb={6}>
                <Text size="sm" fw={600}>{t('Running zones') || 'Running zones'}</Text>
                <Badge variant="light">{`${runningLeader.zone} ${runningLeader.sharePct.toFixed(0)}%`}</Badge>
              </Group>
              <ZoneBars zones={aggregate.runningZones} zoneCount={5} />
            </Paper>
            <Paper withBorder p="xs" radius="sm">
              <Group justify="space-between" mb={6}>
                <Text size="sm" fw={600}>{t('Cycling zones') || 'Cycling zones'}</Text>
                <Badge variant="light">{`${cyclingLeader.zone} ${cyclingLeader.sharePct.toFixed(0)}%`}</Badge>
              </Group>
              <ZoneBars zones={aggregate.cyclingZones} zoneCount={7} />
            </Paper>
          </SimpleGrid>
        )}

        <Paper withBorder p="xs" radius="sm">
          <Text size="10px" c="dimmed" tt="uppercase">{t('Key sessions') || 'Key sessions'}</Text>
          <Table withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('Session') || 'Session'}</Table.Th>
                <Table.Th>{t('Time') || 'Time'}</Table.Th>
                <Table.Th>{t('TL') || 'TL'}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {aggregate.keySessions.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={3}>{t('No sessions in this selection') || 'No sessions in this selection'}</Table.Td>
                </Table.Tr>
              )}
              {aggregate.keySessions.map((session) => (
                <Table.Tr key={`${title}-session-${session.id}`}>
                  <Table.Td>
                    <Text size="sm">{session.filename}</Text>
                    <Text size="xs" c="dimmed">{new Date(session.created_at).toLocaleDateString()}</Text>
                  </Table.Td>
                  <Table.Td>{formatMinutes(safeNum(session.moving_time || session.duration) / 60)}</Table.Td>
                  <Table.Td>{safeNum(session.total_load_impact).toFixed(1)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      </Stack>
    </Paper>
  );
};

const PeriodTotalsPanel = ({
  title,
  aggregate,
  sideColor,
  t,
}: {
  title: string;
  aggregate: PeriodAggregate;
  sideColor?: string;
  t: (value: string) => string;
}) => {
  return (
    <Paper withBorder p="sm" radius="md" style={sideColor ? { borderLeft: `4px solid ${sideColor}` } : undefined}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Text fw={700}>{title}</Text>
          <Badge variant="light">{aggregate.activitiesCount} {t('Sessions') || 'Sessions'}</Badge>
        </Group>

        <SimpleGrid cols={2} spacing="xs">
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Total time') || 'Total time'}</Text>
            <Text fw={700}>{formatMinutes(aggregate.totalMinutes)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Total distance') || 'Total distance'}</Text>
            <Text fw={700}>{formatDistanceKm(aggregate.totalDistanceKm)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Total intensity') || 'Total intensity'}</Text>
            <Text fw={700}>{aggregate.totalLoadImpact.toFixed(1)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Aerobic') || 'Aerobic'}</Text>
            <Text fw={700}>{aggregate.aerobicLoad.toFixed(1)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Anaerobic') || 'Anaerobic'}</Text>
            <Text fw={700}>{aggregate.anaerobicLoad.toFixed(1)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average power') || 'Average power'}</Text>
            <Text fw={700}>{aggregate.avgPower != null ? `${Math.round(aggregate.avgPower)} W` : '-'}</Text>
          </Paper>
        </SimpleGrid>
      </Stack>
    </Paper>
  );
};

/* ── Calendar-based activity picker for workouts mode ── */
const ActivityCalendarPicker = ({
  title,
  activities,
  athleteMap,
  selectedId,
  onSelect,
  isDark,
  t,
}: {
  title: string;
  activities: ActivityListItem[];
  athleteMap: Map<number, AthleteLike>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isDark: boolean;
  t: (v: string) => string;
}) => {
  const toDateKey = useCallback((value: string | Date) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      }
      return null;
    }
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }, []);

  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, ActivityListItem[]>();
    activities.forEach((a) => {
      const key = toDateKey(a.created_at);
      if (!key) return;
      const list = map.get(key) || [];
      list.push(a);
      map.set(key, list);
    });
    return map;
  }, [activities, toDateKey]);

  const selectedDate = useMemo(() => {
    if (!selectedId) return null;
    const act = activities.find((a) => String(a.id) === selectedId);
    if (!act) return null;
    return toDateKey(act.created_at);
  }, [selectedId, activities, toDateKey]);

  const [focusDate, setFocusDate] = useState<string | null>(selectedDate);

  useEffect(() => {
    setFocusDate(selectedDate);
  }, [selectedDate]);

  const activitiesForFocusDate = useMemo(() => {
    if (!focusDate) return [];
    return (activitiesByDate.get(focusDate) || [])
      .slice()
      .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
  }, [focusDate, activitiesByDate]);

  const handleDateClick = useCallback((date: Date) => {
    const key = toDateKey(date);
    if (!key) return;
    setFocusDate(key);
    const dayActivities = (activitiesByDate.get(key) || [])
      .slice()
      .sort((left, right) => (left.created_at < right.created_at ? 1 : -1));
    if (dayActivities.length > 0) {
      onSelect(String(dayActivities[0].id));
    }
  }, [activitiesByDate, onSelect, toDateKey]);

  const selectedActivity = useMemo(
    () => activities.find((a) => String(a.id) === selectedId),
    [activities, selectedId],
  );

  const accentColor = '#E95A12';
  const dotColor = isDark ? 'rgba(233,90,18,0.7)' : 'rgba(233,90,18,0.85)';

  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap="xs">
        <Text size="sm" fw={600}>{title}</Text>

        <DatePicker
          value={focusDate ? new Date(focusDate + 'T00:00:00') : null}
          onChange={(d) => d && handleDateClick(d)}
          date={pickerDate}
          onDateChange={setPickerDate}
          size="sm"
          getDayProps={(date) => {
            const key = toDateKey(date);
            if (!key) return {};
            const hasActivities = activitiesByDate.has(key);
            const isSelected = selectedDate === key;
            return {
              style: {
                position: 'relative' as const,
                ...(hasActivities && !isSelected
                  ? { fontWeight: 700, color: accentColor }
                  : {}),
              },
              ...(hasActivities
                ? {
                    children: (
                      <>
                        {date.getDate()}
                        <Box
                          style={{
                            position: 'absolute',
                            bottom: 2,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: isSelected ? '#fff' : dotColor,
                          }}
                        />
                      </>
                    ),
                  }
                : {}),
            };
          }}
        />

        {selectedActivity && (
          <Paper withBorder p="xs" radius="sm" bg={isDark ? 'rgba(233,90,18,0.08)' : 'rgba(233,90,18,0.05)'} style={{ borderColor: accentColor }}>
            <Text size="xs" c="dimmed">{t('Selected') || 'Selected'}</Text>
            <Text size="sm" fw={600}>{selectedActivity.filename}</Text>
            <Text size="xs" c="dimmed">
              {formatName(athleteMap.get(selectedActivity.athlete_id))} · {new Date(selectedActivity.created_at).toLocaleDateString()} · {normalizeSport(selectedActivity.sport)}
            </Text>
          </Paper>
        )}

        {focusDate && activitiesForFocusDate.length > 0 && (
          <ScrollArea.Autosize mah={180}>
            <Stack gap={4}>
              {activitiesForFocusDate.map((a) => {
                const isActive = String(a.id) === selectedId;
                return (
                  <UnstyledButton
                    key={a.id}
                    onClick={() => onSelect(String(a.id))}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: isActive ? `2px solid ${accentColor}` : `1px solid ${isDark ? '#333' : '#ddd'}`,
                      background: isActive
                        ? (isDark ? 'rgba(233,90,18,0.12)' : 'rgba(233,90,18,0.06)')
                        : 'transparent',
                    }}
                  >
                    <Group gap="xs" wrap="nowrap" justify="space-between">
                      <Box style={{ minWidth: 0 }}>
                        <Text size="xs" fw={600} truncate>{a.filename}</Text>
                        <Text size="xs" c="dimmed">
                          {formatName(athleteMap.get(a.athlete_id))} · {normalizeSport(a.sport)}
                          {a.duration ? ` · ${formatMinutes(safeNum(a.duration) / 60)}` : ''}
                          {a.distance ? ` · ${(safeNum(a.distance) / 1000).toFixed(1)}km` : ''}
                        </Text>
                      </Box>
                      <Badge size="xs" variant="light">{normalizeSport(a.sport)}</Badge>
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}

        {focusDate && activitiesForFocusDate.length === 0 && (
          <Text size="xs" c="dimmed" ta="center">{t('No activities on this date') || 'No activities on this date'}</Text>
        )}
      </Stack>
    </Paper>
  );
};

export const CoachComparisonPanel = ({ athletes, me, isAthlete }: { athletes: AthleteLike[]; me: AthleteLike; isAthlete?: boolean }) => {
  const { t } = useI18n();
  const isDark = useComputedColorScheme('light') === 'dark';
  const isMobile = useMediaQuery('(max-width: 48em)');
  const [mode, setMode] = useState<AnalysisMode>('workouts');
  const [leftWorkoutId, setLeftWorkoutId] = useState<string | null>(null);
  const [rightWorkoutId, setRightWorkoutId] = useState<string | null>(null);
  const [leftAthleteId, setLeftAthleteId] = useState<string | null>(null);
  const [rightAthleteId, setRightAthleteId] = useState<string | null>(null);
  const [leftPeriodKey, setLeftPeriodKey] = useState<string | null>(null);
  const [rightPeriodKey, setRightPeriodKey] = useState<string | null>(null);
  const [streamOffset, setStreamOffset] = useState(0);
  const [streamMetric, setStreamMetric] = useState<'hr' | 'power' | 'cadence'>('hr');
  const [splitMetricVisibility, setSplitMetricVisibility] = useState<SplitMetricVisibility | null>(null);

  const defaultSplitMetricVisibility = useMemo(
    () => (isMobile ? DEFAULT_SPLIT_METRICS_MOBILE : DEFAULT_SPLIT_METRICS_DESKTOP),
    [isMobile],
  );

  const effectiveSplitMetricVisibility = splitMetricVisibility ?? defaultSplitMetricVisibility;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('comparison-split-metrics-v1');
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (isSplitMetricVisibility(parsed)) {
        setSplitMetricVisibility(parsed);
      }
    } catch {
      // Ignore malformed local preferences and fall back to defaults.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !splitMetricVisibility) return;
    window.localStorage.setItem('comparison-split-metrics-v1', JSON.stringify(splitMetricVisibility));
  }, [splitMetricVisibility]);

  const allAthletes = useMemo(() => {
    const existing = new Map<number, AthleteLike>();
    athletes.forEach((athlete) => existing.set(athlete.id, athlete));
    if (!existing.has(me.id)) existing.set(me.id, me);
    return Array.from(existing.values());
  }, [athletes, me]);

  const athleteMap = useMemo(() => new Map(allAthletes.map((athlete) => [athlete.id, athlete])), [allAthletes]);

  const { data: activities = [], isLoading: activitiesLoading, error: activitiesError } = useQuery({
    queryKey: ['coach-comparison-activities-v2', mode !== 'workouts'],
    queryFn: async () => {
      const res = await api.get<ActivityListItem[]>('/activities/', {
        params: {
          limit: COMPARISON_ACTIVITY_FETCH_LIMIT,
          include_load_metrics: mode !== 'workouts',
        },
      });
      return res.data;
    },
    staleTime: 1000 * 60,
  });

  const workoutOptions = useMemo(() => (
    activities
      .slice()
      .sort((left, right) => (left.created_at < right.created_at ? 1 : -1))
      .map((activity) => ({
        value: String(activity.id),
        label: `${formatName(athleteMap.get(activity.athlete_id))} · ${new Date(activity.created_at).toLocaleDateString()} · ${normalizeSport(activity.sport)} · ${activity.filename}`,
      }))
  ), [activities, athleteMap]);

  const athleteOptions = useMemo(() => allAthletes.map((athlete) => ({
    value: String(athlete.id),
    label: formatName(athlete),
  })), [allAthletes]);

  const weekOptionsByAthlete = useMemo(() => {
    const out = new Map<string, Array<{ value: string; label: string }>>();
    allAthletes.forEach((athlete) => {
      const unique = Array.from(new Set(
        activities
          .filter((activity) => activity.athlete_id === athlete.id)
          .map((activity) => toWeekKey(activity.created_at))
          .filter((value): value is string => Boolean(value))
      )).sort((left, right) => (left < right ? 1 : -1));
      out.set(String(athlete.id), unique.map((value) => ({ value, label: parseWeekLabel(value) })));
    });
    return out;
  }, [activities, allAthletes]);

  const monthOptionsByAthlete = useMemo(() => {
    const out = new Map<string, Array<{ value: string; label: string }>>();
    allAthletes.forEach((athlete) => {
      const unique = Array.from(new Set(
        activities
          .filter((activity) => activity.athlete_id === athlete.id)
          .map((activity) => toMonthKey(activity.created_at))
          .filter((value): value is string => Boolean(value))
      )).sort((left, right) => (left < right ? 1 : -1));
      out.set(String(athlete.id), unique.map((value) => ({ value, label: parseMonthLabel(value) })));
    });
    return out;
  }, [activities, allAthletes]);

  useEffect(() => {
    if (!allAthletes.length) return;
    if (!leftAthleteId) setLeftAthleteId(String(allAthletes[0].id));
    if (!rightAthleteId) setRightAthleteId(String(allAthletes[1]?.id || allAthletes[0].id));
  }, [allAthletes, leftAthleteId, rightAthleteId]);

  useEffect(() => {
    if (!workoutOptions.length) {
      setLeftWorkoutId(null);
      setRightWorkoutId(null);
      return;
    }
    if (!leftWorkoutId || !workoutOptions.some((option) => option.value === leftWorkoutId)) {
      setLeftWorkoutId(workoutOptions[0].value);
    }
    if (!rightWorkoutId || !workoutOptions.some((option) => option.value === rightWorkoutId)) {
      setRightWorkoutId(workoutOptions[1]?.value || workoutOptions[0].value);
    }
  }, [workoutOptions, leftWorkoutId, rightWorkoutId]);

  const activePeriodOptions = mode === 'weeks' ? weekOptionsByAthlete : monthOptionsByAthlete;

  useEffect(() => {
    if (mode === 'workouts' || !leftAthleteId) return;
    const options = activePeriodOptions.get(leftAthleteId) || [];
    if (options.length > 0 && (!leftPeriodKey || !options.some((option) => option.value === leftPeriodKey))) {
      setLeftPeriodKey(options[0].value);
    }
  }, [mode, leftAthleteId, leftPeriodKey, activePeriodOptions]);

  useEffect(() => {
    if (mode === 'workouts' || !rightAthleteId) return;
    const options = activePeriodOptions.get(rightAthleteId) || [];
    if (options.length > 0 && (!rightPeriodKey || !options.some((option) => option.value === rightPeriodKey))) {
      setRightPeriodKey(options[0].value);
    }
  }, [mode, rightAthleteId, rightPeriodKey, activePeriodOptions]);

  const leftIds = useMemo(() => {
    if (mode === 'workouts') return leftWorkoutId ? [Number(leftWorkoutId)] : [];
    if (!leftAthleteId || !leftPeriodKey) return [];
    return activities
      .filter((activity) => String(activity.athlete_id) === leftAthleteId)
      .filter((activity) => (mode === 'weeks' ? toWeekKey(activity.created_at) : toMonthKey(activity.created_at)) === leftPeriodKey)
      .map((activity) => activity.id);
  }, [activities, leftAthleteId, leftPeriodKey, leftWorkoutId, mode]);

  const rightIds = useMemo(() => {
    if (mode === 'workouts') return rightWorkoutId ? [Number(rightWorkoutId)] : [];
    if (!rightAthleteId || !rightPeriodKey) return [];
    return activities
      .filter((activity) => String(activity.athlete_id) === rightAthleteId)
      .filter((activity) => (mode === 'weeks' ? toWeekKey(activity.created_at) : toMonthKey(activity.created_at)) === rightPeriodKey)
      .map((activity) => activity.id);
  }, [activities, mode, rightAthleteId, rightPeriodKey, rightWorkoutId]);

  const idsToLoad = useMemo(() => Array.from(new Set([...leftIds, ...rightIds])), [leftIds, rightIds]);

  const { data: detailsById = new Map<number, ActivityDetail>(), isLoading: detailsLoading } = useQuery({
    queryKey: ['coach-comparison-details-v2', mode, [...idsToLoad].sort((a, b) => a - b).join(',')],
    queryFn: async () => {
      const results = await Promise.allSettled(idsToLoad.map(async (id) => {
        const res = await api.get<ActivityDetail>(`/activities/${id}`);
        return [id, res.data] as const;
      }));
      const map = new Map<number, ActivityDetail>();
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          map.set(result.value[0], result.value[1]);
        }
      });
      return map;
    },
    enabled: mode === 'workouts' && idsToLoad.length > 0,
    staleTime: 1000 * 60,
  });

  const leftDetails = useMemo(
    () => leftIds.map((id) => detailsById.get(id)).filter((detail): detail is ActivityDetail => Boolean(detail)),
    [leftIds, detailsById]
  );
  const rightDetails = useMemo(
    () => rightIds.map((id) => detailsById.get(id)).filter((detail): detail is ActivityDetail => Boolean(detail)),
    [rightIds, detailsById]
  );

  const leftAggregate = useMemo(() => buildAggregate(leftDetails, athleteMap), [leftDetails, athleteMap]);
  const rightAggregate = useMemo(() => buildAggregate(rightDetails, athleteMap), [rightDetails, athleteMap]);

  const leftWorkout = leftDetails[0];
  const rightWorkout = rightDetails[0];
  const leftSplits = useMemo(() => (leftWorkout ? extractSplits(leftWorkout) : []), [leftWorkout]);
  const rightSplits = useMemo(() => (rightWorkout ? extractSplits(rightWorkout) : []), [rightWorkout]);
  const splitRows = useMemo(() => {
    const maxRows = Math.max(leftSplits.length, rightSplits.length);
    return Array.from({ length: maxRows }, (_, index) => ({
      split: index + 1,
      left: leftSplits[index] || null,
      right: rightSplits[index] || null,
    }));
  }, [leftSplits, rightSplits]);

  const detailFailureCount = Math.max(0, idsToLoad.length - detailsById.size);
  const hasLoadedDetails = leftDetails.length > 0 || rightDetails.length > 0;

  const activityById = useMemo(() => {
    const map = new Map<number, ActivityListItem>();
    activities.forEach((activity) => {
      map.set(activity.id, activity);
    });
    return map;
  }, [activities]);

  const leftPeriodActivities = useMemo(
    () => leftIds.map((id) => activityById.get(id)).filter((row): row is ActivityListItem => Boolean(row)),
    [leftIds, activityById],
  );
  const rightPeriodActivities = useMemo(
    () => rightIds.map((id) => activityById.get(id)).filter((row): row is ActivityListItem => Boolean(row)),
    [rightIds, activityById],
  );

  const leftPeriodAggregate = useMemo(() => buildPeriodAggregate(leftPeriodActivities), [leftPeriodActivities]);
  const rightPeriodAggregate = useMemo(() => buildPeriodAggregate(rightPeriodActivities), [rightPeriodActivities]);

  const leftPeriodBounds = useMemo(() => resolvePeriodBounds(mode, leftPeriodKey), [mode, leftPeriodKey]);
  const rightPeriodBounds = useMemo(() => resolvePeriodBounds(mode, rightPeriodKey), [mode, rightPeriodKey]);

  const { data: leftTrainingHistory = [], isLoading: leftTrainingHistoryLoading } = useQuery({
    queryKey: ['comparison-training-status-history', 'left', leftAthleteId, leftPeriodBounds?.days, leftPeriodBounds?.endDate],
    queryFn: async () => {
      const response = await api.get('/activities/training-status-history', {
        params: {
          athlete_id: leftAthleteId ? Number(leftAthleteId) : undefined,
          days: leftPeriodBounds?.days,
          end_date: leftPeriodBounds?.endDate,
        },
      });
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: mode !== 'workouts' && Boolean(leftAthleteId && leftPeriodBounds),
    staleTime: 1000 * 60,
  });

  const { data: rightTrainingHistory = [], isLoading: rightTrainingHistoryLoading } = useQuery({
    queryKey: ['comparison-training-status-history', 'right', rightAthleteId, rightPeriodBounds?.days, rightPeriodBounds?.endDate],
    queryFn: async () => {
      const response = await api.get('/activities/training-status-history', {
        params: {
          athlete_id: rightAthleteId ? Number(rightAthleteId) : undefined,
          days: rightPeriodBounds?.days,
          end_date: rightPeriodBounds?.endDate,
        },
      });
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: mode !== 'workouts' && Boolean(rightAthleteId && rightPeriodBounds),
    staleTime: 1000 * 60,
  });

  const leftTrainingHistorySeries = useMemo(() => {
    return leftTrainingHistory.map((row: any, idx: number) => ({
      label: typeof row?.reference_date === 'string' ? row.reference_date.slice(5) : String(idx + 1),
      fatigue: safeNum(row?.atl),
      fitness: safeNum(row?.ctl),
      form: safeNum(row?.tsb),
    }));
  }, [leftTrainingHistory]);

  const rightTrainingHistorySeries = useMemo(() => {
    return rightTrainingHistory.map((row: any, idx: number) => ({
      label: typeof row?.reference_date === 'string' ? row.reference_date.slice(5) : String(idx + 1),
      fatigue: safeNum(row?.atl),
      fitness: safeNum(row?.ctl),
      form: safeNum(row?.tsb),
    }));
  }, [rightTrainingHistory]);

  const splitChartData = useMemo(() => {
    if (mode !== 'workouts') return [];
    const maxLen = Math.max(leftSplits.length, rightSplits.length);
    if (maxLen === 0) return [];
    const usesPower = leftSplits.some((s) => s.avgPower != null) || rightSplits.some((s) => s.avgPower != null);
    return Array.from({ length: maxLen }, (_, i) => {
      const l = leftSplits[i];
      const r = rightSplits[i];
      return {
        split: i + 1,
        valA: usesPower ? (l?.avgPower ?? null) : (l?.avgSpeed ? +(1000 / (l.avgSpeed * 60)).toFixed(2) : null),
        valB: usesPower ? (r?.avgPower ?? null) : (r?.avgSpeed ? +(1000 / (r.avgSpeed * 60)).toFixed(2) : null),
        hrA: l?.avgHr ?? null,
        hrB: r?.avgHr ?? null,
        splitUsesPower: usesPower,
      };
    });
  }, [mode, leftSplits, rightSplits]);

  const chartColors = { sideA: '#E95A12', sideB: '#6E4BF3' };

  const streamChartData = useMemo(() => {
    if (mode !== 'workouts') return [];
    const ls = normalizeStreams(leftWorkout?.streams);
    const rs = normalizeStreams(rightWorkout?.streams);
    const hasLeft = ls.length > 0;
    const hasRight = rs.length > 0;
    if (!hasLeft && !hasRight) return [];
    const aStart = streamOffset < 0 ? Math.abs(streamOffset) : 0;
    const bStart = streamOffset > 0 ? streamOffset : 0;
    const lLen = hasLeft ? Math.max(0, ls.length - aStart) : 0;
    const rLen = hasRight ? Math.max(0, rs.length - bStart) : 0;
    const len = Math.max(lLen, rLen);
    const step = Math.max(1, Math.floor(len / 400));
    const result: { t: number; hrA: number | null; hrB: number | null; pwA: number | null; pwB: number | null; cdA: number | null; cdB: number | null }[] = [];
    for (let i = 0; i < len; i += step) {
      const lIdx = i + aStart;
      const rIdx = i + bStart;
      const lr = hasLeft && lIdx < ls.length ? (ls[lIdx] as any) : null;
      const rr = hasRight && rIdx < rs.length ? (rs[rIdx] as any) : null;
      const leftHrRaw = Number(lr?.heart_rate ?? lr?.hr ?? lr?.heartrate ?? null);
      const rightHrRaw = Number(rr?.heart_rate ?? rr?.hr ?? rr?.heartrate ?? null);
      const leftPowerRaw = Number(lr?.power ?? lr?.watts ?? lr?.power_raw ?? null);
      const rightPowerRaw = Number(rr?.power ?? rr?.watts ?? rr?.power_raw ?? null);
      const leftCadenceRaw = Number(lr?.cadence ?? lr?.cad ?? null);
      const rightCadenceRaw = Number(rr?.cadence ?? rr?.cad ?? null);
      result.push({
        t: +(i / 60).toFixed(1),
        hrA: Number.isFinite(leftHrRaw) && leftHrRaw > 0 ? Math.round(leftHrRaw) : null,
        hrB: Number.isFinite(rightHrRaw) && rightHrRaw > 0 ? Math.round(rightHrRaw) : null,
        pwA: Number.isFinite(leftPowerRaw) && leftPowerRaw > 0 ? Math.round(leftPowerRaw) : null,
        pwB: Number.isFinite(rightPowerRaw) && rightPowerRaw > 0 ? Math.round(rightPowerRaw) : null,
        cdA: Number.isFinite(leftCadenceRaw) && leftCadenceRaw > 0 ? Math.round(leftCadenceRaw) : null,
        cdB: Number.isFinite(rightCadenceRaw) && rightCadenceRaw > 0 ? Math.round(rightCadenceRaw) : null,
      });
    }
    return result;
  }, [mode, leftWorkout, rightWorkout, streamOffset]);

  const hasHrStreams = streamChartData.some((d) => d.hrA != null || d.hrB != null);
  const hasPowerStreams = streamChartData.some((d) => d.pwA != null || d.pwB != null);
  const hasCadenceStreams = streamChartData.some((d) => d.cdA != null || d.cdB != null);

  const POWER_CURVE_WINDOWS = ['5s', '15s', '30s', '1min', '2min', '5min', '10min', '20min', '60min', '120min'];

  const powerCurveChartData = useMemo(() => {
    if (mode !== 'workouts') return [];
    if (!leftWorkout?.power_curve && !rightWorkout?.power_curve) return [];
    return POWER_CURVE_WINDOWS
      .map((w) => ({
        window: w,
        sideA: leftWorkout?.power_curve?.[w] != null ? Math.round(safeNum(leftWorkout.power_curve[w])) : null,
        sideB: rightWorkout?.power_curve?.[w] != null ? Math.round(safeNum(rightWorkout.power_curve[w])) : null,
      }))
      .filter((row) => row.sideA != null || row.sideB != null);
  }, [mode, leftWorkout, rightWorkout]);

  const zoneChartData = useMemo(() => {
    if (!leftWorkout || !rightWorkout || mode !== 'workouts') return [];
    const lz = extractZonesForDetail(leftWorkout, athleteMap.get(leftWorkout.athlete_id));
    const rz = extractZonesForDetail(rightWorkout, athleteMap.get(rightWorkout.athlete_id));
    const isCycling = lz.sport === 'cycling' || rz.sport === 'cycling';
    const lZones = isCycling ? lz.cycling : lz.running;
    const rZones = isCycling ? rz.cycling : rz.running;
    const count = isCycling ? 7 : 5;
    return Array.from({ length: count }, (_, idx) => ({
      zone: `Z${idx + 1}`,
      sideA: Math.round((lZones[`Z${idx + 1}`] || 0) / 60),
      sideB: Math.round((rZones[`Z${idx + 1}`] || 0) / 60),
    })).filter((row) => row.sideA > 0 || row.sideB > 0);
  }, [mode, leftWorkout, rightWorkout, athleteMap]);

  const leftPeriodLabel = mode === 'weeks'
    ? (leftPeriodKey ? parseWeekLabel(leftPeriodKey) : '-')
    : (leftPeriodKey ? parseMonthLabel(leftPeriodKey) : '-');
  const rightPeriodLabel = mode === 'weeks'
    ? (rightPeriodKey ? parseWeekLabel(rightPeriodKey) : '-')
    : (rightPeriodKey ? parseMonthLabel(rightPeriodKey) : '-');

  const workoutInsights = useMemo(() => {
    if (!leftWorkout || !rightWorkout) return [] as string[];
    const insights: string[] = [];
    insights.push(`${t('Duration change') || 'Duration change'}: ${formatDeltaPct(safeNum(leftWorkout.duration), safeNum(rightWorkout.duration))}`);
    insights.push(`${t('Distance change') || 'Distance change'}: ${formatDeltaPct(safeNum(leftWorkout.distance), safeNum(rightWorkout.distance))}`);
    insights.push(`${t('TL difference') || 'TL difference'}: ${compareValue(safeNum(leftWorkout.total_load_impact), safeNum(rightWorkout.total_load_impact))}`);
    if (leftWorkout.rpe != null || rightWorkout.rpe != null) {
      insights.push(`${t('RPE shift') || 'RPE shift'}: ${compareValue(leftWorkout.rpe ?? null, rightWorkout.rpe ?? null)}`);
    }
    insights.push(`${t('Split count') || 'Split count'}: ${leftSplits.length} → ${rightSplits.length}`);
    return insights;
  }, [leftSplits.length, leftWorkout, rightSplits.length, rightWorkout, t]);

  const periodInsights = useMemo(() => {
    if (mode === 'workouts') return [] as string[];
    return [
      `${t('Volume change') || 'Volume change'}: ${formatDeltaPct(leftPeriodAggregate.totalMinutes, rightPeriodAggregate.totalMinutes)}`,
      `${t('Distance change') || 'Distance change'}: ${formatDeltaPct(leftPeriodAggregate.totalDistanceKm, rightPeriodAggregate.totalDistanceKm)}`,
      `${t('Load change') || 'Load change'}: ${compareValue(leftPeriodAggregate.totalLoadImpact, rightPeriodAggregate.totalLoadImpact)}`,
      `${t('Sessions') || 'Sessions'}: ${compareValue(leftPeriodAggregate.activitiesCount, rightPeriodAggregate.activitiesCount)}`,
      `${t('Average load / session') || 'Average load / session'}: ${compareValue(leftPeriodAggregate.avgLoadPerSession, rightPeriodAggregate.avgLoadPerSession)}`,
    ];
  }, [leftPeriodAggregate, mode, rightPeriodAggregate, t]);

  const compareCards = mode === 'workouts'
    ? [
        { label: t('Duration') || 'Duration', value: compareValue(safeNum(leftWorkout?.duration) / 60, safeNum(rightWorkout?.duration) / 60, ' min') },
        { label: t('Distance') || 'Distance', value: compareValue(safeNum(leftWorkout?.distance) / 1000, safeNum(rightWorkout?.distance) / 1000, ' km') },
        { label: t('Average HR') || 'Average HR', value: compareValue(leftWorkout?.average_hr ?? null, rightWorkout?.average_hr ?? null, ' bpm') },
        { label: t('Average power / pace') || 'Average power / pace', value: compareValue(leftWorkout?.average_watts ?? null, rightWorkout?.average_watts ?? null, ' W') },
      ]
    : [
        { label: t('Sessions') || 'Sessions', value: compareValue(leftPeriodAggregate.activitiesCount, rightPeriodAggregate.activitiesCount) },
        { label: t('Total time') || 'Total time', value: compareValue(leftPeriodAggregate.totalMinutes, rightPeriodAggregate.totalMinutes, ' min') },
        { label: t('Distance') || 'Distance', value: compareValue(leftPeriodAggregate.totalDistanceKm, rightPeriodAggregate.totalDistanceKm, ' km') },
        { label: t('Load') || 'Load', value: compareValue(leftPeriodAggregate.totalLoadImpact, rightPeriodAggregate.totalLoadImpact) },
      ];

  const leftSideLabel = mode === 'workouts'
    ? `${t('Side A') || 'Side A'} · ${formatName(leftWorkout ? athleteMap.get(leftWorkout.athlete_id) : undefined)}`
    : `${t('Side A') || 'Side A'} · ${leftPeriodLabel}`;
  const rightSideLabel = mode === 'workouts'
    ? `${t('Side B') || 'Side B'} · ${formatName(rightWorkout ? athleteMap.get(rightWorkout.athlete_id) : undefined)}`
    : `${t('Side B') || 'Side B'} · ${rightPeriodLabel}`;

  const selectionMissing = mode === 'workouts'
    ? !leftWorkoutId || !rightWorkoutId
    : !leftAthleteId || !rightAthleteId || !leftPeriodKey || !rightPeriodKey;

  const toggleSplitMetric = useCallback((key: keyof SplitMetricVisibility, checked: boolean) => {
    setSplitMetricVisibility((prev) => ({
      ...(prev ?? defaultSplitMetricVisibility),
      [key]: checked,
    }));
  }, [defaultSplitMetricVisibility]);

  const sideSelector = (
    side: 'left' | 'right',
    athleteId: string | null,
    setAthleteId: (value: string | null) => void,
    periodKey: string | null,
    setPeriodKey: (value: string | null) => void,
  ) => {
    const title = side === 'left' ? (t('Side A') || 'Side A') : (t('Side B') || 'Side B');
    const sideColor = side === 'left' ? chartColors.sideA : chartColors.sideB;
    const options = athleteId ? (activePeriodOptions.get(athleteId) || []) : [];
    const periodLabel = mode === 'weeks' ? (t('Week') || 'Week') : (t('Month') || 'Month');
    return (
      <Paper withBorder p="sm" radius="md" style={{ borderLeft: `4px solid ${sideColor}` }}>
        <Stack gap="xs">
          <Group gap="xs">
            <Box style={{ width: 10, height: 10, borderRadius: '50%', background: sideColor, flexShrink: 0 }} />
            <Text size="sm" fw={600}>{title}</Text>
          </Group>
          {!isAthlete && (
            <Select
              label={t('Athlete') || 'Athlete'}
              data={athleteOptions}
              value={athleteId}
              onChange={setAthleteId}
              searchable
            />
          )}
          <Select
            label={periodLabel}
            data={options}
            value={periodKey}
            onChange={setPeriodKey}
            disabled={!athleteId || options.length === 0}
          />
        </Stack>
      </Paper>
    );
  };

  return (
    <Paper p="lg" radius="lg" bg="transparent">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Box>
            <Group gap="xs" mb={2}>
              <IconChartBar size={18} />
              <Title order={4}>{isAthlete ? (t('Training Comparison') || 'Training Comparison') : (t('Coach Split-Screen Analysis') || 'Coach Split-Screen Analysis')}</Title>
            </Group>
            <Group gap="xs" mb={4}>
              <Badge size="xs" style={{ background: '#E95A12', color: '#fff' }}>A</Badge>
              <Text size="xs" c="dimmed">vs</Text>
              <Badge size="xs" style={{ background: '#6E4BF3', color: '#fff' }}>B</Badge>
            </Group>
            <Text size="sm" c="dimmed">
              {isAthlete
                ? (t('Compare your workouts, weeks, or months side by side to track your progress.') || 'Compare your workouts, weeks, or months side by side to track your progress.')
                : (t('Compare two workouts, weeks, or months side by side with the same analysis model.') || 'Compare two workouts, weeks, or months side by side with the same analysis model.')}
            </Text>
          </Box>
          <SegmentedControl
            value={mode}
            onChange={(value) => { setMode(value as AnalysisMode); setStreamOffset(0); }}
            data={[
              { value: 'workouts', label: t('Workouts') || 'Workouts' },
              { value: 'weeks', label: t('Weeks') || 'Weeks' },
              { value: 'months', label: t('Months') || 'Months' },
            ]}
          />
        </Group>

        {mode === 'workouts' ? (
          <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
            <ActivityCalendarPicker
              title={t('Side A') || 'Side A'}
              activities={activities}
              athleteMap={athleteMap}
              selectedId={leftWorkoutId}
              onSelect={setLeftWorkoutId}
              isDark={isDark}
              t={t}
            />
            <ActivityCalendarPicker
              title={t('Side B') || 'Side B'}
              activities={activities}
              athleteMap={athleteMap}
              selectedId={rightWorkoutId}
              onSelect={setRightWorkoutId}
              isDark={isDark}
              t={t}
            />
          </SimpleGrid>
        ) : (
          <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
            {sideSelector('left', leftAthleteId, setLeftAthleteId, leftPeriodKey, setLeftPeriodKey)}
            {sideSelector('right', rightAthleteId, setRightAthleteId, rightPeriodKey, setRightPeriodKey)}
          </SimpleGrid>
        )}

        {activitiesError ? (
          <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
            {t('Comparison activity list failed to load.') || 'Comparison activity list failed to load.'}
          </Alert>
        ) : activitiesLoading || (mode === 'workouts' && detailsLoading) ? (
          <Stack gap="sm">
            <Skeleton height={60} radius="md" />
            <Skeleton height={200} radius="md" />
          </Stack>
        ) : selectionMissing ? (
          <Alert icon={<IconInfoCircle size={16} />} color="yellow" variant="light">
            {t('Select both sides to compare.') || 'Select both sides to compare.'}
          </Alert>
        ) : idsToLoad.length === 0 ? (
          <Alert icon={<IconCalendarStats size={16} />} color="blue" variant="light">
            {t('No training data exists for the current selection.') || 'No training data exists for the current selection.'}
          </Alert>
        ) : mode === 'workouts' && !hasLoadedDetails ? (
          <Alert icon={<IconAlertTriangle size={16} />} color="orange" variant="light">
            {t('Some selected activities could not be loaded. Try changing the selection or retrying.') || 'Some selected activities could not be loaded. Try changing the selection or retrying.'}
          </Alert>
        ) : (
          <Stack gap="md">
            {mode === 'workouts' && detailFailureCount > 0 && (
              <Alert icon={<IconAlertTriangle size={16} />} color="orange" variant="light">
                {t('Partial comparison data loaded.') || 'Partial comparison data loaded.'}
                <Text size="sm" mt={4}>
                  {t('Showing available activities only.') || 'Showing available activities only.'} {`${detailsById.size}/${idsToLoad.length}`}
                </Text>
              </Alert>
            )}
            {mode === 'workouts' && leftWorkout && rightWorkout && (
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs">
                <MetricComparison label={t('Duration') || 'Duration'} leftVal={safeNum(leftWorkout.duration) / 60} rightVal={safeNum(rightWorkout.duration) / 60} suffix=" min" lowerBetter decimals={0} />
                <MetricComparison label={t('Distance') || 'Distance'} leftVal={safeNum(leftWorkout.distance) / 1000} rightVal={safeNum(rightWorkout.distance) / 1000} suffix=" km" />
                <MetricComparison label={t('Avg HR') || 'Avg HR'} leftVal={leftWorkout.average_hr ?? null} rightVal={rightWorkout.average_hr ?? null} suffix=" bpm" lowerBetter decimals={0} />
                <MetricComparison label={t('Avg Power') || 'Avg Power'} leftVal={leftWorkout.average_watts ?? null} rightVal={rightWorkout.average_watts ?? null} suffix=" W" decimals={0} />
                <MetricComparison label={t('Training Load') || 'Training Load'} leftVal={safeNum(leftWorkout.total_load_impact)} rightVal={safeNum(rightWorkout.total_load_impact)} />
                <MetricComparison label={t('RPE') || 'RPE'} leftVal={leftWorkout.rpe ?? null} rightVal={rightWorkout.rpe ?? null} lowerBetter />
              </SimpleGrid>
            )}
            {mode !== 'workouts' && (
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs">
                <MetricComparison label={t('Sessions') || 'Sessions'} leftVal={leftPeriodAggregate.activitiesCount} rightVal={rightPeriodAggregate.activitiesCount} decimals={0} />
                <MetricComparison label={t('Total time') || 'Total time'} leftVal={leftPeriodAggregate.totalMinutes} rightVal={rightPeriodAggregate.totalMinutes} suffix=" min" decimals={0} />
                <MetricComparison label={t('Distance') || 'Distance'} leftVal={leftPeriodAggregate.totalDistanceKm} rightVal={rightPeriodAggregate.totalDistanceKm} suffix=" km" />
                <MetricComparison label={t('Total intensity') || 'Total intensity'} leftVal={leftPeriodAggregate.totalLoadImpact} rightVal={rightPeriodAggregate.totalLoadImpact} />
                <MetricComparison label={t('Aerobic') || 'Aerobic'} leftVal={leftPeriodAggregate.aerobicLoad} rightVal={rightPeriodAggregate.aerobicLoad} />
                <MetricComparison label={t('Anaerobic') || 'Anaerobic'} leftVal={leftPeriodAggregate.anaerobicLoad} rightVal={rightPeriodAggregate.anaerobicLoad} />
              </SimpleGrid>
            )}

            {/* ── Charts Section ── */}
            {mode === 'workouts' && (streamChartData.length > 0 || powerCurveChartData.length > 0 || zoneChartData.length > 0) && (
              <Paper withBorder p="sm" radius="md">
                <Tabs defaultValue={streamChartData.length > 0 ? 'stream' : powerCurveChartData.length > 0 ? 'curve' : 'zones'}>
                  <Tabs.List mb="sm">
                    {streamChartData.length > 0 && (
                      <Tabs.Tab value="stream" leftSection={<IconChartLine size={13} />}>
                        Stream Overlay
                      </Tabs.Tab>
                    )}
                    {powerCurveChartData.length > 0 && (
                      <Tabs.Tab value="curve" leftSection={<IconChartBar size={13} />}>
                        Power Curve
                      </Tabs.Tab>
                    )}
                    {zoneChartData.length > 0 && (
                      <Tabs.Tab value="zones" leftSection={<IconAdjustmentsHorizontal size={13} />}>
                        Zone Distribution
                      </Tabs.Tab>
                    )}
                    {splitChartData.length > 0 && (
                      <Tabs.Tab value="splitchart" leftSection={<IconArrowsDiff size={13} />}>
                        Split Pace/Power
                      </Tabs.Tab>
                    )}
                  </Tabs.List>

                  {streamChartData.length > 0 && (
                    <Tabs.Panel value="stream">
                      <Stack gap="sm">
                        <Group gap="sm" wrap="wrap" justify="space-between">
                          <Group gap="sm">
                            <Tabs value={streamMetric} onChange={(v: string | null) => setStreamMetric((v as 'hr' | 'power' | 'cadence') || 'hr')}>
                              <Tabs.List>
                                <Tabs.Tab value="hr">{t('Heart Rate Stream Comparison') || 'Heart Rate Stream Comparison'}</Tabs.Tab>
                                <Tabs.Tab value="power">{t('Power Stream Comparison') || 'Power Stream Comparison'}</Tabs.Tab>
                                <Tabs.Tab value="cadence">{t('Cadence Stream Comparison') || 'Cadence Stream Comparison'}</Tabs.Tab>
                              </Tabs.List>
                            </Tabs>
                            <Group gap={6}>
                              <Box style={{ width: 10, height: 10, borderRadius: 2, background: chartColors.sideA }} />
                              <Text size="xs" c="dimmed">Side A</Text>
                              <Box style={{ width: 10, height: 10, borderRadius: 2, background: chartColors.sideB, marginLeft: 6 }} />
                              <Text size="xs" c="dimmed">Side B</Text>
                            </Group>
                          </Group>
                          <Group gap="xs" align="center">
                            <Tooltip label="Drag the slider to shift Side B in time — align effort zones, intervals, or peaks from different parts of two activities" multiline w={240} withArrow>
                              <Text size="xs" c="dimmed" style={{ cursor: 'help' }}>
                                B offset: {streamOffset > 0 ? `+${streamOffset}s` : streamOffset < 0 ? `${streamOffset}s` : '0s (aligned)'}
                              </Text>
                            </Tooltip>
                            {streamOffset !== 0 && (
                              <Button size="xs" variant="subtle" color="gray" onClick={() => setStreamOffset(0)}>Reset</Button>
                            )}
                          </Group>
                        </Group>
                        {streamMetric === 'hr' && !hasHrStreams && (
                          <Text size="xs" c="dimmed">{t('No heart rate stream data available for one or both sides.') || 'No heart rate stream data available for one or both sides.'}</Text>
                        )}
                        {streamMetric === 'power' && !hasPowerStreams && (
                          <Text size="xs" c="dimmed">{t('No power stream data available for one or both sides.') || 'No power stream data available for one or both sides.'}</Text>
                        )}
                        {streamMetric === 'cadence' && !hasCadenceStreams && (
                          <Text size="xs" c="dimmed">{t('No cadence stream data available for one or both sides.') || 'No cadence stream data available for one or both sides.'}</Text>
                        )}
                        <Box px={4}>
                          <Slider
                            size="xs"
                            min={-300}
                            max={300}
                            step={5}
                            value={streamOffset}
                            onChange={setStreamOffset}
                            label={(v) => v === 0 ? 'aligned' : `${v > 0 ? '+' : ''}${v}s`}
                            marks={[{ value: -300, label: '-5min' }, { value: 0, label: '0' }, { value: 300, label: '+5min' }]}
                            styles={{ markLabel: { fontSize: 10 } }}
                          />
                        </Box>
                        <ResponsiveContainer width="100%" height={240}>
                          <ComposedChart data={streamChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.07)'} />
                            <XAxis dataKey="t" tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} label={{ value: 'min', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} />
                            <YAxis tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} axisLine={false} width={36} />
                            <RechartTooltip
                              contentStyle={{ background: isDark ? '#0f172a' : '#fff', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, fontSize: 11 }}
                              formatter={(v: number, name: string) => [v, name]}
                              labelFormatter={(l) => `${l} min`}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            {streamMetric === 'hr' && hasHrStreams && (
                              <>
                                <Line dataKey="hrA" name="HR — A" stroke={chartColors.sideA} strokeWidth={1.5} dot={false} connectNulls />
                                <Line dataKey="hrB" name="HR — B" stroke={chartColors.sideB} strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" />
                              </>
                            )}
                            {streamMetric === 'power' && hasPowerStreams && (
                              <>
                                <Line dataKey="pwA" name="Power — A" stroke={chartColors.sideA} strokeWidth={1.5} dot={false} connectNulls />
                                <Line dataKey="pwB" name="Power — B" stroke={chartColors.sideB} strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" />
                              </>
                            )}
                            {streamMetric === 'cadence' && hasCadenceStreams && (
                              <>
                                <Line dataKey="cdA" name="Cadence — A" stroke={chartColors.sideA} strokeWidth={1.5} dot={false} connectNulls />
                                <Line dataKey="cdB" name="Cadence — B" stroke={chartColors.sideB} strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" />
                              </>
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      </Stack>
                    </Tabs.Panel>
                  )}

                  {powerCurveChartData.length > 0 && (
                    <Tabs.Panel value="curve">
                      <Stack gap="xs">
                        <Group gap={6}>
                          <Box style={{ width: 10, height: 10, borderRadius: 2, background: chartColors.sideA }} />
                          <Text size="xs" c="dimmed">Side A</Text>
                          <Box style={{ width: 10, height: 10, borderRadius: 2, background: chartColors.sideB, marginLeft: 6 }} />
                          <Text size="xs" c="dimmed">Side B</Text>
                        </Group>
                        <ResponsiveContainer width="100%" height={240}>
                          <ComposedChart data={powerCurveChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.07)'} />
                            <XAxis dataKey="window" tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} />
                            <YAxis tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} axisLine={false} width={36} label={{ value: 'W', angle: -90, position: 'insideLeft', offset: 8, fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} />
                            <RechartTooltip
                              contentStyle={{ background: isDark ? '#0f172a' : '#fff', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, fontSize: 11 }}
                              formatter={(v: number, name: string) => [`${v} W`, name]}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line dataKey="sideA" name="Side A" stroke={chartColors.sideA} strokeWidth={2} dot={{ r: 4, fill: chartColors.sideA }} connectNulls />
                            <Line dataKey="sideB" name="Side B" stroke={chartColors.sideB} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 4, fill: chartColors.sideB }} connectNulls />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </Stack>
                    </Tabs.Panel>
                  )}

                  {zoneChartData.length > 0 && (
                    <Tabs.Panel value="zones">
                      <Stack gap="xs">
                        <Group gap={6}>
                          <Box style={{ width: 10, height: 10, borderRadius: 2, background: chartColors.sideA }} />
                          <Text size="xs" c="dimmed">Side A</Text>
                          <Box style={{ width: 10, height: 10, borderRadius: 2, background: chartColors.sideB, marginLeft: 6 }} />
                          <Text size="xs" c="dimmed">Side B</Text>
                        </Group>
                        <ResponsiveContainer width="100%" height={220}>
                          <ComposedChart data={zoneChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.07)'} />
                            <XAxis dataKey="zone" tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} />
                            <YAxis tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} axisLine={false} width={36} label={{ value: 'min', angle: -90, position: 'insideLeft', offset: 8, fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} />
                            <RechartTooltip
                              contentStyle={{ background: isDark ? '#0f172a' : '#fff', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, fontSize: 11 }}
                              formatter={(v: number, name: string) => [`${v} min`, name]}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Bar dataKey="sideA" name="Side A" fill={chartColors.sideA} opacity={0.85} radius={[3, 3, 0, 0]} barSize={18} />
                            <Bar dataKey="sideB" name="Side B" fill={chartColors.sideB} opacity={0.85} radius={[3, 3, 0, 0]} barSize={18} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </Stack>
                    </Tabs.Panel>
                  )}

                  {splitChartData.length > 0 && (
                    <Tabs.Panel value="splitchart">
                      <Stack gap="xs">
                        <Group gap={6} wrap="nowrap">
                          <Box style={{ width: 10, height: 10, borderRadius: 2, background: chartColors.sideA }} />
                          <Text size="xs" c="dimmed">Side A</Text>
                          <Box style={{ width: 10, height: 10, borderRadius: 2, background: chartColors.sideB, marginLeft: 6 }} />
                          <Text size="xs" c="dimmed">Side B</Text>
                          <Text size="xs" c="dimmed" style={{ marginLeft: 8 }}>
                            {splitChartData[0]?.splitUsesPower ? '(watts per split)' : '(min/km per split — lower = faster)'}
                          </Text>
                        </Group>
                        <ResponsiveContainer width="100%" height={220}>
                          <ComposedChart data={splitChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.07)'} />
                            <XAxis dataKey="split" tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} label={{ value: 'Split #', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} />
                            <YAxis tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} axisLine={false} width={40} />
                            <RechartTooltip
                              contentStyle={{ background: isDark ? '#0f172a' : '#fff', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, fontSize: 11 }}
                              labelFormatter={(l) => `Split ${l}`}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line dataKey="valA" name={splitChartData[0]?.splitUsesPower ? 'Power A (W)' : 'Pace A (min/km)'} stroke={chartColors.sideA} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                            <Line dataKey="valB" name={splitChartData[0]?.splitUsesPower ? 'Power B (W)' : 'Pace B (min/km)'} stroke={chartColors.sideB} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} connectNulls />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </Stack>
                    </Tabs.Panel>
                  )}
                </Tabs>
              </Paper>
            )}

            {mode === 'workouts' ? (
              <>
                {leftWorkout && rightWorkout && (
                  <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
                    <WorkoutSummaryTable detail={leftWorkout} title={leftSideLabel} t={t} sideColor={chartColors.sideA} />
                    <WorkoutSummaryTable detail={rightWorkout} title={rightSideLabel} t={t} sideColor={chartColors.sideB} />
                  </SimpleGrid>
                )}

                {splitRows.length > 0 ? (
                  <Paper withBorder p="sm" radius="md">
                    <Group justify="space-between" align="flex-start" mb="sm" gap="sm" wrap="wrap">
                      <Box>
                        <Text fw={600}>{t('Split comparison') || 'Split comparison'}</Text>
                        <Text size="xs" c="dimmed">{t('Compare split-by-split pacing, power, and heart rate at a glance.') || 'Compare split-by-split pacing, power, and heart rate at a glance.'}</Text>
                      </Box>
                      <Group gap={6}>
                        <Text size="xs" fw={600} c="dimmed">{t('Visible metrics') || 'Visible metrics'}</Text>
                        <Chip size="xs" checked={effectiveSplitMetricVisibility.distance} onChange={(checked) => toggleSplitMetric('distance', checked)} variant="light">{t('Distance') || 'Distance'}</Chip>
                        <Chip size="xs" checked={effectiveSplitMetricVisibility.intensity} onChange={(checked) => toggleSplitMetric('intensity', checked)} variant="light">{t('Average power / pace') || 'Average power / pace'}</Chip>
                        <Chip size="xs" checked={effectiveSplitMetricVisibility.hr} onChange={(checked) => toggleSplitMetric('hr', checked)} variant="light">{t('HR') || 'HR'}</Chip>
                        <Chip size="xs" checked={effectiveSplitMetricVisibility.feedback} onChange={(checked) => toggleSplitMetric('feedback', checked)} variant="light">{t('Feedback') || 'Feedback'}</Chip>
                        <Chip size="xs" checked={effectiveSplitMetricVisibility.delta} onChange={(checked) => toggleSplitMetric('delta', checked)} variant="light">{t('Delta') || 'Delta'}</Chip>
                      </Group>
                    </Group>
                    <ScrollArea offsetScrollbars>
                    <Table withTableBorder withColumnBorders>
                      <Table.Thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
                        <Table.Tr>
                          <Table.Th style={{ background: isDark ? '#0f172a' : '#ffffff', minWidth: 70 }}>{t('Split') || 'Split'}</Table.Th>
                          <Table.Th style={{ background: isDark ? '#0f172a' : '#ffffff', minWidth: isMobile ? 200 : 280 }}>
                            <Group gap={4}>
                              <Box style={{ width: 8, height: 8, borderRadius: 2, background: chartColors.sideA, flexShrink: 0 }} />
                              <Text size="xs" fw={600}>{t('Side A') || 'Side A'}</Text>
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ background: isDark ? '#0f172a' : '#ffffff', minWidth: isMobile ? 200 : 280 }}>
                            <Group gap={4}>
                              <Box style={{ width: 8, height: 8, borderRadius: 2, background: chartColors.sideB, flexShrink: 0 }} />
                              <Text size="xs" fw={600}>{t('Side B') || 'Side B'}</Text>
                            </Group>
                          </Table.Th>
                          <Table.Th style={{ background: isDark ? '#0f172a' : '#ffffff', minWidth: 180 }}>{t('Delta') || 'Delta'}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {splitRows.map((row) => {
                          const leftDuration = row.left ? row.left.durationSec / 60 : null;
                          const rightDuration = row.right ? row.right.durationSec / 60 : null;
                          const usesPower = row.left?.avgPower != null || row.right?.avgPower != null;
                          const leftIntensity = row.left?.avgPower ?? (row.left?.avgSpeed ? (1000 / (row.left.avgSpeed * 60)) : null);
                          const rightIntensity = row.right?.avgPower ?? (row.right?.avgSpeed ? (1000 / (row.right.avgSpeed * 60)) : null);
                          const durationDirection = getComparisonDirection(leftDuration, rightDuration, true);
                          const intensityDirection = getComparisonDirection(leftIntensity, rightIntensity, !usesPower);
                          const rowEmphasis = durationDirection === 'better'
                            ? (isDark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.06)')
                            : durationDirection === 'worse'
                              ? (isDark ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.06)')
                              : 'transparent';
                          const deltaBg = durationDirection === 'better'
                            ? (isDark ? 'rgba(16, 185, 129, 0.14)' : 'rgba(16, 185, 129, 0.10)')
                            : durationDirection === 'worse'
                              ? (isDark ? 'rgba(239, 68, 68, 0.14)' : 'rgba(239, 68, 68, 0.10)')
                              : (isDark ? 'rgba(148, 163, 184, 0.10)' : 'rgba(148, 163, 184, 0.08)');
                          const deltaColor = durationDirection === 'better' ? '#10b981' : durationDirection === 'worse' ? '#ef4444' : (isDark ? '#cbd5e1' : '#475569');
                          return (
                            <Table.Tr key={`split-${row.split}`} style={{ background: rowEmphasis }}>
                              <Table.Td fw={700}>{row.split}</Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text size="sm" fw={600}>{row.left ? formatMinutes(leftDuration || 0) : '-'}</Text>
                                  {effectiveSplitMetricVisibility.distance && <Text size="xs" c="dimmed">{row.left ? formatDistanceKm(row.left.distanceM / 1000) : '-'}</Text>}
                                  {effectiveSplitMetricVisibility.intensity && <Text size="xs" c="dimmed">{row.left?.avgPower ? `${Math.round(row.left.avgPower)} W` : row.left?.avgSpeed ? formatPace(1000 / (row.left.avgSpeed * 60)) : '-'}</Text>}
                                  {effectiveSplitMetricVisibility.hr && <Text size="xs" c="dimmed">{row.left?.avgHr ? `${Math.round(row.left.avgHr)} bpm` : '-'}</Text>}
                                  {effectiveSplitMetricVisibility.feedback && <Text size="xs" c="dimmed">{row.left?.rpe ? `RPE ${row.left.rpe}` : '-'}{row.left?.lactate ? ` · ${row.left.lactate.toFixed(1)} mmol/L` : ''}</Text>}
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text size="sm" fw={600}>{row.right ? formatMinutes(rightDuration || 0) : '-'}</Text>
                                  {effectiveSplitMetricVisibility.distance && <Text size="xs" c="dimmed">{row.right ? formatDistanceKm(row.right.distanceM / 1000) : '-'}</Text>}
                                  {effectiveSplitMetricVisibility.intensity && <Text size="xs" c="dimmed">{row.right?.avgPower ? `${Math.round(row.right.avgPower)} W` : row.right?.avgSpeed ? formatPace(1000 / (row.right.avgSpeed * 60)) : '-'}</Text>}
                                  {effectiveSplitMetricVisibility.hr && <Text size="xs" c="dimmed">{row.right?.avgHr ? `${Math.round(row.right.avgHr)} bpm` : '-'}</Text>}
                                  {effectiveSplitMetricVisibility.feedback && <Text size="xs" c="dimmed">{row.right?.rpe ? `RPE ${row.right.rpe}` : '-'}{row.right?.lactate ? ` · ${row.right.lactate.toFixed(1)} mmol/L` : ''}</Text>}
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Stack gap={6}>
                                  <Paper p="xs" radius="sm" style={{ background: deltaBg }}>
                                    <Text size="10px" tt="uppercase" fw={700} c="dimmed">{t('Time') || 'Time'}</Text>
                                    <Text size="sm" fw={700} style={{ color: deltaColor }}>{compareValue(leftDuration, rightDuration, ' min')}</Text>
                                  </Paper>
                                  {effectiveSplitMetricVisibility.delta && (
                                    <Paper p="xs" radius="sm" style={{ background: intensityDirection === 'better' ? (isDark ? 'rgba(16, 185, 129, 0.10)' : 'rgba(16, 185, 129, 0.06)') : intensityDirection === 'worse' ? (isDark ? 'rgba(239, 68, 68, 0.10)' : 'rgba(239, 68, 68, 0.06)') : (isDark ? 'rgba(148, 163, 184, 0.10)' : 'rgba(148, 163, 184, 0.08)') }}>
                                      <Text size="10px" tt="uppercase" fw={700} c="dimmed">{usesPower ? (t('Power') || 'Power') : (t('Pace') || 'Pace')}</Text>
                                      <Text size="xs" fw={600}>{compareValue(leftIntensity, rightIntensity, usesPower ? ' W' : '')}</Text>
                                    </Paper>
                                  )}
                                </Stack>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                    </ScrollArea>
                  </Paper>
                ) : (
                  <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                    {t('No split data available for selected workouts.') || 'No split data available for selected workouts.'}
                  </Alert>
                )}
              </>
            ) : (
              <>
                <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
                  <PeriodTotalsPanel
                    title={leftSideLabel}
                    aggregate={leftPeriodAggregate}
                    sideColor={chartColors.sideA}
                    t={t}
                  />
                  <PeriodTotalsPanel
                    title={rightSideLabel}
                    aggregate={rightPeriodAggregate}
                    sideColor={chartColors.sideB}
                    t={t}
                  />
                </SimpleGrid>

                <Paper withBorder p="sm" radius="md">
                  <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
                    <Text fw={600}>{t('Form / Strain trend') || 'Form / Strain trend'}</Text>
                    <Group gap={10}>
                      <Text size="xs" c="dimmed">{t('Fatigue') || 'Fatigue'}</Text>
                      <Text size="xs" c="dimmed">{t('Fitness') || 'Fitness'}</Text>
                      <Text size="xs" c="dimmed">{t('Form') || 'Form'}</Text>
                    </Group>
                  </Group>
                  <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
                    <Paper withBorder p="xs" radius="sm">
                      <Text size="xs" fw={700} c="dimmed" mb={6}>{leftSideLabel}</Text>
                      {leftTrainingHistoryLoading ? (
                        <Skeleton height={180} radius="sm" />
                      ) : (
                        <ResponsiveContainer width="100%" height={180}>
                          <ComposedChart data={leftTrainingHistorySeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.07)'} />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} />
                            <YAxis tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} axisLine={false} width={36} />
                            <RechartTooltip contentStyle={{ background: isDark ? '#0f172a' : '#fff', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, fontSize: 11 }} />
                            <Line dataKey="fatigue" name={t('Fatigue') || 'Fatigue'} stroke="#ef4444" strokeWidth={1.8} dot={false} connectNulls />
                            <Line dataKey="fitness" name={t('Fitness') || 'Fitness'} stroke="#22c55e" strokeWidth={1.8} dot={false} connectNulls />
                            <Line dataKey="form" name={t('Form') || 'Form'} stroke="#6E4BF3" strokeWidth={1.8} dot={false} connectNulls />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </Paper>

                    <Paper withBorder p="xs" radius="sm">
                      <Text size="xs" fw={700} c="dimmed" mb={6}>{rightSideLabel}</Text>
                      {rightTrainingHistoryLoading ? (
                        <Skeleton height={180} radius="sm" />
                      ) : (
                        <ResponsiveContainer width="100%" height={180}>
                          <ComposedChart data={rightTrainingHistorySeries} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.07)'} />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} />
                            <YAxis tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} tickLine={false} axisLine={false} width={36} />
                            <RechartTooltip contentStyle={{ background: isDark ? '#0f172a' : '#fff', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, fontSize: 11 }} />
                            <Line dataKey="fatigue" name={t('Fatigue') || 'Fatigue'} stroke="#ef4444" strokeWidth={1.8} dot={false} connectNulls />
                            <Line dataKey="fitness" name={t('Fitness') || 'Fitness'} stroke="#22c55e" strokeWidth={1.8} dot={false} connectNulls />
                            <Line dataKey="form" name={t('Form') || 'Form'} stroke="#6E4BF3" strokeWidth={1.8} dot={false} connectNulls />
                          </ComposedChart>
                        </ResponsiveContainer>
                      )}
                    </Paper>
                  </SimpleGrid>
                </Paper>
              </>
            )}

            <Divider />
            <Text size="xs" c="dimmed">
              {isAthlete
                ? (t('Compare your own workouts or training periods to see how your fitness is evolving.') || 'Compare your own workouts or training periods to see how your fitness is evolving.')
                : (t('Coaches can compare the same athlete across two periods or compare two athletes side by side with the same analysis model.') || 'Coaches can compare the same athlete across two periods or compare two athletes side by side with the same analysis model.')}
            </Text>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};

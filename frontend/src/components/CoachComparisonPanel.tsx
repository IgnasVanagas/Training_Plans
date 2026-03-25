import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
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
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { IconArrowsDiff, IconCalendarStats, IconChartBar, IconChartLine, IconExternalLink, IconInfoCircle, IconAdjustmentsHorizontal } from '@tabler/icons-react';
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

type AnalysisMode = 'workouts' | 'weeks' | 'months';

type Aggregate = {
  activitiesCount: number;
  totalMinutes: number;
  totalDistanceKm: number;
  avgSessionMinutes: number;
  avgHr: number | null;
  avgPower: number | null;
  avgPaceMinPerKm: number | null;
  avgRpe: number | null;
  avgLactate: number | null;
  activeDays: number;
  densestDayMinutes: number;
  totalLoadImpact: number;
  aerobicLoad: number;
  anaerobicLoad: number;
  feedbackCoveragePct: number;
  noteCoveragePct: number;
  lactateCoveragePct: number;
  estimatedFtp: number | null;
  estimatedLt2MinPerKm: number | null;
  runningZones: Record<string, number>;
  cyclingZones: Record<string, number>;
  weekdayMinutes: Record<string, number>;
  sportMix: Record<string, number>;
  longestSession: ActivityDetail | null;
  keySessions: ActivityDetail[];
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

const weekdayKeys = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const emptyRunningZones = () => Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
const emptyCyclingZones = () => Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
const emptyWeekdayMinutes = () => Object.fromEntries(weekdayKeys.map((key) => [key, 0])) as Record<string, number>;

const formatDistanceKm = (value: number) => `${value.toFixed(1)} km`;

const formatDeltaPct = (left: number, right: number) => {
  if (!Number.isFinite(left) || left <= 0 || !Number.isFinite(right)) return '-';
  const delta = ((right - left) / left) * 100;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
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
  const durationSeconds = safeNum(detail.duration);
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
  const source = Array.isArray(detail.splits_metric) && detail.splits_metric.length > 0
    ? detail.splits_metric
    : Array.isArray(detail.laps)
      ? detail.laps
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

const buildAggregate = (details: ActivityDetail[], athleteMap: Map<number, AthleteLike>): Aggregate => {
  const aggregate: Aggregate = {
    activitiesCount: 0,
    totalMinutes: 0,
    totalDistanceKm: 0,
    avgSessionMinutes: 0,
    avgHr: null,
    avgPower: null,
    avgPaceMinPerKm: null,
    avgRpe: null,
    avgLactate: null,
    activeDays: 0,
    densestDayMinutes: 0,
    totalLoadImpact: 0,
    aerobicLoad: 0,
    anaerobicLoad: 0,
    feedbackCoveragePct: 0,
    noteCoveragePct: 0,
    lactateCoveragePct: 0,
    estimatedFtp: null,
    estimatedLt2MinPerKm: null,
    runningZones: emptyRunningZones(),
    cyclingZones: emptyCyclingZones(),
    weekdayMinutes: emptyWeekdayMinutes(),
    sportMix: {},
    longestSession: null,
    keySessions: [],
  };

  let hrWeighted = 0;
  let hrMinutes = 0;
  let powerWeighted = 0;
  let powerMinutes = 0;
  let runningMinutes = 0;
  let runningKm = 0;
  let rpeSum = 0;
  let rpeCount = 0;
  let lactateSum = 0;
  let lactateCount = 0;
  let feedbackCount = 0;
  let noteCount = 0;
  let best20mPower = 0;
  let best20mSpeed = 0;
  const dayTotals = new Map<string, number>();
  const activeDays = new Set<string>();

  const rankedSessions = details
    .slice()
    .sort((left, right) => (safeNum(right.total_load_impact) || safeNum(right.duration)) - (safeNum(left.total_load_impact) || safeNum(left.duration)));

  details.forEach((detail) => {
    const athlete = athleteMap.get(detail.athlete_id);
    const durationMinutes = safeNum(detail.duration) / 60;
    const distanceKm = safeNum(detail.distance) / 1000;
    const dayKey = detail.created_at.slice(0, 10);
    const sport = normalizeSport(detail.sport);
    const weekdayIndex = (new Date(detail.created_at).getDay() + 6) % 7;
    const weekdayKey = weekdayKeys[weekdayIndex];

    aggregate.activitiesCount += 1;
    aggregate.totalMinutes += durationMinutes;
    aggregate.totalDistanceKm += distanceKm;
    aggregate.totalLoadImpact += safeNum(detail.total_load_impact);
    aggregate.aerobicLoad += safeNum(detail.aerobic_load);
    aggregate.anaerobicLoad += safeNum(detail.anaerobic_load);
    aggregate.weekdayMinutes[weekdayKey] += durationMinutes;
    aggregate.sportMix[sport] = (aggregate.sportMix[sport] || 0) + durationMinutes;
    activeDays.add(dayKey);
    dayTotals.set(dayKey, (dayTotals.get(dayKey) || 0) + durationMinutes);

    if (!aggregate.longestSession || safeNum(detail.duration) > safeNum(aggregate.longestSession.duration)) {
      aggregate.longestSession = detail;
    }

    if (detail.average_hr && durationMinutes > 0) {
      hrWeighted += detail.average_hr * durationMinutes;
      hrMinutes += durationMinutes;
    }

    if (detail.average_watts && durationMinutes > 0) {
      powerWeighted += detail.average_watts * durationMinutes;
      powerMinutes += durationMinutes;
    }

    if (sport === 'running' && distanceKm > 0) {
      runningMinutes += durationMinutes;
      runningKm += distanceKm;
    }

    if (detail.rpe != null) {
      rpeSum += safeNum(detail.rpe);
      rpeCount += 1;
      feedbackCount += 1;
    } else if (detail.notes || detail.lactate_mmol_l != null) {
      feedbackCount += 1;
    }

    if (detail.notes && detail.notes.trim()) {
      noteCount += 1;
    }

    if (detail.lactate_mmol_l != null) {
      lactateSum += safeNum(detail.lactate_mmol_l);
      lactateCount += 1;
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

  aggregate.avgSessionMinutes = aggregate.activitiesCount > 0 ? aggregate.totalMinutes / aggregate.activitiesCount : 0;
  aggregate.avgHr = hrMinutes > 0 ? hrWeighted / hrMinutes : null;
  aggregate.avgPower = powerMinutes > 0 ? powerWeighted / powerMinutes : null;
  aggregate.avgPaceMinPerKm = runningKm > 0 ? runningMinutes / runningKm : null;
  aggregate.avgRpe = rpeCount > 0 ? rpeSum / rpeCount : null;
  aggregate.avgLactate = lactateCount > 0 ? lactateSum / lactateCount : null;
  aggregate.activeDays = activeDays.size;
  aggregate.densestDayMinutes = Array.from(dayTotals.values()).sort((left, right) => right - left)[0] || 0;
  aggregate.feedbackCoveragePct = aggregate.activitiesCount > 0 ? (feedbackCount / aggregate.activitiesCount) * 100 : 0;
  aggregate.noteCoveragePct = aggregate.activitiesCount > 0 ? (noteCount / aggregate.activitiesCount) * 100 : 0;
  aggregate.lactateCoveragePct = aggregate.activitiesCount > 0 ? (lactateCount / aggregate.activitiesCount) * 100 : 0;
  aggregate.estimatedFtp = best20mPower > 0 ? best20mPower * 0.95 : null;
  aggregate.estimatedLt2MinPerKm = best20mSpeed > 0 ? (1000 / (best20mSpeed * 60)) : null;
  aggregate.keySessions = rankedSessions.slice(0, 3);

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
  t,
}: {
  title: string;
  details: ActivityDetail[];
  aggregate: Aggregate;
  athlete?: AthleteLike;
  t: (value: string) => string;
}) => {
  const runningLeader = dominantZone(aggregate.runningZones);
  const cyclingLeader = dominantZone(aggregate.cyclingZones);
  const longestSessionName = aggregate.longestSession ? aggregate.longestSession.filename : '-';
  const longestSessionMinutes = aggregate.longestSession ? safeNum(aggregate.longestSession.duration) / 60 : 0;
  const weekdayMax = Math.max(...Object.values(aggregate.weekdayMinutes), 0);
  const sportMixTotal = Object.values(aggregate.sportMix).reduce((sum, value) => sum + value, 0);

  return (
    <Paper withBorder p="sm" radius="md">
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
            <Text size="10px" c="dimmed" tt="uppercase">{t('Active days') || 'Active days'}</Text>
            <Text fw={700}>{aggregate.activeDays}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average session') || 'Average session'}</Text>
            <Text fw={700}>{formatMinutes(aggregate.avgSessionMinutes)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Densest day') || 'Densest day'}</Text>
            <Text fw={700}>{formatMinutes(aggregate.densestDayMinutes)}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average HR') || 'Average HR'}</Text>
            <Text fw={700}>{aggregate.avgHr ? `${Math.round(aggregate.avgHr)} bpm` : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average power / pace') || 'Average power / pace'}</Text>
            <Text fw={700}>{aggregate.avgPower ? `${Math.round(aggregate.avgPower)} W` : aggregate.avgPaceMinPerKm ? formatPace(aggregate.avgPaceMinPerKm) : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average RPE') || 'Average RPE'}</Text>
            <Text fw={700}>{aggregate.avgRpe ? aggregate.avgRpe.toFixed(1) : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Average lactate') || 'Average lactate'}</Text>
            <Text fw={700}>{aggregate.avgLactate ? `${aggregate.avgLactate.toFixed(1)} mmol/L` : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Estimated FTP') || 'Estimated FTP'}</Text>
            <Text fw={700}>{aggregate.estimatedFtp ? `${Math.round(aggregate.estimatedFtp)} W` : '-'}</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Estimated LT2 Pace') || 'Estimated LT2 Pace'}</Text>
            <Text fw={700}>{aggregate.estimatedLt2MinPerKm ? formatPace(aggregate.estimatedLt2MinPerKm) : '-'}</Text>
          </Paper>
        </SimpleGrid>

        <SimpleGrid cols={3} spacing="xs">
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Feedback coverage') || 'Feedback coverage'}</Text>
            <Text fw={700}>{aggregate.feedbackCoveragePct.toFixed(0)}%</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Notes coverage') || 'Notes coverage'}</Text>
            <Text fw={700}>{aggregate.noteCoveragePct.toFixed(0)}%</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Lactate coverage') || 'Lactate coverage'}</Text>
            <Text fw={700}>{aggregate.lactateCoveragePct.toFixed(0)}%</Text>
          </Paper>
        </SimpleGrid>

        <Paper withBorder p="xs" radius="sm">
          <Text size="10px" c="dimmed" tt="uppercase">{t('Sport mix') || 'Sport mix'}</Text>
          <Stack gap={6} mt={4}>
            {Object.entries(aggregate.sportMix).length === 0 && <Text size="sm" c="dimmed">{t('No sport mix data') || 'No sport mix data'}</Text>}
            {Object.entries(aggregate.sportMix).map(([sport, minutes]) => {
              const pct = sportMixTotal > 0 ? (minutes / sportMixTotal) * 100 : 0;
              return (
                <Group key={`${title}-${sport}`} gap="xs" wrap="nowrap">
                  <Text size="xs" w={72}>{sport}</Text>
                  <Progress value={pct} size="sm" radius="xl" flex={1} />
                  <Text size="xs" c="dimmed" w={56} ta="right">{pct.toFixed(0)}%</Text>
                </Group>
              );
            })}
          </Stack>
        </Paper>

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
          <Text size="10px" c="dimmed" tt="uppercase">{t('Weekday distribution') || 'Weekday distribution'}</Text>
          <Stack gap={6} mt={4}>
            {weekdayKeys.map((key) => {
              const minutes = aggregate.weekdayMinutes[key];
              const pct = weekdayMax > 0 ? (minutes / weekdayMax) * 100 : 0;
              return (
                <Group key={`${title}-${key}`} gap="xs" wrap="nowrap">
                  <Text size="xs" w={28}>{key}</Text>
                  <Progress value={pct} size="sm" radius="xl" flex={1} />
                  <Text size="xs" c="dimmed" w={56} ta="right">{formatMinutes(minutes)}</Text>
                </Group>
              );
            })}
          </Stack>
        </Paper>

        <Paper withBorder p="xs" radius="sm">
          <Text size="10px" c="dimmed" tt="uppercase">{t('Longest session') || 'Longest session'}</Text>
          <Text fw={600}>{longestSessionName}</Text>
          <Text size="sm" c="dimmed">{longestSessionMinutes > 0 ? `${formatMinutes(longestSessionMinutes)} · ${formatDistanceKm(safeNum(aggregate.longestSession?.distance) / 1000)}` : '-'}</Text>
        </Paper>

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
                  <Table.Td>{formatMinutes(safeNum(session.duration) / 60)}</Table.Td>
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
  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, ActivityListItem[]>();
    activities.forEach((a) => {
      const key = a.created_at.slice(0, 10);
      const list = map.get(key) || [];
      list.push(a);
      map.set(key, list);
    });
    return map;
  }, [activities]);

  const selectedDate = useMemo(() => {
    if (!selectedId) return null;
    const act = activities.find((a) => String(a.id) === selectedId);
    return act ? act.created_at.slice(0, 10) : null;
  }, [selectedId, activities]);

  const [focusDate, setFocusDate] = useState<string | null>(selectedDate);

  const activitiesForFocusDate = useMemo(
    () => (focusDate ? activitiesByDate.get(focusDate) || [] : []),
    [focusDate, activitiesByDate],
  );

  const handleDateClick = useCallback((date: Date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    setFocusDate(key);
    const dayActivities = activitiesByDate.get(key) || [];
    if (dayActivities.length === 1) {
      onSelect(String(dayActivities[0].id));
    }
  }, [activitiesByDate, onSelect]);

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
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  const navigate = useNavigate();
  const [mode, setMode] = useState<AnalysisMode>('workouts');
  const [leftWorkoutId, setLeftWorkoutId] = useState<string | null>(null);
  const [rightWorkoutId, setRightWorkoutId] = useState<string | null>(null);
  const [leftAthleteId, setLeftAthleteId] = useState<string | null>(null);
  const [rightAthleteId, setRightAthleteId] = useState<string | null>(null);
  const [leftPeriodKey, setLeftPeriodKey] = useState<string | null>(null);
  const [rightPeriodKey, setRightPeriodKey] = useState<string | null>(null);
  const [streamOffset, setStreamOffset] = useState(0);
  const [streamMetric, setStreamMetric] = useState<'hr' | 'power'>('hr');

  const allAthletes = useMemo(() => {
    const existing = new Map<number, AthleteLike>();
    athletes.forEach((athlete) => existing.set(athlete.id, athlete));
    if (!existing.has(me.id)) existing.set(me.id, me);
    return Array.from(existing.values());
  }, [athletes, me]);

  const athleteMap = useMemo(() => new Map(allAthletes.map((athlete) => [athlete.id, athlete])), [allAthletes]);

  const { data: activities = [] } = useQuery({
    queryKey: ['coach-comparison-activities-v2'],
    queryFn: async () => {
      const res = await api.get<ActivityListItem[]>('/activities/');
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
    if (!options.length) {
      setLeftPeriodKey(null);
      return;
    }
    if (!leftPeriodKey || !options.some((option) => option.value === leftPeriodKey)) {
      setLeftPeriodKey(options[0].value);
    }
  }, [mode, leftAthleteId, leftPeriodKey, activePeriodOptions]);

  useEffect(() => {
    if (mode === 'workouts' || !rightAthleteId) return;
    const options = activePeriodOptions.get(rightAthleteId) || [];
    if (!options.length) {
      setRightPeriodKey(null);
      return;
    }
    if (!rightPeriodKey || !options.some((option) => option.value === rightPeriodKey)) {
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
    queryKey: ['coach-comparison-details-v2', [...idsToLoad].sort((a, b) => a - b).join(',')],
    queryFn: async () => {
      const rows = await Promise.all(idsToLoad.map(async (id) => {
        const res = await api.get<ActivityDetail>(`/activities/${id}`);
        return [id, res.data] as const;
      }));
      return new Map<number, ActivityDetail>(rows);
    },
    enabled: idsToLoad.length > 0,
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
    const maxRows = Math.min(12, Math.max(leftSplits.length, rightSplits.length));
    return Array.from({ length: maxRows }, (_, index) => ({
      split: index + 1,
      left: leftSplits[index] || null,
      right: rightSplits[index] || null,
    }));
  }, [leftSplits, rightSplits]);

  const chartColors = { sideA: '#E95A12', sideB: '#6E4BF3' };

  const streamChartData = useMemo(() => {
    if (mode !== 'workouts') return [];
    const ls = leftWorkout?.streams;
    const rs = rightWorkout?.streams;
    if (!Array.isArray(ls) || !ls.length || !Array.isArray(rs) || !rs.length) return [];
    const aStart = streamOffset < 0 ? Math.abs(streamOffset) : 0;
    const bStart = streamOffset > 0 ? streamOffset : 0;
    const len = Math.max(ls.length - aStart, rs.length - bStart);
    const step = Math.max(1, Math.floor(len / 400));
    const result: { t: number; hrA: number | null; hrB: number | null; pwA: number | null; pwB: number | null }[] = [];
    for (let i = 0; i < len; i += step) {
      const lIdx = i + aStart;
      const rIdx = i + bStart;
      const lr = lIdx < ls.length ? (ls[lIdx] as any) : null;
      const rr = rIdx < rs.length ? (rs[rIdx] as any) : null;
      result.push({
        t: +(i / 60).toFixed(1),
        hrA: lr?.hr != null ? Math.round(lr.hr) : null,
        hrB: rr?.hr != null ? Math.round(rr.hr) : null,
        pwA: lr?.power != null ? Math.round(lr.power) : null,
        pwB: rr?.power != null ? Math.round(rr.power) : null,
      });
    }
    return result;
  }, [mode, leftWorkout, rightWorkout, streamOffset]);

  const hasHrStreams = streamChartData.some((d) => d.hrA != null || d.hrB != null);
  const hasPowerStreams = streamChartData.some((d) => d.pwA != null || d.pwB != null);

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
    if (mode === 'workouts') {
      if (!leftWorkout || !rightWorkout) return [];
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
    }
    const isCycling = Object.values(leftAggregate.cyclingZones).some((v) => v > 0) || Object.values(rightAggregate.cyclingZones).some((v) => v > 0);
    const lZones = isCycling ? leftAggregate.cyclingZones : leftAggregate.runningZones;
    const rZones = isCycling ? rightAggregate.cyclingZones : rightAggregate.runningZones;
    const count = isCycling ? 7 : 5;
    return Array.from({ length: count }, (_, idx) => ({
      zone: `Z${idx + 1}`,
      sideA: Math.round((lZones[`Z${idx + 1}`] || 0) / 60),
      sideB: Math.round((rZones[`Z${idx + 1}`] || 0) / 60),
    })).filter((row) => row.sideA > 0 || row.sideB > 0);
  }, [mode, leftWorkout, rightWorkout, leftAggregate, rightAggregate, athleteMap]);

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
    const leftRunningLeader = dominantZone(leftAggregate.runningZones);
    const rightRunningLeader = dominantZone(rightAggregate.runningZones);
    const leftCyclingLeader = dominantZone(leftAggregate.cyclingZones);
    const rightCyclingLeader = dominantZone(rightAggregate.cyclingZones);
    return [
      `${t('Volume change') || 'Volume change'}: ${formatDeltaPct(leftAggregate.totalMinutes, rightAggregate.totalMinutes)}`,
      `${t('Distance change') || 'Distance change'}: ${formatDeltaPct(leftAggregate.totalDistanceKm, rightAggregate.totalDistanceKm)}`,
      `${t('Feedback coverage change') || 'Feedback coverage change'}: ${compareValue(leftAggregate.feedbackCoveragePct, rightAggregate.feedbackCoveragePct, '%')}`,
      `${t('Running zone focus') || 'Running zone focus'}: ${leftRunningLeader.zone} ${leftRunningLeader.sharePct.toFixed(0)}% vs ${rightRunningLeader.zone} ${rightRunningLeader.sharePct.toFixed(0)}%`,
      `${t('Cycling zone focus') || 'Cycling zone focus'}: ${leftCyclingLeader.zone} ${leftCyclingLeader.sharePct.toFixed(0)}% vs ${rightCyclingLeader.zone} ${rightCyclingLeader.sharePct.toFixed(0)}%`,
    ];
  }, [leftAggregate, mode, rightAggregate, t]);

  const compareCards = mode === 'workouts'
    ? [
        { label: t('Duration') || 'Duration', value: compareValue(safeNum(leftWorkout?.duration) / 60, safeNum(rightWorkout?.duration) / 60, ' min') },
        { label: t('Distance') || 'Distance', value: compareValue(safeNum(leftWorkout?.distance) / 1000, safeNum(rightWorkout?.distance) / 1000, ' km') },
        { label: t('Average HR') || 'Average HR', value: compareValue(leftWorkout?.average_hr ?? null, rightWorkout?.average_hr ?? null, ' bpm') },
        { label: t('Average power / pace') || 'Average power / pace', value: compareValue(leftWorkout?.average_watts ?? null, rightWorkout?.average_watts ?? null, ' W') },
      ]
    : [
        { label: t('Sessions') || 'Sessions', value: compareValue(leftAggregate.activitiesCount, rightAggregate.activitiesCount) },
        { label: t('Total time') || 'Total time', value: compareValue(leftAggregate.totalMinutes, rightAggregate.totalMinutes, ' min') },
        { label: t('Distance') || 'Distance', value: compareValue(leftAggregate.totalDistanceKm, rightAggregate.totalDistanceKm, ' km') },
        { label: t('Feedback coverage') || 'Feedback coverage', value: compareValue(leftAggregate.feedbackCoveragePct, rightAggregate.feedbackCoveragePct, '%') },
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

  const sideSelector = (
    side: 'left' | 'right',
    athleteId: string | null,
    setAthleteId: (value: string | null) => void,
    periodKey: string | null,
    setPeriodKey: (value: string | null) => void,
  ) => {
    const title = side === 'left' ? (t('Side A') || 'Side A') : (t('Side B') || 'Side B');
    const options = athleteId ? (activePeriodOptions.get(athleteId) || []) : [];
    const periodLabel = mode === 'weeks' ? (t('Week') || 'Week') : (t('Month') || 'Month');
    return (
      <Paper withBorder p="sm" radius="md">
        <Stack gap="xs">
          <Text size="sm" fw={600}>{title}</Text>
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
    <Paper withBorder p="lg" radius="lg">
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

        {detailsLoading ? (
          <Text size="sm" c="dimmed">{t('Loading comparison data...') || 'Loading comparison data...'}</Text>
        ) : selectionMissing ? (
          <Alert icon={<IconInfoCircle size={16} />} color="yellow" variant="light">
            {t('Select both sides to compare.') || 'Select both sides to compare.'}
          </Alert>
        ) : idsToLoad.length === 0 ? (
          <Alert icon={<IconInfoCircle size={16} />} color="yellow" variant="light">
            {t('No training data exists for the current selection.') || 'No training data exists for the current selection.'}
          </Alert>
        ) : (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }} spacing="sm">
              {compareCards.map((item) => (
                <Paper key={item.label} withBorder p="sm" radius="md" style={{ borderTop: `3px solid transparent`, background: isDark ? 'rgba(22,34,58,0.5)' : undefined }}>
                  <Text size="10px" c="dimmed" tt="uppercase" fw={600} mb={4}>{item.label}</Text>
                  <Text fw={700} size="lg">{item.value}</Text>
                </Paper>
              ))}
            </SimpleGrid>

            <Paper withBorder p="sm" radius="md">
              <Group gap="xs" mb="xs">
                {mode === 'workouts' ? <IconArrowsDiff size={16} /> : <IconCalendarStats size={16} />}
                <Text fw={600}>{t('Contrast Summary') || 'Contrast Summary'}</Text>
              </Group>
              <Stack gap={6}>
                {(mode === 'workouts' ? workoutInsights : periodInsights).map((item) => (
                  <Text key={item} size="sm">{item}</Text>
                ))}
              </Stack>
            </Paper>

            {/* ── Charts Section ── */}
            {(streamChartData.length > 0 || powerCurveChartData.length > 0 || zoneChartData.length > 0) && (
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
                  </Tabs.List>

                  {streamChartData.length > 0 && (
                    <Tabs.Panel value="stream">
                      <Stack gap="sm">
                        <Group gap="sm" wrap="wrap" justify="space-between">
                          <Group gap="sm">
                            {(hasHrStreams && hasPowerStreams) && (
                              <SegmentedControl
                                size="xs"
                                value={streamMetric}
                                onChange={(v) => setStreamMetric(v as 'hr' | 'power')}
                                data={[
                                  { value: 'hr', label: 'Heart Rate' },
                                  { value: 'power', label: 'Power' },
                                ]}
                              />
                            )}
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
                            {(streamMetric === 'hr' || !hasPowerStreams) && hasHrStreams && (
                              <>
                                <Line dataKey="hrA" name="HR — A" stroke={chartColors.sideA} strokeWidth={1.5} dot={false} connectNulls />
                                <Line dataKey="hrB" name="HR — B" stroke={chartColors.sideB} strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" />
                              </>
                            )}
                            {(streamMetric === 'power' || !hasHrStreams) && hasPowerStreams && (
                              <>
                                <Line dataKey="pwA" name="Power — A" stroke={chartColors.sideA} strokeWidth={1.5} dot={false} connectNulls />
                                <Line dataKey="pwB" name="Power — B" stroke={chartColors.sideB} strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2" />
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
                            <Bar dataKey="sideA" name="Side A" fill={chartColors.sideA} opacity={0.85} radius={[3, 3, 0, 0]} barSize={14} />
                            <Bar dataKey="sideB" name="Side B" fill={chartColors.sideB} opacity={0.85} radius={[3, 3, 0, 0]} barSize={14} />
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

                {splitRows.length > 0 && (
                  <Paper withBorder p="sm" radius="md">
                    <Text fw={600} mb="sm">{t('Split comparison') || 'Split comparison'}</Text>
                    <Table withTableBorder withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t('Split') || 'Split'}</Table.Th>
                          <Table.Th>
                            <Group gap={4}>
                              <Box style={{ width: 8, height: 8, borderRadius: 2, background: chartColors.sideA, flexShrink: 0 }} />
                              <Text size="xs" fw={600}>{t('Side A') || 'Side A'}</Text>
                            </Group>
                          </Table.Th>
                          <Table.Th>
                            <Group gap={4}>
                              <Box style={{ width: 8, height: 8, borderRadius: 2, background: chartColors.sideB, flexShrink: 0 }} />
                              <Text size="xs" fw={600}>{t('Side B') || 'Side B'}</Text>
                            </Group>
                          </Table.Th>
                          <Table.Th>{t('Delta') || 'Delta'}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {splitRows.map((row) => {
                          const leftDuration = row.left ? row.left.durationSec / 60 : null;
                          const rightDuration = row.right ? row.right.durationSec / 60 : null;
                          return (
                            <Table.Tr key={`split-${row.split}`}>
                              <Table.Td>{row.split}</Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text size="sm">{row.left ? `${formatMinutes(leftDuration || 0)} · ${formatDistanceKm(row.left.distanceM / 1000)}` : '-'}</Text>
                                  <Text size="xs" c="dimmed">
                                    {row.left?.avgPower ? `${Math.round(row.left.avgPower)} W` : row.left?.avgSpeed ? formatPace(1000 / (row.left.avgSpeed * 60)) : '-'}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {row.left?.avgHr ? `${Math.round(row.left.avgHr)} bpm` : '-'}
                                    {row.left?.rpe ? ` · RPE ${row.left.rpe}` : ''}
                                    {row.left?.lactate ? ` · ${row.left.lactate.toFixed(1)} mmol/L` : ''}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text size="sm">{row.right ? `${formatMinutes(rightDuration || 0)} · ${formatDistanceKm(row.right.distanceM / 1000)}` : '-'}</Text>
                                  <Text size="xs" c="dimmed">
                                    {row.right?.avgPower ? `${Math.round(row.right.avgPower)} W` : row.right?.avgSpeed ? formatPace(1000 / (row.right.avgSpeed * 60)) : '-'}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {row.right?.avgHr ? `${Math.round(row.right.avgHr)} bpm` : '-'}
                                    {row.right?.rpe ? ` · RPE ${row.right.rpe}` : ''}
                                    {row.right?.lactate ? ` · ${row.right.lactate.toFixed(1)} mmol/L` : ''}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>{compareValue(leftDuration, rightDuration, ' min')}</Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Paper>
                )}
              </>
            ) : (
              <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="sm">
                <PeriodSummaryTable
                  title={leftSideLabel}
                  details={leftDetails}
                  aggregate={leftAggregate}
                  athlete={leftAthleteId ? athleteMap.get(Number(leftAthleteId)) : undefined}
                  t={t}
                />
                <PeriodSummaryTable
                  title={rightSideLabel}
                  details={rightDetails}
                  aggregate={rightAggregate}
                  athlete={rightAthleteId ? athleteMap.get(Number(rightAthleteId)) : undefined}
                  t={t}
                />
              </SimpleGrid>
            )}

            <Divider />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {isAthlete
                  ? (t('Compare your own workouts or training periods to see how your fitness is evolving.') || 'Compare your own workouts or training periods to see how your fitness is evolving.')
                  : (t('Coaches can compare the same athlete across two periods or compare two athletes side by side with the same analysis model.') || 'Coaches can compare the same athlete across two periods or compare two athletes side by side with the same analysis model.')}
              </Text>
              <Button
                variant="light"
                size="xs"
                rightSection={<IconExternalLink size={14} />}
                onClick={() => navigate('/dashboard/compare', { state: { mode, leftId: leftWorkoutId, rightId: rightWorkoutId } })}
              >
                {t('Open detailed view') || 'Open detailed view'}
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};

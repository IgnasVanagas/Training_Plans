import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Box, Group, MultiSelect, Paper, Progress, SegmentedControl, Select, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconChartBar, IconInfoCircle } from '@tabler/icons-react';
import api from '../api/client';
import ZoneBars from './coachComparison/ZoneBars';
import { compareValue, cyclingZoneFromPower, formatMinutes, formatName, formatPace, normalizeSport, parseMonthLabel, runningZoneFromHr, safeNum, toMonthKey } from './coachComparison/utils';

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
  distance?: number | null; // meters
  duration?: number | null; // seconds
  average_hr?: number | null;
  average_watts?: number | null;
};

type ActivityDetail = ActivityListItem & {
  streams?: any[];
  power_curve?: Record<string, number> | null;
  hr_zones?: Record<string, number> | null;
  pace_curve?: Record<string, number> | null;
};

type Aggregate = {
  activitiesCount: number;
  totalMinutes: number;
  totalDistanceKm: number;
  avgHr: number | null;
  avgPaceMinPerKm: number | null;
  estimatedFtp: number | null;
  estimatedLt2MinPerKm: number | null;
  runningZones: Record<string, number>;
  cyclingZones: Record<string, number>;
};

export const CoachComparisonPanel = ({ athletes, me }: { athletes: AthleteLike[]; me: AthleteLike }) => {
  const [mode, setMode] = useState<'sessions' | 'months'>('sessions');
  const [sessionSport, setSessionSport] = useState<'running' | 'cycling'>('cycling');

  const allAthletes = useMemo(() => {
    const existing = new Map<number, AthleteLike>();
    athletes.forEach((athlete) => existing.set(athlete.id, athlete));
    if (!existing.has(me.id)) existing.set(me.id, me);
    return Array.from(existing.values());
  }, [athletes, me]);

  const athleteMap = useMemo(() => new Map(allAthletes.map((athlete) => [athlete.id, athlete])), [allAthletes]);

  const { data: activities = [] } = useQuery({
    queryKey: ['coach-comparison-activities'],
    queryFn: async () => {
      const res = await api.get<ActivityListItem[]>('/activities/');
      return res.data;
    },
    staleTime: 1000 * 60
  });

  const monthOptions = useMemo(() => {
    const unique = Array.from(new Set(activities.map((activity) => toMonthKey(activity.created_at)))).sort((a, b) => (a < b ? 1 : -1));
    return unique.map((month) => ({ value: month, label: parseMonthLabel(month) }));
  }, [activities]);

  const [leftSessionId, setLeftSessionId] = useState<string | null>(null);
  const [rightSessionId, setRightSessionId] = useState<string | null>(null);
  const [leftMonth, setLeftMonth] = useState<string | null>(null);
  const [rightMonth, setRightMonth] = useState<string | null>(null);
  const [leftAthleteIds, setLeftAthleteIds] = useState<string[]>([]);
  const [rightAthleteIds, setRightAthleteIds] = useState<string[]>([]);

  useEffect(() => {
    const filtered = activities.filter((activity) => normalizeSport(activity.sport) === sessionSport);
    if (!filtered.length) {
      setLeftSessionId(null);
      setRightSessionId(null);
      return;
    }

    const leftIsValid = leftSessionId ? filtered.some((activity) => String(activity.id) === leftSessionId) : false;
    const rightIsValid = rightSessionId ? filtered.some((activity) => String(activity.id) === rightSessionId) : false;

    if (!leftIsValid) setLeftSessionId(String(filtered[0].id));
    if (!rightIsValid) setRightSessionId(String(filtered[1]?.id || filtered[0].id));
  }, [activities, sessionSport, leftSessionId, rightSessionId]);

  useEffect(() => {
    if (!monthOptions.length) return;
    if (!leftMonth) setLeftMonth(monthOptions[0].value);
    if (!rightMonth) setRightMonth(monthOptions[1]?.value || monthOptions[0].value);
  }, [monthOptions, leftMonth, rightMonth]);

  useEffect(() => {
    if (!allAthletes.length) return;
    if (leftAthleteIds.length === 0) setLeftAthleteIds([String(allAthletes[0].id)]);
    if (rightAthleteIds.length === 0) setRightAthleteIds([String(allAthletes[1]?.id || allAthletes[0].id)]);
  }, [allAthletes, leftAthleteIds.length, rightAthleteIds.length]);

  const sessionOptions = useMemo(() => {
    return activities
      .filter((activity) => normalizeSport(activity.sport) === sessionSport)
      .map((activity) => {
      const athlete = athleteMap.get(activity.athlete_id);
      const sport = normalizeSport(activity.sport);
      const dateLabel = new Date(activity.created_at).toLocaleDateString();
      return {
        value: String(activity.id),
        label: `${formatName(athlete)} · ${dateLabel} · ${sport}`
      };
    });
  }, [activities, athleteMap, sessionSport]);

  const athleteOptions = useMemo(() => {
    return allAthletes.map((athlete) => ({ value: String(athlete.id), label: formatName(athlete) }));
  }, [allAthletes]);

  const idsForSide = (side: 'left' | 'right') => {
    if (mode === 'sessions') {
      const id = side === 'left' ? leftSessionId : rightSessionId;
      return id ? [Number(id)] : [];
    }

    const month = side === 'left' ? leftMonth : rightMonth;
    const selectedAthletes = side === 'left' ? leftAthleteIds : rightAthleteIds;
    if (!month || selectedAthletes.length === 0) return [];
    const athleteIdSet = new Set(selectedAthletes.map(Number));
    return activities
      .filter((activity) => toMonthKey(activity.created_at) === month && athleteIdSet.has(activity.athlete_id))
      .map((activity) => activity.id);
  };

  const leftIds = useMemo(() => idsForSide('left'), [mode, leftSessionId, leftMonth, leftAthleteIds, activities]);
  const rightIds = useMemo(() => idsForSide('right'), [mode, rightSessionId, rightMonth, rightAthleteIds, activities]);

  const idsToLoad = useMemo(() => Array.from(new Set([...leftIds, ...rightIds])), [leftIds, rightIds]);

  const { data: detailsById = new Map<number, ActivityDetail>(), isLoading: detailsLoading } = useQuery({
    queryKey: ['coach-comparison-details', idsToLoad.sort((a, b) => a - b).join(',')],
    queryFn: async () => {
      const rows = await Promise.all(idsToLoad.map(async (id) => {
        const res = await api.get<ActivityDetail>(`/activities/${id}`);
        return [id, res.data] as const;
      }));
      return new Map<number, ActivityDetail>(rows);
    },
    enabled: idsToLoad.length > 0,
    staleTime: 1000 * 60
  });

  const extractZonesForDetail = (detail: ActivityDetail, athlete?: AthleteLike) => {
    const sport = normalizeSport(detail.sport);
    const durationSeconds = safeNum(detail.duration);

    const running = Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
    const cycling = Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;

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
        ? detail.streams
            .map((row) => safeNum((row as any)?.power))
            .filter((value) => value > 0)
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

  const aggregateFromIds = (activityIds: number[]): Aggregate => {
    const init: Aggregate = {
      activitiesCount: 0,
      totalMinutes: 0,
      totalDistanceKm: 0,
      avgHr: null,
      avgPaceMinPerKm: null,
      estimatedFtp: null,
      estimatedLt2MinPerKm: null,
      runningZones: Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>,
      cyclingZones: Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>
    };

    let hrWeighted = 0;
    let hrMinutes = 0;
    let runningMinutes = 0;
    let runningKm = 0;
    let best20mPower = 0;
    let best20mSpeed = 0;

    activityIds.forEach((id) => {
      const detail = detailsById.get(id);
      if (!detail) return;

      const athlete = athleteMap.get(detail.athlete_id);
      const durationMinutes = safeNum(detail.duration) / 60;
      const distanceKm = safeNum(detail.distance) / 1000;
      const sport = normalizeSport(detail.sport);

      init.activitiesCount += 1;
      init.totalMinutes += durationMinutes;
      init.totalDistanceKm += distanceKm;

      if (detail.average_hr && durationMinutes > 0) {
        hrWeighted += detail.average_hr * durationMinutes;
        hrMinutes += durationMinutes;
      }

      if (sport === 'running' && distanceKm > 0) {
        runningMinutes += durationMinutes;
        runningKm += distanceKm;
      }

      const power20 = safeNum(detail.power_curve?.['20min']);
      if (power20 > best20mPower) best20mPower = power20;

      const speed20 = safeNum(detail.pace_curve?.['20min']);
      if (speed20 > best20mSpeed) best20mSpeed = speed20;

      const zones = extractZonesForDetail(detail, athlete);
      for (let zone = 1; zone <= 5; zone += 1) {
        init.runningZones[`Z${zone}`] += zones.running[`Z${zone}`] || 0;
      }
      for (let zone = 1; zone <= 7; zone += 1) {
        init.cyclingZones[`Z${zone}`] += zones.cycling[`Z${zone}`] || 0;
      }
    });

    init.avgHr = hrMinutes > 0 ? (hrWeighted / hrMinutes) : null;
    init.avgPaceMinPerKm = runningKm > 0 ? (runningMinutes / runningKm) : null;
    init.estimatedFtp = best20mPower > 0 ? best20mPower * 0.95 : null;
    init.estimatedLt2MinPerKm = best20mSpeed > 0 ? (1000 / (best20mSpeed * 60)) : null;

    return init;
  };

  const leftAgg = useMemo(() => aggregateFromIds(leftIds), [leftIds, detailsById]);
  const rightAgg = useMemo(() => aggregateFromIds(rightIds), [rightIds, detailsById]);

  const hasRunningA = useMemo(() => Object.values(leftAgg.runningZones).some((v) => v > 0), [leftAgg.runningZones]);
  const hasCyclingA = useMemo(() => Object.values(leftAgg.cyclingZones).some((v) => v > 0), [leftAgg.cyclingZones]);
  const hasRunningB = useMemo(() => Object.values(rightAgg.runningZones).some((v) => v > 0), [rightAgg.runningZones]);
  const hasCyclingB = useMemo(() => Object.values(rightAgg.cyclingZones).some((v) => v > 0), [rightAgg.cyclingZones]);

  return (
    <Paper withBorder p="md" radius="md" shadow="sm">
      <Group justify="space-between" mb="md">
        <Group gap="xs">
          <IconChartBar size={18} />
          <Title order={4}>Comparison</Title>
        </Group>
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as 'sessions' | 'months')}
          data={[
            { value: 'sessions', label: 'Sessions' },
            { value: 'months', label: 'Months' }
          ]}
        />
      </Group>

      {mode === 'sessions' ? (
        <Stack gap="sm" mb="md">
          <SegmentedControl
            value={sessionSport}
            onChange={(value) => setSessionSport(value as 'running' | 'cycling')}
            data={[
              { value: 'running', label: 'Running only' },
              { value: 'cycling', label: 'Cycling only' }
            ]}
          />
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Select
              label="Session A"
              data={sessionOptions}
              value={leftSessionId}
              onChange={setLeftSessionId}
              searchable
            />
            <Select
              label="Session B"
              data={sessionOptions}
              value={rightSessionId}
              onChange={setRightSessionId}
              searchable
            />
          </SimpleGrid>
        </Stack>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" mb="md">
          <Stack gap="xs">
            <MultiSelect
              label="Athletes A"
              data={athleteOptions}
              value={leftAthleteIds}
              onChange={setLeftAthleteIds}
              searchable
            />
            <Select
              label="Month A"
              data={monthOptions}
              value={leftMonth}
              onChange={setLeftMonth}
            />
          </Stack>
          <Stack gap="xs">
            <MultiSelect
              label="Athletes B"
              data={athleteOptions}
              value={rightAthleteIds}
              onChange={setRightAthleteIds}
              searchable
            />
            <Select
              label="Month B"
              data={monthOptions}
              value={rightMonth}
              onChange={setRightMonth}
            />
          </Stack>
        </SimpleGrid>
      )}

      {detailsLoading ? (
        <Text size="sm" c="dimmed">Loading comparison data...</Text>
      ) : idsToLoad.length === 0 ? (
        <Alert icon={<IconInfoCircle size={16} />} color="yellow" variant="light">
          Select sessions/months to compare.
        </Alert>
      ) : (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
            <Paper withBorder p="sm" radius="sm">
              <Text size="xs" c="dimmed">A</Text>
              <Text size="sm">{leftAgg.totalDistanceKm.toFixed(1)} km · {formatMinutes(leftAgg.totalMinutes)}</Text>
              <Text size="xs" c="dimmed">HR {leftAgg.avgHr ? Math.round(leftAgg.avgHr) : '-'} · Pace {formatPace(leftAgg.avgPaceMinPerKm)}</Text>
              <Text size="xs" c="dimmed">FTP {leftAgg.estimatedFtp ? Math.round(leftAgg.estimatedFtp) : '-'} · LT2 {formatPace(leftAgg.estimatedLt2MinPerKm)}</Text>
            </Paper>
            <Paper withBorder p="sm" radius="sm">
              <Text size="xs" c="dimmed">B</Text>
              <Text size="sm">{rightAgg.totalDistanceKm.toFixed(1)} km · {formatMinutes(rightAgg.totalMinutes)}</Text>
              <Text size="xs" c="dimmed">HR {rightAgg.avgHr ? Math.round(rightAgg.avgHr) : '-'} · Pace {formatPace(rightAgg.avgPaceMinPerKm)}</Text>
              <Text size="xs" c="dimmed">FTP {rightAgg.estimatedFtp ? Math.round(rightAgg.estimatedFtp) : '-'} · LT2 {formatPace(rightAgg.estimatedLt2MinPerKm)}</Text>
            </Paper>
            <Paper withBorder p="sm" radius="sm">
              <Text size="xs" c="dimmed">Change (B - A)</Text>
              <Stack gap={4} mt={4}>
                <Badge variant="light">Distance {compareValue(leftAgg.totalDistanceKm, rightAgg.totalDistanceKm, ' km')}</Badge>
                <Badge variant="light">Time {compareValue(leftAgg.totalMinutes, rightAgg.totalMinutes, ' min')}</Badge>
                <Badge variant="light">HR {compareValue(leftAgg.avgHr, rightAgg.avgHr, ' bpm')}</Badge>
                <Badge variant="light">FTP {compareValue(leftAgg.estimatedFtp, rightAgg.estimatedFtp, ' W')}</Badge>
                <Badge variant="light">LT2 {compareValue(leftAgg.estimatedLt2MinPerKm, rightAgg.estimatedLt2MinPerKm, ' min/km')}</Badge>
              </Stack>
            </Paper>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Paper withBorder p="sm" radius="sm">
              {hasRunningA && (
                <>
                  <Text size="sm" fw={600} mb={6}>A · Running Zones</Text>
                  <ZoneBars zones={leftAgg.runningZones} zoneCount={5} />
                </>
              )}
              {hasCyclingA && (
                <>
                  <Text size="sm" fw={600} mt={hasRunningA ? 'sm' : 0} mb={6}>A · Cycling Zones</Text>
                  <ZoneBars zones={leftAgg.cyclingZones} zoneCount={7} />
                </>
              )}
              {!hasRunningA && !hasCyclingA && <Text size="sm" c="dimmed">No zone data</Text>}
            </Paper>
            <Paper withBorder p="sm" radius="sm">
              {hasRunningB && (
                <>
                  <Text size="sm" fw={600} mb={6}>B · Running Zones</Text>
                  <ZoneBars zones={rightAgg.runningZones} zoneCount={5} />
                </>
              )}
              {hasCyclingB && (
                <>
                  <Text size="sm" fw={600} mt={hasRunningB ? 'sm' : 0} mb={6}>B · Cycling Zones</Text>
                  <ZoneBars zones={rightAgg.cyclingZones} zoneCount={7} />
                </>
              )}
              {!hasRunningB && !hasCyclingB && <Text size="sm" c="dimmed">No zone data</Text>}
            </Paper>
          </SimpleGrid>
        </Stack>
      )}
    </Paper>
  );
};

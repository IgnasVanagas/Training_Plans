import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Container,
  Divider,
  Grid,
  Group,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
} from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Legend, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import {
  IconArrowLeft, IconArrowsDiff, IconCalendarStats, IconChartBar,
  IconFlame, IconInfoCircle, IconTrendingUp,
} from '@tabler/icons-react';
import api from '../api/client';
import ZoneBars from '../components/coachComparison/ZoneBars';
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
} from '../components/coachComparison/utils';
import { useI18n } from '../i18n/I18nProvider';

/* ───────────────── types ───────────────── */
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

/* ───────────────── helpers ───────────────── */
const weekdayKeys = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const emptyRunningZones = () => Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`Z${i + 1}`, 0])) as Record<string, number>;
const emptyCyclingZones = () => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`Z${i + 1}`, 0])) as Record<string, number>;
const emptyWeekdayMinutes = () => Object.fromEntries(weekdayKeys.map((k) => [k, 0])) as Record<string, number>;
const formatDistanceKm = (v: number) => `${v.toFixed(1)} km`;
const formatDeltaPct = (l: number, r: number) => {
  if (!Number.isFinite(l) || l <= 0 || !Number.isFinite(r)) return '-';
  const d = ((r - l) / l) * 100;
  return `${d > 0 ? '+' : ''}${d.toFixed(1)}%`;
};
const extractBestCurveValue = (curve: Record<string, number> | null | undefined, keys: string[]) => {
  for (const k of keys) { const v = safeNum(curve?.[k]); if (v > 0) return v; }
  return null;
};

const extractZonesForDetail = (detail: ActivityDetail, athlete?: AthleteLike) => {
  const sport = normalizeSport(detail.sport);
  const dur = safeNum(detail.duration);
  const running = emptyRunningZones();
  const cycling = emptyCyclingZones();
  if (sport === 'running') {
    if (detail.hr_zones) {
      for (let z = 1; z <= 5; z++) running[`Z${z}`] += safeNum(detail.hr_zones[`Z${z}`]);
    } else if (athlete?.profile?.max_hr && detail.average_hr) {
      running[`Z${runningZoneFromHr(detail.average_hr, athlete.profile.max_hr)}`] += dur;
    }
  }
  if (sport === 'cycling') {
    const ftp = athlete?.profile?.ftp || null;
    const pows = Array.isArray(detail.streams) ? detail.streams.map((r: any) => safeNum(r?.power)).filter((v: number) => v > 0) : [];
    if (ftp && pows.length > 0) {
      const spp = dur > 0 ? dur / pows.length : 1;
      pows.forEach((w: number) => { cycling[`Z${cyclingZoneFromPower(w, ftp)}`] += spp; });
    } else if (ftp && detail.average_watts) {
      cycling[`Z${cyclingZoneFromPower(detail.average_watts, ftp)}`] += dur;
    }
  }
  return { sport, running, cycling };
};

const extractSplits = (detail: ActivityDetail): SplitRow[] => {
  const src = Array.isArray(detail.splits_metric) && detail.splits_metric.length > 0
    ? detail.splits_metric
    : Array.isArray(detail.laps) ? detail.laps : [];
  return src.map((r: any, i: number) => ({
    split: Number(r?.split || i + 1),
    durationSec: safeNum(r?.duration || r?.elapsed_time || r?.moving_time),
    distanceM: safeNum(r?.distance),
    avgHr: safeNum(r?.avg_hr || r?.average_heartrate) || null,
    avgPower: safeNum(r?.avg_power || r?.average_watts) || null,
    avgSpeed: safeNum(r?.avg_speed || r?.average_speed) || null,
    rpe: safeNum(r?.rpe) || null,
    lactate: safeNum(r?.lactate_mmol_l) || null,
    note: typeof r?.note === 'string' && r.note.trim() ? r.note.trim() : null,
  })).filter((r) => r.durationSec > 0 || r.distanceM > 0 || r.avgHr != null || r.avgPower != null || r.avgSpeed != null);
};

const buildAggregate = (details: ActivityDetail[], athleteMap: Map<number, AthleteLike>): Aggregate => {
  const agg: Aggregate = {
    activitiesCount: 0, totalMinutes: 0, totalDistanceKm: 0, avgSessionMinutes: 0,
    avgHr: null, avgPower: null, avgPaceMinPerKm: null, avgRpe: null, avgLactate: null,
    activeDays: 0, densestDayMinutes: 0, totalLoadImpact: 0, aerobicLoad: 0, anaerobicLoad: 0,
    feedbackCoveragePct: 0, noteCoveragePct: 0, lactateCoveragePct: 0,
    estimatedFtp: null, estimatedLt2MinPerKm: null,
    runningZones: emptyRunningZones(), cyclingZones: emptyCyclingZones(),
    weekdayMinutes: emptyWeekdayMinutes(), sportMix: {},
    longestSession: null, keySessions: [],
  };
  let hrW = 0, hrM = 0, powW = 0, powM = 0, runM = 0, runKm = 0;
  let rpeS = 0, rpeC = 0, lacS = 0, lacC = 0, fbC = 0, noteC = 0, best20P = 0, best20S = 0;
  const dayTotals = new Map<string, number>();
  const activeDays = new Set<string>();
  const ranked = details.slice().sort((a, b) => (safeNum(b.total_load_impact) || safeNum(b.duration)) - (safeNum(a.total_load_impact) || safeNum(a.duration)));

  details.forEach((d) => {
    const ath = athleteMap.get(d.athlete_id);
    const dm = safeNum(d.duration) / 60;
    const dk = safeNum(d.distance) / 1000;
    const day = d.created_at.slice(0, 10);
    const sport = normalizeSport(d.sport);
    const wdi = (new Date(d.created_at).getDay() + 6) % 7;
    agg.activitiesCount++; agg.totalMinutes += dm; agg.totalDistanceKm += dk;
    agg.totalLoadImpact += safeNum(d.total_load_impact);
    agg.aerobicLoad += safeNum(d.aerobic_load); agg.anaerobicLoad += safeNum(d.anaerobic_load);
    agg.weekdayMinutes[weekdayKeys[wdi]] += dm;
    agg.sportMix[sport] = (agg.sportMix[sport] || 0) + dm;
    activeDays.add(day);
    dayTotals.set(day, (dayTotals.get(day) || 0) + dm);
    if (!agg.longestSession || safeNum(d.duration) > safeNum(agg.longestSession.duration)) agg.longestSession = d;
    if (d.average_hr && dm > 0) { hrW += d.average_hr * dm; hrM += dm; }
    if (d.average_watts && dm > 0) { powW += d.average_watts * dm; powM += dm; }
    if (sport === 'running' && dk > 0) { runM += dm; runKm += dk; }
    if (d.rpe != null) { rpeS += safeNum(d.rpe); rpeC++; fbC++; } else if (d.notes || d.lactate_mmol_l != null) fbC++;
    if (d.notes?.trim()) noteC++;
    if (d.lactate_mmol_l != null) { lacS += safeNum(d.lactate_mmol_l); lacC++; }
    const p20 = safeNum(extractBestCurveValue(d.power_curve, ['20min', '1200s', '1800s']));
    if (p20 > best20P) best20P = p20;
    const s20 = safeNum(extractBestCurveValue(d.pace_curve, ['20min', '1200s', '1800s']));
    if (s20 > best20S) best20S = s20;
    const zones = extractZonesForDetail(d, ath);
    for (let z = 1; z <= 5; z++) agg.runningZones[`Z${z}`] += zones.running[`Z${z}`] || 0;
    for (let z = 1; z <= 7; z++) agg.cyclingZones[`Z${z}`] += zones.cycling[`Z${z}`] || 0;
  });

  agg.avgSessionMinutes = agg.activitiesCount > 0 ? agg.totalMinutes / agg.activitiesCount : 0;
  agg.avgHr = hrM > 0 ? hrW / hrM : null;
  agg.avgPower = powM > 0 ? powW / powM : null;
  agg.avgPaceMinPerKm = runKm > 0 ? runM / runKm : null;
  agg.avgRpe = rpeC > 0 ? rpeS / rpeC : null;
  agg.avgLactate = lacC > 0 ? lacS / lacC : null;
  agg.activeDays = activeDays.size;
  agg.densestDayMinutes = Array.from(dayTotals.values()).sort((a, b) => b - a)[0] || 0;
  agg.feedbackCoveragePct = agg.activitiesCount > 0 ? (fbC / agg.activitiesCount) * 100 : 0;
  agg.noteCoveragePct = agg.activitiesCount > 0 ? (noteC / agg.activitiesCount) * 100 : 0;
  agg.lactateCoveragePct = agg.activitiesCount > 0 ? (lacC / agg.activitiesCount) * 100 : 0;
  agg.estimatedFtp = best20P > 0 ? best20P * 0.95 : null;
  agg.estimatedLt2MinPerKm = best20S > 0 ? (1000 / (best20S * 60)) : null;
  agg.keySessions = ranked.slice(0, 3);
  return agg;
};

const dominantZone = (zones: Record<string, number>) => {
  let w = 'Z1', s = 0;
  Object.entries(zones).forEach(([k, v]) => { if (v > s) { w = k; s = v; } });
  const tot = Object.values(zones).reduce((a, b) => a + b, 0);
  return { zone: w, sharePct: tot > 0 ? (s / tot) * 100 : 0 };
};

/* ───────────────── power curve data helpers ───────────────── */
const POWER_CURVE_WINDOWS = ['5s', '15s', '30s', '1min', '2min', '3min', '5min', '8min', '10min', '15min', '20min', '30min', '45min', '60min', '120min'];
const POWER_CURVE_LABELS: Record<string, string> = { '5s': '5s', '15s': '15s', '30s': '30s', '1min': '1m', '2min': '2m', '3min': '3m', '5min': '5m', '8min': '8m', '10min': '10m', '15min': '15m', '20min': '20m', '30min': '30m', '45min': '45m', '60min': '60m', '120min': '120m' };

const buildPowerCurveData = (leftCurve: Record<string, number> | null | undefined, rightCurve: Record<string, number> | null | undefined) => {
  return POWER_CURVE_WINDOWS.map((w) => ({
    window: POWER_CURVE_LABELS[w] || w,
    sideA: safeNum(leftCurve?.[w]),
    sideB: safeNum(rightCurve?.[w]),
  })).filter((r) => r.sideA > 0 || r.sideB > 0);
};

/* ───────────────── calendar picker (reused) ───────────────── */
const ActivityCalendarPicker = ({
  title, activities, athleteMap, selectedId, onSelect, isDark, t,
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
      const d = new Date(a.created_at.endsWith('Z') ? a.created_at : a.created_at + 'Z');
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const l = map.get(k) || [];
      l.push(a);
      map.set(k, l);
    });
    return map;
  }, [activities]);
  const selectedDate = useMemo(() => {
    if (!selectedId) return null;
    const act = activities.find((a) => String(a.id) === selectedId);
    if (!act) return null;
    const d = new Date(act.created_at.endsWith('Z') ? act.created_at : act.created_at + 'Z');
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [selectedId, activities]);
  const [focusDate, setFocusDate] = useState<string | null>(selectedDate);
  const activitiesForFocusDate = useMemo(() => (focusDate ? activitiesByDate.get(focusDate) || [] : []), [focusDate, activitiesByDate]);

  const handleDateClick = useCallback((date: Date) => {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    setFocusDate(key);
    const dayActs = activitiesByDate.get(key) || [];
    if (dayActs.length === 1) onSelect(String(dayActs[0].id));
  }, [activitiesByDate, onSelect]);

  const selectedActivity = useMemo(() => activities.find((a) => String(a.id) === selectedId), [activities, selectedId]);

  const accentColor = '#E95A12';
  const dotColor = isDark ? 'rgba(233,90,18,0.7)' : 'rgba(233,90,18,0.85)';

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="xs">
        <Text fw={600}>{title}</Text>
        <DatePicker
          value={focusDate ? new Date(focusDate + 'T00:00:00') : null}
          onChange={(d) => d && handleDateClick(d)}
          date={pickerDate}
          onDateChange={setPickerDate}
          size="sm"
          getDayProps={(date) => {
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const has = activitiesByDate.has(key);
            const isSel = selectedDate === key;
            return {
              style: { position: 'relative' as const, ...(has && !isSel ? { fontWeight: 700, color: accentColor } : {}) },
              ...(has ? { children: (<>{date.getDate()}<Box style={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', background: isSel ? '#fff' : dotColor }} /></>) } : {}),
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
          <ScrollArea.Autosize mah={200}>
            <Stack gap={4}>
              {activitiesForFocusDate.map((a) => {
                const isActive = String(a.id) === selectedId;
                return (
                  <UnstyledButton key={a.id} onClick={() => onSelect(String(a.id))} style={{
                    display: 'block', width: '100%', padding: '6px 8px', borderRadius: 6,
                    border: isActive ? `2px solid ${accentColor}` : `1px solid ${isDark ? '#333' : '#ddd'}`,
                    background: isActive ? (isDark ? 'rgba(233,90,18,0.12)' : 'rgba(233,90,18,0.06)') : 'transparent',
                  }}>
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

/* ───────────────── metric card ───────────────── */
const MetricCard = ({ label, leftVal, rightVal, suffix, lowerBetter, t }: {
  label: string; leftVal: number | null; rightVal: number | null; suffix?: string; lowerBetter?: boolean;
  t: (v: string) => string;
}) => {
  const delta = leftVal != null && rightVal != null ? rightVal - leftVal : null;
  const improved = delta != null && (lowerBetter ? delta < 0 : delta > 0);
  const col = delta == null ? 'dimmed' : improved ? 'teal' : Math.abs(delta) < 0.01 ? 'dimmed' : 'red';
  return (
    <Paper withBorder p="sm" radius="md">
      <Text size="10px" c="dimmed" tt="uppercase">{label}</Text>
      <Group gap="xs" align="baseline" wrap="nowrap">
        <Text fw={700} size="lg">{leftVal != null ? `${leftVal.toFixed(1)}` : '-'}</Text>
        <Text size="xs" c="dimmed">{t('vs') || 'vs'}</Text>
        <Text fw={700} size="lg">{rightVal != null ? `${rightVal.toFixed(1)}` : '-'}</Text>
        {suffix && <Text size="xs" c="dimmed">{suffix}</Text>}
      </Group>
      <Text size="xs" c={col} fw={600}>
        {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${suffix || ''}` : '-'}
      </Text>
    </Paper>
  );
};

/* ───────────────── main page ───────────────── */
export const ComparisonPage = () => {
  const { t } = useI18n();
  const isDark = useComputedColorScheme('light') === 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state || {}) as { mode?: AnalysisMode; leftId?: string; rightId?: string };
  const [mode, setMode] = useState<AnalysisMode>(navState.mode || 'workouts');
  const [leftWorkoutId, setLeftWorkoutId] = useState<string | null>(navState.leftId || null);
  const [rightWorkoutId, setRightWorkoutId] = useState<string | null>(navState.rightId || null);
  const [leftAthleteId, setLeftAthleteId] = useState<string | null>(null);
  const [rightAthleteId, setRightAthleteId] = useState<string | null>(null);
  const [leftPeriodKey, setLeftPeriodKey] = useState<string | null>(null);
  const [rightPeriodKey, setRightPeriodKey] = useState<string | null>(null);

  const ui = useMemo(() => {
    const bg = isDark ? '#0B1526' : '#F8F9FA';
    const card = isDark ? '#111d33' : '#FFFFFF';
    const border = isDark ? '#1a2744' : '#dee2e6';
    const accent = '#E95A12';
    return { bg, card, border, accent };
  }, [isDark]);

  /* ── data fetching ── */
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => { const r = await api.get('/users/me'); return r.data as AthleteLike & { role?: string }; },
  });

  const { data: athletesList = [] } = useQuery({
    queryKey: ['comparison-athletes'],
    queryFn: async () => {
      try { const r = await api.get<AthleteLike[]>('/users/athletes'); return r.data; }
      catch { return []; }
    },
  });

  const allAthletes = useMemo(() => {
    const map = new Map<number, AthleteLike>();
    athletesList.forEach((a) => map.set(a.id, a));
    if (me && !map.has(me.id)) map.set(me.id, me);
    return Array.from(map.values());
  }, [athletesList, me]);
  const athleteMap = useMemo(() => new Map(allAthletes.map((a) => [a.id, a])), [allAthletes]);
  const isAthlete = me?.role === 'athlete';

  const { data: activities = [] } = useQuery({
    queryKey: ['comparison-activities'],
    queryFn: async () => { const r = await api.get<ActivityListItem[]>('/activities/?limit=500'); return r.data; },
    staleTime: 1000 * 60,
  });

  /* ── selection logic ── */
  const athleteOptions = useMemo(() => allAthletes.map((a) => ({ value: String(a.id), label: formatName(a) })), [allAthletes]);

  const weekOptionsByAthlete = useMemo(() => {
    const out = new Map<string, Array<{ value: string; label: string }>>();
    allAthletes.forEach((a) => {
      const unique = Array.from(new Set(activities.filter((x) => x.athlete_id === a.id).map((x) => toWeekKey(x.created_at)))).sort((a, b) => (a < b ? 1 : -1));
      out.set(String(a.id), unique.map((v) => ({ value: v, label: parseWeekLabel(v) })));
    });
    return out;
  }, [activities, allAthletes]);

  const monthOptionsByAthlete = useMemo(() => {
    const out = new Map<string, Array<{ value: string; label: string }>>();
    allAthletes.forEach((a) => {
      const unique = Array.from(new Set(activities.filter((x) => x.athlete_id === a.id).map((x) => toMonthKey(x.created_at)))).sort((a, b) => (a < b ? 1 : -1));
      out.set(String(a.id), unique.map((v) => ({ value: v, label: parseMonthLabel(v) })));
    });
    return out;
  }, [activities, allAthletes]);

  useEffect(() => {
    if (!allAthletes.length) return;
    if (!leftAthleteId) setLeftAthleteId(String(allAthletes[0].id));
    if (!rightAthleteId) setRightAthleteId(String(allAthletes[1]?.id || allAthletes[0].id));
  }, [allAthletes, leftAthleteId, rightAthleteId]);

  const workoutOptions = useMemo(() =>
    activities.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((a) => ({ value: String(a.id), label: `${formatName(athleteMap.get(a.athlete_id))} · ${new Date(a.created_at).toLocaleDateString()} · ${normalizeSport(a.sport)} · ${a.filename}` })),
    [activities, athleteMap]);

  useEffect(() => {
    if (!workoutOptions.length) { setLeftWorkoutId(null); setRightWorkoutId(null); return; }
    if (!leftWorkoutId || !workoutOptions.some((o) => o.value === leftWorkoutId)) setLeftWorkoutId(workoutOptions[0].value);
    if (!rightWorkoutId || !workoutOptions.some((o) => o.value === rightWorkoutId)) setRightWorkoutId(workoutOptions[1]?.value || workoutOptions[0].value);
  }, [workoutOptions, leftWorkoutId, rightWorkoutId]);

  const activePeriodOptions = mode === 'weeks' ? weekOptionsByAthlete : monthOptionsByAthlete;

  useEffect(() => {
    if (mode === 'workouts' || !leftAthleteId) return;
    const opts = activePeriodOptions.get(leftAthleteId) || [];
    if (!opts.length) { setLeftPeriodKey(null); return; }
    if (!leftPeriodKey || !opts.some((o) => o.value === leftPeriodKey)) setLeftPeriodKey(opts[0].value);
  }, [mode, leftAthleteId, leftPeriodKey, activePeriodOptions]);

  useEffect(() => {
    if (mode === 'workouts' || !rightAthleteId) return;
    const opts = activePeriodOptions.get(rightAthleteId) || [];
    if (!opts.length) { setRightPeriodKey(null); return; }
    if (!rightPeriodKey || !opts.some((o) => o.value === rightPeriodKey)) setRightPeriodKey(opts[0].value);
  }, [mode, rightAthleteId, rightPeriodKey, activePeriodOptions]);

  const leftIds = useMemo(() => {
    if (mode === 'workouts') return leftWorkoutId ? [Number(leftWorkoutId)] : [];
    if (!leftAthleteId || !leftPeriodKey) return [];
    return activities.filter((a) => String(a.athlete_id) === leftAthleteId)
      .filter((a) => (mode === 'weeks' ? toWeekKey(a.created_at) : toMonthKey(a.created_at)) === leftPeriodKey)
      .map((a) => a.id);
  }, [activities, leftAthleteId, leftPeriodKey, leftWorkoutId, mode]);

  const rightIds = useMemo(() => {
    if (mode === 'workouts') return rightWorkoutId ? [Number(rightWorkoutId)] : [];
    if (!rightAthleteId || !rightPeriodKey) return [];
    return activities.filter((a) => String(a.athlete_id) === rightAthleteId)
      .filter((a) => (mode === 'weeks' ? toWeekKey(a.created_at) : toMonthKey(a.created_at)) === rightPeriodKey)
      .map((a) => a.id);
  }, [activities, mode, rightAthleteId, rightPeriodKey, rightWorkoutId]);

  const idsToLoad = useMemo(() => Array.from(new Set([...leftIds, ...rightIds])), [leftIds, rightIds]);

  const { data: detailsById = new Map<number, ActivityDetail>(), isLoading: detailsLoading } = useQuery({
    queryKey: ['comparison-details', [...idsToLoad].sort((a, b) => a - b).join(',')],
    queryFn: async () => {
      const rows = await Promise.all(idsToLoad.map(async (id) => {
        const r = await api.get<ActivityDetail>(`/activities/${id}`);
        return [id, r.data] as const;
      }));
      return new Map<number, ActivityDetail>(rows);
    },
    enabled: idsToLoad.length > 0,
    staleTime: 1000 * 60,
  });

  const leftDetails = useMemo(() => leftIds.map((id) => detailsById.get(id)).filter((d): d is ActivityDetail => !!d), [leftIds, detailsById]);
  const rightDetails = useMemo(() => rightIds.map((id) => detailsById.get(id)).filter((d): d is ActivityDetail => !!d), [rightIds, detailsById]);
  const leftAgg = useMemo(() => buildAggregate(leftDetails, athleteMap), [leftDetails, athleteMap]);
  const rightAgg = useMemo(() => buildAggregate(rightDetails, athleteMap), [rightDetails, athleteMap]);
  const leftW = leftDetails[0];
  const rightW = rightDetails[0];
  const leftSplits = useMemo(() => (leftW ? extractSplits(leftW) : []), [leftW]);
  const rightSplits = useMemo(() => (rightW ? extractSplits(rightW) : []), [rightW]);
  const allSplitRows = useMemo(() => {
    const max = Math.max(leftSplits.length, rightSplits.length);
    return Array.from({ length: max }, (_, i) => ({ split: i + 1, left: leftSplits[i] || null, right: rightSplits[i] || null }));
  }, [leftSplits, rightSplits]);

  const selectionMissing = mode === 'workouts' ? !leftWorkoutId || !rightWorkoutId : !leftAthleteId || !rightAthleteId || !leftPeriodKey || !rightPeriodKey;
  const showResults = !selectionMissing && !detailsLoading && idsToLoad.length > 0;

  const leftLabel = mode === 'workouts' ? (t('Side A') || 'Side A') : `${t('Side A') || 'Side A'} · ${leftPeriodKey ? (mode === 'weeks' ? parseWeekLabel(leftPeriodKey) : parseMonthLabel(leftPeriodKey)) : '-'}`;
  const rightLabel = mode === 'workouts' ? (t('Side B') || 'Side B') : `${t('Side B') || 'Side B'} · ${rightPeriodKey ? (mode === 'weeks' ? parseWeekLabel(rightPeriodKey) : parseMonthLabel(rightPeriodKey)) : '-'}`;

  /* ── power curve chart data ── */
  const powerCurveData = useMemo(() => {
    if (mode !== 'workouts' || !leftW || !rightW) return [];
    return buildPowerCurveData(leftW.power_curve, rightW.power_curve);
  }, [mode, leftW, rightW]);

  /* ── zone comparison chart data ── */
  const zoneChartData = useMemo(() => {
    const lz = mode === 'workouts' && leftW ? extractZonesForDetail(leftW, athleteMap.get(leftW.athlete_id)) : null;
    const rz = mode === 'workouts' && rightW ? extractZonesForDetail(rightW, athleteMap.get(rightW.athlete_id)) : null;
    const isCycling = mode === 'workouts'
      ? (lz?.sport === 'cycling' || rz?.sport === 'cycling')
      : Object.values(leftAgg.cyclingZones).some((v) => v > 0) || Object.values(rightAgg.cyclingZones).some((v) => v > 0);
    const lZones = mode === 'workouts'
      ? (isCycling ? (lz?.cycling || {}) : (lz?.running || {}))
      : (isCycling ? leftAgg.cyclingZones : leftAgg.runningZones);
    const rZones = mode === 'workouts'
      ? (isCycling ? (rz?.cycling || {}) : (rz?.running || {}))
      : (isCycling ? rightAgg.cyclingZones : rightAgg.runningZones);
    const count = isCycling ? 7 : 5;
    return Array.from({ length: count }, (_, i) => ({
      zone: `Z${i + 1}`,
      sideA: Math.round(safeNum(lZones[`Z${i + 1}`]) / 60),
      sideB: Math.round(safeNum(rZones[`Z${i + 1}`]) / 60),
    }));
  }, [mode, leftW, rightW, leftAgg, rightAgg, athleteMap]);

  /* ── weekday radar data for period mode ── */
  const weekdayRadarData = useMemo(() => {
    if (mode === 'workouts') return [];
    return weekdayKeys.map((k) => ({
      day: k,
      sideA: Math.round(leftAgg.weekdayMinutes[k]),
      sideB: Math.round(rightAgg.weekdayMinutes[k]),
    }));
  }, [mode, leftAgg, rightAgg]);

  const chartColors = { sideA: '#E95A12', sideB: '#6E4BF3' };

  /* ── period selector widget ── */
  const sideSelector = (
    side: 'left' | 'right',
    athleteId: string | null,
    setAthleteId: (v: string | null) => void,
    periodKey: string | null,
    setPeriodKey: (v: string | null) => void,
  ) => {
    const title = side === 'left' ? (t('Side A') || 'Side A') : (t('Side B') || 'Side B');
    const sideColor = side === 'left' ? chartColors.sideA : chartColors.sideB;
    const opts = athleteId ? (activePeriodOptions.get(athleteId) || []) : [];
    const periodLabel = mode === 'weeks' ? (t('Week') || 'Week') : (t('Month') || 'Month');
    return (
      <Paper withBorder p="md" radius="md" style={{ borderLeft: `4px solid ${sideColor}` }}>
        <Stack gap="xs">
          <Group gap="xs">
            <Box style={{ width: 10, height: 10, borderRadius: '50%', background: sideColor, flexShrink: 0 }} />
            <Text fw={600}>{title}</Text>
          </Group>
          {!isAthlete && <Select label={t('Athlete') || 'Athlete'} data={athleteOptions} value={athleteId} onChange={setAthleteId} searchable />}
          <Select label={periodLabel} data={opts} value={periodKey} onChange={setPeriodKey} disabled={!athleteId || opts.length === 0} />
        </Stack>
      </Paper>
    );
  };

  return (
    <Box style={{ background: ui.bg, minHeight: '100vh' }}>
      <Container size="xl" py="md">
        <Stack gap="lg">

          {/* ── header ── */}
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <Group gap="xs">
              <ActionIcon variant="subtle" size="lg" onClick={() => navigate('/dashboard')}>
                <IconArrowLeft size={20} />
              </ActionIcon>
              <Box>
                <Group gap="xs">
                  <IconChartBar size={22} color={ui.accent} />
                  <Title order={2}>{t('Training Comparison') || 'Training Comparison'}</Title>
                </Group>
                <Text size="sm" c="dimmed">
                  {t('Compare workouts, weeks, or months side by side.') || 'Compare workouts, weeks, or months side by side.'}
                </Text>
              </Box>
            </Group>
            <SegmentedControl
              value={mode}
              onChange={(v) => setMode(v as AnalysisMode)}
              data={[
                { value: 'workouts', label: t('Workouts') || 'Workouts' },
                { value: 'weeks', label: t('Weeks') || 'Weeks' },
                { value: 'months', label: t('Months') || 'Months' },
              ]}
            />
          </Group>

          {/* ── selectors ── */}
          {mode === 'workouts' ? (
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                <ActivityCalendarPicker title={t('Side A') || 'Side A'} activities={activities} athleteMap={athleteMap} selectedId={leftWorkoutId} onSelect={setLeftWorkoutId} isDark={isDark} t={t} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <ActivityCalendarPicker title={t('Side B') || 'Side B'} activities={activities} athleteMap={athleteMap} selectedId={rightWorkoutId} onSelect={setRightWorkoutId} isDark={isDark} t={t} />
              </Grid.Col>
            </Grid>
          ) : (
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 6 }}>
                {sideSelector('left', leftAthleteId, setLeftAthleteId, leftPeriodKey, setLeftPeriodKey)}
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                {sideSelector('right', rightAthleteId, setRightAthleteId, rightPeriodKey, setRightPeriodKey)}
              </Grid.Col>
            </Grid>
          )}

          {/* ── status messages ── */}
          {detailsLoading && (
            <Stack gap="sm">
              <Skeleton height={60} radius="md" />
              <Skeleton height={200} radius="md" />
            </Stack>
          )}
          {!detailsLoading && selectionMissing && (
            <Alert icon={<IconInfoCircle size={16} />} color="yellow" variant="light">
              {t('Select both sides to compare.') || 'Select both sides to compare.'}
            </Alert>
          )}
          {!detailsLoading && !selectionMissing && idsToLoad.length === 0 && (
            <Alert icon={<IconCalendarStats size={16} />} color="blue" variant="light">
              {t('No training data exists for the current selection.') || 'No training data exists for the current selection.'}
            </Alert>
          )}

          {/* ──────────── RESULTS ──────────── */}
          {showResults && (
            <Stack gap="lg">

              {/* ── delta cards ── */}
              {mode === 'workouts' && leftW && rightW && (
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
                  <MetricCard label={t('Duration') || 'Duration'} leftVal={safeNum(leftW.duration) / 60} rightVal={safeNum(rightW.duration) / 60} suffix=" min" lowerBetter t={t} />
                  <MetricCard label={t('Distance') || 'Distance'} leftVal={safeNum(leftW.distance) / 1000} rightVal={safeNum(rightW.distance) / 1000} suffix=" km" t={t} />
                  <MetricCard label={t('Avg HR') || 'Avg HR'} leftVal={leftW.average_hr ?? null} rightVal={rightW.average_hr ?? null} suffix=" bpm" lowerBetter t={t} />
                  <MetricCard label={t('Avg Power') || 'Avg Power'} leftVal={leftW.average_watts ?? null} rightVal={rightW.average_watts ?? null} suffix=" W" t={t} />
                  <MetricCard label={t('Training Load') || 'Training Load'} leftVal={safeNum(leftW.total_load_impact)} rightVal={safeNum(rightW.total_load_impact)} t={t} />
                  <MetricCard label={t('Elevation') || 'Elevation'} leftVal={leftW.total_elevation_gain ?? null} rightVal={rightW.total_elevation_gain ?? null} suffix=" m" t={t} />
                </SimpleGrid>
              )}
              {mode !== 'workouts' && (
                <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
                  <MetricCard label={t('Sessions') || 'Sessions'} leftVal={leftAgg.activitiesCount} rightVal={rightAgg.activitiesCount} t={t} />
                  <MetricCard label={t('Total time') || 'Total time'} leftVal={leftAgg.totalMinutes} rightVal={rightAgg.totalMinutes} suffix=" min" t={t} />
                  <MetricCard label={t('Distance') || 'Distance'} leftVal={leftAgg.totalDistanceKm} rightVal={rightAgg.totalDistanceKm} suffix=" km" t={t} />
                  <MetricCard label={t('Avg Power') || 'Avg Power'} leftVal={leftAgg.avgPower} rightVal={rightAgg.avgPower} suffix=" W" t={t} />
                  <MetricCard label={t('Training Load') || 'Training Load'} leftVal={leftAgg.totalLoadImpact} rightVal={rightAgg.totalLoadImpact} t={t} />
                  <MetricCard label={t('Feedback') || 'Feedback'} leftVal={leftAgg.feedbackCoveragePct} rightVal={rightAgg.feedbackCoveragePct} suffix="%" t={t} />
                </SimpleGrid>
              )}

              {/* ── contrast insights ── */}
              <Paper withBorder p="md" radius="md">
                <Group gap="xs" mb="xs">
                  <IconTrendingUp size={18} color={ui.accent} />
                  <Text fw={600} size="lg">{t('Contrast Summary') || 'Contrast Summary'}</Text>
                </Group>
                {mode === 'workouts' && leftW && rightW ? (
                  <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
                    {[
                      { lab: t('Duration change') || 'Duration change', val: formatDeltaPct(safeNum(leftW.duration), safeNum(rightW.duration)) },
                      { lab: t('Distance change') || 'Distance change', val: formatDeltaPct(safeNum(leftW.distance), safeNum(rightW.distance)) },
                      { lab: t('TL difference') || 'TL difference', val: compareValue(safeNum(leftW.total_load_impact), safeNum(rightW.total_load_impact)) },
                      { lab: t('Calories') || 'Calories', val: compareValue(safeNum(leftW.total_calories), safeNum(rightW.total_calories), ' kcal') },
                      { lab: t('Split count') || 'Split count', val: `${leftSplits.length} → ${rightSplits.length}` },
                      ...(leftW.rpe != null || rightW.rpe != null ? [{ lab: t('RPE shift') || 'RPE shift', val: compareValue(leftW.rpe ?? null, rightW.rpe ?? null) }] : []),
                    ].map((r) => (
                      <Paper key={r.lab} withBorder p="xs" radius="sm">
                        <Text size="xs" c="dimmed">{r.lab}</Text>
                        <Text fw={600}>{r.val}</Text>
                      </Paper>
                    ))}
                  </SimpleGrid>
                ) : (
                  <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
                    {[
                      { lab: t('Volume change') || 'Volume change', val: formatDeltaPct(leftAgg.totalMinutes, rightAgg.totalMinutes) },
                      { lab: t('Distance change') || 'Distance change', val: formatDeltaPct(leftAgg.totalDistanceKm, rightAgg.totalDistanceKm) },
                      { lab: t('Feedback coverage change') || 'Feedback coverage change', val: compareValue(leftAgg.feedbackCoveragePct, rightAgg.feedbackCoveragePct, '%') },
                      { lab: t('Running zone focus') || 'Running zone focus', val: (() => { const l = dominantZone(leftAgg.runningZones); const r = dominantZone(rightAgg.runningZones); return `${l.zone} ${l.sharePct.toFixed(0)}% vs ${r.zone} ${r.sharePct.toFixed(0)}%`; })() },
                      { lab: t('Cycling zone focus') || 'Cycling zone focus', val: (() => { const l = dominantZone(leftAgg.cyclingZones); const r = dominantZone(rightAgg.cyclingZones); return `${l.zone} ${l.sharePct.toFixed(0)}% vs ${r.zone} ${r.sharePct.toFixed(0)}%`; })() },
                    ].map((r) => (
                      <Paper key={r.lab} withBorder p="xs" radius="sm">
                        <Text size="xs" c="dimmed">{r.lab}</Text>
                        <Text fw={600}>{r.val}</Text>
                      </Paper>
                    ))}
                  </SimpleGrid>
                )}
              </Paper>

              {/* ── workout detail side-by-side ── */}
              {mode === 'workouts' && leftW && rightW && (
                <Grid gutter="md">
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <WorkoutDetailCard detail={leftW} label={leftLabel} athleteMap={athleteMap} isDark={isDark} t={t} navigate={navigate} />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <WorkoutDetailCard detail={rightW} label={rightLabel} athleteMap={athleteMap} isDark={isDark} t={t} navigate={navigate} />
                  </Grid.Col>
                </Grid>
              )}

              {/* ── period summaries side-by-side ── */}
              {mode !== 'workouts' && (
                <Grid gutter="md">
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <PeriodDetailCard label={leftLabel} agg={leftAgg} details={leftDetails} athlete={leftAthleteId ? athleteMap.get(Number(leftAthleteId)) : undefined} sideColor={chartColors.sideA} t={t} />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <PeriodDetailCard label={rightLabel} agg={rightAgg} details={rightDetails} athlete={rightAthleteId ? athleteMap.get(Number(rightAthleteId)) : undefined} sideColor={chartColors.sideB} t={t} />
                  </Grid.Col>
                </Grid>
              )}

              {/* ── power curve overlay (workout mode) ── */}
              {mode === 'workouts' && powerCurveData.length > 0 && (
                <Paper withBorder p="md" radius="md">
                  <Group gap="xs" mb="sm">
                    <IconFlame size={18} color={ui.accent} />
                    <Text fw={600} size="lg">{t('Power Curve Comparison') || 'Power Curve Comparison'}</Text>
                  </Group>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={powerCurveData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#2a3552' : '#e0e0e0'} />
                      <XAxis dataKey="window" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} unit=" W" />
                      <RTooltip contentStyle={{ background: isDark ? '#1a2744' : '#fff', border: `1px solid ${isDark ? '#2a3552' : '#ddd'}` }} formatter={(v: number, name: string) => [`${v} W`, name]} />
                      <Legend />
                      <Line dataKey="sideA" name={t('Side A') || 'Side A'} stroke={chartColors.sideA} strokeWidth={2} dot={{ r: 4, fill: chartColors.sideA }} connectNulls />
                      <Line dataKey="sideB" name={t('Side B') || 'Side B'} stroke={chartColors.sideB} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 4, fill: chartColors.sideB }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </Paper>
              )}

              {/* ── zone distribution comparison ── */}
              {zoneChartData.some((r) => r.sideA > 0 || r.sideB > 0) && (
                <Paper withBorder p="md" radius="md">
                  <Text fw={600} size="lg" mb="sm">{t('Zone Distribution') || 'Zone Distribution'}</Text>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={zoneChartData} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#2a3552' : '#e0e0e0'} />
                      <XAxis dataKey="zone" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 11 }} unit=" min" />
                      <RTooltip contentStyle={{ background: isDark ? '#1a2744' : '#fff', border: `1px solid ${isDark ? '#2a3552' : '#ddd'}` }} />
                      <Legend />
                      <Bar dataKey="sideA" name={t('Side A') || 'Side A'} fill={chartColors.sideA} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="sideB" name={t('Side B') || 'Side B'} fill={chartColors.sideB} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Paper>
              )}

              {/* ── weekday radar (period mode) ── */}
              {mode !== 'workouts' && weekdayRadarData.length > 0 && (
                <Paper withBorder p="md" radius="md">
                  <Text fw={600} size="lg" mb="sm">{t('Weekday Distribution') || 'Weekday Distribution'}</Text>
                  <ResponsiveContainer width="100%" height={300}>
                    <RadarChart data={weekdayRadarData}>
                      <PolarGrid stroke={isDark ? '#2a3552' : '#ddd'} />
                      <PolarAngleAxis dataKey="day" tick={{ fontSize: 12 }} />
                      <PolarRadiusAxis tick={{ fontSize: 10 }} />
                      <Radar name={t('Side A') || 'Side A'} dataKey="sideA" stroke={chartColors.sideA} fill={chartColors.sideA} fillOpacity={0.25} />
                      <Radar name={t('Side B') || 'Side B'} dataKey="sideB" stroke={chartColors.sideB} fill={chartColors.sideB} fillOpacity={0.25} />
                      <Legend />
                    </RadarChart>
                  </ResponsiveContainer>
                </Paper>
              )}

              {/* ── full split comparison (workout mode, ALL splits) ── */}
              {mode === 'workouts' && allSplitRows.length > 0 && (
                <Paper withBorder p="md" radius="md">
                  <Group gap="xs" mb="sm">
                    <IconArrowsDiff size={18} />
                    <Text fw={600} size="lg">{t('Split Comparison') || 'Split Comparison'}</Text>
                    <Badge variant="light" size="sm">{allSplitRows.length} {t('splits') || 'splits'}</Badge>
                  </Group>
                  <ScrollArea>
                    <Table withTableBorder withColumnBorders striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th w={50}>#</Table.Th>
                          <Table.Th>{t('Side A') || 'Side A'} — {t('Time') || 'Time'}</Table.Th>
                          <Table.Th>{t('Dist') || 'Dist'}</Table.Th>
                          <Table.Th>{t('Power') || 'Power'}</Table.Th>
                          <Table.Th>{t('HR') || 'HR'}</Table.Th>
                          <Table.Th>{t('Side B') || 'Side B'} — {t('Time') || 'Time'}</Table.Th>
                          <Table.Th>{t('Dist') || 'Dist'}</Table.Th>
                          <Table.Th>{t('Power') || 'Power'}</Table.Th>
                          <Table.Th>{t('HR') || 'HR'}</Table.Th>
                          <Table.Th>{t('Delta') || 'Delta'}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {allSplitRows.map((row) => {
                          const lDur = row.left ? row.left.durationSec / 60 : null;
                          const rDur = row.right ? row.right.durationSec / 60 : null;
                          return (
                            <Table.Tr key={row.split}>
                              <Table.Td fw={600}>{row.split}</Table.Td>
                              <Table.Td>{row.left ? formatMinutes(lDur || 0) : '-'}</Table.Td>
                              <Table.Td>{row.left ? formatDistanceKm(row.left.distanceM / 1000) : '-'}</Table.Td>
                              <Table.Td>{row.left?.avgPower ? `${Math.round(row.left.avgPower)} W` : row.left?.avgSpeed ? formatPace(1000 / (row.left.avgSpeed * 60)) : '-'}</Table.Td>
                              <Table.Td>{row.left?.avgHr ? `${Math.round(row.left.avgHr)} bpm` : '-'}</Table.Td>
                              <Table.Td>{row.right ? formatMinutes(rDur || 0) : '-'}</Table.Td>
                              <Table.Td>{row.right ? formatDistanceKm(row.right.distanceM / 1000) : '-'}</Table.Td>
                              <Table.Td>{row.right?.avgPower ? `${Math.round(row.right.avgPower)} W` : row.right?.avgSpeed ? formatPace(1000 / (row.right.avgSpeed * 60)) : '-'}</Table.Td>
                              <Table.Td>{row.right?.avgHr ? `${Math.round(row.right.avgHr)} bpm` : '-'}</Table.Td>
                              <Table.Td>
                                <Stack gap={0}>
                                  <Text size="xs">{compareValue(lDur, rDur, ' min')}</Text>
                                  <Text size="xs" c="dimmed">{compareValue(row.left?.avgPower ?? null, row.right?.avgPower ?? null, ' W')}</Text>
                                </Stack>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Paper>
              )}

              {/* ── period key sessions comparison ── */}
              {mode !== 'workouts' && (
                <Grid gutter="md">
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Paper withBorder p="md" radius="md">
                      <Text fw={600} mb="sm">{leftLabel} — {t('Key Sessions') || 'Key Sessions'}</Text>
                      <KeySessionsTable sessions={leftAgg.keySessions} t={t} />
                    </Paper>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Paper withBorder p="md" radius="md">
                      <Text fw={600} mb="sm">{rightLabel} — {t('Key Sessions') || 'Key Sessions'}</Text>
                      <KeySessionsTable sessions={rightAgg.keySessions} t={t} />
                    </Paper>
                  </Grid.Col>
                </Grid>
              )}

              {/* ── period sport mix comparison ── */}
              {mode !== 'workouts' && (
                <Grid gutter="md">
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <SportMixCard label={leftLabel} agg={leftAgg} t={t} />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <SportMixCard label={rightLabel} agg={rightAgg} t={t} />
                  </Grid.Col>
                </Grid>
              )}

            </Stack>
          )}

        </Stack>
      </Container>
    </Box>
  );
};

/* ───────────────── sub-components ───────────────── */

const WorkoutDetailCard = ({ detail, label, athleteMap, isDark, t, navigate }: {
  detail: ActivityDetail; label: string; athleteMap: Map<number, AthleteLike>;
  isDark: boolean; t: (v: string) => string; navigate: (to: string, opts?: any) => void;
}) => {
  const isRunning = normalizeSport(detail.sport) === 'running';
  const bestP5 = extractBestCurveValue(detail.power_curve, ['5s']);
  const bestP60 = extractBestCurveValue(detail.power_curve, ['1min', '60s']);
  const bestP300 = extractBestCurveValue(detail.power_curve, ['5min', '300s']);
  const bestP1200 = extractBestCurveValue(detail.power_curve, ['20min', '1200s']);
  const bestPace1200 = extractBestCurveValue(detail.pace_curve, ['20min', '1200s']);

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Text size="xs" c="dimmed">{label}</Text>
            <Tooltip label={t('Open activity details') || 'Open activity details'}>
              <Text fw={700} size="lg" style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/dashboard/activities/${detail.id}`, { state: { returnTo: '/dashboard/compare' } })}>
                {detail.filename}
              </Text>
            </Tooltip>
            <Text size="xs" c="dimmed">
              {formatName(athleteMap.get(detail.athlete_id))} · {new Date(detail.created_at).toLocaleString()}
            </Text>
          </Box>
          <Stack gap={4} align="flex-end">
            <Badge variant="light">{normalizeSport(detail.sport)}</Badge>
            {detail.planned_comparison?.summary?.execution_status && (
              <Badge variant="dot">{`${t('Execution') || 'Execution'} ${detail.planned_comparison.summary.execution_status}`}</Badge>
            )}
          </Stack>
        </Group>

        <SimpleGrid cols={3} spacing="xs">
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
            <Table.Tr><Table.Td>{t('Elevation Gain') || 'Elevation Gain'}</Table.Td><Table.Td>{detail.total_elevation_gain ? `${Math.round(detail.total_elevation_gain)} m` : '-'}</Table.Td></Table.Tr>
            <Table.Tr><Table.Td>{t('Calories') || 'Calories'}</Table.Td><Table.Td>{detail.total_calories ? `${Math.round(detail.total_calories)} kcal` : '-'}</Table.Td></Table.Tr>
            <Table.Tr><Table.Td>{t('Aerobic Load') || 'Aerobic Load'}</Table.Td><Table.Td>{detail.aerobic_load ? detail.aerobic_load.toFixed(1) : '-'}</Table.Td></Table.Tr>
            <Table.Tr><Table.Td>{t('Anaerobic Load') || 'Anaerobic Load'}</Table.Td><Table.Td>{detail.anaerobic_load ? detail.anaerobic_load.toFixed(1) : '-'}</Table.Td></Table.Tr>
            {!isRunning && (
              <>
                <Table.Tr><Table.Td>{t('Peak 5s Power') || 'Peak 5s Power'}</Table.Td><Table.Td>{bestP5 ? `${Math.round(bestP5)} W` : '-'}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>{t('Peak 1min Power') || 'Peak 1min Power'}</Table.Td><Table.Td>{bestP60 ? `${Math.round(bestP60)} W` : '-'}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>{t('Peak 5min Power') || 'Peak 5min Power'}</Table.Td><Table.Td>{bestP300 ? `${Math.round(bestP300)} W` : '-'}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>{t('Peak 20min Power') || 'Peak 20min Power'}</Table.Td><Table.Td>{bestP1200 ? `${Math.round(bestP1200)} W` : '-'}</Table.Td></Table.Tr>
              </>
            )}
            {isRunning && (
              <Table.Tr><Table.Td>{t('Best 20min Pace Proxy') || 'Best 20min Pace Proxy'}</Table.Td><Table.Td>{bestPace1200 ? formatPace(1000 / (bestPace1200 * 60)) : '-'}</Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>

        {detail.notes?.trim() && (
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Coach Notes') || 'Coach Notes'}</Text>
            <Text size="sm">{detail.notes}</Text>
          </Paper>
        )}
      </Stack>
    </Paper>
  );
};

const PeriodDetailCard = ({ label, agg, details, athlete, sideColor, t }: {
  label: string; agg: Aggregate; details: ActivityDetail[];
  athlete?: AthleteLike; sideColor?: string; t: (v: string) => string;
}) => {
  const runLead = dominantZone(agg.runningZones);
  const cycLead = dominantZone(agg.cyclingZones);
  const weekMax = Math.max(...Object.values(agg.weekdayMinutes), 0);

  return (
    <Paper withBorder p="md" radius="md" style={sideColor ? { borderLeft: `4px solid ${sideColor}` } : undefined}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Text size="xs" c="dimmed">{label}</Text>
            <Text fw={700}>{athlete ? formatName(athlete) : (t('Unknown athlete') || 'Unknown athlete')}</Text>
            <Text size="xs" c="dimmed">{details.length} {t('sessions loaded') || 'sessions loaded'}</Text>
          </Box>
          <Badge variant="light">{formatDistanceKm(agg.totalDistanceKm)}</Badge>
        </Group>

        <SimpleGrid cols={3} spacing="xs">
          {([
            [t('Total time') || 'Total time', formatMinutes(agg.totalMinutes)],
            [t('Active days') || 'Active days', String(agg.activeDays)],
            [t('Average session') || 'Average session', formatMinutes(agg.avgSessionMinutes)],
            [t('Densest day') || 'Densest day', formatMinutes(agg.densestDayMinutes)],
            [t('Average HR') || 'Average HR', agg.avgHr ? `${Math.round(agg.avgHr)} bpm` : '-'],
            [t('Average power / pace') || 'Average power / pace', agg.avgPower ? `${Math.round(agg.avgPower)} W` : agg.avgPaceMinPerKm ? formatPace(agg.avgPaceMinPerKm) : '-'],
            [t('Average RPE') || 'Average RPE', agg.avgRpe ? agg.avgRpe.toFixed(1) : '-'],
            [t('Average lactate') || 'Average lactate', agg.avgLactate ? `${agg.avgLactate.toFixed(1)} mmol/L` : '-'],
            [t('Estimated FTP') || 'Estimated FTP', agg.estimatedFtp ? `${Math.round(agg.estimatedFtp)} W` : '-'],
            [t('Estimated LT2 Pace') || 'Estimated LT2 Pace', agg.estimatedLt2MinPerKm ? formatPace(agg.estimatedLt2MinPerKm) : '-'],
            [t('Aerobic Load') || 'Aerobic Load', agg.aerobicLoad.toFixed(1)],
            [t('Anaerobic Load') || 'Anaerobic Load', agg.anaerobicLoad.toFixed(1)],
          ] as [string, string][]).map(([lab, val]) => (
            <Paper key={lab} withBorder p="xs" radius="sm">
              <Text size="10px" c="dimmed" tt="uppercase">{lab}</Text>
              <Text fw={700}>{val}</Text>
            </Paper>
          ))}
        </SimpleGrid>

        <SimpleGrid cols={3} spacing="xs">
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Feedback coverage') || 'Feedback coverage'}</Text>
            <Text fw={700}>{agg.feedbackCoveragePct.toFixed(0)}%</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Notes coverage') || 'Notes coverage'}</Text>
            <Text fw={700}>{agg.noteCoveragePct.toFixed(0)}%</Text>
          </Paper>
          <Paper withBorder p="xs" radius="sm">
            <Text size="10px" c="dimmed" tt="uppercase">{t('Lactate coverage') || 'Lactate coverage'}</Text>
            <Text fw={700}>{agg.lactateCoveragePct.toFixed(0)}%</Text>
          </Paper>
        </SimpleGrid>

        {(Object.values(agg.runningZones).some((v) => v > 0) || Object.values(agg.cyclingZones).some((v) => v > 0)) && (
          <SimpleGrid cols={2} spacing="xs">
            <Paper withBorder p="xs" radius="sm">
              <Group justify="space-between" mb={6}>
                <Text size="sm" fw={600}>{t('Running zones') || 'Running zones'}</Text>
                <Badge variant="light">{`${runLead.zone} ${runLead.sharePct.toFixed(0)}%`}</Badge>
              </Group>
              <ZoneBars zones={agg.runningZones} zoneCount={5} />
            </Paper>
            <Paper withBorder p="xs" radius="sm">
              <Group justify="space-between" mb={6}>
                <Text size="sm" fw={600}>{t('Cycling zones') || 'Cycling zones'}</Text>
                <Badge variant="light">{`${cycLead.zone} ${cycLead.sharePct.toFixed(0)}%`}</Badge>
              </Group>
              <ZoneBars zones={agg.cyclingZones} zoneCount={7} />
            </Paper>
          </SimpleGrid>
        )}

        <Paper withBorder p="xs" radius="sm">
          <Text size="10px" c="dimmed" tt="uppercase">{t('Weekday distribution') || 'Weekday distribution'}</Text>
          <Stack gap={6} mt={4}>
            {weekdayKeys.map((k) => {
              const min = agg.weekdayMinutes[k];
              const pct = weekMax > 0 ? (min / weekMax) * 100 : 0;
              return (
                <Group key={k} gap="xs" wrap="nowrap">
                  <Text size="xs" w={28}>{k}</Text>
                  <Progress value={pct} size="sm" radius="xl" flex={1} />
                  <Text size="xs" c="dimmed" w={56} ta="right">{formatMinutes(min)}</Text>
                </Group>
              );
            })}
          </Stack>
        </Paper>

        <Paper withBorder p="xs" radius="sm">
          <Text size="10px" c="dimmed" tt="uppercase">{t('Longest session') || 'Longest session'}</Text>
          <Text fw={600}>{agg.longestSession?.filename || '-'}</Text>
          <Text size="sm" c="dimmed">{agg.longestSession ? `${formatMinutes(safeNum(agg.longestSession.duration) / 60)} · ${formatDistanceKm(safeNum(agg.longestSession.distance) / 1000)}` : '-'}</Text>
        </Paper>
      </Stack>
    </Paper>
  );
};

const KeySessionsTable = ({ sessions, t }: { sessions: ActivityDetail[]; t: (v: string) => string }) => (
  <Table withTableBorder withColumnBorders>
    <Table.Thead>
      <Table.Tr>
        <Table.Th>{t('Session') || 'Session'}</Table.Th>
        <Table.Th>{t('Time') || 'Time'}</Table.Th>
        <Table.Th>{t('TL') || 'TL'}</Table.Th>
      </Table.Tr>
    </Table.Thead>
    <Table.Tbody>
      {sessions.length === 0 && <Table.Tr><Table.Td colSpan={3}>{t('No sessions in this selection') || 'No sessions in this selection'}</Table.Td></Table.Tr>}
      {sessions.map((s) => (
        <Table.Tr key={s.id}>
          <Table.Td><Text size="sm">{s.filename}</Text><Text size="xs" c="dimmed">{new Date(s.created_at).toLocaleDateString()}</Text></Table.Td>
          <Table.Td>{formatMinutes(safeNum(s.duration) / 60)}</Table.Td>
          <Table.Td>{safeNum(s.total_load_impact).toFixed(1)}</Table.Td>
        </Table.Tr>
      ))}
    </Table.Tbody>
  </Table>
);

const SportMixCard = ({ label, agg, t }: { label: string; agg: Aggregate; t: (v: string) => string }) => {
  const total = Object.values(agg.sportMix).reduce((a, b) => a + b, 0);
  return (
    <Paper withBorder p="md" radius="md">
      <Text fw={600} mb="sm">{label} — {t('Sport Mix') || 'Sport Mix'}</Text>
      <Stack gap={6}>
        {Object.entries(agg.sportMix).length === 0 && <Text size="sm" c="dimmed">{t('No sport mix data') || 'No sport mix data'}</Text>}
        {Object.entries(agg.sportMix).map(([sport, min]) => {
          const pct = total > 0 ? (min / total) * 100 : 0;
          return (
            <Group key={sport} gap="xs" wrap="nowrap">
              <Text size="xs" w={72}>{sport}</Text>
              <Progress value={pct} size="sm" radius="xl" flex={1} />
              <Text size="xs" c="dimmed" w={56} ta="right">{pct.toFixed(0)}%</Text>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
};

export default ComparisonPage;

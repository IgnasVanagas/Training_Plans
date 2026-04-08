import { endOfWeek, format, startOfWeek } from 'date-fns';

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

export const normalizeSport = (sport?: string | null) => {
  const s = (sport || '').toLowerCase();
  if (s.includes('run')) return 'running';
  if (s.includes('cycl') || s.includes('bike')) return 'cycling';
  return 'other';
};

const parseDateInput = (input: string) => {
  const raw = (input || '').trim();
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    return new Date(year, month, day);
  }
  return new Date(raw);
};

export const formatName = (athlete?: AthleteLike) => {
  if (!athlete) return 'Unknown athlete';
  if (athlete.profile?.first_name || athlete.profile?.last_name) {
    return `${athlete.profile?.first_name || ''} ${athlete.profile?.last_name || ''}`.trim();
  }
  return athlete.email;
};

export const toMonthKey = (isoDate: string) => {
  const dt = parseDateInput(isoDate);
  const y = dt.getFullYear();
  const m = `${dt.getMonth() + 1}`.padStart(2, '0');
  return `${y}-${m}`;
};

export const parseMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const dt = new Date(year, (month || 1) - 1, 1);
  return dt.toLocaleDateString([], { month: 'long', year: 'numeric' });
};

export const toWeekKey = (isoDate: string) => {
  const dt = parseDateInput(isoDate);
  return format(startOfWeek(dt, { weekStartsOn: 1 }), 'yyyy-MM-dd');
};

export const parseWeekLabel = (weekKey: string) => {
  const start = new Date(`${weekKey}T00:00:00`);
  const end = endOfWeek(start, { weekStartsOn: 1 });
  return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
};

export const safeNum = (value: any) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export const runningZoneFromHr = (hr: number, maxHr: number) => {
  const ratio = hr / maxHr;
  if (ratio < 0.6) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 0.8) return 3;
  if (ratio < 0.9) return 4;
  return 5;
};

export const cyclingZoneFromPower = (power: number, ftp: number) => {
  const ratio = (power / ftp) * 100;
  if (ratio <= 55) return 1;
  if (ratio <= 75) return 2;
  if (ratio <= 90) return 3;
  if (ratio <= 105) return 4;
  if (ratio <= 120) return 5;
  if (ratio <= 150) return 6;
  return 7;
};

export const formatMinutes = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
};

export const formatPace = (minPerKm: number | null) => {
  if (!minPerKm || !Number.isFinite(minPerKm) || minPerKm <= 0) return '-';
  const mins = Math.floor(minPerKm);
  const secsRaw = Math.round((minPerKm - mins) * 60);
  const carry = secsRaw === 60 ? 1 : 0;
  const secs = secsRaw === 60 ? 0 : secsRaw;
  return `${mins + carry}:${secs.toString().padStart(2, '0')}/km`;
};

export const compareValue = (left: number | null, right: number | null, suffix = '') => {
  if (left == null || right == null) return '-';
  const delta = right - left;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}${suffix}`;
};

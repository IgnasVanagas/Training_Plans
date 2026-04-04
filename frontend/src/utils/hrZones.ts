type HrSport = 'running' | 'cycling' | 'swimming';

type HrZoneRow = {
  lowPct: number;
  highPct: number;
  lowAbs: number | null;
  highAbs: number | null;
};

const HR_DEFAULT_PCTS: Record<HrSport, Array<[number, number]>> = {
  running: [[65, 84], [85, 89], [90, 94], [95, 99], [100, 106]],
  cycling: [[65, 81], [82, 89], [90, 93], [94, 99], [100, 102], [103, 106], [107, 120]],
  swimming: [[65, 84], [85, 89], [90, 94], [95, 99], [100, 106]],
};

const normalizeStoredBounds = (rawBounds: unknown): number[] => (
  Array.isArray(rawBounds)
    ? rawBounds
        .map((value: unknown) => Math.round(Number(value)))
        .filter((value: number) => Number.isFinite(value) && value > 0)
    : []
);

export const getDefaultHrZonePcts = (sport: HrSport): Array<[number, number]> => HR_DEFAULT_PCTS[sport];

export const resolveHrZoneRows = (
  profile: any,
  sport: HrSport,
  fallbackThreshold?: number | null,
): { threshold: number | null; rows: HrZoneRow[] } => {
  const defaults = HR_DEFAULT_PCTS[sport];
  const hrCfg = profile?.zone_settings?.[sport]?.hr;
  const threshold = Number(hrCfg?.lt2 ?? fallbackThreshold ?? 0);
  const safeThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : null;
  const rawBounds = normalizeStoredBounds(hrCfg?.upper_bounds);

  if (safeThreshold && rawBounds.length > 0) {
    const maxBound = Math.max(...rawBounds);
    const looksLikePercentages = maxBound <= 200 && maxBound <= safeThreshold * 0.75;
    const absoluteBounds = looksLikePercentages
      ? rawBounds.map((value) => Math.round((value * safeThreshold) / 100))
      : rawBounds;
    const percentageBounds = absoluteBounds.map((value) => Math.round((value / safeThreshold) * 100));
    const normalizedPctBounds = percentageBounds.length === defaults.length - 1
      ? [...percentageBounds, defaults[defaults.length - 1][1]]
      : percentageBounds.length === defaults.length
        ? percentageBounds
        : null;

    if (normalizedPctBounds) {
      const rows = normalizedPctBounds.map((highPct, index) => {
        const lowPct = index === 0 ? defaults[0][0] : normalizedPctBounds[index - 1];
        return {
          lowPct,
          highPct,
          lowAbs: Math.round((safeThreshold * lowPct) / 100),
          highAbs: Math.round((safeThreshold * highPct) / 100),
        };
      });
      if (rows.every((row) => row.lowPct < row.highPct)) {
        return { threshold: safeThreshold, rows };
      }
    }
  }

  return {
    threshold: safeThreshold,
    rows: defaults.map(([lowPct, highPct]) => ({
      lowPct,
      highPct,
      lowAbs: safeThreshold ? Math.round((safeThreshold * lowPct) / 100) : null,
      highAbs: safeThreshold ? Math.round((safeThreshold * highPct) / 100) : null,
    })),
  };
};

export const formatHrZoneLabel = (
  profile: any,
  sport: HrSport,
  zone: number,
  fallbackThreshold?: number | null,
): string | null => {
  const { rows } = resolveHrZoneRows(profile, sport, fallbackThreshold);
  const row = rows[zone - 1];
  if (!row) return null;

  const lowLabel = row.lowAbs != null ? `${Math.round(row.lowAbs)} bpm` : null;
  const highLabel = row.highAbs != null ? `${Math.round(row.highAbs)} bpm` : null;
  if (zone === 1) return highLabel ? `< ${highLabel}` : null;
  if (zone === rows.length) return lowLabel ? `> ${lowLabel}` : null;
  if (lowLabel && highLabel) return `${lowLabel} - ${highLabel}`;
  return highLabel ? `< ${highLabel}` : (lowLabel ? `> ${lowLabel}` : null);
};

export const getHrZoneClassifierBounds = (
  profile: any,
  sport: HrSport,
  fallbackThreshold?: number | null,
): { rows: HrZoneRow[]; upperBounds: number[] } => {
  const { rows } = resolveHrZoneRows(profile, sport, fallbackThreshold);
  return {
    rows,
    upperBounds: rows
      .slice(0, Math.max(0, rows.length - 1))
      .map((row) => row.highAbs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0),
  };
};
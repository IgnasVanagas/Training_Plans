import { formatMinutesHm } from "./dateUtils";
import { WorkoutNode, ConcreteStep } from "../../types/workout";

const formatPaceFromMinutesPerKm = (minutesPerKm: number) => {
  if (!Number.isFinite(minutesPerKm) || minutesPerKm <= 0) return "-";
  const mins = Math.floor(minutesPerKm);
  const secsRaw = Math.round((minutesPerKm - mins) * 60);
  const carry = secsRaw === 60 ? 1 : 0;
  const secs = secsRaw === 60 ? 0 : secsRaw;
  return `${mins + carry}:${secs.toString().padStart(2, "0")}/km`;
};

const resolveZoneBoundsFromSettings = (profile: any, sport: "running" | "cycling", metric: "hr" | "pace" | "power", zone: number) => {
  const upperBounds = Array.isArray(profile?.zone_settings?.[sport]?.[metric]?.upper_bounds)
    ? profile.zone_settings[sport][metric].upper_bounds
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isFinite(value) && value > 0)
    : [];
  if (!upperBounds.length || zone < 1) return null;
  const index = zone - 1;
  const low = index > 0 ? upperBounds[index - 1] : null;
  const high = upperBounds[index] ?? null;
  if (low == null && high == null) return null;
  return { low, high };
};

const formatZoneRange = (
  bounds: { low: number | null; high: number | null },
  formatter: (value: number) => string,
) => {
  const lowLabel = bounds.low != null ? formatter(bounds.low) : null;
  const highLabel = bounds.high != null ? formatter(bounds.high) : null;
  if (lowLabel && highLabel) return `${lowLabel}-${highLabel}`;
  if (highLabel) return `< ${highLabel}`;
  return lowLabel ? `> ${lowLabel}` : "";
};

export const buildQuickWorkoutZoneDetails = (sportType: string, zone: number, profile: any) => {
  const normalizedSport = (sportType || "").toLowerCase();

  if (normalizedSport.includes("run")) {
    const paceBounds = resolveZoneBoundsFromSettings(profile, "running", "pace", zone);
    if (paceBounds) {
      return `Pace ${formatZoneRange(paceBounds, (value) => formatPaceFromMinutesPerKm(value))}`;
    }
    const hrBounds = resolveZoneBoundsFromSettings(profile, "running", "hr", zone);
    if (hrBounds) {
      return `HR ${formatZoneRange(hrBounds, (value) => `${Math.round(value)} bpm`)}`;
    }

    const lt2 = Number(profile?.lt2 || 0);
    if (lt2 > 0) {
      const paceRanges: Array<[number, number]> = [
        [135, 120],
        [120, 110],
        [110, 103],
        [103, 97],
        [97, 90],
        [90, 84],
        [84, 75],
      ];
      const idx = Math.max(1, Math.min(paceRanges.length, zone)) - 1;
      const [slowPct, fastPct] = paceRanges[idx];
      const slow = formatPaceFromMinutesPerKm((lt2 * slowPct) / 100);
      const fast = formatPaceFromMinutesPerKm((lt2 * fastPct) / 100);
      return `Pace ${slow}-${fast}`;
    }

    const maxHr = Number(profile?.max_hr || 0);
    if (maxHr > 0) {
      const hrRanges: Array<[number, number]> = [
        [50, 60],
        [60, 70],
        [70, 80],
        [80, 90],
        [90, 95],
        [95, 100],
      ];
      const idx = Math.max(1, Math.min(hrRanges.length, zone)) - 1;
      const [low, high] = hrRanges[idx];
      return `HR ${Math.round((maxHr * low) / 100)}-${Math.round((maxHr * high) / 100)} bpm`;
    }

    return "";
  }

  const powerBounds = resolveZoneBoundsFromSettings(profile, "cycling", "power", zone);
  if (powerBounds) {
    return `Power ${formatZoneRange(powerBounds, (value) => `${Math.round(value)} W`)}`;
  }
  const cyclingHrBounds = resolveZoneBoundsFromSettings(profile, "cycling", "hr", zone);
  if (cyclingHrBounds) {
    return `HR ${formatZoneRange(cyclingHrBounds, (value) => `${Math.round(value)} bpm`)}`;
  }

  const ftp = Number(profile?.ftp || 0);
  if (ftp > 0) {
    const powerRanges: Array<[number, number]> = [
      [50, 55],
      [56, 75],
      [76, 90],
      [91, 105],
      [106, 120],
      [121, 150],
      [151, 200],
    ];
    const idx = Math.max(1, Math.min(powerRanges.length, zone)) - 1;
    const [low, high] = powerRanges[idx];
    return `Power ${Math.round((ftp * low) / 100)}-${Math.round((ftp * high) / 100)} W`;
  }

  return "";
};

const quickWorkoutZoneBounds = (sportType: string, zone: number) => {
  const normalizedSport = (sportType || "").toLowerCase();
  if (normalizedSport.includes("run")) {
    const hrRanges: Array<[number, number]> = [
      [50, 60],
      [60, 70],
      [70, 80],
      [80, 90],
      [90, 100],
    ];
    const idx = Math.max(1, Math.min(hrRanges.length, zone)) - 1;
    const [min, max] = hrRanges[idx];
    return { min, max, targetType: "heart_rate_zone" as const };
  }

  const powerRanges: Array<[number, number]> = [
    [50, 55],
    [56, 75],
    [76, 90],
    [91, 105],
    [106, 120],
    [121, 150],
    [151, 200],
  ];
  const idx = Math.max(1, Math.min(powerRanges.length, zone)) - 1;
  const [min, max] = powerRanges[idx];
  return { min, max, targetType: "power" as const };
};

const quickWorkoutStep = (
  category: "warmup" | "work" | "cooldown",
  durationType: "time" | "distance",
  durationValue: number,
  sportType: string,
  zone: number,
): ConcreteStep => {
  const boundedZone = Math.max(1, zone);
  const zoneBounds = quickWorkoutZoneBounds(sportType, boundedZone);
  return {
    id: Math.random().toString(36).slice(2, 11),
    type: "block",
    category,
    duration: {
      type: durationType,
      value: durationValue,
    },
    target: {
      type: zoneBounds.targetType,
      zone: boundedZone,
      min: zoneBounds.min,
      max: zoneBounds.max,
      unit: "%",
    },
  };
};

export const buildQuickWorkoutStructure = (
  mode: "time" | "distance",
  sportType: string,
  zone: number,
  minutes: number,
  distanceKm: number,
): WorkoutNode[] => {
  const boundedZone = Math.max(1, zone);
  if (mode === "time") {
    const totalSeconds = Math.max(300, Math.round(minutes * 60));
    return [quickWorkoutStep("work", "time", totalSeconds, sportType, boundedZone)];
  }

  const totalMeters = Math.max(1000, Math.round(distanceKm * 1000));
  return [quickWorkoutStep("work", "distance", totalMeters, sportType, boundedZone)];
};

export const buildQuickWorkoutDescription = (
  mode: "time" | "distance",
  minutes: number,
  distanceKm: number,
  zone: number,
  targetDetails: string,
) => {
  if (mode === "time") {
    return `Quick workout: ${formatMinutesHm(minutes)} in zone ${zone}${targetDetails ? ` (${targetDetails})` : ""}`;
  }
  return `Quick workout: ${distanceKm} km in zone ${zone}${targetDetails ? ` (${targetDetails})` : ""}`;
};

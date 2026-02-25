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

export const buildQuickWorkoutZoneDetails = (sportType: string, zone: number, profile: any) => {
  const normalizedSport = (sportType || "").toLowerCase();

  if (normalizedSport.includes("run")) {
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
  if (mode === "time") {
    const totalSeconds = Math.max(300, Math.round(minutes * 60));
    const warmupSeconds = Math.min(900, Math.max(300, Math.round(totalSeconds * 0.2)));
    const cooldownSeconds = Math.min(600, Math.max(300, Math.round(totalSeconds * 0.15)));
    const mainSeconds = Math.max(300, totalSeconds - warmupSeconds - cooldownSeconds);

    return [
      quickWorkoutStep("warmup", "time", warmupSeconds, sportType, Math.max(1, zone - 1)),
      quickWorkoutStep("work", "time", mainSeconds, sportType, zone),
      quickWorkoutStep("cooldown", "time", cooldownSeconds, sportType, Math.max(1, zone - 1)),
    ];
  }

  const totalMeters = Math.max(1000, Math.round(distanceKm * 1000));
  const warmupMeters = Math.min(3000, Math.max(1000, Math.round(totalMeters * 0.2)));
  const cooldownMeters = Math.min(2000, Math.max(500, Math.round(totalMeters * 0.15)));
  const mainMeters = Math.max(1000, totalMeters - warmupMeters - cooldownMeters);

  return [
    quickWorkoutStep("warmup", "distance", warmupMeters, sportType, Math.max(1, zone - 1)),
    quickWorkoutStep("work", "distance", mainMeters, sportType, zone),
    quickWorkoutStep("cooldown", "distance", cooldownMeters, sportType, Math.max(1, zone - 1)),
  ];
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

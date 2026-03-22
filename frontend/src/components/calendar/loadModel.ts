export type ZoneAggregate = {
  running: {
    activityCount: number;
    zoneSecondsByMetric: {
      hr: Record<string, number>;
      pace: Record<string, number>;
    };
  };
  cycling: {
    activityCount: number;
    zoneSecondsByMetric: {
      hr: Record<string, number>;
      power: Record<string, number>;
    };
  };
};

const safeNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getZoneSeconds = (source: any, zone: number): number => {
  if (!source) return 0;
  if (Array.isArray(source)) {
    const parsed = Number(source[zone - 1]);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const candidate = source[`Z${zone}`]
    ?? source[`z${zone}`]
    ?? source[String(zone)]
    ?? source[zone];
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : 0;
};

const runningZoneIndex = (hr: number, maxHr: number): number => {
  const ratio = hr / maxHr;
  if (ratio < 0.6) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 0.8) return 3;
  if (ratio < 0.9) return 4;
  return 5;
};

const runningPaceZoneIndex = (paceMinPerKm: number, lt2: number): number | null => {
  if (!lt2 || lt2 <= 0) return null;
  const bounds = [lt2 * 0.84, lt2 * 0.9, lt2 * 0.97, lt2 * 1.03, lt2 * 1.1, lt2 * 1.2];
  for (let idx = bounds.length - 1; idx >= 0; idx -= 1) {
    if (paceMinPerKm >= bounds[idx]) {
      return bounds.length - idx;
    }
  }
  return 7;
};

const cyclingZoneIndex = (watts: number, ftp: number): number => {
  const ratio = (watts / ftp) * 100;
  if (ratio <= 55) return 1;
  if (ratio <= 75) return 2;
  if (ratio <= 90) return 3;
  if (ratio <= 105) return 4;
  if (ratio <= 120) return 5;
  if (ratio <= 150) return 6;
  return 7;
};

export const normalizeSport = (sport: string | undefined | null): 'running' | 'cycling' | 'other' => {
  const lowered = (sport || '').toLowerCase();
  if (lowered.includes('run')) return 'running';
  if (lowered.includes('cycl') || lowered.includes('bike') || lowered.includes('ride')) return 'cycling';
  return 'other';
};

export const zoneCountForSport = (sport: string | undefined | null): number => {
  const normalized = normalizeSport(sport);
  if (normalized === 'running') return 5;
  if (normalized === 'cycling') return 7;
  return 0;
};

export const hasAnyZoneSeconds = (zoneSeconds: Record<string, number>): boolean =>
  Object.values(zoneSeconds).some((value) => value > 0);

export const deriveZonesFromActivityDetail = (detail: any, profile?: any) => {
  const sportName = (detail?.sport || '').toLowerCase();
  const sport = sportName.includes('run')
    ? 'running'
    : (sportName.includes('cycl') || sportName.includes('bike') || sportName.includes('ride'))
      ? 'cycling'
      : 'other';

  const runningHrZones = Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
  const runningPaceZones = Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
  const cyclingHrZones = Object.fromEntries(Array.from({ length: 5 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
  const cyclingPowerZones = Object.fromEntries(Array.from({ length: 7 }, (_, idx) => [`Z${idx + 1}`, 0])) as Record<string, number>;
  const durationSeconds = safeNumber(detail?.duration, 0);

  const streamsRaw = detail?.streams;
  const streamPoints = Array.isArray(streamsRaw)
    ? streamsRaw
    : (Array.isArray(streamsRaw?.data) ? streamsRaw.data : []);
  const laps = Array.isArray(detail?.laps)
    ? detail.laps
    : (Array.isArray(streamsRaw?.laps) ? streamsRaw.laps : []);

  if (sport === 'running') {
    const maxHr = safeNumber(profile?.max_hr, 190);
    const hrSamples = streamPoints
      .map((point: any) => safeNumber(point?.heart_rate, -1))
      .filter((value: number) => value > 0);

    if (hrSamples.length > 0 && maxHr > 0 && durationSeconds > 0) {
      const secondsPerSample = durationSeconds / hrSamples.length;
      hrSamples.forEach((hr: number) => {
        const zone = runningZoneIndex(hr, maxHr);
        runningHrZones[`Z${zone}`] += secondsPerSample;
      });
    } else if (detail?.hr_zones && typeof detail.hr_zones === 'object') {
      for (let zone = 1; zone <= 5; zone += 1) {
        runningHrZones[`Z${zone}`] += safeNumber(detail.hr_zones[`Z${zone}`], 0);
      }
    }

    const lt2 = safeNumber(profile?.lt2, 0);
    const speedSamples = streamPoints
      .map((point: any) => safeNumber(point?.speed, -1))
      .filter((value: number) => value > 0.1);
    if (lt2 > 0 && speedSamples.length > 0 && durationSeconds > 0) {
      const secondsPerSample = durationSeconds / speedSamples.length;
      speedSamples.forEach((speed: number) => {
        const paceMinPerKm = 1000 / (speed * 60);
        const zone = runningPaceZoneIndex(paceMinPerKm, lt2);
        if (zone) runningPaceZones[`Z${zone}`] += secondsPerSample;
      });
    }

    return {
      sport,
      zoneSecondsByMetric: {
        hr: runningHrZones,
        pace: runningPaceZones
      }
    };
  }

  if (sport === 'cycling') {
    let ftp = safeNumber(detail?.ftp_at_time ?? profile?.ftp, 0);
    const powerCurve = detail?.power_curve && typeof detail.power_curve === 'object'
      ? detail.power_curve
      : (streamsRaw?.power_curve && typeof streamsRaw.power_curve === 'object' ? streamsRaw.power_curve : null);

    if (ftp <= 0 && powerCurve) {
      ftp = safeNumber(powerCurve['20min'], 0) * 0.95;
    }

    const powerSamples = streamPoints
      .map((point: any) => {
        const direct = safeNumber(point?.power, NaN);
        if (Number.isFinite(direct)) return direct;
        return safeNumber(point?.watts, -1);
      })
      .filter((value: number) => value >= 0);

    if (ftp > 0 && powerSamples.length > 0 && durationSeconds > 0) {
      const secondsPerSample = durationSeconds / powerSamples.length;
      powerSamples.forEach((watts: number) => {
        const zone = cyclingZoneIndex(watts, ftp);
        cyclingPowerZones[`Z${zone}`] += secondsPerSample;
      });
    } else if (ftp > 0 && laps.length > 0) {
      laps.forEach((lap: any) => {
        const lapAvgPower = safeNumber(
          lap?.avg_power ?? lap?.average_watts,
          -1
        );
        const lapDuration = safeNumber(
          lap?.duration ?? lap?.elapsed_time,
          0
        );
        if (lapAvgPower < 0 || lapDuration <= 0) return;
        const zone = cyclingZoneIndex(lapAvgPower, ftp);
        cyclingPowerZones[`Z${zone}`] += lapDuration;
      });
    }

    const maxHr = safeNumber(profile?.max_hr, 190);
    const hrSamples = streamPoints
      .map((point: any) => {
        const direct = safeNumber(point?.heart_rate, NaN);
        if (Number.isFinite(direct)) return direct;
        return safeNumber(point?.heartrate, -1);
      })
      .filter((value: number) => value > 0);
    if (hrSamples.length > 0 && maxHr > 0 && durationSeconds > 0) {
      const secondsPerSample = durationSeconds / hrSamples.length;
      hrSamples.forEach((hr: number) => {
        const zone = runningZoneIndex(hr, maxHr);
        cyclingHrZones[`Z${zone}`] += secondsPerSample;
      });
    } else {
      const hrZones = (detail?.hr_zones && typeof detail.hr_zones === 'object')
        ? detail.hr_zones
        : (streamsRaw?.hr_zones && typeof streamsRaw.hr_zones === 'object' ? streamsRaw.hr_zones : null);

      if (hrZones) {
        for (let zone = 1; zone <= 5; zone += 1) {
          cyclingHrZones[`Z${zone}`] += getZoneSeconds(hrZones, zone);
        }
      } else if (maxHr > 0 && laps.length > 0) {
        laps.forEach((lap: any) => {
          const lapAvgHr = safeNumber(
            lap?.avg_hr ?? lap?.average_heartrate,
            -1
          );
          const lapDuration = safeNumber(
            lap?.duration ?? lap?.elapsed_time,
            0
          );
          if (lapAvgHr <= 0 || lapDuration <= 0) return;
          const zone = runningZoneIndex(lapAvgHr, maxHr);
          cyclingHrZones[`Z${zone}`] += lapDuration;
        });
      }
    }

    return {
      sport,
      zoneSecondsByMetric: {
        hr: cyclingHrZones,
        power: cyclingPowerZones
      }
    };
  }

  return {
    sport: 'other',
    zoneSecondsByMetric: {}
  };
};

export const computeLoadsFromZones = (inputZones: ZoneAggregate): { aerobicLoad: number; anaerobicLoad: number } => {
  const runWeights = [1, 2, 3, 4, 5];
  const runAerobicFractions = [0.98, 0.93, 0.8, 0.52, 0.25];
  const bikeWeights = [1, 2, 3, 4, 6, 8, 10];
  const bikeAerobicFractions = [0.99, 0.94, 0.84, 0.66, 0.44, 0.28, 0.16];

  let aerobic = 0;
  let anaerobic = 0;

  const bikePowerTotal = Object.values(inputZones.cycling.zoneSecondsByMetric.power).reduce((a, b) => a + b, 0);
  const bikeHrTotal = Object.values(inputZones.cycling.zoneSecondsByMetric.hr).reduce((a, b) => a + b, 0);
  const bikeZoneSource = bikePowerTotal > 0
    ? inputZones.cycling.zoneSecondsByMetric.power
    : (bikeHrTotal > 0 ? inputZones.cycling.zoneSecondsByMetric.hr : inputZones.cycling.zoneSecondsByMetric.power);

  runWeights.forEach((weight, idx) => {
    const zoneKey = `Z${idx + 1}`;
    const minutes = (inputZones.running.zoneSecondsByMetric.hr[zoneKey] || 0) / 60;
    const weighted = minutes * weight;
    const fraction = runAerobicFractions[idx];
    aerobic += weighted * fraction;
    anaerobic += weighted * (1 - fraction);
  });

  bikeWeights.forEach((weight, idx) => {
    const zoneKey = `Z${idx + 1}`;
    const minutes = (bikeZoneSource[zoneKey] || 0) / 60;
    const weighted = minutes * weight;
    const fraction = bikeAerobicFractions[idx];
    aerobic += weighted * fraction;
    anaerobic += weighted * (1 - fraction);
  });

  const hasTime = (
    Object.values(inputZones.running.zoneSecondsByMetric.hr).reduce((a, b) => a + b, 0)
    + Object.values(bikeZoneSource).reduce((a, b) => a + b, 0)
  ) > 0;

  if (hasTime) {
    if (aerobic <= 0) aerobic = 0.1;
    if (anaerobic <= 0) anaerobic = 0.1;
  }

  return {
    aerobicLoad: Number(aerobic.toFixed(1)),
    anaerobicLoad: Number(anaerobic.toFixed(1))
  };
};

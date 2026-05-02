import { describe, expect, it } from 'vitest';

import {
  computeLoadsFromZones,
  deriveZonesFromActivityDetail,
  hasAnyZoneSeconds,
  normalizeSport,
  zoneCountForSport,
} from './loadModel';

describe('calendar loadModel', () => {
  it('normalizes sports and resolves zone counts', () => {
    expect(normalizeSport('Trail Run')).toBe('running');
    expect(normalizeSport('Bike Ride')).toBe('cycling');
    expect(normalizeSport('Yoga')).toBe('other');

    expect(zoneCountForSport('Running')).toBe(5);
    expect(zoneCountForSport('Cycling')).toBe(7);
    expect(zoneCountForSport('Strength')).toBe(0);
  });

  it('detects whether any zone bucket has time', () => {
    expect(hasAnyZoneSeconds({ Z1: 0, Z2: 0 })).toBe(false);
    expect(hasAnyZoneSeconds({ Z1: 0, Z2: 15 })).toBe(true);
  });

  it('derives running hr and pace zones from stream samples', () => {
    const result = deriveZonesFromActivityDetail(
      {
        sport: 'Running',
        duration: 300,
        streams: [
          { heart_rate: 95, speed: 4 },
          { heart_rate: 125, speed: 3.2 },
          { heart_rate: 150, speed: 2.9 },
          { heart_rate: 170, speed: 2.6 },
          { heart_rate: 185, speed: 2.3 },
        ],
      },
      { max_hr: 200, lt2: 5 },
    );

    expect(result.sport).toBe('running');
    expect(result.zoneSecondsByMetric.hr).toEqual({
      Z1: 60,
      Z2: 60,
      Z3: 60,
      Z4: 60,
      Z5: 60,
    });
    expect(result.zoneSecondsByMetric.pace).toEqual({
      Z1: 120,
      Z2: 60,
      Z3: 60,
      Z4: 0,
      Z5: 0,
      Z6: 0,
      Z7: 60,
    });
  });

  it('falls back to stored running hr zones when no hr stream exists', () => {
    const result = deriveZonesFromActivityDetail(
      {
        sport: 'Run',
        duration: 1200,
        hr_zones: { Z1: 120, Z3: 240, Z5: 60 },
      },
      { max_hr: 190, lt2: 4.5 },
    );

    expect(result.sport).toBe('running');
    expect(result.zoneSecondsByMetric.hr).toEqual({
      Z1: 120,
      Z2: 0,
      Z3: 240,
      Z4: 0,
      Z5: 60,
    });
    expect(result.zoneSecondsByMetric.pace).toEqual({
      Z1: 0,
      Z2: 0,
      Z3: 0,
      Z4: 0,
      Z5: 0,
      Z6: 0,
      Z7: 0,
    });
  });

  it('derives cycling power and hr zones from stream samples', () => {
    const result = deriveZonesFromActivityDetail(
      {
        sport: 'Ride',
        duration: 420,
        ftp_at_time: 200,
        streams: [
          { power: 100, heart_rate: 100 },
          { watts: 150, heartrate: 130 },
          { power: 190, heart_rate: 150 },
          { power: 220, heart_rate: 170 },
          { power: 260, heart_rate: 190 },
          { power: 320, heart_rate: 195 },
          { power: 400, heart_rate: 180 },
        ],
      },
      { max_hr: 200 },
    );

    expect(result.sport).toBe('cycling');
    expect(result.zoneSecondsByMetric.power).toEqual({
      Z1: 60,
      Z2: 60,
      Z3: 0,
      Z4: 60,
      Z5: 60,
      Z6: 60,
      Z7: 120,
    });
    expect(result.zoneSecondsByMetric.hr).toEqual({
      Z1: 60,
      Z2: 60,
      Z3: 60,
      Z4: 60,
      Z5: 180,
    });
  });

  it('falls back to laps, power curve ftp, and array-based hr zones for cycling', () => {
    const result = deriveZonesFromActivityDetail(
      {
        sport: 'Cycling',
        duration: 600,
        power_curve: { '20min': 210 },
        laps: [
          { avg_power: 100, duration: 120 },
          { average_watts: 160, elapsed_time: 180 },
        ],
        streams: {
          hr_zones: [10, 20, 30, 40, 50],
        },
      },
      { max_hr: 190 },
    );

    expect(result.sport).toBe('cycling');
    expect(result.zoneSecondsByMetric.power).toEqual({
      Z1: 120,
      Z2: 0,
      Z3: 180,
      Z4: 0,
      Z5: 0,
      Z6: 0,
      Z7: 0,
    });
    expect(result.zoneSecondsByMetric.hr).toEqual({
      Z1: 10,
      Z2: 20,
      Z3: 30,
      Z4: 40,
      Z5: 50,
    });
  });

  it('returns an empty zone payload for unsupported sports', () => {
    expect(deriveZonesFromActivityDetail({ sport: 'Swim' })).toEqual({
      sport: 'other',
      zoneSecondsByMetric: {},
    });
  });

  it('computes aerobic and anaerobic loads using cycling power when available', () => {
    const result = computeLoadsFromZones({
      running: {
        activityCount: 0,
        zoneSecondsByMetric: {
          hr: { Z1: 60, Z2: 0, Z3: 0, Z4: 0, Z5: 60 },
          pace: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0, Z6: 0, Z7: 0 },
        },
      },
      cycling: {
        activityCount: 0,
        zoneSecondsByMetric: {
          hr: { Z1: 600, Z2: 0, Z3: 0, Z4: 0, Z5: 0 },
          power: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0, Z6: 0, Z7: 60 },
        },
      },
    });

    expect(result).toEqual({
      aerobicLoad: 3.8,
      anaerobicLoad: 12.2,
    });
  });

  it('falls back to cycling hr zones when no cycling power is present', () => {
    const result = computeLoadsFromZones({
      running: {
        activityCount: 0,
        zoneSecondsByMetric: {
          hr: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 },
          pace: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0, Z6: 0, Z7: 0 },
        },
      },
      cycling: {
        activityCount: 0,
        zoneSecondsByMetric: {
          hr: { Z1: 60, Z2: 60, Z3: 0, Z4: 0, Z5: 0 },
          power: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0, Z6: 0, Z7: 0 },
        },
      },
    });

    expect(result).toEqual({
      aerobicLoad: 2.9,
      anaerobicLoad: 0.1,
    });
  });

  it('returns zero loads when no zone time exists at all', () => {
    expect(
      computeLoadsFromZones({
        running: {
          activityCount: 0,
          zoneSecondsByMetric: {
            hr: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 },
            pace: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0, Z6: 0, Z7: 0 },
          },
        },
        cycling: {
          activityCount: 0,
          zoneSecondsByMetric: {
            hr: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 },
            power: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0, Z6: 0, Z7: 0 },
          },
        },
      }),
    ).toEqual({
      aerobicLoad: 0,
      anaerobicLoad: 0,
    });
  });
});
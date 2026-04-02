import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseWorkoutText,
  isParseError,
  _resetIdCounter,
  type ParseSuccess,
} from './parseWorkoutText';

beforeEach(() => _resetIdCounter());

/* ------------------------------------------------------------------ */
/*  Helper                                                            */
/* ------------------------------------------------------------------ */
const ok = (text: string, sport = 'Cycling') => {
  const r = parseWorkoutText(text, sport);
  expect(isParseError(r)).toBe(false);
  return r as ParseSuccess;
};

/* ------------------------------------------------------------------ */
/*  Core examples from the product spec                               */
/* ------------------------------------------------------------------ */

describe('parseWorkoutText', () => {
  it('parses cycling example: 15min wu + 3x5min@200w/4min rest + 10min cd', () => {
    const r = ok('15min wu + 3x5min@200w/4min rest + 10min cd');
    expect(r.structure).toHaveLength(3);

    // warmup block
    const wu = r.structure[0];
    expect(wu.type).toBe('block');
    if (wu.type === 'block') {
      expect(wu.category).toBe('warmup');
      expect(wu.duration).toEqual({ type: 'time', value: 900 });
    }

    // repeat
    const rep = r.structure[1];
    expect(rep.type).toBe('repeat');
    if (rep.type === 'repeat') {
      expect(rep.repeats).toBe(3);
      expect(rep.steps).toHaveLength(2);
      const work = rep.steps[0];
      if (work.type === 'block') {
        expect(work.category).toBe('work');
        expect(work.duration).toEqual({ type: 'time', value: 300 });
        expect(work.target.type).toBe('power');
        expect(work.target.value).toBe(200);
      }
      const rec = rep.steps[1];
      if (rec.type === 'block') {
        expect(rec.category).toBe('recovery');
        expect(rec.duration).toEqual({ type: 'time', value: 240 });
      }
    }

    // cooldown block
    const cd = r.structure[2];
    expect(cd.type).toBe('block');
    if (cd.type === 'block') {
      expect(cd.category).toBe('cooldown');
      expect(cd.duration).toEqual({ type: 'time', value: 600 });
    }

    expect(r.title).toContain('3×5min');
    expect(r.durationMinutes).toBe(Math.round((900 + 3 * (300 + 240) + 600) / 60));
  });

  it('parses running example: 15min + 5x1km/1min + 10min', () => {
    const r = ok('15min + 5x1km/1min + 10min', 'Running');
    expect(r.structure).toHaveLength(3);

    // warmup inferred
    const wu = r.structure[0];
    if (wu.type === 'block') {
      expect(wu.category).toBe('warmup');
      expect(wu.duration).toEqual({ type: 'time', value: 900 });
    }

    // repeat
    const rep = r.structure[1];
    if (rep.type === 'repeat') {
      expect(rep.repeats).toBe(5);
      const work = rep.steps[0];
      if (work.type === 'block') {
        expect(work.category).toBe('work');
        expect(work.duration).toEqual({ type: 'distance', value: 1000 });
      }
      const rec = rep.steps[1];
      if (rec.type === 'block') {
        expect(rec.category).toBe('recovery');
        expect(rec.duration).toEqual({ type: 'time', value: 60 });
      }
    }

    // cooldown inferred
    const cd = r.structure[2];
    if (cd.type === 'block') {
      expect(cd.category).toBe('cooldown');
    }

    expect(r.title).toContain('5×1km');
  });

  it('parses pace target: 10min + 4x1km@4:30/2min + 10min', () => {
    const r = ok('10min + 4x1km@4:30/2min + 10min', 'Running');
    const rep = r.structure[1];
    if (rep.type === 'repeat') {
      const work = rep.steps[0];
      if (work.type === 'block') {
        expect(work.target.type).toBe('pace');
        expect(work.target.value).toBe(4 * 60 + 30);
        expect(work.target.unit).toBe('min/km');
      }
    }
  });

  it('parses zone target: 20min + 6x3min@Z4/2min + 15min', () => {
    const r = ok('20min + 6x3min@Z4/2min + 15min');
    const rep = r.structure[1];
    if (rep.type === 'repeat') {
      const work = rep.steps[0];
      if (work.type === 'block') {
        expect(work.target.zone).toBe(4);
        expect(work.target.type).toBe('power');
      }
    }
  });

  it('handles zone target for running (HR)', () => {
    const r = ok('20min + 6x3min@Z4/2min + 15min', 'Running');
    const rep = r.structure[1];
    if (rep.type === 'repeat') {
      const work = rep.steps[0];
      if (work.type === 'block') {
        expect(work.target.zone).toBe(4);
        expect(work.target.type).toBe('heart_rate_zone');
      }
    }
  });

  it('parses single block: 45min', () => {
    const r = ok('45min');
    expect(r.structure).toHaveLength(1);
    const step = r.structure[0];
    if (step.type === 'block') {
      expect(step.category).toBe('work');
      expect(step.duration).toEqual({ type: 'time', value: 2700 });
    }
    expect(r.durationMinutes).toBe(45);
  });

  it('parses RPE target: 60min@RPE6', () => {
    const r = ok('60min@RPE6');
    expect(r.structure).toHaveLength(1);
    const step = r.structure[0];
    if (step.type === 'block') {
      expect(step.target.type).toBe('rpe');
      expect(step.target.value).toBe(6);
    }
  });

  it('parses HR target: 30min@150bpm', () => {
    const r = ok('30min@150bpm');
    const step = r.structure[0];
    if (step.type === 'block') {
      expect(step.target.type).toBe('heart_rate_zone');
      expect(step.target.value).toBe(150);
    }
  });

  it('parses no-@ power targets: 15min + 3x5min 200w/4min + 10min', () => {
    const r = ok('15min + 3x5min 200w/4min + 10min');
    const rep = r.structure[1];
    if (rep.type === 'repeat') {
      const work = rep.steps[0];
      if (work.type === 'block') {
        expect(work.target.type).toBe('power');
        expect(work.target.value).toBe(200);
      }
    }
  });

  it('parses pace targets with and without @', () => {
    const withAt = ok('15min + 10min@3:30 + 20min', 'Running');
    const noAt = ok('15min + 10min 3:30 + 20min', 'Running');

    const withAtMid = withAt.structure[1];
    const noAtMid = noAt.structure[1];

    if (withAtMid.type === 'block') {
      expect(withAtMid.target.type).toBe('pace');
      expect(withAtMid.target.value).toBe(210);
    }
    if (noAtMid.type === 'block') {
      expect(noAtMid.target.type).toBe('pace');
      expect(noAtMid.target.value).toBe(210);
    }
  });

  it('parses HR targets with @160hr and no-@ 160bpm', () => {
    const withAt = ok('15min + 10min@160hr + 20min', 'Running');
    const noAt = ok('15min + 10min 160bpm + 20min', 'Running');

    const withAtMid = withAt.structure[1];
    const noAtMid = noAt.structure[1];

    if (withAtMid.type === 'block') {
      expect(withAtMid.target.type).toBe('heart_rate_zone');
      expect(withAtMid.target.value).toBe(160);
    }
    if (noAtMid.type === 'block') {
      expect(noAtMid.target.type).toBe('heart_rate_zone');
      expect(noAtMid.target.value).toBe(160);
    }
  });

  it('parses distance: 800m', () => {
    const r = ok('800m', 'Running');
    const step = r.structure[0];
    if (step.type === 'block') {
      expect(step.duration).toEqual({ type: 'distance', value: 800 });
    }
  });

  it('parses multi-interval set: 10min + 3x3min@Z4/2min + 4x1min@Z5/1min + 10min', () => {
    const r = ok('10min + 3x3min@Z4/2min + 4x1min@Z5/1min + 10min');
    expect(r.structure).toHaveLength(4);
    expect(r.structure[0].type).toBe('block');
    expect(r.structure[1].type).toBe('repeat');
    expect(r.structure[2].type).toBe('repeat');
    expect(r.structure[3].type).toBe('block');

    if (r.structure[0].type === 'block') expect(r.structure[0].category).toBe('warmup');
    if (r.structure[3].type === 'block') expect(r.structure[3].category).toBe('cooldown');
  });

  it('supports semicolon as delimiter', () => {
    const r = ok('15min; 3x5min@200w/4min; 10min');
    expect(r.structure).toHaveLength(3);
  });

  it('returns error for empty string', () => {
    const r = parseWorkoutText('', 'Cycling');
    expect(isParseError(r)).toBe(true);
    if (isParseError(r)) expect(r.error).toContain('Empty');
  });

  it('returns error for unparseable segment', () => {
    const r = parseWorkoutText('15min + garbage text + 10min', 'Cycling');
    expect(isParseError(r)).toBe(true);
    if (isParseError(r)) expect(r.error).toContain('segment 2');
  });

  it('generates meaningful title for intervals', () => {
    const r = ok('15min + 3x5min@200w/4min + 10min');
    expect(r.title).toBe('3×5min @200W');
  });

  it('generates title for simple workout', () => {
    const r = ok('45min');
    expect(r.title).toBe('45min');
  });

  it('handles hours duration', () => {
    const r = ok('2h');
    const step = r.structure[0];
    if (step.type === 'block') {
      expect(step.duration).toEqual({ type: 'time', value: 7200 });
    }
    expect(r.durationMinutes).toBe(120);
  });

  it('handles recovery segment between repeats', () => {
    const r = ok('3x3min@Z4/2min + 5min + 4x1min@Z5/1min');
    // The 5min between two repeat sets should be recovery
    const mid = r.structure[1];
    if (mid.type === 'block') {
      expect(mid.category).toBe('recovery');
    }
  });
});

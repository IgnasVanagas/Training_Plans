import type { WorkoutNode, ConcreteStep, RepeatStep, DurationConfig, TargetConfig, StepCategory } from '../../types/workout';

/* ------------------------------------------------------------------ */
/*  Deterministic shorthand workout text parser                       */
/*  Examples:                                                         */
/*    "15min wu + 3x5min@200w/4min rest + 10min cd"                   */
/*    "15min + 5x1km/1min + 10min"                                    */
/*    "10min + 4x1km@4:30/2min + 10min"                               */
/*    "20min + 6x3min@Z4/2min + 15min"                                */
/*    "45min"                                                         */
/*    "60min@RPE6"                                                    */
/* ------------------------------------------------------------------ */

export interface ParseSuccess {
  structure: WorkoutNode[];
  title: string;
  durationMinutes: number;
}

export interface ParseError {
  error: string;
}

export type ParseResult = ParseSuccess | ParseError;

export const isParseError = (r: ParseResult): r is ParseError => 'error' in r;

/* ---------- tiny helpers ------------------------------------------ */

let _idCounter = 0;
const uid = () => `p${++_idCounter}-${Math.random().toString(36).slice(2, 7)}`;

/** Reset counter — useful for tests */
export const _resetIdCounter = () => { _idCounter = 0; };

/* ---------- duration parsing -------------------------------------- */

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|min|mins|minutes?|s|sec|secs|seconds?|km|mi|m)$/i;

const parseDuration = (raw: string): DurationConfig | null => {
  const m = raw.trim().match(DURATION_RE);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2].toLowerCase();

  if (unit.startsWith('h'))        return { type: 'time', value: Math.round(num * 3600) };
  if (unit.startsWith('min'))      return { type: 'time', value: Math.round(num * 60) };
  if (unit.startsWith('s'))        return { type: 'time', value: Math.round(num) };
  if (unit === 'km')               return { type: 'distance', value: Math.round(num * 1000) };
  if (unit === 'mi')               return { type: 'distance', value: Math.round(num * 1609.344) };
  if (unit === 'm')                return { type: 'distance', value: Math.round(num) };
  return null;
};

/* ---------- target parsing ---------------------------------------- */

// @200w  @200W
const POWER_RE = /^(\d+)\s*[wW]$/;
// @4:30  (pace min:sec per km)
const PACE_RE  = /^(\d+):(\d{1,2})$/;
// @Z3  @z3
const ZONE_RE  = /^[zZ](\d+)$/;
// @150bpm  @150BPM
const HR_RE    = /^(\d+)\s*(bpm|hr)$/i;
// @RPE7  @rpe7
const RPE_RE   = /^[rR][pP][eE]\s*(\d+(?:\.\d+)?)$/;

const DURATION_PREFIX_RE = /^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|min|mins|minutes?|s|sec|secs|seconds?|km|mi|m)\s*(.*)$/i;

/* Zone bounds — inline copy so we don't need to export from quickWorkout.ts */
const zoneBounds = (sportType: string, zone: number) => {
  const isRunning = (sportType || '').toLowerCase().includes('run');
  if (isRunning) {
    const hrRanges: [number, number][] = [[50,60],[60,70],[70,80],[80,90],[90,100]];
    const idx = Math.max(1, Math.min(hrRanges.length, zone)) - 1;
    return { min: hrRanges[idx][0], max: hrRanges[idx][1], targetType: 'heart_rate_zone' as const };
  }
  const powerRanges: [number, number][] = [[50,55],[56,75],[76,90],[91,105],[106,120],[121,150],[151,200]];
  const idx = Math.max(1, Math.min(powerRanges.length, zone)) - 1;
  return { min: powerRanges[idx][0], max: powerRanges[idx][1], targetType: 'power' as const };
};

const parseTarget = (raw: string, sportType: string): TargetConfig | null => {
  const s = raw.trim();
  let m: RegExpMatchArray | null;

  if ((m = s.match(POWER_RE))) {
    const watts = parseInt(m[1], 10);
    return { type: 'power', metric: 'watts', value: watts, min: watts, max: watts, unit: 'W' };
  }
  if ((m = s.match(PACE_RE))) {
    const totalSec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return { type: 'pace', value: totalSec, unit: 'min/km' };
  }
  if ((m = s.match(ZONE_RE))) {
    const z = parseInt(m[1], 10);
    const b = zoneBounds(sportType, z);
    return { type: b.targetType, zone: z, min: b.min, max: b.max, unit: '%' };
  }
  if ((m = s.match(HR_RE))) {
    const bpm = parseInt(m[1], 10);
    return { type: 'heart_rate_zone', value: bpm, min: bpm, max: bpm };
  }
  if ((m = s.match(RPE_RE))) {
    return { type: 'rpe', value: parseFloat(m[1]) };
  }
  return null;
};

/* ---------- category keyword detection ----------------------------- */

const WARMUP_RE   = /\b(wu|warm\s*up|warmup)\b/i;
const COOLDOWN_RE = /\b(cd|cool\s*down|cooldown)\b/i;
const REST_RE     = /\b(rest|rec|recovery)\b/i;

const stripCategoryKeyword = (s: string): string =>
  s.replace(WARMUP_RE, '').replace(COOLDOWN_RE, '').replace(REST_RE, '').trim();

const detectCategory = (s: string): StepCategory | null => {
  if (WARMUP_RE.test(s))   return 'warmup';
  if (COOLDOWN_RE.test(s))  return 'cooldown';
  if (REST_RE.test(s))      return 'recovery';
  return null;
};

/* ---------- segment token (one piece between '+') ------------------- */

// Repeat prefix: "3x", "5X", "3×"
const REPEAT_RE = /^(\d+)\s*[xX×]\s*/;
// Target suffix: "@<something>"
const TARGET_SPLIT_RE = /@/;
// Recovery separator inside repeat: "5min@200w/4min"
const RECOVERY_SEP = '/';

interface SimpleBlock {
  kind: 'block';
  category: StepCategory | null; // null = infer from position
  duration: DurationConfig;
  target: TargetConfig | null;
}

interface RepeatBlock {
  kind: 'repeat';
  repeats: number;
  workDuration: DurationConfig;
  workTarget: TargetConfig | null;
  recoveryDuration: DurationConfig | null;
}

interface SetRepeatBlock {
  kind: 'setRepeat';
  sets: number;
  reps: number;
  repSteps: Array<{ duration: DurationConfig; target: TargetConfig | null }>;
  setRecovery: DurationConfig | null;
}

type Segment = SimpleBlock | RepeatBlock | SetRepeatBlock;

const splitDurationAndTarget = (raw: string): { durationRaw: string; targetRaw: string | null } | null => {
  const source = raw.trim();
  if (!source) return null;

  const atIdx = source.indexOf('@');
  if (atIdx >= 0) {
    return {
      durationRaw: source.slice(0, atIdx).trim(),
      targetRaw: source.slice(atIdx + 1).trim() || null,
    };
  }

  const m = source.match(DURATION_PREFIX_RE);
  if (!m) return null;

  const durationRaw = `${m[1]}${m[2]}`;
  const tail = (m[3] || '').trim();
  if (!tail) return { durationRaw, targetRaw: null };

  // Support no-@ target syntax: "10min 200w", "10min 3:30", "10min 160bpm"
  return { durationRaw, targetRaw: tail };
};

const parseSegment = (raw: string, sportType: string): Segment | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Detect explicit category keyword
  const explicitCat = detectCategory(trimmed);
  const cleaned = stripCategoryKeyword(trimmed);

  // Check for repeat prefix
  const setRepeatMatch = cleaned.match(/^(\d+)\s*[xX×]\s*(\d+)\s*[xX×]\s*(.+)$/);
  if (setRepeatMatch) {
    const sets = parseInt(setRepeatMatch[1], 10);
    const reps = parseInt(setRepeatMatch[2], 10);
    const tail = setRepeatMatch[3].trim();
    if (!tail) return null;

    const rawParts = tail.split(RECOVERY_SEP).map((p) => p.trim()).filter(Boolean);
    if (rawParts.length < 2) return null;

    const parsedParts = rawParts.map((part) => {
      const split = splitDurationAndTarget(part);
      if (!split) return null;
      const duration = parseDuration(split.durationRaw);
      if (!duration) return null;
      const target = split.targetRaw ? parseTarget(split.targetRaw, sportType) : null;
      return { duration, target };
    });
    if (parsedParts.some((p) => p == null)) return null;

    const resolvedParts = parsedParts as Array<{ duration: DurationConfig; target: TargetConfig | null }>;
    const hasExplicitSetRecovery = resolvedParts.length > 2 && resolvedParts[resolvedParts.length - 1].target == null;
    const repSteps = hasExplicitSetRecovery ? resolvedParts.slice(0, -1) : resolvedParts;
    const setRecovery = hasExplicitSetRecovery ? resolvedParts[resolvedParts.length - 1].duration : null;

    return {
      kind: 'setRepeat',
      sets,
      reps,
      repSteps,
      setRecovery,
    };
  }

  const repeatMatch = cleaned.match(REPEAT_RE);
  if (repeatMatch) {
    const repeats = parseInt(repeatMatch[1], 10);
    const afterRepeat = cleaned.slice(repeatMatch[0].length);

    // Split on '/' for work/recovery
    const parts = afterRepeat.split(RECOVERY_SEP);
    const workPart = parts[0].trim();
    const recoveryPart = parts.length > 1 ? parts.slice(1).join(RECOVERY_SEP).trim() : null;

    // Parse work: "5min@200w", "5min 200w", "1km@4:30", "1km 4:30", or "5min"
    const workSplit = splitDurationAndTarget(workPart);
    if (!workSplit) return null;
    const workDurStr = workSplit.durationRaw;
    const workTargetStr = workSplit.targetRaw;

    const workDuration = parseDuration(workDurStr);
    if (!workDuration) return null;

    const workTarget = workTargetStr ? parseTarget(workTargetStr, sportType) : null;

    // Parse recovery (strip any category keyword like "rest")
    let recoveryDuration: DurationConfig | null = null;
    if (recoveryPart) {
      const recCleaned = stripCategoryKeyword(recoveryPart);
      // Recovery might also have a target (unusual but handle gracefully)
      const recSplit = splitDurationAndTarget(recCleaned);
      recoveryDuration = recSplit ? parseDuration(recSplit.durationRaw) : null;
    }

    return { kind: 'repeat', repeats, workDuration, workTarget, recoveryDuration };
  }

  // Simple block: "15min", "5km@Z3", "10min wu"
  const split = splitDurationAndTarget(cleaned);
  if (!split) return null;
  const durStr = split.durationRaw;
  const targetStr = split.targetRaw;

  const duration = parseDuration(durStr);
  if (!duration) return null;

  const target = targetStr ? parseTarget(targetStr, sportType) : null;

  return { kind: 'block', category: explicitCat, duration, target };
};

/* ---------- position-based category inference ----------------------- */

const inferCategories = (segments: Segment[]): void => {
  // Only infer for SimpleBlock segments that have no explicit category
  const blocks = segments.filter((s): s is SimpleBlock => s.kind === 'block');
  const hasRepeats = segments.some(s => s.kind === 'repeat');

  if (!hasRepeats) {
    // No intervals — if single block, it's 'work'
    for (const b of blocks) {
      if (b.category === null) b.category = 'work';
    }
    return;
  }

  // Find indices relative to all segments
  const firstRepeatIdx = segments.findIndex(s => s.kind === 'repeat');
  const lastRepeatIdx = segments.length - 1 - [...segments].reverse().findIndex(s => s.kind === 'repeat');

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind !== 'block' || seg.category !== null) continue;

    if (i < firstRepeatIdx) {
      // Before first interval set → warmup
      seg.category = 'warmup';
    } else if (i > lastRepeatIdx) {
      // After last interval set → cooldown
      seg.category = 'cooldown';
    } else {
      // Between interval sets → recovery
      seg.category = 'recovery';
    }
  }
};

/* ---------- build WorkoutNode[] from segments ----------------------- */

const defaultTarget = (sportType: string): TargetConfig => {
  const isRunning = (sportType || '').toLowerCase().includes('run');
  return isRunning
    ? { type: 'heart_rate_zone', zone: 1, min: 50, max: 60, unit: '%' }
    : { type: 'power', zone: 1, min: 50, max: 55, unit: '%' };
};

const buildNodes = (segments: Segment[], sportType: string): WorkoutNode[] => {
  const nodes: WorkoutNode[] = [];

  for (const seg of segments) {
    if (seg.kind === 'block') {
      const cat = seg.category || 'work';
      const target = seg.target
        || (cat === 'warmup' || cat === 'cooldown' || cat === 'recovery' ? defaultTarget(sportType) : { type: 'open' as const });
      const step: ConcreteStep = {
        id: uid(),
        type: 'block',
        category: cat,
        duration: seg.duration,
        target,
      };
      nodes.push(step);
    } else if (seg.kind === 'repeat') {
      // Repeat
      const workStep: ConcreteStep = {
        id: uid(),
        type: 'block',
        category: 'work',
        duration: seg.workDuration,
        target: seg.workTarget || { type: 'open' as const },
      };
      const steps: ConcreteStep[] = [workStep];
      if (seg.recoveryDuration) {
        steps.push({
          id: uid(),
          type: 'block',
          category: 'recovery',
          duration: seg.recoveryDuration,
          target: defaultTarget(sportType),
        });
      }
      const repeat: RepeatStep = {
        id: uid(),
        type: 'repeat',
        repeats: seg.repeats,
        steps,
      };
      nodes.push(repeat);
    } else {
      const steps: ConcreteStep[] = [];
      for (let repIdx = 0; repIdx < seg.reps; repIdx++) {
        for (const repStep of seg.repSteps) {
          steps.push({
            id: uid(),
            type: 'block',
            category: 'work',
            duration: repStep.duration,
            target: repStep.target || { type: 'open' as const },
          });
        }
      }
      if (seg.setRecovery) {
        steps.push({
          id: uid(),
          type: 'block',
          category: 'recovery',
          duration: seg.setRecovery,
          target: defaultTarget(sportType),
        });
      }

      const setRepeat: RepeatStep = {
        id: uid(),
        type: 'repeat',
        repeats: seg.sets,
        steps,
      };
      nodes.push(setRepeat);
    }
  }

  return nodes;
};

/* ---------- duration estimation ------------------------------------ */

const estimateDurationSeconds = (nodes: WorkoutNode[]): number => {
  let total = 0;
  for (const node of nodes) {
    if (node.type === 'block') {
      if (node.duration.type === 'time' && node.duration.value != null) {
        total += node.duration.value;
      } else if (node.duration.type === 'distance' && node.duration.value != null) {
        // Rough estimate: 5min/km for running, 2min/km for cycling
        total += (node.duration.value / 1000) * 300;
      }
    } else {
      total += node.repeats * estimateDurationSeconds(node.steps);
    }
  }
  return total;
};

/* ---------- title generation --------------------------------------- */

const formatDurationShort = (d: DurationConfig): string => {
  if (d.type === 'time' && d.value != null) {
    const secs = d.value;
    if (secs >= 3600) return `${(secs / 3600).toFixed(secs % 3600 === 0 ? 0 : 1)}h`;
    if (secs >= 60) return `${Math.round(secs / 60)}min`;
    return `${secs}s`;
  }
  if (d.type === 'distance' && d.value != null) {
    if (d.value >= 1000) return `${(d.value / 1000).toFixed(d.value % 1000 === 0 ? 0 : 1)}km`;
    return `${d.value}m`;
  }
  return '?';
};

const formatTargetShort = (t: TargetConfig): string => {
  if (t.type === 'power' && t.value != null) return `@${t.value}W`;
  if (t.type === 'pace' && t.value != null) {
    const mins = Math.floor(t.value / 60);
    const secs = t.value % 60;
    return `@${mins}:${secs.toString().padStart(2, '0')}`;
  }
  if (t.zone != null) return `@Z${t.zone}`;
  if (t.type === 'rpe' && t.value != null) return `@RPE${t.value}`;
  return '';
};

const generateTitle = (segments: Segment[]): string => {
  // Find the most interesting repeat(s)
  const repeats = segments.filter((s): s is RepeatBlock | SetRepeatBlock => s.kind === 'repeat' || s.kind === 'setRepeat');
  if (repeats.length === 0) {
    // No intervals — just summarise the blocks
    const blocks = segments.filter((s): s is SimpleBlock => s.kind === 'block');
    if (blocks.length === 1) {
      const b = blocks[0];
      const tgt = b.target ? formatTargetShort(b.target) : '';
      return `${formatDurationShort(b.duration)}${tgt ? ' ' + tgt : ''}`;
    }
    return blocks.map(b => formatDurationShort(b.duration)).join(' + ');
  }

  const parts = repeats.map(r => {
    if (r.kind === 'setRepeat') {
      const pattern = r.repSteps
        .map((step) => `${formatDurationShort(step.duration)}${step.target ? ` ${formatTargetShort(step.target)}` : ''}`.trim())
        .join('/');
      const setRecovery = r.setRecovery ? `/${formatDurationShort(r.setRecovery)}` : '';
      return `${r.sets}×${r.reps}×${pattern}${setRecovery}`;
    }
    const tgt = r.workTarget ? ' ' + formatTargetShort(r.workTarget) : '';
    return `${r.repeats}×${formatDurationShort(r.workDuration)}${tgt}`;
  });
  return parts.join(' + ');
};

/* ---------- main entry point --------------------------------------- */

export const parseWorkoutText = (text: string, sportType: string): ParseResult => {
  const trimmed = (text || '').trim();
  if (!trimmed) return { error: 'Empty input' };

  // Split on '+' or ';' as segment delimiter
  const rawSegments = trimmed.split(/[+;]/).map(s => s.trim()).filter(Boolean);
  if (rawSegments.length === 0) return { error: 'No workout segments found' };

  const segments: Segment[] = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const seg = parseSegment(rawSegments[i], sportType);
    if (!seg) {
      return { error: `Could not parse segment ${i + 1}: "${rawSegments[i]}"` };
    }
    segments.push(seg);
  }

  // Infer categories for blocks without explicit keyword
  inferCategories(segments);

  // Build nodes
  const structure = buildNodes(segments, sportType);
  if (structure.length === 0) return { error: 'No steps parsed' };

  // Generate title
  const title = generateTitle(segments);

  // Estimate duration
  const durationMinutes = Math.round(estimateDurationSeconds(structure) / 60);

  return { structure, title, durationMinutes };
};

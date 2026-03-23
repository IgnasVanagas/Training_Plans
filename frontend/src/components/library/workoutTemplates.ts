import { SavedWorkout, WorkoutNode } from '../../types/workout';

/**
 * Built-in workout templates for common running and cycling sessions.
 * These use negative IDs to distinguish from user-created workouts.
 */

let _nextId = 0;
const rid = () => `tpl-${++_nextId}`;

// ── Running Templates ──────────────────────────────────────────────

const EASY_RUN: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 300 }, target: { type: 'heart_rate_zone', zone: 1 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 2400 }, target: { type: 'heart_rate_zone', zone: 2 } },
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 300 }, target: { type: 'heart_rate_zone', zone: 1 } },
];

const TEMPO_RUN: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 2 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 1200 }, target: { type: 'heart_rate_zone', zone: 3 } },
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 2 } },
];

const LONG_RUN: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 1 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 4800 }, target: { type: 'heart_rate_zone', zone: 2 } },
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 1 } },
];

const FARTLEK: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'rpe', value: 3 } },
  { id: rid(), type: 'repeat', repeats: 6, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 90 }, target: { type: 'rpe', value: 8 } },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 90 }, target: { type: 'rpe', value: 3 } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'rpe', value: 3 } },
];

const HILL_REPEATS: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 2 } },
  { id: rid(), type: 'repeat', repeats: 8, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 60 }, target: { type: 'rpe', value: 9 } },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 120 }, target: { type: 'rpe', value: 3 } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 1 } },
];

const TRACK_400M_INTERVALS: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 2 } },
  { id: rid(), type: 'repeat', repeats: 8, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'distance', value: 400 }, target: { type: 'rpe', value: 9 } },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 90 }, target: { type: 'rpe', value: 2 } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 1 } },
];

const THRESHOLD_INTERVALS_RUN: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 2 } },
  { id: rid(), type: 'repeat', repeats: 4, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 300 }, target: { type: 'heart_rate_zone', zone: 4 } },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 150 }, target: { type: 'heart_rate_zone', zone: 1 } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 1 } },
];

const RECOVERY_RUN: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 1800 }, target: { type: 'heart_rate_zone', zone: 1 } },
];

const PROGRESSIVE_RUN: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 1 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 900 }, target: { type: 'heart_rate_zone', zone: 2 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 600 }, target: { type: 'heart_rate_zone', zone: 3 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 300 }, target: { type: 'heart_rate_zone', zone: 4 } },
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 300 }, target: { type: 'heart_rate_zone', zone: 1 } },
];

const SPEED_PYRAMID: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'rpe', value: 3 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 60 }, target: { type: 'rpe', value: 9 } },
  { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 60 }, target: { type: 'rpe', value: 2 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 120 }, target: { type: 'rpe', value: 8 } },
  { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 120 }, target: { type: 'rpe', value: 2 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 180 }, target: { type: 'rpe', value: 7 } },
  { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 180 }, target: { type: 'rpe', value: 2 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 120 }, target: { type: 'rpe', value: 8 } },
  { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 120 }, target: { type: 'rpe', value: 2 } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 60 }, target: { type: 'rpe', value: 9 } },
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'rpe', value: 2 } },
];

// ── Cycling Templates ──────────────────────────────────────────────

const ENDURANCE_RIDE: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 5400 }, target: { type: 'power', metric: 'percent_ftp', value: 65, zone: 2, min: 56, max: 75, unit: '%' } },
];

const SWEET_SPOT_INTERVALS: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  { id: rid(), type: 'repeat', repeats: 3, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 90, zone: 3, min: 88, max: 93, unit: '%' } },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 300 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

const VO2MAX_INTERVALS_BIKE: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  { id: rid(), type: 'repeat', repeats: 5, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 180 }, target: { type: 'power', metric: 'percent_ftp', value: 115, zone: 5, min: 106, max: 120, unit: '%' } },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 180 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

const FTP_2x20: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 1200 }, target: { type: 'power', metric: 'percent_ftp', value: 95, zone: 4, min: 91, max: 105, unit: '%' } },
  { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 1200 }, target: { type: 'power', metric: 'percent_ftp', value: 95, zone: 4, min: 91, max: 105, unit: '%' } },
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

const OVER_UNDER_INTERVALS: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  { id: rid(), type: 'repeat', repeats: 4, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 120 }, target: { type: 'power', metric: 'percent_ftp', value: 95, zone: 4, min: 91, max: 105, unit: '%' } },
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 60 }, target: { type: 'power', metric: 'percent_ftp', value: 110, zone: 5, min: 106, max: 120, unit: '%' } },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 300 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

const SPRINT_INTERVALS: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  { id: rid(), type: 'repeat', repeats: 8, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 30 }, target: { type: 'rpe', value: 10 } },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 270 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

const RECOVERY_RIDE: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 3600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

const TEMPO_RIDE: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 2400 }, target: { type: 'power', metric: 'percent_ftp', value: 83, zone: 3, min: 76, max: 90, unit: '%' } },
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

const CADENCE_DRILLS: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  { id: rid(), type: 'repeat', repeats: 6, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 120 }, target: { type: 'rpe', value: 6 }, description: 'High cadence 100+ RPM' },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 120 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

const HILL_CLIMB_REPEATS: WorkoutNode[] = [
  { id: rid(), type: 'block', category: 'warmup', duration: { type: 'time', value: 900 }, target: { type: 'power', metric: 'percent_ftp', value: 62, zone: 2, min: 56, max: 75, unit: '%' } },
  { id: rid(), type: 'repeat', repeats: 5, steps: [
    { id: rid(), type: 'block', category: 'work', duration: { type: 'time', value: 300 }, target: { type: 'power', metric: 'percent_ftp', value: 100, zone: 4, min: 91, max: 105, unit: '%' }, description: 'Seated climbing' },
    { id: rid(), type: 'block', category: 'recovery', duration: { type: 'time', value: 300 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
  ]},
  { id: rid(), type: 'block', category: 'cooldown', duration: { type: 'time', value: 600 }, target: { type: 'power', metric: 'percent_ftp', value: 52, zone: 1, min: 50, max: 55, unit: '%' } },
];

// ── Template list ──────────────────────────────────────────────────

interface WorkoutTemplate {
  title: string;
  description: string;
  sport_type: string;
  tags: string[];
  structure: WorkoutNode[];
}

const templates: WorkoutTemplate[] = [
  // Running
  { title: 'Easy Run', description: '30 min easy aerobic run in Zone 2.', sport_type: 'Running', tags: ['Easy', 'Aerobic'], structure: EASY_RUN },
  { title: 'Tempo Run', description: '20 min tempo at Zone 3 with warm-up and cool-down.', sport_type: 'Running', tags: ['Tempo', 'Threshold'], structure: TEMPO_RUN },
  { title: 'Long Run', description: '90 min steady endurance run.', sport_type: 'Running', tags: ['Endurance', 'Long'], structure: LONG_RUN },
  { title: 'Fartlek', description: '6×90s hard / 90s easy with warm-up and cool-down.', sport_type: 'Running', tags: ['Speed', 'Fartlek'], structure: FARTLEK },
  { title: 'Hill Repeats', description: '8×1 min uphill sprints with jog recovery.', sport_type: 'Running', tags: ['Hills', 'Strength'], structure: HILL_REPEATS },
  { title: '8×400 m Track', description: '8×400 m fast repeats with 90 s recovery.', sport_type: 'Running', tags: ['Speed', 'Track'], structure: TRACK_400M_INTERVALS },
  { title: 'Threshold Intervals', description: '4×5 min at Zone 4 with recovery jogs.', sport_type: 'Running', tags: ['Threshold', 'Intervals'], structure: THRESHOLD_INTERVALS_RUN },
  { title: 'Recovery Run', description: '30 min very easy shakeout run.', sport_type: 'Running', tags: ['Recovery', 'Easy'], structure: RECOVERY_RUN },
  { title: 'Progressive Run', description: 'Build from Zone 1 to Zone 4 over 45 min.', sport_type: 'Running', tags: ['Progressive', 'Tempo'], structure: PROGRESSIVE_RUN },
  { title: 'Speed Pyramid', description: '1-2-3-2-1 min hard with equal recovery.', sport_type: 'Running', tags: ['Speed', 'Pyramid'], structure: SPEED_PYRAMID },
  // Cycling
  { title: 'Endurance Ride', description: '90 min steady Zone 2 ride to build base.', sport_type: 'Cycling', tags: ['Endurance', 'Base'], structure: ENDURANCE_RIDE },
  { title: 'Sweet Spot 3×15', description: '3×15 min at 88-93 % FTP with 5 min rest.', sport_type: 'Cycling', tags: ['Sweet Spot', 'Threshold'], structure: SWEET_SPOT_INTERVALS },
  { title: 'VO2max 5×3 min', description: '5×3 min at 115 % FTP with 3 min recovery.', sport_type: 'Cycling', tags: ['VO2max', 'Intervals'], structure: VO2MAX_INTERVALS_BIKE },
  { title: '2×20 FTP', description: 'Classic 2×20 min at 95 % FTP threshold builder.', sport_type: 'Cycling', tags: ['FTP', 'Threshold'], structure: FTP_2x20 },
  { title: 'Over-Under Intervals', description: '4× (2 min under + 1 min over FTP) with 5 min rest.', sport_type: 'Cycling', tags: ['Over-Under', 'Threshold'], structure: OVER_UNDER_INTERVALS },
  { title: 'Sprint Intervals', description: '8×30 s all-out sprints with 4.5 min recovery.', sport_type: 'Cycling', tags: ['Sprint', 'Anaerobic'], structure: SPRINT_INTERVALS },
  { title: 'Recovery Ride', description: '60 min easy spin in Zone 1.', sport_type: 'Cycling', tags: ['Recovery', 'Easy'], structure: RECOVERY_RIDE },
  { title: 'Tempo Ride', description: '40 min at Zone 3 power with warm-up and cool-down.', sport_type: 'Cycling', tags: ['Tempo', 'Sustained'], structure: TEMPO_RIDE },
  { title: 'Cadence Drills', description: '6×2 min high-cadence efforts with 2 min rest.', sport_type: 'Cycling', tags: ['Cadence', 'Technique'], structure: CADENCE_DRILLS },
  { title: 'Hill Climb Repeats', description: '5×5 min seated climbing at FTP with 5 min rest.', sport_type: 'Cycling', tags: ['Hills', 'Climbing'], structure: HILL_CLIMB_REPEATS },
];

/** Returns built-in templates shaped like SavedWorkout (negative IDs). */
export const getBuiltInTemplates = (): SavedWorkout[] =>
  templates.map((t, i) => ({
    id: -(i + 1),
    coach_id: 0,
    title: t.title,
    description: t.description,
    sport_type: t.sport_type,
    tags: t.tags,
    structure: t.structure,
    is_favorite: false,
    created_at: '',
  }));

/** Check if a workout is a built-in template (has negative id). */
export const isBuiltInTemplate = (w: SavedWorkout) => w.id < 0;

export type StepCategory = 'warmup' | 'work' | 'recovery' | 'cooldown';
export type DurationType = 'time' | 'distance' | 'lap_button' | 'calories';
export type TargetType = 'heart_rate_zone' | 'power' | 'pace' | 'rpe' | 'open';

export interface DurationConfig {
    type: DurationType;
    value: number | null; // seconds, meters, or null for lap button
}

export interface TargetConfig {
    type: TargetType;
    min?: number;
    max?: number;
    zone?: number;
    value?: number;
    metric?: string;
    unit?: string; // '%', 'W', 'min/km', 'min/mi'
    variance?: number; // +/- range
}

export interface WorkoutStepBase {
    id: string;
    description?: string;
}

export interface ConcreteStep extends WorkoutStepBase {
    type: 'block';
    category: StepCategory;
    duration: DurationConfig;
    target: TargetConfig;
}

export interface RepeatStep extends WorkoutStepBase {
    type: 'repeat';
    repeats: number;
    steps: Array<ConcreteStep | RepeatStep>; // Recursive definition
}

export type WorkoutNode = ConcreteStep | RepeatStep;

export interface WorkoutStructure {
    title: string;
    sport_type: string;
    description?: string;
    structure: WorkoutNode[];
}

export interface SavedWorkout extends WorkoutStructure {
    id: number;
    coach_id: number;
    created_at: string;
}

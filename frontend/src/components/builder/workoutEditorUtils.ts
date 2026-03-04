import { ConcreteStep, RepeatStep, StepCategory, TargetConfig, TargetType, WorkoutNode } from '../../types/workout';

export type ZoneRow = { zone: number; low: number; high: number; label: string };
export type IntensityMetric =
	| 'percent_ftp'
	| 'np'
	| 'watts'
	| 'wkg'
	| 'percent_max_hr'
	| 'percent_lthr'
	| 'hr_zone'
	| 'pace_min_km'
	| 'percent_threshold_pace'
	| 'goal_race_pace'
	| 'rpe_scale';

export const durationTypeOptions = [
	{ value: 'time', label: 'Time' },
	{ value: 'distance', label: 'Distance' },
	{ value: 'lap_button', label: 'Lap Button' },
	{ value: 'calories', label: 'Calories' }
];

export const intensityTypeOptions = ['Custom', 'Power-focused', 'Heart Rate-focused', 'Pace-focused', 'RPE-focused'];

export const metricOptions: Array<{ group: string; items: Array<{ value: IntensityMetric; label: string }> }> = [
	{
		group: 'Power-based',
		items: [
			{ value: 'percent_ftp', label: '% FTP' },
			{ value: 'np', label: 'NP' },
			{ value: 'watts', label: 'Watts' },
			{ value: 'wkg', label: 'W/kg' }
		]
	},
	{
		group: 'Heart Rate-based',
		items: [
			{ value: 'percent_max_hr', label: '% Max HR' },
			{ value: 'percent_lthr', label: '% LTHR' },
			{ value: 'hr_zone', label: 'Heart Rate Zone (Z1-Z5)' }
		]
	},
	{
		group: 'Pace-based',
		items: [
			{ value: 'pace_min_km', label: 'Min/km' },
			{ value: 'percent_threshold_pace', label: '% Threshold Pace' },
			{ value: 'goal_race_pace', label: 'Goal Race Pace' }
		]
	},
	{
		group: 'Subjective',
		items: [{ value: 'rpe_scale', label: 'RPE (1-10 Scale)' }]
	}
];

export const metricMeta: Record<IntensityMetric, { targetType: TargetType; defaultUnit: string }> = {
	percent_ftp: { targetType: 'power', defaultUnit: '%' },
	np: { targetType: 'power', defaultUnit: 'W' },
	watts: { targetType: 'power', defaultUnit: 'W' },
	wkg: { targetType: 'power', defaultUnit: 'W/kg' },
	percent_max_hr: { targetType: 'heart_rate_zone', defaultUnit: '%' },
	percent_lthr: { targetType: 'heart_rate_zone', defaultUnit: '%' },
	hr_zone: { targetType: 'heart_rate_zone', defaultUnit: 'zone' },
	pace_min_km: { targetType: 'pace', defaultUnit: 'min/km' },
	percent_threshold_pace: { targetType: 'pace', defaultUnit: '%' },
	goal_race_pace: { targetType: 'pace', defaultUnit: 'min/km' },
	rpe_scale: { targetType: 'rpe', defaultUnit: 'RPE' }
};

export const sectionHeaderTint: Record<StepCategory, string> = {
	warmup: 'rgba(14, 165, 233, 0.14)',
	work: 'rgba(249, 115, 22, 0.14)',
	recovery: 'rgba(34, 197, 94, 0.14)',
	cooldown: 'rgba(168, 85, 247, 0.14)'
};

export const sectionAccentColor: Record<StepCategory, string> = {
	warmup: '#0EA5E9',
	work: '#F97316',
	recovery: '#22C55E',
	cooldown: '#A855F7'
};

export const sectionHeaderText: Record<StepCategory, string> = {
	warmup: 'Warm Up',
	work: 'Main Set',
	recovery: 'Recovery',
	cooldown: 'Cool Down'
};

export const randomId = () => Math.random().toString(36).slice(2, 11);

export const normalizePaceSeconds = (value?: number | null) => {
	if (!value) return null;
	if (value > 30) return value;
	return Math.round(value * 60);
};

export const formatHms = (seconds: number | null | undefined) => {
	if (seconds == null || Number.isNaN(seconds)) return '';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const parseHms = (value: string): number => {
	const parts = value.split(':').map(Number);
	if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) return parts[0] * 60 + parts[1];
	const onlySeconds = Number(value);
	return Number.isFinite(onlySeconds) ? onlySeconds : 0;
};

export const formatPace = (secondsPerKm: number) => {
	const mins = Math.floor(secondsPerKm / 60);
	const secs = Math.round(secondsPerKm % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}/km`;
};

export const parsePaceInput = (value: string) => {
	const clean = value.trim().replace('/km', '');
	const parts = clean.split(':').map(Number);
	if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) return parts[0] * 60 + parts[1];
	const n = Number(clean);
	if (Number.isFinite(n)) return Math.round(n * 60);
	return 300;
};

export const formatSecondsHm = (seconds: number | null | undefined) => {
	if (seconds == null || Number.isNaN(seconds)) return '-';
	const totalMinutes = Math.max(0, Math.round(seconds / 60));
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${h}h ${m}m`;
};

export const powerZoneRows = (ftp?: number | null): ZoneRow[] => {
	const zones = [[1, 50, 55], [2, 56, 75], [3, 76, 90], [4, 91, 105], [5, 106, 120], [6, 121, 150], [7, 151, 200]] as const;
	return zones.map(([zone, low, high]) => ({
		zone,
		low,
		high,
		label: ftp ? `${Math.round((ftp * low) / 100)} - ${Math.round((ftp * high) / 100)} W` : `${low}-${high}%`
	}));
};

export const hrZoneRows = (maxHr?: number | null): ZoneRow[] => {
	const zones = [[1, 50, 60], [2, 61, 70], [3, 71, 80], [4, 81, 90], [5, 91, 100]] as const;
	return zones.map(([zone, low, high]) => ({
		zone,
		low,
		high,
		label: maxHr ? `${Math.round((maxHr * low) / 100)} - ${Math.round((maxHr * high) / 100)} bpm` : `${low}-${high}%`
	}));
};

export const paceZoneRows = (thresholdPace?: number | null): ZoneRow[] => {
	const thresholdSeconds = normalizePaceSeconds(thresholdPace);
	const zones = [[1, 120, 113], [2, 112, 106], [3, 105, 100], [4, 99, 94], [5, 93, 88], [6, 87, 82], [7, 81, 76]] as const;
	return zones.map(([zone, low, high]) => {
		if (!thresholdSeconds) return { zone, low, high, label: `${low}% - ${high}% threshold pace` };
		const slower = Math.round((thresholdSeconds * low) / 100);
		const faster = Math.round((thresholdSeconds * high) / 100);
		return { zone, low, high, label: `${formatPace(slower)} - ${formatPace(faster)}` };
	});
};

export const createDefaultTarget = (): TargetConfig => ({
	type: 'power',
	metric: 'percent_ftp',
	value: 75,
	unit: '%',
	zone: 2,
	min: 56,
	max: 75
});

export const createDefaultBlock = (category: StepCategory = 'work'): ConcreteStep => ({
	id: randomId(),
	type: 'block',
	category,
	duration: { type: 'time', value: 300 },
	target: createDefaultTarget()
});

export const createDefaultRepeat = (): RepeatStep => ({
	id: randomId(),
	type: 'repeat',
	repeats: 1,
	steps: [createDefaultBlock('work'), createDefaultBlock('recovery')]
});

export const createStarterPreset = (preset: 'endurance' | 'intervals' | 'recovery'): WorkoutNode[] => {
	if (preset === 'intervals') {
		return [
			createDefaultBlock('warmup'),
			{ id: randomId(), type: 'repeat', repeats: 5, steps: [{ ...createDefaultBlock('work'), duration: { type: 'time', value: 180 }, target: { ...createDefaultTarget(), value: 110, zone: 5, min: 106, max: 120 } }, { ...createDefaultBlock('recovery'), duration: { type: 'time', value: 120 }, target: { ...createDefaultTarget(), value: 62, zone: 2, min: 56, max: 75 } }] } as RepeatStep,
			createDefaultBlock('cooldown')
		];
	}
	if (preset === 'recovery') {
		return [
			{ ...createDefaultBlock('warmup'), duration: { type: 'time', value: 300 }, target: { ...createDefaultTarget(), value: 52, zone: 1, min: 50, max: 55 } },
			{ ...createDefaultBlock('work'), duration: { type: 'time', value: 1800 }, target: { ...createDefaultTarget(), value: 60, zone: 2, min: 56, max: 75 } },
			{ ...createDefaultBlock('cooldown'), duration: { type: 'time', value: 300 }, target: { ...createDefaultTarget(), value: 52, zone: 1, min: 50, max: 55 } }
		];
	}
	return [
		{ ...createDefaultBlock('warmup'), duration: { type: 'time', value: 600 }, target: { ...createDefaultTarget(), value: 70, zone: 2, min: 56, max: 75 } },
		{ ...createDefaultBlock('work'), duration: { type: 'time', value: 2400 }, target: { ...createDefaultTarget(), value: 85, zone: 3, min: 76, max: 90 } },
		{ ...createDefaultBlock('cooldown'), duration: { type: 'time', value: 600 }, target: { ...createDefaultTarget(), value: 65, zone: 2, min: 56, max: 75 } }
	];
};

export const estimateTotals = (nodes: WorkoutNode[]) => {
	let totalSeconds = 0;
	let totalDistanceKm = 0;
	const visit = (node: WorkoutNode, multiplier = 1) => {
		if (node.type === 'repeat') {
			node.steps.forEach((step) => visit(step, multiplier * node.repeats));
			return;
		}
		const durationValue = node.duration.value || 0;
		const totalDuration = durationValue * multiplier;
		if (node.duration.type === 'time') totalSeconds += totalDuration;
		if (node.duration.type === 'distance') totalDistanceKm += totalDuration / 1000;
	};
	nodes.forEach((node) => visit(node));
	return { totalSeconds, totalDistanceKm };
};

export const flattenBlocks = (nodes: WorkoutNode[]): ConcreteStep[] => {
	const blocks: ConcreteStep[] = [];
	nodes.forEach((node) => {
		if (node.type === 'repeat') {
			for (let i = 0; i < node.repeats; i += 1) blocks.push(...flattenBlocks(node.steps));
		} else {
			blocks.push(node);
		}
	});
	return blocks;
};

export const nodeCategory = (node: WorkoutNode): StepCategory => (node.type === 'block' ? node.category : 'work');

export const inferIntensityZone = (step: ConcreteStep) => {
	if (step.target.zone) return step.target.zone;
	const metricValue = step.target.value || step.target.max || 70;
	if (metricValue <= 55) return 1;
	if (metricValue <= 75) return 2;
	if (metricValue <= 90) return 3;
	if (metricValue <= 105) return 4;
	if (metricValue <= 120) return 5;
	return 6;
};

export const edgeColorFromZone = (zone: number) => {
	if (zone <= 1) return 'var(--mantine-color-gray-5)';
	if (zone === 2) return 'var(--mantine-color-green-5)';
	if (zone >= 6) return 'var(--mantine-color-violet-6)';
	if (zone >= 4) return 'var(--mantine-color-orange-5)';
	return 'var(--mantine-color-yellow-5)';
};

export const intensityPercentForStep = (step: ConcreteStep) => {
	const metric = (step.target.metric as IntensityMetric | undefined) || 'percent_ftp';
	const metricValue = step.target.value || step.target.max || 70;
	if (metric === 'percent_ftp' || metric === 'percent_max_hr' || metric === 'percent_lthr' || metric === 'percent_threshold_pace') {
		return Math.max(30, Math.min(140, metricValue));
	}
	if (metric === 'watts' || metric === 'np') {
		return Math.max(30, Math.min(140, metricValue));
	}
	const zone = inferIntensityZone(step);
	if (zone) return Math.min(140, Math.max(35, zone * 20));
	if (metric === 'rpe_scale') return ((step.target.value || 5) / 10) * 100;
	return Math.max(30, Math.min(140, metricValue));
};

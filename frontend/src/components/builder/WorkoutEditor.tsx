import React, { useMemo, useState } from 'react';
import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Card,
	Group,
	Menu,
	NumberInput,
	Paper,
	Select,
	Stack,
	Table,
	Text,
	TextInput,
	Textarea
} from '@mantine/core';
import { ChevronDown, ChevronRight, Clock3, GripVertical, Info, Minus, Plus, Route, Rows3, Trash2, Zap } from 'lucide-react';
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ConcreteStep, RepeatStep, StepCategory, TargetConfig, TargetType, WorkoutNode } from '../../types/workout';

interface WorkoutEditorProps {
	structure: WorkoutNode[];
	onChange: (structure: WorkoutNode[]) => void;
	sportType?: string;
	workoutName?: string;
	description?: string;
	intensityType?: string;
	onWorkoutNameChange?: (value: string) => void;
	onDescriptionChange?: (value: string) => void;
	onIntensityTypeChange?: (value: string) => void;
	onSportTypeChange?: (value: string) => void;
	athleteName?: string;
	athleteProfile?: {
		ftp?: number | null;
		lt2?: number | null;
		max_hr?: number | null;
		resting_hr?: number | null;
		weight?: number | null;
	};
}

interface DragHandleProps {
	attributes?: Record<string, any>;
	listeners?: Record<string, any>;
	setActivatorNodeRef: (element: HTMLElement | null) => void;
	isDragging: boolean;
}

type ZoneRow = { zone: number; low: number; high: number; label: string };
type IntensityMetric =
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

const durationTypeOptions = [
	{ value: 'time', label: 'Time' },
	{ value: 'distance', label: 'Distance' },
	{ value: 'lap_button', label: 'Lap Button' },
	{ value: 'calories', label: 'Calories' }
];

const intensityTypeOptions = ['Custom', 'Power-focused', 'Heart Rate-focused', 'Pace-focused', 'RPE-focused'];

const metricOptions: Array<{ group: string; items: Array<{ value: IntensityMetric; label: string }> }> = [
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

const metricMeta: Record<IntensityMetric, { targetType: TargetType; defaultUnit: string }> = {
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

const sectionHeaderTint: Record<StepCategory, string> = {
	warmup: 'rgba(99, 102, 241, 0.08)',
	work: 'rgba(244, 63, 94, 0.08)',
	recovery: 'rgba(56, 189, 248, 0.08)',
	cooldown: 'rgba(167, 139, 250, 0.08)'
};

const sectionHeaderText: Record<StepCategory, string> = {
	warmup: 'Warm Up',
	work: 'Main Set',
	recovery: 'Main Set',
	cooldown: 'Cool Down'
};

const randomId = () => Math.random().toString(36).slice(2, 11);

const normalizePaceSeconds = (value?: number | null) => {
	if (!value) return null;
	if (value > 30) return value;
	return Math.round(value * 60);
};

const formatHms = (seconds: number | null | undefined) => {
	if (seconds == null || Number.isNaN(seconds)) return '';
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const parseHms = (value: string): number => {
	const parts = value.split(':').map(Number);
	if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) return parts[0] * 60 + parts[1];
	const onlySeconds = Number(value);
	return Number.isFinite(onlySeconds) ? onlySeconds : 0;
};

const formatPace = (secondsPerKm: number) => {
	const mins = Math.floor(secondsPerKm / 60);
	const secs = Math.round(secondsPerKm % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}/km`;
};

const parsePaceInput = (value: string) => {
	const clean = value.trim().replace('/km', '');
	const parts = clean.split(':').map(Number);
	if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) return parts[0] * 60 + parts[1];
	const n = Number(clean);
	if (Number.isFinite(n)) return Math.round(n * 60);
	return 300;
};

const formatSecondsHm = (seconds: number | null | undefined) => {
	if (seconds == null || Number.isNaN(seconds)) return '-';
	const totalMinutes = Math.max(0, Math.round(seconds / 60));
	const h = Math.floor(totalMinutes / 60);
	const m = totalMinutes % 60;
	return `${h}h ${m}m`;
};

const powerZoneRows = (ftp?: number | null): ZoneRow[] => {
	const zones = [[1, 50, 55], [2, 56, 75], [3, 76, 90], [4, 91, 105], [5, 106, 120], [6, 121, 150], [7, 151, 200]] as const;
	return zones.map(([zone, low, high]) => ({
		zone,
		low,
		high,
		label: ftp ? `${Math.round((ftp * low) / 100)} - ${Math.round((ftp * high) / 100)} W` : `${low}-${high}%`
	}));
};

const hrZoneRows = (maxHr?: number | null): ZoneRow[] => {
	const zones = [[1, 50, 60], [2, 61, 70], [3, 71, 80], [4, 81, 90], [5, 91, 100]] as const;
	return zones.map(([zone, low, high]) => ({
		zone,
		low,
		high,
		label: maxHr ? `${Math.round((maxHr * low) / 100)} - ${Math.round((maxHr * high) / 100)} bpm` : `${low}-${high}%`
	}));
};

const paceZoneRows = (thresholdPace?: number | null): ZoneRow[] => {
	const thresholdSeconds = normalizePaceSeconds(thresholdPace);
	const zones = [[1, 120, 113], [2, 112, 106], [3, 105, 100], [4, 99, 94], [5, 93, 88], [6, 87, 82], [7, 81, 76]] as const;
	return zones.map(([zone, low, high]) => {
		if (!thresholdSeconds) return { zone, low, high, label: `${low}% - ${high}% threshold pace` };
		const slower = Math.round((thresholdSeconds * low) / 100);
		const faster = Math.round((thresholdSeconds * high) / 100);
		return { zone, low, high, label: `${formatPace(slower)} - ${formatPace(faster)}` };
	});
};

const createDefaultTarget = (): TargetConfig => ({
	type: 'power',
	metric: 'percent_ftp',
	value: 75,
	unit: '%',
	zone: 2,
	min: 56,
	max: 75
});

const createDefaultBlock = (category: StepCategory = 'work'): ConcreteStep => ({
	id: randomId(),
	type: 'block',
	category,
	duration: { type: 'time', value: 300 },
	target: createDefaultTarget()
});

const createDefaultRepeat = (): RepeatStep => ({
	id: randomId(),
	type: 'repeat',
	repeats: 1,
	steps: [createDefaultBlock('work'), createDefaultBlock('recovery')]
});

const createStarterPreset = (preset: 'endurance' | 'intervals' | 'recovery'): WorkoutNode[] => {
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

const estimateTotals = (nodes: WorkoutNode[]) => {
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

const flattenBlocks = (nodes: WorkoutNode[]): ConcreteStep[] => {
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

const nodeCategory = (node: WorkoutNode): StepCategory => (node.type === 'block' ? node.category : 'work');

const inferIntensityZone = (step: ConcreteStep) => {
	if (step.target.zone) return step.target.zone;
	const metricValue = step.target.value || step.target.max || 70;
	if (metricValue <= 55) return 1;
	if (metricValue <= 75) return 2;
	if (metricValue <= 90) return 3;
	if (metricValue <= 105) return 4;
	if (metricValue <= 120) return 5;
	return 6;
};

const edgeColorFromZone = (zone: number) => {
	if (zone <= 1) return 'var(--mantine-color-blue-4)';
	if (zone === 2) return 'var(--mantine-color-green-5)';
	if (zone >= 6) return 'var(--mantine-color-violet-6)';
	if (zone >= 4) return 'var(--mantine-color-orange-5)';
	return 'var(--mantine-color-yellow-5)';
};

const intensityPercentForStep = (step: ConcreteStep) => {
	const metric = (step.target.metric as IntensityMetric | undefined) || 'percent_ftp';
	const zone = inferIntensityZone(step);
	if (zone) return Math.min(140, Math.max(35, zone * 20));
	if (metric === 'rpe_scale') return ((step.target.value || 5) / 10) * 100;
	return Math.max(30, Math.min(140, step.target.value || step.target.max || 70));
};

const SortableRootItem = ({ id, children }: { id: string; children: (dragHandle: DragHandleProps) => React.ReactNode }) => {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
	return (
		<Box ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition: transition || 'transform 220ms cubic-bezier(0.2, 0, 0, 1)', zIndex: isDragging ? 12 : 1 }}>
			{children({ attributes, listeners, setActivatorNodeRef, isDragging })}
		</Box>
	);
};

export const WorkoutEditor = ({
	structure,
	onChange,
	sportType,
	workoutName,
	description,
	intensityType,
	onWorkoutNameChange,
	onDescriptionChange,
	onIntensityTypeChange,
	onSportTypeChange,
	athleteName,
	athleteProfile
}: WorkoutEditorProps) => {
	const totals = useMemo(() => estimateTotals(structure), [structure]);
	const blocks = useMemo(() => flattenBlocks(structure), [structure]);
	const [zoneView, setZoneView] = useState<'power' | 'heart_rate_zone' | 'pace'>('power');
	const [activeStepId, setActiveStepId] = useState<string | null>(null);
	const [collapsedSections, setCollapsedSections] = useState<Record<StepCategory, boolean>>({ warmup: false, work: false, recovery: false, cooldown: false });
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
	const normalizedSport = sportType?.toLowerCase().includes('run') ? 'running' : 'cycling';
	const pZones = useMemo(() => powerZoneRows(athleteProfile?.ftp), [athleteProfile?.ftp]);
	const hZones = useMemo(() => hrZoneRows(athleteProfile?.max_hr), [athleteProfile?.max_hr]);
	const paceZones = useMemo(() => paceZoneRows(athleteProfile?.lt2), [athleteProfile?.lt2]);

	const availableZoneViews = normalizedSport === 'running'
		? [{ value: 'heart_rate_zone', label: 'Heart Rate Zones' }, { value: 'pace', label: 'Pace Zones' }]
		: [{ value: 'power', label: 'Power Zones' }, { value: 'heart_rate_zone', label: 'Heart Rate Zones' }];

	const effectiveZoneView = availableZoneViews.some((item) => item.value === zoneView)
		? zoneView
		: (availableZoneViews[0].value as 'power' | 'heart_rate_zone' | 'pace');

	const updateNodeAt = (nodes: WorkoutNode[], index: number, next: WorkoutNode) => nodes.map((node, i) => (i === index ? next : node));
	const removeNodeAt = (nodes: WorkoutNode[], index: number) => nodes.filter((_, i) => i !== index);

	const updateStepById = (nodes: WorkoutNode[], id: string, updater: (step: ConcreteStep) => ConcreteStep): WorkoutNode[] => {
		return nodes.map((node) => {
			if (node.type === 'repeat') return { ...node, steps: updateStepById(node.steps, id, updater) };
			if (node.id === id) return updater(node);
			return node;
		});
	};

	const addNode = (node: WorkoutNode) => onChange([...structure, node]);

	const onRootDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const oldIndex = structure.findIndex((node) => node.id === String(active.id));
		const newIndex = structure.findIndex((node) => node.id === String(over.id));
		if (oldIndex < 0 || newIndex < 0) return;
		onChange(arrayMove(structure, oldIndex, newIndex));
	};

	const absoluteHint = (target: TargetConfig) => {
		const metric = (target.metric as IntensityMetric | undefined) || 'percent_ftp';
		const pct = target.value || target.max || 0;
		if (metric === 'percent_ftp' && athleteProfile?.ftp) return `${Math.round((athleteProfile.ftp * pct) / 100)}W`;
		if ((metric === 'percent_max_hr' || metric === 'percent_lthr') && athleteProfile?.max_hr) return `${Math.round((athleteProfile.max_hr * pct) / 100)}bpm`;
		if (metric === 'percent_threshold_pace' && athleteProfile?.lt2) {
			const thresholdSeconds = normalizePaceSeconds(athleteProfile.lt2) || 0;
			return formatPace(Math.round((thresholdSeconds * pct) / 100));
		}
		if (metric === 'wkg' && athleteProfile?.weight && target.value) return `${Math.round(target.value * athleteProfile.weight)}W`;
		if ((metric === 'watts' || metric === 'np') && target.value) return `${Math.round(target.value)}W`;
		return null;
	};

	const applyZoneToCurrentStep = (row: ZoneRow) => {
		if (!activeStepId) return;
		const metric: IntensityMetric = effectiveZoneView === 'power' ? 'percent_ftp' : effectiveZoneView === 'pace' ? 'percent_threshold_pace' : 'hr_zone';
		onChange(
			updateStepById(structure, activeStepId, (step) => ({
				...step,
				target: {
					...step.target,
					type: effectiveZoneView,
					metric,
					zone: row.zone,
					min: row.low,
					max: row.high,
					value: Math.round((row.low + row.high) / 2),
					unit: metricMeta[metric].defaultUnit
				}
			}))
		);
	};

	const profileBars = useMemo(() => {
		if (!blocks.length) return [] as Array<{ width: number; height: number; color: string; x: number }>;
		const durations = blocks.map((step) => (step.duration.type === 'time' ? Math.max(60, step.duration.value || 0) : 300));
		const total = durations.reduce((acc, item) => acc + item, 0);
		let cursor = 0;
		return blocks.map((step, index) => {
			const width = (durations[index] / total) * 600;
			const level = intensityPercentForStep(step);
			const barHeight = Math.max(0.2, Math.min(1, level / 140)) * 82;
			const zone = inferIntensityZone(step);
			const out = { width, height: barHeight, color: edgeColorFromZone(zone), x: cursor };
			cursor += width;
			return out;
		});
	}, [blocks]);

	const renderMetricInput = (step: ConcreteStep, update: (next: ConcreteStep) => void) => {
		const metric = (step.target.metric as IntensityMetric | undefined) || 'percent_ftp';
		const hint = absoluteHint(step.target);
		if (metric === 'hr_zone') {
			return (
				<Select
					size="xs"
					w={120}
					value={String(step.target.zone || 2)}
					data={[1, 2, 3, 4, 5].map((zone) => ({ value: String(zone), label: `Z${zone}` }))}
					onChange={(value) => {
						if (!value) return;
						const row = hZones.find((item) => item.zone === Number(value));
						update({ ...step, target: { ...step.target, zone: Number(value), min: row?.low, max: row?.high, value: row ? Math.round((row.low + row.high) / 2) : step.target.value } });
					}}
				/>
			);
		}
		if (metric === 'pace_min_km' || metric === 'goal_race_pace') {
			return (
				<TextInput
					size="xs"
					w={120}
					defaultValue={formatPace(step.target.value || 300)}
					onBlur={(event) => update({ ...step, target: { ...step.target, value: parsePaceInput(event.currentTarget.value), unit: 'min/km' } })}
				/>
			);
		}
		if (metric === 'rpe_scale') {
			return (
				<NumberInput
					size="xs"
					w={108}
					min={1}
					max={10}
					value={step.target.value || 5}
					onChange={(value) => {
						const numeric = typeof value === 'number' ? value : Number(value || 5);
						update({ ...step, target: { ...step.target, value: Math.max(1, Math.min(10, numeric)), unit: 'RPE' } });
					}}
				/>
			);
		}
		return (
			<Group gap={6} align="center">
				<NumberInput
					size="xs"
					w={98}
					value={step.target.value || step.target.max || 75}
					onChange={(value) => {
						const numeric = typeof value === 'number' ? value : Number(value || 0);
						update({ ...step, target: { ...step.target, value: numeric } });
					}}
				/>
				<Text size="xs" c="dimmed">{step.target.unit || metricMeta[metric].defaultUnit}</Text>
				{hint && (
					<Badge radius={4} variant="light" style={{ background: 'rgba(244, 63, 94, 0.12)', color: 'var(--mantine-color-dark-8)' }}>
						Target: {hint}
					</Badge>
				)}
			</Group>
		);
	};

	const renderConcrete = (step: ConcreteStep, index: number, nodes: WorkoutNode[], onNodesChange: (nextNodes: WorkoutNode[]) => void, dragHandle?: DragHandleProps) => {
		const zoneValue = inferIntensityZone(step);
		const isActive = activeStepId === step.id;
		return (
			<Paper
				key={step.id}
				withBorder
				p="sm"
				radius={4}
				bg="var(--mantine-color-default)"
				onClick={() => setActiveStepId(step.id)}
				style={{ border: '1px solid #0F172A', borderLeft: `8px solid ${edgeColorFromZone(zoneValue)}`, boxShadow: isActive ? '0 0 0 2px rgba(244, 63, 94, 0.2)' : undefined, transition: 'box-shadow 160ms ease, transform 120ms ease' }}
			>
				<Stack gap="sm">
					<Group justify="space-between" align="center">
						<Group gap="xs" align="center">
							<Box
								ref={dragHandle?.setActivatorNodeRef}
								{...(dragHandle?.attributes || {})}
								{...(dragHandle?.listeners || {})}
								style={{ width: 18, height: 24, borderRadius: 4, cursor: dragHandle ? 'grab' : 'default', border: '1px solid var(--mantine-color-gray-4)', background: 'repeating-linear-gradient(180deg, var(--mantine-color-gray-4), var(--mantine-color-gray-4) 2px, transparent 2px, transparent 4px)' }}
							>
								<GripVertical size={12} style={{ margin: 5, color: 'var(--mantine-color-gray-6)' }} />
							</Box>
							<Rows3 size={14} color="var(--mantine-color-gray-6)" />
							<Select
								size="xs"
								variant="unstyled"
								value={step.category}
								data={[{ value: 'warmup', label: 'Warm Up' }, { value: 'work', label: 'Main Set' }, { value: 'recovery', label: 'Recovery' }, { value: 'cooldown', label: 'Cool Down' }]}
								onChange={(value) => value && onNodesChange(updateNodeAt(nodes, index, { ...step, category: value as StepCategory }))}
								w={120}
							/>
						</Group>
						<ActionIcon variant="subtle" color="red" onClick={() => onNodesChange(removeNodeAt(nodes, index))}>
							<Trash2 size={16} />
						</ActionIcon>
					</Group>

					<Group gap="sm" wrap="wrap" align="center">
						<Group gap={4} align="center">
							<Clock3 size={14} color="var(--mantine-color-gray-6)" />
							<Select
								size="xs"
								w={96}
								value={step.duration.type}
								data={durationTypeOptions}
								onChange={(value) => {
									if (!value) return;
									onNodesChange(updateNodeAt(nodes, index, { ...step, duration: { ...step.duration, type: value as any, value: value === 'lap_button' ? null : step.duration.value || 300 } }));
								}}
							/>
						</Group>

						{step.duration.type === 'time' && <TextInput size="xs" w={112} value={formatHms(step.duration.value)} onBlur={(event) => onNodesChange(updateNodeAt(nodes, index, { ...step, duration: { ...step.duration, value: parseHms(event.currentTarget.value) } }))} />}
						{step.duration.type === 'distance' && (
							<Group gap={4} align="center">
								<Route size={14} color="var(--mantine-color-gray-6)" />
								<NumberInput size="xs" w={120} value={step.duration.value || 0} onChange={(value) => onNodesChange(updateNodeAt(nodes, index, { ...step, duration: { ...step.duration, value: typeof value === 'number' ? value : Number(value || 0) } }))} suffix=" m" />
							</Group>
						)}

						<Group gap={4} align="center">
							<Zap size={14} color="var(--mantine-color-gray-6)" />
							<Select
								size="xs"
								w={220}
								placeholder="Intensity & target"
								value={(step.target.metric as string) || 'percent_ftp'}
								data={metricOptions}
								onChange={(value) => {
									if (!value) return;
									const metric = value as IntensityMetric;
									onNodesChange(updateNodeAt(nodes, index, { ...step, target: { ...step.target, type: metricMeta[metric].targetType, metric, unit: metricMeta[metric].defaultUnit, value: metric === 'rpe_scale' ? 6 : metric === 'hr_zone' ? 3 : step.target.value || 75 } }));
								}}
							/>
						</Group>
						{renderMetricInput(step, (nextStep) => onNodesChange(updateNodeAt(nodes, index, nextStep)))}
					</Group>
				</Stack>
			</Paper>
		);
	};

	const renderNode = (node: WorkoutNode, index: number, nodes: WorkoutNode[], onNodesChange: (nextNodes: WorkoutNode[]) => void, dragHandle?: DragHandleProps): React.ReactNode => {
		if (node.type === 'repeat') {
			return (
				<Paper key={node.id} withBorder p="sm" radius={4} bg="var(--mantine-color-default)" style={{ border: '1px solid #0F172A', borderLeft: '8px solid var(--mantine-color-violet-5)' }}>
					<Stack gap="sm">
						<Group justify="space-between" align="center">
							<Group gap="xs" align="center">
								<ActionIcon variant="subtle" color="gray" size="sm" style={{ cursor: dragHandle ? 'grab' : 'default' }} ref={dragHandle?.setActivatorNodeRef} {...(dragHandle?.attributes || {})} {...(dragHandle?.listeners || {})}>
									<GripVertical size={15} />
								</ActionIcon>
								<Text size="sm" fw={600}>Repeat Block</Text>
							</Group>
							<Group gap="xs">
								<ActionIcon variant="light" onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, repeats: Math.max(1, node.repeats - 1) }))}><Minus size={14} /></ActionIcon>
								<Badge color="dark" variant="filled">{node.repeats}</Badge>
								<ActionIcon variant="light" onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, repeats: node.repeats + 1 }))}><Plus size={14} /></ActionIcon>
								<ActionIcon variant="subtle" color="red" onClick={() => onNodesChange(removeNodeAt(nodes, index))}><Trash2 size={16} /></ActionIcon>
							</Group>
						</Group>
						<Stack gap="xs">
							{node.steps.map((nestedNode, nestedIndex) => renderNode(nestedNode, nestedIndex, node.steps, (nextNestedSteps) => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: nextNestedSteps }))))}
						</Stack>
						<Group justify="flex-end">
							<Button size="xs" variant="subtle" leftSection={<Plus size={14} />} onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: [...node.steps, createDefaultBlock('work')] }))}>Add Step</Button>
						</Group>
					</Stack>
				</Paper>
			);
		}
		return renderConcrete(node, index, nodes, onNodesChange, dragHandle);
	};

	const sectionOrder: StepCategory[] = ['warmup', 'work', 'recovery', 'cooldown'];

	return (
		<Paper bg="var(--mantine-color-body)" p="md" radius={4} withBorder>
			<Group align="flex-start" wrap="wrap" gap="md">
				<Box style={{ flex: 1, minWidth: 0 }}>
					<Stack gap="md">
						<Group align="flex-start" grow wrap="wrap">
							<Stack gap="sm" style={{ flex: 1, minWidth: 280 }}>
								<Select label="Training Type" value={sportType?.toLowerCase().includes('run') ? 'Running' : 'Cycling'} data={[{ value: 'Running', label: '🏃 Run' }, { value: 'Cycling', label: '🚴 Ride' }]} onChange={(value) => value && onSportTypeChange?.(value)} />
								<TextInput label="Workout Name" placeholder="Please enter a name" value={workoutName || ''} onChange={(event) => onWorkoutNameChange?.(event.currentTarget.value)} />
								<Select label="Workout Type" value={intensityType || 'Custom'} data={intensityTypeOptions} onChange={(value) => value && onIntensityTypeChange?.(value)} />
							</Stack>
							<Box style={{ flex: 1, minWidth: 280 }}>
								<Textarea label="Coach Notes" placeholder="Key cues, intent, constraints" minRows={7} maxLength={200} value={description || ''} onChange={(event) => onDescriptionChange?.(event.currentTarget.value)} />
								<Group justify="flex-end" mt={4}><Text size="10px" c="dimmed">{(description || '').length}/200</Text></Group>
							</Box>
						</Group>

						<Group justify="space-between" align="center" mt={4}>
							<Group gap="xs"><Info size={14} color="var(--mantine-color-gray-6)" /><Text size="sm" c="dimmed">Select a block, then click a zone for instant fill.</Text></Group>
							<Menu shadow="md" width={180}>
								<Menu.Target><Button variant="light" size="xs" leftSection={<Plus size={14} />}>Add</Button></Menu.Target>
								<Menu.Dropdown>
									<Menu.Item onClick={() => addNode(createDefaultBlock('warmup'))}>Warm Up</Menu.Item>
									<Menu.Item onClick={() => addNode(createDefaultBlock('work'))}>Main Set</Menu.Item>
									<Menu.Item onClick={() => addNode(createDefaultBlock('recovery'))}>Recovery</Menu.Item>
									<Menu.Item onClick={() => addNode(createDefaultBlock('cooldown'))}>Cool Down</Menu.Item>
									<Menu.Item onClick={() => addNode(createDefaultRepeat())}>Repeat Block</Menu.Item>
								</Menu.Dropdown>
							</Menu>
						</Group>

						{structure.length === 0 ? (
							<Paper withBorder p="lg" bg="var(--mantine-color-default)" radius={4}>
								<Stack align="center" gap="xs">
									<Text c="dimmed" size="sm">No blocks yet</Text>
									<Menu shadow="md" width={220}>
										<Menu.Target><Button size="xs" variant="light">Create starter structure</Button></Menu.Target>
										<Menu.Dropdown>
											<Menu.Item onClick={() => onChange(createStarterPreset('endurance'))}>Endurance Base</Menu.Item>
											<Menu.Item onClick={() => onChange(createStarterPreset('intervals'))}>5x3 min Intervals</Menu.Item>
											<Menu.Item onClick={() => onChange(createStarterPreset('recovery'))}>Recovery Easy Day</Menu.Item>
										</Menu.Dropdown>
									</Menu>
								</Stack>
							</Paper>
						) : (
							<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onRootDragEnd}>
								<SortableContext items={structure.map((node) => node.id)} strategy={verticalListSortingStrategy}>
									<Stack gap="sm">
										{sectionOrder.map((section) => {
											const sectionNodes = structure.filter((node) => nodeCategory(node) === section);
											if (!sectionNodes.length) return null;
											return (
												<Paper key={`section-${section}`} radius={4} p="xs" withBorder style={{ background: sectionHeaderTint[section] }}>
													<Group justify="space-between" mb={6}>
														<Group gap={6}>
															<ActionIcon size="sm" variant="subtle" onClick={() => setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }))}>
																{collapsedSections[section] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
															</ActionIcon>
															<Text size="sm" fw={700}>{sectionHeaderText[section]}</Text>
														</Group>
														<Badge variant="light" radius={4}>{sectionNodes.length}</Badge>
													</Group>
													{!collapsedSections[section] && (
														<Stack gap="xs">
															{sectionNodes.map((node) => {
																const originalIndex = structure.findIndex((row) => row.id === node.id);
																return (
																	<SortableRootItem key={node.id} id={node.id}>
																		{(dragHandle) => renderNode(node, originalIndex, structure, onChange, dragHandle)}
																	</SortableRootItem>
																);
															})}
														</Stack>
													)}
												</Paper>
											);
										})}
									</Stack>
								</SortableContext>
							</DndContext>
						)}

						<Paper withBorder p="sm" bg="var(--mantine-color-default)" radius={4}>
							<Group justify="space-between" mb={6}>
								<Text size="sm">Estimate <Text span fw={700}>{formatSecondsHm(totals.totalSeconds)}</Text> <Text span fw={700}>{totals.totalDistanceKm.toFixed(2)} km</Text></Text>
								<Text size="xs" fw={600}>Structured Workout Preview</Text>
							</Group>
							<svg width="100%" viewBox="0 0 600 90" preserveAspectRatio="none" aria-label="Structured Workout Preview">
								<rect x="0" y="0" width="600" height="90" fill="var(--mantine-color-gray-0)" />
								{profileBars.map((bar, idx) => <rect key={`preview-${idx}`} x={bar.x} y={90 - bar.height} width={Math.max(2, bar.width - 1)} height={bar.height} fill={bar.color} rx="2" />)}
							</svg>
						</Paper>
					</Stack>
				</Box>

				<Box style={{ flex: '1 1 320px', minWidth: 280, maxWidth: 360, width: '100%' }}>
					<Card withBorder padding="sm" radius={4} bg="var(--mantine-color-default)" style={{ position: 'sticky', top: 12, boxShadow: '0 8px 20px rgba(15, 23, 42, 0.08)' }}>
						<Stack gap={8}>
							<Group justify="space-between"><Text fw={700} size="sm">Athlete Statistics</Text><Text size="xs" c="dimmed">{athleteName || 'Selected athlete'}</Text></Group>
							<Group gap="xs" wrap="wrap">
								{normalizedSport === 'cycling' && <Badge variant="filled" radius={4} style={{ background: 'var(--mantine-color-pink-6)' }}>FTP: {athleteProfile?.ftp ?? '-'}</Badge>}
								{normalizedSport === 'running' && <Badge variant="light" color="teal">LT2: {athleteProfile?.lt2 ? `${athleteProfile.lt2.toFixed(2)} min/km` : '-'}</Badge>}
								<Badge variant="filled" radius={4} style={{ background: 'var(--mantine-color-orange-6)' }}>Max HR: {athleteProfile?.max_hr ?? '-'}</Badge>
								<Badge variant="light" color="gray">Weight: {athleteProfile?.weight ?? '-'} kg</Badge>
							</Group>
							<Group justify="space-between" align="center" mt={2}>
								<Text size="xs" fw={700}>Zone Type</Text>
								<Select size="xs" w={190} value={effectiveZoneView} data={availableZoneViews} onChange={(value) => value && setZoneView(value as 'power' | 'heart_rate_zone' | 'pace')} />
							</Group>
							<Box>
								<Text size="xs" fw={700} mb={4}>{effectiveZoneView === 'power' ? 'Power Zones' : effectiveZoneView === 'pace' ? 'Pace Zones' : 'Heart Rate Zones'}</Text>
								<Table withTableBorder withColumnBorders horizontalSpacing="xs" verticalSpacing={4}>
									<Table.Tbody>
										{(effectiveZoneView === 'power' ? pZones : effectiveZoneView === 'pace' ? paceZones : hZones).map((row) => (
											<Table.Tr key={`${effectiveZoneView}-${row.zone}`} onClick={() => applyZoneToCurrentStep(row)} style={{ cursor: activeStepId ? 'pointer' : 'not-allowed', background: activeStepId ? 'rgba(244, 63, 94, 0.06)' : undefined }}>
												<Table.Td><Text size="10px" fw={700}>Z{row.zone}</Text></Table.Td>
												<Table.Td><Text size="10px">{row.label}</Text></Table.Td>
											</Table.Tr>
										))}
									</Table.Tbody>
								</Table>
								<Text size="10px" c="dimmed" mt={4}>{activeStepId ? 'Click a zone to apply it to the selected block.' : 'Select a workout block, then click a zone to populate intensity.'}</Text>
							</Box>
						</Stack>
					</Card>
				</Box>
			</Group>
		</Paper>
	);
};


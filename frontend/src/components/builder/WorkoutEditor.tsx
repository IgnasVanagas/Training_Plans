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
	Textarea,
	useComputedColorScheme
} from '@mantine/core';
import { Clock3, GripVertical, Info, Minus, Plus, Route, Rows3, Trash2, Zap } from 'lucide-react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, closestCenter, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ConcreteStep, StepCategory, TargetConfig, WorkoutNode } from '../../types/workout';
import { createDefaultBlock, createDefaultRepeat, createStarterPreset, createZoneBlock, durationTypeOptions, edgeColorFromZone, estimateTotals, flattenBlocks, formatHms, formatPace, formatSecondsHm, hrZoneRanges, hrZoneRows, inferIntensityZone, intensityPercentForStep, intensityTypeOptions, metricMeta, metricOptions, normalizePaceSeconds, paceZoneRows, parseHms, parsePaceInput, powerZoneRanges, powerZoneRows, randomId, sectionAccentColor, sectionHeaderText, type IntensityMetric, type ZoneRow } from './workoutEditorUtils';

import type { Modifier } from '@dnd-kit/core';
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

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

const SortableRootItem = ({ id, children }: { id: string; children: (dragHandle: DragHandleProps) => React.ReactNode }) => {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
	const smoothTransform = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;
	return (
		<Box ref={setNodeRef} style={{
			transform: CSS.Transform.toString(smoothTransform),
			transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
			zIndex: isDragging ? 12 : 1,
			opacity: isDragging ? 0.4 : 1,
		}}>
			{children({ attributes, listeners, setActivatorNodeRef, isDragging })}
		</Box>
	);
};

const RepeatDropZone = ({ repeatId, isDark }: { repeatId: string; isDark: boolean }) => {
	const { setNodeRef, isOver } = useDroppable({ id: `repeat-dropzone-${repeatId}` });
	return (
		<Box
			ref={setNodeRef}
			style={{
				minHeight: 28,
				borderRadius: 8,
				border: `2px dashed ${isOver ? '#6E4BF3' : 'rgba(148, 163, 184, 0.25)'}`,
				background: isOver ? 'rgba(110, 75, 243, 0.08)' : 'transparent',
				transition: 'all 200ms ease',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<Text size="xs" c="dimmed">{isOver ? 'Drop here' : 'Drag items here'}</Text>
		</Box>
	);
};

const RootDropZone = ({ isDark }: { isDark: boolean }) => {
	const { setNodeRef, isOver } = useDroppable({ id: 'root-dropzone' });
	return (
		<Box
			ref={setNodeRef}
			style={{
				minHeight: 28,
				borderRadius: 8,
				border: `2px dashed ${isOver ? '#E95A12' : 'rgba(148, 163, 184, 0.2)'}`,
				background: isOver ? 'rgba(233, 90, 18, 0.06)' : 'transparent',
				transition: 'all 200ms ease',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<Text size="xs" c="dimmed">{isOver ? 'Drop here' : 'Drop here to move to root'}</Text>
		</Box>
	);
};

const findNodeById = (nodes: WorkoutNode[], id: string): WorkoutNode | null => {
	for (const node of nodes) {
		if (node.id === id) return node;
		if (node.type === 'repeat') {
			const found = findNodeById(node.steps, id);
			if (found) return found;
		}
	}
	return null;
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
	const isDark = useComputedColorScheme('light') === 'dark';
	const panelBg = isDark ? 'rgba(8, 18, 38, 0.72)' : 'rgba(255, 255, 255, 0.9)';
	const cardBg = isDark ? 'rgba(22, 34, 58, 0.62)' : 'rgba(255, 255, 255, 0.92)';
	const cardBorder = isDark ? 'rgba(148, 163, 184, 0.26)' : 'rgba(15, 23, 42, 0.14)';
	const accentPrimary = '#E95A12';
	const accentSecondary = '#6E4BF3';
	const textDim = isDark ? '#94A3B8' : '#475569';
	const totals = useMemo(() => estimateTotals(structure), [structure]);
	const blocks = useMemo(() => flattenBlocks(structure), [structure]);
	const allSortableIds = useMemo(() => {
		const ids: string[] = [];
		for (const node of structure) {
			ids.push(node.id);
			if (node.type === 'repeat') {
				for (const step of node.steps) ids.push(step.id);
			}
		}
		return ids;
	}, [structure]);
	const [zoneView, setZoneView] = useState<'power' | 'heart_rate_zone' | 'pace'>('power');
	const [activeStepId, setActiveStepId] = useState<string | null>(null);
	const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
	const [activeDragId, setActiveDragId] = useState<string | null>(null);
	const [hoveredBarIdx, setHoveredBarIdx] = useState<number | null>(null);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
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

	const applyDurationDraft = (
		step: ConcreteStep,
		nodes: WorkoutNode[],
		index: number,
		onNodesChange: (nextNodes: WorkoutNode[]) => void
	) => {
		const raw = (durationDrafts[step.id] ?? formatHms(step.duration.value)).trim();
		const parsed = Math.max(0, parseHms(raw));
		onNodesChange(updateNodeAt(nodes, index, { ...step, duration: { ...step.duration, value: parsed } }));
		setDurationDrafts((prev) => {
			const next = { ...prev };
			delete next[step.id];
			return next;
		});
	};

	const updateStepById = (nodes: WorkoutNode[], id: string, updater: (step: ConcreteStep) => ConcreteStep): WorkoutNode[] => {
		return nodes.map((node) => {
			if (node.type === 'repeat') return { ...node, steps: updateStepById(node.steps, id, updater) };
			if (node.id === id) return updater(node);
			return node;
		});
	};

	const addNode = (node: WorkoutNode) => onChange([...structure, node]);

	const onRootDragStart = (event: DragStartEvent) => setActiveDragId(String(event.active.id));

	const findContainer = (nodeId: string): { containerId: string; index: number } | null => {
		const rootIdx = structure.findIndex((n) => n.id === nodeId);
		if (rootIdx >= 0) return { containerId: 'root', index: rootIdx };
		for (const node of structure) {
			if (node.type === 'repeat') {
				const childIdx = node.steps.findIndex((s) => s.id === nodeId);
				if (childIdx >= 0) return { containerId: node.id, index: childIdx };
			}
		}
		return null;
	};

	const onUnifiedDragEnd = (event: DragEndEvent) => {
		setActiveDragId(null);
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		const activeId = String(active.id);
		const overId = String(over.id);

		// Check if dropping onto a repeat block's dropzone
		const dropzoneMatch = overId.match(/^repeat-dropzone-(.+)$/);
		const activeLocation = findContainer(activeId);
		if (!activeLocation) return;

		if (overId === 'root-dropzone') {
			if (activeLocation.containerId === 'root') return;
			const draggedNode = findNodeById(structure, activeId);
			if (!draggedNode) return;
			let next = structure.map((n) => {
				if (n.type === 'repeat' && n.id === activeLocation.containerId) {
					return { ...n, steps: n.steps.filter((s) => s.id !== activeId) };
				}
				return n;
			});
			next.push(draggedNode);
			onChange(next);
			return;
		}

		if (dropzoneMatch) {
			const repeatId = dropzoneMatch[1];
			const draggedNode = findNodeById(structure, activeId);
			if (!draggedNode) return;
			let next = structure.map((n) => {
				if (n.type === 'repeat' && n.id === activeLocation.containerId) {
					return { ...n, steps: n.steps.filter((s) => s.id !== activeId) };
				}
				return n;
			});
			if (activeLocation.containerId === 'root') {
				next = next.filter((n) => n.id !== activeId);
			}
			next = next.map((n) => {
				if (n.id === repeatId && n.type === 'repeat') {
					return { ...n, steps: [...n.steps, draggedNode] };
				}
				return n;
			});
			onChange(next);
			return;
		}

		const overLocation = findContainer(overId);
		if (!overLocation) return;

		if (activeLocation.containerId === overLocation.containerId) {
			// Same container reorder
			if (activeLocation.containerId === 'root') {
				const oldIdx = structure.findIndex((n) => n.id === activeId);
				const newIdx = structure.findIndex((n) => n.id === overId);
				if (oldIdx >= 0 && newIdx >= 0) onChange(arrayMove(structure, oldIdx, newIdx));
			} else {
				const repeat = structure.find((n) => n.id === activeLocation.containerId);
				if (!repeat || repeat.type !== 'repeat') return;
				const repeatIdx = structure.indexOf(repeat);
				const oldIdx = repeat.steps.findIndex((s) => s.id === activeId);
				const newIdx = repeat.steps.findIndex((s) => s.id === overId);
				if (oldIdx >= 0 && newIdx >= 0) {
					onChange(updateNodeAt(structure, repeatIdx, { ...repeat, steps: arrayMove(repeat.steps, oldIdx, newIdx) }));
				}
			}
		} else {
			// Cross-container move
			const draggedNode = findNodeById(structure, activeId);
			if (!draggedNode) return;
			let next = structure.map((n) => {
				if (n.type === 'repeat' && n.id === activeLocation.containerId) {
					return { ...n, steps: n.steps.filter((s) => s.id !== activeId) };
				}
				return n;
			});
			if (activeLocation.containerId === 'root') {
				next = next.filter((n) => n.id !== activeId);
			}
			if (overLocation.containerId === 'root') {
				const overIdx = next.findIndex((n) => n.id === overId);
				if (overIdx >= 0) {
					next.splice(overIdx, 0, draggedNode);
				} else {
					next.push(draggedNode);
				}
			} else {
				next = next.map((n) => {
					if (n.id === overLocation.containerId && n.type === 'repeat') {
						const overIdx = n.steps.findIndex((s) => s.id === overId);
						const newSteps = [...n.steps];
						newSteps.splice(overIdx >= 0 ? overIdx : newSteps.length, 0, draggedNode);
						return { ...n, steps: newSteps };
					}
					return n;
				});
			}
			onChange(next);
		}
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
		if (!blocks.length) return [] as Array<{ width: number; height: number; color: string; x: number; tooltip: string }>;
		const durations = blocks.map((step) => (step.duration.type === 'time' ? Math.max(60, step.duration.value || 0) : 300));
		const total = durations.reduce((acc, item) => acc + item, 0);
		let cursor = 0;
		return blocks.map((step, index) => {
			const width = (durations[index] / total) * 600;
			const level = intensityPercentForStep(step);
			const barHeight = Math.max(0.2, Math.min(1, level / 140)) * 110;
			const zone = inferIntensityZone(step);
			const durationText = step.duration.type === 'time' ? formatHms(step.duration.value) : step.duration.type === 'distance' ? `${step.duration.value || 0}m` : 'lap';
			const metric = (step.target.metric as IntensityMetric | undefined) || 'percent_ftp';
			const intensityText = metric === 'hr_zone' ? `Z${step.target.zone || '?'}` : `${step.target.value || step.target.max || '-'}${metricMeta[metric].defaultUnit}`;
			const tooltip = `${sectionHeaderText[step.category]} · ${durationText} · ${intensityText}`;
			const out = { width, height: barHeight, color: edgeColorFromZone(zone), x: cursor, tooltip };
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
		const categoryAccent = sectionAccentColor[step.category];
		return (
			<Paper
				key={step.id}
				withBorder
				p="sm"
				radius="md"
				bg={cardBg}
				onClick={() => setActiveStepId(step.id)}
				style={{ border: `1px solid ${cardBorder}`, borderLeft: `6px solid ${categoryAccent}`, boxShadow: isActive ? `0 0 0 2px ${isDark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(15, 23, 42, 0.12)'}` : undefined, transition: 'box-shadow 160ms ease, transform 120ms ease' }}
			>
				<Stack gap="sm">
					<Group justify="space-between" align="center">
						<Group gap="xs" align="center">
							<Box
								ref={dragHandle?.setActivatorNodeRef}
								{...(dragHandle?.attributes || {})}
								{...(dragHandle?.listeners || {})}
								style={{ width: 24, height: 28, borderRadius: 6, cursor: dragHandle ? 'grab' : 'default', border: `1px solid ${cardBorder}`, background: isDark ? 'rgba(51,65,85,0.7)' : 'rgba(241,245,249,0.95)' }}
							>
								<GripVertical size={14} style={{ margin: 7, color: textDim }} />
							</Box>
							<Rows3 size={14} color={textDim} />
							<Select
								size="xs"
								variant="unstyled"
								value={step.category}
								data={[{ value: 'warmup', label: 'Warm Up' }, { value: 'work', label: 'Training' }, { value: 'recovery', label: 'Recovery' }, { value: 'cooldown', label: 'Cool Down' }]}
								onChange={(value) => value && onNodesChange(updateNodeAt(nodes, index, { ...step, category: value as StepCategory }))}
								w={120}
							/>
							<Badge
								variant="light"
								radius={4}
								style={{ background: isDark ? `${categoryAccent}2E` : `${categoryAccent}1F`, color: isDark ? '#E2E8F0' : '#0F172A' }}
							>
								{sectionHeaderText[step.category]}
							</Badge>
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

						{step.duration.type === 'time' && (
							<Group gap={4} align="center">
								<TextInput
									size="xs"
									w={130}
									value={durationDrafts[step.id] ?? formatHms(step.duration.value)}
									onFocus={() => setDurationDrafts((prev) => ({ ...prev, [step.id]: durationDrafts[step.id] ?? formatHms(step.duration.value) }))}
									onChange={(event) => setDurationDrafts((prev) => ({ ...prev, [step.id]: event.currentTarget.value }))}
									onKeyDown={(event) => {
										if (event.key === 'Enter') {
											event.preventDefault();
											applyDurationDraft(step, nodes, index, onNodesChange);
										}
									}}
									onBlur={() => applyDurationDraft(step, nodes, index, onNodesChange)}
									placeholder="HH:MM:SS"
								/>
								<ActionIcon
									size="sm"
									variant="subtle"
									onClick={() =>
										onNodesChange(
											updateNodeAt(nodes, index, {
												...step,
												duration: { ...step.duration, value: Math.max(0, (step.duration.value || 0) - 60) }
											})
										)
									}
									title="Decrease 1 minute"
								>
									<Minus size={14} />
								</ActionIcon>
								<ActionIcon
									size="sm"
									variant="subtle"
									onClick={() =>
										onNodesChange(
											updateNodeAt(nodes, index, {
												...step,
												duration: { ...step.duration, value: (step.duration.value || 0) + 60 }
											})
										)
									}
									title="Increase 1 minute"
								>
									<Plus size={14} />
								</ActionIcon>
							</Group>
						)}
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

	const renderRepeatBlock = (node: WorkoutNode & { type: 'repeat' }, index: number, nodes: WorkoutNode[], onNodesChange: (nextNodes: WorkoutNode[]) => void, dragHandle?: DragHandleProps): React.ReactNode => {
		return (
			<Paper key={node.id} withBorder p="sm" radius="md" bg={cardBg} style={{ border: `1px solid ${cardBorder}`, borderLeft: `6px solid ${accentSecondary}` }}>
				<Stack gap="sm">
					<Group justify="space-between" align="center">
						<Group gap="xs" align="center">
							<Box
								ref={dragHandle?.setActivatorNodeRef}
								{...(dragHandle?.attributes || {})}
								{...(dragHandle?.listeners || {})}
								style={{ width: 24, height: 28, borderRadius: 6, cursor: dragHandle ? 'grab' : 'default', border: `1px solid ${cardBorder}`, background: isDark ? 'rgba(51,65,85,0.7)' : 'rgba(241,245,249,0.95)' }}
							>
								<GripVertical size={14} style={{ margin: 7, color: textDim }} />
							</Box>
							<Text size="sm" fw={600}>Repeat Block</Text>
						</Group>
						<Group gap="xs">
							<ActionIcon variant="subtle" onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, repeats: Math.max(1, node.repeats - 1) }))}><Minus size={14} /></ActionIcon>
							<Badge variant="light" style={{ background: isDark ? 'rgba(110, 75, 243, 0.18)' : 'rgba(110, 75, 243, 0.10)', color: accentSecondary }}>{node.repeats}</Badge>
							<ActionIcon variant="subtle" onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, repeats: node.repeats + 1 }))}><Plus size={14} /></ActionIcon>
							<ActionIcon variant="subtle" color="red" onClick={() => onNodesChange(removeNodeAt(nodes, index))}><Trash2 size={16} /></ActionIcon>
						</Group>
					</Group>
					<SortableContext items={node.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
						<Stack gap="xs">
							{node.steps.map((nestedNode, nestedIndex) => {
								if (nestedNode.type === 'repeat') {
									return (
										<SortableRootItem key={nestedNode.id} id={nestedNode.id}>
											{(handle) => renderRepeatBlock(nestedNode as any, nestedIndex, node.steps, (nextSteps) => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: nextSteps })), handle)}
										</SortableRootItem>
									);
								}
								return (
									<SortableRootItem key={nestedNode.id} id={nestedNode.id}>
										{(handle) => renderConcrete(nestedNode as ConcreteStep, nestedIndex, node.steps, (nextSteps) => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: nextSteps })), handle)}
									</SortableRootItem>
								);
							})}
							<RepeatDropZone repeatId={node.id} isDark={isDark} />
						</Stack>
					</SortableContext>
					<Group gap="xs" justify="flex-end">
						<Menu shadow="md" width={220} position="bottom-end">
							<Menu.Target>
								<Button size="xs" variant="subtle" c={accentPrimary} leftSection={<Plus size={14} />}>Add Step</Button>
							</Menu.Target>
							<Menu.Dropdown>
								<Menu.Item onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: [...node.steps, createDefaultBlock('warmup')] }))}>Warm Up (Z1)</Menu.Item>
								<Menu.Label>Training</Menu.Label>
								{(normalizedSport === 'cycling' ? powerZoneRanges : hrZoneRanges).map(([z, lo, hi]) => (
									<Menu.Item key={`repeat-add-z${z}`} onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: [...node.steps, createZoneBlock('work', z, normalizedSport)] }))}>
										Training Z{z} ({lo}–{hi}%)
									</Menu.Item>
								))}
								<Menu.Divider />
								<Menu.Item onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: [...node.steps, createDefaultBlock('recovery')] }))}>Recovery (Z1)</Menu.Item>
								<Menu.Item onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: [...node.steps, createDefaultBlock('cooldown')] }))}>Cool Down (Z1)</Menu.Item>
								<Menu.Item onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: [...node.steps, createDefaultRepeat()] }))}>Repeat Block</Menu.Item>
							</Menu.Dropdown>
						</Menu>
					</Group>
				</Stack>
			</Paper>
		);
	};

	const renderNode = (node: WorkoutNode, index: number, nodes: WorkoutNode[], onNodesChange: (nextNodes: WorkoutNode[]) => void, dragHandle?: DragHandleProps): React.ReactNode => {
		if (node.type === 'repeat') return renderRepeatBlock(node as any, index, nodes, onNodesChange, dragHandle);
		return renderConcrete(node, index, nodes, onNodesChange, dragHandle);
	};

	const activeDragNode = activeDragId ? findNodeById(structure, activeDragId) : null;

	return (
		<Paper bg={panelBg} p="md" radius="md" withBorder style={{ borderColor: cardBorder, fontFamily: '"Inter", sans-serif' }}>
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
							<Group gap="xs"><Info size={14} color={textDim} /><Text size="sm" c="dimmed">Select a block, then click a zone for instant fill.</Text></Group>
							<Menu shadow="md" width={220} position="bottom-end">
								<Menu.Target><Button variant="subtle" size="xs" c={accentPrimary} leftSection={<Plus size={14} />}>Add</Button></Menu.Target>
								<Menu.Dropdown>
									<Menu.Item onClick={() => addNode(createDefaultBlock('warmup'))}>Warm Up (Z1)</Menu.Item>
									<Menu.Label>Training</Menu.Label>
									{(normalizedSport === 'cycling' ? powerZoneRanges : hrZoneRanges).map(([z, lo, hi]) => (
										<Menu.Item key={`add-z${z}`} onClick={() => addNode(createZoneBlock('work', z, normalizedSport))}>
											Training Z{z} ({lo}–{hi}%)
										</Menu.Item>
									))}
									<Menu.Divider />
									<Menu.Item onClick={() => addNode(createDefaultBlock('recovery'))}>Recovery (Z1)</Menu.Item>
									<Menu.Item onClick={() => addNode(createDefaultBlock('cooldown'))}>Cool Down (Z1)</Menu.Item>
									<Menu.Item onClick={() => addNode(createDefaultRepeat())}>Repeat Block</Menu.Item>
								</Menu.Dropdown>
							</Menu>
						</Group>

						{structure.length === 0 ? (
							<Paper withBorder p="lg" bg={cardBg} radius="md" style={{ borderColor: cardBorder }}>
								<Stack align="center" gap="xs">
									<Text c="dimmed" size="sm">No blocks yet</Text>
									<Menu shadow="md" width={220}>
										<Menu.Target><Button size="xs" variant="subtle" c={accentPrimary}>Create starter structure</Button></Menu.Target>
										<Menu.Dropdown>
											<Menu.Item onClick={() => onChange(createStarterPreset('endurance'))}>Endurance Base</Menu.Item>
											<Menu.Item onClick={() => onChange(createStarterPreset('intervals'))}>5x3 min Intervals</Menu.Item>
											<Menu.Item onClick={() => onChange(createStarterPreset('recovery'))}>Recovery Easy Day</Menu.Item>
										</Menu.Dropdown>
									</Menu>
								</Stack>
							</Paper>
						) : (
							<DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onRootDragStart} onDragEnd={onUnifiedDragEnd} modifiers={[restrictToVerticalAxis]}>
								<SortableContext items={allSortableIds} strategy={verticalListSortingStrategy}>
									<Stack gap="sm">
										{structure.map((node, index) => (
											<SortableRootItem key={node.id} id={node.id}>
												{(dragHandle) => renderNode(node, index, structure, onChange, dragHandle)}
											</SortableRootItem>
										))}
										{structure.some((n) => n.type === 'repeat') && <RootDropZone isDark={isDark} />}
									</Stack>
								</SortableContext>
								<DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' }}>
									{activeDragNode ? (
										<Paper withBorder p="sm" radius="md" bg={cardBg} style={{ border: `1px solid ${cardBorder}`, borderLeft: `6px solid ${activeDragNode.type === 'repeat' ? accentSecondary : sectionAccentColor[(activeDragNode as ConcreteStep).category]}`, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', opacity: 0.92 }}>
											<Group gap="xs">
												<GripVertical size={14} color={textDim} />
												<Text size="sm" fw={600}>{activeDragNode.type === 'repeat' ? `Repeat Block (×${activeDragNode.repeats})` : sectionHeaderText[(activeDragNode as ConcreteStep).category]}</Text>
											</Group>
										</Paper>
									) : null}
								</DragOverlay>
							</DndContext>
						)}

						<Paper withBorder p="sm" bg={cardBg} radius="md" style={{ borderColor: cardBorder }}>
							<Group justify="space-between" mb={6}>
								<Text size="sm">Estimate <Text span fw={700}>{formatSecondsHm(totals.totalSeconds)}</Text> <Text span fw={700}>{totals.totalDistanceKm.toFixed(2)} km</Text></Text>
								<Text size="xs" fw={600}>Structured Workout Preview</Text>
							</Group>
							<Box style={{ position: 'relative' }}>
								<svg width="100%" viewBox="0 0 600 120" preserveAspectRatio="none" aria-label="Structured Workout Preview">
									<rect x="0" y="0" width="600" height="120" fill={isDark ? 'rgba(15,23,42,0.65)' : 'rgba(241,245,249,0.9)'} />
									{profileBars.map((bar, idx) => (
										<rect key={`preview-${idx}`} x={bar.x} y={120 - bar.height} width={Math.max(2, bar.width - 1)} height={bar.height} fill={bar.color} rx="2" style={{ transition: 'opacity 150ms ease' }} opacity={hoveredBarIdx === idx ? 0.7 : 1} />
									))}
								</svg>
								<Box style={{ position: 'absolute', inset: 0 }} onMouseLeave={() => setHoveredBarIdx(null)}>
									{profileBars.map((bar, idx) => {
										const pctLeft = (bar.x / 600) * 100;
										const pctWidth = (bar.width / 600) * 100;
										const pctTop = ((120 - bar.height) / 120) * 100;
										return (
											<Box
												key={`hit-${idx}`}
												onMouseEnter={() => setHoveredBarIdx(idx)}
												style={{ position: 'absolute', left: `${pctLeft}%`, width: `${pctWidth}%`, top: 0, height: '100%', cursor: 'default' }}
											>
												<Box
													style={{
														position: 'absolute',
														bottom: `calc(${100 - pctTop}% + 8px)`,
														left: '50%',
														transform: 'translateX(-50%)',
														whiteSpace: 'nowrap',
														padding: '5px 12px',
														borderRadius: 8,
														fontSize: 12,
														fontWeight: 600,
														lineHeight: 1.4,
														pointerEvents: 'none',
														zIndex: 20,
														opacity: hoveredBarIdx === idx ? 1 : 0,
														transition: 'opacity 120ms ease',
														background: isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.97)',
														color: isDark ? '#E2E8F0' : '#0F172A',
														border: `1px solid ${cardBorder}`,
														boxShadow: isDark ? '0 4px 14px rgba(0,0,0,0.45)' : '0 4px 14px rgba(15,23,42,0.12)',
													}}
												>
													{bar.tooltip}
												</Box>
											</Box>
										);
									})}
								</Box>
							</Box>
						</Paper>
					</Stack>
				</Box>

				<Box style={{ flex: '1 1 320px', minWidth: 280, maxWidth: 360, width: '100%' }}>
					<Card withBorder padding="sm" radius="md" bg={cardBg} style={{ position: 'sticky', top: 12, boxShadow: isDark ? '0 12px 24px -20px rgba(2,6,23,0.9)' : '0 8px 20px rgba(15, 23, 42, 0.08)', borderColor: cardBorder }}>
						<Stack gap={8}>
							<Group justify="space-between"><Text fw={700} size="sm">Athlete Statistics</Text><Text size="xs" c="dimmed">{athleteName || 'Selected athlete'}</Text></Group>
							<Group gap="xs" wrap="wrap">
								{normalizedSport === 'cycling' && <Badge variant="light" radius={4} style={{ background: isDark ? 'rgba(110, 75, 243, 0.2)' : 'rgba(110, 75, 243, 0.1)', color: accentSecondary }}>FTP: {athleteProfile?.ftp ?? '-'}</Badge>}
								{normalizedSport === 'running' && <Badge variant="light" style={{ background: isDark ? 'rgba(233, 90, 18, 0.2)' : 'rgba(233, 90, 18, 0.1)', color: accentPrimary }}>LT2: {athleteProfile?.lt2 ? `${athleteProfile.lt2.toFixed(2)} min/km` : '-'}</Badge>}
								<Badge variant="light" radius={4} style={{ background: isDark ? 'rgba(233, 90, 18, 0.2)' : 'rgba(233, 90, 18, 0.1)', color: accentPrimary }}>Max HR: {athleteProfile?.max_hr ?? '-'}</Badge>
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
											<Table.Tr key={`${effectiveZoneView}-${row.zone}`} onClick={() => applyZoneToCurrentStep(row)} style={{ cursor: activeStepId ? 'pointer' : 'not-allowed', background: activeStepId ? (isDark ? 'rgba(233, 90, 18, 0.10)' : 'rgba(233, 90, 18, 0.06)') : undefined }}>
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


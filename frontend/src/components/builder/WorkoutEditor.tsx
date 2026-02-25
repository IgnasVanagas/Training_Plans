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
import { ChevronDown, ChevronRight, Clock3, GripVertical, Info, Minus, Plus, Route, Rows3, Trash2, Zap } from 'lucide-react';
import { DndContext, DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ConcreteStep, StepCategory, TargetConfig, WorkoutNode } from '../../types/workout';
import { createDefaultBlock, createDefaultRepeat, createStarterPreset, durationTypeOptions, edgeColorFromZone, estimateTotals, flattenBlocks, formatHms, formatPace, formatSecondsHm, hrZoneRows, inferIntensityZone, intensityPercentForStep, intensityTypeOptions, metricMeta, metricOptions, nodeCategory, normalizePaceSeconds, paceZoneRows, parseHms, parsePaceInput, powerZoneRows, randomId, sectionHeaderText, sectionHeaderTint, type IntensityMetric, type ZoneRow } from './workoutEditorUtils';

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
	const isDark = useComputedColorScheme('light') === 'dark';
	const panelBg = isDark ? 'rgba(8, 18, 38, 0.72)' : 'rgba(255, 255, 255, 0.9)';
	const cardBg = isDark ? 'rgba(22, 34, 58, 0.62)' : 'rgba(255, 255, 255, 0.92)';
	const cardBorder = isDark ? 'rgba(148, 163, 184, 0.26)' : 'rgba(15, 23, 42, 0.14)';
	const accentPrimary = '#E95A12';
	const accentSecondary = '#6E4BF3';
	const textDim = isDark ? '#94A3B8' : '#475569';
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
				radius="md"
				bg={cardBg}
				onClick={() => setActiveStepId(step.id)}
				style={{ border: `1px solid ${cardBorder}`, borderLeft: `6px solid ${edgeColorFromZone(zoneValue)}`, boxShadow: isActive ? `0 0 0 2px ${isDark ? 'rgba(233, 90, 18, 0.35)' : 'rgba(233, 90, 18, 0.2)'}` : undefined, transition: 'box-shadow 160ms ease, transform 120ms ease' }}
			>
				<Stack gap="sm">
					<Group justify="space-between" align="center">
						<Group gap="xs" align="center">
							<Box
								ref={dragHandle?.setActivatorNodeRef}
								{...(dragHandle?.attributes || {})}
								{...(dragHandle?.listeners || {})}
								style={{ width: 18, height: 24, borderRadius: 4, cursor: dragHandle ? 'grab' : 'default', border: `1px solid ${cardBorder}`, background: isDark ? 'rgba(51,65,85,0.6)' : 'rgba(241,245,249,0.9)' }}
							>
								<GripVertical size={12} style={{ margin: 5, color: textDim }} />
							</Box>
							<Rows3 size={14} color={textDim} />
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
				<Paper key={node.id} withBorder p="sm" radius="md" bg={cardBg} style={{ border: `1px solid ${cardBorder}`, borderLeft: `6px solid ${accentSecondary}` }}>
					<Stack gap="sm">
						<Group justify="space-between" align="center">
							<Group gap="xs" align="center">
								<ActionIcon variant="subtle" color="gray" size="sm" style={{ cursor: dragHandle ? 'grab' : 'default' }} ref={dragHandle?.setActivatorNodeRef} {...(dragHandle?.attributes || {})} {...(dragHandle?.listeners || {})}>
									<GripVertical size={15} />
								</ActionIcon>
								<Text size="sm" fw={600}>Repeat Block</Text>
							</Group>
							<Group gap="xs">
								<ActionIcon variant="subtle" onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, repeats: Math.max(1, node.repeats - 1) }))}><Minus size={14} /></ActionIcon>
								<Badge variant="light" style={{ background: isDark ? 'rgba(110, 75, 243, 0.18)' : 'rgba(110, 75, 243, 0.10)', color: accentSecondary }}>{node.repeats}</Badge>
								<ActionIcon variant="subtle" onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, repeats: node.repeats + 1 }))}><Plus size={14} /></ActionIcon>
								<ActionIcon variant="subtle" color="red" onClick={() => onNodesChange(removeNodeAt(nodes, index))}><Trash2 size={16} /></ActionIcon>
							</Group>
						</Group>
						<Stack gap="xs">
							{node.steps.map((nestedNode, nestedIndex) => renderNode(nestedNode, nestedIndex, node.steps, (nextNestedSteps) => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: nextNestedSteps }))))}
						</Stack>
						<Group justify="flex-end">
							<Button size="xs" variant="subtle" c={accentPrimary} leftSection={<Plus size={14} />} onClick={() => onNodesChange(updateNodeAt(nodes, index, { ...node, steps: [...node.steps, createDefaultBlock('work')] }))}>Add Step</Button>
						</Group>
					</Stack>
				</Paper>
			);
		}
		return renderConcrete(node, index, nodes, onNodesChange, dragHandle);
	};

	const sectionOrder: StepCategory[] = ['warmup', 'work', 'recovery', 'cooldown'];

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
							<Menu shadow="md" width={180}>
								<Menu.Target><Button variant="subtle" size="xs" c={accentPrimary} leftSection={<Plus size={14} />}>Add</Button></Menu.Target>
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
							<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onRootDragEnd}>
								<SortableContext items={structure.map((node) => node.id)} strategy={verticalListSortingStrategy}>
									<Stack gap="sm">
										{sectionOrder.map((section) => {
											const sectionNodes = structure.filter((node) => nodeCategory(node) === section);
											if (!sectionNodes.length) return null;
											return (
													<Paper key={`section-${section}`} radius="md" p="xs" withBorder style={{ background: sectionHeaderTint[section], borderColor: cardBorder }}>
													<Group justify="space-between" mb={6}>
														<Group gap={6}>
															<ActionIcon size="sm" variant="subtle" onClick={() => setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }))}>
																{collapsedSections[section] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
															</ActionIcon>
															<Text size="sm" fw={700}>{sectionHeaderText[section]}</Text>
														</Group>
														<Badge variant="light" radius={4} style={{ color: isDark ? '#E2E8F0' : '#334155' }}>{sectionNodes.length}</Badge>
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

						<Paper withBorder p="sm" bg={cardBg} radius="md" style={{ borderColor: cardBorder }}>
							<Group justify="space-between" mb={6}>
								<Text size="sm">Estimate <Text span fw={700}>{formatSecondsHm(totals.totalSeconds)}</Text> <Text span fw={700}>{totals.totalDistanceKm.toFixed(2)} km</Text></Text>
								<Text size="xs" fw={600}>Structured Workout Preview</Text>
							</Group>
							<svg width="100%" viewBox="0 0 600 90" preserveAspectRatio="none" aria-label="Structured Workout Preview">
								<rect x="0" y="0" width="600" height="90" fill={isDark ? 'rgba(15,23,42,0.65)' : 'rgba(241,245,249,0.9)'} />
								{profileBars.map((bar, idx) => <rect key={`preview-${idx}`} x={bar.x} y={90 - bar.height} width={Math.max(2, bar.width - 1)} height={bar.height} fill={bar.color} rx="2" />)}
							</svg>
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


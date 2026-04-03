import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, TextInput, MultiSelect, Button, Loader, Group, ActionIcon, ScrollArea, SegmentedControl, Text, Box, useComputedColorScheme, ThemeIcon, Center } from '@mantine/core';
import { IconSearch, IconFilter, IconPlus, IconX, IconDragDrop, IconClock, IconBookmark, IconTemplate } from '@tabler/icons-react';
import { getWorkouts, deleteWorkout, updateWorkout, getRecentCoachWorkouts, RecentCoachWorkout } from '../../api/workouts';
import { SavedWorkout } from '../../types/workout';
import { WorkoutLibraryItem } from './WorkoutLibraryItem';
import { getBuiltInTemplates, isBuiltInTemplate } from './workoutTemplates';
import { useNavigate } from 'react-router-dom';

interface WorkoutLibraryProps {
    onDragStart?: (workout: SavedWorkout) => void;
    onDragEnd?: () => void;
    onSelect?: (workout: SavedWorkout) => void;
}

export const WorkoutLibrary = ({ onDragStart, onDragEnd, onSelect }: WorkoutLibraryProps) => {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const isDark = useComputedColorScheme('light') === 'dark';
    const [search, setSearch] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [filterType, setFilterType] = useState<'recent' | 'saved' | 'templates'>('recent');

    const { data: workouts, isLoading } = useQuery({
        queryKey: ['workouts'],
        queryFn: () => getWorkouts({ limit: 500 })
    });

    const { data: recentPlanned, isLoading: isLoadingRecent } = useQuery({
        queryKey: ['recent-coach-workouts'],
        queryFn: () => getRecentCoachWorkouts(20),
        enabled: filterType === 'recent',
    });

    const deleteMutation = useMutation({
        mutationFn: deleteWorkout,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workouts'] });
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, updates }: { id: number, updates: Partial<SavedWorkout> }) => updateWorkout(id, updates),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['workouts'] });
        }
    });

    const allTags = useMemo(() => {
        const tags = new Set<string>();
        if (filterType === 'templates') {
            getBuiltInTemplates().forEach(w => w.tags?.forEach(t => tags.add(t)));
        } else if (workouts) {
            workouts.forEach(w => w.tags?.forEach(t => tags.add(t)));
        }
        return Array.from(tags);
    }, [workouts, filterType]);

    const filteredWorkouts = useMemo(() => {
        if (filterType === 'templates') {
            const builtIn = getBuiltInTemplates();
            return builtIn.filter(w => {
                const matchesSearch = !search || w.title.toLowerCase().includes(search.toLowerCase()) ||
                                      w.description?.toLowerCase().includes(search.toLowerCase());
                const matchesTags = selectedTags.length === 0 ||
                                    selectedTags.every(t => w.tags?.includes(t));
                return matchesSearch && matchesTags;
            });
        }

        if (filterType === 'recent') {
            if (!recentPlanned) return [];
            // Map recent planned workouts to SavedWorkout-like shape
            let list: SavedWorkout[] = recentPlanned.map((rw) => ({
                id: rw.id,
                coach_id: 0,
                title: rw.title,
                description: rw.description ?? undefined,
                sport_type: rw.sport_type,
                structure: rw.structure,
                tags: rw.tags,
                is_favorite: rw.is_favorite,
                created_at: rw.date ?? '',
            }));
            return list.filter(w => {
                const matchesSearch = !search || w.title.toLowerCase().includes(search.toLowerCase()) ||
                                      w.description?.toLowerCase().includes(search.toLowerCase());
                return matchesSearch;
            });
        }

        if (!workouts) return [];
        let list = [...workouts];

        if (filterType === 'saved') {
            list = list.filter(w => w.is_favorite);
        }

        return list.filter(w => {
            const matchesSearch = w.title.toLowerCase().includes(search.toLowerCase()) || 
                                  w.description?.toLowerCase().includes(search.toLowerCase());
            const matchesTags = selectedTags.length === 0 || 
                                selectedTags.every(t => w.tags?.includes(t));
            
            return matchesSearch && matchesTags;
        });
    }, [workouts, recentPlanned, search, selectedTags, filterType]);

    const handleCreate = () => {
        navigate('/workouts/new');
    };

    const handleEdit = (e: React.MouseEvent, workout: SavedWorkout) => {
        e.stopPropagation();
        navigate(`/workouts/new?id=${workout.id}`);
    };

    const handleDelete = (e: React.MouseEvent, id: number) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this workout template?')) {
            deleteMutation.mutate(id);
        }
    };

    const handleToggleFavorite = (e: React.MouseEvent, id: number, isFavorite: boolean) => {
        e.stopPropagation();
        updateMutation.mutate({ id, updates: { is_favorite: isFavorite } });
    };

    return (
        <Stack
            h="100%"
            gap={0}
            style={{
                borderRadius: 12,
                border: isDark ? '1px solid rgba(148,163,184,0.18)' : '1px solid rgba(15,23,42,0.10)',
                background: isDark ? 'var(--mantine-color-dark-7)' : 'var(--mantine-color-gray-0)',
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <Box
                px="sm"
                py="xs"
                style={{
                    borderBottom: isDark ? '1px solid rgba(148,163,184,0.12)' : '1px solid rgba(15,23,42,0.07)',
                    background: isDark ? 'var(--mantine-color-dark-6)' : 'white',
                    flexShrink: 0,
                }}
            >
                <Group justify="space-between" mb="xs">
                    <Group gap="xs">
                        <ThemeIcon size="sm" variant="light" color="blue" radius="sm">
                            <IconDragDrop size={13} />
                        </ThemeIcon>
                        <Text fw={700} size="sm">Workout Library</Text>
                    </Group>
                    <Button size="xs" leftSection={<IconPlus size={12} />} onClick={handleCreate} variant="light" radius="sm">
                        New
                    </Button>
                </Group>

                <TextInput
                    placeholder="Search..."
                    leftSection={<IconSearch size={13} />}
                    value={search}
                    size="xs"
                    radius="sm"
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    rightSection={
                        search && (
                            <ActionIcon size="xs" variant="transparent" onClick={() => setSearch('')}>
                                <IconX size={11} />
                            </ActionIcon>
                        )
                    }
                    mb="xs"
                />

                <SegmentedControl
                    fullWidth
                    size="xs"
                    radius="sm"
                    value={filterType}
                    onChange={(val) => setFilterType(val as 'recent' | 'saved' | 'templates')}
                    data={[
                        { label: 'Recent', value: 'recent' },
                        { label: 'Saved', value: 'saved' },
                        { label: 'Templates', value: 'templates' },
                    ]}
                />
            </Box>

            {/* Tag filter */}
            {allTags.length > 0 && (
                <Box px="sm" pt="xs" style={{ flexShrink: 0 }}>
                    <MultiSelect
                        placeholder="Filter by tags"
                        data={allTags}
                        value={selectedTags}
                        onChange={setSelectedTags}
                        searchable
                        clearable
                        size="xs"
                        radius="sm"
                        leftSection={<IconFilter size={13} />}
                    />
                </Box>
            )}

            <ScrollArea flex={1} type="auto" offsetScrollbars px="sm" pt="xs" pb="sm">
                {(isLoading || (filterType === 'recent' && isLoadingRecent)) ? (
                    <Center pt="xl"><Loader size="sm" /></Center>
                ) : filteredWorkouts.length === 0 ? (
                    <Center pt="xl">
                        <Stack align="center" gap="xs">
                            <ThemeIcon size="xl" variant="light" color="gray" radius="xl">
                                {filterType === 'recent' ? <IconClock size={20} /> : filterType === 'saved' ? <IconBookmark size={20} /> : <IconTemplate size={20} />}
                            </ThemeIcon>
                            <Text c="dimmed" size="xs" ta="center">
                                {filterType === 'recent' ? 'No recent workouts' : filterType === 'saved' ? 'No saved workouts' : 'No templates found'}
                            </Text>
                        </Stack>
                    </Center>
                ) : (
                    <Stack gap="xs">
                        {filteredWorkouts.map(workout => (
                            <WorkoutLibraryItem
                                key={workout.id}
                                workout={workout}
                                isTemplate={isBuiltInTemplate(workout)}
                                onDelete={handleDelete}
                                onEdit={handleEdit}
                                onToggleFavorite={handleToggleFavorite}
                                onDragStart={(e, w) => onDragStart?.(w)}
                                onDragEnd={() => onDragEnd?.()}
                                onSelect={onSelect ? () => onSelect(workout) : undefined}
                            />
                        ))}
                    </Stack>
                )}
            </ScrollArea>
        </Stack>
    );
};

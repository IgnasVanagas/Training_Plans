import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, TextInput, MultiSelect, Button, Loader, Group, ActionIcon, ScrollArea, SegmentedControl, Text, Divider, Box } from '@mantine/core';
import { IconSearch, IconFilter, IconPlus, IconX } from '@tabler/icons-react';
import { getWorkouts, deleteWorkout, updateWorkout, getRecentCoachWorkouts, RecentCoachWorkout } from '../../api/workouts';
import { SavedWorkout } from '../../types/workout';
import { WorkoutLibraryItem } from './WorkoutLibraryItem';
import { useNavigate } from 'react-router-dom';

interface WorkoutLibraryProps {
    onDragStart?: (workout: SavedWorkout) => void;
    onDragEnd?: () => void;
    onSelect?: (workout: SavedWorkout) => void;
}

export const WorkoutLibrary = ({ onDragStart, onDragEnd, onSelect }: WorkoutLibraryProps) => {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [filterType, setFilterType] = useState<'all' | 'recent' | 'saved'>('all');

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
        if (!workouts) return [];
        const tags = new Set<string>();
        workouts.forEach(w => w.tags?.forEach(t => tags.add(t)));
        return Array.from(tags);
    }, [workouts]);

    const filteredWorkouts = useMemo(() => {
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
        <Stack h="100%" gap="sm" p="sm" bg="var(--mantine-color-body)">
            <Group justify="space-between">
                <Text fw={700} size="lg">Library</Text>
                <Button size="xs" leftSection={<IconPlus size={14} />} onClick={handleCreate} variant="light">
                    New
                </Button>
            </Group>

            <TextInput 
                placeholder="Search templates..." 
                leftSection={<IconSearch size={14} />} 
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                rightSection={
                    search && (
                        <ActionIcon size="xs" variant="transparent" onClick={() => setSearch('')}>
                            <IconX size={12} />
                        </ActionIcon>
                    )
                }
            />

            <SegmentedControl 
                fullWidth 
                size="xs"
                value={filterType}
                onChange={(val) => setFilterType(val as 'all' | 'recent' | 'saved')}
                data={[
                    { label: 'All', value: 'all' },
                    { label: 'Recent', value: 'recent' },
                    { label: 'Saved', value: 'saved' }
                ]}
            />

            {allTags.length > 0 && (
                <MultiSelect 
                    placeholder="Filter by tags" 
                    data={allTags}
                    value={selectedTags}
                    onChange={setSelectedTags}
                    searchable
                    clearable
                    size="xs"
                    leftSection={<IconFilter size={14} />}
                />
            )}

            <Divider />

            <ScrollArea flex={1} type="auto" offsetScrollbars>
                {(isLoading || (filterType === 'recent' && isLoadingRecent)) ? (
                    <Group justify="center" pt="xl"><Loader size="sm" /></Group>
                ) : (
                    <Stack gap="xs">
                        {filteredWorkouts.map(workout => (
                            <WorkoutLibraryItem 
                                key={workout.id} 
                                workout={workout}
                                onDelete={handleDelete}
                                onEdit={handleEdit}
                                onToggleFavorite={handleToggleFavorite}
                                onDragStart={(e, w) => onDragStart?.(w)}
                                onDragEnd={() => onDragEnd?.()}
                                onSelect={onSelect ? () => onSelect(workout) : undefined}
                            />
                        ))}
                        {filteredWorkouts.length === 0 && (
                            <Text c="dimmed" size="sm" ta="center" pt="xl">
                                No workouts found.
                            </Text>
                        )}
                    </Stack>
                )}
            </ScrollArea>
        </Stack>
    );
};

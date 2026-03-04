import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, TextInput, MultiSelect, Button, Loader, Group, ActionIcon, ScrollArea, SegmentedControl, Text, Divider, Box } from '@mantine/core';
import { IconSearch, IconFilter, IconPlus, IconX } from '@tabler/icons-react';
import { getWorkouts, deleteWorkout, updateWorkout } from '../../api/workouts';
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
    const [filterType, setFilterType] = useState<'all' | 'favorites'>('all');

    const { data: workouts, isLoading } = useQuery({
        queryKey: ['workouts'],
        queryFn: () => getWorkouts({ limit: 500 })
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
        if (!workouts) return [];
        return workouts.filter(w => {
            const matchesSearch = w.title.toLowerCase().includes(search.toLowerCase()) || 
                                  w.description?.toLowerCase().includes(search.toLowerCase());
            const matchesTags = selectedTags.length === 0 || 
                                selectedTags.every(t => w.tags?.includes(t));
            const matchesType = filterType === 'all' || (filterType === 'favorites' && w.is_favorite);
            
            return matchesSearch && matchesTags && matchesType;
        });
    }, [workouts, search, selectedTags, filterType]);

    const handleCreate = () => {
        navigate('/builder'); // Assumptions about route
    };

    const handleEdit = (e: React.MouseEvent, workout: SavedWorkout) => {
        e.stopPropagation();
        navigate(`/builder?id=${workout.id}`); // Assumptions about route
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
                onChange={(val) => setFilterType(val as 'all' | 'favorites')}
                data={[
                    { label: 'All', value: 'all' },
                    { label: 'Favorites', value: 'favorites' }
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
                {isLoading ? (
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

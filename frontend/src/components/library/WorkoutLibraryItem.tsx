import React from 'react';
import { Card, Text, Badge, Group, ActionIcon, Stack, Box, useComputedColorScheme } from '@mantine/core';
import { IconStar, IconStarFilled, IconGripVertical, IconTrash, IconEdit } from '@tabler/icons-react';
import { SavedWorkout } from '../../types/workout';
import { WorkoutPreviewGraph } from './WorkoutPreviewGraph';

interface WorkoutLibraryItemProps {
    workout: SavedWorkout;
    isTemplate?: boolean;
    onToggleFavorite: (e: React.MouseEvent, id: number, isFavorite: boolean) => void;
    onDelete: (e: React.MouseEvent, id: number) => void;
    onEdit: (e: React.MouseEvent, workout: SavedWorkout) => void;
    onDragStart: (e: React.DragEvent, workout: SavedWorkout) => void;
    onDragEnd?: (e: React.DragEvent) => void;
    onSelect?: (workout: SavedWorkout) => void;
}

export const WorkoutLibraryItem = ({ workout, isTemplate, onToggleFavorite, onDelete, onEdit, onDragStart, onDragEnd, onSelect }: WorkoutLibraryItemProps) => {
    const isDark = useComputedColorScheme('light') === 'dark';

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('application/json', JSON.stringify(workout));
        e.dataTransfer.effectAllowed = 'copy';
        onDragStart(e, workout);
    };

    return (
        <Card
            withBorder
            padding="xs"
            radius="sm"
            draggable
            onDragStart={handleDragStart}
            onDragEnd={onDragEnd}
            onClick={() => onSelect?.(workout)}
            style={{
                cursor: onSelect ? 'pointer' : 'grab',
                userSelect: 'none',
                background: isDark ? 'var(--mantine-color-dark-6)' : 'white',
                borderColor: isDark ? 'var(--mantine-color-dark-4)' : 'var(--mantine-color-gray-2)',
                transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            styles={{
                root: {
                    '&:hover': {
                        borderColor: 'var(--mantine-color-blue-5)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                    }
                }
            }}
        >
            <Group gap="xs" wrap="nowrap" align="flex-start">
                {!onSelect && (
                    <Box style={{ paddingTop: 2, flexShrink: 0 }}>
                        <IconGripVertical size={14} style={{ color: 'var(--mantine-color-gray-5)' }} />
                    </Box>
                )}
                <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                        <Text fw={600} size="xs" truncate style={{ flex: 1 }}>{workout.title}</Text>
                        {!isTemplate && (
                            <Group gap={2} style={{ flexShrink: 0 }}>
                                <ActionIcon
                                    variant="subtle"
                                    color={workout.is_favorite ? 'yellow' : 'gray'}
                                    size="xs"
                                    onClick={(e) => onToggleFavorite(e, workout.id, !workout.is_favorite)}
                                >
                                    {workout.is_favorite ? <IconStarFilled size={12} /> : <IconStar size={12} />}
                                </ActionIcon>
                                <ActionIcon variant="subtle" size="xs" color="blue" onClick={(e) => onEdit(e, workout)}>
                                    <IconEdit size={12} />
                                </ActionIcon>
                                <ActionIcon variant="subtle" size="xs" color="red" onClick={(e) => onDelete(e, workout.id)}>
                                    <IconTrash size={12} />
                                </ActionIcon>
                            </Group>
                        )}
                    </Group>

                    {workout.description && (
                        <Text size="xs" c="dimmed" lineClamp={1}>{workout.description}</Text>
                    )}

                    <Box my={2}>
                        <WorkoutPreviewGraph structure={workout.structure} sportType={workout.sport_type} height={20} />
                    </Box>

                    <Group gap={4}>
                        <Badge variant="light" size="xs" color="blue">{workout.sport_type}</Badge>
                        {isTemplate && <Badge variant="filled" size="xs" color="teal">Template</Badge>}
                        {workout.tags?.slice(0, 2).map(tag => (
                            <Badge key={tag} variant="outline" size="xs" color="gray">{tag}</Badge>
                        ))}
                    </Group>
                </Stack>
            </Group>
        </Card>
    );
};

import React from 'react';
import { Card, Text, Badge, Group, ActionIcon, Stack, Tooltip, UnstyledButton, Box } from '@mantine/core';
import { IconStar, IconStarFilled, IconGripVertical, IconTrash, IconEdit } from '@tabler/icons-react';
import { SavedWorkout } from '../../types/workout';
import { WorkoutPreviewGraph } from './WorkoutPreviewGraph';

interface WorkoutLibraryItemProps {
    workout: SavedWorkout;
    onToggleFavorite: (e: React.MouseEvent, id: number, isFavorite: boolean) => void;
    onDelete: (e: React.MouseEvent, id: number) => void;
    onEdit: (e: React.MouseEvent, workout: SavedWorkout) => void;
    onDragStart: (e: React.DragEvent, workout: SavedWorkout) => void;
    onDragEnd?: (e: React.DragEvent) => void;
    onSelect?: (workout: SavedWorkout) => void;
}

export const WorkoutLibraryItem = ({ workout, onToggleFavorite, onDelete, onEdit, onDragStart, onDragEnd, onSelect }: WorkoutLibraryItemProps) => {
    const handleDragStart = (e: React.DragEvent) => {
        // Set drag data for HTML5 DnD
        e.dataTransfer.setData('application/json', JSON.stringify(workout));
        e.dataTransfer.effectAllowed = 'copy';
        onDragStart(e, workout);
    };

    return (
        <Card 
            withBorder 
            padding="sm" 
            radius="md" 
            draggable={!onSelect} // Disable drag if in select mode? Or keep both? Keeping drag might be confusing in modal. Let's start with drag enabled only if no onSelect? actually keep both.
            onDragStart={handleDragStart} 
            onDragEnd={onDragEnd}
            onClick={() => onSelect?.(workout)}
            style={{ 
                cursor: onSelect ? 'pointer' : 'grab', 
                marginBottom: '8px',
                borderColor: onSelect ? 'var(--mantine-color-blue-filled)' : undefined // Highlight if selectable? Maybe just regular border.
            }}
        >
            <Group justify="space-between" align="start" wrap="nowrap">
                <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                    {!onSelect && <IconGripVertical size={16} style={{ color: 'var(--mantine-color-gray-5)', flexShrink: 0 }} />}
                    <Stack gap={2} style={{ minWidth: 0 }}>
                        <Text fw={500} size="sm" truncate>{workout.title}</Text>
                        {workout.description && (
                            <Text size="xs" c="dimmed" lineClamp={2} title={workout.description}>
                                {workout.description}
                            </Text>
                        )}
                        
                        {/* Visual Structure Preview */}
                        <Box mt={4} mb={4}>
                            <WorkoutPreviewGraph structure={workout.structure} sportType={workout.sport_type} height={24} />
                        </Box>

                        <Group gap={4} mt={4}>
                            <Badge variant="light" size="xs" color="blue">
                                {workout.sport_type}
                            </Badge>
                            {workout.tags?.map(tag => (
                                <Badge key={tag} variant="outline" size="xs" color="gray">
                                    {tag}
                                </Badge>
                            ))}
                        </Group>
                    </Stack>
                </Group>
                
                <Stack gap={4} align="center">
                    <ActionIcon 
                        variant="subtle" 
                        color={workout.is_favorite ? "yellow" : "gray"} 
                        size="sm"
                        onClick={(e) => onToggleFavorite(e, workout.id, !workout.is_favorite)}
                    >
                        {workout.is_favorite ? <IconStarFilled size={16} /> : <IconStar size={16} />}
                    </ActionIcon>
                    <Group gap={2}>
                        <ActionIcon variant="subtle" size="xs" color="blue" onClick={(e) => onEdit(e, workout)}>
                            <IconEdit size={14} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" size="xs" color="red" onClick={(e) => onDelete(e, workout.id)}>
                            <IconTrash size={14} />
                        </ActionIcon>
                    </Group>
                </Stack>
            </Group>
        </Card>
    );
};

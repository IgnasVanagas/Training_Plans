import React, { useState, useEffect } from 'react';
import { Button, Container, Group, Title, MultiSelect, Switch, Paper, Text, Stack, Alert } from '@mantine/core';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { IconDeviceFloppy } from '@tabler/icons-react';
import { WorkoutNode, SavedWorkout, WorkoutStructure } from '../../types/workout';
import { WorkoutEditor } from './WorkoutEditor';
import { getWorkout, getWorkouts, createWorkout, updateWorkout } from '../../api/workouts';

export const WorkoutBuilder = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const id = searchParams.get('id');
    const isEditMode = Boolean(id);

    // State
    const [title, setTitle] = useState('New Workout');
    const [sportType, setSportType] = useState('Running'); // Case sensitive? 'running' vs 'Running'
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [isFavorite, setIsFavorite] = useState(false);
    const [structure, setStructure] = useState<WorkoutNode[]>([]);
    
    // Fetch all workouts to get available tags for autocomplete
    const { data: allWorkouts } = useQuery({
        queryKey: ['workouts'],
        queryFn: () => getWorkouts(),
        staleTime: 60000
    });
    
    const availableTags = React.useMemo(() => {
        const unique = new Set<string>(['Endurance', 'Intervals', 'Recovery', 'Tempo', 'VO2Max', 'Sprint', 'Technique']);
        allWorkouts?.forEach((w: SavedWorkout) => w.tags?.forEach((t: string) => unique.add(t)));
        return Array.from(unique).sort();
    }, [allWorkouts]);

    // Fetch if editing
    const { data: existingWorkout, isLoading } = useQuery({
        queryKey: ['workout', id],
        queryFn: () => getWorkout(Number(id)),
        enabled: isEditMode
    });

    useEffect(() => {
        if (existingWorkout) {
            setTitle(existingWorkout.title);
            setSportType(existingWorkout.sport_type || 'Running');
            setDescription(existingWorkout.description || '');
            setStructure(existingWorkout.structure || []);
            setTags(existingWorkout.tags || []);
            setIsFavorite(existingWorkout.is_favorite || false);
        }
    }, [existingWorkout]);

    const saveMutation = useMutation({
        mutationFn: async () => {
             const payload: WorkoutStructure = {
                 title,
                 sport_type: sportType,
                 description,
                 structure,
                 tags,
                 is_favorite: isFavorite
             };
             
             if (isEditMode && id) {
                 await updateWorkout(Number(id), payload);
             } else {
                 await createWorkout(payload);
             }
        },
        onSuccess: () => {
             queryClient.invalidateQueries({ queryKey: ['workouts'] });
             // If we have a dedicated library page, go there. 
             // Currently users seem to access via Calendar sidebar mostly?
             // Maybe go back to previous page?
             navigate(-1);
        }
    });

    if (isEditMode && isLoading) {
        return <Container size="xl" py="lg"><Text>Loading workout...</Text></Container>;
    }

    return (
        <Container size="xl" py="lg">
            <Group justify="space-between" mb="md" align="flex-start">
                <Stack gap={4}>
                     <Title order={2}>{isEditMode ? 'Edit Workout Template' : 'Create Workout Template'}</Title>
                     <Text size="sm" c="dimmed">Build reusable structured workouts for your library.</Text>
                </Stack>
                <Button
                    loading={saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                    leftSection={<IconDeviceFloppy size={18} />}
                    radius="md"
                    color="blue"
                >
                    Save Template
                </Button>
            </Group>
            
            <Paper withBorder p="md" radius="md" mb="md">
                <Stack>
                     <Group align="flex-end">
                         <MultiSelect 
                            label="Tags"
                            placeholder="e.g. interval, vo2max, recovery"
                            data={availableTags} 
                            value={tags}
                            onChange={setTags}
                            searchable
                            style={{ flex: 1 }}
                         />
                         <Switch 
                            label="Favorite" 
                            checked={isFavorite}
                            onChange={(e) => setIsFavorite(e.currentTarget.checked)}
                            mb={8}
                         />
                     </Group>
                </Stack>
            </Paper>

            <WorkoutEditor
                structure={structure}
                onChange={setStructure}
                sportType={sportType}
                workoutName={title}
                description={description}
                intensityType="Custom" 
                onWorkoutNameChange={setTitle}
                onDescriptionChange={setDescription}
                onIntensityTypeChange={() => {}} 
                onSportTypeChange={setSportType}
            />
        </Container>
    );
};


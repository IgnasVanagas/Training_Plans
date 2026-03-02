import React, { useState } from 'react';
import { Box, Container, Title, Flex, Button, ActionIcon, Group, Tooltip } from '@mantine/core';
import { IconBooks, IconX } from '@tabler/icons-react';
import { TrainingCalendar } from '../components/TrainingCalendar';
import { WorkoutLibrary } from '../components/library/WorkoutLibrary';
import { SavedWorkout } from '../types/workout';
import { createWorkout } from '../api/workouts'; // Actually createWorkout creates a NEW template? No, create instance.
// Wait, createWorkout is for creating templates in library.
// We need to 'schedule' a workout. That means creating an Activity or a ScheduledWorkout?
// The backend likely has `create_activity` or `schedule_workout` endpoint.
// Let's check `api/activities.ts` or similar.

const CalendarPage = () => {
    const [showLibrary, setShowLibrary] = useState(false);
    const [draggedWorkout, setDraggedWorkout] = useState<SavedWorkout | null>(null);

    const handleWorkoutDrop = async (workout: SavedWorkout, date: Date) => {
        // Here we need to schedule the workout.
        // Usually this means creating an activity with status 'planned' and copying structure.
        console.log('Dropped', workout, date);
        // Implementation detail: call API to create planned activity
    };

    return (
        <Container
            size="xl"
            py="md"
            style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
            <Group justify="space-between" mb="sm">
                <Title order={2}>Training Calendar</Title>
                <Button 
                    variant={showLibrary ? "light" : "outline"}
                    leftSection={showLibrary ? <IconX size={16} /> : <IconBooks size={16} />}
                    onClick={() => setShowLibrary(!showLibrary)}
                >
                    {showLibrary ? "Close Library" : "Workout Library"}
                </Button>
            </Group>
            
            <Flex style={{ flex: 1, minHeight: 0 }} gap="md">
                <Box style={{ flex: 1, minHeight: 0 }}>
                    <TrainingCalendar 
                        draggedWorkout={draggedWorkout}
                        onWorkoutDrop={handleWorkoutDrop}
                    />
                </Box>
                
                {showLibrary && (
                    <Box w={320} style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>
                        <WorkoutLibrary 
                            onDragStart={setDraggedWorkout} 
                            onDragEnd={() => setDraggedWorkout(null)}
                        />
                    </Box>
                )}
            </Flex>
        </Container>
    );
};

export default CalendarPage;

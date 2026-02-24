import React, { useState } from 'react';
import { Button, Container, Group, Title } from '@mantine/core';
import { WorkoutNode } from '../../types/workout';
import { WorkoutEditor } from './WorkoutEditor';

export const WorkoutBuilder = () => {
	const [title, setTitle] = useState('New Workout');
	const [sportType, setSportType] = useState('Running');
	const [description, setDescription] = useState('');
	const [plannedIntensity, setPlannedIntensity] = useState('Custom');
	const [structure, setStructure] = useState<WorkoutNode[]>([]);

	return (
		<Container size="xl" py="lg">
			<Group justify="space-between" mb="md">
				<Title order={2}>Create Workouts</Title>
				<Button
					radius={4}
					style={{
						backgroundImage: 'linear-gradient(135deg, var(--mantine-color-orange-5), var(--mantine-color-pink-6))',
						border: 'none'
					}}
				>
					Save
				</Button>
			</Group>

			<WorkoutEditor
				structure={structure}
				onChange={setStructure}
				sportType={sportType}
				workoutName={title}
				description={description}
				intensityType={plannedIntensity}
				onWorkoutNameChange={setTitle}
				onDescriptionChange={setDescription}
				onIntensityTypeChange={setPlannedIntensity}
				onSportTypeChange={setSportType}
			/>
		</Container>
	);
};


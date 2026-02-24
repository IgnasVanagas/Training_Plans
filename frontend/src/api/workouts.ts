import client from './client';
import { WorkoutStructure, SavedWorkout } from '../types/workout';

export const getWorkouts = async (): Promise<SavedWorkout[]> => {
    const response = await client.get<SavedWorkout[]>('/workouts/');
    return response.data;
};

export const getWorkout = async (id: number): Promise<SavedWorkout> => {
    const response = await client.get<SavedWorkout>(`/workouts/${id}`);
    return response.data;
};

export const createWorkout = async (workout: WorkoutStructure): Promise<SavedWorkout> => {
    const response = await client.post<SavedWorkout>('/workouts/', workout);
    return response.data;
};

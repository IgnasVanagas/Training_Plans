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

export const updateWorkout = async (id: number, updates: Partial<WorkoutStructure>): Promise<SavedWorkout> => {
    const response = await client.patch<SavedWorkout>(`/workouts/${id}`, updates);
    return response.data;
};

export const deleteWorkout = async (id: number): Promise<void> => {
    await client.delete(`/workouts/${id}`);
};

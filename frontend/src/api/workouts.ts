import client from './client';
import { WorkoutStructure, SavedWorkout } from '../types/workout';

export const getWorkouts = async (params?: { limit?: number; skip?: number }): Promise<SavedWorkout[]> => {
    const response = await client.get<SavedWorkout[]>('/workouts/', { params });
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

export interface RecentCoachWorkout {
    id: number;
    title: string;
    description: string | null;
    sport_type: string;
    structure: any[];
    planned_duration: number;
    date: string | null;
    tags: string[];
    is_favorite: boolean;
}

export const getRecentCoachWorkouts = async (limit = 20): Promise<RecentCoachWorkout[]> => {
    const response = await client.get<RecentCoachWorkout[]>('/calendar/recent-coach-workouts', { params: { limit } });
    return response.data;
};

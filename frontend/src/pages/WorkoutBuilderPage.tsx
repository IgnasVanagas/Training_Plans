import React from 'react';
import { WorkoutBuilder } from '../components/builder/WorkoutBuilder';
import { AppSidebarLayout } from '../components/AppSidebarLayout';

export const WorkoutBuilderPage = () => {
    return (
        <AppSidebarLayout activeNav="plan">
            <WorkoutBuilder />
        </AppSidebarLayout>
    );
};

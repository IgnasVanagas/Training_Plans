import React from 'react';
import { Box, Container, Title } from '@mantine/core';
import { TrainingCalendar } from '../components/TrainingCalendar';

const CalendarPage = () => {
    return (
        <Container
            size="xl"
            py="md"
            style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
            <Title order={2} mb="sm">Training Calendar</Title>
            <Box style={{ flex: 1, minHeight: 0 }}>
                <TrainingCalendar />
            </Box>
        </Container>
    );
};

export default CalendarPage;

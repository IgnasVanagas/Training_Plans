import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Container, Button, Group, Title, Text, Loader, Stack, Box } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { TrainingCalendar } from "../components/TrainingCalendar";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import api from "../api/client";

export const AthleteCalendarPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    const athleteId = Number(id);
    const navigationState = (location.state || {}) as { calendarDate?: string | null };
    const initialCalendarDate = (() => {
        const navEntry = (typeof window !== "undefined"
            ? (window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
            : undefined);
        const isReload = navEntry?.type === "reload";
        if (isReload) return null;
        return navigationState.calendarDate ?? null;
    })();

    useEffect(() => {
        if (navigationState.calendarDate === undefined) return;
        navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }, [location.pathname, location.search, navigate, navigationState.calendarDate]);

    const { data: athlete, isLoading, isError } = useQuery({
        queryKey: ["athlete", athleteId],
        queryFn: async () => {
             const res = await api.get(`/users/athletes/${athleteId}`);
             return res.data;
        }
    });

    if (isLoading) return <AppSidebarLayout activeNav="plan"><Container mt="xl"><Loader /></Container></AppSidebarLayout>;
    if (isError) return (
         <AppSidebarLayout activeNav="plan"><Container mt="xl">
            <Stack align="center">
                <Text c="red">Athlete not found or access denied.</Text>
                <Button onClick={() => navigate("/")} variant="outline">Back to Dashboard</Button>
            </Stack>
         </Container></AppSidebarLayout>
    );

    return (
        <AppSidebarLayout activeNav="plan"><Container size="xl" p="md" style={{ height: 'calc(100vh - 92px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Group mb="md">
                <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => navigate("/")}>
                   Back
                </Button>
                <Title order={3}>Calendar: {(athlete.profile?.first_name || athlete.profile?.last_name)
                    ? `${athlete.profile?.first_name || ''} ${athlete.profile?.last_name || ''}`.trim()
                    : athlete.email}
                </Title>
            </Group>
            
            <Box style={{ flex: 1, minHeight: 0 }}>
                <TrainingCalendar athleteId={athleteId} initialViewDate={initialCalendarDate} />
            </Box>
        </Container></AppSidebarLayout>
    );
};

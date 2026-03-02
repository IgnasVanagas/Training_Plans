import React, { useState, useEffect } from "react";
import { Paper, Stack, Group, Title, Text, Button, SimpleGrid, NumberInput, Textarea, useComputedColorScheme } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";

interface SessionFeedbackPanelProps {
    activityId: number;
    initialActivity: any; // Using any for now to simplify, or define interface
    canEdit: boolean;
}

export const SessionFeedbackPanel = ({ activityId, initialActivity, canEdit }: SessionFeedbackPanelProps) => {
    const queryClient = useQueryClient();
    const isDark = useComputedColorScheme('light') === 'dark';
    
    const [rpe, setRpe] = useState<number | null>(initialActivity?.rpe || null);
    const [notes, setNotes] = useState<string>(initialActivity?.notes || '');

    useEffect(() => {
        setRpe(initialActivity?.rpe || null);
        setNotes(initialActivity?.notes || '');
    }, [initialActivity]);
    
    const updateActivityMutation = useMutation({
        mutationFn: async (payload: { rpe?: number | null; notes?: string | null }) => {
            await api.patch(`/activities/${activityId}`, payload);
        },
        onSuccess: () => {
             queryClient.invalidateQueries({ queryKey: ['activity', activityId.toString()] });
             queryClient.invalidateQueries({ queryKey: ['activities'] });
             queryClient.invalidateQueries({ queryKey: ['calendar'] });
        }
    });

    const handleSave = () => {
        updateActivityMutation.mutate({
            rpe,
            notes: notes.trim() || null
        });
    };
    
    // UI Colors
    const ui = {
        surface: isDark ? '#12223E' : '#FFFFFF',
        border: isDark ? 'rgba(148,163,184,0.28)' : '#DCE6F7',
        textMain: isDark ? '#E2E8F0' : '#0F172A',
        textDim: isDark ? '#9FB0C8' : '#52617A',
    };

    return (
        <Paper withBorder p="md" radius="lg" mb="sm" bg={ui.surface} style={{ borderColor: ui.border }}>
            <Group justify="space-between" align="flex-start" mb="md">
                <Stack gap={2}>
                    <Title order={5} c={ui.textMain}>Session Feedback</Title>
                    <Text size="xs" c={ui.textDim}>
                        {canEdit 
                            ? "RPE and personal notes." 
                            : "Athlete's personal feedback."}
                    </Text>
                </Stack>
                {canEdit && (
                    <Button
                        size="xs"
                        radius="md"
                        color="dark"
                        variant="light"
                        loading={updateActivityMutation.isPending}
                        onClick={handleSave}
                        disabled={rpe === initialActivity?.rpe && notes === (initialActivity?.notes || '')}
                    >
                        Save
                    </Button>
                )}
            </Group>
             <SimpleGrid cols={{ base: 1, sm: 1 }} spacing="md">
                <NumberInput
                    label="RPE (1-10)"
                    description="Rate of Perceived Exertion"
                    min={1}
                    max={10}
                    allowDecimal={false}
                    value={rpe === null ? '' : rpe}
                    onChange={(val) => setRpe(typeof val === 'number' ? val : null)}
                    disabled={!canEdit}
                />
                <Textarea
                    label="Notes"
                    placeholder={canEdit ? "How did it feel?" : "No notes provided."}
                    minRows={3}
                    maxRows={6}
                    autosize
                    maxLength={2000}
                    value={notes}
                    onChange={(e) => setNotes(e.currentTarget.value)}
                    disabled={!canEdit}
                />
            </SimpleGrid>
        </Paper>
    );
};

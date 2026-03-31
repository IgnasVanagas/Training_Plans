import React, { useState, useEffect } from "react";
import { Paper, Stack, Group, Title, Text, Button, SimpleGrid, NumberInput, Textarea, useComputedColorScheme } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../../api/client";
import { useI18n } from "../../i18n/I18nProvider";

interface SessionFeedbackPanelProps {
    activityId: number;
    initialActivity: any; // Using any for now to simplify, or define interface
    canEdit: boolean;
}

export const SessionFeedbackPanel = ({ activityId, initialActivity, canEdit }: SessionFeedbackPanelProps) => {
    const queryClient = useQueryClient();
    const isDark = useComputedColorScheme('light') === 'dark';
    const { t } = useI18n();
    
    const [rpe, setRpe] = useState<number | null>(initialActivity?.rpe || null);
    const [lactate, setLactate] = useState<number | null>(initialActivity?.lactate_mmol_l || null);
    const [notes, setNotes] = useState<string>(initialActivity?.notes || '');

    useEffect(() => {
        setRpe(initialActivity?.rpe || null);
        setLactate(initialActivity?.lactate_mmol_l || null);
        setNotes(initialActivity?.notes || '');
    }, [initialActivity]);
    
    const updateActivityMutation = useMutation({
        mutationFn: async (payload: { rpe?: number | null; lactate_mmol_l?: number | null; notes?: string | null }) => {
            const res = await api.patch(`/activities/${activityId}`, payload);
            return res.data;
        },
        onMutate: async (payload) => {
            await queryClient.cancelQueries({ queryKey: ['activity', activityId] });
            const previous = queryClient.getQueryData(['activity', activityId]);
            if (previous) queryClient.setQueryData(['activity', activityId], { ...(previous as object), ...payload });
            return { previous };
        },
        onSuccess: (updated) => {
            if (updated) queryClient.setQueryData(['activity', activityId], updated);
            queryClient.invalidateQueries({ queryKey: ['activities'] });
            queryClient.invalidateQueries({ queryKey: ['calendar'] });
        },
        onError: (_err, _vars, context) => {
            if (context?.previous) queryClient.setQueryData(['activity', activityId], context.previous);
        },
    });

    const handleSave = () => {
        updateActivityMutation.mutate({
            rpe,
            lactate_mmol_l: lactate,
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
                    <Title order={5} c={ui.textMain}>{t('Session Feedback') || 'Session Feedback'}</Title>
                    <Text size="xs" c={ui.textDim}>
                        {canEdit 
                            ? (t('RPE, lactate, and personal notes.') || 'RPE, lactate, and personal notes.')
                            : (t("Athlete's personal feedback.") || "Athlete's personal feedback.")}
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
                        disabled={
                            rpe === initialActivity?.rpe &&
                            lactate === (initialActivity?.lactate_mmol_l || null) &&
                            notes === (initialActivity?.notes || '')
                        }
                    >
                        {t('Save') || 'Save'}
                    </Button>
                )}
            </Group>
             <SimpleGrid cols={{ base: 1, sm: 1 }} spacing="md">
                <NumberInput
                    label={t('RPE (1-10)') || 'RPE (1-10)'}
                    description={t('Rate of Perceived Exertion') || 'Rate of Perceived Exertion'}
                    min={1}
                    max={10}
                    allowDecimal={false}
                    value={rpe === null ? '' : rpe}
                    onChange={(val) => setRpe(typeof val === 'number' ? val : null)}
                    disabled={!canEdit}
                />
                <NumberInput
                    label={t('Lactate (mmol/L)') || 'Lactate (mmol/L)'}
                    description={t('Optional post-session lactate reading') || 'Optional post-session lactate reading'}
                    min={0}
                    max={40}
                    decimalScale={1}
                    value={lactate === null ? '' : lactate}
                    onChange={(val) => setLactate(typeof val === 'number' ? val : null)}
                    disabled={!canEdit}
                />
                <Textarea
                    label={t('Notes') || 'Notes'}
                    placeholder={canEdit ? (t('How did it feel?') || 'How did it feel?') : (t('No notes provided.') || 'No notes provided.')}
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

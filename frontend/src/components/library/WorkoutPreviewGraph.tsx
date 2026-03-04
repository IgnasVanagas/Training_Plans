import React, { useMemo } from 'react';
import { Box, useMantineTheme, Tooltip } from '@mantine/core';
import { WorkoutStructure, ConcreteStep, RepeatStep, Step } from '../../types/workout';

interface WorkoutPreviewGraphProps {
    structure: Step[];
    sportType?: string;
    height?: number;
    showGrid?: boolean;
}

type GraphSegment = {
    duration: number; // seconds
    intensity: number; // 0.0 to 1.0+
    type: 'warmup' | 'work' | 'recovery' | 'cooldown';
    description?: string;
    label: string;
};

const resolveIntensityAndDuration = (step: any): { intensity: number, duration: number, label: string } => {
    // Default safe values
    let intensity = 0.5;
    let duration = 300; 
    let label = "Step";

    if (!step) return { intensity, duration, label };

    // Duration
    if (step.duration) {
        if (step.duration.type === 'time' && typeof step.duration.value === 'number') {
            duration = step.duration.value;
            label = `${Math.round(duration/60)}m`;
        } else if (step.duration.type === 'distance' && typeof step.duration.value === 'number') {
            // Rough estimate: 5:00/km run, 30km/h bike
            // Just use a multiplier to visualize relative size
            duration = step.duration.value; 
            label = `${(step.duration.value/1000).toFixed(1)}km`;
        } else if (step.duration.type === 'lap_button') {
            duration = 0; // flexible
            label = "Lap";
        }
    }

    // Intensity
    if (step.target) {
        const t = step.target;
        
        // Handle explicit metrics (percent_ftp, percent_max_hr, percent_threshold_pace)
        if (t.metric === 'percent_ftp' && t.value) {
            intensity = t.value / 100;
        } else if (t.metric === 'percent_max_hr' && t.value) {
            intensity = t.value / 100; // Rough proxy
        } else if (t.metric === 'percent_threshold_pace' && t.value) {
            // For pace, higher % usually means FASTER, which is higher intensity.
            // 100% threshold pace is high intensity (1.0).
            intensity = t.value / 100;
        } else if (t.type === 'heart_rate_zone' || t.type === 'power_zone' || t.type === 'power') {
            // Map zone 1-5+ to 0.4-1.0+
            const z = t.zone || (t.min ? 3 : 1); // fallback
            if (z <= 1) intensity = 0.5;
            else if (z <= 2) intensity = 0.65;
            else if (z <= 3) intensity = 0.8;
            else if (z <= 4) intensity = 0.95;
            else intensity = 1.0 + (z - 5) * 0.1;
        } else if (t.type === 'rpe') {
            intensity = (t.value || 5) / 10;
        } else if (t.type === 'pace') {
            // Fast pace = high intensity. 
            // If we have metric, we handled it above.
            // If pure pace (min/km), we can't know absolute intensity without athlete profile.
            // Fallback to category
            intensity = step.category === 'work' ? 0.85 : 0.5;
        }
    }

    return { intensity, duration, label };
};

const flattenStructure = (steps: Step[]): GraphSegment[] => {
    let segments: GraphSegment[] = [];
    if (!steps) return segments;
    
    steps.forEach(step => {
        if (step.type === 'block') {
            const { intensity, duration, label } = resolveIntensityAndDuration(step);
            segments.push({
                intensity,
                duration: duration || 120, // visual min width
                type: (step as ConcreteStep).category || 'work',
                description: step.description,
                label
            });
        } else if (step.type === 'repeat') {
            const rep = step as RepeatStep;
            const childSegments = flattenStructure(rep.steps);
            for (let i = 0; i < (rep.repeats || 1); i++) {
                segments = segments.concat(childSegments);
            }
        }
    });
    return segments;
};


export const WorkoutPreviewGraph = ({ structure, sportType, height = 40 }: WorkoutPreviewGraphProps) => {
    const theme = useMantineTheme();
    
    const segments = useMemo(() => flattenStructure(structure), [structure]);
    const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0) || 1;

    const getSegmentColor = (intensity: number, type: string) => {
        if (type === 'warmup' || type === 'cooldown') return theme.colors.gray[5];
        if (type === 'recovery') return theme.colors.blue[2];
        
        if (intensity < 0.6) return theme.colors.blue[5];
        if (intensity < 0.8) return theme.colors.green[6];
        if (intensity < 0.95) return theme.colors.yellow[7];
        if (intensity < 1.05) return theme.colors.orange[7];
        return theme.colors.red[7];
    };

    return (
        <Box h={height} w="100%" style={{ display: 'flex', alignItems: 'flex-end', gap: 1, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 4, padding: 2 }}>
            {segments.map((seg, i) => {
                const widthPct = (seg.duration / totalDuration) * 100;
                const heightPct = Math.min(Math.max(seg.intensity * 100, 15), 100);
                
                return (
                    <Tooltip key={i} label={`${seg.type} | ${seg.label}`} withArrow fz="xs">
                        <Box
                            w={`${widthPct}%`}
                            h={`${heightPct}%`}
                            bg={getSegmentColor(seg.intensity, seg.type)}
                            style={{ 
                                borderRadius: '2px 2px 0 0',
                                opacity: 0.85,
                                minWidth: 2 // Ensure visible even if short
                            }}
                        />
                    </Tooltip>
                );
            })}
        </Box>
    );
};

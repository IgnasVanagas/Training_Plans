import React, { useMemo } from 'react';
import { Paper, Title } from '@mantine/core';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { WorkoutNode, ConcreteStep, RepeatStep } from '../../types/workout';

export const WorkoutVisualizer = ({ steps, ftp, weight }: { steps: WorkoutNode[], ftp?: number, weight?: number }) => {
    // Flatten steps into time-series data
    const data = useMemo(() => {
        let currentTime = 0;
        const points: any[] = [];
        
        const processNode = (node: WorkoutNode) => {
            if (node.type === 'block') {
                const concrete = node as ConcreteStep;
                let duration = 0;
                
                // Estimate duration if not time-based
                if (concrete.duration.type === 'time') duration = concrete.duration.value || 0;
                else if (concrete.duration.type === 'distance') duration = (concrete.duration.value || 0) / 1000 * 5 * 60; // Rough 5min/km pace
                else duration = 300; // default 5m for lap button/cals
                
                // Determine intensity (simplified for now)
                let intensity = 0;
                
                if (concrete.target.type === 'power') {
                    // Start of block
                    points.push({ time: currentTime / 60, power: concrete.target.min || concrete.target.value || 0, category: concrete.category });
                    // End of block
                    points.push({ time: (currentTime + duration) / 60, power: concrete.target.max || concrete.target.value || 0, category: concrete.category });
                } else if (concrete.target.type === 'heart_rate_zone') {
                    // Map zones to rough %FTP for visualization
                    const zone = concrete.target.zone || 1;
                    const zonePower = [50, 65, 80, 95, 105, 120, 150][zone - 1] || 50;
                    points.push({ time: currentTime / 60, power: zonePower, category: concrete.category });
                    points.push({ time: (currentTime + duration) / 60, power: zonePower, category: concrete.category });
                } else if (concrete.target.type === 'pace') {
                    // Pace is stored as seconds/km (e.g., 300s = 5:00 min/km)
                    // We want to visualize Intensity. Lower pace = Higher intensity.
                    // Let's map 6:00/km (360s) to ~50% intensity (warmup)
                    // and 3:00/km (180s) to ~120% intensity (hard intervals)
                    // Simple Formula: Intensity = 30000 / pace_s - 30 (Rough heuristic)
                    // 360s -> 83 - 30 = 53
                    // 300s -> 100 - 30 = 70
                    // 240s -> 125 - 30 = 95
                    // 180s -> 166 - 30 = 136
                    const pace = concrete.target.value || 360; 
                    const intensity = Math.max(0, 30000 / (pace || 360) - 30);
                    
                    points.push({ time: currentTime / 60, power: intensity, category: concrete.category });
                    points.push({ time: (currentTime + duration) / 60, power: intensity, category: concrete.category });

                } else {
                     // RPE or Open
                    const val = concrete.target.value || 50;
                     // Map RPE 1-10 to %?
                    const power = concrete.target.type === 'rpe' ? val * 10 : val;
                    points.push({ time: currentTime / 60, power: power, category: concrete.category });
                    points.push({ time: (currentTime + duration) / 60, power: power, category: concrete.category });
                }
                
                currentTime += duration;
            } else if (node.type === 'repeat') {
                const repeat = node as RepeatStep;
                for (let i = 0; i < repeat.repeats; i++) {
                    repeat.steps.forEach(processNode);
                }
            }
        };

        steps.forEach(processNode);
        return points;
    }, [steps]);

    return (
        <Paper p="md" withBorder h={300}>
            <Title order={5} mb="xs">Workout Profile</Title>
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="mainGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#fa5252" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#228be6" stopOpacity={0.8}/>
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis 
                        dataKey="time" 
                        type="number" 
                        label={{ value: 'Minutes', position: 'insideBottomRight', offset: -5 }} 
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(val) => Math.floor(val).toString()}
                    />
                    <YAxis label={{ value: 'Intensity', angle: -90, position: 'insideLeft' }} />
                    <RechartsTooltip contentStyle={{ backgroundColor: '#333', color: '#fff' }} itemStyle={{ color: '#fff' }} formatter={(val: number) => [Math.floor(val), 'Intensity']} labelFormatter={(l) => Math.floor(l) + ' min'} />
                    <Area 
                        type="stepAfter" 
                        dataKey="power" 
                        stroke="url(#mainGradient)" 
                        fill="url(#mainGradient)" 
                        fillOpacity={0.6}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </Paper>
    );
};

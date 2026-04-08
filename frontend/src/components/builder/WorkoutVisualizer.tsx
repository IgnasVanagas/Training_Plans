import { useMemo } from 'react';
import { Paper, Text, useComputedColorScheme } from '@mantine/core';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { WorkoutNode, ConcreteStep, RepeatStep } from '../../types/workout';

export const WorkoutVisualizer = ({ steps, ftp: _ftp, weight: _weight }: { steps: WorkoutNode[], ftp?: number, weight?: number }) => {
    const isDark = useComputedColorScheme('light') === 'dark';

    const data = useMemo(() => {
        let currentTime = 0;
        const points: any[] = [];

        const processNode = (node: WorkoutNode) => {
            if (node.type === 'block') {
                const concrete = node as ConcreteStep;
                let duration = 0;

                if (concrete.duration.type === 'time') duration = concrete.duration.value || 0;
                else if (concrete.duration.type === 'distance') duration = (concrete.duration.value || 0) / 1000 * 5 * 60;
                else duration = 300;

                let intensity = 0;

                if (concrete.target.type === 'power') {
                    points.push({ time: currentTime / 60, power: concrete.target.min || concrete.target.value || 0, category: concrete.category });
                    points.push({ time: (currentTime + duration) / 60, power: concrete.target.max || concrete.target.value || 0, category: concrete.category });
                } else if (concrete.target.type === 'heart_rate_zone') {
                    const zone = concrete.target.zone || 1;
                    const zonePower = [50, 65, 80, 95, 105, 120, 150][zone - 1] || 50;
                    points.push({ time: currentTime / 60, power: zonePower, category: concrete.category });
                    points.push({ time: (currentTime + duration) / 60, power: zonePower, category: concrete.category });
                } else if (concrete.target.type === 'pace') {
                    const pace = concrete.target.value || 360;
                    intensity = Math.max(0, 30000 / (pace || 360) - 30);
                    points.push({ time: currentTime / 60, power: intensity, category: concrete.category });
                    points.push({ time: (currentTime + duration) / 60, power: intensity, category: concrete.category });
                } else {
                    const val = concrete.target.value || 50;
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

    const surface = isDark ? '#12223E' : '#FFFFFF';
    const border = isDark ? 'rgba(148,163,184,0.22)' : '#DCE6F7';
    const axisColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(148,163,184,0.10)' : 'rgba(15,23,42,0.06)';
    const textDim = isDark ? '#9FB0C8' : '#52617A';
    const textMain = isDark ? '#E2E8F0' : '#0F172A';
    const tooltipBg = isDark ? 'rgba(12, 22, 42, 0.92)' : 'rgba(255,255,255,0.92)';

    return (
        <Paper
            p="md"
            withBorder
            radius="xl"
            h={300}
            bg={surface}
            style={{
                borderColor: border,
                boxShadow: isDark
                    ? '0 4px 24px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)'
                    : '0 4px 24px rgba(15,23,42,0.07)',
            }}
        >
            <Text fw={700} size="sm" mb="xs" c={textMain}>Workout Profile</Text>
            <ResponsiveContainer width="100%" height="85%">
                <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                        <linearGradient id="vizGradientFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor="#00c3f5" stopOpacity={0.85} />
                            <stop offset="45%"  stopColor="#fd7e14" stopOpacity={0.60} />
                            <stop offset="100%" stopColor="#fa5252" stopOpacity={0.20} />
                        </linearGradient>
                        <linearGradient id="vizGradientStroke" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor="#00c3f5" />
                            <stop offset="60%"  stopColor="#fd7e14" />
                            <stop offset="100%" stopColor="#fa5252" />
                        </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke={gridColor} />
                    <XAxis
                        dataKey="time"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(val) => `${Math.floor(val)}m`}
                        tick={{ fontSize: 10, fill: axisColor }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <YAxis
                        tick={{ fontSize: 10, fill: axisColor }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(val) => `${val}%`}
                    />
                    <RechartsTooltip
                        contentStyle={{
                            background: tooltipBg,
                            backdropFilter: 'blur(10px)',
                            WebkitBackdropFilter: 'blur(10px)',
                            border: `1px solid ${border}`,
                            borderRadius: 10,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                            fontSize: 12,
                            color: textMain,
                        }}
                        itemStyle={{ color: textDim }}
                        formatter={(val: number) => [`${Math.floor(val)}%`, 'Intensity']}
                        labelFormatter={(l) => `${Math.floor(Number(l))} min`}
                    />
                    <Area
                        type="stepAfter"
                        dataKey="power"
                        stroke="url(#vizGradientStroke)"
                        fill="url(#vizGradientFill)"
                        strokeWidth={2}
                        isAnimationActive={true}
                        animationDuration={600}
                        animationEasing="ease-out"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </Paper>
    );
};

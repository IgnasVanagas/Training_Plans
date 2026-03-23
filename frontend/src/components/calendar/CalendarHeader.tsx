import { format, addMonths, addWeeks } from 'date-fns';
import { ReactNode } from 'react';
import { Button, ActionIcon, Group, Popover, SegmentedControl, Box, Stack } from '@mantine/core';
import { MonthPicker } from '@mantine/dates';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { useComputedColorScheme } from '@mantine/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type CalendarHeaderProps = {
    date: Date;
    onNavigate: (date: Date) => void;
    currentView?: 'month' | 'week';
    onViewChange?: (view: 'month' | 'week') => void;
    monthlyTotalsLabel?: string;
    onMonthlyTotalsClick?: () => void;
    monthlyTotalsWidth?: number;
    actionButtons?: ReactNode;
};

const CalendarHeader = ({
    date,
    onNavigate,
    currentView = 'month',
    onViewChange,
    monthlyTotalsLabel,
    onMonthlyTotalsClick,
    monthlyTotalsWidth,
    actionButtons,
}: CalendarHeaderProps) => {
    const [opened, { open, close }] = useDisclosure(false);
    const isMobile = useMediaQuery('(max-width: 48em)');
    const isDark = useComputedColorScheme('light') === 'dark';
    const accentSecondary = '#6E4BF3';

    const handleNext = () => {
        // In both continuous and week views, navigate by 1 week for smooth scrolling
        onNavigate(addWeeks(date, 1));
    };
    const handlePrev = () => {
        onNavigate(addWeeks(date, -1));
    };
    const handleToday = () => {
        onNavigate(new Date());
    };

    const headerBg = isDark ? '#081226' : 'var(--mantine-color-body)';
    
    return (
        <Box
            mb={6}
            px={8}
            py={4}
            style={{
                borderRadius: 12,
                background: headerBg,
                border: 'none',
                boxShadow: 'none',
                fontFamily: '"Inter", sans-serif'
            }}
        >
            <Group justify="space-between" align="center" wrap="nowrap">
                {/* Left: navigation arrows + month/year + Today */}
                <Group gap={6} wrap="nowrap">
                    <ActionIcon
                        variant="subtle"
                        onClick={handlePrev}
                        size="sm"
                        styles={{ root: { borderRadius: 8, color: isDark ? '#94A3B8' : '#475569' } }}
                    >
                        <ChevronLeft size={14} />
                    </ActionIcon>

                    <Popover opened={opened} onChange={close} trapFocus position="bottom" withArrow shadow="md">
                        <Popover.Target>
                            <Button
                                variant="subtle"
                                size="compact-sm"
                                fw={800}
                                onClick={open}
                                styles={{ root: { borderRadius: 8, color: isDark ? '#E2E8F0' : '#1E293B', letterSpacing: '-0.01em', fontSize: 15 } }}
                            >
                                {format(date, 'MMM yyyy')}
                            </Button>
                        </Popover.Target>
                        <Popover.Dropdown>
                            <MonthPicker
                                value={date}
                                onChange={(val) => {
                                    if (val) {
                                        onNavigate(val);
                                        close();
                                    }
                                }}
                            />
                        </Popover.Dropdown>
                    </Popover>

                    <ActionIcon
                        variant="subtle"
                        onClick={handleNext}
                        size="sm"
                        styles={{ root: { borderRadius: 8, color: isDark ? '#94A3B8' : '#475569' } }}
                    >
                        <ChevronRight size={14} />
                    </ActionIcon>

                    <Button
                        variant="subtle"
                        size="compact-sm"
                        onClick={handleToday}
                        styles={{ root: { fontWeight: 600, borderRadius: 8, color: isDark ? '#F8FAFC' : '#1E293B' } }}
                    >
                        Today
                    </Button>
                </Group>

                {/* Right: action buttons */}
                <Group gap={6} wrap="nowrap" justify="flex-end">
                    {actionButtons}

                    {!isMobile && onViewChange && (
                        <SegmentedControl
                            size="xs"
                            radius="md"
                            value={currentView}
                            onChange={(value) => onViewChange(value as 'month' | 'week')}
                            data={[
                                { value: 'month', label: 'Month' },
                                { value: 'week', label: 'Week' },
                            ]}
                        />
                    )}

                    {!isMobile && currentView !== 'week' && monthlyTotalsLabel && onMonthlyTotalsClick && (
                        <Button
                            variant="subtle"
                            size="compact-sm"
                            onClick={onMonthlyTotalsClick}
                            w={monthlyTotalsWidth}
                            styles={{
                                root: {
                                    borderRadius: 8,
                                    fontWeight: 700,
                                    color: accentSecondary,
                                    border: `1px solid ${isDark ? 'rgba(110, 75, 243, 0.32)' : 'rgba(110, 75, 243, 0.2)'}`,
                                    background: isDark ? 'rgba(110, 75, 243, 0.08)' : 'rgba(110, 75, 243, 0.05)'
                                }
                            }}
                        >
                            {monthlyTotalsLabel}
                        </Button>
                    )}
                </Group>
            </Group>

            {isMobile && onViewChange && (
                <Stack mt={6}>
                    <SegmentedControl
                        size="xs"
                        radius="md"
                        value={currentView}
                        onChange={(value) => onViewChange(value as 'month' | 'week')}
                        data={[
                            { value: 'month', label: 'Month' },
                            { value: 'week', label: 'Week' },
                        ]}
                    />
                </Stack>
            )}
        </Box>
    );
};

export default CalendarHeader;

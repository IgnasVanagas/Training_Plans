import { format, addMonths, addWeeks } from 'date-fns';
import { Button, ActionIcon, Group, Popover, SegmentedControl, Box } from '@mantine/core';
import { MonthPicker } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { useComputedColorScheme } from '@mantine/core';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

type CalendarHeaderProps = {
    date: Date;
    onNavigate: (date: Date) => void;
    currentView?: 'month' | 'week';
    onViewChange?: (view: 'month' | 'week') => void;
    monthlyTotalsLabel?: string;
    onMonthlyTotalsClick?: () => void;
    monthlyTotalsWidth?: number;
};

const CalendarHeader = ({
    date,
    onNavigate,
    currentView = 'month',
    onViewChange,
    monthlyTotalsLabel,
    onMonthlyTotalsClick,
    monthlyTotalsWidth
}: CalendarHeaderProps) => {
    const [opened, { open, close }] = useDisclosure(false);
    const isDark = useComputedColorScheme('light') === 'dark';
    const accentPrimary = '#E95A12';
    const accentSecondary = '#6E4BF3';

    const handleNext = () => {
           onNavigate(currentView === 'week' ? addWeeks(date, 1) : addMonths(date, 1));
    };
    const handlePrev = () => {
            onNavigate(currentView === 'week' ? addWeeks(date, -1) : addMonths(date, -1));
    };
    const handleToday = () => {
        onNavigate(new Date());
    };
    const calendarCenterOffset = currentView === 'month' && monthlyTotalsWidth
        ? Math.round((monthlyTotalsWidth + 8) / 2)
        : 0;

    const headerBg = isDark ? '#081226' : 'var(--mantine-color-body)';
    
    return (
        <Box
            mb={6}
            px={8}
            py={4}
            style={{
                position: 'relative',
                borderRadius: 12,
                background: headerBg,
                border: 'none',
                boxShadow: 'none',
                fontFamily: '"Inter", sans-serif'
            }}
        >
            <Group justify="space-between" align="center" wrap="nowrap">
                <Group gap={6} wrap="nowrap">
                <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={handleToday}
                    styles={{ root: { fontWeight: 700, borderRadius: 8, color: isDark ? '#F8FAFC' : '#1E293B' } }}
                >
                    Today
                </Button>
                <ActionIcon
                    variant="subtle"
                    onClick={handlePrev}
                    size="sm"
                    styles={{ root: { borderRadius: 8, color: isDark ? '#94A3B8' : '#475569' } }}
                >
                    <ChevronLeft size={14} />
                </ActionIcon>
                <ActionIcon
                    variant="subtle"
                    onClick={handleNext}
                    size="sm"
                    styles={{ root: { borderRadius: 8, color: isDark ? '#94A3B8' : '#475569' } }}
                >
                    <ChevronRight size={14} />
                </ActionIcon>
                </Group>

                <Group gap={4} wrap="nowrap" justify="flex-end">
                {onViewChange && (
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

                {currentView === 'month' && monthlyTotalsLabel && onMonthlyTotalsClick && (
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
                        Monthly: {monthlyTotalsLabel}
                    </Button>
                )}
                </Group>
            </Group>

            <Box style={{ position: 'absolute', left: `calc(50% - ${calendarCenterOffset}px)`, top: '50%', transform: 'translate(-50%, -50%)' }}>
                <Popover opened={opened} onChange={close} trapFocus position="bottom" withArrow shadow="md">
                    <Popover.Target>
                        <Button
                            variant="subtle"
                            size="compact-sm"
                            fw={800}
                            onClick={open}
                            leftSection={<CalendarIcon size={14} />}
                            styles={{ root: { borderRadius: 8, color: isDark ? '#E2E8F0' : '#1E293B', letterSpacing: '-0.01em' } }}
                        >
                            {format(date, 'MMMM yyyy')}
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
            </Box>
        </Box>
    );
};

export default CalendarHeader;

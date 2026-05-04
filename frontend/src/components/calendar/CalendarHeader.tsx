import { format, addWeeks, addMonths } from 'date-fns';
import { enUS, lt as ltLocale } from 'date-fns/locale';
import { ReactNode } from 'react';
import { Button, ActionIcon, Group, Popover, SegmentedControl, Box, Stack } from '@mantine/core';
import { MonthPicker } from '@mantine/dates';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { useComputedColorScheme } from '@mantine/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../../i18n/I18nProvider';

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
    const { language, t } = useI18n();
    const calendarLocale = language === 'lt' ? ltLocale : enUS;

    const handleNext = () => {
        onNavigate(currentView === 'week' ? addWeeks(date, 1) : addMonths(date, 1));
    };
    const handlePrev = () => {
        onNavigate(currentView === 'week' ? addWeeks(date, -1) : addMonths(date, -1));
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
            <Group justify="space-between" align="center" wrap="nowrap" style={{ overflow: 'hidden' }}>
                {/* Left: navigation arrows + month/year + Today */}
                <Group gap={isMobile ? 2 : 6} wrap="nowrap">
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
                                styles={{ root: { borderRadius: 8, color: isDark ? '#E2E8F0' : '#1E293B', letterSpacing: '-0.01em', fontSize: isMobile ? 13 : 15, padding: isMobile ? '0 4px' : undefined } }}
                            >
                                {format(date, 'MMM yyyy', { locale: calendarLocale })}
                            </Button>
                        </Popover.Target>
                        <Popover.Dropdown>
                            <MonthPicker
                                locale={language}
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
                        {t('Today')}
                    </Button>
                </Group>

                {/* Right: action buttons */}
                <Group gap={isMobile ? 2 : 6} wrap="nowrap" justify="flex-end" style={{ flexShrink: 0 }}>
                    {actionButtons}

                    {!isMobile && onViewChange && (
                        <SegmentedControl
                            size="xs"
                            radius="md"
                            value={currentView}
                            onChange={(value) => onViewChange(value as 'month' | 'week')}
                            data={[
                                { value: 'month', label: t('Month') },
                                { value: 'week', label: t('Week') },
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
                            { value: 'month', label: t('Month') },
                            { value: 'week', label: t('Week') },
                        ]}
                    />
                </Stack>
            )}
        </Box>
    );
};

export default CalendarHeader;

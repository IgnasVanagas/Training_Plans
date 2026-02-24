import { format } from 'date-fns';
import { Button, ActionIcon, Group, Popover } from '@mantine/core';
import { MonthPicker } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

type CalendarHeaderProps = {
    date: Date;
    onNavigate: (date: Date) => void;
};

const CalendarHeader = ({ date, onNavigate }: CalendarHeaderProps) => {
    const [opened, { open, close }] = useDisclosure(false);

    const handleNext = () => {
        onNavigate(new Date(date.getFullYear(), date.getMonth() + 1, 1));
    };
    const handlePrev = () => {
         onNavigate(new Date(date.getFullYear(), date.getMonth() - 1, 1));
    };
    const handleToday = () => {
        onNavigate(new Date());
    };
    
    return (
        <Group
            justify="space-between"
            mb={8}
            align="center"
            wrap="nowrap"
            p="6px 8px"
            style={{
                borderRadius: 10,
                border: '1px solid var(--mantine-color-default-border)',
                background: 'var(--mantine-color-body)'
            }}
        >
            <Group gap={6} wrap="nowrap">
                <Button variant="default" size="compact-xs" onClick={handleToday}>Today</Button>
                <ActionIcon variant="default" onClick={handlePrev} size="md"><ChevronLeft size={16} /></ActionIcon>
                <ActionIcon variant="default" onClick={handleNext} size="md"><ChevronRight size={16} /></ActionIcon>
            </Group>

            <Popover opened={opened} onChange={close} trapFocus position="bottom" withArrow shadow="md">
                <Popover.Target>
                    <Button variant="subtle" size="compact-sm" fw={800} onClick={open} leftSection={<CalendarIcon size={15} />}>
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
        </Group>
    );
};

export default CalendarHeader;

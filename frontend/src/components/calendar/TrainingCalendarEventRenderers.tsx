import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { Download } from 'lucide-react';
import { format } from 'date-fns';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import SportIcon from './SportIcon';
import { CalendarEvent } from './types';
import { formatMinutesHm } from './dateUtils';
import { resolveActivityAccentColor } from './activityStyling';

type Palette = {
  cardBg: string;
  cardBorder: string;
  textDim: string;
  textMain: string;
};

export const CalendarEventCard = ({
  event,
  activityColors,
  isDark,
  palette,
  preferredUnits,
}: {
  event: any;
  activityColors: any;
  isDark: boolean;
  palette: Palette;
  preferredUnits?: string | null;
}) => {
  const r = event.resource as CalendarEvent;

  if (r.is_more_indicator) {
    return (
      <Box
        p="4px 6px"
        style={{
          minHeight: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(71, 85, 105, 0.35)'}`,
            background: isDark ? 'rgba(62, 79, 111, 0.52)' : 'rgba(226, 232, 240, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text size="10px" fw={800} c={palette.textMain}>+{r.hidden_count || 0}</Text>
        </Box>
      </Box>
    );
  }

  const accentColor = resolveActivityAccentColor(activityColors, r.sport_type, r.title);
  const isPlanned = Boolean(r.is_planned);
  const cardShadow = isDark
    ? `0 10px 22px -20px ${accentColor}CC`
    : '0 12px 26px -22px rgba(30, 64, 175, 0.34)';

  const formatDist = (val?: number | null) => {
    if (!val) return '-';
    if (preferredUnits === 'imperial') {
      return `${(val * 0.621371).toFixed(1)}mi`;
    }
    return `${val.toFixed(1)}km`;
  };

  const formatDuration = (minutes?: number | null) => formatMinutesHm(minutes);

  const formatClockTime = (dt?: Date) => {
    if (!dt) return '';
    const hours = dt.getHours();
    const mins = dt.getMinutes();
    if (hours === 0 && mins === 0) return '';
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const timeLabel = formatClockTime(event.start);
  const durationLabel = r.is_planned ? formatDuration(r.planned_duration) : formatDuration(r.duration);
  const distanceLabel = r.is_planned ? formatDist(r.planned_distance) : formatDist(r.distance);
  const primaryMetric = (distanceLabel !== '-' && durationLabel !== '-')
    ? `${distanceLabel} / ${durationLabel}`
    : distanceLabel !== '-'
      ? distanceLabel
      : (durationLabel !== '-' ? durationLabel : '—');
  const metricParts = [timeLabel].filter(Boolean);

  return (
    <Box
      p="4px 6px"
      style={{
        backgroundColor: isPlanned ? (isDark ? 'rgba(30, 41, 59, 0.42)' : 'rgba(248, 250, 252, 0.88)') : palette.cardBg,
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: `1px ${isPlanned ? 'dashed' : 'solid'} ${isPlanned ? `${accentColor}77` : palette.cardBorder}`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: '8px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        fontFamily: '"Inter", sans-serif',
        boxShadow: cardShadow,
        opacity: 1,
        minHeight: 28,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = isDark
          ? `0 16px 34px -20px ${accentColor}EE`
          : '0 22px 52px -20px rgba(15, 23, 42, 0.40)';
        e.currentTarget.style.borderLeftColor = accentColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = cardShadow;
        e.currentTarget.style.borderLeftColor = accentColor;
      }}
    >
      <Group gap={5} wrap="nowrap" align="center" pl={1}>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" align="center" wrap="nowrap" gap={6}>
            <Text size="xs" fw={900} c={palette.textMain} style={{ lineHeight: 1.1, letterSpacing: '-0.01em' }}>
              {primaryMetric}
            </Text>
          </Group>
          <Group gap={5} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
            <Box style={{ color: accentColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <SportIcon sport={r.sport_type || 'Activity'} size={12} />
            </Box>
            <Text
              size="10px"
              fw={700}
              c={palette.textDim}
              style={{
                opacity: 1,
                textTransform: 'uppercase',
                letterSpacing: 0.35,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                flex: 1,
              }}
            >
              {(r.title || 'Session').toUpperCase()}
            </Text>
            {metricParts.length > 0 && (
              <Text size="10px" fw={600} c={palette.textDim} style={{ opacity: 0.95, whiteSpace: 'nowrap' }}>
                · {metricParts.join(' · ')}
              </Text>
            )}
          </Group>
        </Stack>
      </Group>
    </Box>
  );
};

export const DayEventItem = ({
  r,
  isDark,
  activityColors,
  palette,
  athleteId,
  viewDate,
  onPlannedSelect,
  onCloseDayModal,
  onDownloadPlannedWorkout,
}: {
  r: CalendarEvent;
  isDark: boolean;
  activityColors: Record<string, string>;
  palette: { cardBg: string; cardBorder: string; textDim: string; textMain: string };
  athleteId?: number | null;
  viewDate: Date;
  onPlannedSelect: (event: CalendarEvent) => void;
  onCloseDayModal: () => void;
  onDownloadPlannedWorkout: (workoutId: number) => void;
}) => {
  const navigate = useNavigate();

  const formatSpeed = (speed: number | undefined, sport?: string) => {
    if (!speed) return '';
    if (sport?.toLowerCase().includes('run')) {
      if (speed === 0) return '-:--';
      const paceDec = 1000 / (speed * 60);
      const mins = Math.floor(paceDec);
      const secs = Math.round((paceDec - mins) * 60);
      return `${mins}:${secs.toString().padStart(2, '0')}/km`;
    }
    const kmh = speed * 3.6;
    return `${kmh.toFixed(1)} km/h`;
  };

  const borderColor = palette.cardBorder;
  const bgColor = palette.cardBg;
  const accentColor = resolveActivityAccentColor(activityColors as any, r.sport_type, r.title);

  return (
    <Paper
      onClick={() => {
        if (!r.is_planned) {
          if (r.id) {
            navigate(`/dashboard/activities/${r.id}`, {
              state: {
                returnTo: athleteId ? `/dashboard/athlete/${athleteId}` : '/dashboard',
                activeTab: athleteId ? undefined : 'plan',
                selectedAthleteId: athleteId ? athleteId.toString() : null,
                calendarDate: format(viewDate, 'yyyy-MM-dd'),
              },
            });
            onCloseDayModal();
          }
          return;
        }
        onPlannedSelect(r);
      }}
      style={{
        border: `1px solid ${borderColor}`,
        borderLeft: `4px solid ${accentColor}`,
        boxShadow: isDark ? `0 10px 22px -20px ${accentColor}A6` : '0 10px 20px -22px rgba(15, 23, 42, 0.24)',
      }}
      bg={bgColor}
      p={10}
      radius="md"
      mb={10}
    >
      <Group justify="space-between">
        <Group gap="xs">
          <Box style={{ color: accentColor, display: 'inline-flex' }}>
            <SportIcon sport={r.sport_type || 'other'} size={15} />
          </Box>
          <Text fw={700} size="sm" c={palette.textMain}>{r.title}</Text>
          {!r.is_planned && <Badge size="xs" variant="light" color="gray">Completed</Badge>}
        </Group>
        <Text size="xs" c={palette.textDim} fw={700}>
          {r.is_planned ? formatMinutesHm(r.planned_duration) : formatMinutesHm(r.duration)}
        </Text>
      </Group>
      {!r.is_planned && (
        <Text size="xs" mt={5} c={palette.textDim}>
          {(r.distance || 0).toFixed(1)}km · {formatSpeed(r.avg_speed, r.sport_type)}
        </Text>
      )}
      {r.is_planned && r.id && (
        <Group justify="space-between" mt={6}>
          <Text size="xs" c={palette.textDim}>
            {r.created_by_name ? `Created by ${r.created_by_name}` : ""}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<Download size={14} />}
            onClick={(event) => {
              event.stopPropagation();
              onDownloadPlannedWorkout(r.id as number);
            }}
          >
            Download
          </Button>
        </Group>
      )}
    </Paper>
  );
};

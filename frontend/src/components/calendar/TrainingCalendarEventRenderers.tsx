import { Badge, Box, Button, Group, Paper, Text } from '@mantine/core';
import { Download, MessageSquareText } from 'lucide-react';
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
  const isRestDay = r.sport_type?.toLowerCase() === 'rest' || r.title?.toLowerCase() === 'rest day';
  const durationLabel = r.is_planned ? formatDuration(r.planned_duration) : formatDuration(r.duration);
  const distanceLabel = r.is_planned ? formatDist(r.planned_distance) : formatDist(r.distance);
  const primaryMetric = isRestDay
    ? 'Rest Day'
    : (distanceLabel !== '-' && durationLabel !== '-')
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
        <Box style={{ color: accentColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <SportIcon sport={r.sport_type || 'Activity'} size={12} />
        </Box>
        <Text size="xs" fw={900} c={palette.textMain} style={{ lineHeight: 1.1, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {primaryMetric}
        </Text>
      </Group>
      {r.title && !isRestDay && (
        <Text size="10px" c={palette.textDim} pl={1} style={{ lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.title}
        </Text>
      )}
    </Box>
  );
};

export const NoteChip = ({
  note,
  isDark,
  palette,
}: {
  note: { content: string; author_name?: string | null; author_role?: string | null };
  isDark: boolean;
  palette: Palette;
}) => {
  const accentColor = isDark ? '#60A5FA' : '#3B82F6';
  const cardShadow = isDark
    ? `0 10px 22px -20px ${accentColor}CC`
    : '0 12px 26px -22px rgba(30, 64, 175, 0.34)';

  return (
    <Box
      p="4px 6px"
      style={{
        backgroundColor: isDark ? 'rgba(30, 41, 59, 0.42)' : 'rgba(248, 250, 252, 0.88)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: `1px solid ${accentColor}55`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: '8px',
        overflow: 'hidden',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        fontFamily: '"Inter", sans-serif',
        boxShadow: cardShadow,
        minHeight: 28,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = isDark
          ? `0 16px 34px -20px ${accentColor}EE`
          : '0 22px 52px -20px rgba(15, 23, 42, 0.40)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = cardShadow;
      }}
    >
      <Group gap={5} wrap="nowrap" align="center" pl={1}>
        <Box style={{ color: accentColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <MessageSquareText size={12} />
        </Box>
        <Text size="xs" fw={700} c={palette.textMain} style={{ lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {note.content}
        </Text>
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
  onDuplicateSelect,
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
  onDuplicateSelect?: (event: CalendarEvent) => void;
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
            if ((r.duplicate_recordings_count ?? 0) > 0 && onDuplicateSelect) {
              onDuplicateSelect(r);
              onCloseDayModal();
              return;
            }
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
          {r.is_planned && r.approval_status === 'pending' && <Badge size="xs" variant="light" color="orange">Pending approval</Badge>}
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
          <Box>
            <Text size="xs" c={palette.textDim}>
              {r.created_by_name ? `Created by ${r.created_by_name}` : ""}
            </Text>
            {r.planning_context?.phase && (
              <Text size="xs" c={palette.textDim}>
                {`${r.planning_context.phase.toUpperCase()}${r.planning_context.countdown_days != null ? ` • ${r.planning_context.countdown_days}d` : ""}`}
              </Text>
            )}
            {r.approval_status === 'pending' && (
              <Text size="xs" c={palette.textDim}>
                {`Pending ${r.approval_request_type || 'change'}${r.approval_requested_by_name ? ` • ${r.approval_requested_by_name}` : ''}`}
              </Text>
            )}
          </Box>
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

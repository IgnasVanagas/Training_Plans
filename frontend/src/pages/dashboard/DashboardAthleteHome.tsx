import { Alert, Button, Card, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import {
  IconActivity,
  IconAlertTriangle,
  IconBolt,
  IconHeart,
  IconMoon,
  IconRun,
  IconTargetArrow,
} from "@tabler/icons-react";
import { DashboardCalendarEvent, MetricKey, TrainingStatus, User } from "./types";
import { formatDuration, formatMinutesHm } from "./utils";

type Props = {
  isDark: boolean;
  me: User;
  todayWorkout?: DashboardCalendarEvent;
  wellnessSummary: any;
  integrations: any[];
  trainingStatus?: TrainingStatus;
  onOpenPlan: () => void;
  onSelectMetric: (metric: MetricKey) => void;
};

const DashboardAthleteHome = ({
  isDark,
  me,
  todayWorkout,
  wellnessSummary,
  integrations,
  trainingStatus,
  onOpenPlan,
  onSelectMetric,
}: Props) => {
  const cardBg = isDark ? 'rgba(22, 34, 58, 0.62)' : 'rgba(255, 255, 255, 0.92)';
  const cardBorder = isDark ? 'rgba(148, 163, 184, 0.26)' : 'rgba(15, 23, 42, 0.14)';

  return (
    <Stack style={{ fontFamily: '"Inter", sans-serif' }}>
      <Paper withBorder p="lg" radius="md" shadow="sm" bg={cardBg} style={{ borderColor: cardBorder }}>
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Group gap="xs">
              <ThemeIcon color="orange" variant="light" radius="xl"><IconTargetArrow size={16} /></ThemeIcon>
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">Today’s Workout</Text>
            </Group>
            <Title order={3}>{todayWorkout?.title || "No workout planned yet"}</Title>
            <Text size="sm" c="dimmed">
              {todayWorkout
                ? `${todayWorkout.sport_type || "Session"} · ${formatMinutesHm(todayWorkout.planned_duration)} · Stay smooth, not rushed.`
                : "Sync your device or ask your coach to schedule today’s session."}
            </Text>
          </Stack>
          <Group>
            <Button variant="filled" style={{ background: '#E95A12' }} onClick={onOpenPlan}>{todayWorkout ? "Open Plan" : "Build Session"}</Button>
          </Group>
        </Group>
      </Paper>

      {integrations.some((provider) => provider.last_error) && (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
          Sync needs attention, but your completed workouts are safe. Open Settings → Integrations to reconnect and continue.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        {me.profile?.main_sport === "running" ? (
          <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ borderColor: cardBorder }}>
            <Group justify="space-between" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>LT2</Text>
              <IconRun size={20} color="green" />
            </Group>
            <Text fw={700} size="xl">
              {me.profile?.lt2
                ? (me.profile.preferred_units === "imperial"
                  ? formatDuration(me.profile.lt2 * 1.60934)
                  : formatDuration(me.profile.lt2))
                : "-"}
            </Text>
            <Text size="xs" c="dimmed" mt="xs">{me.profile?.preferred_units === "imperial" ? "min/mi" : "min/km"}</Text>
          </Card>
        ) : (
          <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: "pointer", borderColor: cardBorder }} onClick={() => onSelectMetric("ftp")}>
            <Group justify="space-between" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700}>FTP</Text>
              <IconBolt size={20} color="orange" />
            </Group>
            <Text fw={700} size="xl">{me.profile?.ftp ?? "-"}</Text>
            <Text size="xs" c="dimmed" mt="xs">Watts</Text>
          </Card>
        )}

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: "pointer", borderColor: cardBorder }} onClick={() => onSelectMetric("rhr")}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Resting Heart Rate</Text>
            <IconHeart size={20} color="red" />
          </Group>
          <Text fw={700} size="xl">{wellnessSummary?.resting_hr?.value ?? me.profile?.resting_hr ?? "-"}</Text>
          <Text size="xs" c="dimmed" mt="xs">BPM</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: "pointer", borderColor: cardBorder }} onClick={() => onSelectMetric("hrv")}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>HRV</Text>
            <IconHeart size={20} color="violet" />
          </Group>
          <Text fw={700} size="xl">{wellnessSummary?.hrv?.value ?? me.profile?.hrv_ms ?? "-"}</Text>
          <Text size="xs" c="dimmed" mt="xs">ms</Text>
        </Card>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 3 }} mt="md">
        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: "pointer", borderColor: cardBorder }} onClick={() => onSelectMetric("aerobic_load")}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Aerobic Load (7d)</Text>
            <IconActivity size={20} color="#E95A12" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus ? trainingStatus.acute.aerobic.toFixed(1) : "-"}</Text>
          <Text size="xs" c="dimmed" mt="xs">Load points</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: "pointer", borderColor: cardBorder }} onClick={() => onSelectMetric("anaerobic_load")}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Anaerobic Load (7d)</Text>
            <IconBolt size={20} color="red" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus ? trainingStatus.acute.anaerobic.toFixed(1) : "-"}</Text>
          <Text size="xs" c="dimmed" mt="xs">Load points</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: "pointer", borderColor: cardBorder }} onClick={() => onSelectMetric("training_status")}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Training Status</Text>
            <IconActivity size={20} color="#6E4BF3" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus?.training_status || "-"}</Text>
          <Text size="xs" c="dimmed" mt="xs">
            Acute {trainingStatus ? trainingStatus.acute.daily_load.toFixed(1) : "-"} / Chronic {trainingStatus ? trainingStatus.chronic.daily_load.toFixed(1) : "-"}
          </Text>
        </Card>
      </SimpleGrid>

      {(wellnessSummary?.sleep || wellnessSummary?.stress) && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mt="md">
          {wellnessSummary?.sleep && (
            <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ borderColor: cardBorder }}>
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Sleep</Text>
                <IconMoon size={20} color="indigo" />
              </Group>
              <Text fw={700} size="xl">{`${(wellnessSummary.sleep.duration_seconds / 3600).toFixed(1)} h`}</Text>
              <Text size="xs" c="dimmed" mt="xs">{`${wellnessSummary.sleep.provider} · ${new Date(wellnessSummary.sleep.end_time).toLocaleDateString()}`}</Text>
            </Card>
          )}

          {wellnessSummary?.stress && (
            <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ borderColor: cardBorder }}>
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Stress</Text>
                <IconBolt size={20} color="orange" />
              </Group>
              <Text fw={700} size="xl">{wellnessSummary.stress.value}</Text>
              <Text size="xs" c="dimmed" mt="xs">{`${wellnessSummary.stress.provider} · ${wellnessSummary.stress.date}`}</Text>
            </Card>
          )}
        </SimpleGrid>
      )}
    </Stack>
  );
};

export default DashboardAthleteHome;

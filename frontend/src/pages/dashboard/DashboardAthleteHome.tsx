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
  isTodayWorkout?: boolean;
  wellnessSummary: any;
  integrations: any[];
  trainingStatus?: TrainingStatus;
  onOpenPlan: () => void;
  onSelectMetric: (metric: MetricKey) => void;
  onRespondInvitation: (organizationId: number, action: "accept" | "decline") => void;
  respondingInvitation: boolean;
};

const DashboardAthleteHome = ({
  isDark,
  me,
  todayWorkout,
  isTodayWorkout,
  wellnessSummary,
  integrations,
  trainingStatus,
  onOpenPlan,
  onSelectMetric,
  onRespondInvitation,
  respondingInvitation,
}: Props) => {
  const cardBg = isDark ? 'rgba(22, 34, 58, 0.62)' : 'rgba(255, 255, 255, 0.92)';
  const cardBorder = isDark ? 'rgba(148, 163, 184, 0.26)' : 'rgba(15, 23, 42, 0.14)';
  const pendingInvites = (me.organization_memberships || []).filter(
    (membership) => membership.role === "athlete" && membership.status === "pending"
  );
  const pendingInviteOrgNames = pendingInvites
    .map((membership) => membership.organization?.name)
    .filter((name): name is string => Boolean(name && name.trim()));
  const joinedGroups = (me.organization_memberships || []).filter(
    (membership) => membership.role === "athlete" && membership.status === "active"
  );
  const joinedGroupNames = joinedGroups
    .map((membership) => membership.organization?.name)
    .filter((name): name is string => Boolean(name && name.trim()));
  const coachNames = (me.coaches || []).map((coach) => {
    const fullName = `${coach.first_name || ""} ${coach.last_name || ""}`.trim();
    return fullName || coach.email;
  });

  return (
    <Stack style={{ fontFamily: '"Inter", sans-serif' }}>
      {pendingInvites.length > 0 && (
        <Alert color="blue" variant="light" icon={<IconAlertTriangle size={16} />}>
          <Stack gap={8}>
            <Text size="sm">
              {pendingInviteOrgNames.length > 0
                ? `You have an invitation to join ${pendingInviteOrgNames.join(", ")}.`
                : "You have a team invitation."}
              {" "}Your access is pending coach approval.
            </Text>
            <Group gap="xs">
              {pendingInvites.map((membership) => {
                const orgId = membership.organization?.id;
                if (!orgId) return null;
                const orgName = membership.organization?.name || `Team #${orgId}`;
                return (
                  <Stack key={orgId} gap={4}>
                    {membership.message && (
                      <Text size="xs" fs="italic" c="dimmed">"{membership.message}"</Text>
                    )}
                    <Group gap={6}>
                      <Button size="xs" variant="light" loading={respondingInvitation} onClick={() => onRespondInvitation(orgId, "accept")}>
                        Accept {orgName}
                      </Button>
                      <Button size="xs" color="red" variant="subtle" loading={respondingInvitation} onClick={() => onRespondInvitation(orgId, "decline")}>
                        Decline
                      </Button>
                    </Group>
                  </Stack>
                );
              })}
            </Group>
          </Stack>
        </Alert>
      )}

      <Paper withBorder p="lg" radius="md" shadow="sm" bg={cardBg} style={{ borderColor: cardBorder }}>
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Stack gap={4}>
            <Group gap="xs">
              <ThemeIcon color="orange" variant="light" radius="xl"><IconTargetArrow size={16} /></ThemeIcon>
              <Text size="xs" tt="uppercase" fw={700} c="dimmed">{isTodayWorkout ? "Today’s Workout" : "Next Workout"}</Text>
            </Group>
            <Title order={3}>{todayWorkout?.title || "No workout planned yet"}</Title>
            <Text size="sm" c="dimmed">
              {todayWorkout
                ? `${todayWorkout.date} · ${todayWorkout.sport_type || "Session"} · ${formatMinutesHm(todayWorkout.planned_duration)} · Stay smooth, not rushed.`
                : "Sync your device or ask your coach to schedule today’s session."}
            </Text>
            {todayWorkout?.created_by_name && (
              <Text size="xs" c="dimmed">Created by: {todayWorkout.created_by_name}</Text>
            )}
            <Text size="xs" c="dimmed">
              Coach: {coachNames.length > 0 ? coachNames.join(", ") : "No active coach assigned"}
            </Text>
            <Text size="xs" c="dimmed">
              Groups: {joinedGroupNames.length > 0 ? joinedGroupNames.join(", ") : "No active groups"}
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
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>ATL</Text>
            <IconActivity size={20} color="#E95A12" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus ? trainingStatus.atl?.toFixed(1) ?? "-" : "-"}</Text>
          <Text size="xs" c="dimmed" mt="xs">Acute Training Load (7d)</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: "pointer", borderColor: cardBorder }} onClick={() => onSelectMetric("anaerobic_load")}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>CTL</Text>
            <IconBolt size={20} color="#2563eb" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus ? trainingStatus.ctl?.toFixed(1) ?? "-" : "-"}</Text>
          <Text size="xs" c="dimmed" mt="xs">Chronic Training Load (42d)</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ cursor: "pointer", borderColor: cardBorder }} onClick={() => onSelectMetric("training_status")}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Training Status</Text>
            <IconActivity size={20} color="#6E4BF3" />
          </Group>
          <Text fw={700} size="xl">{trainingStatus?.training_status || "-"}</Text>
          <Text size="xs" c="dimmed" mt="xs">
            Form {trainingStatus ? ((trainingStatus.tsb ?? 0) >= 0 ? "+" : "") + (trainingStatus.tsb?.toFixed(1) ?? "-") : "-"}
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

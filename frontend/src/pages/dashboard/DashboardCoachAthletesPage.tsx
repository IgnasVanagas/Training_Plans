import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconCalendar,
  IconChartBar,
  IconClock,
  IconMessageCircle,
  IconSearch,
  IconSettings,
  IconUser,
  IconUsersGroup,
} from "@tabler/icons-react";
import api from "../../api/client";
import { useI18n } from "../../i18n/I18nProvider";
import { User } from "./types";
import { QueryErrorAlert } from "../../components/common/QueryErrorAlert";
import { formatMinutesHm } from "./utils";

type Props = {
  me: User;
  athletes: User[];
  onOpenAthleteSettings: (athleteId: string) => void;
  onOpenAthleteCalendar: (athleteId: string) => void;
  onOpenAthleteMessages: (athleteId: string, organizationId: number | null) => void;
};

type ActivityListItem = {
  id: number;
  athlete_id: number;
  filename: string;
  created_at: string;
  sport?: string | null;
  distance?: number | null;
  duration?: number | null;
  moving_time?: number | null;
  average_hr?: number | null;
  average_watts?: number | null;
  total_load_impact?: number | null;
};

type ActivityTotals = {
  sessions: number;
  totalMinutes: number;
  totalDistanceKm: number;
  totalLoad: number;
};

type AthleteActivitySummary = {
  recent: ActivityListItem[];
  lastActivity: ActivityListItem | null;
  last7: ActivityTotals;
  last30: ActivityTotals;
};

const emptyTotals = (): ActivityTotals => ({
  sessions: 0,
  totalMinutes: 0,
  totalDistanceKm: 0,
  totalLoad: 0,
});

const getAthleteName = (athlete: User): string => (
  (athlete.profile?.first_name || athlete.profile?.last_name)
    ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
    : athlete.email
);

const formatSportLabel = (sport?: string | null): string => {
  if (!sport) return "other";
  return sport;
};

const formatDistanceKm = (meters?: number | null): string => {
  if (typeof meters !== "number" || Number.isNaN(meters) || meters <= 0) return "-";
  return `${(meters / 1000).toFixed(1)} km`;
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
};

const addToTotals = (totals: ActivityTotals, activity: ActivityListItem) => {
  const durationSeconds = typeof activity.moving_time === "number"
    ? activity.moving_time
    : typeof activity.duration === "number"
      ? activity.duration
      : 0;
  totals.sessions += 1;
  totals.totalMinutes += durationSeconds / 60;
  totals.totalDistanceKm += (activity.distance || 0) / 1000;
  totals.totalLoad += activity.total_load_impact || 0;
};

const DashboardCoachAthletesPage = ({
  me,
  athletes,
  onOpenAthleteSettings,
  onOpenAthleteCalendar,
  onOpenAthleteMessages,
}: Props) => {
  const { t } = useI18n();
  const isDark = useComputedColorScheme("light") === "dark";
  const [searchValue, setSearchValue] = useState("");
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(athletes[0] ? String(athletes[0].id) : null);

  const activitiesQuery = useQuery({
    queryKey: ["coach-athlete-roster-activities"],
    enabled: athletes.length > 0,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const response = await api.get<ActivityListItem[]>("/activities/", {
        params: { limit: 500 },
      });
      return response.data;
    },
  });

  const filteredAthletes = useMemo(() => {
    const needle = searchValue.trim().toLowerCase();
    if (!needle) return athletes;
    return athletes.filter((athlete) => {
      const haystack = `${getAthleteName(athlete)} ${athlete.email}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [athletes, searchValue]);

  const activitySummaryByAthlete = useMemo(() => {
    const grouped = new Map<number, AthleteActivitySummary>();
    const now = Date.now();
    const sevenDayThreshold = now - (7 * 24 * 60 * 60 * 1000);
    const thirtyDayThreshold = now - (30 * 24 * 60 * 60 * 1000);

    athletes.forEach((athlete) => {
      grouped.set(athlete.id, {
        recent: [],
        lastActivity: null,
        last7: emptyTotals(),
        last30: emptyTotals(),
      });
    });

    const sortedActivities = [...(activitiesQuery.data || [])].sort((left, right) => (
      left.created_at < right.created_at ? 1 : left.created_at > right.created_at ? -1 : 0
    ));

    sortedActivities.forEach((activity) => {
      const summary = grouped.get(activity.athlete_id);
      if (!summary) return;
      const activityTime = new Date(activity.created_at).getTime();
      if (Number.isNaN(activityTime)) return;

      if (!summary.lastActivity) {
        summary.lastActivity = activity;
      }
      if (summary.recent.length < 5) {
        summary.recent.push(activity);
      }
      if (activityTime >= sevenDayThreshold) {
        addToTotals(summary.last7, activity);
      }
      if (activityTime >= thirtyDayThreshold) {
        addToTotals(summary.last30, activity);
      }
    });

    return grouped;
  }, [activitiesQuery.data, athletes]);

  const selectedAthlete = useMemo(() => {
    const availableIds = new Set(filteredAthletes.map((athlete) => String(athlete.id)));
    if (selectedAthleteId && availableIds.has(selectedAthleteId)) {
      return filteredAthletes.find((athlete) => String(athlete.id) === selectedAthleteId) || null;
    }
    return filteredAthletes[0] || null;
  }, [filteredAthletes, selectedAthleteId]);

  const selectedSummary = selectedAthlete ? activitySummaryByAthlete.get(selectedAthlete.id) : null;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <div>
          <Group gap="xs" mb={4}>
            <ThemeIcon size="lg" radius="xl" variant="light" color="blue">
              <IconUsersGroup size={18} />
            </ThemeIcon>
            <Title order={3}>{t("Athletes") || "Athletes"}</Title>
          </Group>
          <Text size="sm" c="dimmed">
            {t("Browse every athlete, jump to settings or calendar, and open direct coach conversations.") || "Browse every athlete, jump to settings or calendar, and open direct coach conversations."}
          </Text>
        </div>
        <TextInput
          w={320}
          value={searchValue}
          onChange={(event) => setSearchValue(event.currentTarget.value)}
          placeholder={t("Search athletes by name or email") || "Search athletes by name or email"}
          leftSection={<IconSearch size={16} />}
        />
      </Group>

      {activitiesQuery.isError && <QueryErrorAlert error={activitiesQuery.error} onRetry={() => void activitiesQuery.refetch()} title="Failed to load activity data" />}

      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb="sm">
            <Title order={4}>{t("Roster") || "Roster"}</Title>
            <Badge variant="light">{filteredAthletes.length}</Badge>
          </Group>
          {filteredAthletes.length === 0 ? (
            <Text size="sm" c="dimmed">{t("No athletes found") || "No athletes found"}</Text>
          ) : (
            <ScrollArea type="auto" offsetScrollbars>
              <Table striped highlightOnHover verticalSpacing="sm" miw={720}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("Athlete") || "Athlete"}</Table.Th>
                    <Table.Th>{t("Last activity") || "Last activity"}</Table.Th>
                    <Table.Th>{t("Last 7 days") || "Last 7 days"}</Table.Th>
                    <Table.Th>{t("Last 30 days") || "Last 30 days"}</Table.Th>
                    <Table.Th>{t("Actions") || "Actions"}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredAthletes.map((athlete) => {
                    const isSelected = selectedAthlete?.id === athlete.id;
                    const summary = activitySummaryByAthlete.get(athlete.id);
                    return (
                      <Table.Tr
                        key={athlete.id}
                        onClick={() => setSelectedAthleteId(String(athlete.id))}
                        style={{ cursor: "pointer", background: isSelected ? (isDark ? "rgba(37,99,235,0.10)" : "rgba(37,99,235,0.06)") : undefined }}
                      >
                        <Table.Td>
                          <Group gap="sm" wrap="nowrap">
                            <Avatar radius="xl" color="blue">{getAthleteName(athlete).slice(0, 1).toUpperCase()}</Avatar>
                            <Stack gap={0}>
                              <Text size="sm" fw={600}>{getAthleteName(athlete)}</Text>
                              <Text size="xs" c="dimmed">{athlete.email}</Text>
                            </Stack>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          {summary?.lastActivity ? (
                            <Stack gap={0}>
                              <Text size="sm">{summary.lastActivity.filename}</Text>
                              <Text size="xs" c="dimmed">{formatDateTime(summary.lastActivity.created_at)}</Text>
                            </Stack>
                          ) : <Text size="sm" c="dimmed">{t("No recent activity") || "No recent activity"}</Text>}
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{summary ? `${summary.last7.sessions} · ${formatMinutesHm(summary.last7.totalMinutes)}` : "-"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{summary ? `${summary.last30.sessions} · ${formatMinutesHm(summary.last30.totalMinutes)}` : "-"}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} wrap="nowrap">
                            <Tooltip label={t("Open settings") || "Open settings"}>
                              <ActionIcon variant="subtle" onClick={(event) => { event.stopPropagation(); onOpenAthleteSettings(String(athlete.id)); }}>
                                <IconSettings size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={t("Open calendar") || "Open calendar"}>
                              <ActionIcon variant="subtle" onClick={(event) => { event.stopPropagation(); onOpenAthleteCalendar(String(athlete.id)); }}>
                                <IconCalendar size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={t("Messages") || "Messages"}>
                              <ActionIcon
                                variant="subtle"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenAthleteMessages(String(athlete.id), null);
                                }}
                              >
                                <IconMessageCircle size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Paper>

        <Paper withBorder p="md" radius="md">
          {!selectedAthlete ? (
            <Stack align="center" justify="center" h="100%" py="xl" c="dimmed">
              <IconUser size={32} />
              <Text size="sm">{t("Choose an athlete to inspect recent activity and rolling totals.") || "Choose an athlete to inspect recent activity and rolling totals."}</Text>
            </Stack>
          ) : (
            <Stack gap="md">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <Group gap="sm" wrap="nowrap">
                  <Avatar radius="xl" size="lg" color="blue">{getAthleteName(selectedAthlete).slice(0, 1).toUpperCase()}</Avatar>
                  <div>
                    <Title order={4}>{getAthleteName(selectedAthlete)}</Title>
                    <Text size="sm" c="dimmed">{selectedAthlete.email}</Text>
                  </div>
                </Group>
                <Group gap="xs">
                  <Button variant="light" leftSection={<IconSettings size={16} />} onClick={() => onOpenAthleteSettings(String(selectedAthlete.id))}>
                    {t("Settings") || "Settings"}
                  </Button>
                  <Button variant="light" leftSection={<IconCalendar size={16} />} onClick={() => onOpenAthleteCalendar(String(selectedAthlete.id))}>
                    {t("Calendar") || "Calendar"}
                  </Button>
                  <Button
                    variant="light"
                    leftSection={<IconMessageCircle size={16} />}
                    onClick={() => onOpenAthleteMessages(String(selectedAthlete.id), null)}
                  >
                    {t("Messages") || "Messages"}
                  </Button>
                </Group>
              </Group>

              <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
                <Paper withBorder p="sm" radius="sm">
                  <Group gap="xs" mb={6}><IconClock size={15} /><Text size="sm" fw={600}>{t("Last recorded session") || "Last recorded session"}</Text></Group>
                  {selectedSummary?.lastActivity ? (
                    <Stack gap={2}>
                      <Text size="sm">{selectedSummary.lastActivity.filename}</Text>
                      <Text size="xs" c="dimmed">{formatDateTime(selectedSummary.lastActivity.created_at)}</Text>
                      <Text size="xs" c="dimmed">{formatSportLabel(selectedSummary.lastActivity.sport)} · {formatDistanceKm(selectedSummary.lastActivity.distance)}</Text>
                    </Stack>
                  ) : <Text size="sm" c="dimmed">{t("No recent activity") || "No recent activity"}</Text>}
                </Paper>
                <Paper withBorder p="sm" radius="sm">
                  <Group gap="xs" mb={6}><IconCalendar size={15} /><Text size="sm" fw={600}>{t("Last 7 days") || "Last 7 days"}</Text></Group>
                  <Stack gap={2}>
                    <Text size="sm">{(t("Sessions") || "Sessions") + `: ${selectedSummary?.last7.sessions || 0}`}</Text>
                    <Text size="sm">{(t("Total time") || "Total time") + `: ${formatMinutesHm(selectedSummary?.last7.totalMinutes || 0)}`}</Text>
                    <Text size="sm">{(t("Distance") || "Distance") + `: ${(selectedSummary?.last7.totalDistanceKm || 0).toFixed(1)} km`}</Text>
                    <Text size="sm">{(t("Training Load") || "Training Load") + `: ${(selectedSummary?.last7.totalLoad || 0).toFixed(1)}`}</Text>
                  </Stack>
                </Paper>
                <Paper withBorder p="sm" radius="sm">
                  <Group gap="xs" mb={6}><IconChartBar size={15} /><Text size="sm" fw={600}>{t("Last 30 days") || "Last 30 days"}</Text></Group>
                  <Stack gap={2}>
                    <Text size="sm">{(t("Sessions") || "Sessions") + `: ${selectedSummary?.last30.sessions || 0}`}</Text>
                    <Text size="sm">{(t("Total time") || "Total time") + `: ${formatMinutesHm(selectedSummary?.last30.totalMinutes || 0)}`}</Text>
                    <Text size="sm">{(t("Distance") || "Distance") + `: ${(selectedSummary?.last30.totalDistanceKm || 0).toFixed(1)} km`}</Text>
                    <Text size="sm">{(t("Training Load") || "Training Load") + `: ${(selectedSummary?.last30.totalLoad || 0).toFixed(1)}`}</Text>
                  </Stack>
                </Paper>
              </SimpleGrid>

              <Divider />

              <div>
                <Title order={5} mb="sm">{t("Recent activity") || "Recent activity"}</Title>
                {!selectedSummary || selectedSummary.recent.length === 0 ? (
                  <Text size="sm" c="dimmed">{t("No recent activity") || "No recent activity"}</Text>
                ) : (
                  <Stack gap="xs">
                    {selectedSummary.recent.map((activity) => (
                      <Paper key={activity.id} withBorder p="sm" radius="sm">
                        <Group justify="space-between" align="flex-start" wrap="nowrap">
                          <Stack gap={2}>
                            <Text size="sm" fw={600}>{activity.filename}</Text>
                            <Text size="xs" c="dimmed">{formatDateTime(activity.created_at)}</Text>
                            <Text size="xs" c="dimmed">{formatSportLabel(activity.sport)} · {formatDistanceKm(activity.distance)} · {formatMinutesHm(((activity.moving_time ?? activity.duration) || 0) / 60)}</Text>
                          </Stack>
                          <Badge variant="light">{(activity.total_load_impact || 0).toFixed(1)}</Badge>
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </div>
            </Stack>
          )}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
};

export default DashboardCoachAthletesPage;
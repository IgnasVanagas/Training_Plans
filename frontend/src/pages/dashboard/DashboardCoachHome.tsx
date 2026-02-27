import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  CopyButton,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  useComputedColorScheme,
  ScrollArea,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconCopy,
  IconHeart,
  IconMessageCircle,
  IconPlus,
  IconRun,
  IconUsers,
  IconAt,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import { CoachComparisonPanel } from "../../components/CoachComparisonPanel";
import { ActivityFeedRow, DashboardCalendarEvent, User } from "./types";
import { formatDuration } from "./utils";
import { useI18n } from "../../i18n/I18nProvider";

type Props = {
  me: User;
  athletes: User[];
  complianceAlerts: DashboardCalendarEvent[];
  coachFeedbackRows: ActivityFeedRow[];
  inviteUrl: string | null;
  inviteEmail: string;
  onInviteEmailChange: (value: string) => void;
  onInviteByEmail: () => void;
  invitingByEmail: boolean;
  onGenerateInvite: () => void;
  generatingInvite: boolean;
  onOpenPlan: () => void;
  onOpenActivities: () => void;
  onOpenOrganizations: () => void;
};

const DashboardCoachHome = ({
  me,
  athletes,
  complianceAlerts,
  coachFeedbackRows,
  inviteUrl,
  inviteEmail,
  onInviteEmailChange,
  onInviteByEmail,
  invitingByEmail,
  onGenerateInvite,
  generatingInvite,
  onOpenPlan,
  onOpenActivities,
  onOpenOrganizations,
}: Props) => {
  const navigate = useNavigate();
  const isDark = useComputedColorScheme("light") === "dark";
  const isMobile = useMediaQuery("(max-width: 48em)");
  const { t } = useI18n();

  const openComplianceAlert = (row: DashboardCalendarEvent) => {
    const activityId = row.is_planned ? row.matched_activity_id : row.id;

    if (activityId) {
      navigate(`/dashboard/activities/${activityId}`, {
        state: {
          returnTo: "/dashboard",
          activeTab: "dashboard",
          selectedAthleteId: row.user_id ? String(row.user_id) : null,
          calendarDate: row.date,
        },
      });
      return;
    }

    navigate("/dashboard", {
      state: {
        activeTab: "plan",
        selectedAthleteId: row.user_id ? String(row.user_id) : null,
        calendarDate: row.date,
      },
    });
  };

  return (
    <Stack gap="lg">
      {isMobile && (
        <SimpleGrid cols={4} spacing="xs">
          <Button size="compact-sm" variant="light" onClick={onOpenPlan}>{t("Training Plan")}</Button>
          <Button size="compact-sm" variant="light" onClick={onOpenActivities}>{t("Activities")}</Button>
          <Button size="compact-sm" variant="light" onClick={onOpenOrganizations}>{t("Organizations")}</Button>
          <Button size="compact-sm" variant="light" onClick={onGenerateInvite} loading={generatingInvite}>{t("Invite Athlete")}</Button>
        </SimpleGrid>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper withBorder p="md" radius="md" shadow="sm">
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <ThemeIcon color="red" variant="light" radius="xl"><IconAlertTriangle size={16} /></ThemeIcon>
              <Title order={4}>Compliance Alerts</Title>
            </Group>
            <Badge color="red" variant="light">{complianceAlerts.length}</Badge>
          </Group>
          {complianceAlerts.length === 0 ? (
            <Text size="sm" c="dimmed">No urgent compliance flags. Athletes are currently on track.</Text>
          ) : (
            <Stack gap={6}>
              {complianceAlerts.map((row, index) => {
                const athlete = athletes.find((item) => item.id === row.user_id);
                const athleteName = athlete
                  ? ((athlete.profile?.first_name || athlete.profile?.last_name)
                    ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
                    : athlete.email)
                  : "Athlete";
                return (
                  <Paper
                    key={`${row.id || index}-${row.date}`}
                    withBorder
                    p="xs"
                    radius="sm"
                    style={{ cursor: "pointer" }}
                    onClick={() => openComplianceAlert(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openComplianceAlert(row);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Stack gap={0}>
                        <Text size="sm" fw={600}>{athleteName}</Text>
                        <Text size="xs" c="dimmed">{row.date} · {row.title}</Text>
                      </Stack>
                      <Badge color={row.compliance_status === "completed_red" || row.compliance_status === "missed" ? "red" : "yellow"}>
                        {row.compliance_status === "missed" ? "Missed" : row.compliance_status === "completed_red" ? "Critical" : row.is_planned ? "Overdue" : "Needs Review"}
                      </Badge>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          )}
        </Paper>

        <Paper withBorder p="md" radius="md" shadow="sm">
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <ThemeIcon color="blue" variant="light" radius="xl"><IconMessageCircle size={16} /></ThemeIcon>
              <Title order={4}>Coach-to-Athlete Loop</Title>
            </Group>
            <Badge variant="light" color="blue">24h</Badge>
          </Group>
          <Text size="sm" c="dimmed" mb="sm">Recent completed sessions waiting for coach acknowledgement.</Text>
          {coachFeedbackRows.length === 0 ? (
            <Text size="sm" c="dimmed">No new completed activities in the last 24 hours.</Text>
          ) : (
            <Stack gap={6}>
              {coachFeedbackRows.map((row) => {
                const athlete = athletes.find((item) => item.id === row.athlete_id);
                const athleteName = athlete
                  ? ((athlete.profile?.first_name || athlete.profile?.last_name)
                    ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
                    : athlete.email)
                  : "Athlete";
                return (
                  <Group key={row.id} justify="space-between" wrap="nowrap">
                    <Stack gap={0}>
                      <Text size="sm" fw={600}>{athleteName}</Text>
                      <Text size="xs" c="dimmed">{row.sport || "activity"} · {new Date(row.created_at).toLocaleString()}</Text>
                    </Stack>
                    <Group gap={6}>
                      <Button size="compact-xs" variant="subtle">Approve</Button>
                      <Button size="compact-xs" variant="subtle">Adjust Next</Button>
                    </Group>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md" radius="md" shadow="sm">
        <Group justify="space-between" mb="xs">
          <div>
            <Title order={4}>Invite Athlete</Title>
            <Text c="dimmed" size="sm">Invite existing athletes by email, or share a join link for new signups.</Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={onGenerateInvite} loading={generatingInvite}>
            Generate Link
          </Button>
        </Group>

        <Group align="end" mt="sm" wrap="nowrap">
          <TextInput
            label="Existing athlete email"
            placeholder="athlete@example.com"
            value={inviteEmail}
            onChange={(event) => onInviteEmailChange(event.currentTarget.value)}
            leftSection={<IconAt size={16} />}
            style={{ flex: 1 }}
          />
          <Button onClick={onInviteByEmail} loading={invitingByEmail}>
            Invite by Email
          </Button>
        </Group>

        {inviteUrl && (
          <Paper
            bg={isDark ? "dark.6" : "gray.1"}
            p="sm"
            radius="sm"
            mt="md"
            style={{ border: `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-gray-3)"}` }}
          >
            <Group justify="space-between">
              <Text size="sm" ff="monospace" c={isDark ? "gray.1" : "dark.8"} style={{ wordBreak: "break-all" }}>{inviteUrl}</Text>
              <CopyButton value={inviteUrl}>
                {({ copied, copy }) => (
                  <ActionIcon color={copied ? "teal" : "blue"} onClick={copy} variant="filled">
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
          </Paper>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md" shadow="sm">
        <Title order={4} mb="md">Your Athletes</Title>
        {athletes.length > 0 ? (
          <ScrollArea type="auto" offsetScrollbars>
            <Table striped highlightOnHover verticalSpacing="sm" miw={620}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Athlete</Table.Th>
                  <Table.Th>Threshold</Table.Th>
                  <Table.Th>Max HR (bpm)</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {athletes.map((athlete) => (
                  <Table.Tr key={athlete.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/dashboard/athlete/${athlete.id}`)}>
                    <Table.Td>
                      <Group gap="sm">
                        <Avatar color="blue" radius="xl">
                          {athlete.profile?.first_name ? athlete.profile.first_name[0].toUpperCase() : athlete.email[0].toUpperCase()}
                        </Avatar>
                        <Stack gap={0}>
                          <Text size="sm" fw={500}>
                            {(athlete.profile?.first_name || athlete.profile?.last_name)
                              ? `${athlete.profile.first_name || ""} ${athlete.profile.last_name || ""}`.trim()
                              : athlete.email}
                          </Text>
                          {(athlete.profile?.first_name || athlete.profile?.last_name) && (
                            <Text size="xs" c="dimmed">{athlete.email}</Text>
                          )}
                        </Stack>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {(() => {
                        const p = athlete.profile;
                        if (p?.main_sport === "running" && p.lt2) {
                          const isImp = me.profile?.preferred_units === "imperial";
                          const val = isImp ? p.lt2 * 1.60934 : p.lt2;
                          return (
                            <Group gap={4}>
                              <IconRun size={14} color="green" />
                              <Text size="sm">{formatDuration(val)} {isImp ? "/mi" : "/km"}</Text>
                            </Group>
                          );
                        }
                        if (p?.ftp) {
                          return (
                            <Group gap={4}>
                              <IconBolt size={14} color="orange" />
                              <Text size="sm">{p.ftp} W</Text>
                            </Group>
                          );
                        }
                        if (p?.lt2) {
                          const isImp = me.profile?.preferred_units === "imperial";
                          const val = isImp ? p.lt2 * 1.60934 : p.lt2;
                          return (
                            <Group gap={4}>
                              <IconRun size={14} color="green" />
                              <Text size="sm">{formatDuration(val)} {isImp ? "/mi" : "/km"}</Text>
                            </Group>
                          );
                        }
                        return <Text size="sm">-</Text>;
                      })()}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <IconHeart size={14} color="red" />
                        <Text size="sm">{athlete.profile?.max_hr ?? "-"}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <ThemeIcon color="teal" size="xs" variant="light" radius="xl">
                        <IconCheck size={10} />
                      </ThemeIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        ) : (
          <Stack align="center" py="xl" c="dimmed">
            <IconUsers size={48} stroke={1} />
            <Text>No athletes found. Invite some athletes to get started.</Text>
          </Stack>
        )}
      </Paper>

      <CoachComparisonPanel athletes={athletes} me={me as any} />
    </Stack>
  );
};

export default DashboardCoachHome;

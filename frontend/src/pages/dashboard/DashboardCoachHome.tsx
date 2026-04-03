import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Checkbox,
  CopyButton,
  Divider,
  Group,
  Paper,
  Select,
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
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaQuery } from "@mantine/hooks";
import { ActivityFeedRow, CalendarApprovalItem, CoachOperationsPayload, DashboardCalendarEvent, User } from "./types";
import { formatDuration } from "./utils";
import { useI18n } from "../../i18n/I18nProvider";

type Props = {
  me: User;
  athletes: User[];
  complianceAlerts: DashboardCalendarEvent[];
  coachFeedbackRows: ActivityFeedRow[];
  coachOperations: CoachOperationsPayload | null;
  coachOperationsLoading: boolean;
  approvalQueue: CalendarApprovalItem[];
  reviewingApproval: boolean;
  onReviewApproval: (workoutId: number, decision: "approve" | "reject") => void;
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
  onOpenComparison: () => void;
};

const DashboardCoachHome = ({
  me,
  athletes,
  complianceAlerts,
  coachFeedbackRows,
  coachOperations,
  coachOperationsLoading,
  approvalQueue,
  reviewingApproval,
  onReviewApproval,
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
  onOpenComparison,
}: Props) => {
  const navigate = useNavigate();
  const isDark = useComputedColorScheme("light") === "dark";
  const isMobile = useMediaQuery("(max-width: 48em)");
  const { t } = useI18n();
  const [operationsSport, setOperationsSport] = useState<string | null>(null);
  const [operationsRisk, setOperationsRisk] = useState<string | null>(null);
  const [operationsSearch, setOperationsSearch] = useState("");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [atRiskOnly, setAtRiskOnly] = useState(false);

  const operationsRows = useMemo(() => {
    const rows = coachOperations?.athletes || [];
    return rows.filter((row) => {
      if (operationsSport && (row.main_sport || "").toLowerCase() !== operationsSport.toLowerCase()) return false;
      if (operationsRisk && row.risk_level !== operationsRisk) return false;
      if (exceptionsOnly && row.exception_reasons.length === 0) return false;
      if (atRiskOnly && !row.at_risk) return false;
      if (operationsSearch.trim()) {
        const needle = operationsSearch.trim().toLowerCase();
        const haystack = `${row.athlete_name} ${row.athlete_email}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [atRiskOnly, coachOperations?.athletes, exceptionsOnly, operationsRisk, operationsSearch, operationsSport]);

  const openAthletePlan = (athleteId: number) => {
    navigate("/dashboard", {
      state: {
        activeTab: "plan",
        selectedAthleteId: String(athleteId),
      },
    });
  };

  const describeExceptionReason = (reasonCode: string): string => {
    const labels: Record<string, string> = {
      no_recent_activity_35d: t("No completed activities in the last 35 days") || "No completed activities in the last 35 days",
      activity_gap_8d: t("Long activity gap (8+ days)") || "Long activity gap (8+ days)",
      activity_gap_5d: t("Recent activity gap (5+ days)") || "Recent activity gap (5+ days)",
      overdue_planned_multiple: t("Multiple overdue planned workouts") || "Multiple overdue planned workouts",
      overdue_planned: t("Overdue planned workouts") || "Overdue planned workouts",
      missed_compliance_repeated: t("Repeated missed/critical compliance outcomes") || "Repeated missed/critical compliance outcomes",
      missed_compliance_recent: t("Recent missed or critical compliance") || "Recent missed or critical compliance",
      no_planned_next_7d: t("No coach-planned load in next 7 days") || "No coach-planned load in next 7 days",
      acwr_low_detraining: t("Acute load well below baseline (possible detraining)") || "Acute load well below baseline (possible detraining)",
      acwr_high_spike: t("Acute load spike above baseline") || "Acute load spike above baseline",
      workload_delta_high: t("Workload allocation is far from team median") || "Workload allocation is far from team median",
      missing_threshold_metrics: t("Missing threshold metrics (FTP/LT2/Max HR)") || "Missing threshold metrics (FTP/LT2/Max HR)",
    };

    return labels[reasonCode] || reasonCode;
  };

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

        <Paper withBorder p="md" radius="md" shadow="sm">
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <ThemeIcon color="orange" variant="light" radius="xl"><IconAlertTriangle size={16} /></ThemeIcon>
              <Title order={4}>{t("Approval queue") || "Approval queue"}</Title>
            </Group>
            <Badge variant="light" color="orange">{approvalQueue.length}</Badge>
          </Group>
          <Text size="sm" c="dimmed" mb="sm">{t("Athlete-requested calendar changes waiting for coach review.") || "Athlete-requested calendar changes waiting for coach review."}</Text>
          {approvalQueue.length === 0 ? (
            <Text size="sm" c="dimmed">{t("No pending calendar approvals.") || "No pending calendar approvals."}</Text>
          ) : (
            <Stack gap={6}>
              {approvalQueue.slice(0, 6).map((item) => (
                <Paper key={item.workout_id} withBorder p="xs" radius="sm">
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Stack gap={0}>
                      <Text size="sm" fw={600}>{item.athlete_name}</Text>
                      <Text size="xs" c="dimmed">{item.date} · {item.title}</Text>
                      <Text size="xs" c="dimmed">{(t("Request") || "Request") + `: ${item.request_type}` + (item.requested_by_name ? ` • ${item.requested_by_name}` : "")}</Text>
                    </Stack>
                    <Group gap={6}>
                      <Button size="compact-xs" variant="light" color="green" loading={reviewingApproval} onClick={() => onReviewApproval(item.workout_id, "approve")}>
                        {t("Approve") || "Approve"}
                      </Button>
                      <Button size="compact-xs" variant="light" color="red" loading={reviewingApproval} onClick={() => onReviewApproval(item.workout_id, "reject")}>
                        {t("Reject") || "Reject"}
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md" radius="md" shadow="sm">
        <Group justify="space-between" mb="sm">
          <div>
            <Title order={4}>{t("Multi-athlete operations") || "Multi-athlete operations"}</Title>
            <Text size="sm" c="dimmed">{t("Filter cohorts, balance weekly load, and clear risk queues quickly.") || "Filter cohorts, balance weekly load, and clear risk queues quickly."}</Text>
          </div>
          {coachOperationsLoading ? <Badge variant="light">{t("Refreshing") || "Refreshing"}</Badge> : null}
        </Group>

        <SimpleGrid cols={{ base: 1, md: 3 }} mb="md">
          <Paper withBorder p="sm" radius="sm">
            <Text size="xs" c="dimmed">{t("Target weekly minutes") || "Target weekly minutes"}</Text>
            <Text fw={700} size="xl">{Math.round(coachOperations?.workload_balance?.target_weekly_minutes || 0)}</Text>
          </Paper>
          <Paper withBorder p="sm" radius="sm">
            <Text size="xs" c="dimmed">{t("At-risk athletes") || "At-risk athletes"}</Text>
            <Text fw={700} size="xl">{coachOperations?.at_risk_athletes?.length || 0}</Text>
          </Paper>
          <Paper withBorder p="sm" radius="sm">
            <Text size="xs" c="dimmed">{t("Exception queue") || "Exception queue"}</Text>
            <Text fw={700} size="xl">{coachOperations?.exception_queue?.length || 0}</Text>
          </Paper>
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, lg: 5 }} mb="sm">
          <TextInput
            label={t("Search athlete") || "Search athlete"}
            placeholder={t("Name or email") || "Name or email"}
            value={operationsSearch}
            onChange={(event) => setOperationsSearch(event.currentTarget.value)}
          />
          <Select
            label={t("Sport") || "Sport"}
            data={[
              { value: "", label: t("All") || "All" },
              { value: "running", label: t("Running") || "Running" },
              { value: "cycling", label: t("Cycling") || "Cycling" },
              { value: "triathlon", label: t("Triathlon") || "Triathlon" },
            ]}
            value={operationsSport || ""}
            onChange={(value) => setOperationsSport(value || null)}
          />
          <Select
            label={t("Risk level") || "Risk level"}
            data={[
              { value: "", label: t("All") || "All" },
              { value: "high", label: t("High") || "High" },
              { value: "moderate", label: t("Moderate") || "Moderate" },
              { value: "low", label: t("Low") || "Low" },
            ]}
            value={operationsRisk || ""}
            onChange={(value) => setOperationsRisk(value || null)}
          />
          <Checkbox
            mt={26}
            label={t("Exceptions only") || "Exceptions only"}
            checked={exceptionsOnly}
            onChange={(event) => setExceptionsOnly(event.currentTarget.checked)}
          />
          <Checkbox
            mt={26}
            label={t("At-risk only") || "At-risk only"}
            checked={atRiskOnly}
            onChange={(event) => setAtRiskOnly(event.currentTarget.checked)}
          />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Paper withBorder p="sm" radius="sm">
            <Group justify="space-between" mb="xs">
              <Text fw={600}>{t("Exception queue") || "Exception queue"}</Text>
              <Badge color="red" variant="light">{operationsRows.filter((row) => row.exception_reasons.length > 0).length}</Badge>
            </Group>
            <Stack gap={8}>
              {operationsRows.filter((row) => row.exception_reasons.length > 0).slice(0, 8).map((row) => (
                <Paper key={row.athlete_id} withBorder p="xs" radius="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>{row.athlete_name}</Text>
                      <Text size="xs" c="dimmed">{describeExceptionReason(row.exception_reasons[0])}</Text>
                    </Stack>
                    <Group gap={6}>
                      <Badge color={row.risk_level === "high" ? "red" : row.risk_level === "moderate" ? "yellow" : "gray"}>
                        {row.risk_level}
                      </Badge>
                      <Button size="compact-xs" variant="light" onClick={() => openAthletePlan(row.athlete_id)}>
                        {t("Open plan") || "Open plan"}
                      </Button>
                    </Group>
                  </Group>
                </Paper>
              ))}
              {operationsRows.filter((row) => row.exception_reasons.length > 0).length === 0 ? (
                <Text size="sm" c="dimmed">{t("No current exceptions in this filter set.") || "No current exceptions in this filter set."}</Text>
              ) : null}
            </Stack>
          </Paper>

          <Paper withBorder p="sm" radius="sm">
            <Group justify="space-between" mb="xs">
              <Text fw={600}>{t("At-risk athlete view") || "At-risk athlete view"}</Text>
              <Badge color="orange" variant="light">{operationsRows.filter((row) => row.at_risk).length}</Badge>
            </Group>
            <Stack gap={8}>
              {operationsRows.filter((row) => row.at_risk).slice(0, 8).map((row) => (
                <Group key={row.athlete_id} justify="space-between" wrap="nowrap">
                  <Stack gap={0}>
                    <Text size="sm" fw={600}>{row.athlete_name}</Text>
                    <Text size="xs" c="dimmed">
                      {(t("ACWR") || "ACWR") + ` ${row.acwr.toFixed(2)} • ` + (t("Overdue") || "Overdue") + ` ${row.overdue_planned_count}`}
                    </Text>
                  </Stack>
                  <Badge color={row.risk_level === "high" ? "red" : "yellow"}>{row.risk_score}</Badge>
                </Group>
              ))}
              {operationsRows.filter((row) => row.at_risk).length === 0 ? (
                <Text size="sm" c="dimmed">{t("No at-risk athletes under current filters.") || "No at-risk athletes under current filters."}</Text>
              ) : null}
            </Stack>
          </Paper>
        </SimpleGrid>

        <Divider my="md" />
        <Text fw={600} mb="xs">{t("Workload balancing") || "Workload balancing"}</Text>
        <ScrollArea type="auto" offsetScrollbars>
          <Table striped highlightOnHover verticalSpacing="sm" miw={780}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Athlete") || "Athlete"}</Table.Th>
                <Table.Th>{t("Planned 7d (min)") || "Planned 7d (min)"}</Table.Th>
                <Table.Th>{t("Completed 7d (min)") || "Completed 7d (min)"}</Table.Th>
                <Table.Th>{t("Load delta") || "Load delta"}</Table.Th>
                <Table.Th>{t("Recommendation") || "Recommendation"}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {operationsRows.map((row) => (
                <Table.Tr key={`op-${row.athlete_id}`}>
                  <Table.Td>
                    <Text size="sm" fw={600}>{row.athlete_name}</Text>
                  </Table.Td>
                  <Table.Td>{Math.round(row.planned_7d_minutes)}</Table.Td>
                  <Table.Td>{Math.round(row.completed_7d_minutes)}</Table.Td>
                  <Table.Td>
                    <Badge color={row.workload_delta_minutes > 120 ? "red" : row.workload_delta_minutes < -120 ? "blue" : "teal"} variant="light">
                      {row.workload_delta_minutes > 0 ? "+" : ""}{Math.round(row.workload_delta_minutes)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{row.workload_recommendation || (t("Balanced") || "Balanced")}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <Paper withBorder p="md" radius="md" shadow="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <div>
            <Title order={4}>{t("Coach Split-Screen Analysis") || "Coach Split-Screen Analysis"}</Title>
            <Text size="sm" c="dimmed">
              {t("Compare two workouts, weeks, or months side by side with the same analysis model.") || "Compare two workouts, weeks, or months side by side with the same analysis model."}
            </Text>
          </div>
          <Button variant="light" onClick={onOpenComparison}>
            {t("Comparison") || "Comparison"}
          </Button>
        </Group>
      </Paper>

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

        <Group align="end" mt="sm" wrap="wrap">
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
                      {athlete.has_upcoming_coach_workout ? (
                        <Badge color="teal" variant="light">
                          {athlete.next_coach_workout_date ? `${t("Planned") || "Planned"} ${athlete.next_coach_workout_date}` : (t("Planned") || "Planned")}
                        </Badge>
                      ) : (
                        <Badge color="orange" variant="light">
                          {t("Needs Plan") || "Needs Plan"}
                        </Badge>
                      )}
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
    </Stack>
  );
};

export default DashboardCoachHome;

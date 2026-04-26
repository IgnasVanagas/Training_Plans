import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBolt,
  IconCheck,
  IconClipboardCheck,
  IconCopy,
  IconHeart,
  IconMessageCircle,
  IconPlus,
  IconRun,
  IconUsers,
  IconAt,
  IconArrowRight,
  IconBell,
  IconChartBar,
} from "@tabler/icons-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ActivityFeedRow, CalendarApprovalItem, CoachOperationsPayload, DashboardCalendarEvent, User } from "./types";
import { formatDuration } from "./utils";
import { useI18n } from "../../i18n/I18nProvider";
import { resolveUserPictureUrl } from "../../api/organizations";

type FeedItem = {
  key: string;
  type: "compliance" | "approval" | "feedback" | "exception";
  icon: React.ReactNode;
  color: string;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  onClick?: () => void;
};

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
  inviteMessage: string;
  onInviteMessageChange: (value: string) => void;
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
  approvalQueue,
  reviewingApproval,
  onReviewApproval,
  inviteUrl,
  inviteEmail,
  onInviteEmailChange,
  inviteMessage,
  onInviteMessageChange,
  onInviteByEmail,
  invitingByEmail,
  onGenerateInvite,
  generatingInvite,
  onOpenComparison,
}: Props) => {
  const navigate = useNavigate();
  const isDark = useComputedColorScheme("light") === "dark";
  const { t } = useI18n();

  const cardBg = isDark ? "rgba(22, 34, 58, 0.62)" : "rgba(255, 255, 255, 0.92)";
  const cardBorder = isDark ? "rgba(148, 163, 184, 0.26)" : "rgba(15, 23, 42, 0.14)";

  const atRiskCount = coachOperations?.at_risk_athletes?.length || 0;
  const exceptionCount = coachOperations?.exception_queue?.length || 0;
  const actionItemCount = complianceAlerts.length + approvalQueue.length + coachFeedbackRows.length + exceptionCount;

  const openAthletePlan = (athleteId: number) => {
    navigate("/dashboard", {
      state: { activeTab: "plan", selectedAthleteId: String(athleteId) },
    });
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

  const getAthleteName = (athleteId: number | undefined): string => {
    if (!athleteId) return "Athlete";
    const athlete = athletes.find((a) => a.id === athleteId);
    if (!athlete) return "Athlete";
    return (athlete.profile?.first_name || athlete.profile?.last_name)
      ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
      : athlete.email;
  };

  const feedItems = useMemo((): FeedItem[] => {
    const items: FeedItem[] = [];

    complianceAlerts.forEach((row, i) => {
      const label = row.compliance_status === "missed" ? t("Missed") || "Missed"
        : row.compliance_status === "completed_red" ? t("Critical") || "Critical"
        : row.is_planned ? t("Overdue") || "Overdue" : t("Needs Review") || "Needs Review";
      items.push({
        key: `c-${row.id || i}-${row.date}`,
        type: "compliance",
        icon: <IconAlertTriangle size={16} />,
        color: row.compliance_status === "completed_red" || row.compliance_status === "missed" ? "red" : "yellow",
        title: `${getAthleteName(row.user_id)} · ${label}`,
        subtitle: `${row.date} · ${row.title}`,
        onClick: () => openComplianceAlert(row),
      });
    });

    approvalQueue.forEach((item) => {
      items.push({
        key: `a-${item.workout_id}`,
        type: "approval",
        icon: <IconClipboardCheck size={16} />,
        color: "orange",
        title: `${item.athlete_name} · ${item.request_type}`,
        subtitle: `${item.date} · ${item.title}`,
        actions: (
          <Group gap={6}>
            <Button size="compact-xs" variant="light" color="green" loading={reviewingApproval} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onReviewApproval(item.workout_id, "approve"); }}>
              {t("Approve") || "Approve"}
            </Button>
            <Button size="compact-xs" variant="light" color="red" loading={reviewingApproval} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onReviewApproval(item.workout_id, "reject"); }}>
              {t("Reject") || "Reject"}
            </Button>
          </Group>
        ),
      });
    });

    coachFeedbackRows.forEach((row) => {
      items.push({
        key: `f-${row.id}`,
        type: "feedback",
        icon: <IconMessageCircle size={16} />,
        color: "blue",
        title: `${getAthleteName(row.athlete_id)} · ${t("New session") || "New session"}`,
        subtitle: `${row.sport || "activity"} · ${new Date(row.created_at).toLocaleString()}`,
        onClick: () => navigate(`/dashboard/activities/${row.id}`),
      });
    });

    (coachOperations?.exception_queue || []).slice(0, 4).forEach((row) => {
      items.push({
        key: `e-${row.athlete_id}`,
        type: "exception",
        icon: <IconAlertTriangle size={16} />,
        color: row.risk_level === "high" ? "red" : "yellow",
        title: `${row.athlete_name} · ${row.risk_level}`,
        subtitle: describeExceptionReason(row.exception_reasons[0] || ""),
        actions: (
          <Button size="compact-xs" variant="light" onClick={(e: React.MouseEvent) => { e.stopPropagation(); openAthletePlan(row.athlete_id); }}>
            {t("Open plan") || "Open plan"}
          </Button>
        ),
        onClick: () => openAthletePlan(row.athlete_id),
      });
    });

    return items;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complianceAlerts, approvalQueue, coachFeedbackRows, coachOperations?.exception_queue, athletes, reviewingApproval]);

  const getThreshold = (athlete: User) => {
    const p = athlete.profile;
    if (p?.main_sport === "running" && p.lt2) {
      const isImp = me.profile?.preferred_units === "imperial";
      const val = isImp ? p.lt2 * 1.60934 : p.lt2;
      return (
        <Group gap={4}>
          <IconRun size={14} color="green" />
          <Text size="xs">{formatDuration(val)} {isImp ? "/mi" : "/km"}</Text>
        </Group>
      );
    }
    if (p?.ftp) {
      return (
        <Group gap={4}>
          <IconBolt size={14} color="orange" />
          <Text size="xs">{p.ftp} W</Text>
        </Group>
      );
    }
    if (p?.lt2) {
      const isImp = me.profile?.preferred_units === "imperial";
      const val = isImp ? p.lt2 * 1.60934 : p.lt2;
      return (
        <Group gap={4}>
          <IconRun size={14} color="green" />
          <Text size="xs">{formatDuration(val)} {isImp ? "/mi" : "/km"}</Text>
        </Group>
      );
    }
    return <Text size="xs" c="dimmed">-</Text>;
  };

  const getAthleteRisk = (athleteId: number) => {
    return (coachOperations?.athletes || []).find((a) => a.athlete_id === athleteId);
  };

  return (
    <Stack gap="lg" style={{ fontFamily: '"Inter", sans-serif' }}>
      {/* Quick Stats */}
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ borderColor: cardBorder }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{t("Athletes") || "Athletes"}</Text>
            <IconUsers size={20} color="#2563eb" />
          </Group>
          <Text fw={700} size="xl">{athletes.length}</Text>
          <Text size="xs" c="dimmed" mt="xs">{t("Total roster") || "Total roster"}</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ borderColor: cardBorder }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{t("At-Risk") || "At-Risk"}</Text>
            <IconAlertTriangle size={20} color={atRiskCount > 0 ? "#ef4444" : "#94a3b8"} />
          </Group>
          <Text fw={700} size="xl" c={atRiskCount > 0 ? "red" : undefined}>{atRiskCount}</Text>
          <Text size="xs" c="dimmed" mt="xs">{t("Need attention") || "Need attention"}</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ borderColor: cardBorder }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{t("Action Items") || "Action Items"}</Text>
            <IconBell size={20} color={actionItemCount > 0 ? "#f59e0b" : "#94a3b8"} />
          </Group>
          <Text fw={700} size="xl" c={actionItemCount > 0 ? "yellow.7" : undefined}>{actionItemCount}</Text>
          <Text size="xs" c="dimmed" mt="xs">{t("Pending review") || "Pending review"}</Text>
        </Card>

        <Card shadow="sm" radius="md" withBorder padding="lg" bg={cardBg} style={{ borderColor: cardBorder }}>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>{t("Weekly Load") || "Weekly Load"}</Text>
            <IconChartBar size={20} color="#6E4BF3" />
          </Group>
          <Text fw={700} size="xl">{Math.round(coachOperations?.workload_balance?.target_weekly_minutes || 0)}</Text>
          <Text size="xs" c="dimmed" mt="xs">{t("Target min/week") || "Target min/week"}</Text>
        </Card>
      </SimpleGrid>

      {/* Unified Action Feed */}
      <Paper withBorder p="md" radius="md" shadow="sm" bg={cardBg} style={{ borderColor: cardBorder }}>
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            <ThemeIcon color="orange" variant="light" radius="xl"><IconBell size={16} /></ThemeIcon>
            <Title order={4}>{t("Action Feed") || "Action Feed"}</Title>
          </Group>
          {actionItemCount > 0 && <Badge variant="light" color="orange">{actionItemCount}</Badge>}
        </Group>

        {feedItems.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            {t("All clear — no pending actions.") || "All clear — no pending actions."}
          </Text>
        ) : (
          <Stack gap={6}>
            {feedItems.slice(0, 10).map((item) => (
              <Paper
                key={item.key}
                withBorder
                p="xs"
                radius="sm"
                style={{ cursor: item.onClick ? "pointer" : undefined }}
                onClick={item.onClick}
                onKeyDown={item.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.onClick?.(); } } : undefined}
                role={item.onClick ? "button" : undefined}
                tabIndex={item.onClick ? 0 : undefined}
              >
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <ThemeIcon color={item.color} variant="light" size="sm" radius="xl">
                      {item.icon}
                    </ThemeIcon>
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate="end">{item.title}</Text>
                      <Text size="xs" c="dimmed" truncate="end">{item.subtitle}</Text>
                    </Stack>
                  </Group>
                  {item.actions || (
                    item.onClick && <IconArrowRight size={14} color="gray" style={{ flexShrink: 0 }} />
                  )}
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Paper>

      {/* Athletes Grid */}
      <Paper withBorder p="md" radius="md" shadow="sm" bg={cardBg} style={{ borderColor: cardBorder }}>
        <Group justify="space-between" mb="md">
          <Group gap="xs">
            <ThemeIcon color="blue" variant="light" radius="xl"><IconUsers size={16} /></ThemeIcon>
            <Title order={4}>{t("Your Athletes") || "Your Athletes"}</Title>
          </Group>
          <Group gap="xs">
            <Button variant="light" size="compact-sm" onClick={onOpenComparison} leftSection={<IconChartBar size={14} />}>
              {t("Compare") || "Compare"}
            </Button>
          </Group>
        </Group>

        {athletes.length > 0 ? (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {athletes.map((athlete) => {
              const risk = getAthleteRisk(athlete.id);
              const name = (athlete.profile?.first_name || athlete.profile?.last_name)
                ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
                : athlete.email;
              return (
                <Card
                  key={athlete.id}
                  withBorder
                  radius="md"
                  padding="md"
                  style={{ cursor: "pointer", borderColor: cardBorder }}
                  onClick={() => navigate(`/dashboard/athlete/${athlete.id}`)}
                >
                  <Group gap="sm" mb="xs">
                    <Avatar color="blue" radius="xl" size="md" src={resolveUserPictureUrl(athlete.profile?.picture) || undefined}>
                      {athlete.profile?.first_name ? athlete.profile.first_name[0].toUpperCase() : athlete.email[0].toUpperCase()}
                    </Avatar>
                    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate="end">{name}</Text>
                      {(athlete.profile?.first_name || athlete.profile?.last_name) && (
                        <Text size="xs" c="dimmed" truncate="end">{athlete.email}</Text>
                      )}
                    </Stack>
                    {risk?.at_risk && (
                      <Badge color={risk.risk_level === "high" ? "red" : "yellow"} size="xs" variant="light">
                        {risk.risk_level}
                      </Badge>
                    )}
                  </Group>

                  <Group justify="space-between" mt="xs">
                    {getThreshold(athlete)}
                    <Group gap={4}>
                      <IconHeart size={14} color="red" />
                      <Text size="xs">{athlete.profile?.max_hr ?? "-"} bpm</Text>
                    </Group>
                  </Group>

                  <Group justify="space-between" mt="xs">
                    {athlete.has_upcoming_coach_workout ? (
                      <Badge color="teal" variant="light" size="xs">
                        {athlete.next_coach_workout_date ? `${t("Planned") || "Planned"} ${athlete.next_coach_workout_date}` : (t("Planned") || "Planned")}
                      </Badge>
                    ) : (
                      <Badge color="orange" variant="light" size="xs">
                        {t("Needs Plan") || "Needs Plan"}
                      </Badge>
                    )}
                    {risk && (
                      <Text size="xs" c="dimmed">ACWR {risk.acwr.toFixed(2)}</Text>
                    )}
                  </Group>
                </Card>
              );
            })}
          </SimpleGrid>
        ) : (
          <Stack align="center" py="xl" c="dimmed">
            <IconUsers size={48} stroke={1} />
            <Text>{t("No athletes found. Invite some athletes to get started.") || "No athletes found. Invite some athletes to get started."}</Text>
          </Stack>
        )}
      </Paper>

      {/* Invite Athlete */}
      <Paper withBorder p="md" radius="md" shadow="sm" bg={cardBg} style={{ borderColor: cardBorder }}>
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            <ThemeIcon color="teal" variant="light" radius="xl"><IconPlus size={16} /></ThemeIcon>
            <Title order={4}>{t("Invite Athlete") || "Invite Athlete"}</Title>
          </Group>
          <Button size="compact-sm" variant="light" onClick={onGenerateInvite} loading={generatingInvite}>
            {t("Generate Link") || "Generate Link"}
          </Button>
        </Group>

        <Group align="end" wrap="wrap">
          <TextInput
            placeholder="athlete@example.com"
            value={inviteEmail}
            onChange={(event) => onInviteEmailChange(event.currentTarget.value)}
            leftSection={<IconAt size={16} />}
            style={{ flex: 1 }}
            size="sm"
          />
          <Button size="sm" onClick={onInviteByEmail} loading={invitingByEmail}>
            {t("Invite") || "Invite"}
          </Button>
        </Group>

        <Textarea
          placeholder={t("Write a short message to the athlete...") || "Write a short message to the athlete..."}
          value={inviteMessage}
          onChange={(e) => onInviteMessageChange(e.currentTarget.value)}
          maxLength={500}
          autosize
          minRows={1}
          maxRows={3}
          mt="xs"
          size="sm"
        />

        {inviteUrl && (
          <Paper
            bg={isDark ? "dark.6" : "gray.1"}
            p="xs"
            radius="sm"
            mt="sm"
            style={{ border: `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-gray-3)"}` }}
          >
            <Group justify="space-between" gap="xs">
              <Text size="xs" ff="monospace" c={isDark ? "gray.1" : "dark.8"} style={{ wordBreak: "break-all", flex: 1 }}>{inviteUrl}</Text>
              <CopyButton value={inviteUrl}>
                {({ copied, copy }) => (
                  <ActionIcon color={copied ? "teal" : "blue"} onClick={copy} variant="filled" size="sm">
                    {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  </ActionIcon>
                )}
              </CopyButton>
            </Group>
          </Paper>
        )}
      </Paper>
    </Stack>
  );
};

export default DashboardCoachHome;

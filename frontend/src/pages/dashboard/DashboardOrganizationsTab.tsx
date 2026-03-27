import {
  Avatar,
  Badge,
  Button,
  Grid,
  Group,
  Paper,
  ScrollArea,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { IconArrowLeft, IconDoorExit, IconMessages, IconSearch, IconSend, IconUserMinus, IconUsersGroup } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMediaQuery } from "@mantine/hooks";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  discoverOrganizations,
  leaveOrganization,
  listOrganizationCoachMessages,
  listOrganizationGroupMessages,
  postOrganizationCoachMessage,
  postOrganizationGroupMessage,
  removeOrganizationMember,
  requestOrganizationJoin,
} from "../../api/organizations";
import { useI18n } from "../../i18n/I18nProvider";
import { User } from "./types";
import { extractApiErrorMessage } from "./utils";

type Props = {
  me: User;
  athletes: User[];
};

const DashboardOrganizationsTab = ({ me, athletes }: Props) => {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const isDark = useComputedColorScheme("light") === "dark";
  const isMobile = useMediaQuery("(max-width: 62em)");
  const [search, setSearch] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [groupBody, setGroupBody] = useState("");
  const [coachBody, setCoachBody] = useState("");
  const activeViewportRef = useRef<HTMLDivElement | null>(null);

  const discoverQuery = useQuery({
    queryKey: ["organization-discover", search],
    queryFn: () => discoverOrganizations(search),
  });

  const activeMemberships = useMemo(
    () =>
      (me.organization_memberships || []).filter(
        (membership) => membership.role === me.role && membership.status === "active" && membership.organization,
      ),
    [me.organization_memberships, me.role],
  );

  const [selectedActiveOrgId, setSelectedActiveOrgId] = useState<string | null>(
    activeMemberships[0]?.organization?.id?.toString() || null,
  );

  useEffect(() => {
    const validIds = activeMemberships
      .map((membership) => membership.organization?.id)
      .filter((value): value is number => typeof value === "number")
      .map((value) => String(value));

    if (validIds.length === 0) {
      setSelectedActiveOrgId(null);
      return;
    }

    if (!selectedActiveOrgId || !validIds.includes(selectedActiveOrgId)) {
      setSelectedActiveOrgId(validIds[0]);
    }
  }, [activeMemberships, selectedActiveOrgId]);

  const selectedActiveOrganizationId = selectedActiveOrgId ? Number(selectedActiveOrgId) : null;

  const coachOptions = useMemo(() => {
    if (me.role !== "athlete") return [];
    if (!selectedActiveOrganizationId) return [];

    const fromMyCoaches = (me.coaches || [])
      .filter((coach) => (coach.organization_ids || []).includes(selectedActiveOrganizationId))
      .map((coach) => ({
        value: coach.id.toString(),
        label: `${coach.first_name || ""} ${coach.last_name || ""}`.trim() || coach.email,
      }));

    if (fromMyCoaches.length > 0) return fromMyCoaches;

    const org = (discoverQuery.data?.items || []).find((item) => item.id === selectedActiveOrganizationId);
    return (org?.coaches || []).map((coach) => ({
      value: coach.id.toString(),
      label: `${coach.first_name || ""} ${coach.last_name || ""}`.trim() || coach.email,
    }));
  }, [discoverQuery.data?.items, me.coaches, me.role, selectedActiveOrganizationId]);

  const athleteOptions = useMemo(() => {
    if (me.role !== "coach") return [];
    return (athletes || []).map((athlete) => {
      const label = (athlete.profile?.first_name || athlete.profile?.last_name)
        ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
        : athlete.email;
      return {
        value: String(athlete.id),
        label,
      };
    });
  }, [athletes, me.role]);

  const [selectedCoachId, setSelectedCoachId] = useState<string | null>(coachOptions[0]?.value || null);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(athleteOptions[0]?.value || null);
  const [activeThreadKey, setActiveThreadKey] = useState<string>("group");
  const [mobilePane, setMobilePane] = useState<"threads" | "messages">("threads");

  useEffect(() => {
    if (coachOptions.length === 0) {
      setSelectedCoachId(null);
      return;
    }
    if (!selectedCoachId || !coachOptions.some((option) => option.value === selectedCoachId)) {
      setSelectedCoachId(coachOptions[0].value);
    }
  }, [coachOptions, selectedCoachId]);

  useEffect(() => {
    if (athleteOptions.length === 0) {
      setSelectedAthleteId(null);
      return;
    }
    if (!selectedAthleteId || !athleteOptions.some((option) => option.value === selectedAthleteId)) {
      setSelectedAthleteId(athleteOptions[0].value);
    }
  }, [athleteOptions, selectedAthleteId]);

  useEffect(() => {
    if (!activeThreadKey.startsWith("direct:")) return;
    const directIdFromKey = activeThreadKey.split(":")[1] || null;
    if (!directIdFromKey) return;

    if (me.role === "coach") {
      if (directIdFromKey !== selectedAthleteId) {
        setSelectedAthleteId(directIdFromKey);
      }
      return;
    }

    if (directIdFromKey !== selectedCoachId) {
      setSelectedCoachId(directIdFromKey);
    }
  }, [activeThreadKey, me.role, selectedAthleteId, selectedCoachId]);

  const joinMutation = useMutation({
    mutationFn: (organizationId: number) => requestOrganizationJoin(organizationId),
    onSuccess: (data) => {
      notifications.show({ color: "green", title: t("Request sent"), message: data.message });
      queryClient.invalidateQueries({ queryKey: ["organization-discover"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Could not send request"), message: extractApiErrorMessage(error) });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: (organizationId: number) => leaveOrganization(organizationId),
    onSuccess: () => {
      notifications.show({ color: "green", title: t("Left organization"), message: "" });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["organization-discover"] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Could not leave"), message: extractApiErrorMessage(error) });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (vars: { organizationId: number; userId: number }) => removeOrganizationMember(vars.organizationId, vars.userId),
    onSuccess: () => {
      notifications.show({ color: "green", title: t("Member removed"), message: "" });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["organization-discover"] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Could not remove member"), message: extractApiErrorMessage(error) });
    },
  });

  const groupMessagesQuery = useQuery({
    queryKey: ["org-group-chat", selectedActiveOrganizationId],
    queryFn: () => listOrganizationGroupMessages(selectedActiveOrganizationId as number),
    enabled: Boolean(selectedActiveOrganizationId),
    refetchInterval: 15000,
  });

  const coachMessagesQuery = useQuery({
    queryKey: ["org-coach-chat", selectedActiveOrganizationId, me.role, selectedCoachId, selectedAthleteId],
    queryFn: () => listOrganizationCoachMessages(
      selectedActiveOrganizationId as number,
      me.role === "coach"
        ? { athleteId: Number(selectedAthleteId) }
        : { coachId: Number(selectedCoachId) },
    ),
    enabled: Boolean(selectedActiveOrganizationId && (me.role === "coach" ? selectedAthleteId : selectedCoachId)),
    refetchInterval: 15000,
  });

  const formatSenderName = (senderName?: string | null, senderId?: number) => {
    if (senderId === me.id) return "You";
    return senderName || (typeof senderId === "number" ? `User #${senderId}` : "User");
  };

  const formatMessageTime = (createdAt?: string) => {
    if (!createdAt) return "";
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatThreadTime = (createdAt?: string) => {
    if (!createdAt) return "";
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleMessageInputKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
    action: () => void,
    canSend: boolean,
  ) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSend) action();
  };

  const threads = useMemo(() => {
    const groupLast = (groupMessagesQuery.data || []).slice(-1)[0];
    const groupPreview = groupLast?.body || "Organization announcements and group discussion";

    const directThreads = (me.role === "coach" ? athleteOptions : coachOptions).map((person) => {
      const selectedDirectPreview = (me.role === "coach" ? selectedAthleteId : selectedCoachId) === person.value
        ? (coachMessagesQuery.data || []).slice(-1)[0]?.body
        : undefined;
      return {
        key: `direct:${person.value}`,
        type: "direct" as const,
        label: person.label,
        subtitle: selectedDirectPreview || (me.role === "coach" ? "Direct athlete conversation" : "Direct coach conversation"),
        directId: person.value,
        lastMessageAt: selectedDirectPreview ? (coachMessagesQuery.data || []).slice(-1)[0]?.created_at : null,
        unread: Boolean(selectedDirectPreview && (coachMessagesQuery.data || []).slice(-1)[0]?.sender_id !== me.id),
      };
    });

    return [
      {
        key: "group",
        type: "group" as const,
        label: "Organization Group",
        subtitle: groupPreview,
        lastMessageAt: groupLast?.created_at || null,
        unread: Boolean(groupLast && groupLast.sender_id !== me.id),
      },
      ...directThreads,
    ];
  }, [athleteOptions, coachMessagesQuery.data, coachOptions, groupMessagesQuery.data, me.id, me.role, selectedAthleteId, selectedCoachId]);

  const filteredThreads = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) =>
      thread.label.toLowerCase().includes(query) || thread.subtitle.toLowerCase().includes(query),
    );
  }, [threadSearch, threads]);

  const activeThread = useMemo(() => {
    return threads.find((thread) => thread.key === activeThreadKey) || threads[0] || null;
  }, [activeThreadKey, threads]);

  const activeMessages = useMemo(() => {
    if (!activeThread) return [];
    return activeThread.type === "group" ? (groupMessagesQuery.data || []) : (coachMessagesQuery.data || []);
  }, [activeThread, coachMessagesQuery.data, groupMessagesQuery.data]);

  const activeLoading = activeThread?.type === "group" ? groupMessagesQuery.isLoading : coachMessagesQuery.isLoading;

  useEffect(() => {
    if (!activeViewportRef.current) return;
    activeViewportRef.current.scrollTo({ top: activeViewportRef.current.scrollHeight, behavior: "smooth" });
  }, [activeMessages, activeThreadKey]);

  const activeBody = activeThread?.type === "group" ? groupBody : coachBody;

  const sendGroupMutation = useMutation({
    mutationFn: () => postOrganizationGroupMessage(selectedActiveOrganizationId as number, groupBody.trim()),
    onSuccess: () => {
      setGroupBody("");
      queryClient.invalidateQueries({ queryKey: ["org-group-chat", selectedActiveOrganizationId] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Message failed"), message: extractApiErrorMessage(error) });
    },
  });

  const sendCoachMutation = useMutation({
    mutationFn: () => postOrganizationCoachMessage(
      selectedActiveOrganizationId as number,
      me.role === "coach"
        ? { athleteId: Number(selectedAthleteId) }
        : { coachId: Number(selectedCoachId) },
      coachBody.trim(),
    ),
    onSuccess: () => {
      setCoachBody("");
      queryClient.invalidateQueries({ queryKey: ["org-coach-chat", selectedActiveOrganizationId] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Message failed"), message: extractApiErrorMessage(error) });
    },
  });

  const sendActiveThreadMessage = () => {
    if (!activeThread) return;
    if (activeThread.type === "group") {
      if (!groupBody.trim() || !selectedActiveOrganizationId || sendGroupMutation.isPending) return;
      sendGroupMutation.mutate();
      return;
    }
    if (!coachBody.trim() || !selectedActiveOrganizationId || !(me.role === "coach" ? selectedAthleteId : selectedCoachId) || sendCoachMutation.isPending) return;
    sendCoachMutation.mutate();
  };

  const activeSendPending = activeThread?.type === "group" ? sendGroupMutation.isPending : sendCoachMutation.isPending;
  const canSendActive = activeThread?.type === "group"
    ? Boolean(groupBody.trim() && selectedActiveOrganizationId)
    : Boolean(coachBody.trim() && selectedActiveOrganizationId && (me.role === "coach" ? selectedAthleteId : selectedCoachId));

  const openThread = (threadKey: string) => {
    setActiveThreadKey(threadKey);
    if (threadKey.startsWith("direct:")) {
      const directId = threadKey.split(":")[1] || null;
      if (!directId) return;
      if (me.role === "coach") {
        setSelectedAthleteId(directId);
      } else {
        setSelectedCoachId(directId);
      }
    }
    if (isMobile) {
      setMobilePane("messages");
    }
  };

  return (
    <Stack gap="md">
      {/* ── Header ── */}
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <ThemeIcon size="lg" radius="xl" variant="light" color="indigo">
            <IconUsersGroup size={18} />
          </ThemeIcon>
          <Title order={3}>{t("Organizations")}</Title>
        </Group>
        {activeMemberships.length > 1 && (
          <Select
            size="xs"
            w={220}
            placeholder={t("Switch organization")}
            data={activeMemberships
              .filter((m) => m.organization)
              .map((m) => ({ value: String(m.organization?.id), label: m.organization?.name || t("Organization") }))}
            value={selectedActiveOrgId}
            onChange={setSelectedActiveOrgId}
            allowDeselect={false}
          />
        )}
      </Group>

      {/* ── Discover section (athlete only) ── */}
      {me.role === "athlete" && (
        <Paper withBorder p="md" radius="md" style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)" }}>
          <Stack gap="sm">
            <Group gap="xs">
              <IconSearch size={16} />
              <Text fw={600} size="sm">{t("Discover clubs")}</Text>
            </Group>
            <TextInput
              size="sm"
              placeholder={t("Search clubs")}
              leftSection={<IconSearch size={14} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            {(discoverQuery.data?.items || []).length > 0 && (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                {(discoverQuery.data?.items || []).map((item) => (
                  <Paper
                    key={item.id}
                    withBorder
                    p="sm"
                    radius="md"
                    style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.18)" }}
                  >
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Stack gap={2} style={{ flex: 1 }}>
                        <Group gap="xs">
                          <Text fw={600} size="sm">{item.name}</Text>
                          {item.my_membership_status && (
                            <Badge size="xs" variant="light" color={item.my_membership_status === "active" ? "green" : "yellow"}>
                              {item.my_membership_status === "active" ? t("Active") : item.my_membership_status === "pending_approval" ? t("Pending") : item.my_membership_status}
                            </Badge>
                          )}
                        </Group>
                        {item.description && <Text size="xs" c="dimmed" lineClamp={2}>{item.description}</Text>}
                        <Text size="xs" c="dimmed">
                          {item.coaches.map((c) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email).join(", ") || t("No coaches")}
                        </Text>
                      </Stack>
                      <Button
                        size="compact-xs"
                        variant="light"
                        onClick={() => joinMutation.mutate(item.id)}
                        loading={joinMutation.isPending}
                        disabled={item.my_membership_status === "active" || item.my_membership_status === "pending_approval"}
                      >
                        {item.my_membership_status === "active" ? t("Joined") : item.my_membership_status === "pending_approval" ? t("Pending") : t("Join")}
                      </Button>
                    </Group>
                  </Paper>
                ))}
              </SimpleGrid>
            )}
            {(discoverQuery.data?.items || []).length === 0 && !discoverQuery.isLoading && (
              <Text size="sm" c="dimmed">{t("No organizations found.")}</Text>
            )}
          </Stack>
        </Paper>
      )}

      {/* ── Active Org: Members + Leave ── */}
      {selectedActiveOrganizationId && (
        <Paper withBorder p="md" radius="md" style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)" }}>
          <Group justify="space-between" mb={me.role === "coach" ? "xs" : 0}>
            <Group gap="xs">
              <ThemeIcon size="sm" radius="xl" variant="light" color="indigo">
                <IconUsersGroup size={12} />
              </ThemeIcon>
              <Text fw={600} size="sm">{t("Members")}</Text>
            </Group>
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              leftSection={<IconDoorExit size={14} />}
              onClick={() => {
                if (window.confirm(t("Are you sure you want to leave this organization?"))) {
                  leaveMutation.mutate(selectedActiveOrganizationId);
                }
              }}
              loading={leaveMutation.isPending}
            >
              {t("Leave organization")}
            </Button>
          </Group>
          {me.role === "coach" && athletes.length > 0 && (
            <Stack gap={4} mt="xs">
              {athletes.map((athlete) => {
                const name = (athlete.profile?.first_name || athlete.profile?.last_name)
                  ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
                  : athlete.email;
                return (
                  <Group key={athlete.id} justify="space-between" py={2}>
                    <Group gap="xs">
                      <Avatar radius="xl" size="sm" color="blue">
                        {name.slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Text size="sm">{name}</Text>
                    </Group>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconUserMinus size={12} />}
                      onClick={() => {
                        if (window.confirm(t("Remove this member from the organization?"))) {
                          removeMemberMutation.mutate({ organizationId: selectedActiveOrganizationId, userId: athlete.id });
                        }
                      }}
                      loading={removeMemberMutation.isPending}
                    >
                      {t("Remove")}
                    </Button>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Paper>
      )}

      {/* ── Messaging ── */}
      {activeMemberships.length === 0 ? (
        <Paper withBorder p="xl" radius="md" style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)", textAlign: "center" }}>
          <Stack align="center" gap="sm">
            <ThemeIcon size="xl" radius="xl" variant="light" color="gray">
              <IconMessages size={24} />
            </ThemeIcon>
            <Text c="dimmed">{t("Join an organization to use group and coach chat.")}</Text>
          </Stack>
        </Paper>
      ) : (
        <>
          {isMobile && (
            <SegmentedControl
              fullWidth
              value={mobilePane}
              onChange={(v) => setMobilePane(v as "threads" | "messages")}
              data={[
                { value: "threads", label: t("Chats") },
                { value: "messages", label: t("Messages") },
              ]}
            />
          )}

          <Grid gutter="md">
            {/* ─ Thread list ─ */}
            {(!isMobile || mobilePane === "threads") && (
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Paper
                  withBorder
                  radius="md"
                  style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)", overflow: "hidden" }}
                >
                  <Stack gap={0}>
                    <Group
                      px="sm"
                      py="xs"
                      style={{ borderBottom: `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.18)"}` }}
                    >
                      <TextInput
                        size="xs"
                        leftSection={<IconSearch size={14} />}
                        placeholder={t("Search conversations")}
                        value={threadSearch}
                        onChange={(e) => setThreadSearch(e.currentTarget.value)}
                        style={{ flex: 1 }}
                        variant="unstyled"
                      />
                    </Group>
                    <ScrollArea h={isMobile ? 400 : 520} type="hover" offsetScrollbars>
                      <Stack gap={0}>
                        {filteredThreads.map((thread) => {
                          const selected = thread.key === activeThread?.key;
                          return (
                            <Group
                              key={thread.key}
                              wrap="nowrap"
                              align="flex-start"
                              px="sm"
                              py="xs"
                              gap="sm"
                              style={{
                                cursor: "pointer",
                                borderLeft: selected ? `3px solid var(--mantine-color-indigo-6)` : "3px solid transparent",
                                background: selected ? (isDark ? "rgba(99,102,241,0.1)" : "rgba(99,102,241,0.06)") : "transparent",
                                transition: "background 120ms ease",
                              }}
                              onClick={() => openThread(thread.key)}
                            >
                              <Avatar radius="xl" size="md" color={thread.type === "group" ? "indigo" : "blue"}>
                                {thread.type === "group" ? <IconUsersGroup size={14} /> : thread.label.slice(0, 1).toUpperCase()}
                              </Avatar>
                              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                                <Group justify="space-between" gap={4} wrap="nowrap">
                                  <Text size="sm" fw={selected || thread.unread ? 700 : 500} lineClamp={1}>
                                    {thread.label}
                                  </Text>
                                  <Text size="10px" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                                    {formatThreadTime(thread.lastMessageAt || undefined)}
                                  </Text>
                                </Group>
                                <Text size="xs" c="dimmed" lineClamp={1}>{thread.subtitle}</Text>
                              </Stack>
                              {thread.unread && !selected && (
                                <ThemeIcon size={8} radius="xl" color="blue" variant="filled" style={{ alignSelf: "center" }} />
                              )}
                            </Group>
                          );
                        })}
                        {filteredThreads.length === 0 && (
                          <Text size="sm" c="dimmed" p="sm">{t("No conversations found.")}</Text>
                        )}
                      </Stack>
                    </ScrollArea>
                  </Stack>
                </Paper>
              </Grid.Col>
            )}

            {/* ─ Message pane ─ */}
            {(!isMobile || mobilePane === "messages") && (
              <Grid.Col span={{ base: 12, md: 8 }}>
                <Paper
                  withBorder
                  radius="md"
                  style={{
                    borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)",
                    display: "flex",
                    flexDirection: "column",
                    height: isMobile ? "auto" : "calc(520px + 2 * var(--mantine-spacing-xs) + 60px)",
                    overflow: "hidden",
                  }}
                >
                  {/* Chat header */}
                  <Group
                    justify="space-between"
                    px="md"
                    py="sm"
                    style={{ borderBottom: `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.18)"}`, flexShrink: 0 }}
                  >
                    <Group gap="sm" wrap="nowrap">
                      {isMobile && (
                        <Button variant="subtle" size="compact-xs" onClick={() => setMobilePane("threads")}>
                          <IconArrowLeft size={16} />
                        </Button>
                      )}
                      <Avatar radius="xl" size="sm" color={activeThread?.type === "group" ? "indigo" : "blue"}>
                        {activeThread?.type === "group" ? <IconUsersGroup size={14} /> : (activeThread?.label || "?").slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Stack gap={0}>
                        <Text size="sm" fw={700}>{activeThread?.label || "Conversation"}</Text>
                        <Text size="10px" c="dimmed">
                          {activeThread?.type === "group"
                            ? t("Group chat")
                            : me.role === "coach" ? t("Direct message") : t("Direct message")}
                        </Text>
                      </Stack>
                    </Group>
                  </Group>

                  {/* Messages area */}
                  <ScrollArea style={{ flex: 1 }} viewportRef={activeViewportRef} type="hover" offsetScrollbars px="md" py="sm">
                    <Stack gap="sm">
                      {activeMessages.slice(-100).map((message) => {
                        const mine = message.sender_id === me.id;
                        const senderName = formatSenderName(message.sender_name, message.sender_id);
                        return (
                          <Group key={message.id} justify={mine ? "flex-end" : "flex-start"} align="flex-end" wrap="nowrap" gap="xs">
                            {!mine && (
                              <Avatar radius="xl" size="sm" color="blue" style={{ flexShrink: 0 }}>
                                {senderName.slice(0, 1).toUpperCase()}
                              </Avatar>
                            )}
                            <Stack
                              gap={2}
                              maw="72%"
                              style={{
                                padding: "8px 14px",
                                borderRadius: mine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                                background: mine
                                  ? (isDark ? "rgba(99,102,241,0.25)" : "rgba(99,102,241,0.12)")
                                  : (isDark ? "var(--mantine-color-dark-5)" : "var(--mantine-color-gray-1)"),
                              }}
                            >
                              {!mine && (
                                <Text size="11px" fw={600} c={isDark ? "indigo.3" : "indigo.7"}>
                                  {senderName}
                                </Text>
                              )}
                              <Text size="sm" c={isDark ? "gray.1" : "dark.8"} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                {message.body}
                              </Text>
                              <Text size="10px" ta="right" c="dimmed">
                                {formatMessageTime(message.created_at)}
                              </Text>
                            </Stack>
                          </Group>
                        );
                      })}
                      {activeLoading && <Text size="sm" c="dimmed">{t("Loading messages…")}</Text>}
                      {!activeLoading && activeMessages.length === 0 && (
                        <Stack align="center" py="xl" gap="xs">
                          <IconMessages size={32} color="var(--mantine-color-dimmed)" />
                          <Text size="sm" c="dimmed">{t("No messages yet. Start this conversation.")}</Text>
                        </Stack>
                      )}
                    </Stack>
                  </ScrollArea>

                  {/* Input area */}
                  <Group
                    px="md"
                    py="sm"
                    gap="sm"
                    style={{ borderTop: `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.18)"}`, flexShrink: 0 }}
                    wrap="nowrap"
                  >
                    <Textarea
                      placeholder={activeThread?.type === "group" ? t("Write a message...") : t("Write a direct message...")}
                      value={activeBody}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        if (activeThread?.type === "group") setGroupBody(v);
                        else setCoachBody(v);
                      }}
                      minRows={1}
                      maxRows={4}
                      autosize
                      style={{ flex: 1 }}
                      onKeyDown={(e) => handleMessageInputKeyDown(e, sendActiveThreadMessage, Boolean(canSendActive && !activeSendPending))}
                    />
                    <Button
                      size="sm"
                      radius="xl"
                      px="md"
                      onClick={sendActiveThreadMessage}
                      loading={activeSendPending}
                      disabled={!canSendActive}
                      color="indigo"
                    >
                      <IconSend size={16} />
                    </Button>
                  </Group>
                </Paper>
              </Grid.Col>
            )}
          </Grid>
        </>
      )}
    </Stack>
  );
};

export default DashboardOrganizationsTab;

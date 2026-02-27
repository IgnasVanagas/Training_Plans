import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
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
import { IconArrowLeft, IconMessages, IconSearch, IconSend, IconUsersGroup } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMediaQuery } from "@mantine/hooks";
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  discoverOrganizations,
  listOrganizationCoachMessages,
  listOrganizationGroupMessages,
  postOrganizationCoachMessage,
  postOrganizationGroupMessage,
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
    <Stack gap="lg">
      <Title order={3}>{t("Organizations")}</Title>
      {me.role === "athlete" && (
        <>
          <TextInput
            placeholder={t("Search clubs")}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />

          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {(discoverQuery.data?.items || []).map((item) => (
              <Card key={item.id} withBorder>
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Text fw={600}>{item.name}</Text>
                      {item.description ? <Text size="sm" c="dimmed">{item.description}</Text> : null}
                    </div>
                    {item.my_membership_status ? <Badge>{item.my_membership_status}</Badge> : null}
                  </Group>
                  <Text size="sm" c="dimmed">
                    {t("Coaches")}: {item.coaches.length > 0 ? item.coaches.map((coach) => `${coach.first_name || ""} ${coach.last_name || ""}`.trim() || coach.email).join(", ") : t("None listed")}
                  </Text>
                  <Button
                    onClick={() => joinMutation.mutate(item.id)}
                    loading={joinMutation.isPending}
                    disabled={item.my_membership_status === "active" || item.my_membership_status === "pending_approval"}
                  >
                    {item.my_membership_status === "active"
                      ? t("Active")
                      : item.my_membership_status === "pending_approval"
                        ? t("Pending approval")
                        : t("Request to Join")}
                  </Button>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        </>
      )}

      <Divider label={t("Chats")} labelPosition="center" />

      {activeMemberships.length === 0 ? (
        <Text c="dimmed">{t("Join an organization to use group and coach chat.")}</Text>
      ) : (
        <Stack gap="md">
          <Select
            label={t("Active organization")}
            data={activeMemberships
              .filter((membership) => membership.organization)
              .map((membership) => {
                const org = membership.organization;
                return {
                  value: String(org?.id),
                  label: org?.name || t("Organization"),
                };
              })}
            value={selectedActiveOrgId}
            onChange={setSelectedActiveOrgId}
            allowDeselect={false}
          />

          <Paper withBorder p="xs" radius="md" bg={isDark ? "dark.6" : "gray.0"}>
            <Group justify="space-between">
              <Group gap="xs">
                <ThemeIcon variant="light" radius="xl">
                  <IconMessages size={14} />
                </ThemeIcon>
                <Text fw={600}>{t("Messages")}</Text>
              </Group>
              <Text size="xs" c="dimmed">{t("Enter to send · Shift+Enter for new line")}</Text>
            </Group>
          </Paper>

          {isMobile && (
            <SegmentedControl
              fullWidth
              value={mobilePane}
              onChange={(value) => setMobilePane(value as "threads" | "messages")}
              data={[
                { value: "threads", label: t("Chats") },
                { value: "messages", label: t("Messages") },
              ]}
            />
          )}

          <Grid gutter="md">
            {(!isMobile || mobilePane === "threads") && (
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Card withBorder p="sm" radius="md">
                  <Stack gap="sm">
                    <TextInput
                      leftSection={<IconSearch size={14} />}
                      placeholder={t("Search conversations")}
                      value={threadSearch}
                      onChange={(event) => setThreadSearch(event.currentTarget.value)}
                    />
                    {me.role === "coach" && (
                      <Select
                        label={t("Athlete")}
                        data={athleteOptions}
                        value={selectedAthleteId}
                        onChange={setSelectedAthleteId}
                        allowDeselect={false}
                      />
                    )}
                    <ScrollArea h={isMobile ? 380 : 460} type="hover" offsetScrollbars>
                      <Stack gap={6}>
                        {filteredThreads.map((thread) => {
                          const selected = thread.key === activeThread?.key;
                          return (
                            <Paper
                              key={thread.key}
                              withBorder
                              radius="md"
                              p="xs"
                              style={{ cursor: "pointer" }}
                              bg={selected ? (isDark ? "dark.5" : "blue.0") : (isDark ? "dark.6" : undefined)}
                              onClick={() => openThread(thread.key)}
                            >
                              <Group wrap="nowrap" align="flex-start">
                                <Avatar radius="xl" size="sm" color={thread.type === "group" ? "indigo" : "blue"}>
                                  {thread.type === "group" ? <IconUsersGroup size={12} /> : thread.label.slice(0, 1).toUpperCase()}
                                </Avatar>
                                <Stack gap={0} style={{ flex: 1 }}>
                                  <Group justify="space-between" gap="xs" wrap="nowrap">
                                    <Text size="sm" fw={600} c={isDark ? "gray.0" : undefined} lineClamp={1}>{thread.label}</Text>
                                    <Group gap={6} wrap="nowrap">
                                      {thread.unread && !selected ? (
                                        <ThemeIcon size={12} radius="xl" color="blue" variant="filled" />
                                      ) : null}
                                      <Text size="10px" c={isDark ? "gray.4" : "dimmed"}>{formatThreadTime(thread.lastMessageAt || undefined)}</Text>
                                    </Group>
                                  </Group>
                                  <Text size="xs" c={thread.unread && !selected ? "blue.3" : (isDark ? "gray.4" : "dimmed")} lineClamp={2}>{thread.subtitle}</Text>
                                </Stack>
                              </Group>
                            </Paper>
                          );
                        })}
                        {filteredThreads.length === 0 ? (
                          <Text size="sm" c="dimmed">{t("No conversations found.")}</Text>
                        ) : null}
                      </Stack>
                    </ScrollArea>
                  </Stack>
                </Card>
              </Grid.Col>
            )}

            {(!isMobile || mobilePane === "messages") && (
              <Grid.Col span={{ base: 12, md: 8 }}>
                <Card withBorder p="sm" radius="md">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Group wrap="nowrap">
                        {isMobile && (
                          <Button variant="subtle" size="compact-sm" leftSection={<IconArrowLeft size={14} />} onClick={() => setMobilePane("threads")}>
                            {t("Chats")}
                          </Button>
                        )}
                        <Avatar radius="xl" color={activeThread?.type === "group" ? "indigo" : "blue"}>
                          {activeThread?.type === "group" ? <IconUsersGroup size={14} /> : (activeThread?.label || "C").slice(0, 1).toUpperCase()}
                        </Avatar>
                        <Stack gap={0}>
                          <Text fw={700}>{activeThread?.label || "Conversation"}</Text>
                          <Text size="xs" c="dimmed">
                            {activeThread?.type === "group"
                              ? t("Organization group conversation")
                              : (me.role === "coach" ? t("Direct athlete conversation") : t("Direct coach conversation"))}
                          </Text>
                        </Stack>
                      </Group>
                      <Badge variant="light">{activeMessages.length}</Badge>
                    </Group>

                    <Paper withBorder radius="md" p="xs" bg={isDark ? "dark.6" : "gray.0"}>
                      <ScrollArea h={isMobile ? 300 : 360} viewportRef={activeViewportRef} type="hover" offsetScrollbars>
                        <Stack gap="xs" p={2}>
                          {activeMessages.slice(-50).map((message) => {
                            const mine = message.sender_id === me.id;
                            const senderName = formatSenderName(message.sender_name, message.sender_id);
                            return (
                              <Group key={message.id} justify={mine ? "flex-end" : "flex-start"} align="flex-end" wrap="nowrap" gap="xs">
                                {!mine && (
                                  <Avatar radius="xl" size="sm">
                                    {senderName.slice(0, 1).toUpperCase()}
                                  </Avatar>
                                )}
                                <Paper
                                  radius="lg"
                                  px="sm"
                                  py={6}
                                  bg={mine ? (isDark ? "blue.7" : "blue.6") : (isDark ? "dark.4" : "gray.1")}
                                  c={mine ? "white" : (isDark ? "gray.0" : "dark.8")}
                                  maw="78%"
                                  style={{ borderRadius: mine ? "18px 18px 4px 18px" : "18px 18px 18px 4px" }}
                                >
                                  <Text size="xs" fw={600} c={mine ? "blue.1" : (isDark ? "gray.4" : "dimmed")}>
                                    {senderName}
                                  </Text>
                                  <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                    {message.body}
                                  </Text>
                                  <Text size="10px" ta="right" c={mine ? "blue.2" : (isDark ? "gray.5" : "dimmed")}>
                                    {formatMessageTime(message.created_at)}
                                  </Text>
                                </Paper>
                              </Group>
                            );
                          })}
                          {activeLoading ? <Text size="sm" c="dimmed">{t("Loading messages…")}</Text> : null}
                          {!activeLoading && activeMessages.length === 0 ? (
                            <Text size="sm" c="dimmed">{t("No messages yet. Start this conversation.")}</Text>
                          ) : null}
                        </Stack>
                      </ScrollArea>
                    </Paper>

                    <Textarea
                      placeholder={activeThread?.type === "group" ? t("Write a message...") : t("Write a direct message...")}
                      value={activeBody}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        if (activeThread?.type === "group") setGroupBody(value);
                        else setCoachBody(value);
                      }}
                      minRows={2}
                      maxRows={5}
                      autosize
                      onKeyDown={(event) =>
                        handleMessageInputKeyDown(
                          event,
                          sendActiveThreadMessage,
                          Boolean(canSendActive && !activeSendPending),
                        )
                      }
                    />

                    <Group justify="flex-end">
                      <Button
                        rightSection={<IconSend size={14} />}
                        onClick={sendActiveThreadMessage}
                        loading={activeSendPending}
                        disabled={!canSendActive}
                      >
                        {t("Send")}
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              </Grid.Col>
            )}
          </Grid>
        </Stack>
      )}
    </Stack>
  );
};

export default DashboardOrganizationsTab;

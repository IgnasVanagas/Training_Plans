import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Grid,
  Group,
  Image,
  Modal,
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
  Tooltip,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDoorExit,
  IconDownload,
  IconFile,
  IconMessages,
  IconPaperclip,
  IconPhoto,
  IconSearch,
  IconSend,
  IconUserMinus,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMediaQuery } from "@mantine/hooks";
import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  discoverOrganizations,
  leaveOrganization,
  listOrgDirectMessages,
  listOrganizationInbox,
  listOrganizationCoachMessages,
  listOrganizationGroupMessages,
  postOrgDirectMessage,
  postOrganizationCoachMessage,
  postOrganizationGroupMessage,
  removeOrganizationMember,
  requestOrganizationJoin,
  uploadChatAttachment,
} from "../../api/organizations";
import { useI18n } from "../../i18n/I18nProvider";
import { OrganizationDirectMessage, OrganizationCoachMessage, OrganizationGroupMessage, User } from "./types";
import { extractApiErrorMessage } from "./utils";

type AnyMessage = (OrganizationGroupMessage | OrganizationCoachMessage | OrganizationDirectMessage) & {
  attachment_url?: string | null;
  attachment_name?: string | null;
};

type Props = {
  me: User;
  athletes: User[];
  initialShareText?: string;
};

// Resolve backend attachment URL → full URL served by the backend
const resolveAttachmentUrl = (url: string): string => {
  const base = (import.meta as unknown as Record<string, unknown> & { env?: Record<string, string> })?.env?.VITE_API_BASE_URL
    ?? "http://localhost:8000";
  return `${base.replace(/\/$/, "")}/uploads/chat/${url}`;
};

const isImageAttachment = (name?: string | null) => {
  if (!name) return false;
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
};

const DashboardOrganizationsTab = ({ me, athletes, initialShareText }: Props) => {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const isDark = useComputedColorScheme("light") === "dark";
  const isMobile = useMediaQuery("(max-width: 62em)");
  const [search, setSearch] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [groupBody, setGroupBody] = useState("");
  const [coachBody, setCoachBody] = useState("");
  const [directBody, setDirectBody] = useState("");
  const activeViewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pending attachment for the active thread
  const [pendingAttachment, setPendingAttachment] = useState<{ url: string; name: string } | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: "", message: "", onConfirm: () => {} });

  const discoverQuery = useQuery({
    queryKey: ["organization-discover", search],
    queryFn: () => discoverOrganizations(search),
    enabled: search.trim().length >= 1,
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

  const [activeThreadKey, setActiveThreadKey] = useState<string>("group");
  const [mobilePane, setMobilePane] = useState<"threads" | "messages">("threads");

  // Pre-fill from share
  useEffect(() => {
    if (!initialShareText) return;
    setGroupBody(initialShareText);
    setActiveThreadKey("group");
  }, [initialShareText]);

  useEffect(() => {
    setActiveThreadKey("group");
    setPendingAttachment(null);
  }, [selectedActiveOrganizationId]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const handleVisibilityChange = () => setIsDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const inboxQuery = useQuery({
    queryKey: ["org-chat-inbox", selectedActiveOrganizationId],
    queryFn: () => listOrganizationInbox(selectedActiveOrganizationId as number),
    enabled: Boolean(selectedActiveOrganizationId),
    refetchInterval: isDocumentVisible ? 15000 : false,
    staleTime: 2000,
    refetchIntervalInBackground: false,
  });

  const threads = useMemo(() => {
    const items = inboxQuery.data?.items || [];
    const sourceItems = items.length > 0
      ? items
      : [{ key: "group", thread_type: "group" as const, body_preview: null, created_at: null, sender_id: null }];

    return sourceItems.map((item) => {
      const isGroupThread = item.thread_type === "group";
      const label = isGroupThread
        ? t("Organization Group")
        : item.participant_name || (item.participant_id ? `User #${item.participant_id}` : t("Conversation"));
      const subtitle = item.body_preview
        || (isGroupThread
          ? t("Organization announcements and group discussion")
          : item.thread_type === "coach"
            ? (me.role === "coach" ? t("Direct athlete conversation") : t("Direct coach conversation"))
            : t("Direct message"));

      return {
        key: item.key,
        type: isGroupThread ? "group" as const : "direct" as const,
        subtype: isGroupThread ? "group" as const : item.thread_type,
        label,
        subtitle,
        participantId: item.participant_id ?? null,
        lastMessageAt: item.created_at || null,
        unread: Boolean(item.sender_id && item.sender_id !== me.id),
      };
    });
  }, [inboxQuery.data?.items, me.id, me.role, t]);

  useEffect(() => {
    if (threads.length === 0) return;
    if (!threads.some((thread) => thread.key === activeThreadKey)) {
      setActiveThreadKey(threads[0].key);
    }
  }, [activeThreadKey, threads]);

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

  const activeParticipantId = activeThread?.participantId ?? null;

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
    enabled: Boolean(selectedActiveOrganizationId && activeThread?.type === "group"),
    refetchInterval: isDocumentVisible ? 12000 : false,
    staleTime: 2000,
    refetchIntervalInBackground: false,
  });

  const coachMessagesQuery = useQuery({
    queryKey: ["org-coach-chat", selectedActiveOrganizationId, activeParticipantId],
    queryFn: () => listOrganizationCoachMessages(
      selectedActiveOrganizationId as number,
      me.role === "coach"
        ? { athleteId: activeParticipantId as number }
        : { coachId: activeParticipantId as number },
    ),
    enabled: Boolean(selectedActiveOrganizationId && activeThread?.subtype === "coach" && activeParticipantId),
    refetchInterval: isDocumentVisible ? 12000 : false,
    staleTime: 2000,
    refetchIntervalInBackground: false,
  });

  const directMessagesQuery = useQuery({
    queryKey: ["org-direct-chat", selectedActiveOrganizationId, activeParticipantId],
    queryFn: () => listOrgDirectMessages(selectedActiveOrganizationId as number, activeParticipantId as number),
    enabled: Boolean(selectedActiveOrganizationId && activeThread?.subtype === "member" && activeParticipantId),
    refetchInterval: isDocumentVisible ? 12000 : false,
    staleTime: 2000,
    refetchIntervalInBackground: false,
  });

  const formatSenderName = (senderName?: string | null, senderId?: number) => {
    if (senderId === me.id) return "You";
    return senderName || (typeof senderId === "number" ? `User #${senderId}` : "User");
  };

  const userTz = me.profile?.timezone || undefined;

  const formatMessageTime = (createdAt?: string) => {
    if (!createdAt) return "";
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: userTz });
  };

  const formatThreadTime = (createdAt?: string) => {
    if (!createdAt) return "";
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: userTz });
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

  const activeMessages = useMemo((): AnyMessage[] => {
    if (!activeThread) return [];
    if (activeThread.type === "group") return (groupMessagesQuery.data || []) as AnyMessage[];
    if (activeThread.subtype === "member") return (directMessagesQuery.data || []) as AnyMessage[];
    return (coachMessagesQuery.data || []) as AnyMessage[];
  }, [activeThread, coachMessagesQuery.data, directMessagesQuery.data, groupMessagesQuery.data]);

  const activeLoading =
    activeThread?.type === "group"
      ? groupMessagesQuery.isLoading
      : activeThread?.subtype === "member"
        ? directMessagesQuery.isLoading
        : coachMessagesQuery.isLoading;

  useEffect(() => {
    if (!activeViewportRef.current) return;
    activeViewportRef.current.scrollTo({ top: activeViewportRef.current.scrollHeight, behavior: "smooth" });
  }, [activeMessages, activeThreadKey]);

  const getActiveBody = () => {
    if (activeThread?.type === "group") return groupBody;
    if (activeThread?.subtype === "member") return directBody;
    return coachBody;
  };
  const setActiveBody = (v: string) => {
    if (activeThread?.type === "group") setGroupBody(v);
    else if (activeThread?.subtype === "member") setDirectBody(v);
    else setCoachBody(v);
  };

  const sendGroupMutation = useMutation({
    mutationFn: () => postOrganizationGroupMessage(
      selectedActiveOrganizationId as number,
      groupBody.trim(),
      pendingAttachment?.url,
      pendingAttachment?.name,
    ),
    onSuccess: () => {
      setGroupBody("");
      setPendingAttachment(null);
      queryClient.invalidateQueries({ queryKey: ["org-group-chat", selectedActiveOrganizationId] });
      queryClient.invalidateQueries({ queryKey: ["org-chat-inbox", selectedActiveOrganizationId] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Message failed"), message: extractApiErrorMessage(error) });
    },
  });

  const sendCoachMutation = useMutation({
    mutationFn: () => postOrganizationCoachMessage(
      selectedActiveOrganizationId as number,
      me.role === "coach"
        ? { athleteId: activeParticipantId as number }
        : { coachId: activeParticipantId as number },
      coachBody.trim(),
      pendingAttachment?.url,
      pendingAttachment?.name,
    ),
    onSuccess: () => {
      setCoachBody("");
      setPendingAttachment(null);
      queryClient.invalidateQueries({ queryKey: ["org-coach-chat", selectedActiveOrganizationId, activeParticipantId] });
      queryClient.invalidateQueries({ queryKey: ["org-chat-inbox", selectedActiveOrganizationId] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Message failed"), message: extractApiErrorMessage(error) });
    },
  });

  const sendDirectMutation = useMutation({
    mutationFn: () => postOrgDirectMessage(
      selectedActiveOrganizationId as number,
      activeParticipantId as number,
      directBody.trim(),
      pendingAttachment?.url,
      pendingAttachment?.name,
    ),
    onSuccess: () => {
      setDirectBody("");
      setPendingAttachment(null);
      queryClient.invalidateQueries({ queryKey: ["org-direct-chat", selectedActiveOrganizationId, activeParticipantId] });
      queryClient.invalidateQueries({ queryKey: ["org-chat-inbox", selectedActiveOrganizationId] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Message failed"), message: extractApiErrorMessage(error) });
    },
  });

  const sendActiveThreadMessage = () => {
    if (!activeThread) return;
    if (activeThread.type === "group") {
      if ((!groupBody.trim() && !pendingAttachment) || !selectedActiveOrganizationId || sendGroupMutation.isPending) return;
      sendGroupMutation.mutate();
      return;
    }
    if (activeThread.subtype === "member") {
      if ((!directBody.trim() && !pendingAttachment) || !selectedActiveOrganizationId || !activeParticipantId || sendDirectMutation.isPending) return;
      sendDirectMutation.mutate();
      return;
    }
    if ((!coachBody.trim() && !pendingAttachment) || !selectedActiveOrganizationId || !activeParticipantId || sendCoachMutation.isPending) return;
    sendCoachMutation.mutate();
  };

  const activeSendPending = activeThread?.type === "group"
    ? sendGroupMutation.isPending
    : activeThread?.subtype === "member"
      ? sendDirectMutation.isPending
      : sendCoachMutation.isPending;

  const canSendActive = Boolean(
    (getActiveBody().trim() || pendingAttachment) &&
    selectedActiveOrganizationId &&
    (activeThread?.type === "group" || activeParticipantId)
  );

  const openThread = (threadKey: string) => {
    setActiveThreadKey(threadKey);
    setPendingAttachment(null);
    if (isMobile) {
      setMobilePane("messages");
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedActiveOrganizationId) return;
    e.target.value = "";
    setAttachmentUploading(true);
    try {
      const result = await uploadChatAttachment(selectedActiveOrganizationId, file);
      setPendingAttachment({ url: result.attachment_url, name: result.attachment_name });
    } catch (error) {
      notifications.show({ color: "red", title: t("Upload failed"), message: extractApiErrorMessage(error) });
    } finally {
      setAttachmentUploading(false);
    }
  };

  const renderAttachment = (url?: string | null, name?: string | null) => {
    if (!url) return null;
    const fullUrl = resolveAttachmentUrl(url);
    if (isImageAttachment(name)) {
      return (
        <Box mt={4}>
          <Image src={fullUrl} alt={name || "image"} radius="md" maw={240} style={{ cursor: "pointer" }}
            onClick={() => window.open(fullUrl, "_blank")} />
        </Box>
      );
    }
    return (
      <Group mt={4} gap="xs" wrap="nowrap">
        <IconFile size={16} style={{ flexShrink: 0 }} />
        <Text size="xs" style={{ wordBreak: "break-all" }}>{name || url}</Text>
        <ActionIcon size="xs" variant="subtle" component="a" href={fullUrl} download={name || undefined} target="_blank">
          <IconDownload size={14} />
        </ActionIcon>
      </Group>
    );
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
            {search.trim().length === 0 && (
              <Text size="sm" c="dimmed">{t("Start typing to find clubs.")}</Text>
            )}
            {search.trim().length > 0 && (discoverQuery.data?.items || []).length > 0 && (
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
            {search.trim().length > 0 && (discoverQuery.data?.items || []).length === 0 && !discoverQuery.isLoading && (
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
              onClick={() => setConfirmModal({
                open: true,
                title: t("Leave organization"),
                message: t("Are you sure you want to leave this organization? You will lose access to group chats and shared resources."),
                onConfirm: () => leaveMutation.mutate(selectedActiveOrganizationId),
              })}
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
                      onClick={() => setConfirmModal({
                        open: true,
                        title: t("Remove member"),
                        message: `${t("Remove this member from the organization?")} (${name})`,
                        onConfirm: () => removeMemberMutation.mutate({ organizationId: selectedActiveOrganizationId, userId: athlete.id }),
                      })}
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
                        <Text size="sm" fw={700}>{activeThread?.label || t("Conversation")}</Text>
                        <Text size="10px" c="dimmed">
                          {activeThread?.type === "group" ? t("Group chat") : t("Direct message")}
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
                              {message.body && (
                                <Text size="sm" c={isDark ? "gray.1" : "dark.8"} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                  {message.body}
                                </Text>
                              )}
                              {renderAttachment(message.attachment_url, message.attachment_name)}
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

                  {/* Pending attachment preview */}
                  {pendingAttachment && (
                    <Group
                      px="md"
                      py="xs"
                      gap="xs"
                      style={{ borderTop: `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.18)"}`, flexShrink: 0, flexWrap: "nowrap" }}
                    >
                      {isImageAttachment(pendingAttachment.name) ? (
                        <IconPhoto size={16} style={{ flexShrink: 0 }} />
                      ) : (
                        <IconFile size={16} style={{ flexShrink: 0 }} />
                      )}
                      <Text size="xs" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pendingAttachment.name}
                      </Text>
                      <ActionIcon size="xs" variant="subtle" color="red" onClick={() => setPendingAttachment(null)}>
                        <IconX size={12} />
                      </ActionIcon>
                    </Group>
                  )}

                  {/* Input area */}
                  <Group
                    px="md"
                    py="sm"
                    gap="sm"
                    style={{ borderTop: `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.18)"}`, flexShrink: 0 }}
                    wrap="nowrap"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      hidden
                      aria-label={t("Attach file")}
                      accept="image/*,.gpx,.fit,.tcx,.kml,.kmz,.pdf,.csv,.json,.xml,.zip"
                      onChange={handleFileSelect}
                    />
                    <Tooltip label={t("Attach file")} position="top">
                      <ActionIcon
                        size="md"
                        variant="subtle"
                        color="gray"
                        loading={attachmentUploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <IconPaperclip size={18} />
                      </ActionIcon>
                    </Tooltip>
                    <Textarea
                      placeholder={activeThread?.type === "group" ? t("Write a message...") : t("Write a direct message...")}
                      value={getActiveBody()}
                      onChange={(e) => setActiveBody(e.currentTarget.value)}
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

      <Modal
        opened={confirmModal.open}
        onClose={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
        title={
          <Group gap="xs">
            <ThemeIcon size="md" radius="xl" variant="light" color="red">
              <IconAlertTriangle size={14} />
            </ThemeIcon>
            <Text fw={700} size="sm">{confirmModal.title}</Text>
          </Group>
        }
        centered
        radius="md"
        size="sm"
        overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">{confirmModal.message}</Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
            >
              {t("Cancel")}
            </Button>
            <Button
              color="red"
              size="sm"
              onClick={() => {
                confirmModal.onConfirm();
                setConfirmModal((prev) => ({ ...prev, open: false }));
              }}
            >
              {t("Confirm")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default DashboardOrganizationsTab;

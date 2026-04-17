import {
  ActionIcon,
  Anchor,
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
  IconPlus,
  IconSearch,
  IconSend,
  IconUserMinus,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import {
  Divider,
  FileInput,
  Loader,
  Switch,
} from "@mantine/core";
import {
  IconSettings,
  IconShield,
  IconShieldOff,
  IconUpload,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMediaQuery } from "@mantine/hooks";
import React, { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  discoverOrganizations,
  createOrganization,
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
import { apiBaseUrl } from "../../api/client";
import {
  getOrgSettings,
  updateOrganization,
  uploadOrgPicture,
  setMemberAdmin,
  resolveOrgPictureUrl,
} from "../../api/organizations";
import { useNavigate } from "react-router-dom";
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
  initialOrganizationId?: number | null;
  initialCoachAthleteId?: number | null;
};

// Resolve backend attachment URL → full URL served by the backend
const resolveAttachmentUrl = (url: string): string => {
  return `${apiBaseUrl.replace(/\/$/, "")}/uploads/chat/${url}`;
};

const isImageAttachment = (name?: string | null) => {
  if (!name) return false;
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
};

const DashboardOrganizationsTab = ({ me, athletes, initialShareText, initialOrganizationId = null, initialCoachAthleteId = null }: Props) => {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const isDark = useComputedColorScheme("light") === "dark";
  const isMobile = useMediaQuery("(max-width: 62em)");
  const navigate = useNavigate();
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

  // ── Org settings modal state ──
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [orgSettingsId, setOrgSettingsId] = useState<number | null>(null);
  const [orgEditName, setOrgEditName] = useState("");
  const [orgEditDescription, setOrgEditDescription] = useState("");
  const [orgPictureFile, setOrgPictureFile] = useState<File | null>(null);

  // ── Join request message state ──
  const [joinModalOrgId, setJoinModalOrgId] = useState<number | null>(null);
  const [joinMessage, setJoinMessage] = useState("");

  // ── Create organization state ──
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [createOrgName, setCreateOrgName] = useState("");
  const [createOrgDescription, setCreateOrgDescription] = useState("");

  const discoverQuery = useQuery({
    queryKey: ["organization-discover", search],
    queryFn: () => discoverOrganizations(search),
    enabled: search.trim().length >= 1,
  });

  const activeMemberships = useMemo(
    () =>
      (me.organization_memberships || []).filter(
        (membership) => membership.status === "active" && membership.organization,
      ),
    [me.organization_memberships],
  );

  const [selectedActiveOrgId, setSelectedActiveOrgId] = useState<string | null>(
    (initialOrganizationId ? String(initialOrganizationId) : activeMemberships[0]?.organization?.id?.toString()) || null,
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
      if (initialOrganizationId && validIds.includes(String(initialOrganizationId))) {
        setSelectedActiveOrgId(String(initialOrganizationId));
      } else {
        setSelectedActiveOrgId(validIds[0]);
      }
    }
  }, [activeMemberships, initialOrganizationId, selectedActiveOrgId]);

  const selectedActiveOrganizationId = selectedActiveOrgId ? Number(selectedActiveOrgId) : null;

  // Is the current user an admin of the selected active org?
  const isCurrentUserOrgAdmin = useMemo(() => {
    if (!selectedActiveOrganizationId) return false;
    return (me.organization_memberships || []).some(
      (m) => m.organization?.id === selectedActiveOrganizationId && m.is_admin,
    );
  }, [me.organization_memberships, selectedActiveOrganizationId]);

  // ── Org settings query (only loads when modal is open) ──
  const orgSettingsQuery = useQuery({
    queryKey: ["org-settings", orgSettingsId],
    queryFn: () => getOrgSettings(orgSettingsId as number),
    enabled: orgSettingsOpen && orgSettingsId !== null,
  });

  useEffect(() => {
    if (!orgSettingsQuery.data) return;
    setOrgEditName(orgSettingsQuery.data.name || "");
    setOrgEditDescription(orgSettingsQuery.data.description || "");
  }, [orgSettingsQuery.data]);

  const updateOrgMutation = useMutation({
    mutationFn: (vars: { name: string; description: string }) =>
      updateOrganization(orgSettingsId as number, { name: vars.name, description: vars.description }),
    onSuccess: () => {
      notifications.show({ color: "green", title: t("Saved"), message: t("Organization updated.") });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["org-settings", orgSettingsId] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Could not save"), message: extractApiErrorMessage(error) });
    },
  });

  const uploadOrgPictureMutation = useMutation({
    mutationFn: (file: File) => uploadOrgPicture(orgSettingsId as number, file),
    onSuccess: () => {
      notifications.show({ color: "green", title: t("Picture updated"), message: "" });
      setOrgPictureFile(null);
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["org-settings", orgSettingsId] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Upload failed"), message: extractApiErrorMessage(error) });
    },
  });

  const setAdminMutation = useMutation({
    mutationFn: (vars: { userId: number; isAdmin: boolean }) =>
      setMemberAdmin(orgSettingsId as number, vars.userId, vars.isAdmin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-settings", orgSettingsId] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Could not update admin"), message: extractApiErrorMessage(error) });
    },
  });

  const openOrgSettings = (orgId: number, currentName: string, currentDescription: string) => {
    setOrgSettingsId(orgId);
    setOrgEditName(currentName);
    setOrgEditDescription(currentDescription || "");
    setOrgPictureFile(null);
    setOrgSettingsOpen(true);
  };

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

    const mappedThreads = sourceItems.map((item) => {
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

    if (me.role !== "coach") return mappedThreads;

    const threadKeys = new Set(mappedThreads.map((thread) => `${thread.subtype}:${thread.participantId ?? "group"}`));
    const syntheticAthleteThreads = athletes
      .filter((athlete) => athlete.id !== me.id)
      .filter((athlete) => !threadKeys.has(`coach:${athlete.id}`))
      .map((athlete) => {
        const label = (athlete.profile?.first_name || athlete.profile?.last_name)
          ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
          : athlete.email;

        return {
          key: `coach:${athlete.id}`,
          type: "direct" as const,
          subtype: "coach" as const,
          label,
          subtitle: t("Direct athlete conversation"),
          participantId: athlete.id,
          lastMessageAt: null,
          unread: false,
        };
      });

    return [...mappedThreads, ...syntheticAthleteThreads];
  }, [athletes, inboxQuery.data?.items, me.id, me.role, t]);

  useEffect(() => {
    if (!initialCoachAthleteId) return;
    const targetThread = threads.find(
      (thread) => thread.subtype === "coach" && thread.participantId === initialCoachAthleteId,
    );
    if (!targetThread) return;
    if (activeThreadKey !== targetThread.key) {
      setActiveThreadKey(targetThread.key);
    }
    if (isMobile) {
      setMobilePane("messages");
    }
  }, [activeThreadKey, initialCoachAthleteId, isMobile, threads]);

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
    mutationFn: ({ organizationId, message }: { organizationId: number; message?: string }) => requestOrganizationJoin(organizationId, message || undefined),
    onSuccess: (data) => {
      notifications.show({ color: "green", title: t("Request sent"), message: data.message });
      queryClient.invalidateQueries({ queryKey: ["organization-discover"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setJoinModalOrgId(null);
      setJoinMessage("");
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

  const createOrgMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) => createOrganization(data),
    onSuccess: () => {
      notifications.show({ color: "green", title: t("Clan created"), message: t("Your clan has been created!") });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setCreateOrgOpen(false);
      setCreateOrgName("");
      setCreateOrgDescription("");
    },
    onError: (error) => {
      notifications.show({ color: "red", title: t("Could not create clan"), message: extractApiErrorMessage(error) });
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

  const renderMessageBody = (body: string) => {
    const activityLinkPattern = /(\/dashboard\/activities\/(\d+))/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = activityLinkPattern.exec(body)) !== null) {
      if (match.index > lastIndex) {
        parts.push(body.slice(lastIndex, match.index));
      }
      const path = match[1];
      const activityId = match[2];
      parts.push(
        <Anchor
          key={match.index}
          size="sm"
          fw={600}
          onClick={() => navigate(path)}
          style={{ cursor: "pointer" }}
        >
          View Activity #{activityId}
        </Anchor>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < body.length) {
      parts.push(body.slice(lastIndex));
    }
    return (
      <Text size="sm" c={isDark ? "gray.1" : "dark.8"} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {parts}
      </Text>
    );
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
          <Title order={3}>{t("Clans")}</Title>
        </Group>
        <Button
          leftSection={<IconPlus size={16} />}
          variant="light"
          color="indigo"
          size="compact-sm"
          onClick={() => setCreateOrgOpen(true)}
        >
          {t("Create Clan")}
        </Button>
      </Group>

      {/* ── No Clan Lobby ── */}
      {activeMemberships.length === 0 && (
        <Paper
          withBorder
          p="xl"
          radius="md"
          style={{
            borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)",
            textAlign: "center",
            background: isDark ? "rgba(99,102,241,0.05)" : "rgba(99,102,241,0.02)",
          }}
        >
          <Stack align="center" gap="md">
            <ThemeIcon size={64} radius="xl" variant="light" color="indigo">
              <IconUsersGroup size={32} />
            </ThemeIcon>
            <Stack gap={4}>
              <Text fw={700} size="lg">{t("No Clan Yet")}</Text>
              <Text size="sm" c="dimmed" maw={400} style={{ margin: "0 auto" }}>
                {t("Create your own clan or search for an existing one to join. Clans let you chat with coaches and teammates.")}
              </Text>
            </Stack>
            <Group>
              <Button
                leftSection={<IconPlus size={16} />}
                variant="filled"
                color="indigo"
                onClick={() => setCreateOrgOpen(true)}
              >
                {t("Create Clan")}
              </Button>
              <Button
                leftSection={<IconSearch size={16} />}
                variant="light"
                color="indigo"
                onClick={() => setSearch(" ")}
              >
                {t("Find a Clan")}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {/* ── My Organizations ── */}
      {activeMemberships.length > 0 && (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          {activeMemberships.map((membership) => {
            const org = membership.organization!;
            const isSelected = org.id === selectedActiveOrganizationId;
            const isAdmin = membership.is_admin;
            const orgCoaches = (me.coaches || []).filter(
              (coach) => (coach.organization_ids || []).includes(org.id),
            );
            return (
              <Paper
                key={org.id}
                withBorder
                p="md"
                radius="md"
                style={{
                  cursor: "pointer",
                  borderColor: isSelected ? "var(--mantine-color-indigo-6)" : (isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)"),
                  borderWidth: isSelected ? 2 : 1,
                  background: isSelected ? (isDark ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.05)") : undefined,
                  transition: "border-color 120ms ease, background 120ms ease",
                }}
                onClick={() => setSelectedActiveOrgId(String(org.id))}
              >
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <Group gap="sm" align="flex-start" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    <Avatar
                      radius="xl"
                      size={44}
                      src={resolveOrgPictureUrl(org.picture) || undefined}
                      color="indigo"
                    >
                      {org.name.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Group gap="xs" wrap="nowrap">
                        <Text fw={700} size="sm" lineClamp={1} style={{ flex: 1, minWidth: 0 }}>{org.name}</Text>
                        {isAdmin && <Badge size="xs" variant="filled" color="indigo">{t("Admin")}</Badge>}
                        {isSelected && <Badge size="xs" variant="light" color="green">{t("Active")}</Badge>}
                      </Group>
                      {org.description && (
                        <Text size="xs" c="dimmed" lineClamp={2}>{org.description}</Text>
                      )}
                      {orgCoaches.length > 0 && (
                        <Text size="xs" c="dimmed">
                          {t("Coach")}: {orgCoaches.map((c) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.email).join(", ")}
                        </Text>
                      )}
                    </Stack>
                  </Group>
                  {isAdmin && (
                    <Tooltip label={t("Organization settings")}>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="indigo"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrgSettings(org.id, org.name, org.description || "");
                        }}
                      >
                        <IconSettings size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Paper>
            );
          })}
        </SimpleGrid>
      )}

      {/* ── Discover Clans ── */}
      <Paper withBorder p="md" radius="md" style={{ borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)" }}>
        <Stack gap="sm">
          <Group gap="xs">
            <IconSearch size={16} />
            <Text fw={600} size="sm">{t("Find Clans")}</Text>
          </Group>
          <TextInput
            size="sm"
            placeholder={t("Search clans by name...")}
            leftSection={<IconSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          {search.trim().length === 0 && (
            <Text size="sm" c="dimmed">{t("Start typing to find clans.")}</Text>
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
                    <Group gap="sm" align="flex-start" style={{ flex: 1 }} wrap="nowrap">
                      <Avatar
                        radius="xl"
                        size="md"
                        src={resolveOrgPictureUrl(item.picture) || undefined}
                        color="indigo"
                      >
                        {item.name.slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Stack gap={2} style={{ flex: 1 }}>
                      <Group gap="xs">
                        <Text fw={600} size="sm">{item.name}</Text>
                        {item.member_count != null && (
                          <Badge size="xs" variant="light" color="gray">
                            {item.member_count} {t("members")}
                          </Badge>
                        )}
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
                    </Group>
                    <Button
                      size="compact-xs"
                      variant="light"
                      onClick={() => { setJoinModalOrgId(item.id); setJoinMessage(""); }}
                      loading={joinMutation.isPending && joinModalOrgId === item.id}
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
            <Text size="sm" c="dimmed">{t("No clans found.")}</Text>
          )}
        </Stack>
      </Paper>

      {/* ── Join Request Message Modal ── */}
      <Modal opened={joinModalOrgId !== null} onClose={() => setJoinModalOrgId(null)} title={t("Join Clan")} size="sm">
        <Stack gap="sm">
          <Textarea
            label={t("Message (optional)")}
            placeholder={t("Write a short message to the coach...")}
            value={joinMessage}
            onChange={(e) => setJoinMessage(e.currentTarget.value)}
            maxLength={500}
            autosize
            minRows={2}
            maxRows={5}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setJoinModalOrgId(null)}>{t("Cancel")}</Button>
            <Button
              loading={joinMutation.isPending}
              onClick={() => joinModalOrgId && joinMutation.mutate({ organizationId: joinModalOrgId, message: joinMessage || undefined })}
            >
              {t("Send Request")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* ── Create Clan Modal ── */}
      <Modal opened={createOrgOpen} onClose={() => setCreateOrgOpen(false)} title={t("Create Clan")} size="sm">
        <Stack gap="sm">
          <TextInput
            label={t("Clan Name")}
            placeholder={t("Enter clan name...")}
            value={createOrgName}
            onChange={(e) => setCreateOrgName(e.currentTarget.value)}
            maxLength={100}
            required
          />
          <Textarea
            label={t("Description (optional)")}
            placeholder={t("What is your clan about?")}
            value={createOrgDescription}
            onChange={(e) => setCreateOrgDescription(e.currentTarget.value)}
            maxLength={500}
            autosize
            minRows={2}
            maxRows={5}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateOrgOpen(false)}>{t("Cancel")}</Button>
            <Button
              loading={createOrgMutation.isPending}
              disabled={!createOrgName.trim()}
              onClick={() => createOrgMutation.mutate({ name: createOrgName.trim(), description: createOrgDescription.trim() || undefined })}
            >
              {t("Create Clan")}
            </Button>
          </Group>
        </Stack>
      </Modal>

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
            <Text c="dimmed">{t("Join or create a clan to use group and coach chat.")}</Text>
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
                              {message.body && renderMessageBody(message.body)}
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

          <Modal
            opened={orgSettingsOpen}
            onClose={() => setOrgSettingsOpen(false)}
            title={t("Organization settings")}
            centered
            radius="md"
            size="lg"
            overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
          >
            <Stack gap="md">
              {orgSettingsQuery.isLoading && (
                <Group justify="center" py="md">
                  <Loader size="sm" />
                </Group>
              )}

              {!orgSettingsQuery.isLoading && orgSettingsQuery.data && (
                <>
                  <Group align="flex-start" wrap="nowrap">
                    <Avatar
                      radius="xl"
                      size={64}
                      src={resolveOrgPictureUrl(orgSettingsQuery.data.picture) || undefined}
                      color="indigo"
                    >
                      {orgSettingsQuery.data.name.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <Stack gap={4} style={{ flex: 1 }}>
                      <TextInput
                        label={t("Organization name")}
                        value={orgEditName}
                        onChange={(e) => setOrgEditName(e.currentTarget.value)}
                        maxLength={200}
                      />
                      <Textarea
                        label={t("Description")}
                        value={orgEditDescription}
                        onChange={(e) => setOrgEditDescription(e.currentTarget.value)}
                        maxLength={2000}
                        minRows={2}
                      />
                    </Stack>
                  </Group>

                  <Group justify="space-between" align="end">
                    <FileInput
                      label={t("Organization icon")}
                      placeholder={t("Choose image")}
                      value={orgPictureFile}
                      onChange={(value) => setOrgPictureFile(value)}
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      leftSection={<IconPhoto size={14} />}
                      style={{ flex: 1 }}
                    />
                    <Button
                      leftSection={<IconUpload size={14} />}
                      onClick={() => {
                        if (!orgPictureFile) return;
                        uploadOrgPictureMutation.mutate(orgPictureFile);
                      }}
                      loading={uploadOrgPictureMutation.isPending}
                      disabled={!orgPictureFile}
                      variant="light"
                    >
                      {t("Upload")}
                    </Button>
                  </Group>

                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      {t("Invite code")}: <Text component="span" fw={600}>{orgSettingsQuery.data.code || "-"}</Text>
                    </Text>
                    <Button
                      onClick={() => updateOrgMutation.mutate({ name: orgEditName.trim(), description: orgEditDescription.trim() })}
                      loading={updateOrgMutation.isPending}
                    >
                      {t("Save")}
                    </Button>
                  </Group>

                  <Divider my="xs" label={t("Members and admins")} labelPosition="left" />

                  <Stack gap="xs">
                    {orgSettingsQuery.data.members.map((member) => {
                      const fullName = `${member.first_name || ""} ${member.last_name || ""}`.trim() || member.email;
                      const isCreator = orgSettingsQuery.data.creator_id === member.id;
                      return (
                        <Group key={member.id} justify="space-between" wrap="nowrap">
                          <Group gap="xs" wrap="nowrap">
                            <Avatar size="sm" radius="xl" color="blue">{fullName.slice(0, 1).toUpperCase()}</Avatar>
                            <Stack gap={0}>
                              <Group gap={6}>
                                <Text size="sm" fw={600}>{fullName}</Text>
                                <Badge size="xs" variant="light" color={member.role === "coach" ? "indigo" : "blue"}>{member.role}</Badge>
                                {isCreator && <Badge size="xs" variant="filled" color="grape">{t("Creator")}</Badge>}
                              </Group>
                              <Text size="xs" c="dimmed">{member.email}</Text>
                            </Stack>
                          </Group>

                          <Switch
                            size="sm"
                            checked={member.is_admin}
                            disabled={isCreator || setAdminMutation.isPending}
                            onChange={(e) => setAdminMutation.mutate({ userId: member.id, isAdmin: e.currentTarget.checked })}
                            onLabel={<IconShield size={12} />}
                            offLabel={<IconShieldOff size={12} />}
                            label={t("Admin")}
                          />
                        </Group>
                      );
                    })}
                  </Stack>
                </>
              )}
            </Stack>
          </Modal>
    </Stack>
  );
};

export default DashboardOrganizationsTab;

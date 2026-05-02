import { Button, Group, Modal, Select, Stack, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listOrgMembers,
  postOrgDirectMessage,
  postOrganizationCoachMessage,
  postOrganizationGroupMessage,
} from "../api/organizations";
import { useI18n } from "../i18n/I18nProvider";
import api from "../api/client";

type OrgMembership = {
  organization?: { id: number; name: string } | null;
  role: string;
  status: string;
};

type MeData = {
  role?: string;
  organization_memberships?: OrgMembership[];
};

type Props = {
  opened: boolean;
  onClose: () => void;
  shareText: string;
};

const ShareToChatModal = ({ opened, onClose, shareText }: Props) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(shareText);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string>("group");
  const [shareConsentModalOpen, setShareConsentModalOpen] = useState(false);

  // Sync message when modal opens or shareText changes
  useEffect(() => {
    if (opened) setMessage(shareText);
  }, [opened, shareText]);

  const { data: me } = useQuery<MeData>({
    queryKey: ["me"],
    queryFn: () => api.get<MeData>("/users/me").then((r) => r.data),
  });

  // Filter the same way DashboardOrganizationsTab does: active + matching role
  const activeMemberships = useMemo(
    () =>
      (me?.organization_memberships || []).filter(
        (m) => m.status === "active" && m.organization && (!me?.role || m.role === me.role),
      ),
    [me],
  );

  const orgOptions = activeMemberships.map((m) => ({
    value: String(m.organization!.id),
    label: m.organization!.name,
  }));

  const resolvedOrgId = selectedOrgId ?? orgOptions[0]?.value ?? null;

  const membersQuery = useQuery({
    queryKey: ["org-members", resolvedOrgId ? Number(resolvedOrgId) : null],
    queryFn: () => listOrgMembers(Number(resolvedOrgId)),
    enabled: Boolean(resolvedOrgId),
  });

  const activityIdFromShare = useMemo(() => {
    const match = shareText.match(/\/dashboard\/activities\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [shareText]);

  const hasNonCoachMembersInOrg = useMemo(
    () => (membersQuery.data || []).some((member) => member.role !== "coach"),
    [membersQuery.data],
  );

  const threadOptions = useMemo(() => {
    const group = [{ value: "group", label: t("Organization Group") }];
    const members = (membersQuery.data || []).map((m) => {
      const name = (m.first_name || m.last_name)
        ? `${m.first_name || ""} ${m.last_name || ""}`.trim()
        : m.email;
      const threadType = m.role === "coach" ? "coach" : "member";
      return { value: `${threadType}:${m.id}`, label: name };
    });
    return [...group, ...members];
  }, [membersQuery.data, t]);

  const requiresSpecificActivityConsent = useMemo(() => {
    if (me?.role !== "athlete" || !activityIdFromShare) return false;
    if (selectedThread === "group") return hasNonCoachMembersInOrg;
    return selectedThread.startsWith("member:");
  }, [activityIdFromShare, hasNonCoachMembersInOrg, me?.role, selectedThread]);

  const sendMutation = useMutation({
    mutationFn: async (variables?: { activityConsentGranted?: boolean }) => {
      if (!resolvedOrgId) throw new Error("No organization selected");
      if (!message.trim()) throw new Error("Message cannot be empty");
      if (requiresSpecificActivityConsent && !variables?.activityConsentGranted) {
        throw new Error("specific-activity-consent-required");
      }

      const orgId = Number(resolvedOrgId);
      if (selectedThread === "group") {
        await postOrganizationGroupMessage(orgId, message.trim());
        return;
      }

      const recipientId = Number(selectedThread.split(":")[1]);
      if (selectedThread.startsWith("coach:") && (me?.role === "athlete" || me?.role === "coach")) {
        await postOrganizationCoachMessage(
          orgId,
          me.role === "coach" ? { athleteId: recipientId } : { coachId: recipientId },
          message.trim(),
        );
      } else {
        await postOrgDirectMessage(orgId, recipientId, message.trim());
      }
    },
    onSuccess: () => {
      setShareConsentModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["org-group-chat"] });
      queryClient.invalidateQueries({ queryKey: ["org-coach-chat"] });
      queryClient.invalidateQueries({ queryKey: ["org-direct-chat"] });
      queryClient.invalidateQueries({ queryKey: ["org-chat-inbox"] });
      onClose();
      notifications.show({ color: "green", title: t("Shared"), message: t("Message sent to chat.") });
      // Navigate to the organizations tab so the user can see the message
      navigate("/dashboard", { state: { activeTab: "organizations" } });
    },
    onError: (error: Error) => {
      if (error.message === "specific-activity-consent-required") {
        setShareConsentModalOpen(true);
        return;
      }
      notifications.show({ color: "red", title: t("Failed"), message: t("Could not send message.") });
    },
  });

  if (!opened) return null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={700} size="sm">{t("Share to Chat")}</Text>}
      centered
      radius="md"
      size="sm"
      overlayProps={{ backgroundOpacity: 0.4, blur: 2 }}
    >
      <Stack gap="sm">
        {orgOptions.length > 1 && (
          <Select
            label={t("Organization")}
            data={orgOptions}
            value={resolvedOrgId}
            onChange={setSelectedOrgId}
            size="sm"
          />
        )}
        {orgOptions.length === 0 && (
          <Text size="sm" c="dimmed">{t("You are not a member of any organization.")}</Text>
        )}
        <Select
          label={t("Send to")}
          data={threadOptions}
          value={selectedThread}
          onChange={(v) => setSelectedThread(v ?? "group")}
          size="sm"
        />
        <Textarea
          label={t("Message")}
          value={message}
          onChange={(e) => setMessage(e.currentTarget.value)}
          minRows={3}
          maxRows={8}
          autosize
          size="sm"
        />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" size="sm" onClick={onClose}>{t("Cancel")}</Button>
          <Button
            size="sm"
            color="indigo"
            loading={sendMutation.isPending}
            disabled={!message.trim() || !resolvedOrgId || orgOptions.length === 0}
            onClick={() => {
              if (requiresSpecificActivityConsent) {
                setShareConsentModalOpen(true);
                return;
              }
              sendMutation.mutate({});
            }}
          >
            {t("Send")}
          </Button>
        </Group>
      </Stack>

      <Modal
        opened={shareConsentModalOpen}
        onClose={() => setShareConsentModalOpen(false)}
        title={t("Share activity permission")}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            {t("You are sharing this activity with non-coach members. Do you want to grant permission for this specific activity?")}
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              onClick={() => setShareConsentModalOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              color="indigo"
              loading={sendMutation.isPending}
              onClick={() => sendMutation.mutate({ activityConsentGranted: true })}
            >
              {t("Yes, grant permission and share")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Modal>
  );
};

export default ShareToChatModal;

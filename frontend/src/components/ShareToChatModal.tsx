import { Button, Group, Modal, Select, Stack, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listOrgMembers,
  postOrgDirectMessage,
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

  const threadOptions = useMemo(() => {
    const group = [{ value: "group", label: t("Organization Group") }];
    const members = (membersQuery.data || []).map((m) => {
      const name = (m.first_name || m.last_name)
        ? `${m.first_name || ""} ${m.last_name || ""}`.trim()
        : m.email;
      return { value: `member:${m.id}`, label: name };
    });
    return [...group, ...members];
  }, [membersQuery.data, t]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedOrgId) throw new Error("No organization selected");
      if (!message.trim()) throw new Error("Message cannot be empty");
      const orgId = Number(resolvedOrgId);
      if (selectedThread === "group") {
        await postOrganizationGroupMessage(orgId, message.trim());
      } else {
        const userId = Number(selectedThread.split(":")[1]);
        await postOrgDirectMessage(orgId, userId, message.trim());
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-group-chat"] });
      queryClient.invalidateQueries({ queryKey: ["org-direct-chat"] });
      onClose();
      notifications.show({ color: "green", title: t("Shared"), message: t("Message sent to chat.") });
      // Navigate to the organizations tab so the user can see the message
      navigate("/dashboard", { state: { activeTab: "organizations" } });
    },
    onError: () => {
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
            onClick={() => sendMutation.mutate()}
          >
            {t("Send")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default ShareToChatModal;

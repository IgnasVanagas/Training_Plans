import { Button, Group, Modal, Select, Stack, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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

type Props = {
  opened: boolean;
  onClose: () => void;
  shareText: string;
};

const ShareToChatModal = ({ opened, onClose, shareText }: Props) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(shareText);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>("group");

  // Reset when opened
  useMemo(() => {
    if (opened) setMessage(shareText);
  }, [opened, shareText]);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ organization_memberships?: OrgMembership[] }>("/users/me").then((r) => r.data),
  });

  const activeMemberships = useMemo(
    () =>
      (me?.organization_memberships || []).filter(
        (m) => m.status === "active" && m.organization,
      ),
    [me?.organization_memberships],
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
      if (!resolvedOrgId || !message.trim()) return;
      const orgId = Number(resolvedOrgId);
      const thread = selectedThread ?? "group";
      if (thread === "group") {
        await postOrganizationGroupMessage(orgId, message.trim());
      } else {
        const userId = Number(thread.split(":")[1]);
        await postOrgDirectMessage(orgId, userId, message.trim());
      }
    },
    onSuccess: () => {
      notifications.show({ color: "green", title: t("Shared"), message: t("Message sent to chat.") });
      queryClient.invalidateQueries({ queryKey: ["org-group-chat"] });
      queryClient.invalidateQueries({ queryKey: ["org-direct-chat"] });
      onClose();
    },
    onError: () => {
      notifications.show({ color: "red", title: t("Failed"), message: t("Could not send message.") });
    },
  });

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
        <Select
          label={t("Send to")}
          data={threadOptions}
          value={selectedThread ?? "group"}
          onChange={setSelectedThread}
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
            disabled={!message.trim() || !resolvedOrgId}
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

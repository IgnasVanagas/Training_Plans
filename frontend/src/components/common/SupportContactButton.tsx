import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation } from "@tanstack/react-query";
import { IconLifebuoy, IconSend } from "@tabler/icons-react";

import { sendSupportRequest } from "../../api/communications";
import { useI18n } from "../../i18n/I18nProvider";

type Props = {
  email?: string | null;
  name?: string | null;
  subject?: string;
  pageLabel?: string;
  errorMessage?: string | null;
  buttonText?: string;
  variant?: "filled" | "light" | "outline" | "subtle" | "default";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  iconOnly?: boolean;
  fullWidth?: boolean;
};

const extractSupportErrorMessage = (error: unknown): string => {
  const maybeError = error as {
    response?: { data?: { detail?: string } };
    message?: string;
  };
  return maybeError?.response?.data?.detail || maybeError?.message || "An unexpected error occurred.";
};

const SupportContactButton = ({
  email,
  name,
  subject,
  pageLabel,
  errorMessage,
  buttonText,
  variant = "light",
  size = "sm",
  iconOnly = false,
  fullWidth = false,
}: Props) => {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const [formName, setFormName] = useState(name || "");
  const [formEmail, setFormEmail] = useState(email || "");
  const [formMessage, setFormMessage] = useState("");
  const [botTrap, setBotTrap] = useState("");
  const [openedAt, setOpenedAt] = useState<number>(Date.now());

  useEffect(() => {
    setFormName(name || "");
  }, [name]);

  useEffect(() => {
    setFormEmail(email || "");
  }, [email]);

  const supportMutation = useMutation({
    mutationFn: async () => {
      const trimmedEmail = formEmail.trim();
      const trimmedMessage = formMessage.trim();
      if (!trimmedEmail) {
        throw new Error(t("Email is required."));
      }
      if (!trimmedMessage) {
        throw new Error(t("Please describe your issue or question."));
      }

      return sendSupportRequest({
        name: formName.trim() || undefined,
        email: trimmedEmail,
        subject: subject || (pageLabel ? `${pageLabel} support request` : undefined),
        message: trimmedMessage,
        page_url: typeof window !== "undefined" ? window.location.href : undefined,
        error_message: errorMessage || undefined,
        bot_trap: botTrap || undefined,
        client_elapsed_ms: Math.max(0, Date.now() - openedAt),
      });
    },
    onSuccess: (response) => {
      notifications.show({
        color: "teal",
        title: t("Support request sent"),
        message: t(response.message),
      });
      setFormMessage("");
      setBotTrap("");
      setOpened(false);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: t("Could not send support request"),
        message: t(extractSupportErrorMessage(error)),
      });
    },
  });

  const openModal = () => {
    setOpenedAt(Date.now());
    setOpened(true);
  };

  return (
    <>
      {iconOnly ? (
        <Tooltip label={buttonText || t("Support")}>
          <ActionIcon variant={variant} size={size} radius="xl" onClick={openModal} aria-label={buttonText || t("Support")}>
            <IconLifebuoy size={16} />
          </ActionIcon>
        </Tooltip>
      ) : (
        <Button
          variant={variant}
          size={size}
          leftSection={<IconLifebuoy size={16} />}
          onClick={openModal}
          fullWidth={fullWidth}
        >
          {buttonText || t("Support")}
        </Button>
      )}

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={t("Contact support")}
        centered
      >
        <Stack gap="sm">
          {(pageLabel || errorMessage) && (
            <Alert color="blue" variant="light">
              <Text size="sm">{t("Current page and error details will be included automatically.")}</Text>
            </Alert>
          )}
          <TextInput
            label={t("Your name")}
            value={formName}
            onChange={(event) => setFormName(event.currentTarget.value)}
            placeholder={t("Your name")}
          />
          <TextInput
            label={t("Your email")}
            value={formEmail}
            onChange={(event) => setFormEmail(event.currentTarget.value)}
            placeholder={t("you@example.com")}
            required
          />
          <TextInput
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={botTrap}
            onChange={(event) => setBotTrap(event.currentTarget.value)}
            style={{ position: "absolute", left: -10000, width: 1, height: 1, opacity: 0 }}
          />
          <Textarea
            label={t("How can we help?")}
            value={formMessage}
            onChange={(event) => setFormMessage(event.currentTarget.value)}
            placeholder={t("Describe the issue or question you want help with.")}
            minRows={5}
            required
          />
          <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">ignas@wunderbit.lt</Text>
            <Button
              onClick={() => supportMutation.mutate()}
              loading={supportMutation.isPending}
              leftSection={<IconSend size={15} />}
            >
              {t("Send message")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

export default SupportContactButton;
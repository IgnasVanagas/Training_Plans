import { useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Select,
  SegmentedControl,
  Stack,
  Text,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useI18n } from "../../i18n/I18nProvider";

type User = {
  id: number;
  email: string;
  email_verified?: boolean;
  role: "coach" | "athlete" | "admin";
  profile?: Record<string, unknown> | null;
};

type SettingsFormProps = {
  user: User;
  onSubmit: (data: Record<string, unknown>) => void;
  isSaving: boolean;
  requestingEmailConfirmation?: boolean;
  changingPassword?: boolean;
  onRequestEmailConfirmation?: () => void;
  onChangePassword?: (payload: { current_password: string; new_password: string }) => void;
  // kept for API compatibility — unused after simplification
  providers?: unknown[];
  connectingProvider?: string | null;
  disconnectingProvider?: string | null;
  syncingProvider?: string | null;
  cancelingProvider?: string | null;
  onConnect?: (p: string) => void;
  onDisconnect?: (p: string) => void;
  onSync?: (p: string) => void;
  onCancelSync?: (p: string) => void;
  initialSection?: string;
};

const FALLBACK_TZ = [
  "UTC","Europe/London","Europe/Paris","Europe/Berlin","Europe/Vilnius","Europe/Helsinki",
  "Europe/Moscow","America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "Asia/Tokyo","Asia/Shanghai","Australia/Sydney","Pacific/Auckland",
];

const TIMEZONE_OPTIONS = (() => {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (all) return all.map((tz: string) => ({ value: tz, label: tz.replace(/_/g, " ") }));
  } catch { /* fallback */ }
  return FALLBACK_TZ.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }));
})();

const SettingsForm = ({
  user,
  onSubmit,
  isSaving,
  requestingEmailConfirmation,
  changingPassword,
  onRequestEmailConfirmation,
  onChangePassword,
}: SettingsFormProps) => {
  const isDark = useComputedColorScheme("light") === "dark";
  const { language, setLanguage, t } = useI18n();
  const panelBg = isDark ? "var(--mantine-color-dark-6)" : "white";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const savedTz = (user.profile as Record<string, unknown> | null)?.timezone as string | null | undefined;
  const [timezone, setTimezone] = useState<string | null>(savedTz || null);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      notifications.show({ color: "red", title: t("Missing fields") || "Missing fields", message: t("Fill in all password fields.") || "Fill in all password fields." });
      return;
    }
    if (newPassword !== confirmPassword) {
      notifications.show({ color: "red", title: t("Passwords do not match") || "Passwords do not match", message: t("Please confirm the same new password.") || "Please confirm the same new password." });
      return;
    }
    if (!onChangePassword) return;
    onChangePassword({ current_password: currentPassword, new_password: newPassword });
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  return (
    <Box maw={600} mx="auto" py="md">
      <Title order={2} mb="lg">{t("Account & Security") || "Account & Security"}</Title>

      <Paper p="lg" radius="md" withBorder bg={panelBg}>
        <Stack gap="lg">
          {/* Email */}
          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <div>
                <Text fw={600}>{t("Email") || "Email"}</Text>
                <Text size="sm" c="dimmed">{user.email}</Text>
              </div>
              <Badge color={user.email_verified ? "teal" : "orange"} variant="light">
                {user.email_verified ? (t("Verified") || "Verified") : (t("Unverified") || "Unverified")}
              </Badge>
            </Group>

            {!user.email_verified && (
              <Alert color="yellow" title={t("Email confirmation recommended") || "Email confirmation recommended"}>
                {t("Confirm your email to improve account recovery and security.") || "Confirm your email to improve account recovery and security."}
              </Alert>
            )}

            <Button
              variant="light"
              onClick={() => onRequestEmailConfirmation && onRequestEmailConfirmation()}
              loading={requestingEmailConfirmation}
              disabled={!onRequestEmailConfirmation}
            >
              {t("Send verification email") || "Send verification email"}
            </Button>
          </Stack>

          <Divider />

          {/* Timezone */}
          <Stack gap="xs">
            <Text fw={600}>{t("Timezone") || "Timezone"}</Text>
            <Text size="sm" c="dimmed">{t("Used for message timestamps and scheduling") || "Used for message timestamps and scheduling"}</Text>
            <Select
              data={TIMEZONE_OPTIONS}
              value={timezone}
              onChange={(val) => {
                setTimezone(val);
                if (val) onSubmit({ timezone: val } as Record<string, unknown>);
              }}
              searchable
              clearable
              placeholder={t("Select timezone") || "Select timezone"}
              nothingFoundMessage={t("No timezone found") || "No timezone found"}
              disabled={isSaving}
            />
          </Stack>

          <Divider />

          {/* Language */}
          <Stack gap="xs">
            <Text fw={600}>{t("Language") || "Language"}</Text>
            <Text size="sm" c="dimmed">{t("Used across the app and synced to your account") || "Used across the app and synced to your account"}</Text>
            <SegmentedControl
              value={language}
              onChange={(value) => {
                const nextLanguage = value as "en" | "lt";
                setLanguage(nextLanguage);
                onSubmit({ preferred_language: nextLanguage } as Record<string, unknown>);
              }}
              data={[
                { value: "en", label: t("English") || "English" },
                { value: "lt", label: t("Lithuanian") || "Lithuanian" },
              ]}
              disabled={isSaving}
              fullWidth
            />
          </Stack>

          <Divider />

          {/* Password */}
          <Stack gap="xs">
            <Text fw={600}>{t("Change password") || "Change password"}</Text>
            <form onSubmit={handlePasswordSubmit}>
              <Stack>
                <PasswordInput
                  label={t("Current password") || "Current password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.currentTarget.value)}
                  autoComplete="current-password"
                />
                <PasswordInput
                  label={t("New password") || "New password"}
                  description={t("At least 10 characters with upper, lower, number, and symbol") || "At least 10 characters with upper, lower, number, and symbol"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.currentTarget.value)}
                  autoComplete="new-password"
                />
                <PasswordInput
                  label={t("Confirm new password") || "Confirm new password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                  autoComplete="new-password"
                />
                <Group justify="flex-end">
                  <Button type="submit" loading={changingPassword} disabled={!onChangePassword}>
                    {t("Update password") || "Update password"}
                  </Button>
                </Group>
              </Stack>
            </form>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
};

export default SettingsForm;

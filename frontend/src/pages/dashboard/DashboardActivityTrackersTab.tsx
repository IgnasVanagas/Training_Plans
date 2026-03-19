import {
  Box,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
  ThemeIcon,
  Alert,
} from "@mantine/core";
import {
  IconCheck,
  IconInfoCircle,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useComputedColorScheme } from "@mantine/core";
import { type ProviderStatus } from "../../api/integrations";
import { useI18n } from "../../i18n/I18nProvider";

type Props = {
  providers: ProviderStatus[];
  connectingProvider?: string | null;
  disconnectingProvider?: string | null;
  syncingProvider?: string | null;
  cancelingProvider?: string | null;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  onSync: (provider: string) => void;
  onCancelSync: (provider: string) => void;
};

const PROVIDER_COLORS: Record<string, string> = {
  garmin: "#007CC3",
  strava: "#FC4C02",
  polar: "#D0021B",
  suunto: "#E4032E",
  coros: "#212121",
  wahoo: "#0078D4",
  rouvy: "#FF6B00",
};

const providerLabel = (item: ProviderStatus) =>
  item.display_name || item.provider;

const friendlyError = (provider: string, errorText?: string | null) => {
  if (!errorText) return null;
  const low = errorText.toLowerCase();
  if (provider.toLowerCase() === "garmin")
    return "Garmin is taking longer than usual to respond. Your activities are safe and we'll keep retrying in the background.";
  if (low.includes("auth") || low.includes("token") || low.includes("permission"))
    return "Connection expired. Reconnect once, then sync again — we'll pick up where we left off.";
  return "Sync hit a temporary issue. Your training data is still safe, and you can retry now.";
};

export default function DashboardActivityTrackersTab({
  providers,
  connectingProvider,
  disconnectingProvider,
  syncingProvider,
  cancelingProvider,
  onConnect,
  onDisconnect,
  onSync,
  onCancelSync,
}: Props) {
  const isDark = useComputedColorScheme("light") === "dark";
  const { t } = useI18n();

  const cardBg = isDark ? "var(--mantine-color-dark-6)" : "white";
  const borderColor = isDark
    ? "rgba(148,163,184,0.28)"
    : "rgba(15,23,42,0.12)";

  return (
    <Box maw={1000} mx="auto" py="md">
      <Stack gap="xs" mb="lg">
        <Title order={2}>{t("Activity trackers")}</Title>
        <Text size="sm" c="dimmed">
          {t(
            "Connect your fitness devices and apps to automatically sync your workouts."
          )}
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {providers.map((item) => {
          const isConnected = item.connection_status === "connected";
          const isConnecting = connectingProvider === item.provider;
          const isDisconnecting = disconnectingProvider === item.provider;
          const isSyncing = syncingProvider === item.provider;
          const isCanceling = cancelingProvider === item.provider;
          const accent =
            PROVIDER_COLORS[item.provider.toLowerCase()] || "#868e96";
          const label = providerLabel(item);

          return (
            <Paper
              key={item.provider}
              withBorder
              radius="md"
              p="lg"
              bg={cardBg}
              style={{ borderColor }}
            >
              <Stack gap="sm">
                {/* Provider icon placeholder + name */}
                <Group justify="space-between" align="flex-start">
                  <Group gap="sm">
                    <ThemeIcon
                      size={42}
                      radius="md"
                      variant="light"
                      style={{
                        background: isDark ? `${accent}22` : `${accent}14`,
                        color: accent,
                      }}
                    >
                      <IconPlugConnected size={22} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text fw={700} size="sm">
                        {label}
                      </Text>
                      {item.last_sync_at && (
                        <Text size="xs" c="dimmed">
                          {t("Last sync")}:{" "}
                          {new Date(item.last_sync_at).toLocaleString()}
                        </Text>
                      )}
                    </Stack>
                  </Group>
                  {isConnected && (
                    <ThemeIcon
                      size={24}
                      radius="xl"
                      variant="filled"
                      color="teal"
                    >
                      <IconCheck size={14} />
                    </ThemeIcon>
                  )}
                </Group>

                {/* Status line */}
                <Text size="xs" c={isConnected ? "teal" : "dimmed"}>
                  {isConnected
                    ? t("Your tracker is connected.")
                    : item.approval_required
                      ? t("Pending partner approval")
                      : item.bridge_only
                        ? t("Bridge ingestion")
                        : !item.enabled
                          ? t("Disabled")
                          : !item.configured
                            ? t("Not configured")
                            : t("Ready to connect")}
                </Text>

                {/* Error alert */}
                {item.last_error && (
                  <Alert
                    variant="light"
                    color="orange"
                    icon={<IconInfoCircle size={14} />}
                    p="xs"
                  >
                    <Text size="xs" fw={600}>
                      {friendlyError(item.provider, item.last_error)}
                    </Text>
                  </Alert>
                )}

                {/* Strava connected note */}
                {item.provider === "strava" && isConnected && (
                  <Text size="xs" c="dimmed">
                    {t(
                      "Imports your last 3 months of activities on first sync."
                    )}
                  </Text>
                )}

                {/* Action buttons */}
                <Group gap="xs" mt="auto">
                  {isConnected ? (
                    <>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        loading={isDisconnecting}
                        disabled={isConnecting || isSyncing}
                        onClick={() => onDisconnect(item.provider)}
                        fullWidth
                      >
                        {t("Disconnect")}
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        loading={isSyncing}
                        disabled={isDisconnecting}
                        onClick={() => onSync(item.provider)}
                        fullWidth
                      >
                        {t("Sync now")}
                      </Button>
                      {item.provider === "strava" && isSyncing && (
                        <Button
                          size="xs"
                          color="orange"
                          variant="light"
                          loading={isCanceling}
                          onClick={() => onCancelSync(item.provider)}
                          fullWidth
                        >
                          {t("Cancel sync")}
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button
                      size="xs"
                      variant="filled"
                      style={{ background: accent }}
                      loading={isConnecting}
                      disabled={
                        item.approval_required ||
                        isDisconnecting ||
                        isSyncing ||
                        !item.enabled ||
                        !item.configured
                      }
                      onClick={() => onConnect(item.provider)}
                      fullWidth
                    >
                      {t("Connect your") + " " + label}
                    </Button>
                  )}
                </Group>
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Box>
  );
}

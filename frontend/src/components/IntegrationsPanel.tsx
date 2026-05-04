import { Alert, Anchor, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { type ProviderStatus } from "../api/integrations";
import { useI18n } from "../i18n/I18nProvider";

type Props = {
  providers: ProviderStatus[];
  connectingProvider?: string | null;
  disconnectingProvider?: string | null;
  cancelingProvider?: string | null;
  syncingProvider?: string | null;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  onSync: (provider: string) => void;
  onCancelSync: (provider: string) => void;
};

const providerLabel = (provider: ProviderStatus) => provider.display_name || provider.provider;

export const IntegrationsPanel = ({
  providers,
  connectingProvider,
  disconnectingProvider,
  cancelingProvider,
  syncingProvider,
  onConnect,
  onDisconnect,
  onSync,
  onCancelSync,
}: Props) => {
  const { t } = useI18n();

  const friendlyErrorCopy = (provider: string, errorText?: string | null) => {
    if (!errorText) return null;
    const lowered = errorText.toLowerCase();
    if (provider.toLowerCase() === "garmin") {
      return t("Garmin is taking longer than usual to respond. Your activities are safe and we'll keep retrying in the background.");
    }
    if (lowered.includes("auth") || lowered.includes("token") || lowered.includes("permission")) {
      return t("Connection expired. Reconnect once, then sync again. We'll pick up where we left off.");
    }
    return t("Sync hit a temporary issue. Your training data is still safe, and you can retry now.");
  };

  const getStatusText = (item: ProviderStatus, isConnected: boolean) => {
    if (isConnected) return t("Connected");
    if (item.approval_required) return t("Pending partner approval");
    if (item.bridge_only) return t("Bridge ingestion");
    if (!item.enabled) return t("Disabled (feature flag off)");
    if (!item.configured) return t("Not configured (missing credentials)");
    return t("Ready to connect");
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>{t("Integrations")}</Title>
        <Text size="sm" c="dimmed">{t("Connect wearable providers, check sync health, and trigger manual sync.")}</Text>
        {providers.map((item) => {
          const isConnected = item.connection_status === "connected";
          const isConnecting = connectingProvider === item.provider;
          const isDisconnecting = disconnectingProvider === item.provider;
          const isCanceling = cancelingProvider === item.provider;
          const isSyncing = syncingProvider === item.provider;
          return (
            <Paper key={item.provider} withBorder p="sm" radius="sm">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Text fw={600} size="sm">{providerLabel(item)}</Text>
                  <Text size="xs" c="dimmed">{t("Status")}: {getStatusText(item, isConnected)}</Text>
                  {item.provider === "strava" && isConnected && (
                    <Text size="xs" c="dimmed">
                      {t("Imports your last 3 months of activities on first sync.")}
                    </Text>
                  )}
                  {item.provider === "strava" && isConnected && (
                    <Anchor
                      href="https://www.strava.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      size="xs"
                      c="#FC4C02"
                      underline="hover"
                    >
                      {t("Powered by Strava")}
                    </Anchor>
                  )}
                  {item.last_sync_at && <Text size="xs" c="dimmed">{t("Last sync")}: {new Date(item.last_sync_at).toLocaleString()}</Text>}
                  {item.last_error && (
                    <Alert
                      variant="light"
                      color="orange"
                      icon={<IconInfoCircle size={14} />}
                      p="xs"
                      w="100%"
                    >
                      <Text size="xs" fw={600}>{friendlyErrorCopy(item.provider, item.last_error)}</Text>
                      <Text size="xs" c="dimmed" mt={2}>{t("Technical detail")}: {item.last_error}</Text>
                    </Alert>
                  )}
                </Stack>
                <Group>
                  <Button
                    size="xs"
                    variant="light"
                    loading={isConnecting}
                    disabled={item.approval_required || isConnected || isDisconnecting || isSyncing}
                    onClick={() => onConnect(item.provider)}
                  >
                    {t("Connect")}
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="red"
                    loading={isDisconnecting}
                    disabled={!isConnected || isConnecting || isSyncing}
                    onClick={() => onDisconnect(item.provider)}
                  >
                    {t("Disconnect")}
                  </Button>
                  <Button
                    size="xs"
                    loading={isSyncing}
                    disabled={!isConnected || isConnecting || isDisconnecting}
                    onClick={() => onSync(item.provider)}
                  >
                    {t("Sync now")}
                  </Button>
                  {item.provider === "strava" && isSyncing && (
                    <Button
                      size="xs"
                      color="orange"
                      variant="light"
                      loading={isCanceling}
                      disabled={isConnecting || isDisconnecting}
                      onClick={() => onCancelSync(item.provider)}
                    >
                      {t("Cancel sync")}
                    </Button>
                  )}
                </Group>
              </Group>
            </Paper>
          );
        })}
      </Stack>
    </Paper>
  );
};

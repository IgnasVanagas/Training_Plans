import { Alert, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { type ProviderStatus } from "../api/integrations";

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

const friendlyErrorCopy = (provider: string, errorText?: string | null) => {
  if (!errorText) return null;
  const lowered = errorText.toLowerCase();
  if (provider.toLowerCase() === "garmin") {
    return "Garmin is taking longer than usual to respond. Your activities are safe and we’ll keep retrying in the background.";
  }
  if (lowered.includes("auth") || lowered.includes("token") || lowered.includes("permission")) {
    return "Connection expired. Reconnect once, then sync again — we’ll pick up where we left off.";
  }
  return "Sync hit a temporary issue. Your training data is still safe, and you can retry now.";
};

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
  const getStatusText = (item: ProviderStatus, isConnected: boolean) => {
    if (isConnected) return "Connected";
    if (item.approval_required) return "Pending partner approval";
    if (item.bridge_only) return "Bridge ingestion";
    if (!item.enabled) return "Disabled (feature flag off)";
    if (!item.configured) return "Not configured (missing credentials)";
    return "Ready to connect";
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Integrations</Title>
        <Text size="sm" c="dimmed">Connect wearable providers, check sync health, and trigger manual sync.</Text>
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
                  <Text size="xs" c="dimmed">Status: {getStatusText(item, isConnected)}</Text>
                  {item.provider === "strava" && isConnected && (
                    <Text size="xs" c="dimmed">
                      Recent activities sync first. Full history is added gradually in the background.
                    </Text>
                  )}
                  {item.last_sync_at && <Text size="xs" c="dimmed">Last sync: {new Date(item.last_sync_at).toLocaleString()}</Text>}
                  {item.last_error && (
                    <Alert
                      variant="light"
                      color="orange"
                      icon={<IconInfoCircle size={14} />}
                      p="xs"
                      w="100%"
                    >
                      <Text size="xs" fw={600}>{friendlyErrorCopy(item.provider, item.last_error)}</Text>
                      <Text size="xs" c="dimmed" mt={2}>Technical detail: {item.last_error}</Text>
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
                    Connect
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="red"
                    loading={isDisconnecting}
                    disabled={!isConnected || isConnecting || isSyncing}
                    onClick={() => onDisconnect(item.provider)}
                  >
                    Disconnect
                  </Button>
                  <Button
                    size="xs"
                    loading={isSyncing}
                    disabled={!isConnected || isConnecting || isDisconnecting}
                    onClick={() => onSync(item.provider)}
                  >
                    Sync now
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
                      Cancel sync
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

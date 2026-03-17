import { useEffect, useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import {
  cancelIntegrationSync,
  connectIntegration,
  disconnectIntegration,
  getIntegrationSyncStatus,
  syncIntegrationNow,
  type ProviderStatus,
} from "../../api/integrations";
import { extractApiErrorMessage } from "./utils";
import { User } from "./types";

type UseIntegrationSyncArgs = {
  queryClient: QueryClient;
  me?: User;
  integrations?: ProviderStatus[];
};

const STRAVA_LOGIN_RECENT_SYNC_FLAG = "tp:strava-login-recent-sync";
const STRAVA_LOGIN_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

export const useIntegrationSync = ({ queryClient, me, integrations }: UseIntegrationSyncArgs) => {
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null);
  const [cancelingProvider, setCancelingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const autoSyncRequestedRef = useRef<Set<string>>(new Set());
  const lastLiveRefreshAtRef = useRef<number>(0);

  useEffect(() => {
    if (!syncingProvider) return;

    const provider = syncingProvider;
    const notificationId = `integration-sync-${provider}`;
    let isActive = true;

    const pollStatus = async () => {
      try {
        const status = await getIntegrationSyncStatus(provider);
        if (!isActive) return;

        if (status.status === "completed") {
          notifications.update({
            id: notificationId,
            title: `${provider} sync complete`,
            message: status.message || "Sync completed",
            color: "green",
            loading: false,
            autoClose: 4500,
            withCloseButton: true,
            position: "bottom-right",
          });
          setSyncingProvider(null);
          queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
          queryClient.invalidateQueries({ queryKey: ["wellness-summary"] });
          queryClient.invalidateQueries({ queryKey: ["activities"] });
          queryClient.invalidateQueries({ queryKey: ["calendar"] });
          queryClient.invalidateQueries({ queryKey: ["zone-summary"] });
          queryClient.invalidateQueries({ queryKey: ["training-status"] });
          queryClient.invalidateQueries({ queryKey: ["training-status-history"] });
          return;
        }

        if (status.status === "failed") {
          notifications.update({
            id: notificationId,
            title: `${provider} sync failed`,
            message: status.last_error || status.message || "Sync failed",
            color: "red",
            loading: false,
            autoClose: 7000,
            withCloseButton: true,
            position: "bottom-right",
          });
          setSyncingProvider(null);
          queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
          queryClient.invalidateQueries({ queryKey: ["calendar"] });
          queryClient.invalidateQueries({ queryKey: ["activities"] });
          return;
        }

        if (status.status === "syncing") {
          const remaining = status.total > 0 ? Math.max(status.total - status.progress, 0) : null;
          const remainingText = remaining === null ? "Remaining: calculating..." : `Remaining: ${remaining}`;
          notifications.update({
            id: notificationId,
            title: `${provider} syncing`,
            message: `${status.message || "Sync in progress"} • ${remainingText}`,
            loading: true,
            autoClose: false,
            withCloseButton: false,
            position: "bottom-right",
          });

          // Live-refresh key dashboards while sync is active so newly imported
          // activities appear without manual page reload.
          const now = Date.now();
          if (now - lastLiveRefreshAtRef.current >= 8000) {
            lastLiveRefreshAtRef.current = now;
            queryClient.invalidateQueries({ queryKey: ["activities"] });
            queryClient.invalidateQueries({ queryKey: ["calendar"] });
            queryClient.invalidateQueries({ queryKey: ["zone-summary"] });
            queryClient.invalidateQueries({ queryKey: ["training-status"] });
          }
          return;
        }

        notifications.update({
          id: notificationId,
          title: `${provider} sync`,
          message: status.message || "No active sync.",
          color: "blue",
          loading: false,
          autoClose: 3500,
          withCloseButton: true,
          position: "bottom-right",
        });
        setSyncingProvider(null);
      } catch (error) {
        if (!isActive) return;
        notifications.update({
          id: notificationId,
          title: `${provider} sync status error`,
          message: extractApiErrorMessage(error),
          color: "red",
          loading: false,
          autoClose: 6000,
          withCloseButton: true,
          position: "bottom-right",
        });
        setSyncingProvider(null);
      }
    };

    void pollStatus();
    const timer = window.setInterval(() => {
      void pollStatus();
    }, 1500);

    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [queryClient, syncingProvider]);

  // Background poll: detect webhook-triggered syncs and auto-refresh data
  useEffect(() => {
    if (syncingProvider) return; // Manual sync polling already active
    if (!me || !integrations) return;

    const stravaProvider = integrations.find(
      (p) => p.provider.trim().toLowerCase() === "strava" && p.connection_status === "connected",
    );
    if (!stravaProvider) return;

    let isActive = true;

    const checkWebhookSync = async () => {
      if (!isActive) return;
      try {
        const status = await getIntegrationSyncStatus("strava");
        if (!isActive) return;
        if (status.status === "syncing") {
          // Webhook triggered a sync — start tracking it
          setSyncingProvider("strava");
          notifications.show({
            id: "integration-sync-strava",
            title: "Strava sync",
            message: status.message || "New activities syncing...",
            loading: true,
            autoClose: false,
            withCloseButton: false,
            position: "bottom-right",
          });
        }
      } catch {
        // Ignore — network errors shouldn't break the background check
      }
    };

    const timer = window.setInterval(checkWebhookSync, 30_000);

    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [me, integrations, syncingProvider]);

  useEffect(() => {
    if (!me || !integrations) return;

    const shouldRunStravaRecentSync = window.sessionStorage.getItem(STRAVA_LOGIN_RECENT_SYNC_FLAG) === "1";
    if (shouldRunStravaRecentSync) {
      const stravaProvider = integrations.find((provider) => provider.provider.trim().toLowerCase() === "strava");
      if (!stravaProvider) {
        return;
      }
      if (stravaProvider?.connection_status === "connected") {
        const lastSyncMs = stravaProvider.last_sync_at ? new Date(stravaProvider.last_sync_at).getTime() : Number.NaN;
        const isCooldownActive = Number.isFinite(lastSyncMs) && (Date.now() - lastSyncMs) < STRAVA_LOGIN_SYNC_COOLDOWN_MS;
        if (isCooldownActive) {
          window.sessionStorage.removeItem(STRAVA_LOGIN_RECENT_SYNC_FLAG);
          return;
        }
        window.sessionStorage.removeItem(STRAVA_LOGIN_RECENT_SYNC_FLAG);
        autoSyncRequestedRef.current.add("strava");
        setSyncingProvider("strava");
        notifications.show({
          id: "integration-sync-strava",
          title: "strava sync",
          message: "Sync queued...",
          loading: true,
          autoClose: false,
          withCloseButton: false,
          position: "bottom-right",
        });
        void syncIntegrationNow("strava", "recent")
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
            queryClient.invalidateQueries({ queryKey: ["wellness-summary"] });
            queryClient.invalidateQueries({ queryKey: ["activities"] });
          })
          .catch((error) => {
            notifications.update({
              id: "integration-sync-strava",
              title: "strava sync failed",
              message: extractApiErrorMessage(error),
              color: "red",
              loading: false,
              autoClose: 7000,
              withCloseButton: true,
              position: "bottom-right",
            });
            setSyncingProvider(null);
          });
      } else {
        window.sessionStorage.removeItem(STRAVA_LOGIN_RECENT_SYNC_FLAG);
      }
    }

    const autoSyncEnabled = me.profile?.auto_sync_integrations !== false;
    if (!autoSyncEnabled) {
      autoSyncRequestedRef.current.clear();
      return;
    }

    const cooldownMs = 15 * 60 * 1000;
    const now = Date.now();
    const connectedProviders = integrations.filter((provider) => {
      if (provider.connection_status !== "connected") return false;
      return provider.provider.trim().toLowerCase() !== "strava";
    });

    const toSync = connectedProviders.filter((provider) => {
      if (autoSyncRequestedRef.current.has(provider.provider)) return false;
      if (!provider.last_sync_at) return true;
      const lastSync = new Date(provider.last_sync_at).getTime();
      if (!Number.isFinite(lastSync)) return true;
      return now - lastSync >= cooldownMs;
    });

    if (toSync.length === 0) return;

    toSync.forEach((provider) => autoSyncRequestedRef.current.add(provider.provider));

    void Promise.allSettled(toSync.map((provider) => syncIntegrationNow(provider.provider))).then(() => {
      queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
      queryClient.invalidateQueries({ queryKey: ["wellness-summary"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    });
  }, [integrations, me, queryClient]);

  const connectIntegrationMutation = useMutation({
    mutationFn: (provider: string) => connectIntegration(provider),
    onMutate: (provider) => {
      setConnectingProvider(provider);
    },
    onSuccess: (data, provider) => {
      if (data.authorize_url) {
        window.location.href = data.authorize_url;
        return;
      }
      notifications.show({
        title: `${provider} connection`,
        message: data.message || `${provider} connection status: ${data.status}`,
        color: "blue",
        position: "bottom-right",
      });
      queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
    },
    onError: (error) => {
      notifications.show({
        title: "Connect failed",
        message: extractApiErrorMessage(error),
        color: "red",
        position: "bottom-right",
      });
    },
    onSettled: () => {
      setConnectingProvider(null);
    },
  });

  const disconnectIntegrationMutation = useMutation({
    mutationFn: (provider: string) => disconnectIntegration(provider),
    onMutate: (provider) => {
      setDisconnectingProvider(provider);
    },
    onSuccess: (_data, provider) => {
      notifications.show({
        title: `${provider} disconnected`,
        message: "Integration disconnected successfully.",
        color: "green",
        position: "bottom-right",
      });
      queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
    },
    onError: (error) => {
      notifications.show({
        title: "Disconnect failed",
        message: extractApiErrorMessage(error),
        color: "red",
        position: "bottom-right",
      });
    },
    onSettled: () => {
      setDisconnectingProvider(null);
    },
  });

  const syncIntegrationMutation = useMutation({
    mutationFn: (provider: string) => syncIntegrationNow(
      provider,
      provider.trim().toLowerCase() === "strava" ? "full" : undefined,
    ),
    onMutate: (provider) => {
      setSyncingProvider(provider);
      notifications.show({
        id: `integration-sync-${provider}`,
        title: `${provider} sync`,
        message: "Sync queued...",
        loading: true,
        autoClose: false,
        withCloseButton: false,
        position: "bottom-right",
      });
    },
    onSuccess: (data, provider) => {
      notifications.update({
        id: `integration-sync-${provider}`,
        title: `${provider} sync`,
        message: data.message || data.status || "Sync queued",
        loading: true,
        autoClose: false,
        withCloseButton: false,
        position: "bottom-right",
      });
      queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
      queryClient.invalidateQueries({ queryKey: ["wellness-summary"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (error, provider) => {
      notifications.update({
        id: `integration-sync-${provider}`,
        title: `${provider} sync failed`,
        message: extractApiErrorMessage(error),
        color: "red",
        loading: false,
        autoClose: 7000,
        withCloseButton: true,
        position: "bottom-right",
      });
      setSyncingProvider(null);
    },
  });

  const cancelSyncMutation = useMutation({
    mutationFn: (provider: string) => cancelIntegrationSync(provider),
    onMutate: (provider) => {
      setCancelingProvider(provider);
      notifications.update({
        id: `integration-sync-${provider}`,
        title: `${provider} sync`,
        message: "Cancel requested...",
        loading: true,
        autoClose: false,
        withCloseButton: false,
        position: "bottom-right",
      });
    },
    onSuccess: (data, provider) => {
      notifications.update({
        id: `integration-sync-${provider}`,
        title: `${provider} sync`,
        message: data.message || "Cancel requested.",
        loading: true,
        autoClose: false,
        withCloseButton: false,
        position: "bottom-right",
      });
      setSyncingProvider(provider);
      queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
    },
    onError: (error, provider) => {
      notifications.update({
        id: `integration-sync-${provider}`,
        title: `${provider} cancel failed`,
        message: extractApiErrorMessage(error),
        color: "red",
        loading: false,
        autoClose: 7000,
        withCloseButton: true,
        position: "bottom-right",
      });
    },
    onSettled: () => {
      setCancelingProvider(null);
    },
  });

  return {
    connectingProvider,
    disconnectingProvider,
    cancelingProvider,
    syncingProvider,
    connectIntegrationMutation,
    disconnectIntegrationMutation,
    syncIntegrationMutation,
    cancelSyncMutation,
  };
};

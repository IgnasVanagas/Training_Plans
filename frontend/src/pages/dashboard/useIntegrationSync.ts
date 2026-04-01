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
  type ProviderSyncResponse,
} from "../../api/integrations";
import { extractApiErrorMessage } from "./utils";
import { User } from "./types";

type UseIntegrationSyncArgs = {
  queryClient: QueryClient;
  me?: User;
  integrations?: ProviderStatus[];
  activeTab?: string;
  isDocumentVisible: boolean;
};

const STRAVA_LOGIN_RECENT_SYNC_FLAG = "tp:strava-login-recent-sync";
const STRAVA_LOGIN_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

export const useIntegrationSync = ({ queryClient, me, integrations, activeTab, isDocumentVisible }: UseIntegrationSyncArgs) => {
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null);
  const [cancelingProvider, setCancelingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<ProviderSyncResponse | null>(null);
  const autoSyncRequestedRef = useRef<Set<string>>(new Set());
  const lastLiveRefreshAtRef = useRef<number>(0);
  const lastKnownSyncAtRef = useRef<string | null | undefined>(undefined);
  const shouldPollIntegrationStatus = isDocumentVisible && ["dashboard", "activities", "plan", "insights", "trackers", "settings"].includes(activeTab || "dashboard");

  useEffect(() => {
    if (!shouldPollIntegrationStatus) return;
    if (!syncingProvider) return;

    const provider = syncingProvider;
    const notificationId = `integration-sync-${provider}`;
    let isActive = true;
    let consecutiveErrors = 0;

    const pollStatus = async () => {
      try {
        const status = await getIntegrationSyncStatus(provider);
        consecutiveErrors = 0;
        if (!isActive) return;

        if (status.status === "completed") {
          notifications.show({
            title: `${provider} sync complete`,
            message: status.message || "Sync completed",
            color: "green",
            autoClose: 4500,
            withCloseButton: true,
            position: "bottom-right",
          });
          setSyncStatus(null);
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
          notifications.show({
            title: `${provider} sync failed`,
            message: status.last_error || status.message || "Sync failed",
            color: "red",
            autoClose: 7000,
            withCloseButton: true,
            position: "bottom-right",
          });
          setSyncStatus(null);
          setSyncingProvider(null);
          queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
          queryClient.invalidateQueries({ queryKey: ["calendar"] });
          queryClient.invalidateQueries({ queryKey: ["activities"] });
          return;
        }

        if (status.status === "syncing") {
          setSyncStatus(status);

          // Live-refresh key dashboards while sync is active so newly imported
          // activities appear without manual page reload.
          const now = Date.now();
          if (now - lastLiveRefreshAtRef.current >= 20000) {
            lastLiveRefreshAtRef.current = now;
            queryClient.invalidateQueries({ queryKey: ["activities"] });
            queryClient.invalidateQueries({ queryKey: ["calendar"] });
            queryClient.invalidateQueries({ queryKey: ["zone-summary"] });
            queryClient.invalidateQueries({ queryKey: ["training-status"] });
          }
          return;
        }

        setSyncStatus(null);
        setSyncingProvider(null);
      } catch (error) {
        if (!isActive) return;
        consecutiveErrors++;
        if (consecutiveErrors < 3) return; // tolerate transient network blips
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
    }, 4000);

    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [queryClient, shouldPollIntegrationStatus, syncingProvider]);

  // Background poll: detect webhook-triggered syncs and auto-refresh data
  useEffect(() => {
    if (!shouldPollIntegrationStatus) return;
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
          return;
        }
        // Detect completed syncs we didn't see "syncing" for
        // (e.g. short webhook syncs that finish between polls)
        const newSyncAt = status.last_success ?? null;
        if (
          lastKnownSyncAtRef.current !== undefined &&
          newSyncAt &&
          newSyncAt !== lastKnownSyncAtRef.current
        ) {
          // A sync completed since our last check — refresh data
          queryClient.invalidateQueries({ queryKey: ["activities"] });
          queryClient.invalidateQueries({ queryKey: ["calendar"] });
          queryClient.invalidateQueries({ queryKey: ["zone-summary"] });
          queryClient.invalidateQueries({ queryKey: ["training-status"] });
          queryClient.invalidateQueries({ queryKey: ["training-status-history"] });
          queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
          queryClient.invalidateQueries({ queryKey: ["wellness-summary"] });
        }
        lastKnownSyncAtRef.current = newSyncAt;
      } catch {
        // Ignore — network errors shouldn't break the background check
      }
    };

    // Poll at 30s interval to detect webhook syncs without overloading backend
    const timer = window.setInterval(checkWebhookSync, 30_000);
    // Run immediately on mount to seed lastKnownSyncAtRef
    void checkWebhookSync();

    return () => {
      isActive = false;
      window.clearInterval(timer);
    };
  }, [integrations, me, shouldPollIntegrationStatus, syncingProvider]);

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
        void syncIntegrationNow("strava")
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
            queryClient.invalidateQueries({ queryKey: ["wellness-summary"] });
            queryClient.invalidateQueries({ queryKey: ["activities"] });
          })
          .catch((error) => {
            notifications.show({
              title: "strava sync failed",
              message: extractApiErrorMessage(error),
              color: "red",
              autoClose: 7000,
              withCloseButton: true,
              position: "bottom-right",
            });
            setSyncStatus(null);
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
    const stravaCooldownMs = 30 * 60 * 1000;
    const now = Date.now();
    const connectedProviders = integrations.filter((provider) => {
      if (provider.connection_status !== "connected") return false;
      return true;
    });

    const toSync = connectedProviders.filter((provider) => {
      if (autoSyncRequestedRef.current.has(provider.provider)) return false;
      if (!provider.last_sync_at) return true;
      const lastSync = new Date(provider.last_sync_at).getTime();
      if (!Number.isFinite(lastSync)) return true;
      const providerCooldown =
        provider.provider.trim().toLowerCase() === "strava" ? stravaCooldownMs : cooldownMs;
      return now - lastSync >= providerCooldown;
    });

    if (toSync.length === 0) return;

    toSync.forEach((provider) => autoSyncRequestedRef.current.add(provider.provider));

    const hasStrava = toSync.some(
      (p) => p.provider.trim().toLowerCase() === "strava",
    );
    if (hasStrava && !syncingProvider) {
      setSyncingProvider("strava");
    }

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
    },
    onSuccess: (_data, provider) => {
      queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
      queryClient.invalidateQueries({ queryKey: ["wellness-summary"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      void provider;
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
      void provider;
    },
    onSuccess: (data, provider) => {
      notifications.show({
        title: `${provider} sync`,
        message: data.message || "Cancel requested.",
        color: "blue",
        autoClose: 3500,
        position: "bottom-right",
      });
      setSyncingProvider(provider);
      queryClient.invalidateQueries({ queryKey: ["integration-providers"] });
    },
    onError: (error, provider) => {
      notifications.show({
        title: `${provider} cancel failed`,
        message: extractApiErrorMessage(error),
        color: "red",
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
    syncStatus,
    connectIntegrationMutation,
    disconnectIntegrationMutation,
    syncIntegrationMutation,
    cancelSyncMutation,
  };
};

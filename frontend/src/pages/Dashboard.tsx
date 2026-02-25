import { Container, Modal, Select, Text, useComputedColorScheme } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/client";
import { getWellnessSummary, listIntegrationProviders, logManualWellness } from "../api/integrations";
import { ActivitiesView } from "../components/ActivitiesView";
import { TrainingCalendar } from "../components/TrainingCalendar";
import { MetricHistoryModal } from "../components/dashboard/MetricHistoryModal";
import ActivityUploadPanel from "../components/dashboard/ActivityUploadPanel";
import DashboardAthleteHome from "./dashboard/DashboardAthleteHome";
import DashboardCoachHome from "./dashboard/DashboardCoachHome";
import DashboardLayoutShell from "./dashboard/DashboardLayoutShell";
import DashboardSettingsTab from "./dashboard/DashboardSettingsTab";
import {
  ActivityFeedRow,
  AthletePermissions,
  DashboardCalendarEvent,
  InviteResponse,
  MetricKey,
  Profile,
  ProfileMetricSnapshot,
  TrainingStatus,
  User,
} from "./dashboard/types";
import { extractApiErrorMessage } from "./dashboard/utils";
import { useIntegrationSync } from "./dashboard/useIntegrationSync";

const Dashboard = () => {
  const location = useLocation();
  const navigationState = (location.state || {}) as {
    activeTab?: "dashboard" | "activities" | "plan" | "settings";
    selectedAthleteId?: string | null;
    calendarDate?: string | null;
  };

  const [opened, { toggle }] = useDisclosure();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "activities" | "plan" | "settings">(
    navigationState.activeTab || "dashboard",
  );
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(navigationState.selectedAthleteId ?? null);
  const [calendarViewDate] = useState<string | null>(navigationState.calendarDate ?? null);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [uploadModalOpened, setUploadModalOpened] = useState(false);
  const [profileMetricHistory, setProfileMetricHistory] = useState<ProfileMetricSnapshot[]>([]);
  const [manualMetricDate, setManualMetricDate] = useState<Date | null>(new Date());
  const [manualMetricValue, setManualMetricValue] = useState<number | "">("");

  const queryClient = useQueryClient();
  const isDark = useComputedColorScheme("light") === "dark";

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const response = await api.get<User>("/users/me");
      return response.data;
    },
  });

  const athletesQuery = useQuery({
    queryKey: ["athletes"],
    queryFn: async () => {
      const response = await api.get<User[]>("/users/athletes");
      return response.data;
    },
    enabled: meQuery.data?.role === "coach",
  });

  const integrationsQuery = useQuery({
    queryKey: ["integration-providers"],
    queryFn: listIntegrationProviders,
  });

  const {
    connectingProvider,
    disconnectingProvider,
    syncingProvider,
    connectIntegrationMutation,
    disconnectIntegrationMutation,
    syncIntegrationMutation,
  } = useIntegrationSync({
    queryClient,
    me: meQuery.data,
    integrations: integrationsQuery.data,
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<InviteResponse>("/users/invite");
      return response.data;
    },
    onSuccess: (data) => setInviteUrl(data.invite_url),
  });

  const profileUpdateMutation = useMutation({
    mutationFn: async (updatedProfile: Profile) => {
      const response = await api.put<User>("/users/profile", updatedProfile);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });

  const athletePermissionsQuery = useQuery({
    queryKey: ["athlete-permissions"],
    enabled: meQuery.data?.role === "coach",
    queryFn: async () => {
      const response = await api.get<AthletePermissions[]>("/users/athlete-permissions");
      return response.data;
    },
  });

  const updateAthletePermissionMutation = useMutation({
    mutationFn: async (vars: { athleteId: number; permissions: Partial<AthletePermissions["permissions"]> }) => {
      const response = await api.put<AthletePermissions>(`/users/athletes/${vars.athleteId}/permissions`, vars.permissions);
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["athlete-permissions"] }),
  });

  const trainingStatusQuery = useQuery({
    queryKey: ["training-status", meQuery.data?.id],
    enabled: meQuery.data?.role === "athlete",
    queryFn: async () => {
      const response = await api.get<TrainingStatus>("/activities/training-status");
      return response.data;
    },
  });

  const trainingStatusHistoryQuery = useQuery({
    queryKey: ["training-status-history", meQuery.data?.id],
    enabled: meQuery.data?.role === "athlete",
    queryFn: async () => {
      const today = new Date();
      const days = Array.from({ length: 14 }, (_, index) => {
        const date = new Date(today);
        date.setDate(today.getDate() - (13 - index));
        return date.toISOString().slice(0, 10);
      });

      const rows = await Promise.all(
        days.map(async (date) => {
          const response = await api.get<TrainingStatus>(`/activities/training-status?reference_date=${date}`);
          return response.data;
        }),
      );

      return rows;
    },
  });

  const wellnessSummaryQuery = useQuery({
    queryKey: ["wellness-summary", meQuery.data?.id],
    enabled: meQuery.data?.role === "athlete",
    queryFn: getWellnessSummary,
  });

  const dashboardCalendarQuery = useQuery({
    queryKey: ["dashboard-calendar", meQuery.data?.id, selectedAthleteId, meQuery.data?.role],
    enabled: Boolean(meQuery.data?.id),
    queryFn: async () => {
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - 14);
      const end = new Date(today);
      end.setDate(today.getDate() + 14);

      const params = new URLSearchParams({
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
      });

      if (meQuery.data?.role === "coach") {
        if (selectedAthleteId) {
          params.set("athlete_id", selectedAthleteId);
        } else {
          params.set("all_athletes", "true");
        }
      }

      const response = await api.get<DashboardCalendarEvent[]>(`/calendar/?${params.toString()}`);
      return response.data;
    },
  });

  const coachRecentActivityQuery = useQuery({
    queryKey: ["coach-feedback-feed", selectedAthleteId],
    enabled: meQuery.data?.role === "coach",
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (selectedAthleteId) params.athlete_id = selectedAthleteId;
      const response = await api.get<ActivityFeedRow[]>("/activities/", { params });
      return response.data;
    },
  });

  const manualWellnessMutation = useMutation({
    mutationFn: logManualWellness,
    onSuccess: () => {
      notifications.show({ title: "Saved", message: "Daily metric saved.", color: "green", position: "bottom-right" });
      queryClient.invalidateQueries({ queryKey: ["wellness-summary"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      setManualMetricValue("");
    },
    onError: (error) => {
      notifications.show({
        title: "Could not save",
        message: extractApiErrorMessage(error),
        color: "red",
        position: "bottom-right",
      });
    },
  });

  const me = meQuery.data;

  useEffect(() => {
    if (!me || me.role !== "athlete") return;
    const storageKey = `profile-metric-history-${me.id}`;
    const today = new Date().toISOString().slice(0, 10);

    const currentSnapshot: ProfileMetricSnapshot = {
      date: today,
      ftp: me.profile?.ftp ?? null,
      rhr: wellnessSummaryQuery.data?.resting_hr?.value ?? me.profile?.resting_hr ?? null,
      hrv: wellnessSummaryQuery.data?.hrv?.value ?? me.profile?.hrv_ms ?? null,
    };

    let existing: ProfileMetricSnapshot[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      existing = raw ? (JSON.parse(raw) as ProfileMetricSnapshot[]) : [];
    } catch {
      existing = [];
    }

    const withoutToday = existing.filter((row) => row.date !== today);
    const updated = [...withoutToday, currentSnapshot].slice(-60);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    setProfileMetricHistory(updated);
  }, [
    me?.id,
    me?.role,
    me?.profile?.ftp,
    me?.profile?.resting_hr,
    me?.profile?.hrv_ms,
    wellnessSummaryQuery.data?.resting_hr?.value,
    wellnessSummaryQuery.data?.hrv?.value,
  ]);

  const selectedMetricRows = useMemo(() => {
    if (!selectedMetric) return [];

    if (selectedMetric === "ftp" || selectedMetric === "rhr" || selectedMetric === "hrv") {
      return profileMetricHistory.map((row) => ({
        date: row.date,
        value: selectedMetric === "ftp" ? row.ftp : selectedMetric === "rhr" ? row.rhr : row.hrv,
      }));
    }

    const history = trainingStatusHistoryQuery.data || [];
    return history.map((row) => ({
      date: String(row.reference_date),
      value:
        selectedMetric === "aerobic_load"
          ? row.acute.aerobic
          : selectedMetric === "anaerobic_load"
            ? row.acute.anaerobic
            : `${row.training_status} (A ${row.acute.daily_load.toFixed(1)} / C ${row.chronic.daily_load.toFixed(1)})`,
    }));
  }, [profileMetricHistory, selectedMetric, trainingStatusHistoryQuery.data]);

  const selectedMetricChartData = useMemo(() => {
    if (!selectedMetric) return [] as Array<Record<string, string | number | null>>;

    if (selectedMetric === "ftp" || selectedMetric === "rhr" || selectedMetric === "hrv") {
      return profileMetricHistory.map((row) => ({
        date: row.date,
        label: row.date.slice(5),
        value: selectedMetric === "ftp" ? row.ftp : selectedMetric === "rhr" ? row.rhr : row.hrv,
      }));
    }

    const history = trainingStatusHistoryQuery.data || [];
    return history.map((row) => ({
      date: String(row.reference_date),
      label: String(row.reference_date).slice(5),
      aerobic: row.acute.aerobic,
      anaerobic: row.acute.anaerobic,
      acute: row.acute.daily_load,
      chronic: row.chronic.daily_load,
      status: row.training_status,
    }));
  }, [profileMetricHistory, selectedMetric, trainingStatusHistoryQuery.data]);

  const athleteIdNum = selectedAthleteId ? parseInt(selectedAthleteId) : null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayWorkout = (dashboardCalendarQuery.data || []).find((row) => row.date === todayIso && row.is_planned);

  const complianceAlerts = useMemo(() => {
    if (me?.role !== "coach") return [] as DashboardCalendarEvent[];
    const rows = dashboardCalendarQuery.data || [];
    return rows
      .filter((row) => {
        const isFlagged =
          row.compliance_status === "missed" || row.compliance_status === "completed_red" || row.compliance_status === "completed_yellow";
        const isOverduePlanned = Boolean(row.is_planned && row.date < todayIso);
        return isFlagged || isOverduePlanned;
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, 8);
  }, [dashboardCalendarQuery.data, me?.role, todayIso]);

  const coachFeedbackRows = useMemo(() => {
    const rows = coachRecentActivityQuery.data || [];
    return rows
      .filter((row) => Date.now() - new Date(row.created_at).getTime() <= 1000 * 60 * 60 * 24)
      .slice(0, 6);
  }, [coachRecentActivityQuery.data]);

  const meDisplayName = useMemo(() => {
    if (!me) return "";
    return (me.profile?.first_name || me.profile?.last_name)
      ? `${me.profile?.first_name || ""} ${me.profile?.last_name || ""}`.trim()
      : me.email;
  }, [me]);

  const handleSaveDailyMetric = () => {
    if (!selectedMetric || (selectedMetric !== "hrv" && selectedMetric !== "rhr")) return;
    if (!manualMetricDate || manualMetricValue === "" || !Number.isFinite(Number(manualMetricValue))) {
      notifications.show({
        title: "Missing value",
        message: "Please provide both date and metric value.",
        color: "orange",
        position: "bottom-right",
      });
      return;
    }

    manualWellnessMutation.mutate({
      date: manualMetricDate.toISOString().slice(0, 10),
      hrv_ms: selectedMetric === "hrv" ? Number(manualMetricValue) : undefined,
      resting_hr: selectedMetric === "rhr" ? Number(manualMetricValue) : undefined,
    });
  };

  if (meQuery.isLoading) {
    return (
      <Container size="md" my={60}>
        <Text>Loading dashboard...</Text>
      </Container>
    );
  }

  if (meQuery.isError || !me) {
    return (
      <Container size="md" my={60}>
        <Text c="red">Unable to load dashboard.</Text>
      </Container>
    );
  }

  const headerRight = me.role === "coach" ? (
    <Select
      placeholder="Filter by Athlete"
      data={[
        { value: "", label: "All Athletes" },
        ...(athletesQuery.data || []).map((athlete) => {
          const p = athlete.profile;
          const label = (p?.first_name || p?.last_name)
            ? `${p.first_name || ""} ${p.last_name || ""}`.trim()
            : athlete.email;
          return { value: athlete.id.toString(), label };
        }),
      ]}
      value={selectedAthleteId ?? ""}
      onChange={(val) => setSelectedAthleteId(val === "" ? null : val)}
      searchable
      allowDeselect={false}
      w={220}
      mr="md"
    />
  ) : null;

  return (
    <DashboardLayoutShell
      opened={opened}
      toggle={toggle}
      meDisplayName={meDisplayName}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      headerRight={headerRight}
      onQuickAddActivity={me.role !== "coach" ? () => setUploadModalOpened(true) : undefined}
    >
      <Container size="xl">
        <Modal
          opened={uploadModalOpened}
          onClose={() => setUploadModalOpened(false)}
          title="Add Activity"
          size="lg"
          centered
        >
          <ActivityUploadPanel onUploaded={() => setUploadModalOpened(false)} />
        </Modal>

        <MetricHistoryModal
          selectedMetric={selectedMetric}
          onClose={() => setSelectedMetric(null)}
          manualMetricDate={manualMetricDate}
          setManualMetricDate={setManualMetricDate}
          manualMetricValue={manualMetricValue}
          setManualMetricValue={setManualMetricValue}
          saveDailyMetric={handleSaveDailyMetric}
          savingManualMetric={manualWellnessMutation.isPending}
          selectedMetricChartData={selectedMetricChartData}
          selectedMetricRows={selectedMetricRows}
        />

        {activeTab === "activities" ? (
          <ActivitiesView
            athleteId={athleteIdNum}
            currentUserRole={me.role}
            athletes={athletesQuery.data || []}
            showUploadSection={false}
          />
        ) : activeTab === "plan" ? (
          <TrainingCalendar
            athleteId={athleteIdNum}
            allAthletes={me.role === "coach" && !athleteIdNum}
            athletes={me.role === "coach" ? athletesQuery.data || [] : []}
            initialViewDate={calendarViewDate}
          />
        ) : activeTab === "settings" ? (
          <DashboardSettingsTab
            me={me}
            athletes={athletesQuery.data || []}
            permissionsRows={athletePermissionsQuery.data || []}
            isSavingProfile={profileUpdateMutation.isPending}
            onSaveProfile={(data) => profileUpdateMutation.mutate(data)}
            providers={integrationsQuery.data || []}
            connectingProvider={connectingProvider}
            disconnectingProvider={disconnectingProvider}
            syncingProvider={syncingProvider}
            onConnect={(provider) => connectIntegrationMutation.mutate(provider)}
            onDisconnect={(provider) => disconnectIntegrationMutation.mutate(provider)}
            onSync={(provider) => syncIntegrationMutation.mutate(provider)}
            onUpdateAthletePermission={(athleteId, permissions) =>
              updateAthletePermissionMutation.mutate({ athleteId, permissions })
            }
          />
        ) : me.role === "coach" ? (
          <DashboardCoachHome
            me={me}
            athletes={athletesQuery.data || []}
            complianceAlerts={complianceAlerts}
            coachFeedbackRows={coachFeedbackRows}
            inviteUrl={inviteUrl}
            onGenerateInvite={() => inviteMutation.mutate()}
            generatingInvite={inviteMutation.isPending}
          />
        ) : (
          <DashboardAthleteHome
            isDark={isDark}
            me={me}
            todayWorkout={todayWorkout}
            wellnessSummary={wellnessSummaryQuery.data}
            integrations={integrationsQuery.data || []}
            trainingStatus={trainingStatusQuery.data}
            onOpenPlan={() => setActiveTab("plan")}
            onSelectMetric={(metric) => setSelectedMetric(metric)}
          />
        )}
      </Container>
    </DashboardLayoutShell>
  );
};

export default Dashboard;

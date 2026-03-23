import { Container, Modal, Select, Text, useComputedColorScheme, Button, Flex, Box, Group, Stack, Skeleton } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { endOfWeek, endOfMonth, format, startOfWeek, startOfMonth } from "date-fns";
import { IconBooks, IconX, IconUpload, IconColumns, IconCalendarEvent, IconChartBar } from "@tabler/icons-react";
import api from "../api/client";
import { getWellnessSummary, listIntegrationProviders, logManualWellness } from "../api/integrations";
import { ActivitiesView } from "../components/ActivitiesView";
import { TrainingCalendar } from "../components/TrainingCalendar";
import { WorkoutLibrary } from "../components/library/WorkoutLibrary";
import SeasonPlannerDrawer from "../components/planner/SeasonPlannerDrawer";
import { SavedWorkout } from "../types/workout";
import { MetricHistoryModal } from "../components/dashboard/MetricHistoryModal";
import ActivityUploadPanel from "../components/dashboard/ActivityUploadPanel";
import SupportContactButton from "../components/common/SupportContactButton";
import DashboardAthleteHome from "./dashboard/DashboardAthleteHome";
import DashboardCoachHome from "./dashboard/DashboardCoachHome";
import DashboardLayoutShell from "./dashboard/DashboardLayoutShell";
import DashboardNotificationsTab from "./dashboard/DashboardNotificationsTab";
import DashboardOrganizationsTab from "./dashboard/DashboardOrganizationsTab";
import DashboardRacesRecordsTab from "./dashboard/DashboardRacesRecordsTab";
import DashboardAthleteProfileTab from "./dashboard/DashboardAthleteProfileTab";
import DashboardTrainingZonesTab from "./dashboard/DashboardTrainingZonesTab";
import DashboardActivityTrackersTab from "./dashboard/DashboardActivityTrackersTab";
import DashboardSettingsTab from "./dashboard/DashboardSettingsTab";
import { useI18n } from "../i18n/I18nProvider";
import {
  ActivityFeedRow,
  AthletePermissions,
  DashboardCalendarEvent,
  InviteByEmailResponse,
  InviteResponse,
  MetricKey,
  NotificationsFeed,
  Profile,
  ProfileMetricSnapshot,
  TrainingStatus,
  User,
} from "./dashboard/types";
import { extractApiErrorMessage } from "./dashboard/utils";
import { useIntegrationSync } from "./dashboard/useIntegrationSync";

const toLocalDateKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const VALID_TABS = new Set(["dashboard", "activities", "plan", "organizations", "notifications", "settings", "races", "insights", "zones", "trackers", "profile", "macrocycle"]);

const Dashboard = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigationState = (location.state || {}) as {
    activeTab?: "dashboard" | "activities" | "plan" | "organizations" | "notifications" | "settings";
    selectedAthleteId?: string | null;
    calendarDate?: string | null;
  };

  const [opened, { toggle }] = useDisclosure();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");

  // Resolve initial tab: navigation state > URL ?tab= > default "dashboard"
  type DashboardTab = "dashboard" | "activities" | "plan" | "organizations" | "notifications" | "settings" | "races" | "insights" | "zones" | "trackers" | "profile" | "macrocycle";
  const resolvedInitialTab: DashboardTab = (() => {
    if (navigationState.activeTab && VALID_TABS.has(navigationState.activeTab)) return navigationState.activeTab;
    const urlTab = searchParams.get("tab");
    if (urlTab && VALID_TABS.has(urlTab)) return urlTab as DashboardTab;
    return "dashboard";
  })();

  const [activeTab, _setActiveTab] = useState<DashboardTab>(
    resolvedInitialTab,
  );

  // Wrapper that also keeps the URL ?tab= param in sync
  const setActiveTab = (tab: DashboardTab) => {
    _setActiveTab(tab);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === "dashboard") {
        next.delete("tab");
      } else {
        next.set("tab", tab);
      }
      return next;
    }, { replace: true });
  };
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(navigationState.selectedAthleteId ?? null);
  const initialCalendarViewDate = useMemo(() => {
    const navEntry = (typeof window !== "undefined"
      ? (window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
      : undefined);
    const isReload = navEntry?.type === "reload";
    if (isReload) return null;
    return navigationState.calendarDate ?? null;
  }, [navigationState.calendarDate]);
  const [calendarViewDate] = useState<string | null>(initialCalendarViewDate);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [plannerOpened, setPlannerOpened] = useState(false);
  const [draggedWorkout, setDraggedWorkout] = useState<SavedWorkout | null>(null);
  const [uploadModalOpened, setUploadModalOpened] = useState(false);
  const [profileMetricHistory, setProfileMetricHistory] = useState<ProfileMetricSnapshot[]>([]);
  const [manualMetricDate, setManualMetricDate] = useState<Date | null>(new Date());
  const [manualMetricValue, setManualMetricValue] = useState<number | "">("");
  const isMobile = useMediaQuery("(max-width: 48em)");


  // Default athletes to Calendar (plan) tab when no explicit tab is in the URL
  const [didDefaultTab, setDidDefaultTab] = useState(false);

  // When arriving via location.state (e.g. back-navigation), sync the URL
  // ?tab= param and clear the transient state so F5 preserves the tab.
  useEffect(() => {
    const hasTransientState = Boolean(
      navigationState.activeTab !== undefined ||
      navigationState.selectedAthleteId !== undefined ||
      navigationState.calendarDate !== undefined,
    );
    if (!hasTransientState) return;

    // Build the new search string with the tab param
    const params = new URLSearchParams(location.search);
    if (resolvedInitialTab && resolvedInitialTab !== "dashboard") {
      params.set("tab", resolvedInitialTab);
    } else {
      params.delete("tab");
    }
    const search = params.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ""}`, { replace: true, state: null });
  }, [
    location.pathname,
    location.search,
    navigate,
    navigationState.activeTab,
    navigationState.calendarDate,
    navigationState.selectedAthleteId,
    resolvedInitialTab,
  ]);

  const queryClient = useQueryClient();
  const isDark = useComputedColorScheme("light") === "dark";
  const { t } = useI18n();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const response = await api.get<User>("/users/me");
      return response.data;
    },
  });

  // Default athletes to Calendar (plan) tab when no explicit tab is in the URL
  useEffect(() => {
    if (didDefaultTab || !meQuery.data) return;
    if (meQuery.data.role !== "coach" && activeTab === "dashboard" && !searchParams.get("tab") && !navigationState.activeTab) {
      setActiveTab("plan");
    }
    setDidDefaultTab(true);
  }, [meQuery.data, didDefaultTab, activeTab, searchParams, navigationState.activeTab]);

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

  useEffect(() => {
    if (!meQuery.data) return;

    const athleteIdNum = selectedAthleteId ? Number(selectedAthleteId) : null;
    const weekStartDay = meQuery.data.profile?.week_start_day === "sunday" ? 0 : 1;
    const now = new Date();
    const monthStartVisible = startOfWeek(startOfMonth(now), { weekStartsOn: weekStartDay as any });
    const monthEndVisible = endOfWeek(endOfMonth(now), { weekStartsOn: weekStartDay as any });

    void queryClient.prefetchQuery({
      queryKey: ["activities", athleteIdNum, [null, null]],
      queryFn: async () => {
        const params: Record<string, any> = { limit: 120, include_load_metrics: false };
        if (athleteIdNum) params.athlete_id = athleteIdNum;
        const res = await api.get("/activities/", { params });
        return res.data;
      },
      staleTime: 1000 * 60 * 5,
    });


  }, [meQuery.data, queryClient, selectedAthleteId]);

  const {
    connectingProvider,
    disconnectingProvider,
    cancelingProvider,
    syncingProvider,
    connectIntegrationMutation,
    disconnectIntegrationMutation,
    syncIntegrationMutation,
    cancelSyncMutation,
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

  const inviteByEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await api.post<InviteByEmailResponse>("/users/invite-by-email", {
        email,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setInviteUrl(data.invite_url);
      notifications.show({
        color: data.status === "already_active" ? "blue" : "green",
        title: "Invite status",
        message: data.message,
      });
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["athletes"] });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Invite failed",
        message: extractApiErrorMessage(error),
      });
    },
  });

  const requestEmailConfirmationMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<{ message: string }>("/auth/request-email-confirmation");
      return response.data;
    },
    onSuccess: (data) => {
      notifications.show({
        color: "blue",
        title: "Verification email",
        message: data.message,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Could not request verification",
        message: extractApiErrorMessage(error),
      });
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (payload: { current_password: string; new_password: string }) => {
      const response = await api.post<{ message: string }>("/users/change-password", payload);
      return response.data;
    },
    onSuccess: (data) => {
      notifications.show({
        color: "green",
        title: "Password updated",
        message: data.message,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Password update failed",
        message: extractApiErrorMessage(error),
      });
    },
  });

  const profileUpdateMutation = useMutation({
    mutationFn: async (updatedProfile: Profile) => {
      const response = await api.put<User>("/users/profile", updatedProfile);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      notifications.show({
        color: "green",
        title: t("Profile saved") || "Profile saved",
        message: t("Your profile has been updated.") || "Your profile has been updated.",
        position: "bottom-right",
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: t("Could not save profile") || "Could not save profile",
        message: extractApiErrorMessage(error),
        position: "bottom-right",
      });
    },
  });

  const athleteProfileUpdateMutation = useMutation({
    mutationFn: async (vars: { athleteId: number; updatedProfile: Profile }) => {
      const response = await api.put<User>(`/users/athletes/${vars.athleteId}/profile`, vars.updatedProfile);
      return response.data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["athletes"] });
      queryClient.invalidateQueries({ queryKey: ["athlete", vars.athleteId] });
      notifications.show({
        color: "green",
        title: t("Athlete zones updated") || "Athlete zones updated",
        message: t("Training zone settings saved.") || "Training zone settings saved.",
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: t("Could not save athlete zones") || "Could not save athlete zones",
        message: extractApiErrorMessage(error),
      });
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

  const respondInvitationMutation = useMutation({
    mutationFn: async (vars: { organizationId: number; action: "accept" | "decline" }) => {
      const response = await api.post<{ message: string; status: string }>(
        `/users/organization/invitations/${vars.organizationId}/respond`,
        { action: vars.action },
      );
      return response.data;
    },
    onSuccess: (data) => {
      notifications.show({
        color: data.status === "rejected" ? "orange" : "green",
        title: "Invitation updated",
        message: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["athletes"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-feed"] });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Invitation update failed",
        message: extractApiErrorMessage(error),
      });
    },
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
    enabled:
      meQuery.data?.role === "athlete" &&
      (selectedMetric === "aerobic_load" || selectedMetric === "anaerobic_load" || selectedMetric === "training_status"),
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const today = new Date();
      const days = Array.from({ length: 14 }, (_, index) => {
        const date = new Date(today);
        date.setDate(today.getDate() - (13 - index));
        return toLocalDateKey(date);
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
        start_date: toLocalDateKey(start),
        end_date: toLocalDateKey(end),
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
    staleTime: 1000 * 60 * 3,
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { limit: 40, include_load_metrics: false };
      if (selectedAthleteId) params.athlete_id = selectedAthleteId;
      const response = await api.get<ActivityFeedRow[]>("/activities/", { params });
      return response.data;
    },
  });

  const notificationsFeedQuery = useQuery({
    queryKey: ["notifications-feed", meQuery.data?.id],
    enabled: Boolean(meQuery.data?.id),
    queryFn: async () => {
      const response = await api.get<NotificationsFeed>("/communications/notifications");
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
    const today = toLocalDateKey(new Date());

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
          ? row.atl
          : selectedMetric === "anaerobic_load"
            ? row.ctl
            : `${row.training_status} (ATL ${row.atl?.toFixed(1) ?? "-"} / CTL ${row.ctl?.toFixed(1) ?? "-"} / TSB ${(row.tsb ?? 0) >= 0 ? "+" : ""}${row.tsb?.toFixed(1) ?? "-"})`,
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
      atl: row.atl,
      ctl: row.ctl,
      tsb: row.tsb,
      status: row.training_status,
    }));
  }, [profileMetricHistory, selectedMetric, trainingStatusHistoryQuery.data]);

  const athleteIdNum = selectedAthleteId ? parseInt(selectedAthleteId) : null;
  const todayIso = toLocalDateKey(new Date());
  const plannedRows = (dashboardCalendarQuery.data || [])
    .filter((row) => row.is_planned)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const todayWorkout = plannedRows.find((row) => row.date === todayIso);
  const nextWorkout = plannedRows.find((row) => row.date >= todayIso);
  const featuredWorkout = todayWorkout || nextWorkout;

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

  const organizationName = useMemo(() => {
    if (!me || me.role !== "coach") return null;
    const activeMembership = me.organization_memberships?.find(
      (m) => m.status === "active" || m.role === "coach"
    );
    return activeMembership?.organization?.name || null;
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
      date: toLocalDateKey(manualMetricDate),
      hrv_ms: selectedMetric === "hrv" ? Number(manualMetricValue) : undefined,
      resting_hr: selectedMetric === "rhr" ? Number(manualMetricValue) : undefined,
    });
  };

  if (meQuery.isLoading) {
    return (
      <Container size="md" my={60}>
        <Stack gap="md">
          <Skeleton height={40} width="40%" />
          <Group grow>
            <Skeleton height={100} radius="lg" />
            <Skeleton height={100} radius="lg" />
            <Skeleton height={100} radius="lg" />
          </Group>
          <Skeleton height={250} radius="lg" />
        </Stack>
      </Container>
    );
  }

  if (meQuery.isError || !me) {
    const dashboardErrorMessage = meQuery.isError
      ? extractApiErrorMessage(meQuery.error)
      : t("Unable to load dashboard.");
    return (
      <Container size="md" my={60}>
        <Stack gap="xs" align="flex-start">
          <Text c="red">{t("Unable to load dashboard.")}</Text>
          <Text size="sm" c="dimmed">{t(dashboardErrorMessage)}</Text>
          <SupportContactButton
            buttonText={t("Contact support")}
            email={meQuery.data?.email ?? null}
            name={(meQuery.data?.profile?.first_name || meQuery.data?.profile?.last_name)
              ? `${meQuery.data?.profile?.first_name || ""} ${meQuery.data?.profile?.last_name || ""}`.trim()
              : null}
            pageLabel="Dashboard"
            errorMessage={dashboardErrorMessage}
          />
        </Stack>
      </Container>
    );
  }

  const headerRight = me.role === "coach" ? (
    isMobile ? (
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
        w={170}
        mr={0}
      />
    ) : null
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
      role={me.role}
      supportEmail={me.email}
      athletes={athletesQuery.data || []}
      selectedAthleteId={selectedAthleteId}
      onSelectAthlete={setSelectedAthleteId}
      organizationName={organizationName}
    >
      <Container size="xl" px={{ base: 0, sm: "md" }}>
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
          <Flex direction="column" gap="xs" style={{ height: 'calc(100dvh - 140px)' }}>
             <Flex style={{ flex: 1, minHeight: 0 }} gap="md">
                <Box style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <TrainingCalendar
                    athleteId={athleteIdNum}
                    allAthletes={me.role === "coach" && !athleteIdNum}
                    athletes={me.role === "coach" ? athletesQuery.data || [] : []}
                    initialViewDate={calendarViewDate}
                    draggedWorkout={draggedWorkout}
                    onWorkoutDrop={(w, d) => {
                        setDraggedWorkout(null);
                        notifications.show({ title: 'Workout Scheduled', message: `${w.title} on ${format(d, 'MMM do')}` });
                    }}
                  />
                </Box>
                {showLibrary && (
                    <Box w={320} style={{ borderLeft: '1px solid var(--mantine-color-default-border)' }}>
                        <WorkoutLibrary 
                            onDragStart={setDraggedWorkout} 
                            onDragEnd={() => setDraggedWorkout(null)}
                        />
                    </Box>
                )}
             </Flex>
          </Flex>
        ) : activeTab === "races" ? (
          <DashboardRacesRecordsTab me={me} athleteId={athleteIdNum} />
        ) : activeTab === "insights" ? (
          <DashboardAthleteHome
            isDark={isDark}
            me={me}
            todayWorkout={featuredWorkout}
            isTodayWorkout={Boolean(todayWorkout && featuredWorkout?.date === todayWorkout.date)}
            wellnessSummary={wellnessSummaryQuery.data}
            integrations={integrationsQuery.data || []}
            trainingStatus={trainingStatusQuery.data}
            onOpenPlan={() => setActiveTab("plan")}
            onSelectMetric={(metric) => setSelectedMetric(metric)}
            respondingInvitation={respondInvitationMutation.isPending}
            onRespondInvitation={(organizationId, action) => respondInvitationMutation.mutate({ organizationId, action })}
          />
        ) : activeTab === "profile" ? (
          <DashboardAthleteProfileTab
            user={me}
            onSubmit={(data) => profileUpdateMutation.mutate(data)}
            isSaving={profileUpdateMutation.isPending}
          />
        ) : activeTab === "zones" ? (
          <DashboardTrainingZonesTab
            user={me}
            onSubmit={(data) => profileUpdateMutation.mutate(data)}
            isSaving={profileUpdateMutation.isPending}
          />
        ) : activeTab === "trackers" ? (
          <DashboardActivityTrackersTab
            providers={integrationsQuery.data || []}
            connectingProvider={connectingProvider}
            disconnectingProvider={disconnectingProvider}
            syncingProvider={syncingProvider}
            cancelingProvider={cancelingProvider}
            onConnect={(provider) => connectIntegrationMutation.mutate(provider)}
            onDisconnect={(provider) => disconnectIntegrationMutation.mutate(provider)}
            onSync={(provider) => syncIntegrationMutation.mutate(provider)}
            onCancelSync={(provider) => cancelSyncMutation.mutate(provider)}
          />
        ) : activeTab === "macrocycle" ? (
          me ? (
            <SeasonPlannerDrawer
              opened={true}
              onClose={() => setActiveTab("plan")}
              me={me}
              athletes={athletesQuery.data || []}
              selectedAthleteId={athleteIdNum}
              inline={true}
            />
          ) : null
        ) : activeTab === "notifications" ? (
          <DashboardNotificationsTab
            me={me}
            items={notificationsFeedQuery.data?.items || []}
            loading={notificationsFeedQuery.isFetching}
            onRefresh={() => notificationsFeedQuery.refetch()}
            onRespondInvitation={(organizationId, action) =>
              respondInvitationMutation.mutate({ organizationId, action })
            }
            respondingInvitation={respondInvitationMutation.isPending}
          />
        ) : activeTab === "organizations" ? (
          <DashboardOrganizationsTab me={me} athletes={athletesQuery.data || []} />
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
            cancelingProvider={cancelingProvider}
            syncingProvider={syncingProvider}
            onConnect={(provider) => connectIntegrationMutation.mutate(provider)}
            onDisconnect={(provider) => disconnectIntegrationMutation.mutate(provider)}
            onSync={(provider) => syncIntegrationMutation.mutate(provider)}
            onCancelSync={(provider) => cancelSyncMutation.mutate(provider)}
            requestingEmailConfirmation={requestEmailConfirmationMutation.isPending}
            changingPassword={changePasswordMutation.isPending}
            onRequestEmailConfirmation={() => requestEmailConfirmationMutation.mutate()}
            onChangePassword={(payload) => changePasswordMutation.mutate(payload)}
            onUpdateAthletePermission={(athleteId, permissions) =>
              updateAthletePermissionMutation.mutate({ athleteId, permissions })
            }
            savingAthleteProfileId={athleteProfileUpdateMutation.isPending ? athleteProfileUpdateMutation.variables?.athleteId ?? null : null}
            onSaveAthleteProfile={(athleteId, updatedProfile) =>
              athleteProfileUpdateMutation.mutate({ athleteId, updatedProfile })
            }
          />
        ) : me.role === "coach" ? (
          <DashboardCoachHome
            me={me}
            athletes={athletesQuery.data || []}
            complianceAlerts={complianceAlerts}
            coachFeedbackRows={coachFeedbackRows}
            inviteUrl={inviteUrl}
            inviteEmail={inviteEmail}
            onInviteEmailChange={setInviteEmail}
            onInviteByEmail={() => {
              const normalized = inviteEmail.trim().toLowerCase();
              if (!normalized) {
                notifications.show({ color: "red", title: "Email required", message: "Enter athlete email first." });
                return;
              }
              inviteByEmailMutation.mutate(normalized);
            }}
            invitingByEmail={inviteByEmailMutation.isPending}
            onGenerateInvite={() => inviteMutation.mutate()}
            generatingInvite={inviteMutation.isPending}
            onOpenPlan={() => setActiveTab("plan")}
            onOpenActivities={() => setActiveTab("activities")}
            onOpenOrganizations={() => setActiveTab("organizations")}
          />
        ) : (
          <DashboardAthleteHome
            isDark={isDark}
            me={me}
            todayWorkout={featuredWorkout}
            isTodayWorkout={Boolean(todayWorkout && featuredWorkout?.date === todayWorkout.date)}
            wellnessSummary={wellnessSummaryQuery.data}
            integrations={integrationsQuery.data || []}
            trainingStatus={trainingStatusQuery.data}
            onOpenPlan={() => setActiveTab("plan")}
            onSelectMetric={(metric) => setSelectedMetric(metric)}
            respondingInvitation={respondInvitationMutation.isPending}
            onRespondInvitation={(organizationId, action) => respondInvitationMutation.mutate({ organizationId, action })}
          />
        )}
      </Container>
      {me ? (
        <SeasonPlannerDrawer
          opened={plannerOpened}
          onClose={() => setPlannerOpened(false)}
          me={me}
          athletes={athletesQuery.data || []}
          selectedAthleteId={athleteIdNum}
        />
      ) : null}
    </DashboardLayoutShell>
  );
};

export default Dashboard;

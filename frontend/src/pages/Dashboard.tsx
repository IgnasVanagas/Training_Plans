import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppShell,
  Burger,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Title,
  Avatar,
  Card,
  SimpleGrid,
  ThemeIcon,
  rem,
  CopyButton,
  ActionIcon,
  Tooltip,
  NavLink,
  NumberInput,
  Select,
  MultiSelect,
  Box,
  TextInput,
  Tabs,
  Divider,
  Switch,
  Modal,
  Alert,
  Badge
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconLogout,
  IconLayoutDashboard,
  IconActivity,
  IconCalendar,
  IconSettings,
  IconPlus,
  IconCopy,
  IconCheck,
  IconUsers,
  IconHeart,
  IconScale,
  IconBolt,
  IconUser,
  IconRun,
  IconSun,
  IconMoon,
  IconAlertTriangle,
  IconTargetArrow,
  IconMessageCircle
} from "@tabler/icons-react";
import api from "../api/client";
import appLogo from "../../uploads/favicon_Origami-removebg-preview.png";
import {
  connectIntegration,
  disconnectIntegration,
  getIntegrationSyncStatus,
  getWellnessSummary,
  listIntegrationProviders,
  syncIntegrationNow,
} from "../api/integrations";
import { ActivitiesView } from "../components/ActivitiesView";
import { TrainingCalendar } from "../components/TrainingCalendar";
import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { CoachComparisonPanel } from "../components/CoachComparisonPanel";
import { IntegrationsPanel } from "../components/IntegrationsPanel";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";

const extractApiErrorMessage = (error: unknown): string => {
  const maybeError = error as { response?: { data?: { detail?: string } }; message?: string };
  if (maybeError?.response?.data?.detail) return maybeError.response.data.detail;
  return maybeError?.message || "Unexpected error";
};
import type { ProviderStatus } from "../api/integrations";

type Profile = {
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | Date | null;
  weight?: number | null;
  ftp?: number | null;
  lt2?: number | null;
  max_hr?: number | null;
  resting_hr?: number | null;
  sports?: string[] | null;
  zone_settings?: {
    running?: { hr?: { lt1?: number | null; lt2?: number | null; upper_bounds?: number[] | null }; pace?: { lt1?: number | null; lt2?: number | null; upper_bounds?: number[] | null } };
    cycling?: { hr?: { lt1?: number | null; lt2?: number | null; upper_bounds?: number[] | null }; power?: { lt1?: number | null; lt2?: number | null; upper_bounds?: number[] | null } };
  } | null;
  auto_sync_integrations?: boolean | null;
  main_sport?: string | null;
  timezone?: string | null;
  preferred_units?: string | null;
  week_start_day?: string | null;
};

const formatDuration = (decimalMinutes: number) => {
  const minutes = Math.floor(decimalMinutes);
  const seconds = Math.round((decimalMinutes - minutes) * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatMinutesHm = (minutes?: number | null) => {
  if (!minutes || minutes <= 0) return '-';
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m}m`;
};

const getSupportedTimeZones = (): string[] => {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  return intlWithSupportedValues.supportedValuesOf?.("timeZone") ?? [Intl.DateTimeFormat().resolvedOptions().timeZone];
};

type User = {
  id: number;
  email: string;
  role: "coach" | "athlete" | "admin";
  profile?: Profile | null;
};

type TrainingStatus = {
  athlete_id: number;
  reference_date: string;
  acute: {
    aerobic: number;
    anaerobic: number;
    daily_load: number;
  };
  chronic: {
    aerobic: number;
    anaerobic: number;
    daily_load: number;
  };
  training_status: string;
};

type MetricKey = "ftp" | "max_hr" | "weight" | "aerobic_load" | "anaerobic_load" | "training_status";

type ProfileMetricSnapshot = {
  date: string;
  ftp: number | null;
  max_hr: number | null;
  weight: number | null;
};

type AthletePermissions = {
  athlete_id: number;
  permissions: {
    allow_delete_activities: boolean;
    allow_delete_workouts: boolean;
    allow_edit_workouts: boolean;
  };
};

type DashboardCalendarEvent = {
  id?: number;
  user_id?: number;
  title: string;
  date: string;
  sport_type?: string;
  compliance_status?: "planned" | "completed_green" | "completed_yellow" | "completed_red" | "missed";
  is_planned?: boolean;
  planned_duration?: number;
  duration?: number;
};

type ActivityFeedRow = {
  id: number;
  athlete_id: number;
  created_at: string;
  sport?: string;
  filename: string;
};

const SettingsForm = ({ user, onSubmit, isSaving, providers, connectingProvider, disconnectingProvider, syncingProvider, onConnect, onDisconnect, onSync }: { user: User; onSubmit: (data: Profile) => void; isSaving: boolean; providers?: ProviderStatus[]; connectingProvider?: string | null; disconnectingProvider?: string | null; syncingProvider?: string | null; onConnect?: (p: string) => void; onDisconnect?: (p: string) => void; onSync?: (p: string) => void }) => {
  const capitalize = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const initialProfile: Profile = user.profile
    ? {
        ...user.profile,
        birth_date: user.profile.birth_date ? new Date(user.profile.birth_date) : null,
        sports: user.profile.sports
          ? user.profile.sports
              .map(s => capitalize(s ?? null))
              .filter((sport): sport is string => typeof sport === 'string' && sport.length > 0)
          : undefined,
        main_sport: capitalize(user.profile.main_sport as string) || undefined,
      }
    : {} as Profile;

  const [profile, setProfile] = useState<Profile>(initialProfile || {});
  const [zoneSport, setZoneSport] = useState<'running' | 'cycling'>('running');
  const [zoneMetric, setZoneMetric] = useState<'hr' | 'pace' | 'power'>('hr');

  useEffect(() => {
    if (zoneSport === 'running' && zoneMetric === 'power') {
      setZoneMetric('hr');
    }
    if (zoneSport === 'cycling' && zoneMetric === 'pace') {
      setZoneMetric('power');
    }
  }, [zoneSport, zoneMetric]);
  
  const handleChange = (field: keyof Profile, value: any) => {
    setProfile(p => ({ ...p, [field]: value }));
  };

  const lt2Minutes = profile.lt2 ? Math.floor(profile.lt2) : '';
  const lt2Seconds = profile.lt2 ? Math.round((profile.lt2 - Math.floor(profile.lt2)) * 60) : '';

  const handleLt2Change = (type: 'min' | 'sec', val: number | string) => {
      let m = typeof lt2Minutes === 'number' ? lt2Minutes : 0;
      let s = typeof lt2Seconds === 'number' ? lt2Seconds : 0;
      
      if (type === 'min') m = Number(val);
      if (type === 'sec') s = Number(val);

      if (val === '') {
        // If clearing input, we might want to wait or handle it, 
        // but for now let's just calc. If both empty, maybe set to null?
         if (type === 'min' && val === '' && s === 0) { handleChange('lt2', null); return; }
      }

      const newLt2 = m + (s / 60);
      handleChange('lt2', newLt2);
  };

  const getZoneConfig = () => {
    const settings = profile.zone_settings || {};
    const sportCfg = settings[zoneSport] || {};
    return (sportCfg as any)[zoneMetric] || {};
  };

  const setZoneConfigField = (field: 'lt1' | 'lt2' | 'upper_bounds', value: number | number[] | null) => {
    const next = { ...(profile.zone_settings || {}) } as any;
    next[zoneSport] = { ...(next[zoneSport] || {}) };
    next[zoneSport][zoneMetric] = { ...(next[zoneSport][zoneMetric] || {}) };
    next[zoneSport][zoneMetric][field] = value;
    handleChange('zone_settings', next);
  };

  const zoneConfig = getZoneConfig();

  const expectedUpperBoundCount = (() => {
    if (zoneSport === 'running' && zoneMetric === 'hr') return 4;
    if (zoneSport === 'running' && zoneMetric === 'pace') return 6;
    if (zoneSport === 'cycling' && zoneMetric === 'hr') return 4;
    return 6; // cycling power
  })();

  const suggestedUpperBounds = (() => {
    const toFixedArray = (values: number[], scale = 0) => values.map((value) => Number(value.toFixed(scale)));

    if (zoneSport === 'running' && zoneMetric === 'pace') {
      const lt2 = Number(zoneConfig.lt2 ?? profile.lt2 ?? 0);
      if (lt2 > 0) {
        return toFixedArray([lt2 * 0.84, lt2 * 0.90, lt2 * 0.97, lt2 * 1.03, lt2 * 1.10, lt2 * 1.20], 2);
      }
      return [3.8, 4.1, 4.5, 4.9, 5.3, 5.8];
    }

    if (zoneMetric === 'power') {
      const ftp = Number(profile.ftp ?? 0);
      if (ftp > 0) {
        return toFixedArray([ftp * 0.55, ftp * 0.75, ftp * 0.90, ftp * 1.05, ftp * 1.20, ftp * 1.50], 0);
      }
      return [120, 160, 200, 240, 280, 340];
    }

    const maxHr = Number(profile.max_hr ?? 0);
    if (maxHr > 0) {
      return toFixedArray([maxHr * 0.60, maxHr * 0.70, maxHr * 0.80, maxHr * 0.90], 0);
    }
    return [120, 135, 150, 165];
  })();

  const zoneUpperBounds = (() => {
    const existing = Array.isArray(zoneConfig.upper_bounds)
      ? zoneConfig.upper_bounds
          .map((value: unknown) => Number(value))
          .filter((value: number) => Number.isFinite(value))
      : [];

    return Array.from({ length: expectedUpperBoundCount }, (_, idx) => existing[idx] ?? suggestedUpperBounds[idx]);
  })();

  const setSingleUpperBound = (index: number, value: number | string) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const next = [...zoneUpperBounds];
    next[index] = value;
    setZoneConfigField('upper_bounds', next);
  };

  const applySuggestedUpperBounds = () => {
    setZoneConfigField('upper_bounds', suggestedUpperBounds.slice(0, expectedUpperBoundCount));
  };

  return (
    <Tabs defaultValue="general">
        <Tabs.List>
            <Tabs.Tab value="general">Personal Information</Tabs.Tab>
            <Tabs.Tab value="preferences">Preferences</Tabs.Tab>
            <Tabs.Tab value="athletic">Athletic Profile</Tabs.Tab>
          <Tabs.Tab value="zones">Custom Zones</Tabs.Tab>
            <Tabs.Tab value="integrations">Integrations</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" pt="md">
            <Paper p="md" radius="md" withBorder>
                <Stack>
                    <Group grow>
                        <TextInput label="First Name" value={profile.first_name || ''} onChange={(e) => handleChange('first_name', e.currentTarget.value)} />
                        <TextInput label="Last Name" value={profile.last_name || ''} onChange={(e) => handleChange('last_name', e.currentTarget.value)} />
                    </Group>
                    <DateInput 
                        label="Date of Birth"
                        value={profile.birth_date as Date}
                        onChange={(val) => handleChange('birth_date', val)}
                        clearable
                    />
                    <Select
                        label="Time Zone"
                        placeholder="Select time zone"
                      data={getSupportedTimeZones()}
                        value={profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
                        onChange={(val) => handleChange('timezone', val)}
                        searchable
                    />
                </Stack>
            </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="preferences" pt="md">
            <Paper p="md" radius="md" withBorder>
                <Stack>
                    <Group grow>
                        <Select
                            label="Preferred Units"
                            data={[{ value: 'metric', label: 'Metric (km, kg)' }, { value: 'imperial', label: 'Imperial (miles, lbs)' }]}
                            value={profile.preferred_units || 'metric'}
                            onChange={(val) => handleChange('preferred_units', val)}
                        />
                        <Select
                            label="Week Start Day"
                            data={[{ value: 'monday', label: 'Monday' }, { value: 'sunday', label: 'Sunday' }]}
                            value={profile.week_start_day || 'monday'}
                            onChange={(val) => handleChange('week_start_day', val)}
                        />
                    </Group>
                </Stack>
            </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="athletic" pt="md">
            <Paper p="md" radius="md" withBorder>
                <Stack>
                    <MultiSelect
                        label="Sports"
                        placeholder="Select sports"
                        data={["Running", "Cycling"]}
                        value={profile.sports || []}
                        onChange={(val) => handleChange('sports', val)}
                    />
                    <Select
                        label="Main Sport"
                        placeholder="Select main sport"
                        data={["Running", "Cycling"]}
                        value={profile.main_sport || ''}
                        onChange={(val) => handleChange('main_sport', val)}
                        description="Determines which metrics are shown on the dashboard."
                    />
                    <SimpleGrid cols={2}>
                        <NumberInput
                            label="Weight (kg)"
                            value={profile.weight ?? ''}
                            onChange={(val) => handleChange('weight', val)}
                        />
                        <NumberInput
                            label="Resting Heart Rate"
                            value={profile.resting_hr ?? ''}
                            onChange={(val) => handleChange('resting_hr', val)}
                        />
                        <NumberInput
                            label="Max Heart Rate"
                            value={profile.max_hr ?? ''}
                            onChange={(val) => handleChange('max_hr', val)}
                        />
                        <NumberInput
                            label="FTP (Watts)"
                            value={profile.ftp ?? ''}
                            onChange={(val) => handleChange('ftp', val)}
                        />
                    </SimpleGrid>
                    <Stack gap={0}>
                        <Text size="sm" fw={500} mt={3}>LT2 (Pace)</Text>
                        <Group grow>
                            <NumberInput
                                placeholder="Min"
                                min={2}
                                max={59}
                                value={lt2Minutes}
                                onChange={(val) => handleLt2Change('min', val)}
                                suffix="m"
                            />
                            <NumberInput
                                placeholder="Sec"
                                min={0}
                                max={59}
                                value={lt2Seconds}
                                onChange={(val) => handleLt2Change('sec', val)}
                                suffix="s"
                            />
                        </Group>
                        <Text size="xs" c="dimmed">Minutes : Seconds (min/km)</Text>
                    </Stack>
                </Stack>
            </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="zones" pt="md">
            <Paper p="md" radius="md" withBorder>
                <Stack>
                    <Group grow>
                        <Select
                            label="Sport"
                            data={[{ value: 'running', label: 'Running' }, { value: 'cycling', label: 'Cycling' }]}
                            value={zoneSport}
                            onChange={(value) => setZoneSport((value as 'running' | 'cycling') || 'running')}
                            allowDeselect={false}
                        />
                        <Select
                            label="Metric"
                            data={zoneSport === 'running'
                                ? [{ value: 'hr', label: 'Heart Rate' }, { value: 'pace', label: 'Pace' }]
                                : [{ value: 'hr', label: 'Heart Rate' }, { value: 'power', label: 'Power' }]}
                            value={zoneMetric}
                            onChange={(value) => setZoneMetric((value as 'hr' | 'pace' | 'power') || 'hr')}
                            allowDeselect={false}
                        />
                    </Group>
                    <Group grow>
                        <NumberInput
                            label={zoneMetric === 'pace' ? 'LT1 Pace (min/km)' : 'LT1'}
                            value={zoneConfig.lt1 ?? ''}
                            onChange={(val) => setZoneConfigField('lt1', typeof val === 'number' ? val : null)}
                            decimalScale={zoneMetric === 'pace' ? 2 : 0}
                        />
                        <NumberInput
                            label={zoneMetric === 'pace' ? 'LT2 Pace (min/km)' : 'LT2'}
                            value={zoneConfig.lt2 ?? ''}
                            onChange={(val) => setZoneConfigField('lt2', typeof val === 'number' ? val : null)}
                            decimalScale={zoneMetric === 'pace' ? 2 : 0}
                        />
                    </Group>
                    <Text size="sm" fw={500}>Zone boundaries</Text>
                    <Text size="xs" c="dimmed">
                        {zoneMetric === 'pace'
                          ? 'Set each zone upper boundary in min/km (strictly increasing).'
                          : 'Set each zone upper boundary (strictly increasing, no gaps/overlap).'}
                    </Text>
                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                      {zoneUpperBounds.map((bound, idx) => (
                        <NumberInput
                          key={`zone-upper-${idx}`}
                          label={`Z${idx + 1} upper bound`}
                          value={bound}
                          decimalScale={zoneMetric === 'pace' ? 2 : 0}
                          onChange={(value) => setSingleUpperBound(idx, value)}
                        />
                      ))}
                    </SimpleGrid>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">
                        {zoneMetric === 'pace'
                          ? `Zones defined as Z1…Z${expectedUpperBoundCount + 1} from slow to fast pace.`
                          : `Zones defined as Z1…Z${expectedUpperBoundCount + 1} from low to high intensity.`}
                      </Text>
                      <Button variant="light" size="xs" onClick={applySuggestedUpperBounds}>Auto-fill Suggested</Button>
                    </Group>
                </Stack>
            </Paper>
        </Tabs.Panel>
      
        <Group justify="flex-end" mt="lg">
          <Button onClick={() => {
        // Sanitize payload: convert empty values to null and normalize sport strings to lowercase for storage
        const payload: Profile = { ...profile };
        (['weight', 'ftp', 'lt2', 'max_hr', 'resting_hr'] as const).forEach(key => {
          if (payload[key] == null) {
                (payload[key] as any) = null;
            }
        });

        // Normalize sports and main_sport to lowercase for backend
        if (payload.sports && Array.isArray(payload.sports)) {
          payload.sports = payload.sports.map(s => (typeof s === 'string' ? s.toLowerCase() : s));
          if (payload.sports.length === 0) payload.sports = null;
        }

        if (payload.main_sport && typeof payload.main_sport === 'string') {
          payload.main_sport = payload.main_sport.toLowerCase();
        } else {
          payload.main_sport = null;
        }
        
        // Ensure timezone is set if selected, or null if empty string (though select should handle it)
        if (payload.timezone === '') payload.timezone = null;

        const validateZoneSettings = () => {
          const settings = payload.zone_settings;
          if (!settings) return true;
          const checks: Array<{ sport: 'running' | 'cycling'; metric: 'hr' | 'pace' | 'power'; cfg: any }> = [];
          (['running', 'cycling'] as const).forEach((sport) => {
            const sportCfg = settings[sport] || {};
            (Object.keys(sportCfg) as Array<'hr' | 'pace' | 'power'>).forEach((metric) => {
              checks.push({ sport, metric, cfg: (sportCfg as any)[metric] || {} });
            });
          });

          for (const check of checks) {
            const lt1 = check.cfg?.lt1;
            const lt2 = check.cfg?.lt2;
            if (lt1 != null && lt2 != null) {
              if (check.metric === 'pace' && !(Number(lt2) < Number(lt1))) {
                notifications.show({ color: 'red', title: 'Invalid pace LT values', message: 'For pace, LT2 must be faster than LT1 (smaller min/km).' });
                return false;
              }
              if (check.metric !== 'pace' && !(Number(lt2) > Number(lt1))) {
                notifications.show({ color: 'red', title: 'Invalid LT values', message: 'LT2 must be greater than LT1.' });
                return false;
              }
            }

            const bounds = Array.isArray(check.cfg?.upper_bounds) ? check.cfg.upper_bounds : [];
            for (let idx = 1; idx < bounds.length; idx += 1) {
              if (!(Number(bounds[idx]) > Number(bounds[idx - 1]))) {
                notifications.show({ color: 'red', title: 'Invalid zone boundaries', message: `${check.sport}/${check.metric} bounds must be strictly increasing (no gaps/overlap).` });
                return false;
              }
            }
          }
          return true;
        };

        if (!validateZoneSettings()) return;

        onSubmit(payload);
      }} loading={isSaving}>Save Changes</Button>
      </Group>

      <Tabs.Panel value="integrations" pt="md">
        <Paper p="md" radius="md" withBorder>
          <Switch
            mb="md"
            label="Automatic sync for connected services"
            description="Enabled by default. Disable to sync only when you press Sync now."
            checked={profile.auto_sync_integrations !== false}
            onChange={(event) => handleChange('auto_sync_integrations', event.currentTarget.checked)}
          />
          <IntegrationsPanel
            providers={providers || []}
            connectingProvider={connectingProvider}
            disconnectingProvider={disconnectingProvider}
            syncingProvider={syncingProvider}
            onConnect={(p) => onConnect && onConnect(p)}
            onDisconnect={(p) => onDisconnect && onDisconnect(p)}
            onSync={(p) => onSync && onSync(p)}
          />
        </Paper>
      </Tabs.Panel>

    </Tabs>
  );
};


import { useLocation, useNavigate } from "react-router-dom";

type InviteResponse = {
  invite_token: string;
  invite_url: string;
};

const Dashboard = () => {
  const location = useLocation();
  const navigationState = (location.state || {}) as {
    activeTab?: "dashboard" | "activities" | "plan" | "settings";
    selectedAthleteId?: string | null;
    calendarDate?: string | null;
  };
  const [opened, { toggle }] = useDisclosure();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "activities" | "plan" | "settings">(navigationState.activeTab || "dashboard");
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(navigationState.selectedAthleteId ?? null);
  const [calendarViewDate] = useState<string | null>(navigationState.calendarDate ?? null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<string | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);
  const [profileMetricHistory, setProfileMetricHistory] = useState<ProfileMetricSnapshot[]>([]);
  const autoSyncRequestedRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isDark = computedColorScheme === "dark";

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const response = await api.get<User>("/users/me");
      return response.data;
    }
  });

  const athletesQuery = useQuery({
    queryKey: ["athletes"],
    queryFn: async () => {
      const response = await api.get<User[]>("/users/athletes");
      return response.data;
    },
    enabled: meQuery.data?.role === "coach"
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<InviteResponse>("/users/invite");
      return response.data;
    },
    onSuccess: (data) => setInviteUrl(data.invite_url)
  });

  const profileUpdateMutation = useMutation({
    mutationFn: async (updatedProfile: Profile) => {
      const response = await api.put<User>("/users/profile", updatedProfile);
      return response.data;
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  });

  const athletePermissionsQuery = useQuery({
    queryKey: ["athlete-permissions"],
    enabled: meQuery.data?.role === "coach",
    queryFn: async () => {
      const response = await api.get<AthletePermissions[]>('/users/athlete-permissions');
      return response.data;
    }
  });

  const trainingStatusQuery = useQuery({
    queryKey: ['training-status', meQuery.data?.id],
    enabled: meQuery.data?.role === 'athlete',
    queryFn: async () => {
      const response = await api.get<TrainingStatus>('/activities/training-status');
      return response.data;
    }
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
        })
      );

      return rows;
    },
  });

  const updateAthletePermissionMutation = useMutation({
    mutationFn: async (vars: { athleteId: number; permissions: Partial<AthletePermissions['permissions']> }) => {
      const response = await api.put<AthletePermissions>(`/users/athletes/${vars.athleteId}/permissions`, vars.permissions);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['athlete-permissions'] });
    }
  });

  const integrationsQuery = useQuery({
    queryKey: ["integration-providers"],
    queryFn: listIntegrationProviders,
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
    }
  });

  const coachRecentActivityQuery = useQuery({
    queryKey: ["coach-feedback-feed", selectedAthleteId],
    enabled: meQuery.data?.role === "coach",
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (selectedAthleteId) params.athlete_id = selectedAthleteId;
      const response = await api.get<ActivityFeedRow[]>("/activities/", { params });
      return response.data;
    }
  });

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
          return;
        }

        notifications.update({
          id: notificationId,
          title: `${provider} sync`,
          message: status.message || "Waiting for sync worker...",
          loading: true,
          autoClose: false,
          withCloseButton: false,
          position: "bottom-right",
        });
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
    }
  });

  const disconnectIntegrationMutation = useMutation({
    mutationFn: (provider: string) => disconnectIntegration(provider),
    onMutate: (provider) => {
      setDisconnectingProvider(provider);
    },
    onSuccess: (data, provider) => {
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
    }
  });

  const syncIntegrationMutation = useMutation({
    mutationFn: (provider: string) => syncIntegrationNow(provider),
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

  useEffect(() => {
    if (!meQuery.data || !integrationsQuery.data) return;

    const autoSyncEnabled = meQuery.data.profile?.auto_sync_integrations !== false;
    if (!autoSyncEnabled) {
      autoSyncRequestedRef.current.clear();
      return;
    }

    const cooldownMs = 15 * 60 * 1000;
    const now = Date.now();
    const connectedProviders = integrationsQuery.data.filter((provider) => provider.connection_status === "connected");

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
  }, [integrationsQuery.data, meQuery.data, queryClient]);

  const me = meQuery.data;

  useEffect(() => {
    if (!me || me.role !== "athlete") return;

    const storageKey = `profile-metric-history-${me.id}`;
    const today = new Date().toISOString().slice(0, 10);

    const currentSnapshot: ProfileMetricSnapshot = {
      date: today,
      ftp: me.profile?.ftp ?? null,
      max_hr: me.profile?.max_hr ?? null,
      weight: me.profile?.weight ?? null,
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
  }, [me?.id, me?.profile?.ftp, me?.profile?.max_hr, me?.profile?.weight, me?.role]);

  const metricDescriptions: Record<MetricKey, string> = {
    ftp: "Functional Threshold Power: the highest power you can sustain for about 60 minutes. Used for cycling intensity zones.",
    max_hr: "Max Heart Rate: your highest observed heart rate. Used to define heart-rate training zones.",
    weight: "Body Weight: used for relative performance metrics such as watts per kilogram and training load context.",
    aerobic_load: "Aerobic Load (7d): total lower-intensity endurance load accumulated over the last 7 days.",
    anaerobic_load: "Anaerobic Load (7d): total high-intensity load accumulated over the last 7 days.",
    training_status: "Training Status compares short-term (acute) and long-term (chronic) load to indicate how your body is handling training stress.",
  };

  const metricModalTitle: Record<MetricKey, string> = {
    ftp: "FTP",
    max_hr: "Max Heart Rate",
    weight: "Weight",
    aerobic_load: "Aerobic Load (7d)",
    anaerobic_load: "Anaerobic Load (7d)",
    training_status: "Training Status",
  };

  const selectedMetricRows = useMemo(() => {
    if (!selectedMetric) return [];

    if (selectedMetric === "ftp" || selectedMetric === "max_hr" || selectedMetric === "weight") {
      return profileMetricHistory.map((row) => ({
        date: row.date,
        value:
          selectedMetric === "ftp"
            ? row.ftp
            : selectedMetric === "max_hr"
              ? row.max_hr
              : row.weight,
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

    if (selectedMetric === "ftp" || selectedMetric === "max_hr" || selectedMetric === "weight") {
      return profileMetricHistory.map((row) => ({
        date: row.date,
        label: row.date.slice(5),
        value:
          selectedMetric === "ftp"
            ? row.ftp
            : selectedMetric === "max_hr"
              ? row.max_hr
              : row.weight,
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
        const isFlagged = row.compliance_status === "missed" || row.compliance_status === "completed_red" || row.compliance_status === "completed_yellow";
        const isOverduePlanned = Boolean(row.is_planned && row.date < todayIso);
        return isFlagged || isOverduePlanned;
      })
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, 8);
  }, [dashboardCalendarQuery.data, me?.role, todayIso]);

  const coachFeedbackRows = useMemo(() => {
    const rows = coachRecentActivityQuery.data || [];
    return rows
      .filter((row) => {
        const diffMs = Date.now() - new Date(row.created_at).getTime();
        return diffMs <= 1000 * 60 * 60 * 24;
      })
      .slice(0, 6);
  }, [coachRecentActivityQuery.data]);

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

  // Derived metrics
  const ftpValue = me.profile?.ftp ?? null;
  const weightValue = me.profile?.weight ?? null;
  const wkgValue = (ftpValue != null && weightValue != null && weightValue > 0)
    ? Number(ftpValue) / Number(weightValue)
    : null;
  const meDisplayName = (me.profile?.first_name || me.profile?.last_name)
    ? `${me.profile?.first_name || ''} ${me.profile?.last_name || ''}`.trim()
    : me.email;
  const meRole = me.role;

  const Header = () => (
    <Group h="100%" px="md" justify="space-between">
      <Group>
        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
        <img src={appLogo} alt="Origami Plans" width={32} height={32} />
        <Title order={3} visibleFrom="xs">Origami Plans</Title>
      </Group>
        <Group>
        {meRole === 'coach' && (
           <Select 
             placeholder="Filter by Athlete"
             data={[
                { value: '', label: 'All Athletes' },
                ...(athletesQuery.data || []).map(a => {
                    const p = a.profile;
                    const label = (p?.first_name || p?.last_name) ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : a.email;
                    return { value: a.id.toString(), label };
                })
             ]}
             value={selectedAthleteId ?? ''}
             onChange={(val) => setSelectedAthleteId(val === '' ? null : val)}
             searchable
             allowDeselect={false}
             w={200}
             mr="md"
           />
        )}
        <Button
          variant="light"
          color="red"
          size="xs"
          leftSection={<IconLogout size={14} />}
          onClick={() => {
            localStorage.removeItem("access_token");
            window.location.href = "/login";
          }}
        >
          Sign Out
        </Button>
      </Group>
    </Group>
  );

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 96,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Header />
      </AppShell.Header>

      <AppShell.Navbar p="sm" style={{ borderRight: `1px solid ${isDark ? 'rgba(148,163,184,0.22)' : 'rgba(15,23,42,0.12)'}` }}>
        <Stack h="100%" justify="space-between" gap="md">
          <Stack gap="sm" align="center" pt="xs">
            {[
              { key: 'dashboard', icon: IconLayoutDashboard, label: 'Dashboard' },
              { key: 'activities', icon: IconActivity, label: 'Activities' },
              { key: 'plan', icon: IconCalendar, label: 'Training Plan' },
              { key: 'settings', icon: IconSettings, label: 'Settings' }
            ].map((item) => {
              const IconComponent = item.icon;
              const active = activeTab === item.key;
              return (
                <Tooltip key={item.key} label={item.label} position="right">
                  <ActionIcon
                    size="xl"
                    radius="md"
                    variant={active ? 'filled' : 'subtle'}
                    color={active ? 'blue' : 'gray'}
                    onClick={() => {
                      setActiveTab(item.key as 'dashboard' | 'activities' | 'plan' | 'settings');
                      if (window.innerWidth < 768) toggle();
                    }}
                    aria-label={item.label}
                  >
                    <IconComponent size={18} stroke={1.7} />
                  </ActionIcon>
                </Tooltip>
              );
            })}
          </Stack>

          <Stack gap="sm" align="center" pb="xs">
            <Tooltip label={isDark ? "Switch to light mode" : "Switch to dark mode"} position="right">
              <ActionIcon
                variant="light"
                size="xl"
                radius="md"
                onClick={() => setColorScheme(isDark ? "light" : "dark")}
                aria-label="Toggle color mode"
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                <IconSun
                  size={16}
                  style={{
                    position: 'absolute',
                    opacity: isDark ? 1 : 0,
                    transform: isDark ? 'translateY(0) rotate(0deg) scale(1)' : 'translateY(10px) rotate(90deg) scale(0.65)',
                    transition: 'all 220ms cubic-bezier(0.22, 1, 0.36, 1)'
                  }}
                />
                <IconMoon
                  size={16}
                  style={{
                    position: 'absolute',
                    opacity: isDark ? 0 : 1,
                    transform: isDark ? 'translateY(-10px) rotate(-90deg) scale(0.65)' : 'translateY(0) rotate(0deg) scale(1)',
                    transition: 'all 220ms cubic-bezier(0.22, 1, 0.36, 1)'
                  }}
                />
              </ActionIcon>
            </Tooltip>

            <Paper p="xs" radius="md" withBorder w="100%" style={{ backdropFilter: 'blur(8px)' }}>
              <Stack gap={4} align="center">
                <Avatar color="blue" radius="xl"><IconUser size="1rem" /></Avatar>
                <Text size="10px" fw={700} c="dimmed" ta="center" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {meDisplayName}
                </Text>
              </Stack>
            </Paper>
          </Stack>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main bg="var(--mantine-color-body)">
        <Container size="xl">
          <Modal
            opened={Boolean(selectedMetric)}
            onClose={() => setSelectedMetric(null)}
            title={selectedMetric ? metricModalTitle[selectedMetric] : "Metric"}
            centered
            size="lg"
          >
            {selectedMetric && (
              <Stack gap="sm">
                <Text size="sm" c="dimmed">{metricDescriptions[selectedMetric]}</Text>
                {selectedMetric === "training_status" && (
                  <Paper withBorder p="sm" radius="sm">
                    <Stack gap={4}>
                      <Text size="sm" fw={600}>All possible statuses</Text>
                      <Text size="sm"><b>Detraining</b>: very low recent and chronic load; fitness stimulus is likely insufficient.</Text>
                      <Text size="sm"><b>Maintaining</b>: minimal baseline load with stable low strain.</Text>
                      <Text size="sm"><b>Recovering</b>: acute load is well below chronic load ($ACWR &lt; 0.8$); useful after hard blocks.</Text>
                      <Text size="sm"><b>Productive</b>: balanced progression zone ($0.8 \le ACWR \le 1.3$); best range for consistent adaptation.</Text>
                      <Text size="sm"><b>Overreaching</b>: elevated short-term stress ($1.3 &lt; ACWR \le 1.5$); manageable if brief and planned.</Text>
                      <Text size="sm"><b>Strained</b>: excessive short-term stress ($ACWR &gt; 1.5$); higher fatigue/injury risk.</Text>
                    </Stack>
                  </Paper>
                )}
                <Title order={5}>History</Title>
                {selectedMetricChartData.length > 0 ? (
                  <>
                    <Box w="100%" h={280}>
                      <ResponsiveContainer>
                        <LineChart data={selectedMetricChartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="label" />
                          <YAxis />
                          <RechartsTooltip
                            labelFormatter={(value, payload) => {
                              const first = payload?.[0]?.payload as { date?: string } | undefined;
                              return first?.date || String(value);
                            }}
                          />
                          {selectedMetric === "aerobic_load" && <Legend />}
                          {selectedMetric === "anaerobic_load" && <Legend />}
                          {selectedMetric === "training_status" && <Legend />}

                          {(selectedMetric === "ftp" || selectedMetric === "max_hr" || selectedMetric === "weight") && (
                            <Line type="monotone" dataKey="value" stroke="#228be6" strokeWidth={2} dot={false} connectNulls />
                          )}

                          {selectedMetric === "aerobic_load" && (
                            <Line type="monotone" dataKey="aerobic" name="Aerobic" stroke="#12b886" strokeWidth={2} dot={false} />
                          )}

                          {selectedMetric === "anaerobic_load" && (
                            <Line type="monotone" dataKey="anaerobic" name="Anaerobic" stroke="#fa5252" strokeWidth={2} dot={false} />
                          )}

                          {selectedMetric === "training_status" && (
                            <>
                              <Line type="monotone" dataKey="acute" name="Acute load" stroke="#228be6" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="chronic" name="Chronic load" stroke="#9775fa" strokeWidth={2} dot={false} />
                            </>
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </Box>

                    <Table striped highlightOnHover verticalSpacing="xs">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Date</Table.Th>
                          <Table.Th>Value</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {selectedMetricRows.map((row) => (
                          <Table.Tr key={`${selectedMetric}-${row.date}`}>
                            <Table.Td>{row.date}</Table.Td>
                            <Table.Td>{row.value ?? "-"}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </>
                ) : (
                  <Text size="sm" c="dimmed">No history yet.</Text>
                )}
              </Stack>
            )}
          </Modal>
          {activeTab === "activities" ? (
            <ActivitiesView 
                athleteId={athleteIdNum} 
                currentUserRole={me.role} 
                athletes={athletesQuery.data || []}
            />
          ) : activeTab === "plan" ? (
            <TrainingCalendar 
               athleteId={athleteIdNum} 
               allAthletes={me.role === 'coach' && !athleteIdNum} 
               athletes={me.role === 'coach' ? (athletesQuery.data || []) : []}
              initialViewDate={calendarViewDate}
            />
          ) : activeTab === "settings" ? (
            <Stack maw={600}>
                <Title order={3}>Settings</Title>
                 <Paper withBorder p="md" radius="md">
                   <SettingsForm
                    user={me}
                    onSubmit={(data) => profileUpdateMutation.mutate(data)}
                    isSaving={profileUpdateMutation.isPending}
                    providers={integrationsQuery.data || []}
                    connectingProvider={connectingProvider}
                    disconnectingProvider={disconnectingProvider}
                    syncingProvider={syncingProvider}
                    onConnect={(provider) => connectIntegrationMutation.mutate(provider)}
                    onDisconnect={(provider) => disconnectIntegrationMutation.mutate(provider)}
                    onSync={(provider) => syncIntegrationMutation.mutate(provider)}
                   />
                 </Paper>
                {me.role === 'coach' && (
                  <Paper withBorder p="md" radius="md">
                    <Stack gap="sm">
                      <Title order={4}>Athlete Permissions</Title>
                      <Text size="sm" c="dimmed">Control whether each athlete can delete activities, edit workouts, and delete workouts.</Text>
                      {athletesQuery.data?.map((athlete) => {
                        const permissionRow = athletePermissionsQuery.data?.find((row) => row.athlete_id === athlete.id);
                        const permissions = permissionRow?.permissions || {
                          allow_delete_activities: false,
                          allow_delete_workouts: false,
                          allow_edit_workouts: false
                        };
                        const athleteName = (athlete.profile?.first_name || athlete.profile?.last_name)
                          ? `${athlete.profile?.first_name || ''} ${athlete.profile?.last_name || ''}`.trim()
                          : athlete.email;

                        const updateFlag = (key: keyof AthletePermissions['permissions'], checked: boolean) => {
                          updateAthletePermissionMutation.mutate({
                            athleteId: athlete.id,
                            permissions: {
                              ...permissions,
                              [key]: checked
                            }
                          });
                        };

                        return (
                          <Paper key={athlete.id} withBorder p="sm" radius="sm">
                            <Stack gap={6}>
                              <Text fw={600} size="sm">{athleteName}</Text>
                              <Switch
                                label="Allow delete activities"
                                checked={permissions.allow_delete_activities}
                                onChange={(event) => updateFlag('allow_delete_activities', event.currentTarget.checked)}
                              />
                              <Switch
                                label="Allow edit workouts"
                                checked={permissions.allow_edit_workouts}
                                onChange={(event) => updateFlag('allow_edit_workouts', event.currentTarget.checked)}
                              />
                              <Switch
                                label="Allow delete workouts"
                                checked={permissions.allow_delete_workouts}
                                onChange={(event) => updateFlag('allow_delete_workouts', event.currentTarget.checked)}
                              />
                            </Stack>
                          </Paper>
                        );
                      })}
                    </Stack>
                  </Paper>
                )}
                
            </Stack>
          ) : me.role === "coach" ? (
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 1, lg: 2 }}>
                <Paper withBorder p="md" radius="md" shadow="sm">
                  <Group justify="space-between" mb="xs">
                    <Group gap="xs">
                      <ThemeIcon color="red" variant="light" radius="xl"><IconAlertTriangle size={16} /></ThemeIcon>
                      <Title order={4}>Compliance Alerts</Title>
                    </Group>
                    <Badge color="red" variant="light">{complianceAlerts.length}</Badge>
                  </Group>
                  {complianceAlerts.length === 0 ? (
                    <Text size="sm" c="dimmed">No urgent compliance flags. Athletes are currently on track.</Text>
                  ) : (
                    <Stack gap={6}>
                      {complianceAlerts.map((row, index) => {
                        const athlete = (athletesQuery.data || []).find((item) => item.id === row.user_id);
                        const athleteName = athlete
                          ? ((athlete.profile?.first_name || athlete.profile?.last_name)
                            ? `${athlete.profile?.first_name || ''} ${athlete.profile?.last_name || ''}`.trim()
                            : athlete.email)
                          : "Athlete";
                        return (
                          <Paper key={`${row.id || index}-${row.date}`} withBorder p="xs" radius="sm">
                            <Group justify="space-between" align="flex-start" wrap="nowrap">
                              <Stack gap={0}>
                                <Text size="sm" fw={600}>{athleteName}</Text>
                                <Text size="xs" c="dimmed">{row.date} · {row.title}</Text>
                              </Stack>
                              <Badge color={row.compliance_status === "completed_red" || row.compliance_status === "missed" ? "red" : "yellow"}>
                                {row.compliance_status === "missed" ? "Missed" : row.compliance_status === "completed_red" ? "Critical" : row.is_planned ? "Overdue" : "Needs Review"}
                              </Badge>
                            </Group>
                          </Paper>
                        );
                      })}
                    </Stack>
                  )}
                </Paper>

                <Paper withBorder p="md" radius="md" shadow="sm">
                  <Group justify="space-between" mb="xs">
                    <Group gap="xs">
                      <ThemeIcon color="blue" variant="light" radius="xl"><IconMessageCircle size={16} /></ThemeIcon>
                      <Title order={4}>Coach-to-Athlete Loop</Title>
                    </Group>
                    <Badge variant="light" color="blue">24h</Badge>
                  </Group>
                  <Text size="sm" c="dimmed" mb="sm">Recent completed sessions waiting for coach acknowledgement.</Text>
                  {coachFeedbackRows.length === 0 ? (
                    <Text size="sm" c="dimmed">No new completed activities in the last 24 hours.</Text>
                  ) : (
                    <Stack gap={6}>
                      {coachFeedbackRows.map((row) => {
                        const athlete = (athletesQuery.data || []).find((item) => item.id === row.athlete_id);
                        const athleteName = athlete
                          ? ((athlete.profile?.first_name || athlete.profile?.last_name)
                            ? `${athlete.profile?.first_name || ''} ${athlete.profile?.last_name || ''}`.trim()
                            : athlete.email)
                          : "Athlete";
                        return (
                          <Group key={row.id} justify="space-between" wrap="nowrap">
                            <Stack gap={0}>
                              <Text size="sm" fw={600}>{athleteName}</Text>
                              <Text size="xs" c="dimmed">{row.sport || "activity"} · {new Date(row.created_at).toLocaleString()}</Text>
                            </Stack>
                            <Group gap={6}>
                              <Button size="compact-xs" variant="subtle">Approve</Button>
                              <Button size="compact-xs" variant="subtle">Adjust Next</Button>
                            </Group>
                          </Group>
                        );
                      })}
                    </Stack>
                  )}
                </Paper>
              </SimpleGrid>

            <Paper withBorder p="md" radius="md" shadow="sm">
              <Group justify="space-between" mb="xs">
                <div>
                  <Title order={4}>Invite Athlete</Title>
                  <Text c="dimmed" size="sm">
                    Generate a unique link to invite a new athlete to your team.
                  </Text>
                </div>
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={() => inviteMutation.mutate()}
                  loading={inviteMutation.isPending}
                >
                  Generate Link
                </Button>
              </Group>
              
              {inviteUrl && (
                <Paper bg="gray.1" p="sm" radius="sm" mt="md">
                  <Group justify="space-between">
                    <Text size="sm" ff="monospace" style={{ wordBreak: "break-all" }}>{inviteUrl}</Text>
                    <CopyButton value={inviteUrl}>
                      {({ copied, copy }) => (
                        <ActionIcon color={copied ? 'teal' : 'blue'} onClick={copy} variant="filled">
                          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        </ActionIcon>
                      )}
                    </CopyButton>
                  </Group>
                </Paper>
              )}
            </Paper>

            <Paper withBorder p="md" radius="md" shadow="sm">
              <Title order={4} mb="md">
                Your Athletes
              </Title>
              {athletesQuery.data && athletesQuery.data.length > 0 ? (
                <Table striped highlightOnHover verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Athlete</Table.Th>
                      <Table.Th>Threshold</Table.Th>
                      <Table.Th>Max HR (bpm)</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {athletesQuery.data.map((athlete) => (
                      <Table.Tr 
                        key={athlete.id} 
                        style={{ cursor: 'pointer' }} 
                        onClick={() => navigate(`/dashboard/athlete/${athlete.id}`)}
                      >
                        <Table.Td>
                           <Group gap="sm">
                             <Avatar color="blue" radius="xl">
                                {athlete.profile?.first_name ? athlete.profile.first_name[0].toUpperCase() : athlete.email[0].toUpperCase()}
                             </Avatar>
                             <Stack gap={0}>
                                 <Text size="sm" fw={500}>
                                    {(athlete.profile?.first_name || athlete.profile?.last_name) 
                                        ? `${athlete.profile.first_name || ''} ${athlete.profile.last_name || ''}`.trim() 
                                        : athlete.email}
                                 </Text>
                                 {(athlete.profile?.first_name || athlete.profile?.last_name) && (
                                     <Text size="xs" c="dimmed">{athlete.email}</Text>
                                 )}
                             </Stack>
                           </Group>
                        </Table.Td>
                        <Table.Td>
                            {(() => {
                                const p = athlete.profile;
                                if (p?.main_sport === 'running' && p.lt2) {
                                    const isImp = me.profile?.preferred_units === 'imperial';
                                    const val = isImp ? p.lt2 * 1.60934 : p.lt2;
                                    return (
                                        <Group gap={4}>
                                            <IconRun size={14} color="green" />
                                            <Text size="sm">{formatDuration(val)} {isImp ? '/mi' : '/km'}</Text>
                                        </Group>
                                    );
                                }
                                if (p?.ftp) {
                                    return (
                                        <Group gap={4}>
                                            <IconBolt size={14} color="orange" />
                                            <Text size="sm">{p.ftp} W</Text>
                                        </Group>
                                    );
                                }
                                if (p?.lt2) {
                                    const isImp = me.profile?.preferred_units === 'imperial';
                                    const val = isImp ? p.lt2 * 1.60934 : p.lt2;
                                    return (
                                        <Group gap={4}>
                                            <IconRun size={14} color="green" />
                                            <Text size="sm">{formatDuration(val)} {isImp ? '/mi' : '/km'}</Text>
                                        </Group>
                                    );
                                }
                                return <Text size="sm">-</Text>;
                            })()}
                        </Table.Td>
                        <Table.Td>
                            <Group gap={4}>
                                <IconHeart size={14} color="red" />
                                <Text size="sm">{athlete.profile?.max_hr ?? "-"}</Text>
                            </Group>
                        </Table.Td>
                        <Table.Td>
                          <ThemeIcon color="teal" size="xs" variant="light" radius="xl">
                             <IconCheck size={10} />
                          </ThemeIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Stack align="center" py="xl" c="dimmed">
                    <IconUsers size={48} stroke={1} />
                    <Text>No athletes found. Invite some athletes to get started.</Text>
                </Stack>
              )}
            </Paper>

            <CoachComparisonPanel athletes={athletesQuery.data || []} me={me as any} />
          </Stack>
        ) : (
          <Stack>
            <Paper withBorder p="lg" radius="md" shadow="sm" bg={isDark ? 'rgba(76, 201, 240, 0.08)' : 'cyan.0'}>
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Group gap="xs">
                    <ThemeIcon color="cyan" variant="light" radius="xl"><IconTargetArrow size={16} /></ThemeIcon>
                    <Text size="xs" tt="uppercase" fw={700} c="dimmed">Today’s Workout</Text>
                  </Group>
                  <Title order={3}>{todayWorkout?.title || 'No workout planned yet'}</Title>
                  <Text size="sm" c="dimmed">
                    {todayWorkout
                      ? `${todayWorkout.sport_type || 'Session'} · ${formatMinutesHm(todayWorkout.planned_duration)} · Stay smooth, not rushed.`
                      : 'Sync your device or ask your coach to schedule today’s session.'}
                  </Text>
                </Stack>
                <Group>
                  <Button variant="filled" onClick={() => setActiveTab('plan')}>{todayWorkout ? 'Open Plan' : 'Build Session'}</Button>
                </Group>
              </Group>
            </Paper>

            {integrationsQuery.data?.some((provider) => provider.last_error) && (
              <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                Sync needs attention, but your completed workouts are safe. Open Settings → Integrations to reconnect and continue.
              </Alert>
            )}

            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              {me.profile?.main_sport === 'running' ? (
                 <Card shadow="sm" radius="md" withBorder padding="lg">
                    <Group justify="space-between" mb="xs">
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>LT2</Text>
                        <IconRun size={20} color="green" />
                    </Group>
                    <Text fw={700} size="xl">
                        {me.profile?.lt2 
                            ? (me.profile.preferred_units === 'imperial' 
                                ? formatDuration(me.profile.lt2 * 1.60934) 
                                : formatDuration(me.profile.lt2)) 
                            : "-"}
                    </Text>
                    <Text size="xs" c="dimmed" mt="xs">{me.profile?.preferred_units === 'imperial' ? 'min/mi' : 'min/km'}</Text>
                  </Card>
              ) : (
                  <Card shadow="sm" radius="md" withBorder padding="lg" style={{ cursor: "pointer" }} onClick={() => setSelectedMetric("ftp")}>
                    <Group justify="space-between" mb="xs">
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>FTP</Text>
                        <IconBolt size={20} color="orange" />
                    </Group>
                      <Text fw={700} size="xl">{me.profile?.ftp ?? "-"}</Text>
                      <Text size="xs" c="dimmed" mt="xs">
                        Watts{wkgValue ? ` · ${wkgValue.toFixed(2)} W/kg` : ""}
                      </Text>
                  </Card>
              )}

              <Card shadow="sm" radius="md" withBorder padding="lg" style={{ cursor: "pointer" }} onClick={() => setSelectedMetric("max_hr")}>
                <Group justify="space-between" mb="xs">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Max Heart Rate</Text>
                      <IconHeart size={20} color="red" />
                </Group>
                <Text fw={700} size="xl">{me.profile?.max_hr ?? "-"}</Text>
                <Text size="xs" c="dimmed" mt="xs">BPM</Text>
              </Card>
              <Card shadow="sm" radius="md" withBorder padding="lg" style={{ cursor: "pointer" }} onClick={() => setSelectedMetric("weight")}>
                <Group justify="space-between" mb="xs">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Weight</Text>
                    <IconScale size={20} color="blue" />
                </Group>
                <Text fw={700} size="xl">{me.profile?.weight ?? "-"}</Text>
                <Text size="xs" c="dimmed" mt="xs">kg</Text>
              </Card>
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 3 }} mt="md">
              <Card shadow="sm" radius="md" withBorder padding="lg" style={{ cursor: "pointer" }} onClick={() => setSelectedMetric("aerobic_load")}>
                <Group justify="space-between" mb="xs">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Aerobic Load (7d)</Text>
                  <IconActivity size={20} color="teal" />
                </Group>
                <Text fw={700} size="xl">
                  {trainingStatusQuery.data ? trainingStatusQuery.data.acute.aerobic.toFixed(1) : '-'}
                </Text>
                <Text size="xs" c="dimmed" mt="xs">Load points</Text>
              </Card>

              <Card shadow="sm" radius="md" withBorder padding="lg" style={{ cursor: "pointer" }} onClick={() => setSelectedMetric("anaerobic_load")}>
                <Group justify="space-between" mb="xs">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Anaerobic Load (7d)</Text>
                  <IconBolt size={20} color="red" />
                </Group>
                <Text fw={700} size="xl">
                  {trainingStatusQuery.data ? trainingStatusQuery.data.acute.anaerobic.toFixed(1) : '-'}
                </Text>
                <Text size="xs" c="dimmed" mt="xs">Load points</Text>
              </Card>

              <Card shadow="sm" radius="md" withBorder padding="lg" style={{ cursor: "pointer" }} onClick={() => setSelectedMetric("training_status")}>
                <Group justify="space-between" mb="xs">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Training Status</Text>
                  <IconActivity size={20} color="blue" />
                </Group>
                <Text fw={700} size="xl">
                  {trainingStatusQuery.data?.training_status || '-'}
                </Text>
                <Text size="xs" c="dimmed" mt="xs">
                  Acute {trainingStatusQuery.data ? trainingStatusQuery.data.acute.daily_load.toFixed(1) : '-'} / Chronic {trainingStatusQuery.data ? trainingStatusQuery.data.chronic.daily_load.toFixed(1) : '-'}
                </Text>
              </Card>
            </SimpleGrid>

            {(wellnessSummaryQuery.data?.hrv || wellnessSummaryQuery.data?.resting_hr || wellnessSummaryQuery.data?.sleep || wellnessSummaryQuery.data?.stress) && (
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mt="md">
                {wellnessSummaryQuery.data?.hrv && (
                  <Card shadow="sm" radius="md" withBorder padding="lg">
                    <Group justify="space-between" mb="xs">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>HRV</Text>
                      <IconHeart size={20} color="violet" />
                    </Group>
                    <Text fw={700} size="xl">{wellnessSummaryQuery.data.hrv.value}</Text>
                    <Text size="xs" c="dimmed" mt="xs">{`${wellnessSummaryQuery.data.hrv.provider} · ${wellnessSummaryQuery.data.hrv.date}`}</Text>
                  </Card>
                )}

                {wellnessSummaryQuery.data?.resting_hr && (
                  <Card shadow="sm" radius="md" withBorder padding="lg">
                    <Group justify="space-between" mb="xs">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Resting HR</Text>
                      <IconHeart size={20} color="red" />
                    </Group>
                    <Text fw={700} size="xl">{wellnessSummaryQuery.data.resting_hr.value}</Text>
                    <Text size="xs" c="dimmed" mt="xs">{`${wellnessSummaryQuery.data.resting_hr.provider} · ${wellnessSummaryQuery.data.resting_hr.date}`}</Text>
                  </Card>
                )}

                {wellnessSummaryQuery.data?.sleep && (
                  <Card shadow="sm" radius="md" withBorder padding="lg">
                    <Group justify="space-between" mb="xs">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Sleep</Text>
                      <IconMoon size={20} color="indigo" />
                    </Group>
                    <Text fw={700} size="xl">{`${(wellnessSummaryQuery.data.sleep.duration_seconds / 3600).toFixed(1)} h`}</Text>
                    <Text size="xs" c="dimmed" mt="xs">{`${wellnessSummaryQuery.data.sleep.provider} · ${new Date(wellnessSummaryQuery.data.sleep.end_time).toLocaleDateString()}`}</Text>
                  </Card>
                )}

                {wellnessSummaryQuery.data?.stress && (
                  <Card shadow="sm" radius="md" withBorder padding="lg">
                    <Group justify="space-between" mb="xs">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Stress</Text>
                      <IconBolt size={20} color="orange" />
                    </Group>
                    <Text fw={700} size="xl">{wellnessSummaryQuery.data.stress.value}</Text>
                    <Text size="xs" c="dimmed" mt="xs">{`${wellnessSummaryQuery.data.stress.provider} · ${wellnessSummaryQuery.data.stress.date}`}</Text>
                  </Card>
                )}
              </SimpleGrid>
            )}

            <Paper shadow="sm" p="lg" radius="md" withBorder mt="md">
              <Title order={4} mb="md">My Profile</Title>
              <Text size="sm" c="dimmed">Training zones and history analysis enabled in next update.</Text>
            </Paper>
          </Stack>
        )}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
};

export default Dashboard;

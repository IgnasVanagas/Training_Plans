import { useEffect, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  MultiSelect,
  NumberInput,
  PasswordInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  useComputedColorScheme,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { IntegrationsPanel } from "../IntegrationsPanel";
import {
  getStravaImportPreferences,
  setStravaImportPreferences,
  type ProviderStatus,
  type StravaImportPreferences,
} from "../../api/integrations";

type Profile = {
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | Date | null;
  hrv_ms?: number | null;
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

type User = {
  id: number;
  email: string;
  email_verified?: boolean;
  role: "coach" | "athlete" | "admin";
  profile?: Profile | null;
};

type SettingsFormProps = {
  user: User;
  onSubmit: (data: Profile) => void;
  isSaving: boolean;
  providers?: ProviderStatus[];
  connectingProvider?: string | null;
  disconnectingProvider?: string | null;
  syncingProvider?: string | null;
  cancelingProvider?: string | null;
  onConnect?: (p: string) => void;
  onDisconnect?: (p: string) => void;
  onSync?: (p: string) => void;
  onCancelSync?: (p: string) => void;
  requestingEmailConfirmation?: boolean;
  changingPassword?: boolean;
  onRequestEmailConfirmation?: () => void;
  onChangePassword?: (payload: { current_password: string; new_password: string }) => void;
};

const getSupportedTimeZones = (): string[] => {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  return intlWithSupportedValues.supportedValuesOf?.("timeZone") ?? [Intl.DateTimeFormat().resolvedOptions().timeZone];
};

const SettingsForm = ({ user, onSubmit, isSaving, providers, connectingProvider, disconnectingProvider, syncingProvider, cancelingProvider, onConnect, onDisconnect, onSync, onCancelSync, requestingEmailConfirmation, changingPassword, onRequestEmailConfirmation, onChangePassword }: SettingsFormProps) => {
  const isDark = useComputedColorScheme("light") === "dark";
  const isMobile = useMediaQuery("(max-width: 48em)");
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
  const [stravaImportPrefs, setStravaImportPrefs] = useState<StravaImportPreferences | null>(null);
  const [stravaPrefsLoading, setStravaPrefsLoading] = useState(false);
  const [stravaPrefsSaving, setStravaPrefsSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (zoneSport === 'running' && zoneMetric === 'power') {
      setZoneMetric('hr');
    }
    if (zoneSport === 'cycling' && zoneMetric === 'pace') {
      setZoneMetric('power');
    }
  }, [zoneSport, zoneMetric]);

  const stravaProvider = (providers || []).find((provider) => provider.provider === 'strava');
  const stravaConnected = stravaProvider?.connection_status === 'connected';

  useEffect(() => {
    let active = true;
    if (!stravaConnected) {
      setStravaImportPrefs(null);
      return;
    }

    setStravaPrefsLoading(true);
    void getStravaImportPreferences()
      .then((prefs) => {
        if (!active) return;
        setStravaImportPrefs(prefs);
      })
      .catch(() => {
        if (!active) return;
        setStravaImportPrefs(null);
      })
      .finally(() => {
        if (!active) return;
        setStravaPrefsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [stravaConnected]);
  
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
    return 6;
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
    <Tabs
      defaultValue="general"
      orientation={isMobile ? "horizontal" : "vertical"}
      styles={{ root: { width: "100%", alignItems: "stretch" }, panel: { width: "100%", flex: 1 } }}
    >
      <Tabs.List
        style={{
          minWidth: isMobile ? 0 : 220,
          borderRight: isMobile ? "none" : `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-gray-3)"}`,
          borderBottom: isMobile ? `1px solid ${isDark ? "var(--mantine-color-dark-4)" : "var(--mantine-color-gray-3)"}` : "none",
          overflowX: isMobile ? "auto" : "visible",
          flexWrap: isMobile ? "nowrap" : "wrap",
        }}
      >
            <Tabs.Tab value="general">Profile</Tabs.Tab>
            <Tabs.Tab value="preferences">Preferences</Tabs.Tab>
            <Tabs.Tab value="athletic">Athletic</Tabs.Tab>
          <Tabs.Tab value="zones">Custom Zones</Tabs.Tab>
            <Tabs.Tab value="account">Account & Security</Tabs.Tab>
            <Tabs.Tab value="integrations">Integrations</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" pt="xs" pl={isMobile ? 0 : "md"}>
            <Paper p="md" radius="md" withBorder bg={isDark ? "dark.6" : "white"} w="100%">
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

        <Tabs.Panel value="preferences" pt="xs" pl={isMobile ? 0 : "md"}>
            <Paper p="md" radius="md" withBorder bg={isDark ? "dark.6" : "white"} w="100%">
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

        <Tabs.Panel value="athletic" pt="xs" pl={isMobile ? 0 : "md"}>
            <Paper p="md" radius="md" withBorder bg={isDark ? "dark.6" : "white"} w="100%">
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
                        label="HRV (ms)"
                        value={profile.hrv_ms ?? ''}
                        onChange={(val) => handleChange('hrv_ms', val)}
                        />
                        <NumberInput
                        label="RHR (bpm)"
                            value={profile.resting_hr ?? ''}
                            onChange={(val) => handleChange('resting_hr', val)}
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

        <Tabs.Panel value="zones" pt="xs" pl={isMobile ? 0 : "md"}>
            <Paper p="md" radius="md" withBorder bg={isDark ? "dark.6" : "white"} w="100%">
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
        const payload: Profile = { ...profile };
        (['hrv_ms', 'ftp', 'lt2', 'max_hr', 'resting_hr'] as const).forEach(key => {
          if (payload[key] == null) {
                (payload[key] as any) = null;
            }
        });

        if (payload.sports && Array.isArray(payload.sports)) {
          payload.sports = payload.sports.map(s => (typeof s === 'string' ? s.toLowerCase() : s));
          if (payload.sports.length === 0) payload.sports = null;
        }

        if (payload.main_sport && typeof payload.main_sport === 'string') {
          payload.main_sport = payload.main_sport.toLowerCase();
        } else {
          payload.main_sport = null;
        }
        
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

      <Tabs.Panel value="account" pt="xs" pl={isMobile ? 0 : "md"}>
        <Paper p="md" radius="md" withBorder bg={isDark ? "dark.6" : "white"} w="100%">
          <Stack>
            <Group justify="space-between" align="center">
              <div>
                <Text fw={600}>Email</Text>
                <Text size="sm" c="dimmed">{user.email}</Text>
              </div>
              <Badge color={user.email_verified ? "teal" : "orange"} variant="light">
                {user.email_verified ? "Verified" : "Unverified"}
              </Badge>
            </Group>

            {!user.email_verified && (
              <Alert color="yellow" title="Email confirmation recommended">
                Confirm your email to improve account recovery and security.
              </Alert>
            )}

            <Button
              variant="light"
              onClick={() => onRequestEmailConfirmation && onRequestEmailConfirmation()}
              loading={requestingEmailConfirmation}
              disabled={!onRequestEmailConfirmation}
            >
              Send verification email
            </Button>

            <Divider />

            <Text fw={600}>Change password</Text>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!currentPassword || !newPassword || !confirmPassword) {
                notifications.show({ color: "red", title: "Missing fields", message: "Fill in all password fields." });
                return;
              }
              if (newPassword !== confirmPassword) {
                notifications.show({ color: "red", title: "Passwords do not match", message: "Please confirm the same new password." });
                return;
              }
              if (!onChangePassword) {
                return;
              }
              onChangePassword({ current_password: currentPassword, new_password: newPassword });
              setCurrentPassword("");
              setNewPassword("");
              setConfirmPassword("");
            }}>
            <Stack>
            <PasswordInput
              label="Current password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.currentTarget.value)}
              autoComplete="current-password"
            />
            <PasswordInput
              label="New password"
              description="At least 10 characters with upper, lower, number, and symbol"
              value={newPassword}
              onChange={(event) => setNewPassword(event.currentTarget.value)}
              autoComplete="new-password"
            />
            <PasswordInput
              label="Confirm new password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              autoComplete="new-password"
            />
            <Group justify="flex-end">
              <Button
                type="submit"
                loading={changingPassword}
                disabled={!onChangePassword}
              >
                Update password
              </Button>
            </Group>
            </Stack>
            </form>
          </Stack>
        </Paper>
      </Tabs.Panel>

      <Tabs.Panel value="integrations" pt="xs" pl={isMobile ? 0 : "md"}>
        <Paper p="md" radius="md" withBorder bg={isDark ? "dark.6" : "white"} w="100%">
          <Switch
            mb="md"
            label="Automatic sync for connected services"
            description="Enabled by default. Disable to sync only when you press Sync now."
            checked={profile.auto_sync_integrations !== false}
            onChange={(event) => handleChange('auto_sync_integrations', event.currentTarget.checked)}
          />

          <Paper withBorder p="sm" radius="sm" mb="md">
            <Stack gap={6}>
              <Switch
                label="Strava detail backfill: import all-time history"
                description={
                  stravaImportPrefs
                    ? `When off, full-detail backfill focuses on the last ${stravaImportPrefs.default_window_days} days. Runs in background with daily API cap ${stravaImportPrefs.daily_request_limit}.`
                    : "Runs in background in small batches with request limits."
                }
                checked={Boolean(stravaImportPrefs?.import_all_time)}
                disabled={!stravaConnected || stravaPrefsLoading || stravaPrefsSaving}
                onChange={(event) => {
                  const next = event.currentTarget.checked;
                  setStravaPrefsSaving(true);
                  void setStravaImportPreferences({ import_all_time: next })
                    .then((prefs) => {
                      setStravaImportPrefs(prefs);
                      notifications.show({
                        color: 'teal',
                        title: 'Strava import preference saved',
                        message: next
                          ? 'All-time detail backfill enabled. Sync runs in background batches.'
                          : `Detail backfill set to last ${prefs.default_window_days} days.`,
                      });
                      if (onSync) {
                        onSync('strava');
                      }
                    })
                    .catch(() => {
                      notifications.show({
                        color: 'red',
                        title: 'Unable to save Strava preference',
                        message: 'Please try again.',
                      });
                    })
                    .finally(() => {
                      setStravaPrefsSaving(false);
                    });
                }}
              />
              {!stravaConnected && (
                <Text size="xs" c="dimmed">Connect Strava to configure detail backfill scope.</Text>
              )}
            </Stack>
          </Paper>

          <IntegrationsPanel
            providers={providers || []}
            connectingProvider={connectingProvider}
            disconnectingProvider={disconnectingProvider}
            cancelingProvider={cancelingProvider}
            syncingProvider={syncingProvider}
            onConnect={(p) => onConnect && onConnect(p)}
            onDisconnect={(p) => onDisconnect && onDisconnect(p)}
            onSync={(p) => onSync && onSync(p)}
            onCancelSync={(p) => onCancelSync && onCancelSync(p)}
          />
        </Paper>
      </Tabs.Panel>

    </Tabs>
  );
};

export default SettingsForm;

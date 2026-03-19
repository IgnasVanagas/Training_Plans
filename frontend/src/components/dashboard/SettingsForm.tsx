import { useEffect, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  MultiSelect,
  NavLink,
  NumberInput,
  PasswordInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  useComputedColorScheme,
} from "@mantine/core";
import {
  IconUser,
  IconAdjustments,
  IconHeartRateMonitor,
  IconChartBar,
  IconShieldLock,
  IconPlug,
} from "@tabler/icons-react";
import { DateInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import { IntegrationsPanel } from "../IntegrationsPanel";
import { useI18n } from "../../i18n/I18nProvider";
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
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState("general");
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

  const navItems = [
    { group: t('Your profile') || 'Your profile', items: [
      { value: 'general', label: t('Edit profile') || 'Edit profile', icon: IconUser },
      { value: 'preferences', label: t('Preferences') || 'Preferences', icon: IconAdjustments },
    ]},
    { group: t('Training') || 'Training', items: [
      { value: 'athletic', label: t('Athletic profile') || 'Athletic profile', icon: IconHeartRateMonitor },
      { value: 'zones', label: t('Custom Zones') || 'Custom Zones', icon: IconChartBar },
    ]},
    { group: t('Security & integrations') || 'Security & integrations', items: [
      { value: 'account', label: t('Account & Security') || 'Account & Security', icon: IconShieldLock },
      { value: 'integrations', label: t('Integrations') || 'Integrations', icon: IconPlug },
    ]},
  ];

  const panelBg = isDark ? "var(--mantine-color-dark-6)" : "white";

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <Stack>
            <Text fw={600} size="lg">{t('Edit profile') || 'Edit profile'}</Text>
            <Text size="sm" c="dimmed">{t('Manage your personal information.') || 'Manage your personal information.'}</Text>
            <Divider />
            <Group grow>
              <TextInput label={t('First Name') || 'First Name'} value={profile.first_name || ''} onChange={(e) => handleChange('first_name', e.currentTarget.value)} />
              <TextInput label={t('Last Name') || 'Last Name'} value={profile.last_name || ''} onChange={(e) => handleChange('last_name', e.currentTarget.value)} />
            </Group>
            <DateInput
              label={t('Date of Birth') || 'Date of Birth'}
              value={profile.birth_date as Date}
              onChange={(val) => handleChange('birth_date', val)}
              clearable
            />
            <Select
              label={t('Time Zone') || 'Time Zone'}
              placeholder={t('Select time zone') || 'Select time zone'}
              data={getSupportedTimeZones()}
              value={profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
              onChange={(val) => handleChange('timezone', val)}
              searchable
            />
          </Stack>
        );
      case 'preferences':
        return (
          <Stack>
            <Text fw={600} size="lg">{t('Preferences') || 'Preferences'}</Text>
            <Text size="sm" c="dimmed">{t('Customize your display and regional settings.') || 'Customize your display and regional settings.'}</Text>
            <Divider />
            <Select
              label={t('Preferred Units') || 'Preferred Units'}
              data={[{ value: 'metric', label: t('Metric (km, kg)') || 'Metric (km, kg)' }, { value: 'imperial', label: t('Imperial (miles, lbs)') || 'Imperial (miles, lbs)' }]}
              value={profile.preferred_units || 'metric'}
              onChange={(val) => handleChange('preferred_units', val)}
            />
            <Select
              label={t('Week Start Day') || 'Week Start Day'}
              data={[{ value: 'monday', label: t('Monday') || 'Monday' }, { value: 'sunday', label: t('Sunday') || 'Sunday' }]}
              value={profile.week_start_day || 'monday'}
              onChange={(val) => handleChange('week_start_day', val)}
            />
          </Stack>
        );
      case 'athletic':
        return (
          <Stack>
            <Text fw={600} size="lg">{t('Athletic profile') || 'Athletic profile'}</Text>
            <Text size="sm" c="dimmed">{t('Your sport and fitness metrics used for training zones and dashboard.') || 'Your sport and fitness metrics used for training zones and dashboard.'}</Text>
            <Divider />
            <MultiSelect
              label={t('Sports') || 'Sports'}
              placeholder={t('Select sports') || 'Select sports'}
              data={[t('Running') || 'Running', t('Cycling') || 'Cycling']}
              value={profile.sports || []}
              onChange={(val) => handleChange('sports', val)}
            />
            <Select
              label={t('Main Sport') || 'Main Sport'}
              placeholder={t('Select main sport') || 'Select main sport'}
              data={[t('Running') || 'Running', t('Cycling') || 'Cycling']}
              value={profile.main_sport || ''}
              onChange={(val) => handleChange('main_sport', val)}
              description={t('Determines which metrics are shown on the dashboard.') || 'Determines which metrics are shown on the dashboard.'}
            />
            <SimpleGrid cols={2}>
              <NumberInput label={t('HRV (ms)') || 'HRV (ms)'} value={profile.hrv_ms ?? ''} onChange={(val) => handleChange('hrv_ms', val)} />
              <NumberInput label={t('RHR (bpm)') || 'RHR (bpm)'} value={profile.resting_hr ?? ''} onChange={(val) => handleChange('resting_hr', val)} />
              <NumberInput label={t('FTP (Watts)') || 'FTP (Watts)'} value={profile.ftp ?? ''} onChange={(val) => handleChange('ftp', val)} />
            </SimpleGrid>
            <Stack gap={0}>
              <Text size="sm" fw={500} mt={3}>LT2 ({t('Pace') || 'Pace'})</Text>
              <Group grow>
                <NumberInput placeholder={t('Min') || 'Min'} min={2} max={59} value={lt2Minutes} onChange={(val) => handleLt2Change('min', val)} suffix="m" />
                <NumberInput placeholder={t('Sec') || 'Sec'} min={0} max={59} value={lt2Seconds} onChange={(val) => handleLt2Change('sec', val)} suffix="s" />
              </Group>
              <Text size="xs" c="dimmed">{t('Minutes : Seconds (min/km)') || 'Minutes : Seconds (min/km)'}</Text>
            </Stack>
          </Stack>
        );
      case 'zones':
        return (
          <Stack>
            <Text fw={600} size="lg">{t('Custom Zones') || 'Custom Zones'}</Text>
            <Text size="sm" c="dimmed">{t('Configure your training zone boundaries per sport and metric.') || 'Configure your training zone boundaries per sport and metric.'}</Text>
            <Divider />
            <Group grow>
              <Select
                label={t('Sport') || 'Sport'}
                data={[{ value: 'running', label: t('Running') || 'Running' }, { value: 'cycling', label: t('Cycling') || 'Cycling' }]}
                value={zoneSport}
                onChange={(value) => setZoneSport((value as 'running' | 'cycling') || 'running')}
                allowDeselect={false}
              />
              <Select
                label={t('Metric') || 'Metric'}
                data={zoneSport === 'running'
                  ? [{ value: 'hr', label: t('Heart Rate') || 'Heart Rate' }, { value: 'pace', label: t('Pace') || 'Pace' }]
                  : [{ value: 'hr', label: t('Heart Rate') || 'Heart Rate' }, { value: 'power', label: t('Power') || 'Power' }]}
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
            <Text size="sm" fw={500}>{t('Zone boundaries') || 'Zone boundaries'}</Text>
            <Text size="xs" c="dimmed">
              {zoneMetric === 'pace'
                ? t('Set each zone upper boundary in min/km (strictly increasing).') || 'Set each zone upper boundary in min/km (strictly increasing).'
                : t('Set each zone upper boundary (strictly increasing, no gaps/overlap).') || 'Set each zone upper boundary (strictly increasing, no gaps/overlap).'}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {zoneUpperBounds.map((bound, idx) => (
                <NumberInput
                  key={`zone-upper-${idx}`}
                  label={`Z${idx + 1} ${t('upper bound') || 'upper bound'}`}
                  value={bound}
                  decimalScale={zoneMetric === 'pace' ? 2 : 0}
                  onChange={(value) => setSingleUpperBound(idx, value)}
                />
              ))}
            </SimpleGrid>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {zoneMetric === 'pace'
                  ? `${t('Zones defined as') || 'Zones defined as'} Z1…Z${expectedUpperBoundCount + 1} ${t('from slow to fast pace.') || 'from slow to fast pace.'}`
                  : `${t('Zones defined as') || 'Zones defined as'} Z1…Z${expectedUpperBoundCount + 1} ${t('from low to high intensity.') || 'from low to high intensity.'}`}
              </Text>
              <Button variant="light" size="xs" onClick={applySuggestedUpperBounds}>{t('Auto-fill Suggested') || 'Auto-fill Suggested'}</Button>
            </Group>
          </Stack>
        );
      case 'account':
        return (
          <Stack>
            <Text fw={600} size="lg">{t('Account & Security') || 'Account & Security'}</Text>
            <Text size="sm" c="dimmed">{t('Manage your email verification and password.') || 'Manage your email verification and password.'}</Text>
            <Divider />

            <Group justify="space-between" align="center">
              <div>
                <Text fw={600}>{t('Email') || 'Email'}</Text>
                <Text size="sm" c="dimmed">{user.email}</Text>
              </div>
              <Badge color={user.email_verified ? "teal" : "orange"} variant="light">
                {user.email_verified ? (t('Verified') || 'Verified') : (t('Unverified') || 'Unverified')}
              </Badge>
            </Group>

            {!user.email_verified && (
              <Alert color="yellow" title={t('Email confirmation recommended') || 'Email confirmation recommended'}>
                {t('Confirm your email to improve account recovery and security.') || 'Confirm your email to improve account recovery and security.'}
              </Alert>
            )}

            <Button
              variant="light"
              onClick={() => onRequestEmailConfirmation && onRequestEmailConfirmation()}
              loading={requestingEmailConfirmation}
              disabled={!onRequestEmailConfirmation}
            >
              {t('Send verification email') || 'Send verification email'}
            </Button>

            <Divider />

            <Text fw={600}>{t('Change password') || 'Change password'}</Text>
            <form onSubmit={(e) => {
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
            }}>
              <Stack>
                <PasswordInput
                  label={t('Current password') || 'Current password'}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                  autoComplete="current-password"
                />
                <PasswordInput
                  label={t('New password') || 'New password'}
                  description={t('At least 10 characters with upper, lower, number, and symbol') || 'At least 10 characters with upper, lower, number, and symbol'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.currentTarget.value)}
                  autoComplete="new-password"
                />
                <PasswordInput
                  label={t('Confirm new password') || 'Confirm new password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                  autoComplete="new-password"
                />
                <Group justify="flex-end">
                  <Button type="submit" loading={changingPassword} disabled={!onChangePassword}>
                    {t('Update password') || 'Update password'}
                  </Button>
                </Group>
              </Stack>
            </form>
          </Stack>
        );
      case 'integrations':
        return (
          <Stack>
            <Text fw={600} size="lg">{t('Integrations') || 'Integrations'}</Text>
            <Text size="sm" c="dimmed">{t('Connect and manage external services.') || 'Connect and manage external services.'}</Text>
            <Divider />

            <Switch
              label={t('Automatic sync for connected services') || 'Automatic sync for connected services'}
              description={t('Enabled by default. Disable to sync only when you press Sync now.') || 'Enabled by default. Disable to sync only when you press Sync now.'}
              checked={profile.auto_sync_integrations !== false}
              onChange={(event) => handleChange('auto_sync_integrations', event.currentTarget.checked)}
            />

            <Paper withBorder p="sm" radius="sm">
              <Stack gap={6}>
                <Switch
                  label={t('Strava detail backfill: import all-time history') || 'Strava detail backfill: import all-time history'}
                  description={
                    stravaImportPrefs
                      ? `${t('When off, full-detail backfill focuses on the last') || 'When off, full-detail backfill focuses on the last'} ${stravaImportPrefs.default_window_days} ${t('days.') || 'days.'}`
                      : t('Runs in background in small batches with request limits.') || 'Runs in background in small batches with request limits.'
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
                          title: t('Strava import preference saved') || 'Strava import preference saved',
                          message: next
                            ? t('All-time detail backfill enabled. Sync runs in background batches.') || 'All-time detail backfill enabled. Sync runs in background batches.'
                            : `${t('Detail backfill set to last') || 'Detail backfill set to last'} ${prefs.default_window_days} ${t('days.') || 'days.'}`,
                        });
                        if (onSync) onSync('strava');
                      })
                      .catch(() => {
                        notifications.show({
                          color: 'red',
                          title: t('Unable to save Strava preference') || 'Unable to save Strava preference',
                          message: t('Please try again.') || 'Please try again.',
                        });
                      })
                      .finally(() => setStravaPrefsSaving(false));
                  }}
                />
                {!stravaConnected && (
                  <Text size="xs" c="dimmed">{t('Connect Strava to configure detail backfill scope.') || 'Connect Strava to configure detail backfill scope.'}</Text>
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
          </Stack>
        );
      default:
        return null;
    }
  };

  const handleSave = () => {
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
  };

  // Sidebar nav item style
  const navLinkStyles = {
    root: {
      borderRadius: 'var(--mantine-radius-md)',
      marginBottom: 2,
    },
  };

  if (isMobile) {
    // Mobile: horizontal scrollable chips at top, content below
    return (
      <Stack gap="md" w="100%">
        <ScrollArea type="never">
          <Group gap={4} wrap="nowrap">
            {navItems.flatMap((group) =>
              group.items.map((item) => (
                <Button
                  key={item.value}
                  variant={activeSection === item.value ? 'light' : 'subtle'}
                  color={activeSection === item.value ? 'orange' : 'gray'}
                  size="xs"
                  leftSection={<item.icon size={14} />}
                  onClick={() => setActiveSection(item.value)}
                  style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {item.label}
                </Button>
              ))
            )}
          </Group>
        </ScrollArea>

        <Paper p="md" radius="md" withBorder bg={panelBg} w="100%">
          {renderContent()}
        </Paper>

        <Group justify="flex-end">
          <Button onClick={handleSave} loading={isSaving} color="orange">{t('Save Changes') || 'Save Changes'}</Button>
        </Group>
      </Stack>
    );
  }

  // Desktop: Instagram-style sidebar + content
  return (
    <Group align="flex-start" gap={0} wrap="nowrap" w="100%" style={{ minHeight: 500 }}>
      {/* Sidebar */}
      <Box
        style={{
          width: 240,
          minWidth: 240,
          borderRight: `1px solid ${isDark ? 'var(--mantine-color-dark-4)' : 'var(--mantine-color-gray-3)'}`,
          paddingRight: 0,
        }}
      >
        <ScrollArea h="100%" offsetScrollbars={false}>
          <Stack gap={2} p="sm" pr="md">
            {navItems.map((group) => (
              <Box key={group.group}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6} mt={10} pl={12}>
                  {group.group}
                </Text>
                {group.items.map((item) => (
                  <NavLink
                    key={item.value}
                    label={item.label}
                    leftSection={<item.icon size={18} stroke={1.5} />}
                    active={activeSection === item.value}
                    onClick={() => setActiveSection(item.value)}
                    color="orange"
                    variant="light"
                    styles={navLinkStyles}
                  />
                ))}
              </Box>
            ))}
          </Stack>
        </ScrollArea>
      </Box>

      {/* Content */}
      <Box style={{ flex: 1, minWidth: 0 }} pl="lg" pr="sm" pt="sm">
        <Paper p="lg" radius="md" withBorder bg={panelBg}>
          {renderContent()}
        </Paper>
        <Group justify="flex-end" mt="md">
          <Button onClick={handleSave} loading={isSaving} color="orange">{t('Save Changes') || 'Save Changes'}</Button>
        </Group>
      </Box>
    </Group>
  );
};

export default SettingsForm;

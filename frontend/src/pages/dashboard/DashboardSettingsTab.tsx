import { ActionIcon, Divider, Group, Paper, Stack, Switch, Text, Title, useComputedColorScheme } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { CopyButton } from "@mantine/core";
import { buildPublicCalendarIcsUrl, buildPublicCalendarShareUrl } from "../../api/calendarCollaboration";
import { useI18n } from "../../i18n/I18nProvider";
import CoachAthleteZoneSettingsPanel from "../../components/dashboard/CoachAthleteZoneSettingsPanel";
import SettingsForm from "../../components/dashboard/SettingsForm";
import { AthletePermissions, CalendarShareSettings, Profile, User } from "./types";

type Props = {
  me: User;
  athletes: User[];
  permissionsRows: AthletePermissions[];
  shareSettingsRows: CalendarShareSettings[];
  isSavingProfile: boolean;
  onSaveProfile: (data: Profile) => void;
  requestingEmailConfirmation: boolean;
  changingPassword: boolean;
  onRequestEmailConfirmation: () => void;
  onChangePassword: (payload: { current_password: string; new_password: string }) => void;
  onUpdateAthletePermission: (athleteId: number, permissions: AthletePermissions["permissions"]) => void;
  onUpdateCalendarShare: (athleteId: number, payload: Partial<CalendarShareSettings>) => void;
  savingAthleteProfileId: number | null;
  onSaveAthleteProfile: (athleteId: number, profile: Profile) => void;
  initialAthleteId?: string | null;
  // kept for call-site compatibility
  providers?: unknown[];
  connectingProvider?: string | null;
  disconnectingProvider?: string | null;
  cancelingProvider?: string | null;
  syncingProvider?: string | null;
  onConnect?: (provider: string) => void;
  onDisconnect?: (provider: string) => void;
  onSync?: (provider: string) => void;
  onCancelSync?: (provider: string) => void;
  initialSection?: string;
};

const DashboardSettingsTab = ({
  me,
  athletes,
  permissionsRows,
  shareSettingsRows,
  isSavingProfile,
  onSaveProfile,
  requestingEmailConfirmation,
  changingPassword,
  onRequestEmailConfirmation,
  onChangePassword,
  onUpdateAthletePermission,
  onUpdateCalendarShare,
  savingAthleteProfileId,
  onSaveAthleteProfile,
  initialAthleteId,
}: Props) => {
  const isDark = useComputedColorScheme("light") === "dark";
  const { t } = useI18n();
  const panelStyle = {
    borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)",
    background: isDark ? "var(--mantine-color-dark-7)" : "rgba(255,255,255,0.9)",
    fontFamily: '"Inter", sans-serif',
  } as const;
  const currentYear = new Date().getFullYear();

  const showingAthleteSettings = !!(me.role === "coach" && initialAthleteId);

  return (
    <Stack w="100%">
      {!showingAthleteSettings && (
        <SettingsForm
          user={me}
          onSubmit={onSaveProfile}
          isSaving={isSavingProfile}
          requestingEmailConfirmation={requestingEmailConfirmation}
          changingPassword={changingPassword}
          onRequestEmailConfirmation={onRequestEmailConfirmation}
          onChangePassword={onChangePassword}
        />
      )}

      {me.role === "coach" && (
        <>
          <Paper withBorder p="md" radius="md" style={panelStyle}>
            <Stack gap="sm">
              <Title order={4}>{t('Athlete Permissions') || 'Athlete Permissions'}</Title>
              <Text size="sm" c="dimmed">{t('Control whether each athlete can delete activities, edit plans, and delete plans.') || 'Control whether each athlete can delete activities, edit plans, and delete plans.'}</Text>
              {athletes.map((athlete) => {
                const permissionRow = permissionsRows.find((row) => row.athlete_id === athlete.id);
                const permissions = permissionRow?.permissions || {
                  allow_delete_activities: true,
                  allow_delete_workouts: true,
                  allow_edit_workouts: true,
                  allow_export_calendar: true,
                  allow_public_calendar_share: true,
                  require_workout_approval: false,
                };
                const shareSettings = shareSettingsRows.find((row) => row.athlete_id === athlete.id) || {
                  athlete_id: athlete.id,
                  enabled: false,
                  token: null,
                  include_completed: false,
                  include_descriptions: false,
                };
                const athleteName = (athlete.profile?.first_name || athlete.profile?.last_name)
                  ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
                  : athlete.email;

                const updateFlag = (key: keyof AthletePermissions["permissions"], checked: boolean) => {
                  onUpdateAthletePermission(athlete.id, {
                    ...permissions,
                    [key]: checked,
                  });
                };

                return (
                  <Paper
                    key={athlete.id}
                    withBorder
                    p="sm"
                    radius="sm"
                    style={{
                      borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.22)",
                      background: isDark ? "var(--mantine-color-dark-6)" : "rgba(248,250,252,0.9)",
                    }}
                  >
                    <Stack gap={6}>
                      <Text fw={600} size="sm">{athleteName}</Text>
                      <Switch
                        label={t('Allow delete activities') || 'Allow delete activities'}
                        checked={permissions.allow_delete_activities}
                        onChange={(event) => updateFlag("allow_delete_activities", event.currentTarget.checked)}
                      />
                      <Switch
                        label={t('Allow edit plans') || 'Allow edit plans'}
                        checked={permissions.allow_edit_workouts}
                        onChange={(event) => updateFlag("allow_edit_workouts", event.currentTarget.checked)}
                      />
                      <Switch
                        label={t('Allow delete plans') || 'Allow delete plans'}
                        checked={permissions.allow_delete_workouts}
                        onChange={(event) => updateFlag("allow_delete_workouts", event.currentTarget.checked)}
                      />
                      <Switch
                        label={t('Allow calendar export') || 'Allow calendar export'}
                        checked={permissions.allow_export_calendar}
                        onChange={(event) => updateFlag("allow_export_calendar", event.currentTarget.checked)}
                      />
                      <Switch
                        label={t('Allow public calendar sharing') || 'Allow public calendar sharing'}
                        checked={permissions.allow_public_calendar_share}
                        onChange={(event) => updateFlag("allow_public_calendar_share", event.currentTarget.checked)}
                      />
                      <Switch
                        label={t('Require coach approval for athlete workout changes') || 'Require coach approval for athlete workout changes'}
                        checked={permissions.require_workout_approval}
                        onChange={(event) => updateFlag("require_workout_approval", event.currentTarget.checked)}
                      />

                      <Divider my={4} />
                      <Text size="xs" c="dimmed">{t('Public calendar view') || 'Public calendar view'}</Text>
                      <Switch
                        label={t('Enable shared public calendar') || 'Enable shared public calendar'}
                        checked={shareSettings.enabled}
                        disabled={!permissions.allow_public_calendar_share}
                        onChange={(event) => onUpdateCalendarShare(athlete.id, {
                          ...shareSettings,
                          enabled: event.currentTarget.checked,
                        })}
                      />
                      <Switch
                        label={t('Include completed activities in public view') || 'Include completed activities in public view'}
                        checked={shareSettings.include_completed}
                        disabled={!shareSettings.enabled}
                        onChange={(event) => onUpdateCalendarShare(athlete.id, {
                          ...shareSettings,
                          include_completed: event.currentTarget.checked,
                        })}
                      />
                      <Switch
                        label={t('Include workout descriptions in public view') || 'Include workout descriptions in public view'}
                        checked={shareSettings.include_descriptions}
                        disabled={!shareSettings.enabled}
                        onChange={(event) => onUpdateCalendarShare(athlete.id, {
                          ...shareSettings,
                          include_descriptions: event.currentTarget.checked,
                        })}
                      />
                      {shareSettings.enabled && shareSettings.token ? (
                        <Stack gap={6}>
                          <Group justify="space-between" wrap="nowrap">
                            <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
                              {buildPublicCalendarShareUrl(shareSettings.token)}
                            </Text>
                            <CopyButton value={buildPublicCalendarShareUrl(shareSettings.token)}>
                              {({ copied, copy }) => (
                                <ActionIcon variant="light" color={copied ? "teal" : "blue"} onClick={copy}>
                                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                                </ActionIcon>
                              )}
                            </CopyButton>
                          </Group>
                          <Group justify="space-between" wrap="nowrap">
                            <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
                              {buildPublicCalendarIcsUrl(shareSettings.token, `${currentYear}-01-01`, `${currentYear}-12-31`)}
                            </Text>
                            <CopyButton value={buildPublicCalendarIcsUrl(shareSettings.token, `${currentYear}-01-01`, `${currentYear}-12-31`)}>
                              {({ copied, copy }) => (
                                <ActionIcon variant="light" color={copied ? "teal" : "blue"} onClick={copy}>
                                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                                </ActionIcon>
                              )}
                            </CopyButton>
                          </Group>
                        </Stack>
                      ) : null}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </Paper>

          <Paper withBorder p="md" radius="md" style={panelStyle}>
            <CoachAthleteZoneSettingsPanel
              athletes={athletes}
              savingAthleteId={savingAthleteProfileId}
              onSave={onSaveAthleteProfile}
              initialAthleteId={initialAthleteId}
            />
          </Paper>
        </>
      )}
    </Stack>
  );
};

export default DashboardSettingsTab;

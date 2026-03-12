import { Paper, Stack, Switch, Text, Title, useComputedColorScheme } from "@mantine/core";
import CoachAthleteZoneSettingsPanel from "../../components/dashboard/CoachAthleteZoneSettingsPanel";
import SettingsForm from "../../components/dashboard/SettingsForm";
import { AthletePermissions, Profile, User } from "./types";

type Props = {
  me: User;
  athletes: User[];
  permissionsRows: AthletePermissions[];
  isSavingProfile: boolean;
  onSaveProfile: (data: Profile) => void;
  providers: any[];
  connectingProvider: string | null;
  disconnectingProvider: string | null;
  cancelingProvider: string | null;
  syncingProvider: string | null;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  onSync: (provider: string) => void;
  onCancelSync: (provider: string) => void;
  requestingEmailConfirmation: boolean;
  changingPassword: boolean;
  onRequestEmailConfirmation: () => void;
  onChangePassword: (payload: { current_password: string; new_password: string }) => void;
  onUpdateAthletePermission: (athleteId: number, permissions: AthletePermissions["permissions"]) => void;
  savingAthleteProfileId: number | null;
  onSaveAthleteProfile: (athleteId: number, profile: Profile) => void;
};

const DashboardSettingsTab = ({
  me,
  athletes,
  permissionsRows,
  isSavingProfile,
  onSaveProfile,
  providers,
  connectingProvider,
  disconnectingProvider,
  cancelingProvider,
  syncingProvider,
  onConnect,
  onDisconnect,
  onSync,
  onCancelSync,
  requestingEmailConfirmation,
  changingPassword,
  onRequestEmailConfirmation,
  onChangePassword,
  onUpdateAthletePermission,
  savingAthleteProfileId,
  onSaveAthleteProfile,
}: Props) => {
  const isDark = useComputedColorScheme("light") === "dark";
  const panelStyle = {
    borderColor: isDark ? "var(--mantine-color-dark-4)" : "rgba(148,163,184,0.26)",
    background: isDark ? "var(--mantine-color-dark-7)" : "rgba(255,255,255,0.9)",
    fontFamily: '"Inter", sans-serif',
  } as const;

  return (
    <Stack w="100%">
      <Title order={3}>Settings</Title>
      <Paper withBorder p="md" radius="md" style={panelStyle}>
        <SettingsForm
          user={me}
          onSubmit={onSaveProfile}
          isSaving={isSavingProfile}
          providers={providers}
          connectingProvider={connectingProvider}
          disconnectingProvider={disconnectingProvider}
          cancelingProvider={cancelingProvider}
          syncingProvider={syncingProvider}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onSync={onSync}
          onCancelSync={onCancelSync}
          requestingEmailConfirmation={requestingEmailConfirmation}
          changingPassword={changingPassword}
          onRequestEmailConfirmation={onRequestEmailConfirmation}
          onChangePassword={onChangePassword}
        />
      </Paper>

      {me.role === "coach" && (
        <>
          <Paper withBorder p="md" radius="md" style={panelStyle}>
            <Stack gap="sm">
              <Title order={4}>Athlete Permissions</Title>
              <Text size="sm" c="dimmed">Control whether each athlete can delete activities, edit workouts, and delete workouts.</Text>
              {athletes.map((athlete) => {
                const permissionRow = permissionsRows.find((row) => row.athlete_id === athlete.id);
                const permissions = permissionRow?.permissions || {
                  allow_delete_activities: false,
                  allow_delete_workouts: false,
                  allow_edit_workouts: false,
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
                        label="Allow delete activities"
                        checked={permissions.allow_delete_activities}
                        onChange={(event) => updateFlag("allow_delete_activities", event.currentTarget.checked)}
                      />
                      <Switch
                        label="Allow edit workouts"
                        checked={permissions.allow_edit_workouts}
                        onChange={(event) => updateFlag("allow_edit_workouts", event.currentTarget.checked)}
                      />
                      <Switch
                        label="Allow delete workouts"
                        checked={permissions.allow_delete_workouts}
                        onChange={(event) => updateFlag("allow_delete_workouts", event.currentTarget.checked)}
                      />
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
            />
          </Paper>
        </>
      )}
    </Stack>
  );
};

export default DashboardSettingsTab;

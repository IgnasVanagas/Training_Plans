import { Paper, Stack, Switch, Text, Title } from "@mantine/core";
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
  syncingProvider: string | null;
  onConnect: (provider: string) => void;
  onDisconnect: (provider: string) => void;
  onSync: (provider: string) => void;
  onUpdateAthletePermission: (athleteId: number, permissions: AthletePermissions["permissions"]) => void;
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
  syncingProvider,
  onConnect,
  onDisconnect,
  onSync,
  onUpdateAthletePermission,
}: Props) => {
  const panelStyle = {
    borderColor: "rgba(148,163,184,0.26)",
    background: "rgba(255,255,255,0.9)",
    fontFamily: '"Inter", sans-serif',
  } as const;

  return (
    <Stack maw={600}>
      <Title order={3}>Settings</Title>
      <Paper withBorder p="md" radius="md" style={panelStyle}>
        <SettingsForm
          user={me}
          onSubmit={onSaveProfile}
          isSaving={isSavingProfile}
          providers={providers}
          connectingProvider={connectingProvider}
          disconnectingProvider={disconnectingProvider}
          syncingProvider={syncingProvider}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onSync={onSync}
        />
      </Paper>

      {me.role === "coach" && (
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
                <Paper key={athlete.id} withBorder p="sm" radius="sm" style={{ borderColor: "rgba(148,163,184,0.22)", background: "rgba(248,250,252,0.9)" }}>
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
      )}
    </Stack>
  );
};

export default DashboardSettingsTab;

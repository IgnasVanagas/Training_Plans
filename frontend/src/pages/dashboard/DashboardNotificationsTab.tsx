import { Badge, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { NotificationItem, User } from "./types";

type Props = {
  me: User;
  items: NotificationItem[];
  loading: boolean;
  onRefresh: () => void;
  onRespondInvitation: (organizationId: number, action: "accept" | "decline") => void;
  respondingInvitation: boolean;
};

const typeColor = (type: string) => {
  if (type === "message") return "blue";
  if (type === "athlete_workout") return "orange";
  if (type === "planned_workout") return "violet";
  if (type === "invitation") return "cyan";
  if (type === "acknowledgement") return "green";
  return "gray";
};

const DashboardNotificationsTab = ({ me, items, loading, onRefresh, onRespondInvitation, respondingInvitation }: Props) => {
  return (
    <Stack w="100%" gap="md">
      <Group justify="space-between" align="center">
        <div>
          <Title order={3}>Notifications</Title>
          <Text size="sm" c="dimmed">
            {me.role === "coach"
              ? "Athlete workouts, messages, and communication updates."
              : "New planned workouts, coach messages, and communication updates."}
          </Text>
        </div>
        <Button variant="light" onClick={onRefresh} loading={loading}>Refresh</Button>
      </Group>

      {items.length === 0 ? (
        <Paper withBorder p="md" radius="md">
          <Text c="dimmed">No notifications yet.</Text>
        </Paper>
      ) : (
        <Stack gap="sm">
          {items.map((item) => (
            <Paper key={item.id} withBorder p="md" radius="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={2} style={{ flex: 1 }}>
                  <Group gap="xs">
                    <Badge color={typeColor(item.type)} variant="light">{item.type.split("_").join(" ")}</Badge>
                    {item.status && <Badge variant="outline">{item.status}</Badge>}
                  </Group>
                  <Text fw={600}>{item.title}</Text>
                  <Text size="sm" c="dimmed">{item.message}</Text>
                  {item.type === "invitation" && item.status === "pending" && item.organization_id && me.role === "athlete" && (
                    <Group gap="xs" mt={6}>
                      <Button
                        size="xs"
                        variant="light"
                        loading={respondingInvitation}
                        onClick={() => onRespondInvitation(item.organization_id as number, "accept")}
                      >
                        Accept
                      </Button>
                      <Button
                        size="xs"
                        color="red"
                        variant="subtle"
                        loading={respondingInvitation}
                        onClick={() => onRespondInvitation(item.organization_id as number, "decline")}
                      >
                        Decline
                      </Button>
                    </Group>
                  )}
                </Stack>
                <Text size="xs" c="dimmed">{new Date(item.created_at).toLocaleString()}</Text>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

export default DashboardNotificationsTab;

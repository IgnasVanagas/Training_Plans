import { Badge, Button, Checkbox, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useState } from "react";
import { NotificationItem, User } from "./types";
import { useI18n } from "../../i18n/I18nProvider";

type Props = {
  me: User;
  items: NotificationItem[];
  loading: boolean;
  onRefresh: () => void;
  onRespondInvitation: (
    organizationId: number,
    action: "accept" | "decline",
    athleteDataSharingConsent?: boolean,
  ) => void;
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
  const { t } = useI18n();
  const [consentByOrganization, setConsentByOrganization] = useState<Record<number, boolean>>({});

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
                    <Stack gap={6} mt={6}>
                      <Checkbox
                        checked={Boolean(consentByOrganization[item.organization_id as number])}
                        onChange={(event) =>
                          setConsentByOrganization((prev) => ({
                            ...prev,
                            [item.organization_id as number]: event.currentTarget.checked,
                          }))
                        }
                        label={t("I confirm coach access to my Strava-derived training data for this organization.")}
                      />
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="light"
                          loading={respondingInvitation}
                          disabled={!consentByOrganization[item.organization_id as number]}
                          onClick={() =>
                            onRespondInvitation(
                              item.organization_id as number,
                              "accept",
                              Boolean(consentByOrganization[item.organization_id as number]),
                            )
                          }
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
                    </Stack>
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

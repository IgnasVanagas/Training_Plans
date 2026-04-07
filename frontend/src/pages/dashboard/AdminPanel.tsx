import { useState } from "react";
import {
  Badge,
  Box,
  Card,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconActivity,
  IconDatabase,
  IconFileSearch,
  IconShieldHalf,
  IconSearch,
  IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import {
  changeUserRole,
  getAdminAuditLogs,
  getAdminStats,
  getAdminUsers,
} from "../../api/admin";
import { extractApiErrorMessage } from "./utils";
import { QueryErrorAlert } from "../../components/common/QueryErrorAlert";

const ROLE_COLORS: Record<string, string> = {
  admin: "red",
  coach: "orange",
  athlete: "blue",
};

const STATUS_COLORS: Record<string, string> = {
  ok: "green",
  error: "red",
  warning: "orange",
  info: "blue",
};

type AdminTab = "admin-users" | "admin-logs" | "admin-health";

const TAB_MAP: Record<AdminTab, string> = {
  "admin-users": "users",
  "admin-logs": "logs",
  "admin-health": "health",
};

const TAB_MAP_REVERSE: Record<string, AdminTab> = {
  users: "admin-users",
  logs: "admin-logs",
  health: "admin-health",
};

type Props = {
  activeTab?: AdminTab;
  onTabChange?: (tab: AdminTab) => void;
};

export default function AdminPanel({ activeTab, onTabChange }: Props) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users", search, roleFilter],
    queryFn: () =>
      getAdminUsers({
        search: search || undefined,
        role: roleFilter || undefined,
        limit: 100,
      }),
  });

  const logsQuery = useQuery({
    queryKey: ["admin-audit-logs", providerFilter, statusFilter],
    queryFn: () =>
      getAdminAuditLogs({
        provider: providerFilter || undefined,
        status: statusFilter || undefined,
        limit: 100,
      }),
  });

  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: getAdminStats,
  });

  const roleChangeMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      changeUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      notifications.show({
        title: "Role updated",
        message: "User role changed successfully.",
        color: "green",
        position: "bottom-right",
      });
    },
    onError: (err) => {
      notifications.show({
        title: "Error",
        message: extractApiErrorMessage(err),
        color: "red",
        position: "bottom-right",
      });
    },
  });

  const stats = statsQuery.data;

  return (
    <Box maw={1200} mx="auto" py="md">
      <Stack gap="xs" mb="lg">
        <Title order={2}>Admin Panel</Title>
        <Text size="sm" c="dimmed">
          Manage users, review integration logs, and monitor system health.
        </Text>
      </Stack>

      <Tabs
        value={activeTab ? TAB_MAP[activeTab] : undefined}
        defaultValue="users"
        onChange={(val) => val && onTabChange?.(TAB_MAP_REVERSE[val])}
      >
        <Tabs.List mb="md">
          <Tabs.Tab value="users" leftSection={<IconUsers size={16} />}>
            Users
          </Tabs.Tab>
          <Tabs.Tab value="logs" leftSection={<IconFileSearch size={16} />}>
            Audit Logs
          </Tabs.Tab>
          <Tabs.Tab value="health" leftSection={<IconDatabase size={16} />}>
            System Health
          </Tabs.Tab>
        </Tabs.List>

        {/* ── USERS ─────────────────────────────────────────────────────── */}
        <Tabs.Panel value="users">
          <Stack gap="md">
            <Group>
              <TextInput
                placeholder="Search by email..."
                leftSection={<IconSearch size={14} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Select
                placeholder="All roles"
                clearable
                data={[
                  { value: "athlete", label: "Athlete" },
                  { value: "coach", label: "Coach" },
                  { value: "admin", label: "Admin" },
                ]}
                value={roleFilter}
                onChange={setRoleFilter}
                w={140}
              />
            </Group>

            {usersQuery.isLoading && <Loader />}
            {usersQuery.isError && <QueryErrorAlert error={usersQuery.error} onRetry={() => void usersQuery.refetch()} title="Failed to load users" />}
            {usersQuery.data && (
              <Table striped highlightOnHover withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>ID</Table.Th>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Email</Table.Th>
                    <Table.Th>Role</Table.Th>
                    <Table.Th>Verified</Table.Th>
                    <Table.Th>Activities</Table.Th>
                    <Table.Th>Change Role</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {usersQuery.data.map((user) => (
                    <Table.Tr key={user.id}>
                      <Table.Td>{user.id}</Table.Td>
                      <Table.Td>
                        {user.first_name || user.last_name
                          ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim()
                          : "—"}
                      </Table.Td>
                      <Table.Td>{user.email}</Table.Td>
                      <Table.Td>
                        <Badge
                          color={ROLE_COLORS[user.role] ?? "gray"}
                          variant="light"
                          size="sm"
                        >
                          {user.role}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={user.email_verified ? "green" : "red"}
                          variant="light"
                          size="sm"
                        >
                          {user.email_verified ? "Yes" : "No"}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{user.activity_count}</Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          value={user.role}
                          data={[
                            { value: "athlete", label: "Athlete" },
                            { value: "coach", label: "Coach" },
                            { value: "admin", label: "Admin" },
                          ]}
                          onChange={(val) =>
                            val &&
                            val !== user.role &&
                            roleChangeMutation.mutate({
                              userId: user.id,
                              role: val,
                            })
                          }
                          w={110}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {usersQuery.data.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <Text c="dimmed" ta="center" size="sm" py="md">
                          No users found.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ── AUDIT LOGS ────────────────────────────────────────────────── */}
        <Tabs.Panel value="logs">
          <Stack gap="md">
            <Group>
              <Select
                placeholder="All providers"
                clearable
                data={[
                  "strava",
                  "garmin",
                  "polar",
                  "whoop",
                  "google_fit",
                  "apple_health",
                ].map((p) => ({ value: p, label: p }))}
                value={providerFilter}
                onChange={setProviderFilter}
                w={160}
              />
              <Select
                placeholder="All statuses"
                clearable
                data={[
                  { value: "ok", label: "OK" },
                  { value: "error", label: "Error" },
                  { value: "warning", label: "Warning" },
                ]}
                value={statusFilter}
                onChange={setStatusFilter}
                w={140}
              />
            </Group>

            {logsQuery.isLoading && <Loader />}
            {logsQuery.isError && <QueryErrorAlert error={logsQuery.error} onRetry={() => void logsQuery.refetch()} title="Failed to load audit logs" />}
            {logsQuery.data && (
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Time</Table.Th>
                    <Table.Th>User</Table.Th>
                    <Table.Th>Provider</Table.Th>
                    <Table.Th>Action</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Message</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {logsQuery.data.map((log) => (
                    <Table.Tr key={log.id}>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {new Date(log.created_at).toLocaleString()}
                      </Table.Td>
                      <Table.Td>{log.user_email ?? log.user_id}</Table.Td>
                      <Table.Td>{log.provider}</Table.Td>
                      <Table.Td>{log.action}</Table.Td>
                      <Table.Td>
                        <Badge
                          color={STATUS_COLORS[log.status] ?? "gray"}
                          variant="light"
                          size="sm"
                        >
                          {log.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed" lineClamp={1} maw={320}>
                          {log.message ?? "—"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {logsQuery.data.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={6}>
                        <Text c="dimmed" ta="center" size="sm" py="md">
                          No audit logs found.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ── SYSTEM HEALTH ─────────────────────────────────────────────── */}
        <Tabs.Panel value="health">
          {statsQuery.isLoading && <Loader />}
          {statsQuery.isError && <QueryErrorAlert error={statsQuery.error} onRetry={() => void statsQuery.refetch()} title="Failed to load system health" />}
          {stats && (
            <Stack gap="md">
              <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
                <Card withBorder radius="md" p="lg">
                  <Group>
                    <ThemeIcon size={40} radius="md" color="blue" variant="light">
                      <IconUsers size={22} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text size="xl" fw={700}>{stats.users.athlete}</Text>
                      <Text size="xs" c="dimmed">Athletes</Text>
                    </Stack>
                  </Group>
                </Card>
                <Card withBorder radius="md" p="lg">
                  <Group>
                    <ThemeIcon size={40} radius="md" color="orange" variant="light">
                      <IconShieldHalf size={22} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text size="xl" fw={700}>{stats.users.coach}</Text>
                      <Text size="xs" c="dimmed">Coaches</Text>
                    </Stack>
                  </Group>
                </Card>
                <Card withBorder radius="md" p="lg">
                  <Group>
                    <ThemeIcon size={40} radius="md" color="red" variant="light">
                      <IconShieldHalf size={22} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text size="xl" fw={700}>{stats.users.admin}</Text>
                      <Text size="xs" c="dimmed">Admins</Text>
                    </Stack>
                  </Group>
                </Card>
                <Card withBorder radius="md" p="lg">
                  <Group>
                    <ThemeIcon size={40} radius="md" color="teal" variant="light">
                      <IconActivity size={22} />
                    </ThemeIcon>
                    <Stack gap={0}>
                      <Text size="xl" fw={700}>{stats.total_activities}</Text>
                      <Text size="xs" c="dimmed">Total Activities</Text>
                    </Stack>
                  </Group>
                </Card>
              </SimpleGrid>

              <Card withBorder radius="md" p="lg" maw={320}>
                <Group>
                  <ThemeIcon
                    size={40}
                    radius="md"
                    color={stats.db === "ok" ? "green" : "red"}
                    variant="light"
                  >
                    <IconDatabase size={22} />
                  </ThemeIcon>
                  <Stack gap={4}>
                    <Text fw={600}>Database</Text>
                    <Badge
                      color={stats.db === "ok" ? "green" : "red"}
                      variant="light"
                    >
                      {stats.db === "ok" ? "Healthy" : "Error"}
                    </Badge>
                  </Stack>
                </Group>
              </Card>
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}

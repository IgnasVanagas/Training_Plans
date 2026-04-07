import { useMemo, useState } from "react";
import {
  Badge,
  Card,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  useComputedColorScheme,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconTrophy, IconCalendarEvent, IconMapPin } from "@tabler/icons-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n/I18nProvider";
import { getPersonalRecords, type PersonalRecordsResponse } from "../../api/activities";
import { getLatestSeasonPlan, type PlannerGoalRace } from "../../api/planning";
import type { User } from "./types";
import { QueryErrorAlert } from "../../components/common/QueryErrorAlert";

type Props = {
  me: User;
  athleteId?: number | null;
};

const priorityColors: Record<string, string> = { A: "red", B: "orange", C: "blue" };

const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const formatPace = (seconds: number, meters: number): string => {
  if (!meters) return "";
  const paceSecsPerKm = (seconds / meters) * 1000;
  const m = Math.floor(paceSecsPerKm / 60);
  const s = Math.round(paceSecsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
};

const getMetersFromDistance = (dist: string): number => {
  const distMap: Record<string, number> = {
    "400m": 400, "800m": 800, "1km": 1000, "1mi": 1609, "1.5mi": 2414,
    "2km": 2000, "5km": 5000, "5mi": 8047, "10km": 10000, "10mi": 16094,
    "15km": 15000, "Half Marathon": 21097, "20mi": 32187,
    "Marathon": 42195, "50km": 50000, "50mi": 80467, "100km": 100000, "100mi": 160934,
    "160km": 160000, "200km": 200000, "250km": 250000, "320km": 320000,
  };
  return distMap[dist] || 0;
};

const medalColor = (rank: number): string => {
  if (rank === 1) return "#f0a500";
  if (rank === 2) return "#a0a0a0";
  return "#cd7f32";
};

/** Parse a window label like "5s", "1min", "120min" into seconds for sorting */
const windowToSeconds = (w: string): number => {
  const m = w.match(/^(\d+)(s|min)$/);
  if (!m) return 0;
  return Number(m[1]) * (m[2] === "min" ? 60 : 1);
};

const sortedWindowKeys = (keys: string[]): string[] =>
  [...keys].sort((a, b) => windowToSeconds(a) - windowToSeconds(b));

const sortedDistanceKeys = (keys: string[]): string[] =>
  [...keys].sort((a, b) => getMetersFromDistance(a) - getMetersFromDistance(b));

const DashboardRacesRecordsTab = ({ me, athleteId }: Props) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isDark = useComputedColorScheme("light") === "dark";
  const [prSport, setPrSport] = useState<string>(
    me.profile?.main_sport === "running" ? "running" : "cycling",
  );

  const seasonPlanQuery = useQuery({
    queryKey: ["season-plan", athleteId],
    queryFn: () => getLatestSeasonPlan(athleteId),
  });

  const prsQuery = useQuery({
    queryKey: ["personal-records", prSport, athleteId],
    queryFn: () => getPersonalRecords(prSport, athleteId),
    refetchInterval: (query) => {
      const data = query.state.data as PersonalRecordsResponse | undefined;
      return data?.backfill_status === "processing" ? 5000 : false;
    },
  });

  const races: PlannerGoalRace[] = useMemo(() => {
    const plan = seasonPlanQuery.data;
    if (!plan?.goal_races) return [];
    return [...plan.goal_races].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }, [seasonPlanQuery.data]);

  const upcomingRaces = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    return races.filter((r) => r.date >= now);
  }, [races]);

  const pastRaces = useMemo(() => {
    const now = new Date().toISOString().slice(0, 10);
    return races.filter((r) => r.date < now);
  }, [races]);

  const hasAnyPersonalRecords = useMemo(() => {
    const data = prsQuery.data;
    if (!data) return false;
    if (data.sport === "cycling") {
      return Boolean(
        (data.power && Object.keys(data.power).length > 0) ||
        (data.best_efforts && Object.keys(data.best_efforts).length > 0)
      );
    }
    if (data.sport === "running") {
      return Boolean(data.best_efforts && Object.keys(data.best_efforts).length > 0);
    }
    return false;
  }, [prsQuery.data]);

  const renderPRsTable = (data: PersonalRecordsResponse | undefined) => {
    if (!data) return null;

    const renderEmptyState = () => {
      if (data.has_activities_for_sport === false) {
        return <Text c="dimmed" size="sm">{t("No activities yet for this sport")}</Text>;
      }
      if (data.backfill_status === "processing" || ((data.missing_best_efforts_count ?? 0) > 0 && data.has_activities_for_sport)) {
        return <Text c="dimmed" size="sm">{t("Processing personal records from your activities...")}</Text>;
      }
      return <Text c="dimmed" size="sm">{t("No personal records yet")}</Text>;
    };

    if (data.sport === "cycling") {
      const windows = data.power ? sortedWindowKeys(Object.keys(data.power)) : [];
      const distances = data.best_efforts ? sortedDistanceKeys(Object.keys(data.best_efforts)) : [];
      if (!windows.length && !distances.length)
        return renderEmptyState();
      const weight = me.profile?.weight;
      return (
        <Stack gap="md">
          {windows.length > 0 && (
            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("Window")}</Table.Th>
                  <Table.Th>{t("Power (W)")}</Table.Th>
                  {weight && <Table.Th>W/kg</Table.Th>}
                  <Table.Th>{t("Heart Rate")}</Table.Th>
                  <Table.Th>{t("Date")}</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {windows.map((window) => {
                  const entry = data.power![window][0];
                  if (!entry) return null;
                  return (
                    <Table.Tr
                      key={window}
                      style={{ cursor: entry.activity_id ? "pointer" : "default" }}
                      onClick={() => {
                        if (!entry.activity_id) return;
                        navigate(`/dashboard/activities/${entry.activity_id}`, {
                          state: {
                            focusEffort: { type: "window", key: window },
                          },
                        });
                      }}
                    >
                      <Table.Td fw={600}>{window}</Table.Td>
                      <Table.Td>{entry.value}W</Table.Td>
                      {weight && <Table.Td>{(entry.value / weight).toFixed(2)}</Table.Td>}
                      <Table.Td>{entry.avg_hr ? `${entry.avg_hr} bpm` : "—"}</Table.Td>
                      <Table.Td>{entry.date ? new Date(entry.date).toLocaleDateString() : "—"}</Table.Td>
                      <Table.Td>
                        <IconTrophy size={16} color={medalColor(1)} />
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
          {windows.length > 0 && (() => {
            const curveData = windows
              .map((w) => {
                const entry = data.power![w]?.[0];
                return entry ? { label: w, seconds: windowToSeconds(w), power: entry.value } : null;
              })
              .filter(Boolean) as { label: string; seconds: number; power: number }[];
            if (curveData.length < 2) return null;
            return (
              <>
                <Title order={5}>{t("Power Curve")}</Title>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={curveData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: isDark ? "#94A3B8" : "#64748B" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: isDark ? "#94A3B8" : "#64748B" }}
                      tickLine={false}
                      axisLine={false}
                      unit="W"
                      width={52}
                    />
                    <Tooltip
                      contentStyle={{
                        background: isDark ? "#1E293B" : "#FFFFFF",
                        border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [`${value}W`, t("Power (W)")]}
                    />
                    {weight && (
                      <ReferenceLine
                        y={weight * 4}
                        stroke={isDark ? "#94A3B8" : "#64748B"}
                        strokeDasharray="4 4"
                        label={{ value: "4 W/kg", position: "insideTopRight", fontSize: 10, fill: isDark ? "#94A3B8" : "#64748B" }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="power"
                      stroke="#3B82F6"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#3B82F6" }}
                      activeDot={{ r: 5, stroke: "#3B82F6", strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </>
            );
          })()}
          {distances.length > 0 && (
            <>
              <Title order={5}>{t("Distance Records")}</Title>
              <Table striped highlightOnHover withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("Distance")}</Table.Th>
                    <Table.Th>{t("Time")}</Table.Th>
                    <Table.Th>{t("Speed")}</Table.Th>
                    <Table.Th>{t("Heart Rate")}</Table.Th>
                    <Table.Th>{t("Date")}</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {distances.map((dist) => {
                    const entry = data.best_efforts![dist][0];
                    if (!entry) return null;
                    const meters = getMetersFromDistance(dist);
                    const speedKmh = meters && entry.value > 0 ? (meters / 1000) / (entry.value / 3600) : 0;
                    return (
                      <Table.Tr
                        key={dist}
                        style={{ cursor: entry.activity_id ? "pointer" : "default" }}
                        onClick={() => {
                          if (!entry.activity_id) return;
                          navigate(`/dashboard/activities/${entry.activity_id}`, {
                            state: {
                              focusEffort: { type: "distance", key: dist },
                            },
                          });
                        }}
                      >
                        <Table.Td fw={600}>{dist}</Table.Td>
                        <Table.Td>{formatTime(entry.value)}</Table.Td>
                        <Table.Td>{speedKmh > 0 ? `${speedKmh.toFixed(1)} km/h` : "—"}</Table.Td>
                        <Table.Td>{entry.avg_hr ? `${entry.avg_hr} bpm` : "—"}</Table.Td>
                        <Table.Td>{entry.date ? new Date(entry.date).toLocaleDateString() : "—"}</Table.Td>
                        <Table.Td>
                          <IconTrophy size={16} color={medalColor(1)} />
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </>
          )}
        </Stack>
      );
    }

    if (data.sport === "running" && data.best_efforts) {
      const distances = sortedDistanceKeys(Object.keys(data.best_efforts));
      if (!distances.length)
        return renderEmptyState();
      return (
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("Distance")}</Table.Th>
              <Table.Th>{t("Time")}</Table.Th>
              <Table.Th>{t("Pace")}</Table.Th>
              <Table.Th>{t("Heart Rate")}</Table.Th>
              <Table.Th>{t("Date")}</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {distances.map((dist) => {
              const entry = data.best_efforts![dist][0];
              if (!entry) return null;
              const meters = getMetersFromDistance(dist);
              return (
                <Table.Tr
                  key={dist}
                  style={{ cursor: entry.activity_id ? "pointer" : "default" }}
                  onClick={() => {
                    if (!entry.activity_id) return;
                    navigate(`/dashboard/activities/${entry.activity_id}`, {
                      state: {
                        focusEffort: { type: "distance", key: dist },
                      },
                    });
                  }}
                >
                  <Table.Td fw={600}>{dist}</Table.Td>
                  <Table.Td>{formatTime(entry.value)}</Table.Td>
                  <Table.Td>{formatPace(entry.value, meters)}</Table.Td>
                  <Table.Td>{entry.avg_hr ? `${entry.avg_hr} bpm` : "—"}</Table.Td>
                  <Table.Td>{entry.date ? new Date(entry.date).toLocaleDateString() : "—"}</Table.Td>
                  <Table.Td>
                    <IconTrophy size={16} color={medalColor(1)} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      );
    }

    return renderEmptyState();
  };

  const renderRaceCard = (race: PlannerGoalRace, isPast: boolean) => (
    <Card
      key={`${race.name}-${race.date}`}
      shadow="xs"
      radius="md"
      padding="md"
      withBorder
      style={{
        opacity: isPast ? 0.7 : 1,
        borderLeft: `4px solid var(--mantine-color-${priorityColors[race.priority] || "gray"}-5)`,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Badge color={priorityColors[race.priority] || "gray"} variant="filled" size="sm">
            {race.priority}
          </Badge>
          <Text fw={600} size="sm" lineClamp={1}>
            {race.name}
          </Text>
        </Group>
        {race.sport_type && (
          <Badge variant="light" size="xs" color="gray">
            {race.sport_type}
          </Badge>
        )}
      </Group>
      <Group gap="xs" mt={6}>
        <IconCalendarEvent size={14} color={isDark ? "#94A3B8" : "#64748B"} />
        <Text size="xs" c="dimmed">
          {new Date(race.date).toLocaleDateString(undefined, {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </Text>
      </Group>
      <Group gap="xs" mt={2}>
        {race.distance_km && (
          <Text size="xs" c="dimmed">
            {race.distance_km} km
          </Text>
        )}
        {race.expected_time && (
          <Text size="xs" c="dimmed">
            · {race.expected_time}
          </Text>
        )}
        {race.location && (
          <Group gap={4}>
            <IconMapPin size={12} color={isDark ? "#94A3B8" : "#64748B"} />
            <Text size="xs" c="dimmed">
              {race.location}
            </Text>
          </Group>
        )}
      </Group>
    </Card>
  );

  return (
    <Stack gap="lg">
      {/* Races Section */}
      <Stack gap="sm">
        <Title order={4}>{t("Races")}</Title>

        {seasonPlanQuery.isLoading ? (
          <Loader size="sm" />
        ) : seasonPlanQuery.isError ? (
          <QueryErrorAlert error={seasonPlanQuery.error} onRetry={() => void seasonPlanQuery.refetch()} title="Failed to load season plan" />
        ) : races.length === 0 ? (
          <Text c="dimmed" size="sm">
            {t("No races configured")}
          </Text>
        ) : (
          <>
            {upcomingRaces.length > 0 && (
              <Stack gap="xs">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                  {t("Upcoming")}
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                  {upcomingRaces.map((r) => renderRaceCard(r, false))}
                </SimpleGrid>
              </Stack>
            )}
            {pastRaces.length > 0 && (
              <Stack gap="xs" mt="sm">
                <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                  {t("Past")}
                </Text>
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
                  {pastRaces.map((r) => renderRaceCard(r, true))}
                </SimpleGrid>
              </Stack>
            )}
          </>
        )}
      </Stack>

      {/* Personal Records Section */}
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Title order={4}>{t("Personal Records")}</Title>
          <SegmentedControl
            size="xs"
            radius="md"
            value={prSport}
            onChange={setPrSport}
            data={[
              { value: "cycling", label: t("Cycling") },
              { value: "running", label: t("Running") },
            ]}
          />
        </Group>

        {prsQuery.isLoading ? (
          <Loader size="sm" />
        ) : prsQuery.isError ? (
          <QueryErrorAlert error={prsQuery.error} onRetry={() => void prsQuery.refetch()} title="Failed to load personal records" />
        ) : (
          renderPRsTable(prsQuery.data ?? undefined)
        )}

        {hasAnyPersonalRecords ? (
          <Group gap="xs" mt={4}>
            <IconTrophy size={14} color="#f0a500" />
            <Text size="xs" c="dimmed">{t("PR")}</Text>
          </Group>
        ) : null}
      </Stack>
    </Stack>
  );
};

export default DashboardRacesRecordsTab;

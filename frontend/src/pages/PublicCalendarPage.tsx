import { useMemo, useState } from "react";
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { ActionIcon, Badge, Container, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconWorld } from "@tabler/icons-react";
import { getPublicCalendar } from "../api/calendarCollaboration";
import { useI18n } from "../i18n/I18nProvider";

const PublicCalendarPage = () => {
  const { t } = useI18n();
  const { token } = useParams();
  const [anchorDate, setAnchorDate] = useState(() => startOfMonth(new Date()));

  const startDate = useMemo(() => format(startOfMonth(anchorDate), "yyyy-MM-dd"), [anchorDate]);
  const endDate = useMemo(() => format(endOfMonth(anchorDate), "yyyy-MM-dd"), [anchorDate]);

  const publicCalendarQuery = useQuery({
    queryKey: ["public-calendar", token, startDate, endDate],
    enabled: Boolean(token),
    queryFn: () => getPublicCalendar(token!, startDate, endDate),
  });

  const groupedEvents = useMemo(() => {
    const rows = publicCalendarQuery.data?.events || [];
    const map = new Map<string, typeof rows>();
    rows.forEach((row) => {
      const key = row.date;
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    });
    return Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [publicCalendarQuery.data?.events]);

  if (publicCalendarQuery.isLoading) {
    return (
      <Container size="md" py="xl">
        <Group justify="center"><Loader /></Group>
      </Container>
    );
  }

  if (publicCalendarQuery.isError || !publicCalendarQuery.data) {
    return (
      <Container size="md" py="xl">
        <Paper withBorder p="xl" radius="md">
          <Stack gap="sm" align="center">
            <IconWorld size={28} />
            <Title order={3}>{t("Shared calendar unavailable") || "Shared calendar unavailable"}</Title>
            <Text c="dimmed">{t("This share link is invalid or no longer available.") || "This share link is invalid or no longer available."}</Text>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Paper withBorder p="lg" radius="md">
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Group gap="xs">
                <IconWorld size={18} />
                <Title order={2}>{publicCalendarQuery.data.meta.athlete_name}</Title>
              </Group>
              <Text c="dimmed">{t("Shared training calendar") || "Shared training calendar"}</Text>
            </Stack>
            <Group gap="xs">
              <Badge variant="light" color="blue">{publicCalendarQuery.data.meta.include_completed ? (t("Planned + completed") || "Planned + completed") : (t("Planned only") || "Planned only")}</Badge>
              <ActionIcon variant="light" onClick={() => setAnchorDate((current) => addMonths(current, -1))}><IconChevronLeft size={16} /></ActionIcon>
              <Text fw={600} miw={110} ta="center">{format(anchorDate, "MMMM yyyy")}</Text>
              <ActionIcon variant="light" onClick={() => setAnchorDate((current) => addMonths(current, 1))}><IconChevronRight size={16} /></ActionIcon>
            </Group>
          </Group>
        </Paper>

        {groupedEvents.length === 0 ? (
          <Paper withBorder p="xl" radius="md">
            <Text c="dimmed">{t("No visible events in this month.") || "No visible events in this month."}</Text>
          </Paper>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {groupedEvents.map(([dateKey, items]) => (
              <Paper key={dateKey} withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Text fw={700}>{format(new Date(`${dateKey}T00:00:00`), "EEEE, MMM d")}</Text>
                    <Badge variant="light">{items.length}</Badge>
                  </Group>
                  {items.map((item) => (
                    <Paper key={`${item.is_planned ? "p" : "a"}-${item.id}-${item.title}`} withBorder p="sm" radius="sm">
                      <Stack gap={4}>
                        <Group gap="xs">
                          <Text fw={600} size="sm">{item.title}</Text>
                          <Badge size="xs" color={item.is_planned ? "blue" : "gray"} variant="light">
                            {item.is_planned ? (t("Planned") || "Planned") : (t("Completed") || "Completed")}
                          </Badge>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {[item.sport_type, item.planned_duration || item.duration ? `${Math.round(item.planned_duration || item.duration || 0)} min` : null]
                            .filter(Boolean)
                            .join(" • ")}
                        </Text>
                        {item.description ? <Text size="sm">{item.description}</Text> : null}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </Paper>
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </Container>
  );
};

export default PublicCalendarPage;

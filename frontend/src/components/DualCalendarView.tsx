import { useState } from "react";
import { ActionIcon, Box, Divider, Flex, Group, Paper, Alert, ScrollArea, Select, Text, Tooltip, useComputedColorScheme } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { subMonths, format, startOfMonth } from "date-fns";
import { IconBooks, IconColumns, IconX } from "@tabler/icons-react";
import { TrainingCalendar } from "./TrainingCalendar";
import { WorkoutLibrary } from "./library/WorkoutLibrary";
import { SavedWorkout } from "../types/workout";
import { useI18n } from "../i18n/I18nProvider";

type Athlete = {
  id: number;
  email: string;
  profile?: { first_name?: string | null; last_name?: string | null } | null;
};

type Me = {
  id: number;
  role: string;
};

type Props = {
  me: Me;
  athletes?: Athlete[];
};

const getAthleteName = (a: Athlete): string =>
  a.profile?.first_name || a.profile?.last_name
    ? `${a.profile?.first_name || ""} ${a.profile?.last_name || ""}`.trim()
    : a.email;

const DualCalendarView = ({ me, athletes = [] }: Props) => {
  const isCoach = me.role === "coach";
  const { t } = useI18n();
  const isDark = useComputedColorScheme("light") === "dark";
  const isMobile = useMediaQuery("(max-width: 62em)");

  const athleteOptions = athletes.map((a) => ({
    value: String(a.id),
    label: getAthleteName(a),
  }));

  // Coach: pick any two athletes (or same athlete different months)
  const [leftAthleteId, setLeftAthleteId] = useState<number | null>(
    isCoach && athletes.length > 0 ? athletes[0].id : null,
  );
  const [rightAthleteId, setRightAthleteId] = useState<number | null>(
    isCoach && athletes.length > 1
      ? athletes[1].id
      : isCoach && athletes.length > 0
        ? athletes[0].id
        : null,
  );

  const [showLibrary, setShowLibrary] = useState(false);
  const [draggedWorkout, setDraggedWorkout] = useState<SavedWorkout | null>(null);
  const libraryWidth = 280;
  const panelMinWidth = 420;
  const scrollMinWidth = showLibrary ? (panelMinWidth * 2) + libraryWidth + 24 : 0;

  // Athlete: both panels show own calendar; right panel starts one month back
  const rightInitialDate = format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd");

  const borderColor = isDark ? "rgba(148,163,184,0.18)" : "rgba(15,23,42,0.10)";

  const panelLabel = (side: "left" | "right") => {
    if (!isCoach) {
      return side === "left" ? t("This month") : t("Previous month");
    }
    const id = side === "left" ? leftAthleteId : rightAthleteId;
    if (id === null) return t("All Athletes");
    const athlete = athletes.find((a) => a.id === id);
    return athlete ? getAthleteName(athlete) : "";
  };

  if (isMobile) {
    return (
      <Alert icon={<IconColumns size={16} />} color="orange" variant="light" mt="md">
        {t("Dual calendar view is only available on desktop.")}
      </Alert>
    );
  }

  return (
    <Flex direction="column" gap={0} style={{ height: "calc(100dvh - 140px)" }}>
      <Box style={{ flex: 1, minHeight: 0, overflowX: showLibrary ? "auto" : "hidden", overflowY: "hidden" }}>
      <Flex gap={0} style={{ flex: 1, minHeight: 0, minWidth: scrollMinWidth }}>
        {/* Left Panel */}
        <Box style={{ flex: 1, minWidth: showLibrary ? panelMinWidth : 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {isCoach && (
            <Paper
              p="xs"
              mb={4}
              style={{
                background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${borderColor}`,
                borderRadius: 8,
              }}
            >
              <Group gap="xs" align="center">
                <Text size="xs" fw={600} c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {t("Left panel")}
                </Text>
                <Select
                  size="xs"
                  placeholder={t("Select athlete")}
                  data={[{ value: "", label: t("All Athletes") }, ...athleteOptions]}
                  value={leftAthleteId !== null ? String(leftAthleteId) : ""}
                  onChange={(val) => setLeftAthleteId(val && val !== "" ? parseInt(val) : null)}
                  allowDeselect={false}
                  style={{ flex: 1 }}
                  styles={{ input: { fontWeight: 600 } }}
                />
              </Group>
            </Paper>
          )}
          {!isCoach && (
            <Text size="xs" fw={600} c="dimmed" mb={4} px={2}>
              {panelLabel("left")}
            </Text>
          )}
          <Box style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <TrainingCalendar
              key={`left-${leftAthleteId}`}
              athleteId={isCoach ? leftAthleteId : null}
              allAthletes={isCoach && leftAthleteId === null}
              athletes={isCoach ? athletes : []}
              compact
              draggedWorkout={draggedWorkout}
              onWorkoutDrop={() => setDraggedWorkout(null)}
            />
          </Box>
        </Box>

        <Divider orientation="vertical" color={borderColor} mx={6} />

        {/* Right Panel */}
        <Box style={{ flex: 1, minWidth: showLibrary ? panelMinWidth : 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {isCoach && (
            <Paper
              p="xs"
              mb={4}
              style={{
                background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                border: `1px solid ${borderColor}`,
                borderRadius: 8,
              }}
            >
              <Group gap="xs" align="center">
                <Text size="xs" fw={600} c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {t("Right panel")}
                </Text>
                <Select
                  size="xs"
                  placeholder={t("Select athlete")}
                  data={[{ value: "", label: t("All Athletes") }, ...athleteOptions]}
                  value={rightAthleteId !== null ? String(rightAthleteId) : ""}
                  onChange={(val) => setRightAthleteId(val && val !== "" ? parseInt(val) : null)}
                  allowDeselect={false}
                  style={{ flex: 1 }}
                  styles={{ input: { fontWeight: 600 } }}
                />
                {/* Library toggle button aligned to right panel header */}
                <Tooltip label={showLibrary ? t("Close library") : t("Workout library")}>
                  <ActionIcon
                    variant={showLibrary ? "filled" : "subtle"}
                    color={showLibrary ? "violet" : undefined}
                    size="sm"
                    onClick={() => setShowLibrary((v) => !v)}
                    aria-label={showLibrary ? t("Close library") : t("Workout library")}
                  >
                    {showLibrary ? <IconX size={14} /> : <IconBooks size={14} />}
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Paper>
          )}
          {!isCoach && (
            <Group mb={4} px={2} justify="space-between" align="center">
              <Text size="xs" fw={600} c="dimmed">
                {panelLabel("right")}
              </Text>
              <Tooltip label={showLibrary ? t("Close library") : t("Workout library")}>
                <ActionIcon
                  variant={showLibrary ? "filled" : "subtle"}
                  color={showLibrary ? "violet" : undefined}
                  size="sm"
                  onClick={() => setShowLibrary((v) => !v)}
                  aria-label={showLibrary ? t("Close library") : t("Workout library")}
                >
                  {showLibrary ? <IconX size={14} /> : <IconBooks size={14} />}
                </ActionIcon>
              </Tooltip>
            </Group>
          )}
          <Box style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <TrainingCalendar
              key={`right-${rightAthleteId}`}
              athleteId={isCoach ? rightAthleteId : null}
              allAthletes={isCoach && rightAthleteId === null}
              athletes={isCoach ? athletes : []}
              initialViewDate={isCoach ? undefined : rightInitialDate}
              compact
              draggedWorkout={draggedWorkout}
              onWorkoutDrop={() => setDraggedWorkout(null)}
            />
          </Box>
        </Box>

        {/* Workout Library Panel */}
        {showLibrary && (
          <>
            <Divider orientation="vertical" color={borderColor} mx={6} />
            <Box
              w={libraryWidth}
              style={{
                flexShrink: 0,
                minWidth: libraryWidth,
                display: "flex",
                flexDirection: "column",
                borderLeft: `1px solid ${borderColor}`,
              }}
            >
              <ScrollArea style={{ flex: 1 }} scrollbarSize={4}>
                <WorkoutLibrary
                  onDragStart={setDraggedWorkout}
                  onDragEnd={() => setDraggedWorkout(null)}
                />
              </ScrollArea>
            </Box>
          </>
        )}
      </Flex>
      </Box>
    </Flex>
  );
};

export default DualCalendarView;

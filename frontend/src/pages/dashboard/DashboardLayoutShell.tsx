import { ReactNode, useMemo, useState } from "react";
import {
  Affix,
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Button,
  Burger,
  Collapse,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconActivity,
  IconCalendar,
  IconChevronDown,
  IconChevronRight,
  IconTrophy,
  IconChartBar,
  IconWaveSine,
  IconDeviceWatch,
  IconUser,
  IconDotsVertical,
  IconCircle,
  IconLayoutDashboard,
  IconBell,
  IconLogout,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSortAscendingLetters,
  IconSortDescendingLetters,
  IconSortAscendingNumbers,
  IconSun,
  IconUserCircle,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useI18n } from "../../i18n/I18nProvider";
import OfflineNotice from "../../components/common/OfflineNotice";
import SupportContactButton from "../../components/common/SupportContactButton";
import { clearAuthSession } from "../../utils/authSession";
import api from "../../api/client";

const appLogo = "/origami-logo.png";

type DashboardTab = "dashboard" | "activities" | "plan" | "organizations" | "notifications" | "settings" | "races" | "insights" | "zones" | "trackers" | "profile" | "macrocycle";

type SidebarAthlete = {
  id: number;
  email: string;
  profile?: { first_name?: string | null; last_name?: string | null } | null;
  has_upcoming_coach_workout?: boolean;
  next_coach_workout_date?: string | null;
};

type Props = {
  opened: boolean;
  toggle: () => void;
  meDisplayName: string;
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  headerRight: ReactNode;
  onQuickAddActivity?: () => void;
  children: ReactNode;
  role?: "coach" | "athlete" | "admin";
  supportEmail?: string | null;
  athletes?: SidebarAthlete[];
  selectedAthleteId?: string | null;
  onSelectAthlete?: (athleteId: string | null) => void;
  organizationName?: string | null;
};

const DashboardLayoutShell = ({
  opened,
  toggle,
  meDisplayName,
  activeTab,
  setActiveTab,
  headerRight,
  onQuickAddActivity,
  children,
  role,
  supportEmail,
  athletes,
  selectedAthleteId,
  onSelectAthlete,
  organizationName,
}: Props) => {
  const { language, setLanguage, t } = useI18n();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isDark = computedColorScheme === "dark";
  const isMobile = useMediaQuery("(max-width: 48em)");
  const shellBackground = isDark ? "#081226" : "var(--mantine-color-body)";
  const accentPrimary = "#E95A12";
  const accentSecondary = "#6E4BF3";
  const isCoachDesktop = role === "coach" && !isMobile;
  const isAthleteDesktop = role !== "coach" && !isMobile;
  const [teamExpanded, setTeamExpanded] = useState(true);
  type AthleteSort = "az" | "za" | "recent";
  const [athleteSort, setAthleteSort] = useState<AthleteSort>("az");
  type NavItem = { key: DashboardTab; icon: typeof IconLayoutDashboard; label: string; color?: string };
  const athleteNavItems: NavItem[] = [
    { key: "plan", icon: IconCalendar, label: t("Calendar"), color: "#E95A12" },
    { key: "races", icon: IconTrophy, label: t("Races & records"), color: "#2E8B57" },
    { key: "insights", icon: IconChartBar, label: t("Training insights"), color: "#3B82F6" },
    { key: "zones", icon: IconWaveSine, label: t("Training zones"), color: "#0EA5E9" },
    { key: "trackers", icon: IconDeviceWatch, label: t("Activity trackers"), color: "#EAB308" },
    { key: "profile", icon: IconUser, label: t("Athlete profile"), color: "#3B82F6" },
    { key: "macrocycle", icon: IconCircle, label: t("Macrocycle"), color: "#22C55E" },
  ];
  const coachNavItems: NavItem[] = [
    { key: "dashboard", icon: IconLayoutDashboard, label: t("Dashboard"), color: "#E95A12" },
    { key: "activities", icon: IconActivity, label: t("Activities") },
    { key: "plan", icon: IconCalendar, label: t("Calendar"), color: "#E95A12" },
    { key: "organizations", icon: IconUsersGroup, label: t("Organizations") },
    { key: "notifications", icon: IconBell, label: t("Notifications") },
    { key: "settings", icon: IconSettings, label: t("Settings") },
  ];
  const navItems = role === "coach" ? coachNavItems : athleteNavItems;

  const getAthleteName = (athlete: SidebarAthlete) =>
    (athlete.profile?.first_name || athlete.profile?.last_name)
      ? `${athlete.profile?.first_name || ""} ${athlete.profile?.last_name || ""}`.trim()
      : athlete.email;

  const getAthleteInitial = (athlete: SidebarAthlete) =>
    athlete.profile?.first_name
      ? athlete.profile.first_name[0].toUpperCase()
      : athlete.email[0].toUpperCase();

  const sortedAthletes = useMemo(() => {
    if (!athletes) return [];
    const list = [...athletes];
    if (athleteSort === "az") {
      list.sort((a, b) => getAthleteName(a).localeCompare(getAthleteName(b)));
    } else if (athleteSort === "za") {
      list.sort((a, b) => getAthleteName(b).localeCompare(getAthleteName(a)));
    } else {
      list.sort((a, b) => b.id - a.id);
    }
    return list;
  }, [athletes, athleteSort]);

  const cycleSortMode = () =>
    setAthleteSort((prev) => (prev === "az" ? "za" : prev === "za" ? "recent" : "az"));

  const sortIcon =
    athleteSort === "az" ? <IconSortAscendingLetters size={14} />
    : athleteSort === "za" ? <IconSortDescendingLetters size={14} />
    : <IconSortAscendingNumbers size={14} />;

  const sortLabel =
    athleteSort === "az" ? "A → Z"
    : athleteSort === "za" ? "Z → A"
    : t("Recent");

  const Header = () => (
    <Group h="100%" px="md" justify="space-between" style={{ fontFamily: '"Inter", sans-serif' }}>
      <Group>
        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
        <img src={appLogo} alt="Origami Plans" width={32} height={32} />
        <Title
          order={3}
          visibleFrom="xs"
          style={{
            fontFamily: '"Inter", sans-serif',
            fontWeight: 800,
            letterSpacing: "0.01em",
            fontSize: "1.25rem"
          }}
        >
          Origami Plans
        </Title>
      </Group>
      <Group gap="xs" wrap="nowrap">
        {headerRight}
        <SupportContactButton
          iconOnly={isMobile}
          variant="subtle"
          size={isMobile ? "lg" : "sm"}
          email={supportEmail}
          name={meDisplayName}
        />
        <Tooltip label={isDark ? t("Switch to light mode") : t("Switch to dark mode")}>
          <ActionIcon
            variant="subtle"
            size="lg"
            radius="xl"
            onClick={() => setColorScheme(isDark ? "light" : "dark")}
            aria-label={t("Switch to dark mode")}
            style={{ position: "relative", overflow: "hidden", color: accentSecondary }}
          >
            <IconSun
              size={16}
              style={{
                position: "absolute",
                opacity: isDark ? 1 : 0,
                transform: isDark ? "translateY(0) rotate(0deg) scale(1)" : "translateY(10px) rotate(90deg) scale(0.65)",
                transition: "all 220ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
            <IconMoon
              size={16}
              style={{
                position: "absolute",
                opacity: isDark ? 0 : 1,
                transform: isDark ? "translateY(-10px) rotate(-90deg) scale(0.65)" : "translateY(0) rotate(0deg) scale(1)",
                transition: "all 220ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </ActionIcon>
        </Tooltip>
        <Menu shadow="md" width={180} position="bottom-end" withArrow>
          <Menu.Target>
            {isMobile ? (
              <ActionIcon
                variant="subtle"
                size="lg"
                radius="xl"
                aria-label="Account menu"
                style={{
                  border: `1px solid ${isDark ? 'rgba(148,163,184,0.26)' : 'rgba(15,23,42,0.14)'}`,
                  color: isDark ? '#E2E8F0' : '#1E293B'
                }}
              >
                <IconUserCircle size={18} />
              </ActionIcon>
            ) : (
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconUserCircle size={18} />}
                aria-label="Account menu"
                styles={{
                  root: {
                    borderRadius: 999,
                    paddingInline: 10,
                    border: `1px solid ${isDark ? 'rgba(148,163,184,0.26)' : 'rgba(15,23,42,0.14)'}`,
                    background: 'transparent',
                    color: isDark ? '#E2E8F0' : '#1E293B'
                  },
                  label: {
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontWeight: 700,
                    fontSize: 12
                  }
                }}
              >
                {meDisplayName}
              </Button>
            )}
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Label>{meDisplayName}</Menu.Label>
            <Menu.Item
              color="red"
              leftSection={<IconLogout size={14} />}
              onClick={() => {
                api.post("/auth/logout").catch(() => {});
                clearAuthSession();
                window.location.replace("/");
              }}
            >
              {t("Sign Out")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <SegmentedControl
          size="xs"
          value={language}
          onChange={(value) => setLanguage(value as "en" | "lt")}
          data={[
            { value: "en", label: "EN" },
            { value: "lt", label: "LT" },
          ]}
          visibleFrom="xs"
        />
      </Group>
    </Group>
  );

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: isMobile ? 260 : (isCoachDesktop ? 250 : (isAthleteDesktop ? 220 : 96)),
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header style={{ backgroundColor: shellBackground }}>
        <Header />
      </AppShell.Header>

      <AppShell.Navbar p="sm" style={{ backgroundColor: shellBackground, borderRight: `1px solid ${isDark ? "rgba(148,163,184,0.22)" : "rgba(15,23,42,0.12)"}` }}>
        <ScrollArea h="100%" scrollbarSize={4} type="auto">
        <Stack h="100%" justify="space-between" gap="md">
          {/* Profile section at top of sidebar */}
          {(isCoachDesktop || isAthleteDesktop) && (
            <Group gap="sm" px={4} pt={4} pb={0}>
              <Avatar color={role === "coach" ? "orange" : "blue"} radius="xl" size="md">
                {meDisplayName[0]?.toUpperCase() || "U"}
              </Avatar>
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={700} c={isDark ? "#E2E8F0" : "#1E293B"} lineClamp={1}>{meDisplayName}</Text>
                {role === "coach" && <Text size="xs" c="dimmed">{t("Coach")}</Text>}
              </Stack>
              {isAthleteDesktop && (
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  radius="xl"
                  onClick={() => setActiveTab("settings" as DashboardTab)}
                  aria-label={t("Settings")}
                  color={isDark ? "gray" : "dark"}
                >
                  <IconSettings size={16} />
                </ActionIcon>
              )}
            </Group>
          )}

          <Stack gap={4} align={isMobile ? "stretch" : (isCoachDesktop || isAthleteDesktop ? "stretch" : "center")} pt="xs">
            {navItems.map((item) => {
              const IconComponent = item.icon;
              const active = activeTab === item.key;
              const itemColor = item.color || accentPrimary;
              if (isMobile || isCoachDesktop || isAthleteDesktop) {
                return (
                  <Button
                    key={item.key}
                    variant={active ? "light" : "subtle"}
                    leftSection={
                      <IconComponent
                        size={18}
                        stroke={1.8}
                        color={active ? itemColor : (isDark ? "#94A3B8" : "#64748B")}
                      />
                    }
                    justify="flex-start"
                    size="sm"
                    onClick={() => {
                      setActiveTab(item.key as DashboardTab);
                      if (isMobile) toggle();
                    }}
                    styles={{
                      root: {
                        border: `1px solid ${active
                          ? (isDark ? `${itemColor}88` : `${itemColor}55`)
                          : "transparent"}`,
                        color: active ? (isDark ? "#F1F5F9" : "#1E293B") : (isDark ? "#E2E8F0" : "#1E293B"),
                        background: active
                          ? (isDark ? `${itemColor}20` : `${itemColor}14`)
                          : "transparent",
                        fontWeight: active ? 600 : 400,
                        fontSize: 13,
                      }
                    }}
                  >
                    {item.label}
                  </Button>
                );
              }
              return (
                <Tooltip key={item.key} label={item.label} position="right">
                  <ActionIcon
                    size="xl"
                    radius="md"
                    variant="subtle"
                    onClick={() => {
                      setActiveTab(item.key as DashboardTab);
                      if (window.innerWidth < 768) toggle();
                    }}
                    aria-label={item.label}
                    styles={{
                      root: {
                        border: active
                          ? `1px solid ${isDark ? 'rgba(233, 90, 18, 0.55)' : 'rgba(233, 90, 18, 0.35)'}`
                          : `1px solid ${isDark ? 'rgba(148,163,184,0.20)' : 'rgba(15,23,42,0.12)'}`,
                        background: active
                          ? (isDark ? 'rgba(233, 90, 18, 0.20)' : 'rgba(233, 90, 18, 0.10)')
                          : 'transparent',
                        color: active
                          ? accentPrimary
                          : (isDark ? '#94A3B8' : '#475569'),
                        transition: 'all 160ms ease'
                      }
                    }}
                  >
                    <IconComponent size={18} stroke={1.7} />
                  </ActionIcon>
                </Tooltip>
              );
            })}
            {onQuickAddActivity && (
              <Tooltip label={t("Add Activity")} position={isMobile ? "bottom" : "right"} disabled={isCoachDesktop}>
                <ActionIcon
                  size="xl"
                  radius="md"
                  variant="subtle"
                  onClick={onQuickAddActivity}
                  aria-label={t("Add Activity")}
                  styles={{
                    root: {
                      border: `1px solid ${isDark ? 'rgba(110, 75, 243, 0.38)' : 'rgba(110, 75, 243, 0.24)'}`,
                      color: accentSecondary,
                      background: isDark ? 'rgba(110, 75, 243, 0.10)' : 'rgba(110, 75, 243, 0.06)'
                    }
                  }}
                >
                  <IconPlus size={18} stroke={1.9} />
                </ActionIcon>
              </Tooltip>
            )}
          </Stack>

          {/* Coach: Organization / athletes section */}
          {isCoachDesktop && athletes && athletes.length > 0 && (
            <>
              <Divider
                my={4}
                color={isDark ? "rgba(148,163,184,0.18)" : "rgba(15,23,42,0.10)"}
              />
              <Stack gap={0} px={0}>
                <Group justify="space-between" wrap="nowrap" pr={4}>
                  <UnstyledButton
                    onClick={() => setTeamExpanded((v) => !v)}
                    py={6}
                    px={4}
                    style={{ borderRadius: 6, flex: 1 }}
                  >
                    <Group gap={6} wrap="nowrap">
                      {teamExpanded
                        ? <IconChevronDown size={14} color={isDark ? "#94A3B8" : "#475569"} />
                        : <IconChevronRight size={14} color={isDark ? "#94A3B8" : "#475569"} />}
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.04em" }}>
                        {organizationName || t("Your Team")}
                      </Text>
                    </Group>
                  </UnstyledButton>
                  {teamExpanded && (
                    <Tooltip label={sortLabel} position="right">
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        onClick={cycleSortMode}
                        aria-label={sortLabel}
                        color={isDark ? "gray" : "dark"}
                      >
                        {sortIcon}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>

                <Collapse in={teamExpanded}>
                  <Stack gap={0}>
                    {/* Team Calendar link */}
                    <NavLink
                      label={t("Team Calendar")}
                      leftSection={<IconCalendar size={15} stroke={1.6} />}
                      active={activeTab === "plan" && !selectedAthleteId}
                      onClick={() => {
                        onSelectAthlete?.(null);
                        setActiveTab("plan");
                      }}
                      variant="light"
                      color="orange"
                      styles={{
                        root: {
                          borderRadius: 6,
                          fontWeight: (activeTab === "plan" && !selectedAthleteId) ? 600 : 400,
                        },
                      }}
                    />

                    {/* Individual athletes */}
                    {sortedAthletes.map((athlete) => {
                      const name = getAthleteName(athlete);
                      const initial = getAthleteInitial(athlete);
                      const isSelected = selectedAthleteId === String(athlete.id);
                      return (
                        <NavLink
                          key={athlete.id}
                          label={name}
                          leftSection={
                            <Avatar size="sm" radius="xl" color={isSelected ? "orange" : "blue"}>
                              {initial}
                            </Avatar>
                          }
                          rightSection={
                            athlete.has_upcoming_coach_workout
                              ? null
                              : <Badge size="xs" color="orange" variant="light">{t("Needs Plan")}</Badge>
                          }
                          active={isSelected}
                          onClick={() => {
                            onSelectAthlete?.(String(athlete.id));
                            setActiveTab("plan");
                          }}
                          variant="light"
                          color="orange"
                          styles={{
                            root: {
                              borderRadius: 6,
                              fontWeight: isSelected ? 600 : 400,
                            },
                          }}
                        />
                      );
                    })}
                  </Stack>
                </Collapse>
              </Stack>
            </>
          )}

          <div style={{ paddingBottom: 8, marginTop: "auto" }} />
        </Stack>
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main bg={shellBackground} pb={isMobile ? 84 : undefined}>
        <OfflineNotice />
        {children}
      </AppShell.Main>

      {isMobile && (() => {
        const MAX_MOBILE = 5;
        const showMore = navItems.length > MAX_MOBILE;
        const visibleItems = showMore ? navItems.slice(0, MAX_MOBILE - 1) : navItems;
        const overflowItems = showMore ? navItems.slice(MAX_MOBILE - 1) : [];
        const overflowActive = overflowItems.some((i) => activeTab === i.key);
        return (
          <Affix position={{ bottom: 12, left: 12, right: 12 }}>
            <Group
              justify="space-around"
              wrap="nowrap"
              px="sm"
              py={8}
              style={{
                borderRadius: 14,
                border: `1px solid ${isDark ? "rgba(148,163,184,0.22)" : "rgba(15,23,42,0.12)"}`,
                background: isDark ? "rgba(8,18,38,0.94)" : "rgba(255,255,255,0.94)",
                backdropFilter: "blur(8px)"
              }}
            >
              {visibleItems.map((item) => {
                const IconComponent = item.icon;
                const active = activeTab === item.key;
                return (
                  <ActionIcon
                    key={`mobile-${item.key}`}
                    size="lg"
                    radius="xl"
                    variant={active ? "light" : "subtle"}
                    aria-label={item.label}
                    onClick={() => setActiveTab(item.key)}
                    color={active ? "orange" : undefined}
                  >
                    <IconComponent size={18} stroke={1.8} />
                  </ActionIcon>
                );
              })}
              {showMore && (
                <Menu shadow="md" width={200} position="top-end" withArrow>
                  <Menu.Target>
                    <ActionIcon
                      size="lg"
                      radius="xl"
                      variant={overflowActive ? "light" : "subtle"}
                      aria-label={t("More")}
                      color={overflowActive ? "orange" : undefined}
                    >
                      <IconDotsVertical size={18} stroke={1.8} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {overflowItems.map((item) => {
                      const IconComponent = item.icon;
                      return (
                        <Menu.Item
                          key={`mobile-more-${item.key}`}
                          leftSection={<IconComponent size={16} stroke={1.6} />}
                          onClick={() => setActiveTab(item.key)}
                        >
                          {item.label}
                        </Menu.Item>
                      );
                    })}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          </Affix>
        );
      })()}
    </AppShell>
  );
};

export default DashboardLayoutShell;

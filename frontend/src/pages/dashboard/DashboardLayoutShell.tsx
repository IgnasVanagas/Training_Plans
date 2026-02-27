import { ReactNode } from "react";
import {
  Affix,
  ActionIcon,
  AppShell,
  Button,
  Burger,
  Group,
  Menu,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconActivity,
  IconCalendar,
  IconLayoutDashboard,
  IconBell,
  IconLogout,
  IconMoon,
  IconPlus,
  IconSettings,
  IconSun,
  IconUserCircle,
  IconUsersGroup,
} from "@tabler/icons-react";
import appLogo from "../../../uploads/favicon_Origami-removebg-preview.png";
import { useI18n } from "../../i18n/I18nProvider";
import OfflineNotice from "../../components/common/OfflineNotice";

type DashboardTab = "dashboard" | "activities" | "plan" | "organizations" | "notifications" | "settings";

type Props = {
  opened: boolean;
  toggle: () => void;
  meDisplayName: string;
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  headerRight: ReactNode;
  onQuickAddActivity?: () => void;
  children: ReactNode;
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
}: Props) => {
  const { language, setLanguage, t } = useI18n();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme("light");
  const isDark = computedColorScheme === "dark";
  const isMobile = useMediaQuery("(max-width: 48em)");
  const shellBackground = isDark ? "#081226" : "var(--mantine-color-body)";
  const accentPrimary = "#E95A12";
  const accentSecondary = "#6E4BF3";
  const navItems: Array<{ key: DashboardTab; icon: typeof IconLayoutDashboard; label: string }> = [
    { key: "dashboard", icon: IconLayoutDashboard, label: t("Dashboard") },
    { key: "activities", icon: IconActivity, label: t("Activities") },
    { key: "plan", icon: IconCalendar, label: t("Training Plan") },
    { key: "organizations", icon: IconUsersGroup, label: t("Organizations") },
    { key: "notifications", icon: IconBell, label: t("Notifications") },
    { key: "settings", icon: IconSettings, label: t("Settings") },
  ];

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
                localStorage.removeItem("access_token");
                window.location.href = "/login";
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
        width: isMobile ? 260 : 96,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header style={{ backgroundColor: shellBackground }}>
        <Header />
      </AppShell.Header>

      <AppShell.Navbar p="sm" style={{ backgroundColor: shellBackground, borderRight: `1px solid ${isDark ? "rgba(148,163,184,0.22)" : "rgba(15,23,42,0.12)"}` }}>
        <Stack h="100%" justify="space-between" gap="md">
          <Stack gap="sm" align={isMobile ? "stretch" : "center"} pt="xs">
            {navItems.map((item) => {
              const IconComponent = item.icon;
              const active = activeTab === item.key;
              if (isMobile) {
                return (
                  <Button
                    key={item.key}
                    variant={active ? "light" : "subtle"}
                    leftSection={<IconComponent size={16} stroke={1.8} />}
                    justify="flex-start"
                    onClick={() => {
                      setActiveTab(item.key as DashboardTab);
                      toggle();
                    }}
                    styles={{
                      root: {
                        border: `1px solid ${active
                          ? (isDark ? "rgba(233, 90, 18, 0.55)" : "rgba(233, 90, 18, 0.35)")
                          : (isDark ? "rgba(148,163,184,0.20)" : "rgba(15,23,42,0.12)")}`,
                        color: active ? accentPrimary : (isDark ? "#E2E8F0" : "#1E293B"),
                        background: active
                          ? (isDark ? "rgba(233, 90, 18, 0.20)" : "rgba(233, 90, 18, 0.10)")
                          : "transparent"
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
              <Tooltip label={t("Add Activity")} position={isMobile ? "bottom" : "right"}>
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
          <Stack gap="sm" align={isMobile ? "stretch" : "center"} pb="xs">
            <Tooltip label={isDark ? t("Switch to light mode") : t("Switch to dark mode")} position="right">
              <ActionIcon
                variant="subtle"
                size="xl"
                radius="md"
                onClick={() => setColorScheme(isDark ? "light" : "dark")}
                aria-label={t("Switch to dark mode")}
                style={{ position: "relative", overflow: "hidden", border: `1px solid ${isDark ? 'rgba(110, 75, 243, 0.38)' : 'rgba(110, 75, 243, 0.24)'}`, color: accentSecondary }}
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
          </Stack>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main bg={shellBackground} pb={isMobile ? 84 : undefined}>
        <OfflineNotice />
        {children}
      </AppShell.Main>

      {isMobile && (
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
            {navItems.map((item) => {
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
          </Group>
        </Affix>
      )}
    </AppShell>
  );
};

export default DashboardLayoutShell;

import { ReactNode } from 'react';
import { ActionIcon, AppShell, Avatar, Button, Divider, Group, NavLink, Stack, Text, Title, Tooltip, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import {
  IconActivity,
  IconCalendar,
  IconLayoutDashboard,
  IconLogout,
  IconSettings,
  IconUser,
  IconSun,
  IconMoon
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import SupportContactButton from './common/SupportContactButton';
import { clearAuthSession } from '../utils/authSession';

const appLogo = '/origami-logo.png';

export const AppSidebarLayout = ({
  children,
  activeNav = 'plan'
}: {
  children: ReactNode;
  activeNav?: 'dashboard' | 'activities' | 'plan' | 'settings';
}) => {
  const navigate = useNavigate();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light');
  const isDark = computedColorScheme === 'dark';
  const [opened, { toggle, close }] = useDisclosure(false);
  const isMobile = useMediaQuery('(max-width: 48em)');

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await api.get('/users/me');
      return response.data;
    },
    staleTime: 1000 * 60 * 10
  });

  const meDisplayName = (me?.profile?.first_name || me?.profile?.last_name)
    ? `${me?.profile?.first_name || ''} ${me?.profile?.last_name || ''}`.trim()
    : (me?.email || '...');

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 300,
        breakpoint: 'sm',
        collapsed: { mobile: !opened }
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Button variant="subtle" size="compact-sm" hiddenFrom="sm" onClick={toggle}>
              ☰
            </Button>
            <img src={appLogo} alt="Origami Plans" width={32} height={32} />
            <Title order={3} visibleFrom="xs">Origami Plans</Title>
          </Group>
          <Group gap="xs">
            <SupportContactButton
              iconOnly={isMobile}
              variant="light"
              size={isMobile ? 'lg' : 'sm'}
              email={me?.email ?? null}
              name={meDisplayName}
            />
            <Avatar color="blue" radius="xl"><IconUser size="1rem" /></Avatar>
            <div>
              <Text size="sm" fw={500}>{meDisplayName}</Text>
            </div>
            <Button
              variant="light"
              color="red"
              size="xs"
              leftSection={<IconLogout size={14} />}
              onClick={() => {
                clearAuthSession();
                window.location.replace('/');
              }}
            >
              Sign Out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Stack gap="xs">
          <NavLink
            label="Dashboard"
            leftSection={<IconLayoutDashboard size="1rem" stroke={1.5} />}
            active={activeNav === 'dashboard'}
            onClick={() => {
              navigate('/dashboard');
              if (isMobile) close();
            }}
            variant="filled"
          />
          <NavLink
            label="Activities"
            leftSection={<IconActivity size="1rem" stroke={1.5} />}
            active={activeNav === 'activities'}
            onClick={() => {
              navigate('/dashboard');
              if (isMobile) close();
            }}
            variant="filled"
          />
          <NavLink
            label="Training Plan"
            leftSection={<IconCalendar size="1rem" stroke={1.5} />}
            active={activeNav === 'plan'}
            onClick={() => {
              navigate('/dashboard');
              if (isMobile) close();
            }}
            variant="filled"
          />
          <NavLink
            label="Settings"
            leftSection={<IconSettings size="1rem" stroke={1.5} />}
            active={activeNav === 'settings'}
            onClick={() => {
              navigate('/dashboard');
              if (isMobile) close();
            }}
            variant="filled"
          />

          <Divider my="xs" />
          <Group justify="space-between" px="xs">
            <Text size="sm" c="dimmed">Theme</Text>
            <Tooltip label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              <ActionIcon
                variant="light"
                size="lg"
                radius="xl"
                onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
                aria-label="Toggle color mode"
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                <IconSun
                  size={16}
                  style={{
                    position: 'absolute',
                    opacity: isDark ? 1 : 0,
                    transform: isDark ? 'translateY(0) rotate(0deg) scale(1)' : 'translateY(10px) rotate(90deg) scale(0.65)',
                    transition: 'all 220ms cubic-bezier(0.22, 1, 0.36, 1)'
                  }}
                />
                <IconMoon
                  size={16}
                  style={{
                    position: 'absolute',
                    opacity: isDark ? 0 : 1,
                    transform: isDark ? 'translateY(-10px) rotate(-90deg) scale(0.65)' : 'translateY(0) rotate(0deg) scale(1)',
                    transition: 'all 220ms cubic-bezier(0.22, 1, 0.36, 1)'
                  }}
                />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main bg="var(--mantine-color-body)">{children}</AppShell.Main>
    </AppShell>
  );
};

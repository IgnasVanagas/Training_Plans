import { Box, Card, Container, Group, Paper, SimpleGrid, Skeleton, Stack } from '@mantine/core';

/* ─── Calendar ─── */

export function CalendarWeekSkeleton() {
  return (
    <Stack gap="sm">
      {/* Week header bar */}
      <Paper withBorder p="sm" radius="md">
        <Group justify="space-between">
          <Skeleton width={120} height={14} />
          <Skeleton width={140} height={14} />
        </Group>
      </Paper>
      {/* 5 event rows */}
      {Array.from({ length: 5 }).map((_, i) => (
        <Paper key={i} withBorder p="sm" radius="md" style={{ borderLeft: '4px solid var(--mantine-color-default-border)' }}>
          <Group justify="space-between" mb={6}>
            <Group gap="xs">
              <Skeleton width={160} height={18} />
              <Skeleton width={60} height={18} radius="xl" />
            </Group>
            <Skeleton width={50} height={18} />
          </Group>
          <Skeleton width={200} height={14} />
        </Paper>
      ))}
    </Stack>
  );
}

export function CalendarMonthSkeleton() {
  return (
    <Box p={10}>
      {/* Day-of-week headers */}
      <Group gap={0} mb={8}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Box key={i} style={{ flex: 1, textAlign: 'center' }}>
            <Skeleton width={28} height={12} mx="auto" />
          </Box>
        ))}
      </Group>
      {/* 5 weeks × 7 days grid */}
      {Array.from({ length: 5 }).map((_, week) => (
        <Group key={week} gap={0} mb={4}>
          {Array.from({ length: 7 }).map((_, day) => (
            <Box
              key={day}
              style={{
                flex: 1,
                minHeight: 80,
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 4,
                padding: 6,
              }}
            >
              <Skeleton width={16} height={12} mb={6} />
              {(week + day) % 3 === 0 && <Skeleton height={10} width="80%" mb={4} />}
              {(week + day) % 4 === 0 && <Skeleton height={10} width="60%" />}
            </Box>
          ))}
        </Group>
      ))}
    </Box>
  );
}

/* ─── Activities List ─── */

export function ActivitiesListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} withBorder padding="lg" radius="lg" style={{ borderLeft: '4px solid var(--mantine-color-default-border)' }}>
          <Group justify="space-between" mb="xs">
            <Stack gap={4} style={{ flex: 1 }}>
              <Skeleton width="55%" height={16} />
              <Skeleton width={80} height={14} radius="xl" />
            </Stack>
            <Skeleton width={110} height={12} />
          </Group>
          <Box p="xs" style={{ borderRadius: 10, border: '1px solid var(--mantine-color-default-border)' }}>
            <Stack gap={6}>
              <Group justify="apart">
                <Skeleton width={60} height={13} />
                <Skeleton width={70} height={13} />
              </Group>
              <Group justify="apart">
                <Skeleton width={60} height={13} />
                <Skeleton width={55} height={13} />
              </Group>
              <Group justify="apart">
                <Skeleton width={60} height={13} />
                <Skeleton width={65} height={13} />
              </Group>
            </Stack>
          </Box>
        </Card>
      ))}
    </>
  );
}

/* ─── Activity Detail Page ─── */

export function ActivityDetailSkeleton() {
  return (
    <Container size="xl" py="sm">
      {/* 4 stat cards */}
      <SimpleGrid cols={{ base: 1, md: 4 }} mb="md" spacing="sm">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} withBorder padding="lg" radius="lg">
            <Skeleton width={36} height={36} radius="md" mb="xs" />
            <Skeleton width={70} height={10} mb={6} />
            <Skeleton width={100} height={24} />
          </Card>
        ))}
      </SimpleGrid>

      {/* Chart area */}
      <Paper withBorder p="md" radius="lg" mb="sm">
        <Skeleton width={140} height={18} mb="sm" />
        <Skeleton height={220} radius="md" />
      </Paper>

      {/* Map area */}
      <Paper withBorder p="md" radius="lg" mb="sm">
        <Skeleton width={80} height={18} mb="sm" />
        <Skeleton height={260} radius="md" />
      </Paper>

      {/* Splits / laps */}
      <Paper withBorder p="md" radius="lg">
        <Skeleton width={100} height={18} mb="sm" />
        <Stack gap="xs">
          {Array.from({ length: 4 }).map((_, i) => (
            <Group key={i} justify="space-between">
              <Skeleton width={40} height={14} />
              <Skeleton width={60} height={14} />
              <Skeleton width={70} height={14} />
              <Skeleton width={50} height={14} />
            </Group>
          ))}
        </Stack>
      </Paper>
    </Container>
  );
}

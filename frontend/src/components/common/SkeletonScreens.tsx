import { Box, Card, Container, Divider, Grid, Group, Paper, SimpleGrid, Skeleton, Stack } from '@mantine/core';

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

/* ─── Comparison Page ─── */

function ChartAreaSkeleton({ height, type }: { height: number; type: 'bar' | 'line' | 'radar' }) {
  if (type === 'radar') {
    const size = Math.min(height * 0.82, 250);
    return (
      <Box style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Skeleton height={size} width={size} radius={9999} />
      </Box>
    );
  }

  const barPcts = type === 'bar'
    ? [45, 68, 88, 62, 80, 44, 66]
    : [28, 52, 70, 82, 75, 58, 38, 22, 14];
  const chartH = height - 32;

  return (
    <Box style={{ height, display: 'flex', flexDirection: 'column' }}>
      <Box style={{ flex: 1, display: 'flex', alignItems: 'flex-end', padding: '0 4px', gap: type === 'bar' ? 6 : 0 }}>
        {type === 'bar' ? (
          barPcts.map((pct, i) => {
            const h = (pct / 100) * chartH;
            return (
              <Box key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <Skeleton height={h * 0.92} width="43%" radius="4px 4px 0 0" />
                <Skeleton height={h * 0.68} width="43%" radius="4px 4px 0 0" />
              </Box>
            );
          })
        ) : (
          <Box style={{ flex: 1, position: 'relative', minHeight: chartH }}>
            {barPcts.map((pct, i) => (
              <Box
                key={i}
                style={{
                  position: 'absolute',
                  left: `${(i / (barPcts.length - 1)) * 96}%`,
                  bottom: (pct / 100) * chartH,
                  transform: 'translateX(-50%)',
                }}
              >
                <Skeleton height={10} width={10} radius={9999} />
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Box style={{ display: 'flex', justifyContent: 'space-around', marginTop: 6 }}>
        {Array.from({ length: type === 'bar' ? 7 : 5 }).map((_, i) => (
          <Skeleton key={i} height={9} width={28} radius="sm" />
        ))}
      </Box>
    </Box>
  );
}

export function ComparisonLoadingSkeleton({ mode = 'workouts' }: { mode?: 'workouts' | 'weeks' | 'months' }) {
  return (
    <Stack gap="lg">
      {/* ── 6 metric cards ── */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <Paper key={i} withBorder p="sm" radius="md">
            <Skeleton height={9} width="55%" mb={8} radius="sm" />
            <Group gap={5} align="baseline" mb={5} wrap="nowrap">
              <Skeleton height={22} width="38%" radius="sm" />
              <Skeleton height={9} width={12} radius="sm" />
              <Skeleton height={22} width="32%" radius="sm" />
            </Group>
            <Skeleton height={10} width="32%" radius="sm" />
          </Paper>
        ))}
      </SimpleGrid>

      {/* ── contrast summary ── */}
      <Paper withBorder p="md" radius="md">
        <Group gap="xs" mb="sm">
          <Skeleton height={18} width={18} radius="sm" />
          <Skeleton height={18} width={175} radius="sm" />
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
          {Array.from({ length: mode === 'workouts' ? 6 : 5 }).map((_, i) => (
            <Paper key={i} withBorder p="xs" radius="sm">
              <Skeleton height={10} width="65%" mb={6} radius="sm" />
              <Skeleton height={16} width="42%" radius="sm" />
            </Paper>
          ))}
        </SimpleGrid>
      </Paper>

      {/* ── side-by-side detail cards ── */}
      <Grid gutter="md">
        {[0, 1].map((side) => (
          <Grid.Col key={side} span={{ base: 12, md: 6 }}>
            <Paper withBorder p="md" radius="md">
              <Group justify="space-between" mb="md">
                <Skeleton height={16} width={140} radius="sm" />
                <Skeleton height={14} width={88} radius="sm" />
              </Group>
              <Stack gap="sm" mb="md">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Group key={i} justify="space-between">
                    <Skeleton height={12} width="36%" radius="sm" />
                    <Skeleton height={12} width="26%" radius="sm" />
                  </Group>
                ))}
              </Stack>
              <Divider mb="md" opacity={0.4} />
              <Skeleton height={10} width="38%" mb={10} radius="sm" />
              <Stack gap={8}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Box key={i}>
                    <Group justify="space-between" mb={4}>
                      <Skeleton height={9} width={22} radius="sm" />
                      <Skeleton height={9} width={38} radius="sm" />
                    </Group>
                    <Skeleton height={7} width={`${72 - i * 9}%`} radius="xl" />
                  </Box>
                ))}
              </Stack>
            </Paper>
          </Grid.Col>
        ))}
      </Grid>

      {/* ── chart 1: power curve (workouts) or radar (period) ── */}
      <Paper withBorder p="md" radius="md">
        <Group gap="xs" mb="sm">
          <Skeleton height={18} width={18} radius="sm" />
          <Skeleton height={18} width={215} radius="sm" />
        </Group>
        <ChartAreaSkeleton height={mode === 'workouts' ? 280 : 300} type={mode === 'workouts' ? 'line' : 'radar'} />
      </Paper>

      {/* ── chart 2: zone distribution ── */}
      <Paper withBorder p="md" radius="md">
        <Skeleton height={18} width={195} mb="sm" radius="sm" />
        <ChartAreaSkeleton height={240} type="bar" />
      </Paper>

      {/* ── split table (workout mode only) ── */}
      {mode === 'workouts' && (
        <Paper withBorder p="md" radius="md">
          <Group gap="xs" mb="md">
            <Skeleton height={18} width={18} radius="sm" />
            <Skeleton height={18} width={155} radius="sm" />
            <Skeleton height={18} width={58} radius="xl" />
          </Group>
          <Stack gap={8}>
            <Group gap="xs">
              {[34, 74, 54, 54, 54, 74, 54, 54, 54, 54].map((w, i) => (
                <Skeleton key={i} height={13} width={w} radius="sm" />
              ))}
            </Group>
            <Divider opacity={0.4} />
            {Array.from({ length: 5 }).map((_, row) => (
              <Group key={row} gap="xs">
                {[34, 74, 54, 54, 54, 74, 54, 54, 54, 54].map((w, i) => (
                  <Skeleton key={i} height={11} width={w} radius="sm" />
                ))}
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

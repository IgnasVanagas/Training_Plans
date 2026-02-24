import { Box, Group, Progress, Stack, Text } from '@mantine/core';

const zoneColors5 = [
  'var(--mantine-color-blue-5)',
  'var(--mantine-color-cyan-5)',
  'var(--mantine-color-green-5)',
  'var(--mantine-color-yellow-5)',
  'var(--mantine-color-red-5)'
];

const zoneColors7 = [
  'var(--mantine-color-indigo-5)',
  'var(--mantine-color-blue-5)',
  'var(--mantine-color-cyan-5)',
  'var(--mantine-color-green-5)',
  'var(--mantine-color-yellow-5)',
  'var(--mantine-color-orange-5)',
  'var(--mantine-color-red-5)'
];

type ZoneBarsProps = {
  zones: Record<string, number>;
  zoneCount: number;
};

const ZoneBars = ({ zones, zoneCount }: ZoneBarsProps) => {
  const colors = zoneCount === 5 ? zoneColors5 : zoneColors7;
  const values = Array.from({ length: zoneCount }, (_, idx) => zones[`Z${idx + 1}`] || 0);
  const total = values.reduce((sum, value) => sum + value, 0);

  return (
    <Stack gap={4}>
      {values.map((seconds, idx) => {
        const pct = total > 0 ? (seconds / total) * 100 : 0;
        return (
          <Group key={`zone-${zoneCount}-${idx + 1}`} gap={6} wrap="nowrap">
            <Box w={24}>
              <Text size="xs">Z{idx + 1}</Text>
            </Box>
            <Progress value={pct} color={colors[idx]} size={8} radius={4} flex={1} />
            <Box w={38} ta="right">
              <Text size="xs" c="dimmed">{Math.round(seconds / 60)}m</Text>
            </Box>
          </Group>
        );
      })}
    </Stack>
  );
};

export default ZoneBars;

import { Paper, Text } from "@mantine/core";

type InviteTokenCardProps = {
  token?: string;
};

const InviteTokenCard = ({ token }: InviteTokenCardProps) => {
  return (
    <Paper bg="var(--mantine-color-default-hover)" p="md" radius="sm" mb="lg">
      <Text fw={600} size="sm" tt="uppercase" c="dimmed">Token</Text>
      <Text ff="monospace" size="lg">{token}</Text>
    </Paper>
  );
};

export default InviteTokenCard;

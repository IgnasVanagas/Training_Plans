import { Button, Center, Container, Paper, Text, Title, Stack } from "@mantine/core";
import { useParams, useNavigate } from "react-router-dom";

const InvitePage = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  return (
    <Center style={{ width: "100%", height: "100vh", backgroundColor: "var(--mantine-color-body)" }}>
      <Container size={500} w="100%">
        <Paper shadow="md" p={30} radius="md" withBorder ta="center">
          <Title order={2} mb="md">Join the Team</Title>
          <Text c="dimmed" mb="lg">
            You have been invited to join a coach's team.
          </Text>
          
          <Paper bg="var(--mantine-color-default-hover)" p="md" radius="sm" mb="lg">
            <Text fw={600} size="sm" tt="uppercase" c="dimmed">Token</Text>
            <Text ff="monospace" size="lg">{token}</Text>
          </Paper>

          <Stack>
             <Button fullWidth size="md">Accept Invitation</Button>
             <Button variant="subtle" fullWidth onClick={() => navigate("/login")}>Back to Login</Button>
          </Stack>
          
          <Text size="xs" c="dimmed" mt="lg">
            (Accept logic not implemented in MVP Phase II)
          </Text>
        </Paper>
      </Container>
    </Center>
  );
};

export default InvitePage;

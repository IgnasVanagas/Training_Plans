import { Button, Center, Stack, Text, Title } from "@mantine/core";
import { useNavigate } from "react-router-dom";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Center h="100vh">
      <Stack align="center" gap="md">
        <Title order={1} c="dimmed" style={{ fontSize: "6rem", lineHeight: 1 }}>
          404
        </Title>
        <Title order={3}>Page not found</Title>
        <Text c="dimmed">The page you're looking for doesn't exist.</Text>
        <Button onClick={() => navigate("/dashboard")}>Go to Dashboard</Button>
      </Stack>
    </Center>
  );
}

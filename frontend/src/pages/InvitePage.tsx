import { Center, Container, Paper, Text } from "@mantine/core";
import { useParams, useNavigate } from "react-router-dom";
import InviteActions from "../components/invite/InviteActions";
import InviteHeader from "../components/invite/InviteHeader";
import InviteTokenCard from "../components/invite/InviteTokenCard";

const InvitePage = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const inviteTitle = "Join the Team";
  const inviteDescription = "You have been invited to join a coach's team.";

  const handleBackToLogin = () => {
    navigate("/login");
  };

  return (
    <Center style={{ width: "100%", height: "100vh", backgroundColor: "var(--mantine-color-body)" }}>
      <Container size={500} w="100%">
        <Paper shadow="md" p={30} radius="md" withBorder ta="center">
          <InviteHeader title={inviteTitle} description={inviteDescription} />
          <InviteTokenCard token={token} />
          <InviteActions onBackToLogin={handleBackToLogin} />
          
          <Text size="xs" c="dimmed" mt="lg">
            (Accept logic not implemented in MVP Phase II)
          </Text>
        </Paper>
      </Container>
    </Center>
  );
};

export default InvitePage;

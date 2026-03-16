import { Alert, Center, Container, Paper, Text } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import SupportContactButton from "../components/common/SupportContactButton";
import InviteActions from "../components/invite/InviteActions";
import InviteHeader from "../components/invite/InviteHeader";
import InviteTokenCard from "../components/invite/InviteTokenCard";
import api from "../api/client";
import { hasAuthSession } from "../utils/authSession";

const InvitePage = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const inviteTitle = "Join the Team";
  const inviteDescription = "You have been invited to join a coach's team.";
  const hasSession = hasAuthSession();

  const acceptInviteMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error("Missing invitation token");
      }
      await api.put("/users/organization/join", { code: token });
    },
    onSuccess: () => {
      navigate("/dashboard");
    },
  });

  const getErrorMessage = () => {
    const detail = (acceptInviteMutation.error as any)?.response?.data?.detail;
    if (!detail) {
      return (acceptInviteMutation.error as Error | null)?.message || "Unable to accept invitation.";
    }
    if (Array.isArray(detail)) {
      return detail.map((entry: any) => entry.msg || JSON.stringify(entry)).join(", ");
    }
    if (typeof detail === "object") {
      return JSON.stringify(detail);
    }
    return String(detail);
  };

  const handleBackToLogin = () => {
    navigate(token ? `/login?invite=${encodeURIComponent(token)}` : "/login");
  };

  const handleAccept = () => {
    if (!token) {
      return;
    }
    if (!hasSession) {
      navigate(`/login?invite=${encodeURIComponent(token)}`);
      return;
    }
    acceptInviteMutation.mutate();
  };

  return (
    <Center style={{ width: "100%", height: "100vh", backgroundColor: "var(--mantine-color-body)" }}>
      <Container size={500} w="100%">
        <Paper shadow="md" p={30} radius="md" withBorder ta="center">
          <InviteHeader title={inviteTitle} description={inviteDescription} />
          <InviteTokenCard token={token} />
          {acceptInviteMutation.isError && (
            <Alert color="red" mb="md" title="Invitation error">
              <Text size="sm" mb="xs">{getErrorMessage()}</Text>
              <SupportContactButton
                size="xs"
                pageLabel="Invite"
                errorMessage={getErrorMessage()}
              />
            </Alert>
          )}
          <InviteActions
            onAccept={handleAccept}
            accepting={acceptInviteMutation.isPending}
            onBackToLogin={handleBackToLogin}
          />
          
          <Text size="xs" c="dimmed" mt="lg">
            {hasSession
              ? "Accept the invite to join the coach's team immediately."
              : "Sign in first, then accept this invitation."}
          </Text>
        </Paper>
      </Container>
    </Center>
  );
};

export default InvitePage;

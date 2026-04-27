import { Alert, Center, Checkbox, Container, Paper, Text } from "@mantine/core";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import SupportContactButton from "../components/common/SupportContactButton";
import InviteActions from "../components/invite/InviteActions";
import InviteHeader from "../components/invite/InviteHeader";
import InviteTokenCard from "../components/invite/InviteTokenCard";
import api from "../api/client";
import { hasAuthSession } from "../utils/authSession";
import { useI18n } from "../i18n/I18nProvider";

const InvitePage = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const inviteTitle = "Join the Team";
  const inviteDescription = "You have been invited to join a coach's team.";
  const hasSession = hasAuthSession();
  const [athleteSharingConsentAccepted, setAthleteSharingConsentAccepted] = useState(false);

  const acceptInviteMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error("Missing invitation token");
      }
      await api.put("/users/organization/join", {
        code: token,
        athlete_data_sharing_consent: athleteSharingConsentAccepted,
        athlete_data_sharing_consent_version: "2026-04-27",
      });
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
    if (!athleteSharingConsentAccepted) {
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
          <Checkbox
            mb="md"
            checked={athleteSharingConsentAccepted}
            onChange={(event) => setAthleteSharingConsentAccepted(event.currentTarget.checked)}
            label={t("I confirm coach access to my Strava-derived training data for this organization.")}
          />
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

import { Center, Loader, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import api from "../api/client";
import { useI18n } from "../i18n/I18nProvider";
import { clearAuthSession, hasAuthSession } from "../utils/authSession";
import SupportContactButton from "./common/SupportContactButton";

type ProtectedRouteProps = {
  children: JSX.Element;
};

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { t } = useI18n();
  const hasSession = hasAuthSession();
  const sessionValidationQuery = useQuery({
    queryKey: ["protected-route-session"],
    queryFn: async () => {
      const response = await api.get("/users/me");
      return response.data;
    },
    enabled: hasSession,
    retry: false,
    staleTime: 0,
    refetchOnMount: true,
  });

  if (!hasSession) {
    return <Navigate to="/login" replace />;
  }

  if (sessionValidationQuery.isPending) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  const status = (sessionValidationQuery.error as { response?: { status?: number } } | null)?.response?.status;
  if (sessionValidationQuery.isError && (status === 401 || status === 403)) {
    clearAuthSession();
    return <Navigate to="/login" replace />;
  }

  if (sessionValidationQuery.isError) {
    const errorMessage = (sessionValidationQuery.error as { message?: string } | null)?.message
      || t("Unable to verify your session.");
    return (
      <Center h="100vh" p="md">
        <Stack align="center" gap="xs">
          <Text c="red">{t("Unable to verify your session.")}</Text>
          <SupportContactButton errorMessage={errorMessage} pageLabel="Protected route" />
        </Stack>
      </Center>
    );
  }

  return children;
};

export default ProtectedRoute;

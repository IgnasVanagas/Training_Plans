import { Center, Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import api from "../api/client";
import { clearAuthSession, hasAuthSession } from "../utils/authSession";

type ProtectedRouteProps = {
  children: JSX.Element;
};

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
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
  if (sessionValidationQuery.isError) {
    if (status !== 401 && status !== 403) {
      clearAuthSession();
    }
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;

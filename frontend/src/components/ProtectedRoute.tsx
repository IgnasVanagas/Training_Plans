import { Navigate } from "react-router-dom";

import { hasAuthSession } from "../utils/authSession";

type ProtectedRouteProps = {
  children: JSX.Element;
};

const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  if (!hasAuthSession()) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

export default ProtectedRoute;

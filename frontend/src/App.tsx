import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { Center, Loader } from "@mantine/core";
import ProtectedRoute from "./components/ProtectedRoute";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const InvitePage = lazy(() => import("./pages/InvitePage"));
const AthleteCalendarPage = lazy(() =>
  import("./pages/AthleteCalendarPage").then((module) => ({ default: module.AthleteCalendarPage }))
);
const WorkoutBuilderPage = lazy(() =>
  import("./pages/WorkoutBuilderPage").then((module) => ({ default: module.WorkoutBuilderPage }))
);
const ActivityDetailPage = lazy(() =>
  import("./pages/ActivityDetailPage").then((module) => ({ default: module.ActivityDetailPage }))
);
const ComparisonPage = lazy(() =>
  import("./pages/ComparisonPage").then((module) => ({ default: module.ComparisonPage }))
);
const PublicCalendarPage = lazy(() => import("./pages/PublicCalendarPage"));

const JoinRedirect = () => {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code");
  if (!code) {
    return <Navigate to="/login" replace />;
  }
  return <Navigate to={`/invite/${encodeURIComponent(code)}`} replace />;
};

const App = () => {
  return (
    <BrowserRouter>
      <Suspense
        fallback={
          <Center h="100vh">
            <Loader />
          </Center>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/join" element={<JoinRedirect />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/calendar/public/:token" element={<PublicCalendarPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/athlete/:id"
            element={
              <ProtectedRoute>
                <AthleteCalendarPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/workouts/new"
            element={
              <ProtectedRoute>
                <WorkoutBuilderPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/builder"
            element={
              <ProtectedRoute>
                <WorkoutBuilderPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/activities/:id"
            element={
              <ProtectedRoute>
                <ActivityDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/compare"
            element={
              <ProtectedRoute>
                <ComparisonPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;

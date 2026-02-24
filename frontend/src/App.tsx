import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import { ActivityDetailPage } from "./pages/ActivityDetailPage";
import InvitePage from "./pages/InvitePage";
import ProtectedRoute from "./components/ProtectedRoute";
import { AthleteCalendarPage } from "./pages/AthleteCalendarPage";
import { WorkoutBuilderPage } from "./pages/WorkoutBuilderPage";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
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
          path="/dashboard/activities/:id"
          element={
            <ProtectedRoute>
              <ActivityDetailPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
};

export default App;

import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./common/LoginPage.jsx";
import AdminHomepage from "./admin/AdminHomepage.jsx";
import TeacherDashboard from "./teacher/TeacherDashboard.jsx";
import ParentDashboard from "./parent/ParentDashboard.jsx";
import NetworkToast from "./common/NetworkToast";
import NotificationQueueSync from "./common/NotificationQueueSync";

// ── Protected route — redirects to "/" if not logged in or wrong role ─────
const ProtectedRoute = ({ children, role }) => {
  const savedRole = localStorage.getItem("role");
  if (!savedRole) return <Navigate to="/" replace />;
  if (savedRole.toLowerCase() !== role.toLowerCase())
    // case-insensitive
    return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <>
      {/* It is perfectly safe here out in the open! */}
      <NetworkToast />
      <Routes>
        {/* "/" — always show login page */}
        <Route path="/" element={<LoginPage />} />

        {/* Protected routes — stay on page after refresh */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <AdminHomepage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teacher"
          element={
            <ProtectedRoute role="teacher">
              <TeacherDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/parent"
          element={
            <ProtectedRoute role="parent">
              <ParentDashboard />
            </ProtectedRoute>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;

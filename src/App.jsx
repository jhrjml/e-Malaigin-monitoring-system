import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./common/LoginPage.jsx";
import AdminHomepage from "./admin/AdminHomepage.jsx";
import TeacherDashboard from "./teacher/TeacherDashboard.jsx";
import ParentDashboard from "./parent/ParentDashboard.jsx";
import NetworkToast from "./common/NetworkToast";

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

/*import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./App.css";
import "boxicons/css/boxicons.min.css";

const App = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  // Check if user is already logged in
  useEffect(() => {
    const savedRole = localStorage.getItem("role");
    if (savedRole) {
      navigate(`/${savedRole}`);
    }
  }, [navigate]);

  const handleLogin = (e) => {
    e.preventDefault();

    const users = {
      admin: "admin123",
      teacher: "teacher123",
      parent: "parent123",
    };

    if (username === "admin" && password === users.admin) {
      localStorage.setItem("role", "admin");
      navigate("/admin");
      return;
    }

    if (username === "teacher" && password === users.teacher) {
      localStorage.setItem("role", "teacher");
      navigate("/teacher");
      return;
    }

    if (username === "parent" && password === users.parent) {
      localStorage.setItem("role", "parent");
      navigate("/parent");
      return;
    }

    alert("Invalid username or password!");
  };

  return (
    <div className="wrapper">
      <form onSubmit={handleLogin}>
        <h1>LOGIN</h1>

        <div className="input-box">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <i className="bx bx-user"></i>
        </div>

        <div className="input-box">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <i className="bx bx-lock"></i>
        </div>

        <button type="submit" className="btn">
          LOGIN
        </button>
      </form>
    </div>
  );
};

export default App;
*/

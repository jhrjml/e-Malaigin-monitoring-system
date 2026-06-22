import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/firebaseApi";
import "./LoginPage.css";

const LoginPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const savedRole = localStorage.getItem("role");
    if (savedRole === "admin") navigate("/admin", { replace: true });
    else if (savedRole === "teacher") navigate("/teacher", { replace: true });
    else if (savedRole === "parent") navigate("/parent", { replace: true });
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    if (!e.target.reportValidity()) return;
    setLoading(true);
    try {
      const data = await login({ username, password });
      localStorage.setItem("role", data.role);
      localStorage.setItem("username", data.username);
      localStorage.setItem("fullName", data.fullName || "");
      localStorage.setItem("userId", data.id || "");

      if (data.role === "admin") navigate("/admin");
      if (data.role === "teacher") navigate("/teacher");
      if (data.role === "parent") navigate("/parent");
    } catch (err) {
      setError(err.message || "Cannot connect. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lp-root">
      {/* LEFT SIDE PANEL CONTAINER */}
      <div className="lp-wrap">
        <div className="lp-card">
          {/* Brand Header */}
          <div className="lp-brand">
            <div className="lp-brand-logo">
              <img
                src="/logo.jpg"
                alt="School Logo"
                className="lp-brand-logo-img"
              />
              <div className="lp-brand-text">
                <span>e-Malaigin</span>
              </div>
            </div>
          </div>

          {/* Title Header Block Grouped Together */}
          <div className="lp-card-title">Welcome Back</div>
          <div className="lp-brand-sub">Please enter your details</div>

          <form onSubmit={handleLogin} noValidate>
            {error && <div className="lp-error">{error}</div>}

            {/* Username Field */}
            <div className="lp-field">
              <label htmlFor="lp-username">Username</label>
              <div className="lp-input-row">
                <input
                  id="lp-username"
                  type="text"
                  placeholder="Enter username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  disabled={loading}
                />
                <span className="lp-input-icon">
                  <i className="bx bx-user" />
                </span>
              </div>
            </div>

            {/* Password Field */}
            <div className="lp-field">
              <label htmlFor="lp-password">Password</label>
              <div className="lp-input-row">
                <input
                  id="lp-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="lp-pwd-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Pill Action Button */}
            <button type="submit" className="lp-btn" disabled={loading}>
              {loading ? (
                <>
                  SIGNING IN...
                  <span className="lp-spinner" />
                </>
              ) : (
                "Login"
              )}
            </button>
          </form>
          {/* 👇 MOVED HERE: Directly underneath the closing form tag */}
          <div className="lp-copyright">
            {/* &copy; 2026 e-Malaigin. All Rights Reserved.*/}
            Need help? Ask the administrative staff for your account.
          </div>
        </div>
      </div>
      {/* RIGHT SIDE HERO TEXT */}
      <div className="lp-right-hero">
        <h1 className="lp-hero-title">Malaig Elementary School</h1>
        <p className="lp-hero-subtitle">School Management Portal</p>
      </div>
    </div>
  );
};

export default LoginPage;

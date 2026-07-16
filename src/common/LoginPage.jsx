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
      {/* Defines the beautiful organic "S" curve shape for the image */}
      <svg style={{ width: 0, height: 0, position: "absolute" }}>
        <clipPath id="blob-shape" clipPathUnits="objectBoundingBox">
          <path d="M 0,0 L 0.85,0 C 1,0.35 0.7,0.65 0.85,1 L 0,1 Z" />
        </clipPath>
      </svg>

      {/* LEFT SIDE: Image Background with Blob Cutout */}
      <div className="lp-left-panel">
        <div className="lp-left-overlay"></div>

        <div className="lp-left-content">
          <div className="lp-school-info">
            <h1>Malaig Elementary School</h1>
            <p>School Management System</p>
          </div>
        </div>
      </div>

      {/* RIGHT SIDE: Pastel Pink Background with Form */}
      <div className="lp-right-panel">
        {/* Decorative fluid/organic blobs for the background */}
        <div className="lp-blob lp-blob-1"></div>
        <div className="lp-blob lp-blob-2"></div>
        <div className="lp-blob lp-blob-3"></div>
        <div className="lp-blob lp-blob-4"></div>

        <div className="lp-form-box">
          {/* New Focused Brand Header */}
          <div className="lp-brand-right">
            <img src="/logo.jpg" alt="School Logo" />
            <div className="lp-brand-text-right">
              <h1>e-Malaigin</h1>
            </div>
          </div>

          <form className="lp-form" onSubmit={handleLogin} noValidate>
            {error && (
              <div className="lp-error">
                <i className="fas fa-exclamation-circle"></i> {error}
              </div>
            )}

            {/* Username Field */}
            <div className="lp-form-group">
              <label htmlFor="lp-username">Username</label>
              <div className="lp-input-wrap">
                <input
                  id="lp-username"
                  type="text"
                  placeholder="Enter your username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="lp-form-group">
              <label htmlFor="lp-password">Password</label>
              <div className="lp-input-wrap">
                <input
                  id="lp-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
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
            <button type="submit" className="lp-submit-btn" disabled={loading}>
              {loading ? (
                <>
                  Authenticating...
                  <span className="lp-spinner" />
                </>
              ) : (
                "Login"
              )}
            </button>
          </form>

          <p className="lp-help-text">
            Need help? Ask the administrative staff for your account.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

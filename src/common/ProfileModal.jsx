import { useState, useEffect } from "react";
import { db } from "../api/firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import "./ProfileModal.css";

function ProfileModal({ open, onClose }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const userId = localStorage.getItem("userId");
  const role = localStorage.getItem("role") || "";

  // Display name: "Admin" for admin, username for teacher/parent
  const displayName =
    role === "admin"
      ? "Admin"
      : localStorage.getItem("fullName") ||
        localStorage.getItem("username") ||
        "User";

  // Load current username + password from Firestore when modal opens
  useEffect(() => {
    if (!open || !userId) return;
    setEditing(false);
    setError("");
    setSuccess("");
    setCurrentPassword("");
    setNewPassword("");
    setShowPassword(false);
    setShowCurrent(false);
    setShowNew(false);

    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "User", userId));
        if (snap.exists()) {
          const data = snap.data();
          setUsername(data.username || "");
          setPassword(data.password || "");
          setNewUsername(data.username || "");
        }
      } catch (e) {
        setError("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [open, userId]);

  const handleSave = async () => {
    setError("");
    setSuccess("");

    if (!newUsername.trim()) {
      setError("Username cannot be empty.");
      return;
    }
    if (!currentPassword) {
      setError("Please enter your current password to save changes.");
      return;
    }
    if (currentPassword !== password) {
      setError("Current password is incorrect.");
      return;
    }
    if (newPassword && newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }

    setSaving(true);
    try {
      const updates = { username: newUsername.trim() };
      if (newPassword) updates.password = newPassword;

      await updateDoc(doc(db, "User", userId), updates);

      localStorage.setItem("username", newUsername.trim());
      setUsername(newUsername.trim());
      if (newPassword) setPassword(newPassword);

      setSuccess("Profile updated successfully!");
      setEditing(false);
      setCurrentPassword("");
      setNewPassword("");
    } catch (e) {
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setError("");
    setSuccess("");
    setCurrentPassword("");
    setNewPassword("");
    setNewUsername(username);
  };

  if (!open) return null;

  return (
    <div className="pm-overlay" onClick={onClose}>
      <div className="pm-box" onClick={(e) => e.stopPropagation()}>
        {/* Avatar & Header */}
        <div className="pm-avatar">
          <i className="fas fa-user"></i>
        </div>
        <div className="pm-header">
          <div className="pm-displayname">{displayName}</div>
          <div className="pm-role">
            {role.charAt(0).toUpperCase() + role.slice(1)}
          </div>
        </div>

        <div className="pm-divider" />

        {loading ? (
          <p className="pm-loading">Loading profile…</p>
        ) : (
          <>
            {error && (
              <div className="pm-error">
                <i className="fas fa-exclamation-circle"></i> {error}
              </div>
            )}
            {success && (
              <div className="pm-success">
                <i className="fas fa-check-circle"></i> {success}
              </div>
            )}

            {/* View mode */}
            {!editing ? (
              <>
                <div className="pm-field">
                  <label>Username</label>
                  <div className="pm-text-box">{username}</div>
                </div>
                <div className="pm-field">
                  <label>Password</label>
                  <div className="pm-text-box">
                    <span>{showPassword ? password : "••••••••"}</span>
                    <button
                      type="button"
                      className="pm-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              /* Edit mode */
              <>
                <div className="pm-field">
                  <label>New Username</label>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                </div>

                <div className="pm-field">
                  <label>
                    Current Password <span className="pm-required">*</span>
                  </label>
                  <div className="pm-pwd-row">
                    <input
                      type={showCurrent ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Required to save changes"
                    />
                    <button
                      type="button"
                      className="pm-toggle"
                      onClick={() => setShowCurrent(!showCurrent)}
                    >
                      {showCurrent ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <div className="pm-field">
                  <label>
                    New Password{" "}
                    <span className="pm-optional">
                      (leave blank to keep current)
                    </span>
                  </label>
                  <div className="pm-pwd-row">
                    <input
                      type={showNew ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Optional"
                      minLength={6}
                    />
                    <button
                      type="button"
                      className="pm-toggle"
                      onClick={() => setShowNew(!showNew)}
                    >
                      {showNew ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Buttons */}
            <div className="pm-actions">
              {!editing ? (
                <>
                  <button
                    className="pm-btn pm-edit"
                    onClick={() => {
                      setEditing(true);
                      setSuccess("");
                    }}
                  >
                    <i className="fas fa-pen" /> Edit Profile
                  </button>
                  <button className="pm-btn pm-close" onClick={onClose}>
                    Close
                  </button>
                </>
              ) : (
                <>
                  <button className="pm-btn pm-cancel" onClick={handleCancel}>
                    Cancel
                  </button>
                  <button
                    className="pm-btn pm-save"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ProfileModal;

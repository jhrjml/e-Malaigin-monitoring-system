import React, { useState, useEffect, useRef } from "react";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./ParentDashboard.css";
import ChildClasses from "./ChildClasses";
import ChildProfile from "./ChildProfile";
import "../Layout.css";
import ProfileModal from "../common/ProfileModal";
import AttendanceRecord from "./AttendanceRecord";
import AcademicActivity from "./AcademicActivity";

const titleMap = {
  dashboard: "Overview",
  profile: "Child's Profile",
  classes: "Child's Classes",
  record: "Attendance Record",
  activity: "Academic Activity",
};

const ParentDashboard = () => {
  const [isSidebarClosed, setIsSidebarClosed] = useState(
    window.innerWidth <= 768,
  );
  const [currentDate, setCurrentDate] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  // ── Persist activePage across refresh ──────────────────────────────────
  const [activePage, setActivePage] = useState(
    () => localStorage.getItem("parentPage") || "Overview",
  );

  // ── Read guardian name from localStorage ───────────────────────────────
  const rawFullName = localStorage.getItem("fullName") || "";
  const parentFirstName = rawFullName.trim().split(" ")[0] || "Parent";
  //const storedUsername = localStorage.getItem("username") || "Parent";

  useEffect(() => {
    const options = { year: "numeric", month: "long", day: "numeric" };
    setCurrentDate(new Date().toLocaleDateString("en-US", options));

    const handleResize = () => setIsSidebarClosed(window.innerWidth <= 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target))
        setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleSidebar = () => setIsSidebarClosed(!isSidebarClosed);

  const handleLogout = () => {
    localStorage.clear();
    setLogoutOpen(false);
    window.location.href = "/";
  };

  const navigate = (page) => {
    setActivePage(page);
    localStorage.setItem("parentPage", page); // persist
  };

  return (
    <div className="app-container">
      {/* SIDEBAR */}
      <aside className={`sidebar ${isSidebarClosed ? "closed" : ""}`}>
        <div className="brand-logo">
          <img src="/logo.jpg" alt="School Logo" className="brand-logo-img" />
          <div className="brand-text">
            <span className="brand-title">e-Malaigin</span>
            <small className="brand-subtitle">PARENT PORTAL</small>
          </div>
        </div>

        <ul className="menu">
          <li
            className={activePage === "dashboard" ? "active" : ""}
            onClick={() => navigate("dashboard")}
          >
            <i className="fas fa-tachometer-alt"></i>
            <span> Dashboard</span>
          </li>
          <li
            className={activePage === "profile" ? "active" : ""}
            onClick={() => navigate("profile")}
          >
            <i className="fas fa-user-graduate"></i>
            <span> Child's Profile</span>
          </li>
          <li
            className={activePage === "classes" ? "active" : ""}
            onClick={() => navigate("classes")}
          >
            <i className="fas fa-chalkboard-teacher"></i>
            <span> Child's Classes</span>
          </li>
          <li
            className={activePage === "record" ? "active" : ""}
            onClick={() => navigate("record")}
          >
            <i className="fas fa-calendar-check"></i>
            <span> Attendance Record</span>
          </li>
          <li
            className={activePage === "activity" ? "active" : ""}
            onClick={() => navigate("activity")}
          >
            <i className="fas fa-tasks"></i>
            <span> Academic Activity</span>
          </li>
        </ul>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        <header>
          <div className="header-left">
            <button id="menu-toggle" onClick={toggleSidebar}>
              <i className="fas fa-bars"></i>
            </button>
            <div className="header-title">
              {titleMap[activePage] || "Dashboard"}
            </div>
          </div>

          <div className="header-right">
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                className="profile-avatar-btn"
                onClick={() => setProfileMenuOpen((v) => !v)}
              >
                <i className="fas fa-user-circle fa-2x"></i>
                <span className="profile-avatar-name">{parentFirstName}</span>
                <i className="fas fa-chevron-down profile-avatar-caret"></i>
              </button>

              {profileMenuOpen && (
                <div className="profile-dropdown">
                  <button
                    className="profile-dropdown-item"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setProfileOpen(true);
                    }}
                  >
                    <i className="fas fa-user-cog"></i> Account Details
                  </button>
                  <div className="profile-dropdown-divider" />
                  <button
                    className="profile-dropdown-item profile-dropdown-item--danger"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setLogoutOpen(true);
                    }}
                  >
                    <i className="fas fa-sign-out-alt"></i> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="page-container">
          {/* DASHBOARD VIEW */}
          {activePage === "dashboard" && (
            <>
              <div className="welcome-banner">
                <div className="welcome-text">
                  <h1>Welcome, {parentFirstName}!</h1>
                  <p>Get a quick overview of your child's activities.</p>
                </div>
                <div className="date-badge-p">
                  <i className="far fa-calendar-alt"></i>
                  <span>{currentDate || "Loading..."}</span>
                </div>
              </div>

              <h2 style={{ marginTop: "30px", marginBottom: "20px" }}>
                Quick Access
              </h2>

              <div className="dashboard-grid">
                <div
                  className="card-link-parent"
                  onClick={() => navigate("profile")}
                >
                  <div className="icon-box-p">
                    <i className="fas fa-user-circle fa-3x"></i>
                  </div>
                  <h3>My Child's Profile</h3>
                  <p>View child's personal information</p>
                </div>

                <div
                  className="card-link-parent"
                  onClick={() => navigate("classes")}
                >
                  <div className="icon-box-b">
                    <i className="fas fa-clipboard-list fa-3x"></i>
                  </div>
                  <h3>My Child's Classes</h3>
                  <p>View attendance record and academic activities</p>
                </div>
              </div>
            </>
          )}

          {activePage === "profile" && <ChildProfile />}
          {activePage === "classes" && <ChildClasses />}
          {activePage === "record" && <AttendanceRecord />}
          {activePage === "activity" && <AcademicActivity />}
        </div>

        {/* LOGOUT MODAL */}
        {logoutOpen && (
          <div className="modal-overlay-parent">
            <div className="modal-parent logout-modal">
              <div className="modal-header">
                <h3>Confirm Logout</h3>
              </div>
              <p>Are you sure you want to logout?</p>
              <div className="modal-buttons">
                <button
                  className="btn-cancel"
                  onClick={() => setLogoutOpen(false)}
                >
                  Cancel
                </button>
                <button className="btn-confirm" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
        />
      </main>
    </div>
  );
};

export default ParentDashboard;

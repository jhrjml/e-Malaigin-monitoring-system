// ManageUsers.jsx  (Firebase version — accounts are auto-generated)
import { useState, useEffect } from "react";
import {
  getUsers,
  getStudent,
  toggleUserStatus,
  runAccountMaintenanceTasks,
} from "../api/firebaseApi";
import "./ManageUsers.css";
import "@fortawesome/fontawesome-free/css/all.min.css";

function ManageUsers() {
  const [currentView, setCurrentView] = useState("categories");
  const [currentRoleFilter, setCurrentRoleFilter] = useState("");
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewPassVisible, setViewPassVisible] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [linkedStudents, setLinkedStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);

  // ── Search & Sorting State Containers ────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("asc"); // 'asc' = A-Z, 'desc' = Z-A

  // ── On mount: run maintenance tasks then load users ────────────────────
  useEffect(() => {
    (async () => {
      await runAccountMaintenanceTasks();
      fetchUsers();
    })();
  }, []);

  // ── INTERCEPT SIDEBAR NAVIGATION CLICKS TO RESET DESTINATION CONTEXT ──
  useEffect(() => {
    const handleSidebarClick = (e) => {
      const target = e.target.closest("a, button, div, li, span");
      if (
        target &&
        target.textContent &&
        target.textContent.includes("Users Account")
      ) {
        setCurrentView("categories");
        setCurrentRoleFilter("");
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleSidebarClick);
    return () => document.removeEventListener("mousedown", handleSidebarClick);
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const all = await getUsers();
      setUsers(all.filter((u) => u.status !== "Archived"));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const teacherUsers = users.filter((u) => u.role === "Teacher");
  const parentUsers = users.filter((u) => u.role === "Parent");
  const filteredUsers = users.filter((u) => u.role === currentRoleFilter);

  const openUserList = (role) => {
    setCurrentRoleFilter(role);
    setSortOrder("asc");
    setSearchQuery("");
    setCurrentView("list");
  };

  const toggle = async (userId) => {
    try {
      await toggleUserStatus(userId);
      await fetchUsers();
    } catch (e) {
      console.error(e);
    }
  };

  // ── Open view modal — resolve student IDs → names for Parent accounts ──
  const openViewModal = async (user) => {
    setSelectedUser(user);
    setViewPassVisible(false);
    setLinkedStudents([]);
    setViewModalOpen(true);

    if (user.role === "Parent" && user.studentIds?.length > 0) {
      setStudentsLoading(true);
      try {
        const fetched = await Promise.all(
          user.studentIds.map((sid) => getStudent(sid).catch(() => null)),
        );
        setLinkedStudents(fetched.filter(Boolean));
      } catch (e) {
        console.error(e);
      } finally {
        setStudentsLoading(false);
      }
    }
  };

  const closeViewModal = () => {
    setViewModalOpen(false);
    setLinkedStudents([]);
  };

  // ── Grade label helper (handles graduated students with grade === 7) ───
  const gradeLabel = (grade) => {
    if (grade === 7) return "Graduated";
    return `Grade ${grade}`;
  };

  // ── ALPHABETICAL COLUMN SORTING TOGGLE UTILITY ──
  const handleSortToggle = () => {
    setSortOrder(sortOrder === "asc" ? "desc" : "asc");
  };

  const activeSearchQuery = searchQuery.trim().toLowerCase();

  // Search Filter Pipeline
  const searchedUsers = filteredUsers.filter((u) => {
    if (!activeSearchQuery) return true;
    const name = (u.role === "Teacher" ? u.fullName : u.guardianName) || "";
    const username = u.username || "";
    return (
      name.toLowerCase().includes(activeSearchQuery) ||
      username.toLowerCase().includes(activeSearchQuery)
    );
  });

  // Sort Pipeline
  const sortedUsers = [...searchedUsers].sort((a, b) => {
    const nameA = (a.role === "Teacher" ? a.fullName : a.guardianName) || "";
    const nameB = (b.role === "Teacher" ? b.fullName : b.guardianName) || "";

    return sortOrder === "asc"
      ? nameA.toLowerCase().localeCompare(nameB.toLowerCase())
      : nameB.toLowerCase().localeCompare(nameA.toLowerCase());
  });

  return (
    <>
      <main
        className="main-content"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div className="page-container">
          {/* ── CATEGORY VIEW ── */}
          {currentView === "categories" && (
            <div className="view-section active">
              <div className="toolbar-mu">
                <div>
                  <h2 className="page-title">System Accounts</h2>
                  <p className="page-subtitle" style={{ color: "#5c6a79" }}>
                    Select a user group to manage login credentials.
                  </p>
                </div>
              </div>

              <div className="auto-account-banner">
                <i className="fas fa-info-circle"></i>
                <span>
                  Accounts are automatically created when a Teacher or Student
                  is added to the system. Accounts inactive for 90 days are
                  automatically archived.
                </span>
              </div>

              <div className="card-grid">
                <div
                  className="user-card"
                  onClick={() => openUserList("Teacher")}
                >
                  <div className="teacher-icon">
                    <i className="fas fa-chalkboard-teacher"></i>
                  </div>
                  <div className="card-info">
                    <h3>Teacher Accounts</h3>
                    <span className="count-badge">
                      {teacherUsers.length} Users
                    </span>
                  </div>
                  <div className="card-action">View List</div>
                </div>

                <div
                  className="user-card"
                  onClick={() => openUserList("Parent")}
                >
                  <div className="parent-icon">
                    <i className="fas fa-user-friends"></i>
                  </div>
                  <div className="card-info">
                    <h3>Parent Accounts</h3>
                    <span className="count-badge">
                      {parentUsers.length} Users
                    </span>
                  </div>
                  <div className="card-action">View List</div>
                </div>
              </div>
            </div>
          )}

          {/* ── LIST VIEW ── */}
          {currentView === "list" && (
            <div className="view-section">
              <div className="toolbar-mu">
                <div className="toolbar-mu-header-group">
                  <button
                    className="btn-back-mu"
                    onClick={() => setCurrentView("categories")}
                  >
                    <i className="fas fa-arrow-left"></i>
                  </button>
                  <h3 className="list-title">
                    {currentRoleFilter} Accounts List
                  </h3>
                </div>

                <div className="mu-global-search-container">
                  <i className="fas fa-search mu-global-search-icon"></i>
                  <input
                    type="text"
                    className="mu-global-search-input"
                    placeholder="Search name or username..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      className="mu-global-search-clear"
                      onClick={() => setSearchQuery("")}
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  )}
                </div>
              </div>

              {loading ? (
                <p style={{ textAlign: "center", padding: "20px" }}>
                  Loading...
                </p>
              ) : (
                <div className="table-container">
                  <table className="data-table-mu">
                    <thead>
                      <tr>
                        <th
                          onClick={handleSortToggle}
                          className="sortable-table-header"
                          style={{ cursor: "pointer", userSelect: "none" }}
                        >
                          Full Name
                          <i
                            className={`fas ${sortOrder === "asc" ? "fa-sort-up mu-header-sorted" : "fa-sort-down mu-header-sorted"}`}
                          ></i>
                          <span className="mt-sort-hint-label"></span>
                        </th>
                        <th>Username</th>
                        <th>Status</th>
                        <th style={{ textAlign: "center" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedUsers.length === 0 ? (
                        <tr>
                          <td
                            colSpan="4"
                            style={{ textAlign: "center", padding: "20px" }}
                          >
                            {searchQuery
                              ? `No matching accounts found for "${searchQuery}".`
                              : `No ${currentRoleFilter} accounts found.`}
                          </td>
                        </tr>
                      ) : (
                        sortedUsers.map((user) => (
                          <tr key={user.id}>
                            <td>
                              <strong>
                                {user.role === "Teacher"
                                  ? user.fullName || "—"
                                  : user.guardianName || "—"}
                              </strong>
                            </td>
                            <td>{user.username}</td>
                            <td>
                              <span
                                className={`status-pill ${
                                  user.status === "Active"
                                    ? "active-pill"
                                    : "inactive-pill"
                                }`}
                              >
                                {user.status}
                              </span>
                            </td>
                            <td>
                              <div className="action-buttons">
                                <button
                                  className="btn-icon btn-view-action"
                                  onClick={() => openViewModal(user)}
                                  title="View credentials"
                                >
                                  <i className="fas fa-eye"></i>
                                </button>
                                <button
                                  className={`btn-icon btn-toggle-action ${
                                    user.status === "Active" ? "" : "activate"
                                  }`}
                                  onClick={() => toggle(user.id)}
                                  title={
                                    user.status === "Active"
                                      ? "Deactivate"
                                      : "Activate"
                                  }
                                >
                                  <i
                                    className={`fas ${
                                      user.status === "Active"
                                        ? "fa-power-off"
                                        : "fa-check"
                                    }`}
                                  ></i>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── VIEW ACCOUNT DETAILS MODAL ── */}
      {viewModalOpen && selectedUser && (
        <div className="mu-modal-overlay" onClick={closeViewModal}>
          <div
            className="mu-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                <div className="modal-header-icon">
                  <i
                    className={
                      selectedUser.role === "Teacher"
                        ? "fas fa-chalkboard-teacher"
                        : "fas fa-user-friends"
                    }
                  ></i>
                </div>
                Account Details
              </h3>
              <button className="close-modal" onClick={closeViewModal}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="modal-body">
              <div className="mu-field-group">
                <label className="mu-field-label">Role</label>
                <div className="mu-view-box">{selectedUser.role}</div>
              </div>

              <div className="mu-field-group">
                <label className="mu-field-label">
                  {selectedUser.role === "Teacher"
                    ? "Full Name"
                    : "Guardian Name"}
                </label>
                <div className="mu-view-box">
                  {selectedUser.role === "Teacher"
                    ? selectedUser.fullName || "—"
                    : selectedUser.guardianName || "—"}
                </div>
              </div>

              <div className="mu-field-group">
                <label className="mu-field-label">Username</label>
                <div className="mu-view-box">{selectedUser.username}</div>
              </div>

              <div className="mu-field-group">
                <label className="mu-field-label">Password</label>
                <div className="mu-view-box">
                  <span
                    style={{
                      letterSpacing: viewPassVisible ? "normal" : "3px",
                    }}
                  >
                    {viewPassVisible ? selectedUser.password : "••••••••"}
                  </span>
                  <i
                    className={`fas ${viewPassVisible ? "fa-eye-slash" : "fa-eye"}`}
                    style={{
                      cursor: "pointer",
                      color: "#95a5a6",
                      fontSize: "1.1rem",
                      transition: "color 0.2s ease",
                    }}
                    onClick={() => setViewPassVisible(!viewPassVisible)}
                    onMouseEnter={(e) => (e.target.style.color = "#a65f81")}
                    onMouseLeave={(e) => (e.target.style.color = "#95a5a6")}
                  ></i>
                </div>
              </div>

              <div className="mu-field-group">
                <label className="mu-field-label">Status</label>
                <div>
                  <span
                    className={`status-pill ${
                      selectedUser.status === "Active"
                        ? "active-pill"
                        : "inactive-pill"
                    }`}
                  >
                    {selectedUser.status}
                  </span>
                </div>
              </div>

              {selectedUser.role === "Parent" &&
                selectedUser.studentIds?.length > 0 && (
                  <div className="mu-field-group">
                    <label className="mu-field-label">
                      Linked Students ({selectedUser.studentIds.length})
                    </label>
                    <div
                      style={{
                        background: "#f8f9fa",
                        border: "1.5px solid #eef1f6",
                        borderRadius: "12px",
                        padding: "8px 16px",
                        fontSize: "0.9rem",
                        color: "#1a1a2e",
                      }}
                    >
                      {studentsLoading ? (
                        <div
                          style={{
                            padding: "8px 0",
                            color: "#95a5a6",
                            fontStyle: "italic",
                          }}
                        >
                          <i
                            className="fas fa-spinner fa-spin"
                            style={{ marginRight: "8px" }}
                          ></i>
                          Loading students…
                        </div>
                      ) : linkedStudents.length > 0 ? (
                        linkedStudents.map((s, idx) => {
                          const isInactive = s.archived || s.grade === 7;
                          const isLast = idx === linkedStudents.length - 1;
                          return (
                            <div
                              key={s.id}
                              style={{
                                padding: "10px 0",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                borderBottom: isLast
                                  ? "none"
                                  : "1px solid #eef1f6",
                              }}
                            >
                              <span>
                                <i
                                  className="fas fa-user-graduate"
                                  style={{
                                    marginRight: "8px",
                                    color: "var(--accent)",
                                  }}
                                ></i>
                                <strong style={{ fontWeight: "600" }}>
                                  {s.lastName}, {s.firstName}
                                  {s.middleName
                                    ? ` ${s.middleName.charAt(0).toUpperCase()}.`
                                    : ""}
                                </strong>
                              </span>
                              <span
                                style={{
                                  display: "flex",
                                  gap: "8px",
                                  alignItems: "center",
                                }}
                              >
                                <span
                                  style={{
                                    background:
                                      "color-mix(in srgb, var(--primary) 10%, transparent)",
                                    color: "var(--primary)",
                                    borderRadius: "12px",
                                    padding: "3px 10px",
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                  }}
                                >
                                  {gradeLabel(s.grade)}
                                </span>
                                {isInactive && (
                                  <span
                                    style={{
                                      background: "rgba(231,76,60,0.12)",
                                      color: "#e74c3c",
                                      borderRadius: "12px",
                                      padding: "3px 10px",
                                      fontSize: "0.75rem",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {s.grade === 7 ? "Graduated" : "Archived"}
                                  </span>
                                )}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div
                          style={{
                            color: "#95a5a6",
                            padding: "8px 0",
                            fontStyle: "italic",
                          }}
                        >
                          No student details found.
                        </div>
                      )}
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ManageUsers;

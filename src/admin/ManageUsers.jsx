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

  // ── On mount: run maintenance tasks then load users ────────────────────
  useEffect(() => {
    (async () => {
      await runAccountMaintenanceTasks(); // auto-archive stale accounts
      fetchUsers();
    })();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Exclude archived accounts from the list
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
              <div className="toolbar">
                <div>
                  <h2 className="page-title">System Accounts</h2>
                  <p className="page-subtitle">
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
              <div className="toolbar">
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

              {loading ? (
                <p style={{ textAlign: "center", padding: "20px" }}>
                  Loading...
                </p>
              ) : (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Full Name</th>
                        <th>Username</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td
                            colSpan="4"
                            style={{ textAlign: "center", padding: "20px" }}
                          >
                            No {currentRoleFilter} accounts found.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => (
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
        <div className="modal-overlay modal-open">
          <div className="modal-content-view modal-view">
            <div className="modal-header modal-view-header">
              <h3>Account Details</h3>
              <span className="close-modal" onClick={closeViewModal}>
                &times;
              </span>
            </div>

            <div className="modal-body">
              {/* Role icon */}

              {/* Role */}
              <div className="view-field">
                <label>Role</label>
                <div className="view-value">{selectedUser.role}</div>
              </div>

              {/* Name */}
              <div className="view-field">
                <label>
                  {selectedUser.role === "Teacher"
                    ? "Full Name"
                    : "Guardian Name"}
                </label>
                <div className="view-value">
                  {selectedUser.role === "Teacher"
                    ? selectedUser.fullName || "—"
                    : selectedUser.guardianName || "—"}
                </div>
              </div>

              {/* Username */}
              <div className="view-field">
                <label>Username</label>
                <div className="view-value">{selectedUser.username}</div>
              </div>

              {/* Password */}
              <div className="view-field">
                <label>Password</label>
                <div
                  className="view-value"
                  style={{ display: "flex", alignItems: "center", gap: "10px" }}
                >
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
                      color: "#888",
                      fontSize: "0.9rem",
                    }}
                    onClick={() => setViewPassVisible(!viewPassVisible)}
                  ></i>
                </div>
              </div>

              {/* Status */}
              <div className="view-field">
                <label>Status</label>
                <span
                  className={`status-pill ${
                    selectedUser.status === "Active"
                      ? "active-pill"
                      : "inactive-pill"
                  } view-status`}
                >
                  {selectedUser.status}
                </span>
              </div>

              {/* Linked students — Parent accounts only */}
              {selectedUser.role === "Parent" &&
                selectedUser.studentIds?.length > 0 && (
                  <div className="view-field">
                    <label>
                      Linked Students ({selectedUser.studentIds.length})
                    </label>
                    <div
                      style={{
                        background: "#f5f5f5",
                        borderRadius: "6px",
                        padding: "8px 12px",
                        fontSize: "0.85rem",
                        color: "#555",
                      }}
                    >
                      {studentsLoading ? (
                        <div style={{ padding: "4px 0", color: "#999" }}>
                          <i
                            className="fas fa-spinner fa-spin"
                            style={{ marginRight: "6px" }}
                          ></i>
                          Loading students…
                        </div>
                      ) : linkedStudents.length > 0 ? (
                        linkedStudents.map((s) => {
                          const isInactive = s.archived || s.grade === 7;
                          return (
                            <div
                              key={s.id}
                              style={{
                                padding: "5px 0",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                borderBottom: "1px solid #e8e8e8",
                              }}
                            >
                              <span>
                                <i
                                  className="fas fa-user-graduate"
                                  style={{
                                    marginRight: "6px",
                                    color: "#a65f81",
                                  }}
                                ></i>
                                <strong>
                                  {s.lastName}, {s.firstName}
                                  {s.middleName
                                    ? ` ${s.middleName.charAt(0).toUpperCase()}.`
                                    : ""}
                                </strong>
                              </span>
                              <span
                                style={{
                                  display: "flex",
                                  gap: "6px",
                                  alignItems: "center",
                                }}
                              >
                                <span
                                  style={{
                                    background: "#ddeeff",
                                    color: "#2c6fad",
                                    borderRadius: "12px",
                                    padding: "1px 8px",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
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
                                      padding: "1px 8px",
                                      fontSize: "0.7rem",
                                      fontWeight: 600,
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
                        <div style={{ color: "#999", padding: "4px 0" }}>
                          No student details found.
                        </div>
                      )}
                    </div>
                  </div>
                )}
            </div>

            <div className="modal-footer">
              <button
                className="btn-cancel btn-view-close"
                onClick={closeViewModal}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ManageUsers;

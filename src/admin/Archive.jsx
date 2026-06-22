// Archive.jsx  –  src/admin/Archive.jsx
import React, { useState, useEffect, useCallback } from "react";
import {
  getArchivedStudents,
  getArchivedTeachers,
  unarchiveStudent,
  unarchiveTeacher,
} from "../api/firebaseApi";
import ConfirmModal from "../common/ConfirmModal";
import "./Archive.css";
import "../Layout.css";

// ── helpers ───────────────────────────────────────────────────────────────────
const fullStudentName = (s) =>
  `${s.lastName}, ${s.firstName}${s.middleName ? " " + s.middleName : ""}`;

const fullTeacherName = (t) =>
  `${t.lname}, ${t.fname}${t.mname ? " " + t.mname : ""}`;

const formatDate = (val) => {
  if (!val) return "—";
  if (typeof val?.toDate === "function")
    return val.toDate().toLocaleDateString();
  const d = new Date(val);
  return isNaN(d) ? "—" : d.toLocaleDateString();
};

// ── Toast component ───────────────────────────────────────────────────────────
const Toast = ({ toast }) => {
  if (!toast) return null;
  return (
    <div className={`archive-toast ${toast.error ? "error" : "success"}`}>
      <i
        className={`fas ${toast.error ? "fa-exclamation-circle" : "fa-check-circle"}`}
      ></i>
      <span>{toast.message}</span>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const Archive = () => {
  const [filter, setFilter] = useState("students");
  const [search, setSearch] = useState("");
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null); // { type, id, name }
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState(null);

  // ── data ───────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (filter === "students") {
        setStudents(await getArchivedStudents());
      } else {
        setTeachers(await getArchivedTeachers());
      }
    } catch (e) {
      console.error("Archive load error:", e);
      showToast("Failed to load archived records.", true);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── toast ──────────────────────────────────────────────────────────────────
  const showToast = (message, error = false) => {
    setToast({ message, error });
    setTimeout(() => setToast(null), 3500);
  };

  // ── unarchive ──────────────────────────────────────────────────────────────
  const handleUnarchiveClick = (type, id, name) =>
    setConfirmTarget({ type, id, name });

  const handleConfirm = async () => {
    if (!confirmTarget || processing) return;
    setProcessing(true);
    try {
      if (confirmTarget.type === "student") {
        await unarchiveStudent(confirmTarget.id);
        showToast(
          `${confirmTarget.name} has been restored to Manage Students.`,
        );
        setStudents((prev) =>
          prev.filter((r) => r.student.id !== confirmTarget.id),
        );
      } else {
        await unarchiveTeacher(confirmTarget.id);
        showToast(
          `${confirmTarget.name} has been restored to Manage Teachers.`,
        );
        setTeachers((prev) =>
          prev.filter((r) => r.teacher.id !== confirmTarget.id),
        );
      }
      setConfirmTarget(null);
    } catch (e) {
      console.error("Unarchive error:", e);
      showToast(e.message || "Failed to unarchive record.", true);
    } finally {
      setProcessing(false);
    }
  };

  // ── search ─────────────────────────────────────────────────────────────────
  const q = search.toLowerCase().trim();

  const filteredStudents = students.filter((r) => {
    if (!q) return true;
    return (
      fullStudentName(r.student).toLowerCase().includes(q) ||
      (r.student.lrn || "").toLowerCase().includes(q) ||
      (r.student.guardian || "").toLowerCase().includes(q) ||
      (r.parentUser?.username || "").toLowerCase().includes(q)
    );
  });

  const filteredTeachers = teachers.filter((r) => {
    if (!q) return true;
    return (
      fullTeacherName(r.teacher).toLowerCase().includes(q) ||
      (r.teacher.empId || "").toLowerCase().includes(q) ||
      (r.teacherUser?.username || "").toLowerCase().includes(q)
    );
  });

  const records = filter === "students" ? filteredStudents : filteredTeachers;
  const isEmpty = !loading && records.length === 0;

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <main className="main-content archive-main">
      <Toast toast={toast} />

      <div className="page-container">
        {/* Header */}
        <div className="archive-header">
          <div>
            <h2>
              <i className="fas fa-archive"></i> Archive
            </h2>
            <p>View and restore archived students and teachers.</p>
          </div>
        </div>

        {/* Controls */}
        <div className="archive-controls">
          <div className="archive-filter-group">
            <button
              className={`archive-filter-btn ${filter === "students" ? "active" : ""}`}
              onClick={() => {
                setFilter("students");
                setSearch("");
              }}
            >
              <i className="fas fa-user-graduate"></i> Students
              {students.length > 0 && (
                <span className="archive-badge">{students.length}</span>
              )}
            </button>
            <button
              className={`archive-filter-btn ${filter === "teachers" ? "active" : ""}`}
              onClick={() => {
                setFilter("teachers");
                setSearch("");
              }}
            >
              <i className="fas fa-chalkboard-teacher"></i> Teachers
              {teachers.length > 0 && (
                <span className="archive-badge">{teachers.length}</span>
              )}
            </button>
          </div>

          <div className="archive-search-wrap">
            <i className="fas fa-search archive-search-icon"></i>
            <input
              type="text"
              className="archive-search"
              placeholder={
                filter === "students"
                  ? "Search by name, LRN, guardian, or username…"
                  : "Search by name, Employee ID, or username…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="archive-search-clear"
                onClick={() => setSearch("")}
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="archive-loading">
            <i className="fas fa-spinner fa-spin"></i> Loading…
          </div>
        ) : isEmpty ? (
          <div className="archive-empty">
            <i className="fas fa-box-open"></i>
            <p>
              No archived {filter} found{q ? " matching your search" : ""}.
            </p>
          </div>
        ) : filter === "students" ? (
          <div className="archive-table-wrap">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>LRN</th>
                  <th>Grade</th>
                  <th>Archived On</th>
                  <th>Parent Account</th>
                  <th>Account Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map(({ student, parentUser }) => (
                  <tr key={student.id}>
                    <td>
                      <div className="archive-name">
                        <div className="archive-avatar student">
                          {student.lastName?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="archive-fullname">
                            {fullStudentName(student)}
                          </span>
                          <span className="archive-sub">
                            Guardian: {student.guardian || "—"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="archive-mono">{student.lrn || "—"}</td>
                    <td>
                      <span className="archive-grade-badge">
                        Grade {student.grade}
                      </span>
                    </td>
                    <td className="archive-date">
                      {formatDate(student.archivedAt)}
                    </td>
                    <td>
                      {parentUser ? (
                        <div className="archive-account-info">
                          <i className="fas fa-user-circle"></i>
                          <span>{parentUser.username}</span>
                        </div>
                      ) : (
                        <span className="archive-no-account">No account</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`archive-status-badge ${(parentUser?.status || "none").toLowerCase()}`}
                      >
                        {parentUser?.status || "—"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="archive-unarchive-btn"
                        onClick={() =>
                          handleUnarchiveClick(
                            "student",
                            student.id,
                            fullStudentName(student),
                          )
                        }
                      >
                        <i className="fas fa-undo"></i> Unarchive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="archive-table-wrap">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Employee ID</th>
                  <th>Advisory</th>
                  <th>Teacher Account</th>
                  <th>Account Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredTeachers.map(({ teacher, teacherUser }) => (
                  <tr key={teacher.id}>
                    <td>
                      <div className="archive-name">
                        <div className="archive-avatar teacher">
                          {teacher.lname?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="archive-fullname">
                            {fullTeacherName(teacher)}
                          </span>
                          <span className="archive-sub">
                            {teacher.contact || "No contact"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="archive-mono">{teacher.empId || "—"}</td>
                    <td>
                      {teacher.advisory ? (
                        <span className="archive-advisory">
                          {teacher.advisory}
                        </span>
                      ) : (
                        <span className="archive-no-account">—</span>
                      )}
                    </td>
                    <td>
                      {teacherUser ? (
                        <div className="archive-account-info">
                          <i className="fas fa-user-circle"></i>
                          <span>{teacherUser.username}</span>
                        </div>
                      ) : (
                        <span className="archive-no-account">No account</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`archive-status-badge ${(teacherUser?.status || "none").toLowerCase()}`}
                      >
                        {teacherUser?.status || "—"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="archive-unarchive-btn"
                        onClick={() =>
                          handleUnarchiveClick(
                            "teacher",
                            teacher.id,
                            fullTeacherName(teacher),
                          )
                        }
                      >
                        <i className="fas fa-undo"></i> Unarchive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm modal — uses real ConfirmModal now that we know the API */}
      <ConfirmModal
        open={!!confirmTarget}
        title={`Unarchive ${confirmTarget?.type === "student" ? "Student" : "Teacher"}`}
        titleIcon="fa-undo"
        titleColor="#2ecc71"
        message={
          confirmTarget?.type === "student"
            ? `Restore ${confirmTarget?.name} back to Manage Students at their current grade level? Their parent account will also be reactivated if it exists.`
            : `Restore ${confirmTarget?.name} back to Manage Teachers? Their teacher account will also be reactivated.`
        }
        confirmText={processing ? "Restoring…" : "Yes, Unarchive"}
        cancelText="Cancel"
        confirmColor="success"
        disabled={processing}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!processing) setConfirmTarget(null);
        }}
      />
    </main>
  );
};

export default Archive;

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

// Safe date extraction helper for sorting Firestore Timestamps or ISO strings chronologically
const getTimeValue = (val) => {
  if (!val) return 0;
  if (typeof val?.toDate === "function") return val.toDate().getTime();
  const d = new Date(val);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

const GRADE_LEVELS = [1, 2, 3, 4, 5, 6];

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

// ── Grade Picker Modal ────────────────────────────────────────────────────────
const GradePickerModal = ({
  open,
  studentName,
  currentGrade,
  onSelect,
  onCancel,
}) => {
  const [selected, setSelected] = useState(null);

  // Reset selection whenever the modal opens for a new student
  useEffect(() => {
    if (open) setSelected(null);
  }, [open, studentName]);

  if (!open) return null;

  return (
    <div className="archive-modal-overlay" onClick={onCancel}>
      <div
        className="archive-modal archive-grade-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="archive-modal-header">
          <i className="fas fa-user-graduate" style={{ color: "#8e44ad" }}></i>
          <h3>Select Grade Level to Restore</h3>
        </div>

        <p className="archive-modal-message">
          Choose the grade level <strong>{studentName}</strong> should be
          restored to. The student was archived from{" "}
          <strong>Grade {currentGrade}</strong>.
        </p>

        <div className="archive-grade-grid">
          {GRADE_LEVELS.map((g) => (
            <button
              key={g}
              className={`archive-grade-option${selected === g ? " selected" : ""}${g === currentGrade ? " original" : ""}`}
              onClick={() => setSelected(g)}
            >
              <span className="archive-grade-num">Grade {g}</span>
              {g === currentGrade && (
                <span className="archive-grade-tag">Original</span>
              )}
            </button>
          ))}
        </div>

        {selected && (
          <p className="archive-grade-confirm-hint">
            <i className="fas fa-info-circle"></i> Student will be restored to{" "}
            <strong>Grade {selected}</strong>.
          </p>
        )}

        <div className="archive-modal-actions">
          <button className="archive-modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="archive-modal-confirm"
            disabled={selected === null}
            onClick={() => onSelect(selected)}
          >
            <i className="fas fa-arrow-right"></i> Continue
          </button>
        </div>
      </div>
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

  // ── Sorting State Containers ──────────────────────────────────────────────
  const [studentSortField, setStudentSortField] = useState("name"); // "name" or "archivedAt"
  const [studentSortOrder, setStudentSortOrder] = useState("asc");
  const [teacherSortOrder, setTeacherSortOrder] = useState("asc"); // Teachers sort by name directly

  // For teachers: direct confirm modal target
  const [confirmTarget, setConfirmTarget] = useState(null); // { type, id, name }

  // For students: two-step flow
  // Step 1 — grade picker
  const [gradePickerTarget, setGradePickerTarget] = useState(null); // { id, name, currentGrade }
  // Step 2 — confirmation after grade is chosen
  const [studentConfirmTarget, setStudentConfirmTarget] = useState(null); // { id, name, targetGrade }

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

  // ── unarchive: student — step 1: open grade picker ─────────────────────────
  const handleStudentUnarchiveClick = (id, name, currentGrade) => {
    setGradePickerTarget({ id, name, currentGrade });
  };

  // ── unarchive: student — step 2: grade chosen → open confirm modal ─────────
  const handleGradeSelected = (targetGrade) => {
    if (!gradePickerTarget) return;
    setStudentConfirmTarget({
      id: gradePickerTarget.id,
      name: gradePickerTarget.name,
      targetGrade,
    });
    setGradePickerTarget(null);
  };

  // ── unarchive: student — step 3: confirmed → run API ──────────────────────
  const handleStudentConfirm = async () => {
    if (!studentConfirmTarget || processing) return;
    setProcessing(true);
    try {
      await unarchiveStudent(
        studentConfirmTarget.id,
        studentConfirmTarget.targetGrade,
      );
      showToast(
        `${studentConfirmTarget.name} has been restored to Grade ${studentConfirmTarget.targetGrade} in Manage Students.`
      );
      setStudents((prev) =>
        prev.filter((r) => r.student.id !== studentConfirmTarget.id),
      );
      setStudentConfirmTarget(null);
    } catch (e) {
      console.error("Unarchive error:", e);
      showToast(e.message || "Failed to unarchive student.", true);
    } finally {
      setProcessing(false);
    }
  };

  // ── unarchive: teacher ─────────────────────────────────────────────────────
  const handleTeacherUnarchiveClick = (id, name) =>
    setConfirmTarget({ type: "teacher", id, name });

  const handleTeacherConfirm = async () => {
    if (!confirmTarget || processing) return;
    setProcessing(true);
    try {
      await unarchiveTeacher(confirmTarget.id);
      showToast(`${confirmTarget.name} has been restored to Manage Teachers.`);
      setTeachers((prev) =>
        prev.filter((r) => r.teacher.id !== confirmTarget.id),
      );
      setConfirmTarget(null);
    } catch (e) {
      console.error("Unarchive error:", e);
      showToast(e.message || "Failed to unarchive teacher.", true);
    } finally {
      setProcessing(false);
    }
  };

  // ── Sorting Toggles ────────────────────────────────────────────────────────
  const handleStudentSortToggle = (field) => {
    if (studentSortField === field) {
      setStudentSortOrder(studentSortOrder === "asc" ? "desc" : "asc");
    } else {
      setStudentSortField(field);
      setStudentSortOrder("asc");
    }
  };

  const handleTeacherSortToggle = () => {
    setTeacherSortOrder(teacherSortOrder === "asc" ? "desc" : "asc");
  };

  // ── search & sort pipeline logic execution ─────────────────────────────────
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

  // Apply sorting pipeline rules to arrays before compiling DOM rows
  const sortedStudents = [...filteredStudents].sort((a, b) => {
    if (studentSortField === "name") {
      const nameA = fullStudentName(a.student).toLowerCase();
      const nameB = fullStudentName(b.student).toLowerCase();
      return studentSortOrder === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    }
    if (studentSortField === "archivedAt") {
      const timeA = getTimeValue(a.student.archivedAt);
      const timeB = getTimeValue(b.student.archivedAt);
      return studentSortOrder === "asc" ? timeA - timeB : timeB - timeA;
    }
    return 0;
  });

  const sortedTeachers = [...filteredTeachers].sort((a, b) => {
    const nameA = fullTeacherName(a.teacher).toLowerCase();
    const nameB = fullTeacherName(b.teacher).toLowerCase();
    return teacherSortOrder === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
  });

  const records = filter === "students" ? sortedStudents : sortedTeachers;
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
                  {/* Sortable Header Components */}
                  <th 
                    onClick={() => handleStudentSortToggle("name")} 
                    className="sortable-table-header"
                  >
                    Student
                    <i className={`fas ${studentSortField === "name" ? (studentSortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                    <span className="mt-sort-hint-label">(sort)</span>
                  </th>
                  <th>LRN</th>
                  <th>Grade</th>
                  <th 
                    onClick={() => handleStudentSortToggle("archivedAt")} 
                    className="sortable-table-header"
                  >
                    Archived On
                    <i className={`fas ${studentSortField === "archivedAt" ? (studentSortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                    <span className="mt-sort-hint-label">(sort)</span>
                  </th>
                  <th>Parent Account</th>
                  <th>Account Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedStudents.map(({ student, parentUser }) => (
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
                          handleStudentUnarchiveClick(
                            student.id,
                            fullStudentName(student),
                            student.grade,
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
                  {/* Sortable Header Components */}
                  <th 
                    onClick={handleTeacherSortToggle} 
                    className="sortable-table-header"
                  >
                    Teacher
                    <i className={`fas ${teacherSortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted"}`}></i>
                    <span className="mt-sort-hint-label">(sort)</span>
                  </th>
                  <th>Employee ID</th>
                  <th>Advisory</th>
                  <th>Teacher Account</th>
                  <th>Account Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedTeachers.map(({ teacher, teacherUser }) => (
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
                          handleTeacherUnarchiveClick(
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

      {/* ── Step 1: Grade picker for students ── */}
      <GradePickerModal
        open={!!gradePickerTarget}
        studentName={gradePickerTarget?.name}
        currentGrade={gradePickerTarget?.currentGrade}
        onSelect={handleGradeSelected}
        onCancel={() => setGradePickerTarget(null)}
      />

      {/* ── Step 2: Confirm unarchive for students (after grade chosen) ── */}
      <ConfirmModal
        open={!!studentConfirmTarget}
        title="Unarchive Student"
        titleIcon="fa-undo"
        titleColor="#2ecc71"
        message={`Restore ${studentConfirmTarget?.name} back to Manage Students at Grade ${studentConfirmTarget?.targetGrade}? Their parent account will also be reactivated if it exists.`}
        confirmText={processing ? "Restoring…" : "Yes, Unarchive"}
        cancelText="Back"
        confirmColor="success"
        disabled={processing}
        onConfirm={handleStudentConfirm}
        onCancel={() => {
          if (!processing) {
            // Go back to grade picker instead of fully closing
            setGradePickerTarget({
              id: studentConfirmTarget.id,
              name: studentConfirmTarget.name,
              currentGrade: studentConfirmTarget.targetGrade,
            });
            setStudentConfirmTarget(null);
          }
        }}
      />

      {/* ── Confirm unarchive for teachers ── */}
      <ConfirmModal
        open={!!confirmTarget}
        title="Unarchive Teacher"
        titleIcon="fa-undo"
        titleColor="#2ecc71"
        message={`Restore ${confirmTarget?.name} back to Manage Teachers? Their teacher account will also be reactivated.`}
        confirmText={processing ? "Restoring…" : "Yes, Unarchive"}
        cancelText="Cancel"
        confirmColor="success"
        disabled={processing}
        onConfirm={handleTeacherConfirm}
        onCancel={() => {
          if (!processing) setConfirmTarget(null);
        }}
      />
    </main>
  );
};

export default Archive;
// ManageClasses.jsx  (Firebase version)
// OFFLINE-SAFE VERSION — see ManageStudents.jsx header comment for the
// full explanation of the pattern used throughout this file:
//  - Modals close immediately on submit instead of awaiting the network.
//  - useSubmitGuard blocks a fast double-click from firing twice.
//  - Bulk import fires all writes at once instead of awaiting each row in
//    sequence (which hung forever offline on the very first row), then
//    closes with an optimistic result and reconciles in the background.
import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import {
  getTeachers,
  getEnrolled,
  getStudent,
  getEligibleStudents,
  enrollStudent,
  dropStudent,
  promoteStudent,
  graduateStudent,
  getSchedules,
  addSchedule,
  updateSchedule,
  getStudents,
  clearSectionSchedules,
} from "../api/firebaseApi";
import ConfirmModal from "../common/ConfirmModal";
import Toast from "../common/Toast";
import { useToast } from "../common/useToast.js";
import useSubmitGuard from "../common/useSubmitGuard";
import useNetworkStatus from "../common/useNetworkStatus"; // adjust path if different
import "./ManageClasses.css";

const SUBJECTS = [
  "Arabic",
  "Araling Panlipunan",
  "English",
  "Filipino",
  "EPP",
  "ESP",
  "MAPEH",
  "Math",
  "Science",
];

// Helper: Formats 24h standard strings (e.g., "13:45") to clean 12h formats ("1:45 PM")
const formatTimeLabel = (timeStr) => {
  if (!timeStr) return "—";
  const [hrs, mins] = timeStr.split(":");
  let h = parseInt(hrs, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mins} ${ampm}`;
};

// ── Sort icon (same visual design as ManageStudents.jsx) ──────────────────
function SortIcon({ active, direction }) {
  if (!active) {
    return <i className="fas fa-sort mc-sort-icon"></i>;
  }
  return direction === "asc" ? (
    <i className="fas fa-sort-up mc-sort-icon mc-sort-icon--active"></i>
  ) : (
    <i className="fas fa-sort-down mc-sort-icon mc-sort-icon--active"></i>
  );
}

// ── Helper: fault-tolerant section-student loader ─────────────────────────
async function loadSectionStudents(enrolledDocs) {
  const details = (
    await Promise.all(
      enrolledDocs.map(
        (e) =>
          getStudent(e.studentId)
            .then((s) => ({ ...s, enrollStatus: e.status, enrollId: e.id }))
            .catch(() => null), // missing / archived doc → skip silently
      ),
    )
  ).filter(Boolean);
  return details.filter((s) => s.enrollStatus === "Enrolled");
}

const ManageClasses = () => {
  const [currentView, setCurrentView] = useState("view-grade");
  const [currentGrade, setCurrentGrade] = useState(null);
  const [currentSection, setCurrentSection] = useState("");

  const [eligibleStudents, setEligibleStudents] = useState([]);
  const [sectionStudents, setSectionStudents] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [schedules, setSchedules] = useState([]);
  // All Schedule docs across every grade/section — used only for the
  // "teacher already booked at this time somewhere else" conflict check
  // in the schedule modal. Refreshed each time that modal opens.
  const [allSchedules, setAllSchedules] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showStudentModal, setShowStudentModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [isEditingSched, setIsEditingSched] = useState(false);
  const [editSchedId, setEditSchedId] = useState(null);
  const [selectedStudentId, setSelectedStudentId] = useState("");

  // ── Masterlist Filtering & Sorting State ────────────────────────────────
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [studentSortField, setStudentSortField] = useState("lrn"); 
  const [studentSortOrder, setStudentSortOrder] = useState("asc");

  // ── bulk select ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ── masterlist search (same behavior as Manage Students) ───────────────
  const [masterlistSearch, setMasterlistSearch] = useState("");

  // ── masterlist sorting ───────────────────────────────────────────────────
  const [masterlistSort, setMasterlistSort] = useState({
    key: "lrn",
    direction: "asc",
  });
  const handleMasterlistSort = (key) => {
    setMasterlistSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  // ── schedule sorting (sort only, no search) ─────────────────────────────
  const [scheduleSort, setScheduleSort] = useState({
    key: "time",
    direction: "asc",
  });
  const handleScheduleSort = (key) => {
    setScheduleSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  // ── student add/import menu ─────────────────────────────────────────────
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  const studentFileRef = useRef(null);

  const [studentImportOpen, setStudentImportOpen] = useState(false);
  const [studentImportRows, setStudentImportRows] = useState([]);
  const [studentImportErrors, setStudentImportErrors] = useState([]);
  const [studentImportLoading, setStudentImportLoading] = useState(false);
  const [studentImportDone, setStudentImportDone] = useState({
    success: 0,
    failed: 0,
  });
  const [studentImportFinished, setStudentImportFinished] = useState(false);

  // ── Updated Form Hook state to manage timeline inputs ──
  const [schedForm, setSchedForm] = useState({
    subject: "Math",
    startTime: "",
    endTime: "",
    teacherId: "",
  });
  const [formError, setFormError] = useState("");

  const { toast, showToast } = useToast();
  const { isOnline } = useNetworkStatus();

  // ── submit guards (separate lock per action) ────────────────────────────
  const guardEnroll = useSubmitGuard();
  const guardSchedule = useSubmitGuard();
  const guardStudentImport = useSubmitGuard();

  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    titleIcon: "",
    titleColor: "",
    message: "",
    confirmText: "OK",
    confirmColor: "primary",
    onConfirm: null,
  });
  const closeConfirm = () => setConfirm((c) => ({ ...c, open: false }));

  // ── INTERCEPT SIDEBAR NAVIGATION CLICKS TO RESET DESTINATION CONTEXT ──
  useEffect(() => {
    const handleSidebarClick = (e) => {
      const target = e.target.closest("a, button, div, li, span");
      if (target && target.textContent && target.textContent.includes("Manage Classes")) {
        setCurrentView("view-grade");
        setCurrentGrade(null);
        setCurrentSection("");
        setStudentSearchQuery("");
        setSelectedIds(new Set());
      }
    };
    document.addEventListener("mousedown", handleSidebarClick);
    return () => document.removeEventListener("mousedown", handleSidebarClick);
  }, []);

  // ── fetch teachers once ───────────────────────────────────────────────
  useEffect(() => {
    getTeachers()
      .then(setTeachers)
      .catch((e) => setError(e.message));
  }, []);

  // ── fetch section data ────────────────────────────────────────────────
  useEffect(() => {
    if (!currentGrade || !currentSection) return;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const enrolledDocs = await getEnrolled(currentGrade, currentSection);
        setSectionStudents(await loadSectionStudents(enrolledDocs));
        setSchedules(await getSchedules(currentGrade, currentSection));
        setSelectedIds(new Set());
        setMasterlistSearch("");
        setMasterlistSort({ key: "lrn", direction: "asc" });
        setScheduleSort({ key: "time", direction: "asc" });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentGrade, currentSection]);

  // Close add menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target))
        setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── helper: clear schedules when section becomes empty ────────────────
  const maybeClearSchedules = async (remaining) => {
    if (remaining.length === 0 && schedules.length > 0) {
      try {
        await clearSectionSchedules(currentGrade, currentSection);
        setSchedules([]);
      } catch (e) {
        console.error("Failed to clear schedules:", e);
      }
    }
  };

  // ── manual enroll ─────────────────────────────────────────────────────
  const openEnrollModal = async () => {
    setFormError("");
    setSelectedStudentId("");
    setLoading(true);
    try {
      setEligibleStudents(await getEligibleStudents(currentGrade));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    setShowStudentModal(true);
  };

  const enroll = (e) => {
    e.preventDefault();
    setFormError("");
    if (!selectedStudentId) {
      setFormError("Please select a student.");
      return;
    }
    guardEnroll(() => doEnroll());
  };

  const doEnroll = () => {
    const chosen = eligibleStudents.find((s) => s.id === selectedStudentId);
    const studentId = selectedStudentId;
    const grade = currentGrade;
    const section = currentSection;

    setShowStudentModal(false);
    showToast(
      isOnline
        ? `${chosen ? `${chosen.firstName} ${chosen.lastName}` : "Student"} was enrolled successfully.`
        : `${chosen ? `${chosen.firstName} ${chosen.lastName}` : "Student"} saved offline — will sync when back online.`,
    );

    enrollStudent({ studentId, grade, section })
      .then(async () => {
        if (currentGrade === grade && currentSection === section) {
          const docs = await getEnrolled(grade, section);
          setSectionStudents(await loadSectionStudents(docs));
        }
      })
      .catch((err) => {
        showToast(
          `Failed to enroll ${chosen ? `${chosen.firstName} ${chosen.lastName}` : "student"}: ${err.message}`,
          true,
        );
      });
  };

  // ── bulk select helpers (operate on the currently visible/filtered rows) ─
  const toggleSelectOne = (enrollId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(enrollId)) next.delete(enrollId);
      else next.add(enrollId);
      return next;
    });
  };

  // ── drop (bulk) ───────────────────────────────────────────────────────
  const bulkDrop = () => {
    if (selectedIds.size === 0) return;
    setConfirm({
      open: true,
      title: "Drop Students",
      titleIcon: "fa-user-times",
      titleColor: "#e74c3c",
      message: `Are you sure you want to drop ${selectedIds.size} selected student${selectedIds.size !== 1 ? "s" : ""}?`,
      confirmText: "Yes, Drop",
      confirmColor: "danger",
      onConfirm: () => {
        closeConfirm();
        const ids = Array.from(selectedIds);

        setSectionStudents((prev) => {
          const remaining = prev.filter((s) => !selectedIds.has(s.enrollId));
          maybeClearSchedules(remaining);
          return remaining;
        });
        setSelectedIds(new Set());
        showToast(
          isOnline
            ? `${ids.length} student(s) dropped.`
            : `${ids.length} student(s) dropped offline — will sync when back online.`,
        );

        Promise.allSettled(ids.map((id) => dropStudent(id))).then((settled) => {
          const failed = settled.filter((r) => r.status === "rejected").length;
          if (failed > 0) {
            showToast(`${failed} drop(s) failed to sync.`, true);
          }
        });
      },
    });
  };

  // ── promote / graduate (bulk) ─────────────────────────────────────────
  const bulkPromote = () => {
    if (selectedIds.size === 0) return;
    const isGrade6 = currentGrade === 6;
    const action = isGrade6 ? "Graduate" : "Promote";
    setConfirm({
      open: true,
      title: `${action} Students`,
      titleIcon: isGrade6 ? "fa-graduation-cap" : "fa-arrow-up",
      titleColor: "#2ecc71",
      message: `Confirm ${action.toLowerCase()} for ${selectedIds.size} selected student${selectedIds.size !== 1 ? "s" : ""}?`,
      confirmText: `Yes, ${action}`,
      confirmColor: "success",
      onConfirm: () => {
        closeConfirm();
        const ids = Array.from(selectedIds);

        setSectionStudents((prev) => {
          const remaining = prev.filter((s) => !selectedIds.has(s.enrollId));
          maybeClearSchedules(remaining);
          return remaining;
        });
        setSelectedIds(new Set());
        showToast(
          isOnline
            ? `${ids.length} student(s) successfully ${action.toLowerCase()}d!`
            : `${ids.length} student(s) ${action.toLowerCase()}d offline — will sync when back online.`,
        );

        Promise.allSettled(
          ids.map((id) =>
            isGrade6 ? graduateStudent(id) : promoteStudent(id),
          ),
        ).then((settled) => {
          const failed = settled.filter((r) => r.status === "rejected").length;
          if (failed > 0) {
            showToast(
              `${failed} ${action.toLowerCase()} action(s) failed to sync.`,
              true,
            );
          }
        });
      },
    });
  };

  // ════════════════════════════════════════════════════════════════════════
  // STUDENT BATCH ENROLL
  // ════════════════════════════════════════════════════════════════════════
  const handleStudentFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setStudentImportErrors([]);
    setStudentImportFinished(false);
    setStudentImportDone({ success: 0, failed: 0 });
    setStudentImportRows([]);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const rows = raw.slice(1).filter((r) => r.some((c) => c !== ""));

        const [allStudents, enrolledA, enrolledB] = await Promise.all([
          getStudents(currentGrade),
          getEnrolled(currentGrade, "A"),
          getEnrolled(currentGrade, "B"),
        ]);

        const allEnrolledDocs = [...enrolledA, ...enrolledB];
        const enrolledIds = new Set(
          allEnrolledDocs
            .filter((e) => e.status === "Enrolled")
            .map((e) => e.studentId),
        );
        const enrolledSectionMap = {};
        allEnrolledDocs
          .filter((e) => e.status === "Enrolled")
          .forEach((e) => {
            enrolledSectionMap[e.studentId] = e.section;
          });

        const parsed = rows.map((r, i) => {
          const lrn = String(r[0] || "").trim();
          const errs = [];
          if (!lrn) errs.push("LRN is empty");
          const match = allStudents.find((s) => String(s.lrn).trim() === lrn);
          if (!match) {
            errs.push(`LRN ${lrn} not found in Grade ${currentGrade}`);
          } else if (enrolledIds.has(match.id)) {
            const takenSection = enrolledSectionMap[match.id];
            errs.push(
              takenSection
                ? `Already enrolled in Grade ${currentGrade} – Section ${takenSection}`
                : "Already enrolled in another section",
            );
          }
          return {
            row: i + 2,
            lrn,
            name: match
              ? `${match.lastName}, ${match.firstName}${match.middleName ? ` ${match.middleName.charAt(0).toUpperCase()}.` : ""}`
              : "— Not found —",
            studentId: match?.id || null,
            grade: match?.grade || "—",
            errs,
          };
        });

        setStudentImportRows(parsed);
        setStudentImportOpen(true);
      } catch {
        setStudentImportErrors(["Failed to read file."]);
        setStudentImportOpen(true);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const handleStudentImportSave = () => {
    const validRows = studentImportRows.filter((r) => r.errs.length === 0);
    if (validRows.length === 0) return;
    guardStudentImport(() => doStudentImportSave(validRows));
  };

  const doStudentImportSave = (validRows) => {
    setStudentImportLoading(true);

    const grade = currentGrade;
    const section = currentSection;

    const pending = validRows.map((row) =>
      enrollStudent({ studentId: row.studentId, grade, section })
        .then(() => ({ ok: true, row }))
        .catch((err) => ({ ok: false, row, error: err })),
    );

    setStudentImportLoading(false);
    setStudentImportDone({ success: validRows.length, failed: 0 });
    setStudentImportFinished(true);
    setStudentImportErrors([]);
    setStudentImportRows([]);
    showToast(
      isOnline
        ? `${validRows.length} student${validRows.length !== 1 ? "s" : ""} enrolled successfully.`
        : `${validRows.length} student${validRows.length !== 1 ? "s" : ""} saved offline — will sync when back online.`,
    );

    Promise.allSettled(pending).then(async (settled) => {
      const failMsgs = [];
      settled.forEach((s) => {
        const outcome = s.value;
        if (outcome && !outcome.ok) {
          failMsgs.push(
            `LRN ${outcome.row.lrn} (${outcome.row.name}): ${outcome.error.message}`,
          );
        }
      });

      if (currentGrade === grade && currentSection === section) {
        try {
          const docs = await getEnrolled(grade, section);
          setSectionStudents(await loadSectionStudents(docs));
        } catch (e) {
          console.error("Failed to refresh section after import:", e);
        }
      }

      if (failMsgs.length > 0) {
        setStudentImportErrors(failMsgs);
        showToast(`${failMsgs.length} enrolled row(s) failed to save.`, true);
      }
    });
  };

  const closeStudentImportModal = () => {
    setStudentImportOpen(false);
    setStudentImportRows([]);
    setStudentImportErrors([]);
    setStudentImportFinished(false);
    setStudentImportDone({ success: 0, failed: 0 });
    if (studentFileRef.current) studentFileRef.current.value = "";
  };

  const studentValidCount = studentImportRows.filter(
    (r) => r.errs.length === 0,
  ).length;
  const studentInvalidCount = studentImportRows.filter(
    (r) => r.errs.length > 0,
  ).length;

  // ── save schedule (add / edit) ────────────────────────────────────────
  const saveSchedule = (e) => {
    e.preventDefault();
    setFormError("");
    if (!schedForm.startTime || !schedForm.endTime) {
      setFormError("Please configure both standard start and end hours.");
      return;
    }
    if (schedForm.startTime >= schedForm.endTime) {
      setFormError("Start time must be strictly before the end time parameter.");
      return;
    }
    if (!schedForm.teacherId) {
      setFormError("Please assign a section teacher.");
      return;
    }
    if (takenSubjectsInSection.has(schedForm.subject)) {
      setFormError(
        `${schedForm.subject} is already scheduled in this section at another time slot.`,
      );
      return;
    }
    const teacherConflict = teacherConflictMap[schedForm.teacherId];
    if (teacherConflict) {
      setFormError(
        `This teacher is already teaching Grade ${teacherConflict.grade}-${teacherConflict.section} at this time slot.`,
      );
      return;
    }
    guardSchedule(() => doSaveSchedule());
  };

  const doSaveSchedule = () => {
    const payload = {
      subject: schedForm.subject,
      timeSlot: `${schedForm.startTime}-${schedForm.endTime}`,
      start: schedForm.startTime,
      end: schedForm.endTime,
      teacherId: schedForm.teacherId,
      days: "Sunday – Thursday",
    };
    const wasEditing = isEditingSched;
    const editingId = editSchedId;
    const grade = currentGrade;
    const section = currentSection;

    setShowScheduleModal(false);
    showToast(
      isOnline
        ? `Schedule ${wasEditing ? "updated" : "saved"} successfully.`
        : `Schedule saved offline — will sync when back online.`,
    );

    const savePromise = wasEditing
      ? updateSchedule(editingId, payload)
      : addSchedule({ ...payload, grade, section });

    savePromise
      .then((result) => {
        if (currentGrade !== grade || currentSection !== section) return;
        if (wasEditing) {
          setSchedules((prev) =>
            prev.map((s) => (s.id === editingId ? result : s)),
          );
        } else {
          setSchedules((prev) => [...prev, result]);
        }
      })
      .catch((err) => {
        showToast(`Failed to save schedule: ${err.message}`, true);
      });
  };

  const openAddScheduleModal = () => {
    setIsEditingSched(false);
    setEditSchedId(null);
    setSchedForm({
      subject: SUBJECTS[0],
      startTime: "",
      endTime: "",
      teacherId: "",
    });
    setFormError("");
    setShowScheduleModal(true);
  };

  const openEditScheduleModal = (sched) => {
    setIsEditingSched(true);
    setEditSchedId(sched.id);
    setSchedForm({
      subject: sched.subject || SUBJECTS[0],
      startTime: sched.start || "",
      endTime: sched.end || "",
      teacherId: sched.teacherId || "",
    });
    setFormError("");
    setShowScheduleModal(true);

    // Refresh the full cross-section/grade schedule list so the subject
    // and teacher dropdowns reflect the latest conflicts, not stale data.
  
 async function refresherSchedules(){
    try {
      setAllSchedules(await getSchedules());
    } catch (e) {
      console.error("Failed to refresh schedules for conflict check:", e);
    }
  };

  async function checkConflicts(){
    try {
      setAllSchedules(await getSchedules());
    } catch (e) {
      console.error("Failed to refresh schedules for conflict check:", e);
    }
  };

  const handleSelectGrade = (level) =>
    setCurrentGrade(currentGrade === level ? null : level);

  const handleSelectSection = (sec) => {
    setCurrentSection(sec);
    setCurrentView("view-action");
  };

  const teacherName = (id) => {
    const t = teachers.find((t) => t.id === id);
    return t ? `${t.fname} ${t.lname}` : "—";
  };

  const studentDisplayName = (s) =>
    `${s.lastName}, ${s.firstName}${s.middleName ? ` ${s.middleName.charAt(0).toUpperCase()}.` : ""}`;

  // ── SEARCH AND INLINE MASTERLIST SORT MATRIX ENGINE (FIXED) ──
  const handleStudentSortToggle = (field) => {
    if (studentSortField === field) {
      setStudentSortOrder(studentSortOrder === "asc" ? "desc" : "asc");
    } else {
      setStudentSortField(field);
      setStudentSortOrder("asc");
    }
  };

  const filteredSectionStudents = sectionStudents.filter((s) => {
    const q = studentSearchQuery.trim().toLowerCase();
    if (!q) return true;
    const fullName = studentDisplayName(s).toLowerCase();
    return fullName.includes(q) || String(s.lrn).toLowerCase().includes(q);
  });

  const sortedSectionStudents = [...filteredSectionStudents].sort((a, b) => {
    if (studentSortField === "lrn") {
      const lrnA = String(a.lrn || "");
      const lrnB = String(b.lrn || "");
      return studentSortOrder === "asc"
        ? lrnA.localeCompare(lrnB, undefined, { numeric: true })
        : lrnB.localeCompare(lrnA, undefined, { numeric: true });
    }
    if (studentSortField === "name") {
      const nameA = studentDisplayName(a).toLowerCase();
      const nameB = studentDisplayName(b).toLowerCase();
      return studentSortOrder === "asc" 
        ? nameA.localeCompare(nameB) 
        : nameB.localeCompare(nameA);
    }
    return 0;
  });

  // Accurate check to see if every single sorted student is explicitly selected
  const allSelected =
    sortedSectionStudents.length > 0 &&
    sortedSectionStudents.every((s) => selectedIds.has(s.enrollId));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        sortedSectionStudents.forEach((s) => next.delete(s.enrollId));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        sortedSectionStudents.forEach((s) => next.add(s.enrollId));
        return next;
      });
    }
  };

  const sortedSchedules = [...schedules].sort((a, b) => {
    return (a.start || "").localeCompare(b.start || "");
  });

  return (
    <main className="main-content">
      <Toast toast={toast} />

      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        titleIcon={confirm.titleIcon}
        titleColor={confirm.titleColor}
        message={confirm.message}
        confirmText={confirm.confirmText}
        confirmColor={confirm.confirmColor}
        onConfirm={confirm.onConfirm}
        onCancel={closeConfirm}
      />

      {loading && <div className="loading-banner">Loading…</div>}
      {error && <div className="error-banner">⚠ {error}</div>}

      <div className="page-container">
        {/* ── GRADE LIST ── */}
        {currentView === "view-grade" && (
          <div className="view-section active">
            <div className="toolbar-mc">
              <h2 className="section-title-mc">Manage Grade Levels</h2>
            </div>
            <div className="grade-accordion-list">
              {[1, 2, 3, 4, 5, 6].map((num) => (
                <div key={num} className="grade-item-container">
                  <div
                    className={`class-card grade-card ${currentGrade === num ? "active-bar" : ""}`}
                    onClick={() => handleSelectGrade(num)}
                  >
                    <div className={`icon-circle bg-${num}`}>{num}</div>
                    <h3>Grade Level {num}</h3>
                    <div className="grade-right">
                      <span>View Sections</span>
                      <i
                        className={`fas fa-chevron-${currentGrade === num ? "up" : "down"}`}
                      />
                    </div>
                  </div>
                  {currentGrade === num && (
                    <div className="section-expansion">
                      {["A", "B"].map((sec) => (
                        <div
                          key={sec}
                          className="section-card"
                          onClick={() => handleSelectSection(sec)}
                        >
                          <div className="icon-box-mc">
                            <i className="fas fa-users" />
                          </div>
                          <h3>Section {sec}</h3>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ACTION INTERFACE ── */}
        {currentView === "view-action" && (
          <div className="view-section active">
            <div className="toolbar-mc">
              <button
                className="btn-back-mc"
                onClick={() => setCurrentView("view-grade")}
              >
                <i className="fas fa-arrow-left" />
              </button>
              <h2 className="section-title-mc">
                Manage Grade {currentGrade} – Section {currentSection}
              </h2>
            </div>
            <div className="grid-container">
              <div
                className="section-card action-card"
                onClick={() => setCurrentView("view-masterlist")}
              >
                <div className="icon-box-mc">
                  <i className="fas fa-clipboard-list" />
                </div>
                <h3>Manage Masterlist</h3>
              </div>
              <div
                className="section-card action-card"
                onClick={() => setCurrentView("view-schedule")}
              >
                <div className="icon-box-mc">
                  <i className="fas fa-calendar-alt"></i>
                </div>
                <h3>Manage Schedule</h3>
              </div>
            </div>
          </div>
        )}

        {/* ── MASTERLIST ── */}
        {currentView === "view-masterlist" && (
          <div className="view-section active">
            <div className="toolbar-mc">
              <button
                className="btn-back-mc"
                onClick={() => {
                  setCurrentView("view-action");
                  setStudentSearchQuery(""); 
                }}
              >
                <i className="fas fa-arrow-left" />
              </button>
              
              <h3>Grade {currentGrade} – Section {currentSection} Masterlist</h3>

              <input
                ref={studentFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "none" }}
                onChange={handleStudentFileChange}
              />
              
              <div className="mc-toolbar-actions">
                <div className="mc-student-search-container">
                  <i className="fas fa-search mc-student-search-icon"></i>
                  <input
                    type="text"
                    className="mc-student-search-input"
                    placeholder="Search name or LRN..."
                    value={studentSearchQuery}
                    onChange={(e) => setStudentSearchQuery(e.target.value)}
                  />
                  {studentSearchQuery && (
                    <button
                      className="mc-student-search-clear"
                      onClick={() => setStudentSearchQuery("")}
                    >
                      &times;
                    </button>
                  )}
                </div>

                {/* Bulk Options (Visible when selectedIds.size > 0) */}
                {selectedIds.size > 0 && (
                  <>
                    <span className="selected-count-badge" style={{ background: "#ddeeff", color: "#2c6fad", padding: "6px 14px", borderRadius: "20px", fontWeight: "700", fontSize: "0.85rem" }}>
                      {selectedIds.size} selected
                    </span>
                    <button className="btn-bulk-drop" onClick={bulkDrop} style={{ background: "#f1c40f", color: "black", border: "none", padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>
                      <i className="fas fa-user-minus"></i> Drop
                    </button>
                    <button className="btn-bulk-promote" onClick={bulkPromote} style={{ background: "#a55f81", color: "white", border: "none", padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>
                      <i className="fas fa-arrow-up"></i> {currentGrade === 6 ? "Graduate" : "Promote"}
                    </button>
                  </>
                )}

                <div style={{ position: "relative" }} ref={addMenuRef}>
                  <button
                    className="btn-add-mc"
                    onClick={() => setAddMenuOpen(!addMenuOpen)}
                  >
                    <i className="fas fa-plus" /> Add Student
                  </button>
                  {addMenuOpen && (
                    <div className="add-menu-popup">
                      <button
                        className="add-menu-item"
                        onClick={() => {
                          setAddMenuOpen(false);
                          openEnrollModal();
                        }}
                      >
                        <i
                          className="fas fa-user-plus"
                          style={{ color: "#a65f81" }}
                        ></i>
                        Add Student Manually
                      </button>
                      <div className="add-menu-divider" />
                      <button
                        className="add-menu-item"
                        onClick={() => {
                          setAddMenuOpen(false);
                          studentFileRef.current?.click();
                        }}
                      >
                        <i
                          className="fas fa-file-import"
                          style={{ color: "#27ae60" }}
                        ></i>
                        Import Student
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── search bar (same design as Manage Students) ── */}
            <div className="mc-search-bar-row">
              <div className="mc-search-input-wrap">
                <i className="fas fa-search mc-search-icon"></i>
                <input
                  type="text"
                  className="mc-search-input"
                  placeholder="Search name or LRN…"
                  value={masterlistSearch}
                  onChange={(e) => setMasterlistSearch(e.target.value)}
                />
                {masterlistSearch && (
                  <button
                    type="button"
                    className="mc-search-clear"
                    onClick={() => setMasterlistSearch("")}
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <div className="table-container-mc">
              <table className="data-table-mc">
                <thead>
                  <tr>
                    <th style={{ width: "40px" }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        disabled={sortedSectionStudents.length === 0}
                      />
                    </th>
                    <th
                      onClick={() => handleStudentSortToggle("lrn")}
                      className="sortable-table-header"
                    >
                      LRN
                      <i className={`fas ${studentSortField === "lrn" ? (studentSortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                      <span className="mt-sort-hint-label">(sort)</span>
                    </th>
                    <th
                      onClick={() => handleStudentSortToggle("name")}
                      className="sortable-table-header"
                    >
                      Name
                      <i className={`fas ${studentSortField === "name" ? (studentSortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                      <span className="mt-sort-hint-label">(sort)</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSectionStudents.length > 0 ? (
                    sortedSectionStudents.map((student) => (
                      <tr
                        key={student.enrollId}
                        className={selectedIds.has(student.enrollId) ? "row-selected" : ""}
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(student.enrollId)}
                            onChange={() => toggleSelectOne(student.enrollId)}
                          />
                        </td>
                        <td onClick={() => toggleSelectOne(student.enrollId)} style={{ cursor: "pointer" }}>{student.lrn}</td>
                        <td onClick={() => toggleSelectOne(student.enrollId)} style={{ cursor: "pointer" }}>{studentDisplayName(student)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan="3"
                        style={{ textAlign: "center", padding: "20px" }}
                      >
                        {studentSearchQuery ? `No matching students found inside this section configuration records.` : "No students enrolled in this section."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SCHEDULE MAINTENANCE WINDOW ── */}
        {currentView === "view-schedule" && (
          <div className="view-section active">
            <div className="toolbar-mc">
              <button
                className="btn-back-mc"
                onClick={() => setCurrentView("view-action")}
              >
                <i className="fas fa-arrow-left" />
              </button>
              <h3>Class Schedule</h3>
              
              <button className="btn-add-mc" onClick={openAddScheduleModal}>
                <i className="fas fa-plus"></i> Add Schedule
              </button>
            </div>

            <div className="day-badge">
              <i className="fas fa-calendar-week"></i>
              Schedule runs{" "}
              <strong style={{ marginLeft: "4px" }}>Sunday – Thursday</strong>
            </div>

            <div className="table-container-mc">
              <table className="data-table-mc">
                <thead>
                  <tr>
                    <th
                      className="mc-th-sortable"
                      onClick={() => handleScheduleSort("time")}
                    >
                      Time{" "}
                      <SortIcon
                        active={scheduleSort.key === "time"}
                        direction={scheduleSort.direction}
                      />
                    </th>
                    <th
                      className="mc-th-sortable"
                      onClick={() => handleScheduleSort("subject")}
                    >
                      Subject{" "}
                      <SortIcon
                        active={scheduleSort.key === "subject"}
                        direction={scheduleSort.direction}
                      />
                    </th>
                    <th
                      className="mc-th-sortable"
                      onClick={() => handleScheduleSort("teacher")}
                    >
                      Teacher{" "}
                      <SortIcon
                        active={scheduleSort.key === "teacher"}
                        direction={scheduleSort.direction}
                      />
                    </th>
                    <th style={{ textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSchedules.length > 0 ? (
                    sortedSchedules.map((sched) => (
                      <tr key={sched.id}>
                        <td>
                          <strong>
                            {formatTimeLabel(sched.start)} – {formatTimeLabel(sched.end)}
                          </strong>
                        </td>
                        <td>{sched.subject}</td>
                        <td>{teacherName(sched.teacherId)}</td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            className="btn-action btn-edit"
                            onClick={() => openEditScheduleModal(sched)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan="4"
                        style={{ textAlign: "center", padding: "30px", color: "#888" }}
                      >
                        No timelines configured yet. Click "+ Add Schedule" to allocate a custom timeline slot.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── MANUAL ENROLL MODAL ── */}
      {showStudentModal && (
        <div className="modal-overlay modal-open">
          <div className="modal-content-mc">
            <div className="modal-header-mc">
              <h3>Enroll Student</h3>
              <span
                className="close-modal-mc"
                onClick={() => setShowStudentModal(false)}
              >
                &times;
              </span>
            </div>
            <form onSubmit={enroll}>
              <div className="modal-body-mc">
                <div className="form-group-mc">
                  <label>Select Student</label>
                  {eligibleStudents.length === 0 ? (
                    <p style={{ color: "#888", fontSize: "0.9rem" }}>
                      No eligible students for Grade {currentGrade}.
                    </p>
                  ) : (
                    <select
                      required
                      value={selectedStudentId}
                      onChange={(e) => setSelectedStudentId(e.target.value)}
                    >
                      <option value="">— Select a student —</option>
                      {eligibleStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.lastName}, {s.firstName}
                          {s.middleName ? " " + s.middleName : ""} | LRN:{" "}
                          {s.lrn}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {formError && (
                  <p
                    style={{
                      color: "red",
                      fontSize: "0.85rem",
                      marginTop: "8px",
                    }}
                  >
                    ⚠ {formError}
                  </p>
                )}
              </div>
              <div className="modal-footer-mc">
                <button
                  type="button"
                  className="btn-cancel-mc"
                  onClick={() => setShowStudentModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-save-mc"
                  disabled={eligibleStudents.length === 0}
                >
                  Enroll Student
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── TIMELINE SCHEDULE MODAL ── */}
      {showScheduleModal && (
        <div className="modal-overlay modal-open">
          <div className="modal-content-mc">
            <div className="modal-header-mc">
              <h3>{isEditingSched ? "Modify Timeline Slot" : "Add Timeline Slot"}</h3>
              <span
                className="close-modal-mc"
                onClick={() => setShowScheduleModal(false)}
              >
                &times;
              </span>
            </div>
            <form onSubmit={saveSchedule}>
              <div className="modal-body-mc">
                <div className="form-group-mc" style={{ display: "flex", gap: "12px", BoneBottom: "15px" }}>
                  <div style={{ flex: 1 }}>
                    <label>Start Time</label>
                    <input
                      type="time"
                      required
                      value={schedForm.startTime}
                      onChange={(e) =>
                        setSchedForm({ ...schedForm, startTime: e.target.value })
                      }
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>End Time</label>
                    <input
                      type="time"
                      required
                      value={schedForm.endTime}
                      onChange={(e) =>
                        setSchedForm({ ...schedForm, endTime: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="form-group-mc">
                  <label>Subject</label>
                  <select
                    value={schedForm.subject}
                    onChange={(e) =>
                      setSchedForm({ ...schedForm, subject: e.target.value })
                    }
                  >
                    {SUBJECTS.map((s) => {
                      const taken = takenSubjectsInSection.has(s);
                      return (
                        <option key={s} value={s} disabled={taken}>
                          {s}
                          {taken ? " — Already scheduled in this section" : ""}
                        </option>
                      );
                    })}
                  </select>
                  {takenSubjectsInSection.has(schedForm.subject) && (
                    <p
                      style={{
                        color: "#e67e22",
                        fontSize: "0.78rem",
                        marginTop: "4px",
                      }}
                    >
                      ⚠ This subject is already scheduled in this section at
                      another time slot.
                    </p>
                  )}
                </div>

                <div className="form-group-mc">
                  <label>Teacher</label>
                  {teachers.length === 0 ? (
                    <p style={{ color: "#888", fontSize: "0.9rem" }}>
                      No teachers found.
                    </p>
                  ) : (
                    <select
                      required
                      value={schedForm.teacherId}
                      onChange={(e) =>
                        setSchedForm({
                          ...schedForm,
                          teacherId: e.target.value,
                        })
                      }
                    >
                      <option value="">— Select a teacher —</option>
                      {teachers.map((t) => {
                        const conflict = teacherConflictMap[t.id];
                        return (
                          <option key={t.id} value={t.id} disabled={!!conflict}>
                            {t.fname} {t.mname ? t.mname + " " : ""}
                            {t.lname}
                            {t.advisory ? ` (Advisory: ${t.advisory})` : ""}
                            {/* CHANGED: shortened from the full
                                "— Already teaching Grade X-Y at this time"
                                sentence. Native <select>/<option> elements
                                are rendered by the OS/browser widget, not
                                by page CSS — white-space, max-width, and
                                overflow rules don't apply inside <option>
                                text, so a long label just pushes the whole
                                dropdown wider than the modal (and the
                                viewport). The full explanation is still
                                shown to the admin below, in the warning
                                <p> under this <select>, which is a normal
                                DOM element and wraps correctly. */}
                            {conflict ? " — Unavailable" : ""}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  {schedForm.teacherId &&
                    teacherConflictMap[schedForm.teacherId] && (
                      <p
                        style={{
                          color: "#e67e22",
                          fontSize: "0.78rem",
                          marginTop: "4px",
                        }}
                      >
                        ⚠ This teacher is already teaching Grade{" "}
                        {teacherConflictMap[schedForm.teacherId].grade}-
                        {teacherConflictMap[schedForm.teacherId].section} at
                        this time slot.
                      </p>
                    )}
                </div>

                {formError && (
                  <p
                    style={{
                      color: "red",
                      fontSize: "0.85rem",
                      marginTop: "8px",
                    }}
                  >
                    ⚠ {formError}
                  </p>
                )}
              </div>
              <div className="modal-footer-mc">
                <button
                  type="button"
                  className="btn-cancel-mc"
                  onClick={() => setShowScheduleModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-save-mc">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── STUDENT IMPORT PREVIEW MODAL ── */}
      {studentImportOpen && (
        <div className="modal-overlay modal-open" style={{ zIndex: 9999 }}>
          <div
            className="modal-content-mc"
            style={{ maxWidth: "720px", width: "95%" }}
          >
            <div className="modal-header-mc">
              <h3>
                <i
                  className="fas fa-file-import"
                  style={{ marginRight: "8px" }}
                ></i>
                Import Students — Grade {currentGrade} Section {currentSection}
              </h3>
              <span
                className="close-modal-mc"
                onClick={closeStudentImportModal}
              >
                &times;
              </span>
            </div>
            <div className="modal-body-mc">
              <div
                style={{
                  background: "#eaf4fb",
                  border: "1px solid #aed6f1",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  marginBottom: "14px",
                  fontSize: "0.82rem",
                  color: "#2980b9",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <i className="fas fa-info-circle"></i>
                Upload the Excel file downloaded from <strong>Manage Students</strong>. Students are matched by LRN.
              </div>

              {studentImportErrors.length > 0 && !studentImportFinished && (
                <div className="import-error-box">
                  {studentImportErrors.map((e, i) => (
                    <div key={i}>⚠ {e}</div>
                  ))}
                </div>
              )}

              {studentImportRows.length > 0 && (
                <>
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      marginBottom: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="import-badge import-badge-ok">
                      <i className="fas fa-check-circle"></i>{" "}
                      {studentValidCount} valid
                    </span>
                    {studentInvalidCount > 0 && (
                      <span className="import-badge import-badge-err">
                        <i className="fas fa-times-circle"></i>{" "}
                        {studentInvalidCount} with errors
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      overflowX: "auto",
                      maxHeight: "300px",
                      overflowY: "auto",
                    }}
                  >
                    <table
                      className="data-table-mc"
                      style={{ fontSize: "0.8rem" }}
                    >
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>LRN</th>
                          <th>Name</th>
                          <th>Grade</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentImportRows.map((r) => (
                          <tr
                            key={r.row}
                            style={{
                              background: r.errs.length > 0 ? "#fff5f5" : "",
                            }}
                          >
                            <td>{r.row}</td>
                            <td>{r.lrn}</td>
                            <td>{r.name}</td>
                            <td>{r.grade}</td>
                            <td>
                              {r.errs.length === 0 ? (
                                <span
                                  style={{ color: "#27ae60", fontWeight: 600 }}
                                >
                                  ✓ Ready to Enroll
                                </span>
                              ) : (
                                <span
                                  style={{
                                    color: "#e74c3c",
                                    fontSize: "0.75rem",
                                  }}
                                >
                                  {r.errs.join(", ")}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {studentImportFinished && (
                <div style={{ marginTop: "12px" }}>
                  {studentImportDone.success > 0 && (
                    <div className="import-result-ok">
                      <i className="fas fa-check-circle"></i>{" "}
                      {studentImportDone.success} student(s){" "}
                      {isOnline
                        ? "enrolled successfully."
                        : "saved offline — will sync when back online."}
                    </div>
                  )}
                  {studentImportErrors.length > 0 && (
                    <div className="import-error-box">
                      {studentImportErrors.map((e, i) => (
                        <div key={i}>⚠ {e}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-footer-mc">
              <button
                className="btn-cancel-mc"
                onClick={closeStudentImportModal}
              >
                {studentImportFinished ? "Close" : "Cancel"}
              </button>
              {!studentImportFinished &&
                studentImportRows.length > 0 &&
                studentValidCount > 0 && (
                  <button
                    className="btn-save-mc"
                    onClick={handleStudentImportSave}
                    disabled={studentImportLoading}
                  >
                    {studentImportLoading
                      ? `Enrolling… (${studentValidCount})`
                      : `Enroll ${studentValidCount} Student${studentValidCount !== 1 ? "s" : ""}`}
                  </button>
                )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
}
export default ManageClasses;
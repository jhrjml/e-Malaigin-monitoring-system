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

// ── Pre-defined time slots ────────────────────────────────────────────────
const TIME_SLOTS = [
  { value: "07:20-08:05", label: "7:20 AM – 8:05 AM" },
  { value: "08:05-08:50", label: "8:05 AM – 8:50 AM" },
  { value: "08:50-9:35", label: "8:50 AM – 9:35 AM" },
  { value: "9:55-10:40", label: "9:55 AM – 10:40 AM" },
  { value: "10:40-11:25", label: "10:40 AM – 11:25 AM" },
  { value: "13:00-13:45", label: "1:00 PM – 1:45 PM" },
  { value: "13:45-14:30", label: "1:45 PM – 2:30 PM" },
  { value: "14:30-15:15", label: "2:30 PM – 3:15 PM" },
  { value: "15:15-16:00", label: "3:15 PM – 4:00 PM" },
];

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

const slotLabel = (value) =>
  TIME_SLOTS.find((s) => s.value === value)?.label ?? value;

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

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [showStudentModal, setShowStudentModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [isEditingSched, setIsEditingSched] = useState(false);
  const [editSchedId, setEditSchedId] = useState(null);
  const [selectedStudentId, setSelectedStudentId] = useState("");

  // ── bulk select ─────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState(new Set());

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

  const [schedForm, setSchedForm] = useState({
    subject: "Math",
    timeSlot: "",
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

  // Offline-safe enroll: closes the modal and shows success immediately,
  // fires the write in the background, and refreshes the list once it
  // resolves (instantly online, on reconnect if offline).
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
        // Only refresh the visible list if the user is still viewing
        // that same grade/section.
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

  // ── bulk select helpers ───────────────────────────────────────────────
  const toggleSelectOne = (enrollId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(enrollId)) next.delete(enrollId);
      else next.add(enrollId);
      return next;
    });
  };

  const allSelected =
    sectionStudents.length > 0 && selectedIds.size === sectionStudents.length;

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sectionStudents.map((s) => s.enrollId)));
  };

  // ── drop (single) ─────────────────────────────────────────────────────
  const drop = (student) => {
    setConfirm({
      open: true,
      title: "Drop Student",
      titleIcon: "fa-user-times",
      titleColor: "#e74c3c",
      message: (
        <>
          Are you sure you want to drop{" "}
          <strong>
            {student.lastName}, {student.firstName}
          </strong>{" "}
          from this section?
        </>
      ),
      confirmText: "Yes, Drop",
      confirmColor: "danger",
      onConfirm: () => {
        closeConfirm();
        // Optimistic UI update — offline-safe.
        setSectionStudents((prev) => {
          const remaining = prev.filter((s) => s.enrollId !== student.enrollId);
          maybeClearSchedules(remaining);
          return remaining;
        });
        setSelectedIds((prev) => {
          const n = new Set(prev);
          n.delete(student.enrollId);
          return n;
        });
        showToast(
          isOnline
            ? `${student.firstName} ${student.lastName} has been dropped.`
            : `${student.firstName} ${student.lastName} dropped offline — will sync when back online.`,
        );
        dropStudent(student.enrollId).catch((e) => {
          showToast(e.message || "Failed to drop student.", true);
        });
      },
    });
  };

  // ── promote / graduate (single) ───────────────────────────────────────
  const promote = (student) => {
    const isGrade6 = currentGrade === 6;
    const action = isGrade6 ? "Graduate" : "Promote";
    setConfirm({
      open: true,
      title: `${action} Student`,
      titleIcon: isGrade6 ? "fa-graduation-cap" : "fa-arrow-up",
      titleColor: "#2ecc71",
      message: (
        <>
          Confirm {action.toLowerCase()} for{" "}
          <strong>
            {student.lastName}, {student.firstName}
          </strong>
          ?
        </>
      ),
      confirmText: `Yes, ${action}`,
      confirmColor: "success",
      onConfirm: () => {
        closeConfirm();
        setSectionStudents((prev) => {
          const remaining = prev.filter((s) => s.enrollId !== student.enrollId);
          maybeClearSchedules(remaining);
          return remaining;
        });
        setSelectedIds((prev) => {
          const n = new Set(prev);
          n.delete(student.enrollId);
          return n;
        });
        showToast(
          isOnline
            ? `${student.firstName} ${student.lastName} was successfully ${action.toLowerCase()}d!`
            : `${student.firstName} ${student.lastName} ${action.toLowerCase()}d offline — will sync when back online.`,
        );
        const opPromise = isGrade6
          ? graduateStudent(student.enrollId)
          : promoteStudent(student.enrollId);
        opPromise.catch((e) => {
          showToast(
            e.message || `Failed to ${action.toLowerCase()} student.`,
            true,
          );
        });
      },
    });
  };

  // ── drop (bulk) ───────────────────────────────────────────────────────
  // Offline-safe: fires all drops at once instead of awaiting each in a
  // sequential loop (which used to hang on the first item while offline).
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

  // Offline-safe bulk enroll — see ManageStudents.jsx for the full
  // explanation. All valid rows are enrolled in parallel (never awaited
  // one-by-one), the modal closes immediately with an optimistic result,
  // and the section list is refreshed quietly in the background.
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

    // Close the import modal right away with an optimistic result.
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

    // Reconcile quietly in the background once writes actually resolve.
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

      // Only refresh the visible list if still viewing the same section.
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
    if (!schedForm.timeSlot) {
      setFormError("Please select a time slot.");
      return;
    }
    if (!schedForm.teacherId) {
      setFormError("Please select a teacher.");
      return;
    }
    guardSchedule(() => doSaveSchedule());
  };

  const doSaveSchedule = () => {
    const [start, end] = schedForm.timeSlot.split("-");
    const payload = {
      subject: schedForm.subject,
      timeSlot: schedForm.timeSlot,
      start,
      end,
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

  const openEditScheduleModal = (slotValue) => {
    const existing = schedules.find(
      (s) => (s.timeSlot || `${s.start}-${s.end}`) === slotValue,
    );
    setIsEditingSched(!!existing);
    setEditSchedId(existing ? existing.id : null);
    setSchedForm({
      subject: existing?.subject || SUBJECTS[0],
      timeSlot: slotValue,
      teacherId: existing?.teacherId || "",
    });
    setFormError("");
    setShowScheduleModal(true);
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

  const scheduleRows = TIME_SLOTS.map((slot) => {
    const existing = schedules.find(
      (s) => (s.timeSlot || `${s.start}-${s.end}`) === slot.value,
    );
    return {
      timeSlot: slot.value,
      timeLabel: slot.label,
      subject: existing?.subject || null,
      teacherId: existing?.teacherId || null,
      assigned: !!existing,
    };
  });

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
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

        {/* ── ACTION ── */}
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
            <div
              className="grid-container"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "20px",
              }}
            >
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
                  <i className="fas fa-calendar-alt" />
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
                onClick={() => setCurrentView("view-action")}
              >
                <i className="fas fa-arrow-left" />
              </button>
              <h3>Section Masterlist</h3>

              <input
                ref={studentFileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "none" }}
                onChange={handleStudentFileChange}
              />

              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                {selectedIds.size > 0 && (
                  <>
                    <span className="selected-count-badge">
                      {selectedIds.size} selected
                    </span>
                    <button className="btn-bulk-drop" onClick={bulkDrop}>
                      <i className="fas fa-user-times"></i> Drop
                    </button>
                    <button className="btn-bulk-promote" onClick={bulkPromote}>
                      <i className="fas fa-arrow-up"></i>{" "}
                      {currentGrade === 6 ? "Graduate" : "Promote"}
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

            <div className="table-container">
              <table className="data-table-mc">
                <thead>
                  <tr>
                    <th style={{ width: "40px" }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        disabled={sectionStudents.length === 0}
                      />
                    </th>
                    <th>LRN</th>
                    <th>Name</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionStudents.length > 0 ? (
                    sectionStudents.map((student) => (
                      <tr
                        key={student.enrollId}
                        className={
                          selectedIds.has(student.enrollId)
                            ? "row-selected"
                            : ""
                        }
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(student.enrollId)}
                            onChange={() => toggleSelectOne(student.enrollId)}
                          />
                        </td>
                        <td>{student.lrn}</td>
                        <td>{studentDisplayName(student)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan="3"
                        style={{ textAlign: "center", padding: "20px" }}
                      >
                        No students enrolled in this section.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SCHEDULE ── */}
        {currentView === "view-schedule" && (
          <div className="view-section active">
            <div className="toolbar-mc">
              <button
                className="btn-back-mc"
                onClick={() => setCurrentView("view-action")}
              >
                <i className="fas fa-arrow-left" /> Back
              </button>
              <h3>Class Schedule</h3>
            </div>

            <div className="day-badge">
              <i className="fas fa-calendar-week"></i>
              Schedule runs{" "}
              <strong style={{ marginLeft: "4px" }}>Sunday – Thursday</strong>
            </div>

            <div className="table-container">
              <table className="data-table-mc">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Subject</th>
                    <th>Teacher</th>
                    <th style={{ textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.map((row) => (
                    <tr key={row.timeSlot}>
                      <td>
                        <strong>{row.timeLabel}</strong>
                      </td>
                      <td>
                        {row.assigned ? (
                          row.subject
                        ) : (
                          <span style={{ color: "#aaa" }}>— Unassigned —</span>
                        )}
                      </td>
                      <td>
                        {row.assigned ? (
                          teacherName(row.teacherId)
                        ) : (
                          <span style={{ color: "#aaa" }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          className="btn-action btn-edit"
                          onClick={() => openEditScheduleModal(row.timeSlot)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
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

      {/* ── SCHEDULE MODAL (Add / Edit) ── */}
      {showScheduleModal && (
        <div className="modal-overlay modal-open">
          <div className="modal-content-mc">
            <div className="modal-header-mc">
              <h3>Edit Schedule</h3>
              <span
                className="close-modal-mc"
                onClick={() => setShowScheduleModal(false)}
              >
                &times;
              </span>
            </div>
            <form onSubmit={saveSchedule}>
              <div className="modal-body-mc">
                <div
                  style={{
                    background: "#f8f9fa",
                    border: "1px solid #eee",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    marginBottom: "14px",
                    fontSize: "0.85rem",
                    color: "#555",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <i className="fas fa-clock"></i>
                  Time slot:{" "}
                  <strong style={{ marginLeft: "3px" }}>
                    {slotLabel(schedForm.timeSlot)}
                  </strong>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: "0.75rem",
                      color: "#999",
                    }}
                  >
                    (not editable)
                  </span>
                </div>

                <div className="form-group-mc">
                  <label>Subject</label>
                  <select
                    value={schedForm.subject}
                    onChange={(e) =>
                      setSchedForm({ ...schedForm, subject: e.target.value })
                    }
                  >
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
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
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.fname} {t.mname ? t.mname + " " : ""}
                          {t.lname}
                          {t.advisory ? ` (Advisory: ${t.advisory})` : ""}
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
                Upload the Excel file downloaded from{" "}
                <strong>Manage Students</strong>. Students are matched by LRN.
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

export default ManageClasses;

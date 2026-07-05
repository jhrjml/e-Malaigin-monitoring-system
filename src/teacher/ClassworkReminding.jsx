// ClassworkReminding.jsx
// OFFLINE-SAFE VERSION — see ManageStudents.jsx header comment for the
// full explanation of the pattern used here.
// PUSH NOTIFICATIONS — doSave() now queues a notification to parents of
// every enrolled student in this section after posting.
import { useState, useEffect } from "react";
import { db } from "../api/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  getDoc,
} from "firebase/firestore";
import { queueNotification, getParentIdsForStudents } from "../api/firebaseApi";
import useSubmitGuard from "../common/useSubmitGuard";
import useNetworkStatus from "../common/useNetworkStatus"; // adjust path if different
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./ClassworkReminding.css";

const col = (name) => collection(db, name);

// Title types — "Announcement" skips per-student marking
const CW_TYPES = [
  "Assignment",
  "Oral",
  "Project",
  "Quiz",
  "Exam",
  "Announcement",
];

// Icon & colour per type
const TYPE_META = {
  Assignment: { icon: "fa-pencil-alt", cls: "cwr-blue" },
  Oral: { icon: "fa-microphone", cls: "cwr-green" },
  Project: { icon: "fa-project-diagram", cls: "cwr-purple" },
  Quiz: { icon: "fa-question-circle", cls: "cwr-orange" },
  Exam: { icon: "fa-file-alt", cls: "cwr-red" },
  Announcement: { icon: "fa-bullhorn", cls: "cwr-teal" },
};

function ClassworkReminding({ focusClasswork, onFocusConsumed }) {
  const [currentView, setCurrentView] = useState("load");

  const [classGrade, setClassGrade] = useState(null);
  const [classSection, setClassSection] = useState("");
  const [classSubject, setClassSubject] = useState("");

  const [teacherLoads, setTeacherLoads] = useState([]);
  const [students, setStudents] = useState([]);
  const [classworks, setClassworks] = useState([]);
  const [activeCW, setActiveCW] = useState(null);

  // Tracks whether we're re-fetching the active CW from Firestore
  const [loadingCW, setLoadingCW] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [newCW, setNewCW] = useState({ title: "", desc: "", date: "" });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── toast (simple inline toast since this file didn't use the shared one) ─
  const [toastMsg, setToastMsg] = useState(null);
  const showToast = (message, isError = false) => {
    setToastMsg({ message, isError });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToastMsg(null), 4000);
  };

  // ── network + submit guard ───────────────────────────────────────────────
  const { isOnline } = useNetworkStatus();
  const guardSave = useSubmitGuard();

  // ── 1. Load teacher's schedules ──────────────────────────────────────────
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      setError("Session expired. Please log in again.");
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const userSnap = await getDoc(doc(db, "User", userId));
        if (!userSnap.exists()) {
          setError("User account not found.");
          return;
        }
        const teacherDocId = userSnap.data().teacherId;
        if (!teacherDocId) {
          setError("No teacher profile linked.");
          return;
        }

        const schedSnap = await getDocs(
          query(col("Schedule"), where("teacherId", "==", teacherDocId)),
        );
        setTeacherLoads(schedSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error(e);
        setError("Failed to load class assignments.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── 2. Load enrolled students when grade + section changes ───────────────
  useEffect(() => {
    if (!classGrade || !classSection) return;
    const load = async () => {
      try {
        const enrollSnap = await getDocs(
          query(
            col("Enrolled"),
            where("grade", "==", classGrade),
            where("section", "==", classSection),
            where("status", "==", "Enrolled"),
          ),
        );
        const ids = enrollSnap.docs.map((d) => d.data().studentId);
        const docs_ = await Promise.all(
          ids.map((id) => getDoc(doc(db, "Student", id))),
        );
        setStudents(
          docs_
            .filter((d) => d.exists())
            .map((d) => ({ id: d.id, ...d.data() })),
        );
      } catch (e) {
        console.error(e);
      }
    };
    load();
  }, [classGrade, classSection]);

  // ── 3. Load classworks when subject changes ──────────────────────────────
  const loadClassworks = async (grade, section, subject) => {
    try {
      const snap = await getDocs(
        query(
          col("Classwork"),
          where("grade", "==", grade),
          where("section", "==", section),
          where("subject", "==", subject),
        ),
      );
      setClassworks(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
      );
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!classGrade || !classSection || !classSubject) return;
    loadClassworks(classGrade, classSection, classSubject);
  }, [classGrade, classSection, classSubject]);

  // ── 4. Jump straight to a specific item from the Homepage Reminder panel ─
  useEffect(() => {
    if (!focusClasswork) return;
    let cancelled = false;

    const jump = async () => {
      let target = focusClasswork;
      try {
        const freshSnap = await getDoc(doc(db, "Classwork", focusClasswork.id));
        if (freshSnap.exists()) {
          target = { id: focusClasswork.id, ...freshSnap.data() };
        }
      } catch (e) {
        console.error("Failed to refresh focused classwork:", e);
      }
      if (cancelled) return;

      setClassGrade(target.grade);
      setClassSection(target.section);
      setClassSubject(target.subject);
      setActiveCW(target);
      setCurrentView(target.isAnnouncement ? "detail" : "grading");

      if (onFocusConsumed) onFocusConsumed();
    };

    jump();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusClasswork]);

  // ── Combined load options ────────────────────────────────────────────────
  const loadOptions = Object.values(
    teacherLoads.reduce((acc, l) => {
      const key = `${l.grade}|${l.section}|${l.subject}`;
      if (!acc[key])
        acc[key] = {
          grade: l.grade,
          section: l.section,
          subject: l.subject,
          start: l.start,
          end: l.end,
          day: l.day,
        };
      return acc;
    }, {}),
  ).sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.subject.localeCompare(b.subject);
  });

  // ── Select class ─────────────────────────────────────────────────────────
  const selectLoad = (l) => {
    setClassGrade(l.grade);
    setClassSection(l.section);
    setClassSubject(l.subject);
    setClassworks([]);
    setCurrentView("list");
  };

  // ── Add classwork / announcement (offline-safe) ──────────────────────────
  // Closes the modal and shows the entry in the list immediately. The write
  // is fired in the background — Firestore's persistentLocalCache queues it
  // instantly and syncs automatically once connectivity is restored.
  const handleSave = (e) => {
    e.preventDefault();
    guardSave(() => doSave());
  };

  const doSave = () => {
    const isAnnouncement = newCW.title === "Announcement";
    const payload = {
      title: newCW.title,
      desc: newCW.desc,
      date: newCW.date,
      grade: classGrade,
      section: classSection,
      subject: classSubject,
      isAnnouncement,
      studentStatus: isAnnouncement ? null : {},
      createdAt: new Date().toISOString(),
    };

    // Create the doc reference client-side so we have a stable id right
    // away, before the write has actually synced.
    const ref = doc(col("Classwork"));

    setShowModal(false);
    setNewCW({ title: "", desc: "", date: "" });
    showToast(
      isOnline
        ? `${payload.title} posted successfully.`
        : `${payload.title} saved offline — will sync when back online.`,
    );
    setClassworks((prev) =>
      [{ id: ref.id, ...payload }, ...prev].sort((a, b) =>
        (b.date || "").localeCompare(a.date || ""),
      ),
    );

    setDoc(ref, payload).catch((err) => {
      console.error(err);
      showToast(`Failed to post ${payload.title}: ${err.message}`, true);
    });

    // ── Notify parents of every enrolled student in this section ─────────
    // Fire-and-forget: never awaited, never blocks the UI, and safe if it
    // fails — the classwork post itself already succeeded regardless.
    (async () => {
      try {
        const parentIds = await getParentIdsForStudents(
          students.map((s) => s.id),
        );
        if (parentIds.length === 0) return;
        await queueNotification({
          parentIds,
          title: isAnnouncement ? "New Announcement" : `New ${payload.title}`,
          body:
            payload.desc.length > 120
              ? payload.desc.slice(0, 117) + "..."
              : payload.desc,
          url: "/parent", // adjust to wherever parents should land in-app
        });
      } catch (err) {
        console.error("Failed to queue notification:", err);
      }
    })();
  };

  // ── Open grading or detail view ──────────────────────────────────────────
  const openCW = async (cw) => {
    if (cw.isAnnouncement) {
      setActiveCW({ ...cw });
      setCurrentView("detail");
      return;
    }

    setLoadingCW(true);
    setCurrentView("grading");
    try {
      const freshSnap = await getDoc(doc(db, "Classwork", cw.id));
      const fresh = freshSnap.exists()
        ? { id: cw.id, ...freshSnap.data() }
        : { ...cw };
      setActiveCW(fresh);
      setClassworks((prev) =>
        prev.map((item) => (item.id === fresh.id ? fresh : item)),
      );
    } catch (e) {
      console.error("Failed to refresh classwork:", e);
      setActiveCW({ ...cw });
    } finally {
      setLoadingCW(false);
    }
  };

  // ── Mark a student (already offline-safe — fire-and-forget) ─────────────
  const markStudent = async (studentId, status) => {
    const updated = {
      ...activeCW,
      studentStatus: {
        ...(activeCW.studentStatus || {}),
        [studentId]: status,
      },
    };
    setActiveCW(updated);
    setClassworks((prev) =>
      prev.map((cw) =>
        cw.id === activeCW.id
          ? { ...cw, studentStatus: updated.studentStatus }
          : cw,
      ),
    );
    try {
      await updateDoc(doc(db, "Classwork", activeCW.id), {
        studentStatus: updated.studentStatus,
      });
    } catch (e) {
      console.error(e);
    }
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const submittedCount = (cw) =>
    Object.values(cw.studentStatus || {}).filter((s) => s === "Submitted")
      .length;
  const missingCount = (cw) =>
    Object.values(cw.studentStatus || {}).filter((s) => s === "Missing").length;

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="cwr-wrapper">
        <main className="cwr-main">
          <div className="cwr-container">
            <p className="cwr-loading">Loading your class assignments…</p>
          </div>
        </main>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="cwr-wrapper">
      {toastMsg && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: "16px",
            right: "16px",
            zIndex: 10000,
            padding: "10px 16px",
            borderRadius: "8px",
            color: "#fff",
            fontSize: "0.85rem",
            background: toastMsg.isError ? "#e74c3c" : "#2ecc71",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {toastMsg.message}
        </div>
      )}

      <main className="cwr-main">
        <div className="cwr-container">
          {/* ── LOAD PICKER ── */}
          {currentView === "load" && (
            <div className="cwr-view">
              <div className="cwr-toolbar">
                <h2 className="cwr-page-title">Classwork Reminders</h2>
              </div>

              {error && (
                <div className="cwr-alert">
                  <i className="fas fa-exclamation-triangle"></i> {error}
                </div>
              )}

              {loadOptions.length === 0 && !loading ? (
                <p className="cwr-empty">No classes assigned yet.</p>
              ) : (
                <div className="cwr-grid">
                  {loadOptions.map((l) => (
                    <div
                      key={`${l.grade}|${l.section}|${l.subject}`}
                      className="cwr-card"
                      onClick={() => selectLoad(l)}
                    >
                      <div className="cwr-icon-box cwr-bg-purple">
                        <i className="fas fa-book-open"></i>
                      </div>
                      <h3>
                        Grade {l.grade} – {l.section}
                      </h3>
                      <p className="cwr-card-sub">{l.subject}</p>
                      {l.start && l.end && (
                        <span className="cwr-card-time">
                          <i className="fas fa-clock"></i> {l.start} – {l.end}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CLASSWORK / ANNOUNCEMENT LIST ── */}
          {currentView === "list" && (
            <div className="cwr-view">
              <div className="cwr-toolbar">
                <button
                  className="btn-back-cwr"
                  onClick={() => setCurrentView("load")}
                >
                  <i className="fas fa-arrow-left"></i>
                </button>
                <div className="cwr-title-block">
                  <h3>{classSubject} — Classwork & Reminders</h3>
                  <small>
                    Grade {classGrade} – Section {classSection}
                  </small>
                </div>
                <span className="cwr-toolbar-break" />
                <button
                  className="cwr-btn-add"
                  onClick={() => setShowModal(true)}
                >
                  <i className="fas fa-plus"></i> Add
                </button>
              </div>

              {classworks.length === 0 ? (
                <div className="cwr-empty-list">
                  <i className="fas fa-folder-open"></i>
                  <p>No classwork or announcements posted yet.</p>
                  <button
                    className="cwr-btn-add-inline"
                    onClick={() => setShowModal(true)}
                  >
                    + Add First Entry
                  </button>
                </div>
              ) : (
                <div className="cwr-list">
                  {classworks.map((cw) => {
                    const meta = TYPE_META[cw.title] || TYPE_META["Assignment"];
                    const isAnn = cw.isAnnouncement;
                    return (
                      <div
                        key={cw.id}
                        className={`cwr-item ${isAnn ? "cwr-item-ann" : ""}`}
                      >
                        <div className={`cwr-item-icon ${meta.cls}`}>
                          <i className={`fas ${meta.icon}`}></i>
                        </div>
                        <div className="cwr-item-body">
                          <div className="cwr-item-top">
                            <span className={`cwr-type-badge ${meta.cls}`}>
                              {cw.title}
                            </span>
                            <span className="cwr-item-date">
                              <i className="fas fa-calendar-day"></i>{" "}
                              {cw.date || "—"}
                            </span>
                          </div>
                          <p className="cwr-item-desc">{cw.desc}</p>
                          {!isAnn && (
                            <div className="cwr-item-stats">
                              <span className="cwr-stat-sub">
                                <i className="fas fa-check-circle"></i>{" "}
                                {submittedCount(cw)} Submitted
                              </span>
                              <span className="cwr-stat-miss">
                                <i className="fas fa-times-circle"></i>{" "}
                                {missingCount(cw)} Missing
                              </span>
                            </div>
                          )}
                          {isAnn && (
                            <span className="cwr-ann-note">
                              <i className="fas fa-info-circle"></i>{" "}
                              Announcement — no submission tracking
                            </span>
                          )}
                        </div>
                        <button
                          className="cwr-btn-view"
                          onClick={() => openCW(cw)}
                        >
                          {isAnn ? "View" : "Grade"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── GRADING (non-announcement) ── */}
          {currentView === "grading" && (
            <div className="cwr-view">
              <div className="cwr-toolbar">
                <button
                  className="btn-back-cwr"
                  onClick={() => setCurrentView("list")}
                >
                  <i className="fas fa-arrow-left"></i>
                </button>
                <div className="cwr-title-block">
                  <h3>{activeCW?.title}</h3>
                  <small>
                    {activeCW?.desc && `${activeCW.desc} • `}
                    Due: {activeCW?.date || "—"} | Grade {classGrade} –{" "}
                    {classSection}
                  </small>
                </div>
              </div>

              {loadingCW ? (
                <div className="cwr-loading-marks">
                  <i className="fas fa-spinner fa-spin"></i> Loading student
                  marks…
                </div>
              ) : (
                <>
                  <div className="cwr-grading-hint">
                    <i className="fas fa-info-circle"></i> Tap a button to set
                    each student's status. Marks are saved automatically.
                  </div>

                  <div className="cwr-table-wrap">
                    <table className="cwr-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Student Name</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((s, idx) => {
                          const status = activeCW?.studentStatus?.[s.id];
                          return (
                            <tr
                              key={s.id}
                              className={
                                status === "Submitted"
                                  ? "cwr-row-submitted"
                                  : status === "Missing"
                                    ? "cwr-row-missing"
                                    : ""
                              }
                            >
                              <td className="cwr-td-num">{idx + 1}</td>
                              <td className="cwr-td-name">
                                {s.lastName}, {s.firstName}
                                {s.middleName ? ` ${s.middleName}` : ""}
                              </td>
                              <td className="cwr-td-actions">
                                <button
                                  className={`cwr-toggle-btn ${status === "Submitted" ? "cwr-toggle-sub" : ""}`}
                                  onClick={() => markStudent(s.id, "Submitted")}
                                >
                                  <i className="fas fa-check"></i> Submitted
                                </button>
                                <button
                                  className={`cwr-toggle-btn ${status === "Missing" ? "cwr-toggle-miss" : ""}`}
                                  onClick={() => markStudent(s.id, "Missing")}
                                >
                                  <i className="fas fa-times"></i> Missing
                                </button>
                                {status && (
                                  <button
                                    className="cwr-toggle-btn cwr-toggle-clear"
                                    title="Clear mark"
                                    onClick={async () => {
                                      const updatedStatus = {
                                        ...(activeCW.studentStatus || {}),
                                      };
                                      delete updatedStatus[s.id];
                                      const updated = {
                                        ...activeCW,
                                        studentStatus: updatedStatus,
                                      };
                                      setActiveCW(updated);
                                      setClassworks((prev) =>
                                        prev.map((cw) =>
                                          cw.id === activeCW.id
                                            ? {
                                                ...cw,
                                                studentStatus: updatedStatus,
                                              }
                                            : cw,
                                        ),
                                      );
                                      try {
                                        await updateDoc(
                                          doc(db, "Classwork", activeCW.id),
                                          { studentStatus: updatedStatus },
                                        );
                                      } catch (e) {
                                        console.error(e);
                                      }
                                    }}
                                  >
                                    <i className="fas fa-undo"></i>
                                  </button>
                                )}
                                {!status && (
                                  <span className="cwr-not-set">Not set</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Quick stats footer */}
                  {students.length > 0 && (
                    <div className="cwr-grading-summary">
                      <span className="cwr-gs-sub">
                        <i className="fas fa-check-circle"></i> Submitted:{" "}
                        {
                          Object.values(activeCW?.studentStatus || {}).filter(
                            (s) => s === "Submitted",
                          ).length
                        }
                      </span>
                      <span className="cwr-gs-miss">
                        <i className="fas fa-times-circle"></i> Missing:{" "}
                        {
                          Object.values(activeCW?.studentStatus || {}).filter(
                            (s) => s === "Missing",
                          ).length
                        }
                      </span>
                      <span className="cwr-gs-none">
                        <i className="fas fa-circle"></i> Not set:{" "}
                        {students.length -
                          Object.keys(activeCW?.studentStatus || {}).length}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── ANNOUNCEMENT DETAIL (read-only) ── */}
          {currentView === "detail" && activeCW && (
            <div className="cwr-view">
              <div className="cwr-toolbar">
                <button
                  className="btn-back-cwr"
                  onClick={() => setCurrentView("list")}
                >
                  <i className="fas fa-arrow-left"></i>
                </button>
                <div className="cwr-title-block">
                  <h3>Announcement</h3>
                  <small>
                    Grade {classGrade} – {classSection} | {classSubject}
                  </small>
                </div>
              </div>

              <div className="cwr-ann-card">
                <div className="cwr-ann-header">
                  <div className="cwr-ann-icon">
                    <i className="fas fa-bullhorn"></i>
                  </div>
                  <div>
                    <p className="cwr-ann-date">
                      <i className="fas fa-calendar-day"></i>{" "}
                      {activeCW.date || "—"}
                    </p>
                    <span className="cwr-ann-tag">Announcement</span>
                  </div>
                </div>
                <p className="cwr-ann-body">{activeCW.desc}</p>
                <div className="cwr-ann-footer">
                  <i className="fas fa-info-circle"></i>
                  This is a reminder/announcement for parents. No submission
                  tracking is needed.
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── ADD CLASSWORK / ANNOUNCEMENT MODAL ── */}
      {showModal && (
        <div className="cwr-overlay">
          <div className="cwr-modal">
            <div className="cwr-modal-header">
              <h3>
                <i className="fas fa-plus-circle"></i> New Entry
              </h3>
              <button
                className="cwr-modal-close"
                onClick={() => setShowModal(false)}
              >
                &times;
              </button>
            </div>
            <div className="cwr-modal-body">
              <form onSubmit={handleSave}>
                <div className="cwr-form-group">
                  <label>Type</label>
                  <select
                    required
                    value={newCW.title}
                    onChange={(e) =>
                      setNewCW({ ...newCW, title: e.target.value })
                    }
                  >
                    <option value="" disabled>
                      Select type…
                    </option>
                    {CW_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {newCW.title === "Announcement" && (
                  <div className="cwr-ann-hint">
                    <i className="fas fa-info-circle"></i> Announcements are
                    visible to parents. No submission tracking will be created.
                  </div>
                )}

                <div className="cwr-form-group">
                  <label>
                    {newCW.title === "Announcement"
                      ? "Announcement Message"
                      : "Details / Instructions"}
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={newCW.desc}
                    onChange={(e) =>
                      setNewCW({ ...newCW, desc: e.target.value })
                    }
                    placeholder={
                      newCW.title === "Announcement"
                        ? "Announcement Message"
                        : "Enter instructions or details…"
                    }
                  />
                </div>

                <div className="cwr-form-group">
                  <label>
                    {newCW.title === "Announcement" ? "Date" : "Due Date"}
                  </label>
                  <input
                    type="date"
                    required
                    value={newCW.date}
                    onChange={(e) =>
                      setNewCW({ ...newCW, date: e.target.value })
                    }
                  />
                </div>

                <div className="cwr-modal-footer">
                  <button
                    type="button"
                    className="cwr-btn-cancel"
                    onClick={() => {
                      setShowModal(false);
                      setNewCW({ title: "", desc: "", date: "" });
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="cwr-btn-save">
                    {newCW.title === "Announcement"
                      ? "Post Announcement"
                      : "Post Classwork"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClassworkReminding;

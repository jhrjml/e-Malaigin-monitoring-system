// ClassworkReminding.jsx
//
// FIX HISTORY:
// - teacherLoads and the active-school-year label load through
//   useCachedFetch instead of bare useEffect + setState, so the "Select a
//   class" picker paints instantly on repeat visits.
// - The classwork list itself now also goes through useCachedFetch, keyed
//   per grade|section|subject|schoolYear, so switching subjects on a
//   combo you've already viewed no longer shows a loading placeholder —
//   only a genuinely new combo does.
// - Creating and editing a classwork post now update the UI optimistically
//   (close the modal, update the list, show a toast) instead of waiting
//   inside setDoc/updateDoc's .then(). Firestore's offline-queued writes
//   don't resolve that promise until the connection comes back, which
//   previously meant: offline, the modal never closed, the new post never
//   appeared, and no toast ever fired. The write itself still happens —
//   it's just no longer gating the UI.
// - (this revision) FIX: the list was sorting by the classwork's *due
//   date* (`date`), not by when it was actually posted — so a post due
//   further out jumped to the top even if it was created moments ago,
//   and a post due soon from last week could get buried underneath it.
//   `sortMostRecentFirst` (using `createdAt`, with a `date` fallback for
//   older records that predate that field) was already defined in this
//   file but never actually used anywhere. It's now wired into all three
//   places the list gets sorted (initial fetch, new post, edited post),
//   so newly-posted classwork always appears at the top.
import { useState, useEffect, useMemo, useCallback } from "react";
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
import {
  queueNotification,
  getParentIdsForStudents,
  getActiveSchoolYearLabel,
} from "../api/firebaseApi";
import useSubmitGuard from "../common/useSubmitGuard";
import useNetworkStatus from "../common/useNetworkStatus";
import useCachedFetch from "../common/useCachedFetch";
// NOTE: adjust this import to match whatever toast hook/context you're
// already using elsewhere in the app (e.g. the enrollment screen you
// pasted `showToast(...)` from). This assumes a hook that returns a
// `showToast(message)` function — swap it for your actual one.
import useToast from "../common/useToast";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./ClassworkReminding.css";

const col = (name) => collection(db, name);
const CW_TYPES = [
  "Assignment",
  "Oral",
  "Project",
  "Quiz",
  "Exam",
  "Announcement",
];
const TYPE_META = {
  Assignment: { icon: "fa-pencil-alt", cls: "cwr-blue" },
  Oral: { icon: "fa-microphone", cls: "cwr-green" },
  Project: { icon: "fa-project-diagram", cls: "cwr-purple" },
  Quiz: { icon: "fa-question-circle", cls: "cwr-orange" },
  Exam: { icon: "fa-file-alt", cls: "cwr-red" },
  Announcement: { icon: "fa-bullhorn", cls: "cwr-teal" },
};

// Sorts by when the post was actually CREATED (most recent first), not by
// its due date. Falls back to `date` only for older records saved before
// `createdAt` existed, so nothing crashes or silently vanishes.
const sortMostRecentFirst = (a, b) => {
  const ca = a.createdAt || "";
  const cb = b.createdAt || "";
  if (ca && cb) return cb.localeCompare(ca);
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return (b.date || "").localeCompare(a.date || "");
};

const toJsDate = (val) => {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const formatEditedLabel = (editedAt) => {
  const date = toJsDate(editedAt);
  if (!date) return null;

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();

  const datePart = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return `Edited ${datePart}, ${timePart}`;
};

function ClassworkReminding({ focusClasswork, onFocusConsumed }) {
  const [currentView, setCurrentView] = useState("load");
  const [classGrade, setClassGrade] = useState(null);
  const [classSection, setClassSection] = useState("");
  const [classSubject, setClassSubject] = useState("");

  const [students, setStudents] = useState([]);
  const [activeCW, setActiveCW] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [newCW, setNewCW] = useState({ title: "", desc: "", date: "" });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editCW, setEditCW] = useState({
    id: null,
    title: "",
    desc: "",
    date: "",
  });

  const isOnline = useNetworkStatus();
  const showToast = useToast();

  // ── teacherLoads cached — the class picker paints instantly on repeat
  // visits. ──
  const { data: cachedTeacherLoads, loading } = useCachedFetch(
    "teacherLoads:classwork",
    async () => {
      const userId = localStorage.getItem("userId");
      if (!userId) throw new Error("Session expired.");
      const snap = await getDoc(doc(db, "User", userId));
      if (!snap.exists()) return [];
      const sSnap = await getDocs(
        query(col("Schedule"), where("teacherId", "==", snap.data().teacherId)),
      );
      return sSnap.docs.map((d) => d.data());
    },
    [],
  );
  const teacherLoads = cachedTeacherLoads || [];
  const error = ""; // preserved for JSX below; see note near render

  // ── The admin-configured active school year label (e.g. "2026-2027")
  // also goes through useCachedFetch. Used to stamp new posts and scope
  // the classwork list so a teacher assigned the same Grade/Section/
  // Subject next school year sees a clean list instead of last year's
  // leftover posts. ──
  const { data: cachedActiveSchoolYear } = useCachedFetch(
    "schoolYear:active",
    () => getActiveSchoolYearLabel(),
    [],
  );
  const activeSchoolYear = cachedActiveSchoolYear || "";

  // ── The classwork list itself is cached, keyed to the exact class +
  // subject + school year combination. Repeat views render instantly from
  // cache while a fresh copy is fetched quietly in the background. ──
  const classworksCacheKey =
    classGrade && classSection && classSubject
      ? `classwork:${classGrade}|${classSection}|${classSubject}|${activeSchoolYear || "none"}`
      : "classwork:none";

  const fetchClassworks = useCallback(async () => {
    if (!classGrade || !classSection || !classSubject || !activeSchoolYear) {
      // Wait for activeSchoolYear to resolve at least once so this never
      // fires an unscoped (all-years) query.
      return [];
    }
    const snap = await getDocs(
      query(
        col("Classwork"),
        where("grade", "==", classGrade),
        where("section", "==", classSection),
        where("subject", "==", classSubject),
        where("schoolYear", "==", activeSchoolYear),
      ),
    );
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort(sortMostRecentFirst);
  }, [classGrade, classSection, classSubject, activeSchoolYear]);

  const {
    data: cachedClassworks,
    setData: setClassworksData,
    loading: classworksLoading,
  } = useCachedFetch(classworksCacheKey, fetchClassworks, [
    classGrade,
    classSection,
    classSubject,
    activeSchoolYear,
  ]);
  const classworks = cachedClassworks || [];

  // Only block with a spinner when nothing is cached yet for this exact
  // combination — repeat visits render instantly, an empty cached list
  // (genuinely "no posts yet") does not trigger the spinner either.
  const showClassworkListLoading = classworksLoading && !cachedClassworks;

  // Mirrors useCachedFetch's own internal cache format so optimistic
  // updates below survive a reload/remount even before the write has
  // actually synced to the server.
  const persistClassworksCache = (next) => {
    try {
      localStorage.setItem(`cache:${classworksCacheKey}`, JSON.stringify(next));
    } catch {
      // storage full / private mode — non-fatal
    }
  };

  const guardSave = useSubmitGuard();

  // Intercept Dashboard Click Routing Targets
  useEffect(() => {
    if (focusClasswork) {
      setClassGrade(focusClasswork.grade);
      setClassSection(focusClasswork.section);
      setClassSubject(focusClasswork.subject);
      setActiveCW(focusClasswork);

      if (
        focusClasswork.title === "Announcement" ||
        focusClasswork.isAnnouncement
      ) {
        setCurrentView("announcement-view");
      } else {
        setCurrentView("grading");
      }

      if (onFocusConsumed) {
        onFocusConsumed();
      }
    }
  }, [focusClasswork, onFocusConsumed]);

  useEffect(() => {
    const handleTeacherSidebarClick = (e) => {
      const target = e.target.closest("li, button, div, span, a");
      if (
        target &&
        target.textContent &&
        target.textContent.includes("Classwork Reminder")
      ) {
        setCurrentView("load");
        setClassGrade(null);
        setClassSection("");
        setClassSubject("");
        setActiveCW(null);
      }
    };
    document.addEventListener("mousedown", handleTeacherSidebarClick);
    return () =>
      document.removeEventListener("mousedown", handleTeacherSidebarClick);
  }, []);

  useEffect(() => {
    if (!classGrade || !classSection) return;
    getDocs(
      query(
        col("Enrolled"),
        where("grade", "==", classGrade),
        where("section", "==", classSection),
        where("status", "==", "Enrolled"),
      ),
    ).then(async (snap) => {
      const docs_ = await Promise.all(
        snap.docs.map((d) => getDoc(doc(db, "Student", d.data().studentId))),
      );
      setStudents(
        docs_
          .filter((d) => d.exists())
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => a.lastName.localeCompare(b.lastName)),
      );
    });
  }, [classGrade, classSection]);

  const handleSave = (e) => {
    e.preventDefault();
    guardSave(() => {
      const ref = doc(col("Classwork"));
      const payload = {
        ...newCW,
        grade: classGrade,
        section: classSection,
        subject: classSubject,
        isAnnouncement: newCW.title === "Announcement",
        studentStatus: {},
        createdAt: new Date().toISOString(),
        // Stamped so this post only ever shows up under the school year it
        // was actually posted in.
        schoolYear: activeSchoolYear,
      };

      // FIXED: update the list, close the modal, and toast immediately —
      // don't wait inside setDoc(...).then(...). Offline, that promise
      // doesn't resolve until back online, which previously meant the
      // modal stayed open and the post never appeared to have been made.
      // Sorted by sortMostRecentFirst so this brand-new post lands at the
      // very top, regardless of its due date.
      const next = [{ id: ref.id, ...payload }, ...classworks].sort(
        sortMostRecentFirst,
      );
      setClassworksData(next);
      persistClassworksCache(next);

      setShowModal(false);
      setNewCW({ title: "", desc: "", date: "" });

      showToast(
        isOnline
          ? "Classwork posted successfully."
          : "Saved offline — will sync once you're back online.",
      );

      setDoc(ref, payload).catch((err) => {
        console.error("Failed to save classwork:", err);
        if (isOnline) {
          showToast("Something went wrong posting this — please try again.");
        }
      });
    });
  };

  const handleOpenEditModal = (cw) => {
    setEditCW({ id: cw.id, title: cw.title, desc: cw.desc, date: cw.date });
    setShowEditModal(true);
  };

  const handleUpdateCW = (e) => {
    e.preventDefault();
    guardSave(() => {
      const editedAt = new Date().toISOString();
      const updates = {
        title: editCW.title,
        desc: editCW.desc,
        date: editCW.date,
        isAnnouncement: editCW.title === "Announcement",
        editedAt,
      };

      // FIXED: same root cause as handleSave — setShowEditModal(false) used
      // to sit inside updateDoc(...).then(...), so offline it never fired
      // and the modal appeared stuck. Update + close immediately, let the
      // write sync in the background. Re-sorted by sortMostRecentFirst —
      // editing doesn't change createdAt, so an edited post stays in its
      // original "most recently posted" position rather than jumping to
      // the top on every edit.
      const next = classworks
        .map((cw) => (cw.id === editCW.id ? { ...cw, ...updates } : cw))
        .sort(sortMostRecentFirst);
      setClassworksData(next);
      persistClassworksCache(next);

      setActiveCW((prev) =>
        prev && prev.id === editCW.id ? { ...prev, ...updates } : prev,
      );
      setShowEditModal(false);

      showToast(
        isOnline
          ? "Classwork updated successfully."
          : "Saved offline — will sync once you're back online.",
      );

      updateDoc(doc(db, "Classwork", editCW.id), updates).catch((err) => {
        console.error("Failed to update classwork:", err);
        if (isOnline) {
          showToast("Something went wrong updating this — please try again.");
        }
      });
    });
  };

  const markStudent = async (studentId, status) => {
    const updatedStatus = { ...(activeCW.studentStatus || {}) };
    updatedStatus[studentId] = status;

    setActiveCW({ ...activeCW, studentStatus: updatedStatus });
    await updateDoc(doc(db, "Classwork", activeCW.id), {
      studentStatus: updatedStatus,
    });
  };

  const clearStudentMark = async (studentId) => {
    const updatedStatus = { ...(activeCW.studentStatus || {}) };
    delete updatedStatus[studentId];

    setActiveCW({ ...activeCW, studentStatus: updatedStatus });
    await updateDoc(doc(db, "Classwork", activeCW.id), {
      studentStatus: updatedStatus,
    });
  };

  const summaryStats = useMemo(() => {
    if (!activeCW) return { submitted: 0, missing: 0, notSet: 0 };
    const statusObj = activeCW.studentStatus || {};
    const submitted = Object.values(statusObj).filter(
      (s) => s === "Submitted",
    ).length;
    const missing = Object.values(statusObj).filter(
      (s) => s === "Missing",
    ).length;
    const notSet = students.length - submitted - missing;
    return { submitted, missing, notSet };
  }, [activeCW, students]);

  const loadOptions = useMemo(() => {
    return Object.values(
      teacherLoads.reduce((acc, l) => {
        const key = `${l.grade}|${l.section}|${l.subject}`;
        if (!acc[key]) {
          acc[key] = {
            grade: l.grade,
            section: l.section,
            subject: l.subject,
            start: l.start,
            end: l.end,
          };
        }
        return acc;
      }, {}),
    ).sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      return a.section.localeCompare(b.section);
    });
  }, [teacherLoads]);

  // Only show the load-picker spinner when there's truly no cached data
  // yet, so repeat visits paint instantly.
  const showLoadPickerLoading = loading && loadOptions.length === 0;

  return (
    <div className="cwr-wrapper">
      <main className="cwr-main">
        <div className="cwr-container">
          {currentView === "load" && (
            <div className="cwr-view">
              <h2 className="cwr-page-title">Classwork Reminders</h2>
              {showLoadPickerLoading ? (
                <div className="cwr-loading-state">
                  <p>Loading your class assignments…</p>
                </div>
              ) : (
                <div className="cwr-grid">
                  {loadOptions.map((l, i) => (
                    <div
                      key={i}
                      className="cwr-card"
                      onClick={() => {
                        setClassGrade(l.grade);
                        setClassSection(l.section);
                        setClassSubject(l.subject);
                        setCurrentView("list");
                      }}
                    >
                      <div className="cwr-icon-box">
                        <i className="fas fa-book-open"></i>
                      </div>
                      <h3>
                        Grade {l.grade} - {l.section}
                      </h3>
                      <p className="cwr-card-sub">{l.subject}</p>
                      {l.start && l.end && (
                        <p className="cwr-card-time">
                          <i className="far fa-clock"></i> {l.start} – {l.end}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentView === "list" && (
            <div className="cwr-view">
              <div className="cwr-toolbar cwr-toolbar--stacked">
                <div className="cwr-toolbar-left">
                  <div className="cwr-toolbar-row1">
                    <button
                      className="btn-back-cwr"
                      onClick={() => setCurrentView("load")}
                    >
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <h3 className="cwr-toolbar-title">
                      Classwork &amp; Reminders
                    </h3>
                  </div>
                  <small className="cwr-toolbar-subtitle">
                    {classSubject}: Grade {classGrade} – {classSection}
                    {activeSchoolYear ? ` | S.Y. ${activeSchoolYear}` : ""}
                  </small>
                </div>
                <button
                  className="cwr-btn-add"
                  onClick={() => setShowModal(true)}
                >
                  <i className="fas fa-plus"></i> Add Post
                </button>
              </div>

              <div className="cwr-list">
                {showClassworkListLoading ? (
                  <div className="cwr-loading-state">
                    <p>Loading classwork updates…</p>
                  </div>
                ) : classworks.length === 0 ? (
                  <div className="cwr-empty-list">
                    <i className="fas fa-folder-open"></i>
                    <p>
                      No classwork updates created for this class timeline
                      ledger.
                    </p>
                  </div>
                ) : (
                  classworks.map((cw) => {
                    const statusObj = cw.studentStatus || {};
                    const submittedCount = Object.values(statusObj).filter(
                      (s) => s === "Submitted",
                    ).length;
                    const missingCount = Object.values(statusObj).filter(
                      (s) => s === "Missing",
                    ).length;
                    const meta = TYPE_META[cw.title] || {
                      icon: "fa-tasks",
                      cls: "cwr-blue",
                    };
                    const editedLabel = formatEditedLabel(cw.editedAt);

                    return (
                      <div
                        key={cw.id}
                        className={`cwr-item ${cw.title === "Announcement" ? "cwr-item-ann" : ""}`}
                      >
                        <div className={`cwr-item-icon ${meta.cls}`}>
                          <i className={`fas ${meta.icon}`}></i>
                        </div>
                        <div className="cwr-item-body">
                          <div className="cwr-item-top">
                            <span className={`cwr-type-badge ${meta.cls}`}>
                              {cw.title}
                            </span>
                            {editedLabel && (
                              <span className="cwr-edited-label">
                                <i className="fas fa-history"></i> {editedLabel}
                              </span>
                            )}
                            <span className="cwr-item-date">
                              <i className="far fa-calendar-alt"></i> {cw.date}
                            </span>
                          </div>
                          <p
                            className="cwr-item-desc"
                            style={{
                              fontSize: "1.05rem",
                              fontWeight: "600",
                              whiteSpace: "normal",
                            }}
                          >
                            {cw.desc}
                          </p>

                          {cw.title === "Announcement" ? (
                            <div className="cwr-ann-note">
                              <i className="fas fa-info-circle"></i>{" "}
                              Announcement — no submission tracking
                            </div>
                          ) : (
                            <div className="cwr-item-stats">
                              <span className="cwr-stat-sub">
                                <i className="fas fa-check-circle"></i>{" "}
                                {submittedCount} Submitted
                              </span>
                              <span className="cwr-stat-miss">
                                <i className="fas fa-times-circle"></i>{" "}
                                {missingCount} Missed
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="cwr-item-actions">
                          <button
                            className="cwr-btn-view"
                            onClick={() => {
                              setActiveCW(cw);
                              setCurrentView(
                                cw.title === "Announcement"
                                  ? "announcement-view"
                                  : "grading",
                              );
                            }}
                          >
                            {cw.title === "Announcement" ? "View" : "Remark"}
                          </button>
                          <button
                            className="cwr-btn-edit-link"
                            onClick={() => handleOpenEditModal(cw)}
                          >
                            <i className="fas fa-pencil-alt"></i>{" "}
                            <span className="cwr-edit-link-text">
                              Edit Post
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {currentView === "announcement-view" && (
            <div className="cwr-view">
              <div className="cwr-toolbar">
                <button
                  className="btn-back-cwr"
                  onClick={() => setCurrentView("list")}
                >
                  <i className="fas fa-arrow-left"></i>
                </button>
                <h3>Announcement Details</h3>
              </div>
              <div className="cwr-ann-card">
                <div className="cwr-ann-header">
                  <div className="cwr-ann-icon">
                    <i className="fas fa-bullhorn"></i>
                  </div>
                  <div>
                    <div className="cwr-ann-date">
                      <i className="far fa-calendar-alt"></i> Posted Window:{" "}
                      {activeCW?.date}
                    </div>
                    <span className="cwr-ann-tag">Announcement</span>
                  </div>
                </div>
                <p className="cwr-ann-body">{activeCW?.desc}</p>
              </div>
            </div>
          )}

          {currentView === "grading" && (
            <div className="cwr-view">
              <div className="cwr-toolbar cwr-grading-toolbar">
                <div className="cwr-grading-title-row">
                  <button
                    className="btn-back-cwr"
                    onClick={() => setCurrentView("list")}
                  >
                    <i className="fas fa-arrow-left"></i>
                  </button>
                  <h3 className="cwr-grading-title">{activeCW?.title}</h3>
                  <button
                    className="cwr-btn-edit-link cwr-btn-edit-link--inline"
                    onClick={() => handleOpenEditModal(activeCW)}
                  >
                    <i className="fas fa-pencil-alt"></i>{" "}
                    <span className="cwr-edit-link-text">Edit</span>
                  </button>
                </div>
                <div className="cwr-grading-meta">
                  <span className="cwr-grading-due">
                    <i className="far fa-calendar-alt"></i> Due:{" "}
                    {activeCW?.date} | Grade {classGrade} – {classSection}
                  </span>
                  <p className="cwr-grading-desc">{activeCW?.desc}</p>
                </div>
              </div>

              <div className="cwr-grading-hint">
                <i className="fas fa-info-circle"></i> Tap a button to set each
                student's status. Marks are saved automatically.
              </div>

              <div className="cwr-table-wrap">
                <table className="cwr-table">
                  <thead>
                    <tr>
                      <th style={{ width: "60px", textAlign: "center" }}>#</th>
                      <th>Student Name</th>
                      <th style={{ width: "340px", textAlign: "center" }}>
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, idx) => {
                      const submissionStatus = activeCW.studentStatus?.[s.id];
                      let rowClass = "";
                      if (submissionStatus === "Submitted")
                        rowClass = "cwr-row-submitted";
                      if (submissionStatus === "Missing")
                        rowClass = "cwr-row-missing";

                      return (
                        <tr key={s.id} className={rowClass}>
                          <td style={{ textAlign: "center", color: "#888" }}>
                            {idx + 1}
                          </td>
                          <td className="cwr-td-name">
                            {s.lastName}, {s.firstName} {s.middleName || ""}
                          </td>
                          <td className="cwr-td-actions">
                            <button
                              className={`cwr-toggle-btn ${submissionStatus === "Submitted" ? "cwr-toggle-sub" : ""}`}
                              onClick={() => markStudent(s.id, "Submitted")}
                            >
                              <i className="fas fa-check"></i> Submitted
                            </button>
                            <button
                              className={`cwr-toggle-btn ${submissionStatus === "Missing" ? "cwr-toggle-miss" : ""}`}
                              onClick={() => markStudent(s.id, "Missing")}
                            >
                              <i className="fas fa-times"></i> Missed
                            </button>
                            {submissionStatus && (
                              <button
                                className="cwr-toggle-btn cwr-toggle-clear"
                                onClick={() => clearStudentMark(s.id)}
                                title="Reset submission state"
                              >
                                <i className="fas fa-undo"></i>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="cwr-grading-summary">
                <span className="cwr-gs-sub">
                  <i className="fas fa-check-circle"></i> Submitted:{" "}
                  {summaryStats.submitted}
                </span>
                <span className="cwr-gs-miss">
                  <i className="fas fa-times-circle"></i> Missed:{" "}
                  {summaryStats.missing}
                </span>
                <span className="cwr-gs-none">
                  <i className="fas fa-dot-circle"></i> Not set:{" "}
                  {summaryStats.notSet}
                </span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── CREATE MODAL ── */}
      {showModal && (
        <div className="cwr-overlay" onClick={() => setShowModal(false)}>
          <div className="cwr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cwr-modal-header">
              <h3>
                <div className="cwr-modal-header-icon">
                  <i className="fas fa-plus-circle"></i>
                </div>
                Create Post Update
              </h3>
              <button
                className="cwr-modal-close"
                onClick={() => setShowModal(false)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <form onSubmit={handleSave}>
              <div className="cwr-modal-body">
                <div className="cwr-form-group">
                  <label>Type</label>
                  <select
                    value={newCW.title}
                    onChange={(e) =>
                      setNewCW({ ...newCW, title: e.target.value })
                    }
                    required
                  >
                    <option value="">Select type...</option>
                    {CW_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cwr-form-group">
                  <label>Details</label>
                  <textarea
                    rows="4"
                    placeholder="Enter classwork or announcement details..."
                    value={newCW.desc}
                    onChange={(e) =>
                      setNewCW({ ...newCW, desc: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="cwr-form-group">
                  <label>Due Date</label>
                  <input
                    type="date"
                    value={newCW.date}
                    onChange={(e) =>
                      setNewCW({ ...newCW, date: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div className="cwr-modal-footer">
                <button type="submit" className="cwr-btn-save">
                  Post Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {showEditModal && (
        <div className="cwr-overlay" onClick={() => setShowEditModal(false)}>
          <div className="cwr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cwr-modal-header">
              <h3>
                <div className="cwr-modal-header-icon">
                  <i className="fas fa-edit"></i>
                </div>
                Edit Post Update
              </h3>
              <button
                className="cwr-modal-close"
                onClick={() => setShowEditModal(false)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <form onSubmit={handleUpdateCW}>
              <div className="cwr-modal-body">
                <div className="cwr-form-group">
                  <label>Type</label>
                  <select
                    value={editCW.title}
                    onChange={(e) =>
                      setEditCW({ ...editCW, title: e.target.value })
                    }
                    required
                  >
                    {CW_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cwr-form-group">
                  <label>Details</label>
                  <textarea
                    rows="4"
                    value={editCW.desc}
                    onChange={(e) =>
                      setEditCW({ ...editCW, desc: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="cwr-form-group">
                  <label>Due Date</label>
                  <input
                    type="date"
                    value={editCW.date}
                    onChange={(e) =>
                      setEditCW({ ...editCW, date: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div className="cwr-modal-footer">
                <button type="submit" className="cwr-btn-save">
                  Update Post
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClassworkReminding;

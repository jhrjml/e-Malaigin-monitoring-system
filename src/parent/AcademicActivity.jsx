// AcademicActivity.jsx (Firebase version)
//
// FIX HISTORY (this revision):
// - The subject grid used to check only `subjects.length === 0`, with no
//   awareness of whether the fetch was still in flight — so while
//   subjects were loading it showed "No subjects found for this class."
//   instead of a loading message. Fixed by tracking a dedicated
//   `showSubjectsLoading` flag (true only when there's no cached data yet)
//   and checking that first.
// - Clicking a subject used to `await` the classwork fetch BEFORE
//   switching `currentView` to "academic" — so you'd sit on the
//   subject-grid screen watching a spinner, then get jumped to the
//   already-loaded classwork feed. `selectSubject` now just sets state
//   and navigates immediately; the classwork feed itself shows its own
//   (much shorter, scoped) loading state while the list fetches in place.
// - Children, subjects, the active school year, and each subject's
//   classwork list are now all cached via useCachedFetch, so offline (or
//   on a repeat visit) everything renders from last-known data instantly
//   instead of showing a spinner. The children list shares its cache key
//   ("children:<userId>") with ChildProfile / AttendanceRecord /
//   ParentDashboard, so whichever page loads it first fills the cache for
//   the rest.
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { db } from "../api/firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { getActiveSchoolYearLabel } from "../api/firebaseApi";
import useCachedFetch from "../common/useCachedFetch";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./AcademicActivity.css";

const col = (name) => collection(db, name);

const iconFor = (subject) => {
  const map = {
    Math: "fa-calculator",
    Mathematics: "fa-calculator",
    English: "fa-book",
    Science: "fa-flask",
    Filipino: "fa-flag",
    "Araling Panlipunan": "fa-globe",
    MAPEH: "fa-music",
    TLE: "fa-tools",
    EPP: "fa-seedling",
  };
  return map[subject] || "fa-book-open";
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
  const diffMs = now - date;

  const isUnder24h = diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000;

  if (isUnder24h) {
    return `Edited ${date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return `Edited ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  })}`;
};

// Sorts by when the post was actually CREATED (most recent first), not by
// its due date. Falls back to `date` only for older records saved before
// `createdAt` existed.
function sortMostRecentFirst(a, b) {
  const ca = a.createdAt || "";
  const cb = b.createdAt || "";
  if (ca && cb) return cb.localeCompare(ca);
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return (b.date || "9999-99-99").localeCompare(a.date || "9999-99-99");
}

function AcademicActivity({ focusClasswork, onFocusConsumed } = {}) {
  const userId = localStorage.getItem("userId");

  const [selectedChild, setSelectedChild] = useState(null);
  const [currentView, setCurrentView] = useState("select-subject");
  const [currentSubject, setCurrentSubject] = useState("");
  const [sortBy, setSortBy] = useState("recent");

  const [highlightId, setHighlightId] = useState(null);
  const isJumpingRef = useRef(false);

  // ── Children list — shared cache key with ChildProfile /
  // AttendanceRecord / ParentDashboard, so whichever page loads it first
  // fills the cache for the rest, and offline this renders the last-known
  // list instantly instead of a spinner. ──
  const fetchChildren = useCallback(async () => {
    if (!userId) return [];
    const userSnap = await getDoc(doc(db, "User", userId));
    if (!userSnap.exists()) return [];

    const studentIds = userSnap.data().studentIds || [];
    if (studentIds.length === 0) return [];

    const studentDocs = await Promise.all(
      studentIds.map((id) => getDoc(doc(db, "Student", id))),
    );

    return Promise.all(
      studentDocs
        .filter((d) => d.exists())
        .map(async (d) => {
          const s = { id: d.id, ...d.data() };
          const enrollSnap = await getDocs(
            query(
              col("Enrolled"),
              where("studentId", "==", s.id),
              where("status", "==", "Enrolled"),
            ),
          );
          const enroll = enrollSnap.docs[0]?.data() || {};
          return {
            ...s,
            enrolledGrade: enroll.grade || s.grade,
            enrolledSection: enroll.section || "",
          };
        }),
    );
  }, [userId]);

  const { data: cachedChildren, loading: childrenLoading } = useCachedFetch(
    `children:${userId || "none"}`,
    fetchChildren,
    [userId],
  );
  const children = cachedChildren || [];
  const showChildrenLoading = childrenLoading && !cachedChildren;

  useEffect(() => {
    if (children.length === 0) {
      setSelectedChild(null);
      return;
    }
    setSelectedChild((prev) => {
      const stillThere = prev && children.find((c) => c.id === prev.id);
      return stillThere || children[0];
    });
  }, [children]);

  // Resets back to the subject-selection screen whenever the child
  // changes — unless we're mid-jump from a dashboard reminder click, which
  // sets its own view/subject explicitly (see the focusClasswork effect
  // below).
  useEffect(() => {
    if (!selectedChild) return;
    if (isJumpingRef.current) {
      isJumpingRef.current = false;
      return;
    }
    setCurrentView("select-subject");
    setCurrentSubject("");
  }, [selectedChild?.id]);

  // Instantly resets view back to the first subject selection page on sidebar menu button press
  useEffect(() => {
    const handleParentSidebarClick = (e) => {
      const target = e.target.closest("li, button, div, span, a");
      if (
        target &&
        target.textContent &&
        target.textContent.includes("Academic Activity")
      ) {
        setCurrentView("select-subject");
        setCurrentSubject("");
      }
    };
    document.addEventListener("mousedown", handleParentSidebarClick);
    return () =>
      document.removeEventListener("mousedown", handleParentSidebarClick);
  }, []);

  // ── Subjects for the currently selected child, cached per grade+section
  // so switching back to a class you've already viewed shows the subject
  // grid instantly. ──
  const fetchSubjects = useCallback(async () => {
    if (!selectedChild) return [];
    const snap = await getDocs(
      query(
        col("Schedule"),
        where("grade", "==", selectedChild.enrolledGrade),
        where("section", "==", selectedChild.enrolledSection),
      ),
    );

    const subsMap = new Map();
    snap.docs.forEach((d) => {
      const data = d.data();
      if (!subsMap.has(data.subject)) {
        subsMap.set(data.subject, {
          name: data.subject,
          icon: iconFor(data.subject),
          time:
            data.start && data.end
              ? `${data.start} - ${data.end}`
              : data.timeSlot || "",
        });
      }
    });
    return Array.from(subsMap.values());
  }, [selectedChild?.enrolledGrade, selectedChild?.enrolledSection]);

  const subjectsCacheKey = selectedChild
    ? `subjects:${selectedChild.enrolledGrade}|${selectedChild.enrolledSection}`
    : "subjects:none";

  const { data: cachedSubjects, loading: subjectsLoading } = useCachedFetch(
    subjectsCacheKey,
    fetchSubjects,
    [selectedChild?.enrolledGrade, selectedChild?.enrolledSection],
  );
  const subjects = cachedSubjects || [];
  // FIX: only true while there's genuinely no cached data yet — this is
  // what stops "No subjects found" from flashing during the fetch.
  const showSubjectsLoading = subjectsLoading && !cachedSubjects;

  // ── Active school year, cached — shared key with ClassworkReminding /
  // ParentDashboard. Classwork is scoped to it so a child re-enrolled in
  // the same Grade/Section next year doesn't see last year's leftover
  // posts resurface here. ──
  const { data: cachedSchoolYear } = useCachedFetch(
    "schoolYear:active",
    () => getActiveSchoolYearLabel(),
    [],
  );
  const activeSchoolYear = cachedSchoolYear || "";

  // ── Classwork feed for the selected child + subject, cached per exact
  // combination (including school year), so re-opening a subject you've
  // already viewed this session shows the feed instantly instead of
  // re-querying Firestore. ──
  const fetchClassworks = useCallback(async () => {
    if (!selectedChild || !currentSubject || !activeSchoolYear) return [];
    const snap = await getDocs(
      query(
        col("Classwork"),
        where("grade", "==", selectedChild.enrolledGrade),
        where("section", "==", selectedChild.enrolledSection),
        where("subject", "==", currentSubject),
        where("schoolYear", "==", activeSchoolYear),
      ),
    );
    return snap.docs
      .map((d) => {
        const data = d.data();
        const status = data.studentStatus?.[selectedChild.id] ?? null;
        return { id: d.id, ...data, myStatus: status };
      })
      .sort(sortMostRecentFirst);
  }, [
    selectedChild?.id,
    selectedChild?.enrolledGrade,
    selectedChild?.enrolledSection,
    currentSubject,
    activeSchoolYear,
  ]);

  const classworkCacheKey =
    selectedChild && currentSubject && activeSchoolYear
      ? `classwork:${selectedChild.id}|${selectedChild.enrolledGrade}|${selectedChild.enrolledSection}|${currentSubject}|${activeSchoolYear}`
      : "classwork:none";

  const { data: cachedClassworkList, loading: classworkLoading } =
    useCachedFetch(classworkCacheKey, fetchClassworks, [
      selectedChild?.id,
      selectedChild?.enrolledGrade,
      selectedChild?.enrolledSection,
      currentSubject,
      activeSchoolYear,
    ]);
  const classworkList = cachedClassworkList || [];
  const showClassworkLoading = classworkLoading && !cachedClassworkList;

  const switchChild = (child) => {
    if (child.id === selectedChild?.id) return;
    setSelectedChild(child);
  };

  // FIX: this used to be async — it awaited the classwork fetch, resolved
  // the active school year, etc., all BEFORE calling setCurrentView, so
  // you'd watch a spinner sit on top of the subject grid before getting
  // moved to the (already-loaded) classwork feed. Now it just navigates;
  // the useCachedFetch hook above reacts to `currentSubject` changing on
  // its own, and the classwork feed shows its own scoped loading state.
  const selectSubject = (subjectName) => {
    setCurrentSubject(subjectName);
    setCurrentView("academic");
  };

  // Jump here directly from a dashboard reminder click — same "navigate
  // first, load in place" approach as selectSubject above.
  useEffect(() => {
    if (!focusClasswork || childrenLoading) return;
    if (children.length === 0) {
      onFocusConsumed?.();
      return;
    }

    const target = children.find((c) => c.id === focusClasswork.studentId);
    if (!target) {
      onFocusConsumed?.();
      return;
    }

    if (target.id !== selectedChild?.id) {
      isJumpingRef.current = true;
      setSelectedChild(target);
    }
    setCurrentSubject(focusClasswork.subject);
    setCurrentView("academic");
    setHighlightId(focusClasswork.classworkId || null);
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusClasswork, childrenLoading, children]);

  const sortedClassworkList = useMemo(() => {
    const list = [...classworkList];
    if (sortBy === "recent") {
      return list.sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
      );
    } else if (sortBy === "due") {
      return list.sort((a, b) =>
        (a.date || "9999-99-99").localeCompare(b.date || "9999-99-99"),
      );
    }
    return list;
  }, [classworkList, sortBy]);

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`cw-${highlightId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightId, classworkList]);

  if (showChildrenLoading) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <div className="aa-loading-state">
              <i className="fas fa-spinner fa-spin"></i> Loading academic
              activity…
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      <main className="main-content">
        <div className="page-container">
          {/* Main Top Header Title Block Section Wrapper */}
          {currentView === "select-subject" && (
            <div className="toolbar-aa">
              <h2 className="section-title-aa">Academic Activity</h2>
              {selectedChild && (
                <p className="aa-main-sub-title">Select Subject</p>
              )}
            </div>
          )}

          {children.length === 0 ? (
            <p className="aa-empty-text">No children linked to this account.</p>
          ) : (
            <>
              {/* Only show the child selector tabs on the "select-subject" view */}
              {currentView === "select-subject" && children.length > 1 && (
                <div className="aa-filter-group">
                  {children.map((c) => (
                    <button
                      key={c.id}
                      className={`aa-filter-btn ${selectedChild?.id === c.id ? "active" : ""}`}
                      onClick={() => switchChild(c)}
                    >
                      <i className="fas fa-user-graduate"></i>
                      {c.firstName} {c.lastName}
                    </button>
                  ))}
                </div>
              )}

              {/* SELECT SUBJECT */}
              {currentView === "select-subject" && (
                <div className="view-section-aa">
                  <div className="grid-container-aa">
                    {showSubjectsLoading ? (
                      <p className="aa-empty-text">
                        <i className="fas fa-spinner fa-spin"></i> Loading
                        subjects…
                      </p>
                    ) : subjects.length === 0 ? (
                      <p className="aa-empty-text">
                        No subjects found for this class.
                      </p>
                    ) : (
                      subjects.map((sub) => (
                        <div
                          key={sub.name}
                          className="subject-card-aa"
                          onClick={() => selectSubject(sub.name)}
                        >
                          <div className="subject-icon-box-aa">
                            <i className={`fas ${sub.icon}`}></i>
                          </div>
                          <div className="subject-info-aa">
                            <h4>{sub.name}</h4>
                            <small>Tap to view classwork</small>

                            {/* Injected Timeline Slot Display */}
                            {sub.time && (
                              <div className="subject-time-aa">
                                <i className="far fa-clock"></i> {sub.time}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* CLASSWORK FEED */}
              {currentView === "academic" && (
                <div className="view-section-aa">
                  <div className="aa-split-header-row">
                    <button
                      className="btn-back-aa-inline"
                      onClick={() => setCurrentView("select-subject")}
                      aria-label="Return to subject layout selection grid feed"
                    >
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <div className="aa-split-header-text-column">
                      <h2>{currentSubject}</h2>
                      <p>
                        Classwork Feed • Grade {selectedChild?.enrolledGrade} –{" "}
                        {selectedChild?.enrolledSection}
                      </p>
                    </div>
                  </div>

                  {/* Operational Sort Control Dropdown row */}
                  {classworkList.length > 0 && (
                    <div className="aa-sort-controls-toolbar">
                      <label htmlFor="aa-sort-select">Sort by:</label>
                      <select
                        id="aa-sort-select"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                      >
                        <option value="recent">Recently Posted</option>
                        <option value="due">Due Date</option>
                      </select>
                    </div>
                  )}

                  <div className="list-container-aa">
                    {showClassworkLoading ? (
                      <div className="aa-empty-state">
                        <i className="fas fa-spinner fa-spin"></i> Loading
                        classwork updates…
                      </div>
                    ) : sortedClassworkList.length === 0 ? (
                      <div className="aa-empty-state">
                        No classwork posted for this subject yet.
                      </div>
                    ) : (
                      sortedClassworkList.map((cw) => {
                        const editedLabel = formatEditedLabel(cw.editedAt);
                        return (
                          <div
                            key={cw.id}
                            id={`cw-${cw.id}`}
                            className={`cw-card-aa ${
                              cw.myStatus === "Submitted"
                                ? "cw-submitted-aa"
                                : cw.myStatus === "Missed"
                                  ? "cw-missed-aa"
                                  : "cw-pending-aa"
                            }`}
                            style={
                              highlightId === cw.id
                                ? {
                                    outline: "2px solid #a65f81",
                                    boxShadow:
                                      "0 0 0 4px rgba(52, 152, 219, 0.18)",
                                  }
                                : undefined
                            }
                          >
                            <div className="cw-header-aa">
                              <span className="cw-title-aa">
                                {cw.title}: {cw.desc}
                              </span>
                              <span
                                className={`cw-pill-aa ${
                                  cw.myStatus === "Submitted"
                                    ? "pill-submitted-aa"
                                    : cw.myStatus === "Missed"
                                      ? "pill-missed-aa"
                                      : "pill-pending-aa"
                                }`}
                              >
                                {cw.myStatus === "Missing"
                                  ? "Missed"
                                  : (cw.myStatus ?? "Not Marked")}
                              </span>
                            </div>
                            <div className="cw-details-aa">
                              <p>
                                <strong>Due Date:</strong> {cw.date}
                              </p>
                              <div className="cw-details-footer-aa">
                                <p className="cw-teacher-note-aa">
                                  Teacher reminder posted.
                                </p>
                                {editedLabel && (
                                  <span className="cw-edited-aa">
                                    <i className="fas fa-pen"></i> {editedLabel}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default AcademicActivity;

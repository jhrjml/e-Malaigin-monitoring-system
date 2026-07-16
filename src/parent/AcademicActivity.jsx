// AcademicActivity.jsx (Firebase version)
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

// Properly defined sort logic so the file doesn't crash
function sortMostRecentFirst(a, b) {
  const ca = a.createdAt || "";
  const cb = b.createdAt || "";
  if (ca && cb) return cb.localeCompare(ca);
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return (b.date || "9999-99-99").localeCompare(a.date || "9999-99-99");
}

function AcademicActivity({ focusClasswork, onFocusConsumed } = {}) {
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [childrenLoading, setChildrenLoading] = useState(true);

  const [currentView, setCurrentView] = useState("select-subject");
  const [subjects, setSubjects] = useState([]);
  const [currentSubject, setCurrentSubject] = useState("");
  const [classworkList, setClassworkList] = useState([]);
  const [loading, setLoading] = useState(false);

  const [sortBy, setSortBy] = useState("recent");

  const [highlightId, setHighlightId] = useState(null);
  const isJumpingRef = useRef(false);

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
        setClassworkList([]);
      }
    };
    document.addEventListener("mousedown", handleParentSidebarClick);
    return () =>
      document.removeEventListener("mousedown", handleParentSidebarClick);
  }, []);

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      setChildrenLoading(false);
      return;
    }

    const load = async () => {
      try {
        const userSnap = await getDoc(doc(db, "User", userId));
        if (!userSnap.exists()) {
          setChildrenLoading(false);
          return;
        }

        const studentIds = userSnap.data().studentIds || [];
        if (studentIds.length === 0) {
          setChildrenLoading(false);
          return;
        }

        const studentDocs = await Promise.all(
          studentIds.map((id) => getDoc(doc(db, "Student", id))),
        );

        const enriched = await Promise.all(
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

        setChildren(enriched);
        setSelectedChild(enriched[0] || null);
      } catch (e) {
        console.error(e);
      } finally {
        setChildrenLoading(false);
      }
    };
    load();
  }, []);

  const loadSubjects = useCallback(async (child) => {
    if (!child) return;
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          col("Schedule"),
          where("grade", "==", child.enrolledGrade),
          where("section", "==", child.enrolledSection),
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
      setSubjects(Array.from(subsMap.values()));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    if (isJumpingRef.current) {
      isJumpingRef.current = false;
      return;
    }
    setCurrentView("select-subject");
    setCurrentSubject("");
    setClassworkList([]);
    loadSubjects(selectedChild);
  }, [selectedChild, loadSubjects]);

  const switchChild = (child) => {
    if (child.id === selectedChild?.id) return;
    setSelectedChild(child);
  };

  const selectSubject = async (subjectName) => {
    setCurrentSubject(subjectName);
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          col("Classwork"),
          where("grade", "==", selectedChild.enrolledGrade),
          where("section", "==", selectedChild.enrolledSection),
          where("subject", "==", subjectName),
        ),
      );
      const cws = snap.docs
        .map((d) => {
          const data = d.data();
          const status = data.studentStatus?.[selectedChild.id] ?? null;
          return { id: d.id, ...data, myStatus: status };
        })
        .sort(sortMostRecentFirst);
      setClassworkList(cws);
      setCurrentView("academic");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

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

    let cancelled = false;

    const jump = async () => {
      setLoading(true);
      try {
        if (target.id !== selectedChild?.id) {
          isJumpingRef.current = true;
          setSelectedChild(target);
        }
        setCurrentSubject(focusClasswork.subject);

        const snap = await getDocs(
          query(
            col("Classwork"),
            where("grade", "==", target.enrolledGrade),
            where("section", "==", target.enrolledSection),
            where("subject", "==", focusClasswork.subject),
          ),
        );
        const cws = snap.docs
          .map((d) => {
            const data = d.data();
            const status = data.studentStatus?.[target.id] ?? null;
            return { id: d.id, ...data, myStatus: status };
          })
          .sort(sortMostRecentFirst);

        if (cancelled) return;
        setClassworkList(cws);
        setCurrentView("academic");
        setHighlightId(focusClasswork.classworkId || null);
      } catch (e) {
        console.error("Failed to open reminder:", e);
      } finally {
        if (!cancelled) setLoading(false);
        onFocusConsumed?.();
      }
    };

    jump();
    return () => {
      cancelled = true;
    };
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

  if (childrenLoading) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <p className="aa-loading-text">Loading…</p>
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

              {loading && <p className="aa-loading-text">Loading…</p>}

              {/* SELECT SUBJECT */}
              {currentView === "select-subject" && (
                <div className="view-section-aa">
                  <div className="grid-container-aa">
                    {subjects.length === 0 ? (
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
                    {sortedClassworkList.length === 0 ? (
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

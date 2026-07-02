// AcademicActivity.jsx  (Firebase version)
// Parent views their child's classwork/assignments, subject by subject.
// If the parent has more than one child, a filter bar at the top lets
// them switch between children — same UI pattern as admin Archive.jsx.
//
// Can also be "jumped into" from the Dashboard's reminder panel via the
// `focusClasswork` prop: { studentId, subject, classworkId }. When that
// prop is set, this component switches to the matching child + subject,
// opens the classwork list, and briefly highlights the matching item.

import { useState, useEffect, useCallback, useRef } from "react";
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

function AcademicActivity({ focusClasswork, onFocusConsumed } = {}) {
  // children / filter
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [childrenLoading, setChildrenLoading] = useState(true);

  // view state
  const [currentView, setCurrentView] = useState("select-subject");
  const [subjects, setSubjects] = useState([]);
  const [currentSubject, setCurrentSubject] = useState("");
  const [classworkList, setClassworkList] = useState([]);
  const [loading, setLoading] = useState(false);

  // highlight for an item opened via a reminder click
  const [highlightId, setHighlightId] = useState(null);

  // guards the child-switch effect below from resetting the view back to
  // "select-subject" when the switch was triggered by a reminder jump
  const isJumpingRef = useRef(false);

  // ── load children linked to this parent ──────────────────────────────
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

  // ── load subjects for whichever child is currently selected ──────────
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
      const subs = [...new Set(snap.docs.map((d) => d.data().subject))];
      setSubjects(subs.map((name) => ({ name, icon: iconFor(name) })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    // Skip the reset when this child was selected as part of a reminder
    // jump — that flow drives its own view/subject/classwork state below.
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

  // ── select subject → load classwork for child's grade+section+subject ───
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
      const cws = snap.docs.map((d) => {
        const data = d.data();
        const status = data.studentStatus?.[selectedChild.id] ?? null;
        return { id: d.id, ...data, myStatus: status };
      });
      setClassworkList(cws);
      setCurrentView("academic");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ── jump straight to a reminder's child + subject + item ─────────────
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
        const cws = snap.docs.map((d) => {
          const data = d.data();
          const status = data.studentStatus?.[target.id] ?? null;
          return { id: d.id, ...data, myStatus: status };
        });

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
    // selectedChild intentionally omitted — only re-run when a *new*
    // reminder is clicked or the children list finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusClasswork, childrenLoading, children]);

  // scroll the highlighted card into view, then clear the highlight
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
          <div className="toolbar-aa">
            <h2 className="section-title-aa">Academic Activity</h2>
          </div>

          {children.length === 0 ? (
            <p className="aa-empty-text">No children linked to this account.</p>
          ) : (
            <>
              {/* CHILD FILTER — same pattern as admin Archive.jsx */}
              {children.length > 1 && (
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
                  <h3 className="aa-sub-title">
                    {selectedChild?.firstName} {selectedChild?.lastName} —
                    Select Subject
                  </h3>
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
                          <div className="subject-icon-aa">
                            <i className={`fas ${sub.icon}`}></i>
                          </div>
                          <div className="subject-info-aa">
                            <h4>{sub.name}</h4>
                            <small>Tap to view classwork</small>
                          </div>
                          <i className="fas fa-chevron-right"></i>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* CLASSWORK */}
              {currentView === "academic" && (
                <div className="view-section-aa">
                  <div className="toolbar-inner-aa">
                    <button
                      className="btn-back-aa"
                      onClick={() => setCurrentView("select-subject")}
                    >
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <h3>{currentSubject} Classwork</h3>
                  </div>
                  <div className="list-container-aa">
                    {classworkList.length === 0 ? (
                      <div className="aa-empty-state">
                        No classwork posted for this subject yet.
                      </div>
                    ) : (
                      classworkList.map((cw) => (
                        <div
                          key={cw.id}
                          id={`cw-${cw.id}`}
                          className={`cw-card-aa ${
                            cw.myStatus === "Submitted"
                              ? "cw-submitted-aa"
                              : cw.myStatus === "Missing"
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
                                  : cw.myStatus === "Missing"
                                    ? "pill-missed-aa"
                                    : "pill-pending-aa"
                              }`}
                            >
                              {cw.myStatus ?? "Not Marked"}
                            </span>
                          </div>
                          <div className="cw-details-aa">
                            <p>
                              <strong>Due Date:</strong> {cw.date}
                            </p>
                            <p>Teacher reminder posted.</p>
                          </div>
                        </div>
                      ))
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

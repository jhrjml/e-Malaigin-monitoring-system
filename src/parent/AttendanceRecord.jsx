// AttendanceRecord.jsx  (Firebase version)
// Parent views their child's attendance records, subject by subject.
// If the parent has more than one child, a filter bar at the top lets
// them switch between children — same UI pattern as admin Archive.jsx.

import { useState, useEffect, useCallback } from "react";
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
import "./AttendanceRecord.css";

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

function AttendanceRecord() {
  // children / filter
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [childrenLoading, setChildrenLoading] = useState(true);

  // view state
  const [currentView, setCurrentView] = useState("select-subject");
  const [subjects, setSubjects] = useState([]);
  const [currentSubject, setCurrentSubject] = useState("");
  const [availableMonths, setAvailableMonths] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(false);

  // ── load children linked to this parent ──────────────────────────────
  useEffect(() => {
    setToday(new Date().toISOString().split("T")[0]);

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
    setCurrentView("select-subject");
    setCurrentSubject("");
    setAvailableMonths([]);
    setAttendanceLogs([]);
    loadSubjects(selectedChild);
  }, [selectedChild, loadSubjects]);

  const switchChild = (child) => {
    if (child.id === selectedChild?.id) return;
    setSelectedChild(child);
  };

  // ── select subject → load distinct months with records ───────────────
  const selectSubject = async (subjectName) => {
    setCurrentSubject(subjectName);
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          col("Attendance"),
          where("studentId", "==", selectedChild.id),
          where("subject", "==", subjectName),
        ),
      );
      const logs = snap.docs.map((d) => d.data());
      const months = [...new Set(logs.map((l) => l.date.substring(0, 7)))]
        .map((m) => ({
          id: m,
          name: new Date(m + "-01").toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          }),
        }))
        .sort((a, b) => b.id.localeCompare(a.id));
      setAvailableMonths(months);
      setCurrentView("select-month");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const selectMonth = async (monthId) => {
    setSelectedMonth(monthId);
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          col("Attendance"),
          where("studentId", "==", selectedChild.id),
          where("subject", "==", currentSubject),
        ),
      );
      const logs = snap.docs
        .map((d) => d.data())
        .filter((l) => l.date.startsWith(monthId))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      setAttendanceLogs(logs);
      setCurrentView("attendance");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const todayLog = attendanceLogs.find((l) => l.date === today);

  if (childrenLoading) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <p className="ar-loading-text">Loading…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      <main className="main-content">
        <div className="page-container">
          <div className="toolbar">
            <h2 className="section-title">Attendance Record</h2>
          </div>

          {children.length === 0 ? (
            <p className="ar-empty-text">No children linked to this account.</p>
          ) : (
            <>
              {/* CHILD FILTER — same pattern as admin Archive.jsx */}
              {children.length > 1 && (
                <div className="ar-filter-group">
                  {children.map((c) => (
                    <button
                      key={c.id}
                      className={`ar-filter-btn ${selectedChild?.id === c.id ? "active" : ""}`}
                      onClick={() => switchChild(c)}
                    >
                      <i className="fas fa-user-graduate"></i>
                      {c.firstName} {c.lastName}
                    </button>
                  ))}
                </div>
              )}

              {loading && <p className="ar-loading-text">Loading…</p>}

              {/* SELECT SUBJECT */}
              {currentView === "select-subject" && (
                <div className="view-section-ar">
                  <h3 className="ar-sub-title">
                    {selectedChild?.firstName} {selectedChild?.lastName} —
                    Select Subject
                  </h3>
                  <div className="grid-container-ar">
                    {subjects.length === 0 ? (
                      <p className="ar-empty-text">
                        No subjects found for this class.
                      </p>
                    ) : (
                      subjects.map((sub) => (
                        <div
                          key={sub.name}
                          className="subject-card-ar"
                          onClick={() => selectSubject(sub.name)}
                        >
                          <div className="subject-icon-ar">
                            <i className={`fas ${sub.icon}`}></i>
                          </div>
                          <div className="subject-info-ar">
                            <h4>{sub.name}</h4>
                            <small>Tap to view attendance</small>
                          </div>
                          <i className="fas fa-chevron-right"></i>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* SELECT MONTH */}
              {currentView === "select-month" && (
                <div className="view-section-ar">
                  <div className="toolbar-inner-ar">
                    <button
                      className="btn-back-ar"
                      onClick={() => setCurrentView("select-subject")}
                    >
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <h3>{currentSubject} Attendance</h3>
                  </div>
                  <div className="grid-container-ar">
                    {availableMonths.length === 0 ? (
                      <p className="ar-empty-text">
                        No attendance records yet.
                      </p>
                    ) : (
                      availableMonths.map((m) => (
                        <div
                          key={m.id}
                          className="choice-card-ar"
                          onClick={() => selectMonth(m.id)}
                        >
                          <div className="icon-box-ar">
                            <i className="fas fa-calendar-alt"></i>
                          </div>
                          <h3>{m.name}</h3>
                          <p>View Records</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ATTENDANCE LOGS */}
              {currentView === "attendance" && (
                <div className="view-section-ar">
                  <div className="toolbar-inner-ar">
                    <button
                      className="btn-back-ar"
                      onClick={() => setCurrentView("select-month")}
                    >
                      <i className="fas fa-arrow-left"></i>
                    </button>
                    <h3>{currentSubject} Attendance</h3>
                  </div>

                  <div className="today-status-card-ar">
                    <h4>Today's Attendance ({today})</h4>
                    <div
                      className={`status-badge-ar ${todayLog ? `status-${todayLog.status.toLowerCase()}` : ""}`}
                    >
                      {todayLog ? todayLog.status : "No Record Yet"}
                    </div>
                  </div>

                  <div className="table-container-ar">
                    <table className="data-table-ar">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Day</th>
                          <th style={{ textAlign: "center" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendanceLogs.length === 0 ? (
                          <tr>
                            <td colSpan="3" style={{ textAlign: "center" }}>
                              No records for this month.
                            </td>
                          </tr>
                        ) : (
                          attendanceLogs.map((log, i) => {
                            const dayName = new Date(
                              log.date,
                            ).toLocaleDateString("en-US", {
                              weekday: "long",
                            });
                            return (
                              <tr key={i}>
                                <td>{log.date}</td>
                                <td>{dayName}</td>
                                <td style={{ textAlign: "center" }}>
                                  <span
                                    className={`status-${log.status.toLowerCase()}`}
                                  >
                                    {log.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
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

export default AttendanceRecord;

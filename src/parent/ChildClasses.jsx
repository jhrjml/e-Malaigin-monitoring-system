// ChildClasses.jsx  (Firebase version)
// Parent sees their child's attendance records and classwork activities.
// Data flows: Admin adds student → Teacher logs attendance/classwork → Parent views here.

import { useState, useEffect } from "react";
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
import "./ChildClasses.css";

const col = (name) => collection(db, name);

function ChildClasses() {
  const [currentView, setCurrentView] = useState("select-child");
  const [currentActivity, setCurrentActivity] = useState("");
  const [currentSubject, setCurrentSubject] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [today, setToday] = useState("");

  // data
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [availableMonths, setAvailableMonths] = useState([]);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [classworkList, setClassworkList] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── load children linked to this parent ──────────────────────────────
  useEffect(() => {
    setToday(new Date().toISOString().split("T")[0]);

    const userId = localStorage.getItem("userId");
    if (!userId) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const userSnap = await getDoc(doc(db, "User", userId));
        if (!userSnap.exists()) {
          setLoading(false);
          return;
        }

        const studentIds = userSnap.data().studentIds || [];
        if (studentIds.length === 0) {
          setLoading(false);
          return;
        }

        const studentDocs = await Promise.all(
          studentIds.map((id) => getDoc(doc(db, "Student", id))),
        );

        // Enrich each student with their active enrollment
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
        // If only one child, skip the select-child screen
        if (enriched.length === 1) {
          setSelectedChild(enriched[0]);
          setCurrentView("select-activity");
        } else {
          setCurrentView("select-child");
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── when child + activity + subject selected, load subjects list ──────
  const loadSubjects = async (child) => {
    try {
      // Get schedules for child's grade+section to know which subjects exist
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
    }
  };

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

  // ── navigation ────────────────────────────────────────────────────────
  const selectChild = async (child) => {
    setSelectedChild(child);
    await loadSubjects(child);
    setCurrentView("select-activity");
  };

  const selectActivity = async (type) => {
    setCurrentActivity(type);
    if (subjects.length === 0) await loadSubjects(selectedChild);
    setCurrentView("select-subject");
  };

  const selectSubject = async (subjectName) => {
    setCurrentSubject(subjectName);

    if (currentActivity === "attendance") {
      // Load distinct months that have records for this child + subject
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
    } else {
      // Academic: load classwork for child's grade+section+subject
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

  // today's attendance status
  const todayLog = attendanceLogs.find((l) => l.date === today);

  if (loading && children.length === 0) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <p
              style={{ padding: "30px", textAlign: "center", color: "#3498db" }}
            >
              Loading…
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      <main className="main-content">
        <div className="page-container">
          {loading && (
            <p
              style={{
                padding: "10px",
                color: "#3498db",
                fontSize: "0.875rem",
              }}
            >
              Loading…
            </p>
          )}

          {/* SELECT CHILD (only shown when parent has 2+ children) */}
          {currentView === "select-child" && (
            <div className="view-section-cc">
              <h2 className="section-title">Select Child</h2>
              <div className="card-grid">
                {children.length === 0 ? (
                  <p style={{ color: "#999" }}>
                    No children linked to this account.
                  </p>
                ) : (
                  children.map((c) => (
                    <div
                      key={c.id}
                      className="choice-card"
                      onClick={() => selectChild(c)}
                    >
                      <div className="icon-box-cc bg-blue">
                        <i className="fas fa-user-graduate"></i>
                      </div>
                      <h3>
                        {c.firstName} {c.lastName}
                      </h3>
                      <p>
                        Grade {c.enrolledGrade} — Section {c.enrolledSection}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* SELECT ACTIVITY */}
          {currentView === "select-activity" && (
            <div className="view-section-cc">
              {children.length > 1 && (
                <div className="toolbar">
                  <button
                    className="btn-back"
                    onClick={() => setCurrentView("select-child")}
                  >
                    <i className="fas fa-arrow-left"></i> Back
                  </button>
                  <h2 className="section-title">
                    {selectedChild?.firstName} {selectedChild?.lastName}
                  </h2>
                </div>
              )}
              {children.length === 1 && (
                <h2 className="section-title" style={{ marginBottom: "20px" }}>
                  Select Record Type
                </h2>
              )}
              <div className="card-grid">
                <div
                  className="choice-card"
                  onClick={() => selectActivity("attendance")}
                >
                  <div className="icon-box-cc bg-blue">
                    <i className="fas fa-clipboard-check"></i>
                  </div>
                  <h3>Attendance Record</h3>
                  <p>View daily logs and monthly history</p>
                </div>
                <div
                  className="choice-card"
                  onClick={() => selectActivity("academic")}
                >
                  <div className="icon-box-cc bg-purple">
                    <i className="fas fa-book-open"></i>
                  </div>
                  <h3>Academic Activity</h3>
                  <p>View classwork, assignments, and quizzes</p>
                </div>
              </div>
            </div>
          )}

          {/* SELECT SUBJECT */}
          {currentView === "select-subject" && (
            <div className="view-section-cc">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("select-activity")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <h2 className="section-title">Select Subject</h2>
              </div>
              <div className="grid-container">
                {subjects.length === 0 ? (
                  <p style={{ color: "#999" }}>
                    No subjects found for this class.
                  </p>
                ) : (
                  subjects.map((sub) => (
                    <div
                      key={sub.name}
                      className="subject-card"
                      onClick={() => selectSubject(sub.name)}
                    >
                      <div className="subject-icon">
                        <i className={`fas ${sub.icon}`}></i>
                      </div>
                      <div className="subject-info">
                        <h4>{sub.name}</h4>
                        <small>Tap to view records</small>
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
            <div className="view-section-cc">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("select-subject")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <h3>{currentSubject} Attendance</h3>
              </div>
              <div className="grid-container">
                {availableMonths.length === 0 ? (
                  <p style={{ color: "#999", padding: "20px" }}>
                    No attendance records yet.
                  </p>
                ) : (
                  availableMonths.map((m) => (
                    <div
                      key={m.id}
                      className="choice-card"
                      onClick={() => selectMonth(m.id)}
                    >
                      <div className="icon-box-cc bg-blue">
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
            <div className="view-section-cc">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("select-month")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <h3>{currentSubject} Attendance</h3>
              </div>

              <div className="today-status-card">
                <h4>Today's Attendance ({today})</h4>
                <div
                  className={`status-badge ${todayLog ? `status-${todayLog.status.toLowerCase()}` : ""}`}
                >
                  {todayLog ? todayLog.status : "No Record Yet"}
                </div>
              </div>

              <div className="history-section">
                <div className="table-container">
                  <table className="data-table">
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
                          const dayName = new Date(log.date).toLocaleDateString(
                            "en-US",
                            { weekday: "long" },
                          );
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
            </div>
          )}

          {/* ACADEMIC / CLASSWORK */}
          {currentView === "academic" && (
            <div className="view-section-cc">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("select-subject")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <h3>{currentSubject} Classwork</h3>
              </div>
              <div className="list-container">
                {classworkList.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "30px",
                      color: "#999",
                    }}
                  >
                    No classwork posted for this subject yet.
                  </div>
                ) : (
                  classworkList.map((cw) => (
                    <div
                      key={cw.id}
                      className={`cw-card-cc ${cw.myStatus === "Submitted" ? "cw-submitted" : cw.myStatus === "Missing" ? "cw-missed" : "cw-pending"}`}
                    >
                      <div className="cw-header">
                        <span className="cw-title">
                          {cw.title}: {cw.desc}
                        </span>
                        <span
                          className={`cw-pill ${cw.myStatus === "Submitted" ? "pill-submitted" : cw.myStatus === "Missing" ? "pill-missed" : "pill-pending"}`}
                        >
                          {cw.myStatus ?? "Not Marked"}
                        </span>
                      </div>
                      <div className="cw-details">
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
        </div>
      </main>
    </div>
  );
}

export default ChildClasses;

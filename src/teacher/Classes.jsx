// Classes.jsx  (Firebase version — real QR scanner + fixed classwork marking)
import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "../api/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { BrowserQRCodeReader } from "@zxing/browser";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./Classes.css";

const col = (name) => collection(db, name);

function Classes() {
  const [currentView, setCurrentView] = useState("activity");
  const [currentActivity, setCurrentActivity] = useState("");
  const [classGrade, setClassGrade] = useState(null);
  const [classSection, setClassSection] = useState("");
  const [classSubject, setClassSubject] = useState("");
  const [attendanceRecords, setAttendanceRecords] = useState({}); // { studentId: { time, status } }
  const [classworks, setClassworks] = useState([]);
  const [gradingCW, setGradingCW] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [newCW, setNewCW] = useState({ title: "", desc: "", date: "" });
  const [students, setStudents] = useState([]);
  const [teacherLoads, setTeacherLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── QR scanner state ──────────────────────────────────────────────────
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState(""); // feedback after scan
  const [scanStatus, setScanStatus] = useState(""); // "success" | "error" | "warning" | ""
  const [scheduleEnded, setScheduleEnded] = useState(false);
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const scannedRef = useRef(new Set()); // tracks already-scanned LRNs this session

  // ── current schedule time window ─────────────────────────────────────
  // Pulled from the matching teacherLoad entry for auto-absent on close
  const currentSchedule = teacherLoads.find(
    (l) =>
      l.grade === classGrade &&
      l.section === classSection &&
      l.subject === classSubject,
  );

  // ─────────────────────────────────────────────────────────────────────
  // STEP 1: resolve User → teacherId → Schedule
  // ─────────────────────────────────────────────────────────────────────
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
          setError("No teacher profile linked to this account.");
          return;
        }

        const schedSnap = await getDocs(
          query(col("Schedule"), where("teacherId", "==", teacherDocId)),
        );
        const loads = schedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setTeacherLoads(loads);
        if (loads.length === 0)
          setError(
            "No subjects have been assigned to you yet. Please contact the admin.",
          );
      } catch (e) {
        console.error(e);
        setError("Failed to load your class assignments.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // STEP 2: load enrolled students when grade + section changes
  // ─────────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────
  // STEP 3: load classworks when subject changes
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!classGrade || !classSection || !classSubject) return;
    getDocs(
      query(
        col("Classwork"),
        where("grade", "==", classGrade),
        where("section", "==", classSection),
        where("subject", "==", classSubject),
      ),
    )
      .then((snap) =>
        setClassworks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      )
      .catch(console.error);
  }, [classGrade, classSection, classSubject]);

  // ─────────────────────────────────────────────────────────────────────
  // DERIVED
  // ─────────────────────────────────────────────────────────────────────
  const grades = [...new Set(teacherLoads.map((l) => l.grade))].sort(
    (a, b) => a - b,
  );
  const sections = classGrade
    ? [
        ...new Set(
          teacherLoads
            .filter((l) => l.grade === classGrade)
            .map((l) => l.section),
        ),
      ].sort()
    : [];
  const subjects =
    classGrade && classSection
      ? [
          ...new Set(
            teacherLoads
              .filter(
                (l) => l.grade === classGrade && l.section === classSection,
              )
              .map((l) => l.subject),
          ),
        ]
      : [];

  // ─────────────────────────────────────────────────────────────────────
  // NAVIGATION
  // ─────────────────────────────────────────────────────────────────────
  const selectActivity = (type) => {
    setCurrentActivity(type);
    setCurrentView("grade");
  };
  const selectClassGrade = (g) => {
    setClassGrade(g);
    setCurrentView("section");
  };
  const selectClassSection = (sec) => {
    setClassSection(sec);
    setCurrentView("subject");
  };

  const selectClassSubject = (sub) => {
    setClassSubject(sub);
    if (currentActivity === "attendance") {
      // init all students as Absent — do NOT pre-set; will be set on scan or on close
      scannedRef.current = new Set();
      setAttendanceRecords({});
      setScheduleEnded(false);
      setCurrentView("attendance");
    } else {
      setCurrentView("classworkList");
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // QR SCANNER — open / close / scan
  // ─────────────────────────────────────────────────────────────────────
  const openScanner = useCallback(() => {
    setScanMessage("");
    setScanStatus("");
    setScannerOpen(true);
  }, []);

  // Start the camera once the modal is open and videoRef is mounted
  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;

    const reader = new BrowserQRCodeReader();
    readerRef.current = reader;

    reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err) => {
      if (result) {
        handleQRResult(result.getText());
      }
    });

    return () => {
      // stop camera on unmount
      if (readerRef.current) {
        try {
          readerRef.current.reset();
        } catch (_) {}
      }
    };
  }, [scannerOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQRResult = useCallback(
    async (lrn) => {
      // Duplicate scan guard
      if (scannedRef.current.has(lrn)) {
        setScanMessage(
          `QR already scanned for LRN ${lrn}. Duplicate scan ignored.`,
        );
        setScanStatus("warning");
        return;
      }

      // Find student by LRN
      const student = students.find((s) => s.lrn === lrn);
      if (!student) {
        setScanMessage(`LRN ${lrn} is not enrolled in this class.`);
        setScanStatus("error");
        return;
      }

      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const today = new Date().toISOString().split("T")[0];

      // Mark present in local state
      setAttendanceRecords((prev) => ({
        ...prev,
        [student.id]: { time, status: "Present" },
      }));

      // Mark as scanned so duplicates are rejected
      scannedRef.current.add(lrn);

      setScanMessage(
        `✓ ${student.lastName}, ${student.firstName} marked Present at ${time}`,
      );
      setScanStatus("success");

      // Persist to Firestore
      try {
        await addDoc(col("Attendance"), {
          studentId: student.id,
          name: `${student.lastName}, ${student.firstName}`,
          lrn: student.lrn,
          grade: classGrade,
          section: classSection,
          subject: classSubject,
          date: today,
          time,
          status: "Present",
        });
      } catch (e) {
        console.error("Failed to save attendance:", e);
      }
    },
    [students, classGrade, classSection, classSubject],
  );

  const closeScanner = useCallback(() => {
    if (readerRef.current) {
      try {
        readerRef.current.reset();
      } catch (_) {}
    }
    setScannerOpen(false);
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // CLOSE ATTENDANCE — mark everyone not scanned as Absent
  // ─────────────────────────────────────────────────────────────────────
  const closeAttendance = async () => {
    const today = new Date().toISOString().split("T")[0];

    const absentStudents = students.filter(
      (s) => !scannedRef.current.has(s.lrn),
    );

    // update local state
    const absentRecords = {};
    absentStudents.forEach((s) => {
      absentRecords[s.id] = { time: "--", status: "Absent" };
    });
    setAttendanceRecords((prev) => ({ ...prev, ...absentRecords }));
    setScheduleEnded(true);

    // persist absent records to Firestore
    await Promise.all(
      absentStudents.map((s) =>
        addDoc(col("Attendance"), {
          studentId: s.id,
          name: `${s.lastName}, ${s.firstName}`,
          lrn: s.lrn,
          grade: classGrade,
          section: classSection,
          subject: classSubject,
          date: today,
          time: "--",
          status: "Absent",
        }),
      ),
    );
  };

  // ─────────────────────────────────────────────────────────────────────
  // CLASSWORK
  // ─────────────────────────────────────────────────────────────────────
  const saveClasswork = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...newCW,
        grade: classGrade,
        section: classSection,
        subject: classSubject,
        studentStatus: {}, // empty — teacher fills in manually via View
      };
      const ref = await addDoc(col("Classwork"), payload);
      setClassworks((prev) => [...prev, { id: ref.id, ...payload }]);
      setShowModal(false);
      setNewCW({ title: "", desc: "", date: "" });
    } catch (e) {
      console.error(e);
    }
  };

  const openGrading = (cw) => {
    // Load fresh from state (already fetched); do NOT pre-fill missing statuses
    setGradingCW({ ...cw });
    setCurrentView("grading");
  };

  const markStudent = async (studentId, status) => {
    const updated = {
      ...gradingCW,
      studentStatus: {
        ...(gradingCW.studentStatus || {}),
        [studentId]: status,
      },
    };
    setGradingCW(updated);

    // also update classworks list so the count stays in sync
    setClassworks((prev) =>
      prev.map((cw) =>
        cw.id === gradingCW.id
          ? { ...cw, studentStatus: updated.studentStatus }
          : cw,
      ),
    );

    try {
      await updateDoc(doc(db, "Classwork", gradingCW.id), {
        studentStatus: updated.studentStatus,
      });
    } catch (e) {
      console.error(e);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // LOADING SCREEN
  // ─────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="teacher-dashboard">
        <main className="main-content">
          <div className="page-container">
            <p
              style={{ padding: "30px", textAlign: "center", color: "#3498db" }}
            >
              Loading your class assignments…
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────
  return (
    <div className="teacher-dashboard">
      <main className="main-content">
        <div className="page-container">
          {/* ── ACTIVITY ── */}
          {currentView === "activity" && (
            <div className="view-section active">
              <div className="toolbar">
                <h2 className="section-title">Select Activity</h2>
              </div>
              {error && (
                <div
                  style={{
                    background: "#fff3cd",
                    border: "1px solid #ffc107",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    marginBottom: "16px",
                    color: "#856404",
                    fontSize: "0.9rem",
                  }}
                >
                  <i
                    className="fas fa-exclamation-triangle"
                    style={{ marginRight: "8px" }}
                  ></i>
                  {error}
                </div>
              )}
              <div className="dashboard-grid">
                <div
                  className="card-link"
                  onClick={() => selectActivity("attendance")}
                >
                  <div className="icon-box bg-blue">
                    <i className="fas fa-clipboard-check"></i>
                  </div>
                  <h3>Attendance Monitoring</h3>
                  <p>Scan QR &amp; Log Entry</p>
                </div>
                <div
                  className="card-link"
                  onClick={() => selectActivity("classwork")}
                >
                  <div className="icon-box bg-purple">
                    <i className="fas fa-book-open"></i>
                  </div>
                  <h3>Classwork Reminding</h3>
                  <p>Post Tasks &amp; Track Grades</p>
                </div>
              </div>
            </div>
          )}

          {/* ── GRADE ── */}
          {currentView === "grade" && (
            <div className="view-section">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("activity")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <h2 className="section-title">Select Grade Level</h2>
              </div>
              {grades.length === 0 ? (
                <p
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#999",
                  }}
                >
                  No grade levels assigned.
                </p>
              ) : (
                <div className="grid-container">
                  {grades.map((g) => (
                    <div
                      key={g}
                      className="card-link"
                      onClick={() => selectClassGrade(g)}
                    >
                      <div
                        className="icon-box bg-blue"
                        style={{ fontSize: "1.5rem", fontWeight: "bold" }}
                      >
                        {g}
                      </div>
                      <h3>Grade {g}</h3>
                      <p>Select Level</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── SECTION ── */}
          {currentView === "section" && (
            <div className="view-section">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("grade")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <h2 className="section-title">Select Section</h2>
              </div>
              <div className="grid-container">
                {sections.map((sec) => (
                  <div
                    key={sec}
                    className="card-link"
                    onClick={() => selectClassSection(sec)}
                  >
                    <div className="icon-box bg-purple">
                      <i className="fas fa-users"></i>
                    </div>
                    <h3>Section {sec}</h3>
                    <p>Select Section</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── SUBJECT ── */}
          {currentView === "subject" && (
            <div className="view-section">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("section")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <h2 className="section-title">Select Subject</h2>
              </div>
              <div className="grid-container">
                {subjects.map((sub) => (
                  <div
                    key={sub}
                    className="card-link"
                    onClick={() => selectClassSubject(sub)}
                  >
                    <div className="icon-box bg-green">
                      <i className="fas fa-book"></i>
                    </div>
                    <h3>{sub}</h3>
                    <p>Select Subject</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ATTENDANCE ── */}
          {currentView === "attendance" && (
            <div className="view-section">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("subject")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <div>
                  <h3>{classSubject} Attendance</h3>
                  <small>
                    {new Date().toLocaleDateString()} | G{classGrade}-
                    {classSection}
                    {currentSchedule &&
                      ` | ${currentSchedule.start} – ${currentSchedule.end}`}
                  </small>
                </div>
                <div
                  style={{ marginLeft: "auto", display: "flex", gap: "8px" }}
                >
                  {!scheduleEnded && (
                    <button className="btn-scan" onClick={openScanner}>
                      <i className="fas fa-qrcode"></i> Scan QR
                    </button>
                  )}
                  {!scheduleEnded && (
                    <button
                      onClick={closeAttendance}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "8px",
                        border: "none",
                        background: "#e74c3c",
                        color: "#fff",
                        fontWeight: "600",
                        cursor: "pointer",
                      }}
                    >
                      <i
                        className="fas fa-lock"
                        style={{ marginRight: "6px" }}
                      ></i>
                      Close Attendance
                    </button>
                  )}
                  {scheduleEnded && (
                    <span
                      style={{
                        padding: "8px 16px",
                        borderRadius: "8px",
                        background: "#ecf0f1",
                        color: "#7f8c8d",
                        fontWeight: "600",
                        fontSize: "0.85rem",
                      }}
                    >
                      <i
                        className="fas fa-lock"
                        style={{ marginRight: "6px" }}
                      ></i>
                      Attendance Closed
                    </span>
                  )}
                </div>
              </div>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student Name</th>
                      <th style={{ textAlign: "center" }}>Time In</th>
                      <th style={{ textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.length === 0 ? (
                      <tr>
                        <td
                          colSpan="3"
                          style={{
                            textAlign: "center",
                            padding: "20px",
                            color: "#999",
                          }}
                        >
                          No students enrolled in this section.
                        </td>
                      </tr>
                    ) : (
                      students.map((s) => {
                        const rec = attendanceRecords[s.id];
                        // only show status after scanning starts or attendance is closed
                        const showStatus = rec !== undefined;
                        return (
                          <tr key={s.id}>
                            <td style={{ fontWeight: "bold" }}>
                              {s.lastName}, {s.firstName}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              {rec?.time ?? "—"}
                            </td>
                            <td style={{ textAlign: "center" }}>
                              {showStatus ? (
                                <span
                                  style={{
                                    color:
                                      rec.status === "Present"
                                        ? "var(--success)"
                                        : "var(--danger)",
                                    fontWeight: "bold",
                                    background:
                                      rec.status === "Present"
                                        ? "rgba(46,204,113,0.1)"
                                        : "rgba(231,76,60,0.1)",
                                    padding: "5px 15px",
                                    borderRadius: "15px",
                                  }}
                                >
                                  {rec.status}
                                </span>
                              ) : (
                                <span
                                  style={{ color: "#bbb", fontSize: "0.85rem" }}
                                >
                                  Pending
                                </span>
                              )}
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

          {/* ── CLASSWORK LIST ── */}
          {currentView === "classworkList" && (
            <div className="view-section">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("subject")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <div>
                  <h3>{classSubject} Reminders</h3>
                  <small>
                    Grade {classGrade} - Section {classSection}
                  </small>
                </div>
              </div>
              <div className="list-container">
                {classworks.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "30px",
                      color: "#999",
                    }}
                  >
                    No reminders posted yet. Tap + to add one.
                  </div>
                ) : (
                  classworks.map((cw) => {
                    // count how many students have been marked (any status set)
                    const markedCount = Object.keys(
                      cw.studentStatus || {},
                    ).length;
                    return (
                      <div key={cw.id} className="cw-card-classes">
                        <div>
                          <h4>{cw.title}</h4>
                          <p>{cw.desc}</p>
                          <small>Due: {cw.date}</small>
                          {markedCount > 0 && (
                            <small
                              style={{ marginLeft: "10px", color: "#3498db" }}
                            >
                              • {markedCount} student
                              {markedCount > 1 ? "s" : ""} marked
                            </small>
                          )}
                        </div>
                        <button
                          className="btn-view-classes"
                          onClick={() => openGrading(cw)}
                        >
                          View
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <button
                className="fab-add-classes"
                onClick={() => setShowModal(true)}
              >
                <i className="fas fa-plus"></i>
              </button>
            </div>
          )}

          {/* ── GRADING ── */}
          {currentView === "grading" && gradingCW && (
            <div className="view-section">
              <div className="toolbar">
                <button
                  className="btn-back"
                  onClick={() => setCurrentView("classworkList")}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <div>
                  <h3>{gradingCW.title}</h3>
                  <small>
                    Due: {gradingCW.date} | Grade {classGrade} - Section{" "}
                    {classSection}
                  </small>
                </div>
              </div>
              <p
                style={{
                  padding: "0 0 12px",
                  color: "#7f8c8d",
                  fontSize: "0.875rem",
                }}
              >
                <i
                  className="fas fa-info-circle"
                  style={{ marginRight: "6px" }}
                ></i>
                Tap a button to manually set each student's status. Unmarked
                students show as "Not Set".
              </p>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Student Name</th>
                      <th style={{ textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student) => {
                      const status = gradingCW.studentStatus?.[student.id]; // undefined = not yet set
                      return (
                        <tr key={student.id}>
                          <td style={{ fontWeight: "bold" }}>
                            {student.lastName}, {student.firstName}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button
                              className="toggle-btn"
                              onClick={() =>
                                markStudent(student.id, "Submitted")
                              }
                              style={{
                                marginRight: "8px",
                                background:
                                  status === "Submitted"
                                    ? "var(--success)"
                                    : "#ddd",
                                color: status === "Submitted" ? "#fff" : "#333",
                              }}
                            >
                              Submitted
                            </button>
                            <button
                              className="toggle-btn"
                              onClick={() => markStudent(student.id, "Missing")}
                              style={{
                                background:
                                  status === "Missing"
                                    ? "var(--danger)"
                                    : "#ddd",
                                color: status === "Missing" ? "#fff" : "#333",
                              }}
                            >
                              Missing
                            </button>
                            {!status && (
                              <span
                                style={{
                                  marginLeft: "8px",
                                  color: "#bbb",
                                  fontSize: "0.8rem",
                                }}
                              >
                                Not set
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ADD CLASSWORK MODAL ── */}
          {showModal && (
            <div className="modal-overlay">
              <div className="modal-content-classes add-classwork-modal">
                <div className="modal-header">
                  <h3>New Classwork Reminder</h3>
                  <span
                    className="close-modal"
                    onClick={() => setShowModal(false)}
                  >
                    &times;
                  </span>
                </div>
                <div className="modal-body">
                  <form onSubmit={saveClasswork}>
                    <div className="form-group">
                      <label>Title (Type)</label>
                      <select
                        required
                        value={newCW.title}
                        onChange={(e) =>
                          setNewCW({ ...newCW, title: e.target.value })
                        }
                      >
                        <option value="" disabled>
                          Select Type...
                        </option>
                        {["Assignment", "Oral", "Project", "Quiz", "Exam"].map(
                          (t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Details</label>
                      <textarea
                        required
                        rows={3}
                        value={newCW.desc}
                        onChange={(e) =>
                          setNewCW({ ...newCW, desc: e.target.value })
                        }
                        placeholder="Enter instructions or details..."
                      />
                    </div>
                    <div className="form-group">
                      <label>Due Date</label>
                      <input
                        type="date"
                        required
                        value={newCW.date}
                        onChange={(e) =>
                          setNewCW({ ...newCW, date: e.target.value })
                        }
                      />
                    </div>
                    <div className="modal-footer">
                      <button
                        type="button"
                        className="btn-cancel"
                        onClick={() => setShowModal(false)}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn-save">
                        Post Reminder
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── QR SCANNER MODAL ── */}
      {scannerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "16px",
              padding: "24px",
              width: "min(95vw, 400px)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
          >
            {/* header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#1a252f" }}>
                <i
                  className="fas fa-qrcode"
                  style={{ marginRight: "8px", color: "#3498db" }}
                ></i>
                Scan Student QR Code
              </h3>
              <button
                onClick={closeScanner}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.4rem",
                  cursor: "pointer",
                  color: "#7f8c8d",
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>

            {/* viewfinder */}
            <div
              style={{
                position: "relative",
                borderRadius: "10px",
                overflow: "hidden",
                background: "#000",
                aspectRatio: "1",
              }}
            >
              <video
                ref={videoRef}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              {/* scanning crosshair overlay */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    width: "60%",
                    aspectRatio: "1",
                    border: "3px solid rgba(52,152,219,0.8)",
                    borderRadius: "12px",
                    boxShadow: "0 0 0 2000px rgba(0,0,0,0.35)",
                  }}
                />
              </div>
            </div>

            {/* feedback message */}
            {scanMessage && (
              <div
                style={{
                  marginTop: "14px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  fontSize: "0.875rem",
                  fontWeight: "600",
                  textAlign: "center",
                  background:
                    scanStatus === "success"
                      ? "rgba(46,204,113,0.12)"
                      : scanStatus === "warning"
                        ? "rgba(241,196,15,0.12)"
                        : "rgba(231,76,60,0.12)",
                  color:
                    scanStatus === "success"
                      ? "#27ae60"
                      : scanStatus === "warning"
                        ? "#f39c12"
                        : "#e74c3c",
                  border: `1px solid ${
                    scanStatus === "success"
                      ? "#27ae60"
                      : scanStatus === "warning"
                        ? "#f39c12"
                        : "#e74c3c"
                  }`,
                }}
              >
                {scanMessage}
              </div>
            )}

            <p
              style={{
                textAlign: "center",
                color: "#95a5a6",
                fontSize: "0.8rem",
                margin: "12px 0 4px",
              }}
            >
              Point the camera at the student's QR code
            </p>

            <button
              onClick={closeScanner}
              style={{
                width: "100%",
                marginTop: "8px",
                padding: "10px",
                borderRadius: "8px",
                border: "none",
                background: "#ecf0f1",
                color: "#2c3e50",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Done Scanning
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Classes;

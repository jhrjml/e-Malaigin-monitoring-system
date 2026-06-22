// AttendanceMonitoring.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "../api/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { BrowserQRCodeReader } from "@zxing/browser";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./AttendanceMonitoring.css";

const col = (name) => collection(db, name);

// ── Mobile detection ──────────────────────────────────────────────────────────
// QR scanning is only allowed on phones/tablets.
const IS_MOBILE =
  /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  ) ||
  ("ontouchstart" in window && window.innerWidth <= 1024);

// ── Weekend check (this school runs Sun–Thu; Fri=5, Sat=6 are off) ───────────
const isWeekend = (date) => {
  const dow = date.getDay();
  return dow === 5 || dow === 6; // Friday or Saturday
};

function AttendanceMonitoring() {
  // "load"       → combined Grade-Section-Subject picker
  // "attendance" → live attendance sheet for chosen class
  const [currentView, setCurrentView] = useState("load");

  const [classGrade, setClassGrade] = useState(null);
  const [classSection, setClassSection] = useState("");
  const [classSubject, setClassSubject] = useState("");

  const [teacherLoads, setTeacherLoads] = useState([]);
  const [students, setStudents] = useState([]);
  const [holidays, setHolidays] = useState([]); // ["YYYY-MM-DD", ...]

  const [attendanceRecords, setAttendanceRecords] = useState({}); // { studentId: { time, status } }
  const [scheduleEnded, setScheduleEnded] = useState(false);
  const [todayBlocked, setTodayBlocked] = useState(null); // null | "weekend" | "holiday:<name>"

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [scanStatus, setScanStatus] = useState(""); // "success" | "error" | "warning"

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const scannedRef = useRef(new Set());
  const autoCloseTimerRef = useRef(null);

  const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"

  // ── 1. Load teacher's schedules + active school-year holidays ────────────────
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
        // Resolve User → teacherId
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

        // Load schedules
        const schedSnap = await getDocs(
          query(col("Schedule"), where("teacherId", "==", teacherDocId)),
        );
        setTeacherLoads(schedSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Load holidays from the active school year
        const sySnap = await getDocs(
          query(col("SchoolYear"), where("isActive", "==", true)),
        );
        if (!sySnap.empty) {
          const sy = sySnap.docs[0].data();
          setHolidays((sy.holidays || []).map((h) => h.date));
        }
      } catch (e) {
        console.error(e);
        setError("Failed to load class assignments.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── 2. Load enrolled students when grade + section is chosen ────────────────
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

  // ── Combined load options (one card per Grade-Section-Subject) ────────────
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

  // Find the schedule entry for the currently active class
  const currentSchedule = teacherLoads.find(
    (l) =>
      l.grade === classGrade &&
      l.section === classSection &&
      l.subject === classSubject,
  );

  // ── Select a class card ──────────────────────────────────────────────────
  const selectLoad = (l) => {
    setClassGrade(l.grade);
    setClassSection(l.section);
    setClassSubject(l.subject);
    scannedRef.current = new Set();
    setAttendanceRecords({});
    setScheduleEnded(false);
    setScanMessage("");
    setScanStatus("");

    // Check if today is a holiday or weekend BEFORE opening attendance
    const now = new Date();
    if (isWeekend(now)) {
      setTodayBlocked("weekend");
    } else if (holidays.includes(today)) {
      setTodayBlocked(`holiday`);
    } else {
      setTodayBlocked(null);
    }

    setCurrentView("attendance");
  };

  // ── Auto-close timer: fires at schedule end time ─────────────────────────
  useEffect(() => {
    if (currentView !== "attendance" || scheduleEnded || !currentSchedule?.end)
      return;

    const [endH, endM] = currentSchedule.end.split(":").map(Number);
    const now = new Date();
    const endMs =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        endH,
        endM,
        0,
      ).getTime() - now.getTime();

    if (endMs <= 0) return; // already past end time

    autoCloseTimerRef.current = setTimeout(() => {
      handleCloseAttendance();
    }, endMs);

    return () => clearTimeout(autoCloseTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, scheduleEnded, currentSchedule]);

  // ── Close attendance & mark absents (skips holidays/weekends) ────────────
  const handleCloseAttendance = useCallback(async () => {
    clearTimeout(autoCloseTimerRef.current);

    // If today is a holiday or weekend, close session without saving absents
    const now = new Date();
    if (isWeekend(now) || holidays.includes(today)) {
      setScheduleEnded(true);
      closeScanner();
      return;
    }

    const absentStudents = students.filter(
      (s) => !scannedRef.current.has(s.lrn),
    );

    // Update local state
    const absentRecords = {};
    absentStudents.forEach((s) => {
      absentRecords[s.id] = { time: "--", status: "Absent" };
    });
    setAttendanceRecords((prev) => ({ ...prev, ...absentRecords }));
    setScheduleEnded(true);
    closeScanner();

    // Persist to Firestore
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
  }, [students, classGrade, classSection, classSubject, today, holidays]);

  // ── QR Scanner ───────────────────────────────────────────────────────────
  const openScanner = useCallback(() => {
    setScanMessage("");
    setScanStatus("");
    setScannerOpen(true);
  }, []);

  useEffect(() => {
    if (!scannerOpen || !videoRef.current) return;
    const reader = new BrowserQRCodeReader();
    readerRef.current = reader;
    reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
      if (result) handleQRResult(result.getText());
    });
    return () => {
      try {
        readerRef.current?.reset();
      } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen]);

  const handleQRResult = useCallback(
    async (lrn) => {
      if (scannedRef.current.has(lrn)) {
        setScanMessage(`Already scanned (LRN ${lrn}). Duplicate ignored.`);
        setScanStatus("warning");
        return;
      }
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
      setAttendanceRecords((prev) => ({
        ...prev,
        [student.id]: { time, status: "Present" },
      }));
      scannedRef.current.add(lrn);
      setScanMessage(
        `✓ ${student.lastName}, ${student.firstName} — Present at ${time}`,
      );
      setScanStatus("success");
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
    [students, classGrade, classSection, classSubject, today],
  );

  const closeScanner = useCallback(() => {
    try {
      readerRef.current?.reset();
    } catch (_) {}
    setScannerOpen(false);
  }, []);

  // ── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="am-wrapper">
        <main className="am-main">
          <div className="am-container">
            <p className="am-loading">Loading your class assignments…</p>
          </div>
        </main>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="am-wrapper">
      <main className="am-main">
        <div className="am-container">
          {/* ── LOAD PICKER ── */}
          {currentView === "load" && (
            <div className="am-view">
              <div className="am-toolbar">
                <h2 className="am-page-title">Attendance Monitoring</h2>
              </div>

              {error && (
                <div className="am-alert am-alert-warning">
                  <i className="fas fa-exclamation-triangle"></i> {error}
                </div>
              )}

              {loadOptions.length === 0 && !loading ? (
                <p className="am-empty">No classes assigned yet.</p>
              ) : (
                <div className="am-grid">
                  {loadOptions.map((l) => (
                    <div
                      key={`${l.grade}|${l.section}|${l.subject}`}
                      className="am-card"
                      onClick={() => selectLoad(l)}
                    >
                      <div className="am-icon-box am-bg-blue">
                        <i className="fas fa-clipboard-check"></i>
                      </div>
                      <h3>
                        Grade {l.grade} – {l.section}
                      </h3>
                      <p className="am-card-subject">{l.subject}</p>
                      {l.start && l.end && (
                        <span className="am-card-time">
                          <i className="fas fa-clock"></i> {l.start} – {l.end}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── ATTENDANCE SHEET ── */}
          {currentView === "attendance" && (
            <div className="am-view">
              <div className="am-toolbar">
                <button
                  className="btn-back"
                  onClick={() => {
                    clearTimeout(autoCloseTimerRef.current);
                    setCurrentView("load");
                  }}
                >
                  <i className="fas fa-arrow-left"></i> Back
                </button>
                <div className="am-title-block">
                  <h3>{classSubject} Attendance</h3>
                  <small>
                    {new Date().toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                    {" | "}Grade {classGrade} – {classSection}
                    {currentSchedule?.start &&
                      currentSchedule?.end &&
                      ` | ${currentSchedule.start} – ${currentSchedule.end}`}
                  </small>
                </div>
                <div className="am-actions">
                  {todayBlocked && (
                    <span className="am-badge am-badge-holiday">
                      <i className="fas fa-calendar-times"></i>{" "}
                      {todayBlocked === "weekend"
                        ? "Weekend — No attendance"
                        : "Holiday — No attendance"}
                    </span>
                  )}
                  {!todayBlocked && !scheduleEnded && (
                    <>
                      {IS_MOBILE ? (
                        <button className="am-btn-scan" onClick={openScanner}>
                          <i className="fas fa-qrcode"></i> Scan QR
                        </button>
                      ) : (
                        <span className="am-badge am-badge-warning">
                          <i className="fas fa-mobile-alt"></i> QR scanning:
                          mobile only
                        </span>
                      )}
                      <button
                        className="am-btn-close-att"
                        onClick={handleCloseAttendance}
                      >
                        <i className="fas fa-lock"></i> Close Attendance
                      </button>
                    </>
                  )}
                  {!todayBlocked && scheduleEnded && (
                    <span className="am-badge am-badge-closed">
                      <i className="fas fa-lock"></i> Attendance Closed
                    </span>
                  )}
                </div>
              </div>

              {/* Today is holiday/weekend — info banner */}
              {todayBlocked && (
                <div className="am-alert am-alert-info">
                  <i className="fas fa-info-circle"></i>{" "}
                  {todayBlocked === "weekend"
                    ? "Today is a weekend. Attendance records will not be saved."
                    : "Today is a declared holiday. Attendance records will not be saved."}
                </div>
              )}

              <div className="am-table-wrap">
                <table className="am-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Student Name</th>
                      <th>Time In</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="am-td-empty">
                          No students enrolled in this section.
                        </td>
                      </tr>
                    ) : (
                      students.map((s, idx) => {
                        const rec = attendanceRecords[s.id];
                        return (
                          <tr key={s.id}>
                            <td className="am-td-num">{idx + 1}</td>
                            <td className="am-td-name">
                              {s.lastName}, {s.firstName}
                              {s.middleName ? ` ${s.middleName}` : ""}
                            </td>
                            <td className="am-td-center">{rec?.time ?? "—"}</td>
                            <td className="am-td-center">
                              {rec ? (
                                <span
                                  className={`am-status-pill ${rec.status === "Present" ? "am-present" : "am-absent"}`}
                                >
                                  {rec.status}
                                </span>
                              ) : (
                                <span className="am-status-pending">
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

              {/* Summary bar */}
              {students.length > 0 && (
                <div className="am-summary">
                  <span className="am-sum-present">
                    <i className="fas fa-check-circle"></i> Present:{" "}
                    {
                      Object.values(attendanceRecords).filter(
                        (r) => r.status === "Present",
                      ).length
                    }
                  </span>
                  <span className="am-sum-absent">
                    <i className="fas fa-times-circle"></i> Absent:{" "}
                    {
                      Object.values(attendanceRecords).filter(
                        (r) => r.status === "Absent",
                      ).length
                    }
                  </span>
                  <span className="am-sum-pending">
                    <i className="fas fa-clock"></i> Pending:{" "}
                    {students.length - Object.keys(attendanceRecords).length}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── QR SCANNER MODAL (mobile only) ── */}
      {scannerOpen && (
        <div className="am-scanner-overlay">
          <div className="am-scanner-box">
            <div className="am-scanner-header">
              <h3>
                <i className="fas fa-qrcode"></i> Scan Student QR
              </h3>
              <button className="am-scanner-close" onClick={closeScanner}>
                &times;
              </button>
            </div>

            <div className="am-viewfinder">
              <video ref={videoRef} className="am-video" />
              <div className="am-crosshair" />
            </div>

            {scanMessage && (
              <div className={`am-scan-msg am-scan-${scanStatus}`}>
                {scanMessage}
              </div>
            )}

            <p className="am-scan-hint">
              Point the camera at the student's QR code
            </p>

            <button className="am-btn-done-scan" onClick={closeScanner}>
              Done Scanning
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AttendanceMonitoring;

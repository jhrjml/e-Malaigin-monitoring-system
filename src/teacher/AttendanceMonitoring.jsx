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
const IS_MOBILE =
  /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  ) ||
  ("ontouchstart" in window && window.innerWidth <= 1024);

// ── Weekend check (Sun–Thu school; Fri=5, Sat=6 are off) ─────────────────────
const isWeekend = (date) => {
  const dow = date.getDay();
  return dow === 5 || dow === 6;
};

// ── Convert "HH:MM" to minutes since midnight ─────────────────────────────────
const toMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// ── Get current time as minutes since midnight ────────────────────────────────
const nowMin = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};

// ── 16:00 (4 PM) scan-lock threshold ─────────────────────────────────────────
const LOCK_AFTER_MIN = 16 * 60; // 4:00 PM — scanning closes

// ── 19:00 (7 PM) daily-reset threshold ───────────────────────────────────────
// After this time the local display is wiped so the roster shows all-Pending,
// ready for the next school day. Firestore records are NOT deleted — this is
// UI-only. The one-shot reset timer fires exactly at 19:00.
const RESET_AFTER_MIN = 19 * 60; // 7:00 PM

function AttendanceMonitoring() {
  const [currentView, setCurrentView] = useState("load");

  const [classGrade, setClassGrade] = useState(null);
  const [classSection, setClassSection] = useState("");
  const [classSubject, setClassSubject] = useState("");

  const [teacherLoads, setTeacherLoads] = useState([]);
  const [students, setStudents] = useState([]);
  const [holidays, setHolidays] = useState([]);

  // attendanceRecords: { studentId: { time, status } }
  // Populated from Firestore when a class is opened, then updated live on scan.
  const [attendanceRecords, setAttendanceRecords] = useState({});

  const [scheduleEnded, setScheduleEnded] = useState(false);
  const [todayBlocked, setTodayBlocked] = useState(null); // null | "weekend" | "holiday"

  // ── time-window state ─────────────────────────────────────────────────────
  // "before"  → before the subject's start time (scanning not yet allowed)
  // "open"    → within start–end window (scanning allowed)
  // "after"   → past end time (scanning locked; records visible read-only)
  const [timeWindow, setTimeWindow] = useState("open");

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [scanStatus, setScanStatus] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [error, setError] = useState("");

  const videoRef = useRef(null);
  const readerRef = useRef(null);
  // scannedRef holds LRNs already recorded THIS session (and pre-loaded from DB)
  const scannedRef = useRef(new Set());
  const autoCloseTimerRef = useRef(null);
  const timeWindowTimerRef = useRef(null);
  // One-shot timer that fires at 19:00 to wipe the local display
  const resetTimerRef = useRef(null);

  const today = new Date().toISOString().split("T")[0];

  // ── 1. Load teacher's schedules + holidays ────────────────────────────────
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
        setTeacherLoads(schedSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

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

  // ── 2. Load enrolled students when grade+section changes ─────────────────
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

  // ── 3. Load today's existing attendance from Firestore ────────────────────
  // Called whenever a class is selected. This is what makes records persist
  // across navigation — we always re-hydrate from the DB when opening a class.
  // If it is already past 19:00 (the daily reset time), we skip loading so
  // the roster shows all-Pending, ready for the next school day.
  const loadTodayAttendance = useCallback(
    async (grade, section, subject) => {
      // Past 7 PM — show clean slate; Firestore records remain untouched
      if (nowMin() >= RESET_AFTER_MIN) {
        setAttendanceRecords({});
        scannedRef.current = new Set();
        return;
      }

      setLoadingRecords(true);
      try {
        const snap = await getDocs(
          query(
            col("Attendance"),
            where("grade", "==", grade),
            where("section", "==", section),
            where("subject", "==", subject),
            where("date", "==", today),
          ),
        );

        const records = {};
        const lrnsAlreadyRecorded = new Set();

        snap.docs.forEach((d) => {
          const data = d.data();
          records[data.studentId] = { time: data.time, status: data.status };
          if (data.lrn) lrnsAlreadyRecorded.add(data.lrn);
        });

        setAttendanceRecords(records);
        // Pre-populate scannedRef so duplicate scans are blocked correctly
        scannedRef.current = lrnsAlreadyRecorded;
      } catch (e) {
        console.error("Failed to load today's attendance:", e);
      } finally {
        setLoadingRecords(false);
      }
    },
    [today],
  );

  // ── 4. Compute and watch the time window for the active schedule ──────────
  // Returns:
  //   "reset"  → ≥ 19:00 — display wiped, ready for next day
  //   "after"  → past schedule end OR ≥ 16:00 — scanning locked, records shown
  //   "before" → before schedule start — scanning not yet open
  //   "open"   → within start–end and before 16:00 — scanning allowed
  const computeTimeWindow = useCallback((schedule) => {
    const now = nowMin();
    if (now >= RESET_AFTER_MIN) return "reset";
    if (!schedule?.start || !schedule?.end) return "open";
    const start = toMin(schedule.start);
    const end = toMin(schedule.end);
    if (now < start) return "before";
    if (now >= end || now >= LOCK_AFTER_MIN) return "after";
    return "open";
  }, []);

  // Re-evaluate every 30 seconds while in attendance view
  useEffect(() => {
    if (currentView !== "attendance") {
      clearInterval(timeWindowTimerRef.current);
      clearTimeout(resetTimerRef.current);
      return;
    }

    const tick = () => {
      const window = computeTimeWindow(currentSchedule);
      setTimeWindow(window);
      // Close scanner if we've moved out of the open window
      if (window !== "open" && scannerOpen) closeScanner();
      // Wipe local display when the reset threshold is crossed
      if (window === "reset") {
        setAttendanceRecords({});
        scannedRef.current = new Set();
        setScheduleEnded(false);
      }
    };

    tick(); // immediate evaluation
    timeWindowTimerRef.current = setInterval(tick, 30_000);

    // ── One-shot reset timer: fires exactly at 19:00 today ──────────────
    const scheduleResetTimer = () => {
      clearTimeout(resetTimerRef.current);
      const now = new Date();
      const resetAt = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        19,
        0,
        0,
        0,
      );
      const msUntilReset = resetAt.getTime() - now.getTime();
      if (msUntilReset > 0) {
        resetTimerRef.current = setTimeout(() => {
          // Wipe local display — Firestore records are untouched
          setAttendanceRecords({});
          scannedRef.current = new Set();
          setScheduleEnded(false);
          setTimeWindow("reset");
          closeScanner();
        }, msUntilReset);
      }
    };
    scheduleResetTimer();

    return () => {
      clearInterval(timeWindowTimerRef.current);
      clearTimeout(resetTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, classGrade, classSection, classSubject, teacherLoads]);

  // ── Combined load options ─────────────────────────────────────────────────
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

  const currentSchedule = teacherLoads.find(
    (l) =>
      l.grade === classGrade &&
      l.section === classSection &&
      l.subject === classSubject,
  );

  // ── Select a class card ───────────────────────────────────────────────────
  const selectLoad = (l) => {
    setClassGrade(l.grade);
    setClassSection(l.section);
    setClassSubject(l.subject);
    setScheduleEnded(false);
    setScanMessage("");
    setScanStatus("");

    // Weekend / holiday check
    const now = new Date();
    if (isWeekend(now)) {
      setTodayBlocked("weekend");
    } else if (holidays.includes(today)) {
      setTodayBlocked("holiday");
    } else {
      setTodayBlocked(null);
    }

    // Evaluate time window immediately using this specific load's schedule
    const fakeSchedule = { start: l.start, end: l.end };
    setTimeWindow(computeTimeWindow(fakeSchedule));

    // Load existing records from Firestore — this restores persisted state
    loadTodayAttendance(l.grade, l.section, l.subject);

    setCurrentView("attendance");
  };

  // ── Auto-close timer at schedule end time ─────────────────────────────────
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

    if (endMs <= 0) return;

    autoCloseTimerRef.current = setTimeout(() => {
      handleCloseAttendance();
    }, endMs);

    return () => clearTimeout(autoCloseTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, scheduleEnded, currentSchedule]);

  // ── Close attendance & mark absents ──────────────────────────────────────
  const handleCloseAttendance = useCallback(async () => {
    clearTimeout(autoCloseTimerRef.current);

    const now = new Date();
    if (isWeekend(now) || holidays.includes(today)) {
      setScheduleEnded(true);
      closeScanner();
      return;
    }

    // Only mark absent students who have NO record yet today for this subject
    const absentStudents = students.filter(
      (s) => !scannedRef.current.has(s.lrn),
    );

    const absentRecords = {};
    absentStudents.forEach((s) => {
      absentRecords[s.id] = { time: "--", status: "Absent" };
    });
    setAttendanceRecords((prev) => ({ ...prev, ...absentRecords }));
    setScheduleEnded(true);
    closeScanner();

    // Persist only students who don't already have a record
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
      // ── Guard: time window must be "open" ───────────────────────────────
      const currentWindow = computeTimeWindow(currentSchedule);
      if (currentWindow === "before") {
        setScanMessage(
          `Scanning not yet allowed. Class starts at ${currentSchedule?.start}.`,
        );
        setScanStatus("error");
        return;
      }
      if (currentWindow === "after") {
        setScanMessage(
          "Scanning is closed. The class period has already ended.",
        );
        setScanStatus("error");
        return;
      }

      // ── Guard: one scan per day ─────────────────────────────────────────
      if (scannedRef.current.has(lrn)) {
        setScanMessage(
          `Already recorded today (LRN ${lrn}). Duplicate ignored.`,
        );
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
    [
      students,
      classGrade,
      classSection,
      classSubject,
      today,
      currentSchedule,
      computeTimeWindow,
    ],
  );

  const closeScanner = useCallback(() => {
    try {
      readerRef.current?.reset();
    } catch (_) {}
    setScannerOpen(false);
  }, []);

  // ── Derived: can scanning happen right now? ───────────────────────────────
  // True only when: not blocked, not ended, time window is exactly "open"
  const canScan = !todayBlocked && !scheduleEnded && timeWindow === "open";

  // ── Loading state ─────────────────────────────────────────────────────────
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
                  className="btn-back-am"
                  onClick={() => {
                    clearTimeout(autoCloseTimerRef.current);
                    clearInterval(timeWindowTimerRef.current);
                    clearTimeout(resetTimerRef.current);
                    closeScanner();
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
                  {/* Holiday / Weekend badge */}
                  {todayBlocked && (
                    <span className="am-badge am-badge-holiday">
                      <i className="fas fa-calendar-times"></i>{" "}
                      {todayBlocked === "weekend"
                        ? "Weekend — No attendance"
                        : "Holiday — No attendance"}
                    </span>
                  )}

                  {/* Time-window badges (only shown when not blocked) */}
                  {!todayBlocked &&
                    !scheduleEnded &&
                    timeWindow === "before" && (
                      <span className="am-badge am-badge-warning">
                        <i className="fas fa-hourglass-start"></i> Class starts
                        at {currentSchedule?.start} — scanning not yet open
                      </span>
                    )}

                  {!todayBlocked &&
                    !scheduleEnded &&
                    timeWindow === "after" && (
                      <span className="am-badge am-badge-closed">
                        <i className="fas fa-lock"></i> Past class time —
                        scanning closed
                      </span>
                    )}

                  {/* 7 PM reset badge — overrides all other non-blocked states */}
                  {!todayBlocked && timeWindow === "reset" && (
                    <span className="am-badge am-badge-reset">
                      <i className="fas fa-moon"></i> Reset at 7 PM — ready for
                      next day
                    </span>
                  )}

                  {/* Scan + Close buttons (only when window is open) */}
                  {canScan && (
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

                  {/* Closed badge */}
                  {!todayBlocked && scheduleEnded && (
                    <span className="am-badge am-badge-closed">
                      <i className="fas fa-lock"></i> Attendance Closed
                    </span>
                  )}
                </div>
              </div>

              {/* Info banners */}
              {todayBlocked && (
                <div className="am-alert am-alert-info">
                  <i className="fas fa-info-circle"></i>{" "}
                  {todayBlocked === "weekend"
                    ? "Today is a weekend. Attendance records will not be saved."
                    : "Today is a declared holiday. Attendance records will not be saved."}
                </div>
              )}

              {!todayBlocked && !scheduleEnded && timeWindow === "before" && (
                <div className="am-alert am-alert-info">
                  <i className="fas fa-info-circle"></i> QR scanning will be
                  enabled when the class period begins at{" "}
                  <strong>{currentSchedule?.start}</strong>. You can view the
                  roster while you wait.
                </div>
              )}

              {!todayBlocked && !scheduleEnded && timeWindow === "after" && (
                <div className="am-alert am-alert-warning">
                  <i className="fas fa-exclamation-triangle"></i> The class
                  period has ended. Scanning is locked. Use{" "}
                  <strong>Close Attendance</strong> to finalise and mark absent
                  students.
                </div>
              )}

              {/* 7 PM daily-reset banner */}
              {!todayBlocked && timeWindow === "reset" && (
                <div className="am-alert am-alert-reset">
                  <i className="fas fa-moon"></i> It's past 7:00 PM. Today's
                  attendance records have been cleared from the display to
                  prepare for the next school day. All records are safely saved
                  in the system.
                </div>
              )}

              {/* Loading records spinner */}
              {loadingRecords ? (
                <div className="am-loading" style={{ padding: "30px" }}>
                  <i className="fas fa-spinner fa-spin"></i> Loading today's
                  attendance records…
                </div>
              ) : (
                <>
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
                                <td className="am-td-center">
                                  {rec?.time ?? "—"}
                                </td>
                                <td className="am-td-center">
                                  {rec ? (
                                    <span
                                      className={`am-status-pill ${
                                        rec.status === "Present"
                                          ? "am-present"
                                          : "am-absent"
                                      }`}
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
                        {students.length -
                          Object.keys(attendanceRecords).length}
                      </span>
                    </div>
                  )}
                </>
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

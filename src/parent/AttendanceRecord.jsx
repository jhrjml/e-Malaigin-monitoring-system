// AttendanceRecord.jsx  (Firebase version)
// Parent lands directly on a calendar + "attendance for this day" view.
// Left side: time / subject / status table for whichever date is selected
// (defaults to today). Right side: a calendar — clicking a date reloads
// the left side with that day's attendance across all subjects.
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

// Schedule documents have NO per-weekday field — ManageClasses.jsx always
// writes days: "Sunday – Thursday" for every schedule entry, meaning every
// subject in a section's schedule runs on every school day. The only thing
// that varies by date is whether it's a school day at all (weekend = off),
// which matches the same Fri/Sat check used in AttendanceMonitoring.jsx.
const isWeekend = (date) => {
  const dow = date.getDay();
  return dow === 5 || dow === 6; // Fri=5, Sat=6
};

// Builds a YYYY-MM-DD string from the LOCAL date parts.
// (Deliberately NOT using d.toISOString() — that converts to UTC first,
// which shifts the date back a day for any timezone ahead of UTC, e.g. PHT.)
const toISO = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function AttendanceRecord() {
  // children / filter
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [childrenLoading, setChildrenLoading] = useState(true);

  // schedule + full attendance history for the selected child
  const [schedule, setSchedule] = useState([]); // [{ subject, start, end, teacherId, days }]
  const [attendanceLogs, setAttendanceLogs] = useState([]); // all logs, any subject/date
  const [loading, setLoading] = useState(false);

  const today = toISO(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // Click-to-pick month/year panel, opened by tapping the header label
  const [pickerOpen, setPickerOpen] = useState(false);
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

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

  // ── load schedule + full attendance history for whichever child is selected ──
  const loadChildData = useCallback(async (child) => {
    if (!child) return;
    setLoading(true);
    try {
      const [scheduleSnap, attendanceSnap] = await Promise.all([
        getDocs(
          query(
            col("Schedule"),
            where("grade", "==", child.enrolledGrade),
            where("section", "==", child.enrolledSection),
          ),
        ),
        getDocs(query(col("Attendance"), where("studentId", "==", child.id))),
      ]);
      setSchedule(scheduleSnap.docs.map((d) => d.data()));
      setAttendanceLogs(attendanceSnap.docs.map((d) => d.data()));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    setSelectedDate(today);
    setCalendarMonth(() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1);
    });
    loadChildData(selectedChild);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChild, loadChildData]);

  const switchChild = (child) => {
    if (child.id === selectedChild?.id) return;
    setSelectedChild(child);
  };

  // ── rows for the currently selected date ──────────────────────────────
  const selectedDateObj = new Date(selectedDate + "T00:00:00");

  // Every Schedule entry runs Sun–Thu (see ManageClasses.jsx), so the only
  // date-dependent question is "is this a school day at all?" — not which
  // specific subjects meet today. Weekend → no classes; otherwise → the
  // full schedule, each subject cross-referenced against that day's log.
  const rows = isWeekend(selectedDateObj)
    ? []
    : schedule
        .map((s) => {
          const log = attendanceLogs.find(
            (l) => l.subject === s.subject && l.date === selectedDate,
          );
          return {
            time: s.start && s.end ? `${s.start} – ${s.end}` : "—",
            sortKey: s.start || "",
            subject: s.subject,
            status: log ? log.status : "No Record",
          };
        })
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // dates that have at least one attendance record, for the calendar dots
  const attendanceDateSet = new Set(attendanceLogs.map((l) => l.date));

  // ── calendar grid for calendarMonth ───────────────────────────────────
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDayIndex; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const goToPrevMonth = () => setCalendarMonth(new Date(year, month - 1, 1));
  const goToNextMonth = () => setCalendarMonth(new Date(year, month + 1, 1));

  const pickMonth = (newMonth) => {
    setCalendarMonth(new Date(year, newMonth, 1));
  };
  const pickYear = (newYear) => {
    setCalendarMonth(new Date(newYear, month, 1));
  };

  const pickDate = (day) => {
    if (!day) return;
    setSelectedDate(toISO(new Date(year, month, day)));
    setPickerOpen(false);
  };

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
          <div className="toolbar-ar">
            <h2 className="section-title-ar">Attendance Record</h2>
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

              <div className="ar-layout">
                {/* LEFT: attendance for the selected date */}
                <div className="ar-left">
                  <div className="today-status-card-ar">
                    <h4>Today's Attendance</h4>
                    <p className="ar-selected-date">{selectedDate}</p>
                  </div>

                  <div className="table-container-ar">
                    <table className="data-table-ar">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Subject</th>
                          <th style={{ textAlign: "center" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan="3" style={{ textAlign: "center" }}>
                              No classes scheduled for this day.
                            </td>
                          </tr>
                        ) : (
                          rows.map((row, i) => (
                            <tr key={i}>
                              <td>{row.time}</td>
                              <td>{row.subject}</td>
                              <td style={{ textAlign: "center" }}>
                                <span
                                  className={`status-${row.status
                                    .toLowerCase()
                                    .replace(/\s+/g, "-")}`}
                                >
                                  {row.status}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* RIGHT: calendar */}
                <div className="ar-right">
                  <div className="ar-calendar-card">
                    <div className="ar-calendar-header">
                      <button className="ar-cal-nav" onClick={goToPrevMonth}>
                        <i className="fas fa-chevron-left"></i>
                      </button>
                      <button
                        type="button"
                        className="ar-cal-month-label"
                        onClick={() => setPickerOpen((o) => !o)}
                      >
                        {calendarMonth.toLocaleDateString("en-US", {
                          month: "long",
                          year: "numeric",
                        })}
                      </button>
                      <button className="ar-cal-nav" onClick={goToNextMonth}>
                        <i className="fas fa-chevron-right"></i>
                      </button>
                    </div>

                    {pickerOpen && (
                      <div className="ar-cal-picker">
                        <div className="ar-cal-picker-year-row">
                          <span className="ar-cal-picker-year">{year}</span>
                          <div className="ar-cal-picker-year-arrows">
                            <button
                              type="button"
                              className="ar-cal-year-arrow"
                              onClick={() => pickYear(year - 1)}
                              aria-label="Previous year"
                            >
                              <i className="fas fa-chevron-up"></i>
                            </button>
                            <button
                              type="button"
                              className="ar-cal-year-arrow"
                              onClick={() => pickYear(year + 1)}
                              aria-label="Next year"
                            >
                              <i className="fas fa-chevron-down"></i>
                            </button>
                          </div>
                        </div>

                        <div className="ar-cal-picker-month-grid">
                          {MONTH_NAMES.map((name, i) => (
                            <button
                              type="button"
                              key={name}
                              className={`ar-cal-picker-month ${i === month ? "selected" : ""}`}
                              onClick={() => {
                                pickMonth(i);
                                setPickerOpen(false);
                              }}
                            >
                              {name.slice(0, 3)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="ar-calendar-weekdays">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((w) => (
                        <span key={w}>{w}</span>
                      ))}
                    </div>

                    <div className="ar-calendar-grid">
                      {cells.map((day, i) => {
                        if (!day)
                          return <div key={i} className="ar-cal-cell empty" />;
                        const iso = toISO(new Date(year, month, day));
                        const isSelected = iso === selectedDate;
                        const isToday = iso === today;
                        const hasRecord = attendanceDateSet.has(iso);
                        return (
                          <div
                            key={i}
                            className={`ar-cal-cell ${isSelected ? "selected" : ""} ${
                              isToday ? "today" : ""
                            }`}
                            onClick={() => pickDate(day)}
                          >
                            {day}
                            {hasRecord && <span className="ar-cal-dot" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default AttendanceRecord;

// AttendanceRecord.jsx (Firebase version)
import { useState, useEffect, useCallback, useMemo } from "react";
import { db } from "../api/firebase";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./AttendanceRecord.css";

const col = (name) => collection(db, name);

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// Helper: Formats 24h standard strings (e.g., "13:45") to clean 12h formats ("1:45 PM") — Matched with Admin Portal
const formatTimeLabel = (timeStr) => {
  if (!timeStr) return "—";
  const [hrs, mins] = timeStr.split(":");
  let h = parseInt(hrs, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mins} ${ampm}`;
};

function AttendanceRecord() {
  // Children state management
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [childrenLoading, setChildrenLoading] = useState(true);
  const [childSchedules, setChildSchedules] = useState([]); 

  // Selected date tracks 'YYYY-MM-DD'
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  // Calendar view month tracking
  const todayObj = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(todayObj.getFullYear());
  const [viewMonth, setViewMonth] = useState(todayObj.getMonth());

  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const pad = (n) => String(n).padStart(2, "0");

  // 1. Load children linked to this parent account
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
        console.error("Failed to load children logs:", e);
      } finally {
        setChildrenLoading(false);
      }
    };
    load();
  }, []);

  // 2. Load schedules and filter locally to handle dynamic cross-collection data types
  const loadSubjectsAndSchedules = useCallback(async (child) => {
    if (!child) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "Schedule"));
      const allScheds = snap.docs.map((d) => d.data());
      
      // Loosely filter schedule slots to catch mixed casing or string/number structures
      const matchedScheds = allScheds.filter((s) => {
        const sGrade = String(s.grade || "").trim();
        const cGrade = String(child.enrolledGrade || "").trim();
        const sSection = String(s.section || "").trim().toLowerCase();
        const cSection = String(child.enrolledSection || "").trim().toLowerCase();
        
        return sGrade === cGrade && sSection === cSection;
      });
      
      setChildSchedules(matchedScheds); 
    } catch (e) {
      console.error("Schedule matching error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedChild) return;
    setAttendanceLogs([]);
    loadSubjectsAndSchedules(selectedChild);
  }, [selectedChild, loadSubjectsAndSchedules]);

  // 3. Query attendance status entries for the chosen date
  const loadDayAttendance = useCallback(async (childId, dateStr) => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, "Attendance"),
          where("studentId", "==", childId),
          where("date", "==", dateStr)
        )
      );
      
      setAttendanceLogs(snap.docs.map((d) => d.data()));
    } catch (e) {
      console.error("Failed to fetch day records:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedChild && selectedDate) {
      loadDayAttendance(selectedChild.id, selectedDate);
    }
  }, [selectedChild, selectedDate, loadDayAttendance]);

  // Calendar Grid Builder Operations
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const firstWeekday = firstOfMonth.getDay(); 
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells = useMemo(() => {
    const tempCells = [];
    for (let i = 0; i < firstWeekday; i++) tempCells.push(null);
    for (let d = 1; d <= daysInMonth; d++) tempCells.push(d);
    return tempCells;
  }, [firstWeekday, daysInMonth]);

  const handleDayClick = (day) => {
    if (!day) return;
    const targetDate = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
    setSelectedDate(targetDate);
  };

  const goPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const isSelectedCell = (d) => {
    if (!d) return false;
    const currentCellStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
    return selectedDate === currentCellStr;
  };

  const switchChild = (child) => {
    if (child.id === selectedChild?.id) return;
    setSelectedChild(child);
  };

  const getDayLabelHeader = useMemo(() => {
    const todayFormatted = `${todayObj.getFullYear()}-${pad(todayObj.getMonth() + 1)}-${pad(todayObj.getDate())}`;
    return selectedDate === todayFormatted ? "Today's Attendance" : "Attendance Record";
  }, [selectedDate, todayObj]);

  // Sort child class schedules sequentially from morning to afternoon
  const sortedSchedules = useMemo(() => {
    return [...childSchedules].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  }, [childSchedules]);

  if (childrenLoading) {
    return (
      <div className="ar-wrapper">
        <p className="ar-loading-text"><i className="fas fa-spinner fa-spin"></i> Loading attendance setup...</p>
      </div>
    );
  }

  return (
    <div className="ar-wrapper">
      <div className="toolbar-ar">
        <h2 className="section-title-ar">Attendance Record</h2>
      </div>

      {children.length === 0 ? (
        <p className="ar-empty-text">No children linked to this account.</p>
      ) : (
        <>
          {/* Child Filter Buttons Tab */}
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

          {/* Core Split Screen Dashboard Layout */}
          <div className="ar-dashboard-grid-matrix">
            
            {/* LEFT BLOCK: Daily Schedules + Status Overlay */}
            <div className="ar-left-logs-column">
              <div className="ar-today-status-card-deck">
                <h4>{getDayLabelHeader}</h4>
                <span className="ar-date-pill-badge">{selectedDate}</span>
              </div>

              {loading ? (
                <div className="ar-table-loading-notice"><i className="fas fa-spinner fa-spin"></i> Fetching records...</div>
              ) : (
                <div className="ar-table-container-wrap">
                  <table className="ar-custom-data-table">
                    <thead>
                      <tr>
                        <th style={{ width: "220px", textAlign: "left" }}>Time</th>
                        <th style={{ textAlign: "center" }}>Subject</th>
                        <th style={{ width: "120px", textAlign: "center" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSchedules.length > 0 ? (
                        sortedSchedules.map((sched, i) => {
                          // Match logged attendance statuses by subject string keys
                          const matchLog = attendanceLogs.find(
                            (log) => String(log.subject || "").trim().toLowerCase() === String(sched.subject || "").trim().toLowerCase()
                          );
                          const statusText = matchLog ? matchLog.status : "Pending";

                          return (
                            <tr key={i}>
                              <td className="ar-font-monospace" style={{ textAlign: "left" }}>
                                {/* Formatted dynamically using premium 12h labels to match Admin ManageClasses */}
                                {formatTimeLabel(sched.start)} – {formatTimeLabel(sched.end)}
                              </td>
                              <td style={{ textAlign: "center", fontWeight: "600", color: "#111" }}>
                                {sched.subject}
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <span className={`ar-status-pill-badge ar-badge-${statusText.toLowerCase()}`}>
                                  {statusText}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan="3" className="ar-table-empty-fallback-row">
                            No class schedule configured for this section.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* RIGHT BLOCK: Interactive Navigation Calendar Card */}
            <div className="ar-right-calendar-column">
              <div className="ar-mini-calendar-card">
                <div className="ar-mini-calendar-nav">
                  <button onClick={goPrevMonth} aria-label="Previous month">
                    <i className="fas fa-chevron-left"></i>
                  </button>
                  <span className="ar-mini-calendar-month-label">
                    {MONTH_NAMES[viewMonth]} {viewYear}
                  </span>
                  <button onClick={goNextMonth} aria-label="Next month">
                    <i className="fas fa-chevron-right"></i>
                  </button>
                </div>

                <div className="ar-mini-calendar-weekdays">
                  {WEEKDAY_LABELS.map((w) => (
                    <span key={w}>{w}</span>
                  ))}
                </div>

                <div className="ar-mini-calendar-grid">
                  {cells.map((d, i) => {
                    if (d === null) {
                      return (
                        <span
                          key={`blank-${i}`}
                          className="ar-mini-calendar-cell ar-mini-calendar-cell--empty"
                        />
                      );
                    }
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`ar-mini-calendar-cell ${isSelectedCell(d) ? "ar-mini-calendar-cell--selected" : ""}`}
                        onClick={() => handleDayClick(d)}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  );
}

export default AttendanceRecord;
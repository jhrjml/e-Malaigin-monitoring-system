// ChildProfile.jsx (Firebase version)
import "../Layout.css";
import React, { useState, useEffect } from "react";
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
import "./ChildProfile.css";

const col = (name) => collection(db, name);

// Resolve the adviser of a grade+section from the Teacher collection
async function getSectionAdvisor(grade, section) {
  if (!section) return null;
  try {
    const snap = await getDocs(
      query(col("Teacher"), where("archived", "!=", true)),
    );
    const teachers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const sectionNorm = section.trim().toLowerCase();
    const candidates = [
      `grade ${grade} - ${section}`,
      `grade ${grade}-${section}`,
      `${grade} - ${section}`,
      `${grade}-${section}`,
      section,
    ].map((s) => s.trim().toLowerCase());

    let match = teachers.find((t) =>
      candidates.includes((t.advisory || "").trim().toLowerCase()),
    );

    if (!match) {
      match = teachers.find((t) =>
        (t.advisory || "").trim().toLowerCase().includes(sectionNorm),
      );
    }

    if (!match) return null;
    return `${match.lname}, ${match.fname}${match.mname ? " " + match.mname : ""}`;
  } catch (e) {
    console.error("Failed to load section adviser:", e);
    return null;
  }
}

const ChildProfile = () => {
  const [children, setChildren] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);

  const [advisorName, setAdvisorName] = useState("");
  const [advisorLoading, setAdvisorLoading] = useState(false);

  // Timeline States
  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSortConfig, setScheduleSortConfig] = useState({
    key: "time",
    direction: "asc",
  });

  // 1. Fetch Assigned Children
  useEffect(() => {
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

        const userData = userSnap.data();
        const studentIds = userData.studentIds || [];

        if (studentIds.length === 0) {
          setLoading(false);
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
              const enrollment = enrollSnap.docs[0]?.data() || {};

              return {
                ...s,
                enrolledGrade: enrollment.grade || s.grade || "—",
                enrolledSection: enrollment.section || "—",
              };
            }),
        );

        setChildren(enriched);
        setSelected(enriched[0] || null);
      } catch (e) {
        console.error("Failed to load child profile:", e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // 2. Resolve Adviser & Class Schedule whenever selected child changes
  useEffect(() => {
    if (!selected) {
      setAdvisorName("");
      setSchedule([]);
      return;
    }

    let active = true;

    // Fetch Adviser
    setAdvisorLoading(true);
    getSectionAdvisor(selected.enrolledGrade, selected.enrolledSection).then(
      (name) => {
        if (active) {
          setAdvisorName(name || "");
          setAdvisorLoading(false);
        }
      },
    );

    // Fetch Academic Timeline Schedule
    const fetchSchedule = async () => {
      setScheduleLoading(true);
      try {
        const q = query(
          col("Schedule"),
          where("section", "==", selected.enrolledSection),
        );
        const snap = await getDocs(q);

        const rawSchedData = snap.docs
          .map((d) => d.data())
          .filter((d) => String(d.grade) === String(selected.enrolledGrade));

        const enrichedSchedule = await Promise.all(
          rawSchedData.map(async (s) => {
            let teacherName = "TBA";
            if (s.teacherId) {
              try {
                const tSnap = await getDoc(doc(db, "Teacher", s.teacherId));
                if (tSnap.exists()) {
                  const t = tSnap.data();
                  teacherName = `${t.lname}, ${t.fname}`;
                }
              } catch (err) {}
            }
            return { ...s, teacherName };
          }),
        );

        if (active) setSchedule(enrichedSchedule);
      } catch (err) {
        console.error("Failed to load class schedule:", err);
      } finally {
        if (active) setScheduleLoading(false);
      }
    };

    fetchSchedule();

    return () => {
      active = false;
    };
  }, [selected]);

  const formatDob = (dob) => {
    if (!dob) return "—";
    try {
      return new Date(dob).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dob;
    }
  };

  const formatTimeSlot = (item) => {
    if (item.timeSlot) return item.timeSlot;
    if (item.start && item.end) return `${item.start} - ${item.end}`;
    return "Time TBA";
  };

  // Table Sorting logic
  const handleScheduleSort = (key) => {
    let direction = "asc";
    if (
      scheduleSortConfig.key === key &&
      scheduleSortConfig.direction === "asc"
    ) {
      direction = "desc";
    }
    setScheduleSortConfig({ key, direction });
  };

  const sortedSchedule = [...schedule].sort((a, b) => {
    const dir = scheduleSortConfig.direction === "asc" ? 1 : -1;
    if (scheduleSortConfig.key === "time") {
      const timeA = formatTimeSlot(a) || "";
      const timeB = formatTimeSlot(b) || "";
      return timeA.localeCompare(timeB) * dir;
    }
    if (scheduleSortConfig.key === "subject") {
      const subA = (a.subject || "").toLowerCase();
      const subB = (b.subject || "").toLowerCase();
      return subA.localeCompare(subB) * dir;
    }
    return 0;
  });

  if (loading) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <div className="cp-loading-status">
              <i
                className="fas fa-spinner fa-spin"
                style={{ marginRight: "8px" }}
              ></i>{" "}
              Loading child profile...
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <div className="toolbar-cp">
              <h2 className="section-title-cp">My Child</h2>
            </div>
            <div className="cp-empty-status">
              <i
                className="fas fa-user-slash"
                style={{
                  fontSize: "2rem",
                  color: "#dde1e7",
                  marginBottom: "12px",
                  display: "block",
                }}
              ></i>
              No children linked to this account. Please contact the
              administrator.
            </div>
          </div>
        </main>
      </div>
    );
  }

  const fullName = selected
    ? `${selected.lastName}, ${selected.firstName}${selected.middleName ? " " + selected.middleName : ""}`
    : "";

  return (
    <div className="app-container">
      <main className="main-content">
        <div className="page-container">
          <div className="toolbar-cp">
            <h2 className="section-title-cp">My Child Profile</h2>
          </div>

          {/* ── CHILD FILTER BAR ── */}
          {children.length > 1 && (
            <div className="cp-filter-group">
              {children.map((c) => (
                <button
                  key={c.id}
                  className={`cp-filter-btn ${selected?.id === c.id ? "active" : ""}`}
                  onClick={() => setSelected(c)}
                >
                  <i className="fas fa-user-graduate"></i>
                  {c.firstName} {c.lastName}
                </button>
              ))}
            </div>
          )}

          {selected && (
            <>
              {/* ── COMPACT INFORMATION CARD ── */}
              <div className="cp-view-container">
                <div className="cp-profile-header">
                  <div className="cp-avatar">
                    <i className="fas fa-user-graduate"></i>
                  </div>

                  <div className="cp-profile-titles">
                    <h2 className="cp-student-name">{fullName}</h2>
                    <div className="cp-pill-group">
                      <span className="cp-grade-pill">
                        <i className="fas fa-award"></i> Grade{" "}
                        {selected.enrolledGrade} — Section{" "}
                        {selected.enrolledSection}
                      </span>
                      <span className="cp-adviser-pill">
                        <i className="fas fa-chalkboard-teacher"></i>{" "}
                        {advisorLoading
                          ? "Loading adviser…"
                          : `Adviser: ${advisorName || "—"}`}
                      </span>
                    </div>
                  </div>
                </div>

                <hr className="cp-divider" />

                <div className="cp-grid">
                  <div className="cp-field-group">
                    <label className="cp-field-label">First name</label>
                    <div className="cp-view-box">
                      {selected.firstName || "—"}
                    </div>
                  </div>
                  <div className="cp-field-group">
                    <label className="cp-field-label">Middle name</label>
                    <div className="cp-view-box">
                      {selected.middleName || "—"}
                    </div>
                  </div>
                  <div className="cp-field-group">
                    <label className="cp-field-label">Last name</label>
                    <div className="cp-view-box">
                      {selected.lastName || "—"}
                    </div>
                  </div>

                  <div className="cp-field-group">
                    <label className="cp-field-label">
                      Learner Reference No.
                    </label>
                    <div className="cp-view-box cp-lrn-box">
                      {selected.lrn || "—"}
                    </div>
                  </div>
                  <div className="cp-field-group">
                    <label className="cp-field-label">Date of birth</label>
                    <div className="cp-view-box">
                      {formatDob(selected.dob) || "—"}
                    </div>
                  </div>
                  <div className="cp-field-group">
                    <label className="cp-field-label">Age</label>
                    <div className="cp-view-box">
                      {selected.age ? `${selected.age} years old` : "—"}
                    </div>
                  </div>

                  <div className="cp-field-group">
                    <label className="cp-field-label">Gender</label>
                    <div className="cp-view-box">{selected.gender || "—"}</div>
                  </div>
                  <div className="cp-field-group">
                    <label className="cp-field-label">Contact number</label>
                    <div className="cp-view-box">{selected.contact || "—"}</div>
                  </div>
                  <div className="cp-field-group">
                    <label className="cp-field-label">Parent / Guardian</label>
                    <div className="cp-view-box">
                      {selected.guardian ||
                        selected.guardianName ||
                        selected.parentName ||
                        "—"}
                    </div>
                  </div>

                  <div className="cp-field-group cp-grid-span-3">
                    <label className="cp-field-label">Complete address</label>
                    <div className="cp-view-box">{selected.address || "—"}</div>
                  </div>
                </div>
              </div>

              {/* ── ACADEMIC CLASS TABLE SCHEDULE ── */}
              <div className="cp-timeline-container">
                <h3 className="cp-section-subtitle">
                  <i className="fas fa-calendar-alt"></i> School Year Timeline
                </h3>

                {scheduleLoading ? (
                  <div
                    className="cp-loading-status"
                    style={{ padding: "15px" }}
                  >
                    <i className="fas fa-spinner fa-spin"></i> Retrieving class
                    schedule...
                  </div>
                ) : schedule.length === 0 ? (
                  <div className="cp-empty-status" style={{ padding: "20px" }}>
                    No class schedule has been recorded for this section yet.
                  </div>
                ) : (
                  <div className="cp-table-container">
                    <table className="cp-table">
                      <thead>
                        <tr>
                          <th
                            className="sortable-table-header"
                            onClick={() => handleScheduleSort("time")}
                          >
                            Time
                            <i
                              className={`fas ${scheduleSortConfig.key === "time" ? (scheduleSortConfig.direction === "asc" ? "fa-sort-up cp-header-sorted" : "fa-sort-down cp-header-sorted") : "fa-sort cp-header-unsorted"}`}
                            ></i>
                          </th>
                          <th
                            className="sortable-table-header"
                            onClick={() => handleScheduleSort("subject")}
                          >
                            Subject Name
                            <i
                              className={`fas ${scheduleSortConfig.key === "subject" ? (scheduleSortConfig.direction === "asc" ? "fa-sort-up cp-header-sorted" : "fa-sort-down cp-header-sorted") : "fa-sort cp-header-unsorted"}`}
                            ></i>
                          </th>
                          <th>Teacher Name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSchedule.map((item, index) => (
                          <tr key={index}>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <i
                                className="far fa-clock"
                                style={{
                                  color: "var(--cp-accent)",
                                  marginRight: "6px",
                                }}
                              ></i>
                              {formatTimeSlot(item)}
                            </td>
                            <td style={{ fontWeight: 700, color: "#1a1a2e" }}>
                              {item.subject}
                            </td>
                            <td>
                              <div className="cp-teacher-cell">
                                <i className="fas fa-chalkboard-teacher"></i>{" "}
                                {item.teacherName}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default ChildProfile;

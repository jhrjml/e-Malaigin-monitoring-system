import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../api/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import Repository from "./Repository";
import Classes from "./Classes";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./TeacherDashboard.css";
import "../Layout.css";
import ProfileModal from "../common/ProfileModal";
import AttendanceMonitoring from "./AttendanceMonitoring";
import ClassworkReminding from "./ClassworkReminding";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const titleMap = {
  dashboard: "Overview",
  repository: "Attendance Repository",
  classes: "My Classes",
  attendance: "Attendance Monitoring",
  reminding: "Classwork Reminder",
};

// ── Shared helper — every grade+section+subject this teacher is scheduled
// for, deduped (mirrors the same dedup ClassworkReminding.jsx's loadOptions
// already does, since Classwork docs don't carry a teacherId of their own —
// the only place that link exists is the Schedule collection). ──────────────
async function getTeacherCombos(teacherId) {
  const schedSnap = await getDocs(
    query(collection(db, "Schedule"), where("teacherId", "==", teacherId)),
  );
  const map = new Map(); // "grade|||section|||subject" -> { grade, section, subject }
  schedSnap.docs.forEach((d) => {
    const data = d.data();
    const key = `${data.grade}|||${data.section}|||${data.subject}`;
    if (!map.has(key))
      map.set(key, {
        grade: data.grade,
        section: data.section,
        subject: data.subject,
      });
  });
  return [...map.values()];
}

function TeacherHomepage() {
  const navigateTo = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosed, setSidebarClosed] = useState(false);
  const [currentDate, setCurrentDate] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  // ── Persist activePage across refresh ──────────────────────────────────
  const [activePage, setActivePage] = useState(
    () => localStorage.getItem("teacherPage") || "dashboard",
  );
  const [pageTitle, setPageTitle] = useState(
    () => titleMap[localStorage.getItem("teacherPage")] || "Overview",
  );

  // ── Resolve this teacher's Teacher-collection id (for queries below) ────
  const [teacherId, setTeacherId] = useState(null);

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    getDoc(doc(db, "User", userId))
      .then((snap) => {
        if (snap.exists()) setTeacherId(snap.data().teacherId || null);
      })
      .catch((e) => console.error("Failed to resolve teacherId:", e));
  }, []);

  // ── Clicked-reminder context, handed to ClassworkReminding so it can
  // jump straight to that item's grading/detail view ──────────────────────
  const [focusClasswork, setFocusClasswork] = useState(null);

  // ── Read teacher name from localStorage ────────────────────────────────
  const rawFullName = localStorage.getItem("fullName") || "";
  const teacherFirstName = (() => {
    if (!rawFullName) return "Teacher";
    const afterComma = rawFullName.includes(",")
      ? rawFullName.split(",")[1].trim()
      : rawFullName.trim();
    return afterComma.split(" ")[0] || "Teacher";
  })();

  const toggleSidebar = () => {
    if (window.innerWidth > 768) {
      setSidebarClosed(!sidebarClosed);
    } else {
      setSidebarOpen(!sidebarOpen);
    }
  };

  const navigate = (target) => {
    setActivePage(target);
    setPageTitle(titleMap[target] || "Teacher Portal");
    localStorage.setItem("teacherPage", target);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const openReminder = (cw) => {
    setFocusClasswork(cw);
    navigate("reminding");
  };

  const handleLogout = () => {
    localStorage.clear();
    setLogoutOpen(false);
    navigateTo("/");
  };

  useEffect(() => {
    const options = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    setCurrentDate(new Date().toLocaleDateString("en-US", options));

    const handleResize = () => {
      if (window.innerWidth > 768) {
        setSidebarOpen(false);
        setSidebarClosed(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target))
        setProfileMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="app-container">
      {/* SIDEBAR */}
      <aside
        className={`sidebar ${sidebarOpen ? "open" : ""} ${sidebarClosed ? "closed" : ""}`}
      >
        <div className="brand-logo">
          <img src="/logo.jpg" alt="School Logo" className="brand-logo-img" />
          <div className="brand-text">
            <span className="brand-title">e-Malaigin</span>
            <small className="brand-subtitle">TEACHER PORTAL</small>
          </div>
        </div>

        <ul className="menu">
          <li
            className={activePage === "dashboard" ? "active" : ""}
            onClick={() => navigate("dashboard")}
          >
            <i className="fas fa-home"></i>
            <span>Home</span>
          </li>
          <li
            className={activePage === "repository" ? "active" : ""}
            onClick={() => navigate("repository")}
          >
            <i className="fas fa-history"></i>
            <span>Attendance Repository</span>
          </li>
          <li
            className={activePage === "classes" ? "active" : ""}
            onClick={() => navigate("classes")}
          >
            <i className="fas fa-chalkboard"></i>
            <span>My Classes</span>
          </li>
          <li
            className={activePage === "attendance" ? "active" : ""}
            onClick={() => navigate("attendance")}
          >
            <i className="fas fa-user-check"></i>
            <span>Attendance Monitoring</span>
          </li>
          <li
            className={activePage === "reminding" ? "active" : ""}
            onClick={() => navigate("reminding")}
          >
            <i className="fas fa-bell"></i>
            <span>Classwork Reminder</span>
          </li>
        </ul>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        <header>
          <div className="header-left">
            <button id="menu-toggle" onClick={toggleSidebar}>
              <i className="fas fa-bars"></i>
            </button>
            <div className="header-title">{pageTitle}</div>
          </div>

          <div className="header-right">
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                className="profile-avatar-btn"
                onClick={() => setProfileMenuOpen((v) => !v)}
              >
                <i className="fas fa-user-circle fa-2x"></i>
                <span className="profile-avatar-name">{teacherFirstName}</span>
                <i className="fas fa-chevron-down profile-avatar-caret"></i>
              </button>

              {profileMenuOpen && (
                <div className="profile-dropdown">
                  <button
                    className="profile-dropdown-item"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setProfileOpen(true);
                    }}
                  >
                    <i className="fas fa-user-cog"></i> Account Details
                  </button>
                  <div className="profile-dropdown-divider" />
                  <button
                    className="profile-dropdown-item profile-dropdown-item--danger"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setLogoutOpen(true);
                    }}
                  >
                    <i className="fas fa-sign-out-alt"></i> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="page-container">
          {/* DASHBOARD */}
          {activePage === "dashboard" && (
            <>
              <div className="welcome-banner">
                <div>
                  <h1>Hello, Teacher {teacherFirstName}!</h1>
                  <p>Ready to manage your classes today?</p>
                </div>
                <div className="date-badge-t">
                  <i className="far fa-calendar-alt"></i>
                  <span>{currentDate}</span>
                </div>
              </div>

              <div className="th-overview-grid">
                <ReminderPanel
                  teacherId={teacherId}
                  onOpenReminder={openReminder}
                />

                <div className="th-charts-col">
                  <AttendanceChart teacherId={teacherId} />
                  <ClassworkChart teacherId={teacherId} />
                </div>
              </div>
            </>
          )}

          {activePage === "repository" && <Repository />}
          {activePage === "classes" && <Classes />}
          {activePage === "attendance" && <AttendanceMonitoring />}
          {activePage === "reminding" && (
            <ClassworkReminding
              focusClasswork={focusClasswork}
              onFocusConsumed={() => setFocusClasswork(null)}
            />
          )}
        </div>
      </main>

      {/* LOGOUT MODAL */}
      {logoutOpen && (
        <div className="modal-overlay-teacher">
          <div className="modal-teacher logout-modal">
            <div className="modal-header">
              <h3>Confirm Logout</h3>
            </div>
            <p>Are you sure you want to logout?</p>
            <div className="modal-buttons">
              <button
                className="btn-cancel"
                onClick={() => setLogoutOpen(false)}
              >
                Cancel
              </button>
              <button className="btn-confirm" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// REMINDER PANEL — classwork/announcements this teacher has posted, pulled
// per grade+section+subject combo (Classwork docs have no teacherId of
// their own — see getTeacherCombos above).
//
// Visibility rules:
//   - isAnnouncement === true → hidden once its date has passed.
//   - everything else          → hidden once every currently-enrolled
//     student in that grade+section has been marked Submitted/Missing.
// ════════════════════════════════════════════════════════════════════════════

function ReminderPanel({ teacherId, onOpenReminder }) {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teacherId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const combos = await getTeacherCombos(teacherId);

        // 1. Pull Classwork for every combo this teacher teaches.
        const classworkLists = await Promise.all(
          combos.map((c) =>
            getDocs(
              query(
                collection(db, "Classwork"),
                where("grade", "==", c.grade),
                where("section", "==", c.section),
                where("subject", "==", c.subject),
              ),
            ).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          ),
        );
        const items = classworkLists.flat();

        // 2. Enrolled-student counts per grade+section (subject-agnostic),
        // used to tell whether a non-announcement item is fully marked.
        const gsMap = new Map(); // "grade|||section" -> { grade, section }
        combos.forEach((c) => {
          const key = `${c.grade}|||${c.section}`;
          if (!gsMap.has(key))
            gsMap.set(key, { grade: c.grade, section: c.section });
        });

        const enrolledCounts = {};
        await Promise.all(
          [...gsMap.entries()].map(async ([key, { grade, section }]) => {
            const enrollSnap = await getDocs(
              query(
                collection(db, "Enrolled"),
                where("grade", "==", grade),
                where("section", "==", section),
                where("status", "==", "Enrolled"),
              ),
            );
            enrolledCounts[key] = enrollSnap.size;
          }),
        );

        const today = new Date().toISOString().split("T")[0];

        const visible = items.filter((it) => {
          if (it.isAnnouncement) {
            return !it.date || it.date >= today;
          }

          const key = `${it.grade}|||${it.section}`;
          const enrolledCount = enrolledCounts[key] || 0;
          if (enrolledCount === 0) return true;

          const statusMap = it.studentStatus || {};
          const markedCount = Object.values(statusMap).filter(
            (s) => s === "Submitted" || s === "Missing",
          ).length;

          return markedCount < enrolledCount;
        });

        visible.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

        if (!cancelled) setReminders(visible);
      } catch (e) {
        console.error("Failed to load reminders:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  const formatDueDate = (dateStr) => {
    if (!dateStr) return "No due date";
    try {
      return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="th-panel th-reminder-panel">
      <div className="th-panel-header">
        <h3>Reminder</h3>
      </div>

      <div className="th-reminder-list">
        {loading ? (
          <p className="th-panel-status">Loading…</p>
        ) : reminders.length === 0 ? (
          <p className="th-panel-status">No active reminders.</p>
        ) : (
          reminders.map((cw) => (
            <div
              key={cw.id}
              className="th-reminder-card"
              onClick={() => onOpenReminder(cw)}
            >
              <div
                className={`th-reminder-icon ${cw.isAnnouncement ? "th-reminder-icon--announcement" : ""}`}
              >
                <i
                  className={`fas ${cw.isAnnouncement ? "fa-bullhorn" : "fa-tasks"}`}
                ></i>
              </div>
              <div className="th-reminder-body">
                <h4>
                  Grade {cw.grade} - {cw.section} - {cw.subject}
                </h4>
                <span
                  className={`th-reminder-type-pill ${cw.isAnnouncement ? "th-reminder-type-pill--announcement" : ""}`}
                >
                  {cw.title || "Reminder"}
                </span>
                {cw.desc && <p className="th-reminder-desc">{cw.desc}</p>}
                <p className="th-reminder-due">
                  <i className="far fa-calendar-alt"></i> Due{" "}
                  {formatDueDate(cw.date)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ATTENDANCE CHART — Grouped bar chart showing Present vs. Absent
// per class+subject combination this teacher handles.
// ════════════════════════════════════════════════════════════════════════════

function AttendanceChart({ teacherId }) {
  const [loading, setLoading] = useState(true);
  const [perClass, setPerClass] = useState([]);

  useEffect(() => {
    if (!teacherId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const combos = await getTeacherCombos(teacherId);

        const gsMap = new Map();
        const subjectsByGS = {};
        combos.forEach((c) => {
          const key = `${c.grade}|||${c.section}`;
          if (!gsMap.has(key))
            gsMap.set(key, { grade: c.grade, section: c.section });
          if (!subjectsByGS[key]) subjectsByGS[key] = new Set();
          subjectsByGS[key].add(c.subject);
        });

        const studentsByGS = {};
        await Promise.all(
          [...gsMap.entries()].map(async ([key, { grade, section }]) => {
            const enrollSnap = await getDocs(
              query(
                collection(db, "Enrolled"),
                where("grade", "==", grade),
                where("section", "==", section),
                where("status", "==", "Enrolled"),
              ),
            );
            studentsByGS[key] = enrollSnap.docs.map((d) => d.data().studentId);
          }),
        );

        const results = [];

        for (const key of Object.keys(studentsByGS)) {
          const studentIds = studentsByGS[key];
          const subjects = [...(subjectsByGS[key] || [])];
          if (!studentIds.length || !subjects.length) continue;

          const [grade, section] = key.split("|||");

          for (const subject of subjects) {
            let present = 0;
            let absent = 0;

            for (let i = 0; i < studentIds.length; i += 30) {
              const batch = studentIds.slice(i, i + 30);
              const attSnap = await getDocs(
                query(
                  collection(db, "Attendance"),
                  where("studentId", "in", batch),
                  where("subject", "==", subject),
                ),
              );
              attSnap.docs.forEach((d) => {
                const status = (d.data().status || "").toLowerCase();
                if (status === "present") present++;
                else if (status === "absent") absent++;
              });
            }

            if (present + absent > 0) {
              results.push({
                label: `Gr.${grade} ${section} - ${subject}`,
                present,
                absent,
              });
            }
          }
        }

        if (!cancelled) setPerClass(results);
      } catch (e) {
        console.error("Failed to load attendance stats:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  const chartData = {
    labels: perClass.map((c) => c.label),
    datasets: [
      {
        label: "Present",
        data: perClass.map((c) => c.present),
        backgroundColor: "#1D9E75",
        borderRadius: 4,
        barPercentage: 0.65,
        categoryPercentage: 0.8,
      },
      {
        label: "Absent",
        data: perClass.map((c) => c.absent),
        backgroundColor: "#E24B4A",
        borderRadius: 4,
        barPercentage: 0.65,
        categoryPercentage: 0.8,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const ds = ctx.chart.data.datasets;
            const i = ctx.dataIndex;
            const tot = ds[0].data[i] + ds[1].data[i];
            const pct = tot === 0 ? 0 : Math.round((ctx.raw / tot) * 100);
            return ` ${ctx.dataset.label}: ${ctx.raw} (${pct}%)`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          font: { size: 11 },
          color: "#888",
          maxRotation: 30,
          autoSkip: false,
        },
      },
      y: {
        border: { display: false },
        grid: { color: "rgba(0,0,0,0.06)" },
        ticks: { font: { size: 11 }, color: "#888" },
      },
    },
  };

  const canvasHeight = Math.max(200, perClass.length * 55 + 60);

  return (
    <div className="th-panel th-chart-panel">
      <div className="th-panel-header">
        <h3>Attendance Overview</h3>
      </div>

      {loading ? (
        <p className="th-panel-status">Loading…</p>
      ) : perClass.length === 0 ? (
        <p className="th-panel-status">No attendance records yet.</p>
      ) : (
        <>
          <div className="th-chart-legend">
            <span className="th-chart-legend-item">
              <span
                className="th-chart-legend-dot"
                style={{ background: "#1D9E75" }}
              />
              Present
            </span>
            <span className="th-chart-legend-item">
              <span
                className="th-chart-legend-dot"
                style={{ background: "#E24B4A" }}
              />
              Absent
            </span>
          </div>
          <div
            className="th-chart-canvas-wrap"
            style={{ height: canvasHeight }}
          >
            <Bar data={chartData} options={chartOptions} />
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CLASSWORK CHART — Grouped bar chart showing Submitted vs. Missing
// per class+subject combination this teacher handles.
// ════════════════════════════════════════════════════════════════════════════

function ClassworkChart({ teacherId }) {
  const [loading, setLoading] = useState(true);
  const [perClass, setPerClass] = useState([]);

  useEffect(() => {
    if (!teacherId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const combos = await getTeacherCombos(teacherId);

        const classworkLists = await Promise.all(
          combos.map((c) =>
            getDocs(
              query(
                collection(db, "Classwork"),
                where("grade", "==", c.grade),
                where("section", "==", c.section),
                where("subject", "==", c.subject),
              ),
            ).then((snap) =>
              snap.docs.map((d) => ({
                ...d.data(),
                _comboKey: `Gr.${c.grade} ${c.section} - ${c.subject}`,
              })),
            ),
          ),
        );

        const groupMap = {};
        classworkLists.flat().forEach((data) => {
          if (data.isAnnouncement) return;
          const key = data._comboKey;
          if (!groupMap[key]) groupMap[key] = { submitted: 0, missing: 0 };
          Object.values(data.studentStatus || {}).forEach((s) => {
            if (s === "Submitted") groupMap[key].submitted++;
            else if (s === "Missing") groupMap[key].missing++;
          });
        });

        const results = Object.entries(groupMap)
          .filter(([, v]) => v.submitted + v.missing > 0)
          .map(([label, v]) => ({ label, ...v }));

        if (!cancelled) setPerClass(results);
      } catch (e) {
        console.error("Failed to load classwork stats:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  const chartData = {
    labels: perClass.map((c) => c.label),
    datasets: [
      {
        label: "Submitted",
        data: perClass.map((c) => c.submitted),
        backgroundColor: "#378ADD",
        borderRadius: 4,
        barPercentage: 0.65,
        categoryPercentage: 0.8,
      },
      {
        label: "Missing",
        data: perClass.map((c) => c.missing),
        backgroundColor: "#BA7517",
        borderRadius: 4,
        barPercentage: 0.65,
        categoryPercentage: 0.8,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const ds = ctx.chart.data.datasets;
            const i = ctx.dataIndex;
            const tot = ds[0].data[i] + ds[1].data[i];
            const pct = tot === 0 ? 0 : Math.round((ctx.raw / tot) * 100);
            return ` ${ctx.dataset.label}: ${ctx.raw} (${pct}%)`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          font: { size: 11 },
          color: "#888",
          maxRotation: 30,
          autoSkip: false,
        },
      },
      y: {
        border: { display: false },
        grid: { color: "rgba(0,0,0,0.06)" },
        ticks: { font: { size: 11 }, color: "#888" },
      },
    },
  };

  const canvasHeight = Math.max(200, perClass.length * 55 + 60);

  return (
    <div className="th-panel th-chart-panel">
      <div className="th-panel-header">
        <h3>Classwork Completion</h3>
      </div>

      {loading ? (
        <p className="th-panel-status">Loading…</p>
      ) : perClass.length === 0 ? (
        <p className="th-panel-status">No marked classwork yet.</p>
      ) : (
        <>
          <div className="th-chart-legend">
            <span className="th-chart-legend-item">
              <span
                className="th-chart-legend-dot"
                style={{ background: "#378ADD" }}
              />
              Submitted
            </span>
            <span className="th-chart-legend-item">
              <span
                className="th-chart-legend-dot"
                style={{ background: "#BA7517" }}
              />
              Missing
            </span>
          </div>
          <div
            className="th-chart-canvas-wrap"
            style={{ height: canvasHeight }}
          >
            <Bar data={chartData} options={chartOptions} />
          </div>
        </>
      )}
    </div>
  );
}

export default TeacherHomepage;

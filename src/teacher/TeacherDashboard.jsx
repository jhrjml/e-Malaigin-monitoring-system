import { useState, useEffect, useRef, useMemo } from "react";
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
import { getActiveSchoolYearLabel } from "../api/firebaseApi";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import Repository from "./Repository";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./TeacherDashboard.css";
import "../Layout.css";
import ProfileModal from "../common/ProfileModal";
import ConfirmModal from "../common/ConfirmModal";
import AttendanceMonitoring from "./AttendanceMonitoring";
import ClassworkReminding from "./ClassworkReminding";
import StudentMasterlist from "./StudentMasterlist";
import useCachedFetch from "../common/useCachedFetch";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const titleMap = {
  dashboard: "Overview",
  repository: "Attendance Repository",
  attendance: "Attendance Monitoring",
  reminding: "Classwork Reminder",
  masterlist: "Student Masterlist",
};

function currentMonthId() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getSchoolYearMonths() {
  const now = new Date();
  const startYear =
    now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  const months = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(startYear, 5 + i, 1);
    months.push({
      id: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      name: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return months;
}

async function getTeacherCombos(teacherId) {
  const schedSnap = await getDocs(
    query(collection(db, "Schedule"), where("teacherId", "==", teacherId)),
  );
  const map = new Map();
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

function TeacherDashboard() {
  const navigateTo = useNavigate();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosed, setSidebarClosed] = useState(false);
  const [currentDate, setCurrentDate] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  const [activePage, setActivePage] = useState(
    () => localStorage.getItem("teacherPage") || "dashboard",
  );
  const [pageTitle, setPageTitle] = useState(
    () => titleMap[localStorage.getItem("teacherPage")] || "Overview",
  );

  const [focusClasswork, setFocusClasswork] = useState(null);

  // ── FIXED: teacherId resolution now goes through useCachedFetch, so on
  // repeat visits it resolves INSTANTLY from localStorage instead of
  // waiting on a fresh getDoc() every single time the teacher opens the
  // app — which was the very first thing blocking the whole dashboard
  // from painting while offline. ──
  const { data: cachedTeacherId } = useCachedFetch(
    "teacher:id",
    async () => {
      const userId = localStorage.getItem("userId");
      if (!userId) return null;
      const snap = await getDoc(doc(db, "User", userId));
      return snap.exists() ? snap.data().teacherId || null : null;
    },
    [],
  );
  const teacherId = cachedTeacherId;

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
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}
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
            <i className="fas fa-chart-pie"></i>
            <span>Dashboard</span>
          </li>
          <li
            className={activePage === "masterlist" ? "active" : ""}
            onClick={() => navigate("masterlist")}
          >
            <i className="fas fa-clipboard-list"></i>
            <span>Student Masterlist</span>
          </li>
          <li
            className={activePage === "repository" ? "active" : ""}
            onClick={() => navigate("repository")}
          >
            <i className="fas fa-history"></i>
            <span>Attendance Repository</span>
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

              <TeacherDashboardOverview
                teacherId={teacherId}
                onOpenReminder={openReminder}
              />
            </>
          )}

          {activePage === "masterlist" && (
            <StudentMasterlist teacherId={teacherId} />
          )}
          {activePage === "repository" && <Repository />}
          {activePage === "attendance" && <AttendanceMonitoring />}
          {activePage === "reminding" && (
            <ClassworkReminding
              focusClasswork={focusClasswork}
              onFocusConsumed={() => setFocusClasswork(null)}
            />
          )}
        </div>
      </main>

      {/* ── UNIFORM LOGOUT MODAL ── */}
      <ConfirmModal
        open={logoutOpen}
        title="Confirm Logout"
        titleIcon="fa-sign-out-alt"
        titleColor="#a65f81"
        message="Are you sure you want to log out of the teacher portal?"
        confirmText="Logout"
        confirmColor="primary"
        onConfirm={handleLogout}
        onCancel={() => setLogoutOpen(false)}
      />

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD OVERVIEW (DATA FETCH HOISTED)
// ════════════════════════════════════════════════════════════════════════════
function TeacherDashboardOverview({ teacherId, onOpenReminder }) {
  const schoolYearMonths = useMemo(() => getSchoolYearMonths(), []);

  const defaultMonth = useMemo(() => {
    const current = currentMonthId();
    const match = schoolYearMonths.find((m) => m.id === current);
    return match ? match.id : schoolYearMonths[schoolYearMonths.length - 1].id;
  }, [schoolYearMonths]);

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  // The admin-configured active school year label (e.g. "2026-2027"). Used
  // to scope every Classwork query on this dashboard so a teacher assigned
  // the same Grade/Section/Subject next school year doesn't see last
  // year's leftover posts in the reminders feed or completion chart.
  //
  // FIXED: this now goes through useCachedFetch too — previously a fresh
  // network round trip was required before ANY of the Classwork queries
  // below could even fire (they all `if (!schoolYear) return;`), which
  // meant the whole dashboard sat blank offline until this one value
  // resolved.
  const { data: cachedSchoolYear } = useCachedFetch(
    "schoolYear:active",
    () => getActiveSchoolYearLabel(),
    [],
  );
  const schoolYear = cachedSchoolYear || "";

  useEffect(() => {
    setSelectedMonth(defaultMonth);
  }, [defaultMonth]);

  // ── FIXED: reminders now load through useCachedFetch, so on repeat
  // visits the "Recent Updates & Reminders" panel + latest-post banner
  // paint instantly from the last-known localStorage snapshot instead of
  // showing "Loading…" every time the teacher opens the Dashboard tab
  // while offline. ──
  const { data: cachedReminders, loading } = useCachedFetch(
    `teacher:reminders:${teacherId || "none"}:${schoolYear || "none"}`,
    async () => {
      if (!teacherId || !schoolYear) return [];
      const combos = await getTeacherCombos(teacherId);

      const classworkLists = await Promise.all(
        combos.map((c) =>
          getDocs(
            query(
              collection(db, "Classwork"),
              where("grade", "==", c.grade),
              where("section", "==", c.section),
              where("subject", "==", c.subject),
              where("schoolYear", "==", schoolYear),
            ),
          ).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        ),
      );
      const items = classworkLists.flat();
      items.sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || ""),
      );
      return items;
    },
    [teacherId, schoolYear],
  );
  const reminders = cachedReminders || [];

  // Isolate the single absolute most recently created posting entry
  const latestPost = useMemo(() => reminders[0] || null, [reminders]);

  return (
    <div className="th-dashboard-flow-container">
      {/* Prominent Floating Latest Update Banner */}
      {!loading && latestPost && (
        <div
          className="th-latest-post-alert-banner"
          onClick={() => onOpenReminder(latestPost)}
        >
          <div className="th-latest-banner-badge">LATEST POST</div>
          <div className="th-latest-banner-body">
            <i
              className={`fas ${latestPost.isAnnouncement ? "fa-bullhorn" : "fa-tasks"} th-latest-banner-icon`}
            ></i>
            <div className="th-latest-banner-text">
              <strong>
                Grade {latestPost.grade} - {latestPost.section} (
                {latestPost.subject})
              </strong>
              : {latestPost.title}
              <span className="th-latest-banner-dash"> — </span>
              <span>{latestPost.desc}</span>
            </div>
          </div>
          <i className="fas fa-chevron-right th-latest-banner-arrow"></i>
        </div>
      )}

      <div className="th-overview-grid">
        <ReminderPanel
          reminders={reminders}
          loading={loading}
          onOpenReminder={onOpenReminder}
        />

        <div className="th-charts-col">
          <div className="th-filter-row">
            <select
              className="th-month-select"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {schoolYearMonths.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <AttendanceChart teacherId={teacherId} monthId={selectedMonth} />
          <ClassworkChart
            teacherId={teacherId}
            monthId={selectedMonth}
            schoolYear={schoolYear}
          />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// REMINDER PANEL
// ════════════════════════════════════════════════════════════════════════════
function ReminderPanel({ reminders, loading, onOpenReminder }) {
  const formatDueDate = (dateStr) => {
    if (!dateStr) return "No date configured";
    try {
      return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  // FIXED: only show "Loading…" when there is truly no data yet — on
  // repeat visits `reminders` is already populated from the cached
  // snapshot, so this renders the real list immediately.
  const showLoadingState = loading && reminders.length === 0;

  return (
    <div className="th-panel th-reminder-panel">
      <div className="th-panel-header">
        <h3>Recent Updates &amp; Reminders</h3>
      </div>

      <div className="th-reminder-list">
        {showLoadingState ? (
          <p className="th-panel-status">Loading…</p>
        ) : reminders.length === 0 ? (
          <p className="th-panel-status">No active records found.</p>
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
                  <i className="far fa-calendar-alt"></i> Posted:{" "}
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
// ATTENDANCE CHART
// ════════════════════════════════════════════════════════════════════════════
function AttendanceChart({ teacherId, monthId }) {
  // FIXED: swapped the manual useState+useEffect fetch for useCachedFetch,
  // keyed by teacherId+monthId so switching months still refetches (and
  // still shows last month's cached bars instantly while the new month's
  // data streams in behind it).
  const { data: cachedPerClass, loading } = useCachedFetch(
    `teacher:attendanceChart:${teacherId || "none"}:${monthId}`,
    async () => {
      if (!teacherId) return [];
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
              const data = d.data();
              if (!data.date || !data.date.startsWith(monthId)) return;
              const status = (data.status || "").toLowerCase();
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

      return results;
    },
    [teacherId, monthId],
  );
  const perClass = cachedPerClass || [];
  const showLoadingState = loading && perClass.length === 0;

  const chartData = {
    labels: perClass.map((c) => c.label),
    datasets: [
      {
        label: "Present",
        data: perClass.map((c) => c.present),
        backgroundColor: "#2ecc71",
        borderRadius: 4,
        barPercentage: 0.65,
        categoryPercentage: 0.8,
      },
      {
        label: "Absent",
        data: perClass.map((c) => c.absent),
        backgroundColor: "#e74c3c",
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
        ticks: { font: { size: 11 }, color: "#888", precision: 0 },
      },
    },
  };

  const canvasHeight = Math.max(200, perClass.length * 55 + 60);

  return (
    <div className="th-panel th-chart-panel">
      <div className="th-panel-header">
        <h3>Attendance Overview</h3>
      </div>

      {showLoadingState ? (
        <p className="th-panel-status">Loading…</p>
      ) : perClass.length === 0 ? (
        <p className="th-panel-status">No attendance records for this month.</p>
      ) : (
        <>
          <div className="th-chart-legend">
            <span className="th-chart-legend-item">
              <span
                className="th-chart-legend-dot"
                style={{ background: "#2ecc71" }}
              />
              Present
            </span>
            <span className="th-chart-legend-item">
              <span
                className="th-chart-legend-dot"
                style={{ background: "#e74c3c" }}
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
// CLASSWORK CHART
// ════════════════════════════════════════════════════════════════════════════
function ClassworkChart({ teacherId, monthId, schoolYear }) {
  // FIXED: same useCachedFetch treatment as AttendanceChart above.
  const { data: cachedPerClass, loading } = useCachedFetch(
    `teacher:classworkChart:${teacherId || "none"}:${monthId}:${schoolYear || "none"}`,
    async () => {
      if (!teacherId || !schoolYear) return [];
      const combos = await getTeacherCombos(teacherId);

      const classworkLists = await Promise.all(
        combos.map((c) =>
          getDocs(
            query(
              collection(db, "Classwork"),
              where("grade", "==", c.grade),
              where("section", "==", c.section),
              where("subject", "==", c.subject),
              where("schoolYear", "==", schoolYear),
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
        if (!data.date || !data.date.startsWith(monthId)) return;
        const key = data._comboKey;
        if (!groupMap[key]) groupMap[key] = { submitted: 0, missing: 0 };
        Object.values(data.studentStatus || {}).forEach((s) => {
          if (s === "Submitted") groupMap[key].submitted++;
          else if (s === "Missing") groupMap[key].missing++;
        });
      });

      return Object.entries(groupMap)
        .filter(([, v]) => v.submitted + v.missing > 0)
        .map(([label, v]) => ({ label, ...v }));
    },
    [teacherId, monthId, schoolYear],
  );
  const perClass = cachedPerClass || [];
  const showLoadingState = loading && perClass.length === 0;

  const chartData = {
    labels: perClass.map((c) => c.label),
    datasets: [
      {
        label: "Submitted",
        data: perClass.map((c) => c.submitted),
        backgroundColor: "#1abc9c",
        borderRadius: 4,
        barPercentage: 0.65,
        categoryPercentage: 0.8,
      },
      {
        label: "Missing",
        data: perClass.map((c) => c.missing),
        backgroundColor: "#e67e22",
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
        ticks: { font: { size: 11 }, color: "#888", precision: 0 },
      },
    },
  };

  const canvasHeight = Math.max(200, perClass.length * 55 + 60);

  return (
    <div className="th-panel th-chart-panel">
      <div className="th-panel-header">
        <h3>Classwork Completion</h3>
      </div>

      {showLoadingState ? (
        <p className="th-panel-status">Loading…</p>
      ) : perClass.length === 0 ? (
        <p className="th-panel-status">No classwork records for this month.</p>
      ) : (
        <>
          <div className="th-chart-legend">
            <span className="th-chart-legend-item">
              <span
                className="th-chart-legend-dot"
                style={{ background: "#1abc9c" }}
              />
              Submitted
            </span>
            <span className="th-chart-legend-item">
              <span
                className="th-chart-legend-dot"
                style={{ background: "#e67e22" }}
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

export default TeacherDashboard;

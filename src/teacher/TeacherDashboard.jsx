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
import AttendanceMonitoring from "./AttendanceMonitoring";
import ClassworkReminding from "./ClassworkReminding";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const titleMap = {
  dashboard: "Overview",
  repository: "Attendance Repository",
  attendance: "Attendance Monitoring",
  reminding: "Classwork Reminder",
};

// ── School year runs June → March (PH DepEd calendar). ───────────────────
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

// ── Shared helper — every grade+section+subject this teacher is scheduled
// for, deduped. ────────────────────────────────────────────────────────────
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

function TeacherHomepage() {
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

  const [teacherId, setTeacherId] = useState(null);
  const [focusClasswork, setFocusClasswork] = useState(null);

  const rawFullName = localStorage.getItem("fullName") || "";
  const teacherFirstName = (() => {
    if (!rawFullName) return "Teacher";
    const afterComma = rawFullName.includes(",")
      ? rawFullName.split(",")[1].trim()
      : rawFullName.trim();
    return afterComma.split(" ")[0] || "Teacher";
  })();

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;
    getDoc(doc(db, "User", userId))
      .then((snap) => {
        if (snap.exists()) setTeacherId(snap.data().teacherId || null);
      })
      .catch((e) => console.error("Failed to resolve teacherId:", e));
  }, []);

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

      {logoutOpen && (
        <div className="modal-overlay-teacher">
          <div className="modal-teacher logout-modal-teacher">
            <div className="modal-header-teacher">
              <h2>Confirm Logout</h2>
            </div>
            <p>Are you sure you want to logout?</p>
            <div className="modal-buttons-teacher">
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
// DASHBOARD OVERVIEW — Reminder panel (left) + month-filtered charts (right)
// ════════════════════════════════════════════════════════════════════════════

function TeacherDashboardOverview({ teacherId, onOpenReminder }) {
  // Compute inside the component on every mount so the list and default are
  // always based on today's actual date — not a stale module-level snapshot.
  const schoolYearMonths = useMemo(() => getSchoolYearMonths(), []);

  // Find the current month in the school-year list. If today falls outside
  // the school-year window (e.g. it's April, after March end), fall back to
  // the last month in the list so the chart always shows something useful.
  const defaultMonth = useMemo(() => {
    const current = currentMonthId();
    const match = schoolYearMonths.find((m) => m.id === current);
    return match ? match.id : schoolYearMonths[schoolYearMonths.length - 1].id;
  }, [schoolYearMonths]);

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  // useState only uses its initial value on the very first mount.
  // This effect syncs selectedMonth whenever defaultMonth resolves or changes
  // (e.g. component remounts after navigating away and back).
  useEffect(() => {
    setSelectedMonth(defaultMonth);
  }, [defaultMonth]);

  return (
    <div className="th-overview-grid">
      <ReminderPanel teacherId={teacherId} onOpenReminder={onOpenReminder} />

      <div className="th-charts-col">
        {/* Month filter — sits above both charts, right-aligned */}
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
        <ClassworkChart teacherId={teacherId} monthId={selectedMonth} />
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// REMINDER PANEL
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

        const gsMap = new Map();
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

        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

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
// ATTENDANCE CHART — Present vs. Absent per class+subject, filtered by month
// ════════════════════════════════════════════════════════════════════════════

function AttendanceChart({ teacherId, monthId }) {
  const [loading, setLoading] = useState(true);
  const [perClass, setPerClass] = useState([]);

  useEffect(() => {
    setPerClass([]);

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
  }, [teacherId, monthId]);

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

      {loading ? (
        <p className="th-panel-status">Loading…</p>
      ) : perClass.length === 0 ? (
        <p className="th-panel-status">No attendance records for this month.</p>
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
// CLASSWORK CHART — Submitted vs. Missing per class+subject, filtered by month
// ════════════════════════════════════════════════════════════════════════════

function ClassworkChart({ teacherId, monthId }) {
  const [loading, setLoading] = useState(true);
  const [perClass, setPerClass] = useState([]);

  useEffect(() => {
    setPerClass([]);

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
          if (!data.date || !data.date.startsWith(monthId)) return;
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
  }, [teacherId, monthId]);

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

      {loading ? (
        <p className="th-panel-status">Loading…</p>
      ) : perClass.length === 0 ? (
        <p className="th-panel-status">No classwork records for this month.</p>
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

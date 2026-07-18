import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./ParentDashboard.css";
import ChildProfile from "./ChildProfile";
import "../Layout.css";
import ProfileModal from "../common/ProfileModal";
import ConfirmModal from "../common/ConfirmModal"; // Importing the unified modern modal
import AttendanceRecord from "./AttendanceRecord";
import AcademicActivity from "./AcademicActivity";
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
import usePushNotifications from "../common/usePushNotifications";
import { unsubscribeFromPush } from "../common/pushSubscribe";
import useCachedFetch from "../common/useCachedFetch";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const titleMap = {
  dashboard: "Overview",
  profile: "Child's Profile",
  record: "Attendance Record",
  activity: "Academic Activity",
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

const ParentDashboard = () => {
  usePushNotifications();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosed, setSidebarClosed] = useState(false);

  const [currentDate, setCurrentDate] = useState("");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  const [activePage, setActivePage] = useState(
    () => localStorage.getItem("parentPage") || "dashboard",
  );

  const [focusClasswork, setFocusClasswork] = useState(null);

  const rawFullName = localStorage.getItem("fullName") || "";
  const parentFirstName = rawFullName.trim().split(" ")[0] || "Parent";

  useEffect(() => {
    const options = { year: "numeric", month: "long", day: "numeric" };
    setCurrentDate(new Date().toLocaleDateString("en-US", options));
  }, []);

  useEffect(() => {
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

  const toggleSidebar = () => {
    if (window.innerWidth > 768) {
      setSidebarClosed(!sidebarClosed);
    } else {
      setSidebarOpen(!sidebarOpen);
    }
  };

  const handleLogout = () => {
    unsubscribeFromPush();
    localStorage.clear();
    setLogoutOpen(false);
    window.location.href = "/";
  };

  const navigate = (page) => {
    setActivePage(page);
    localStorage.setItem("parentPage", page);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const openReminder = (cw) => {
    setFocusClasswork(cw);
    navigate("activity");
  };

  return (
    <div className="app-container">
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        id="sidebar"
        className={`sidebar ${sidebarOpen ? "open" : ""} ${sidebarClosed ? "closed" : ""}`}
      >
        <div className="brand-logo">
          <img src="/logo.jpg" alt="School Logo" className="brand-logo-img" />
          <div className="brand-text">
            <span className="brand-title">e-Malaigin</span>
            <small className="brand-subtitle">PARENT PORTAL</small>
          </div>
        </div>

        <ul className="menu">
          <li
            className={activePage === "dashboard" ? "active" : ""}
            onClick={() => navigate("dashboard")}
          >
            <i className="fas fa-chart-pie"></i>
            <span> Dashboard</span>
          </li>
          <li
            className={activePage === "profile" ? "active" : ""}
            onClick={() => navigate("profile")}
          >
            <i className="fas fa-user-graduate"></i>
            <span> Child's Profile</span>
          </li>
          <li
            className={activePage === "record" ? "active" : ""}
            onClick={() => navigate("record")}
          >
            <i className="fas fa-calendar-check"></i>
            <span> Attendance Record</span>
          </li>
          <li
            className={activePage === "activity" ? "active" : ""}
            onClick={() => navigate("activity")}
          >
            <i className="fas fa-tasks"></i>
            <span> Academic Activity</span>
          </li>
        </ul>
      </aside>

      <main className="main-content">
        <header>
          <div className="header-left">
            <button id="menu-toggle" onClick={toggleSidebar}>
              <i className="fas fa-bars"></i>
            </button>
            <div className="header-title">
              {titleMap[activePage] || "Dashboard"}
            </div>
          </div>

          <div className="header-right">
            <div className="profile-menu-wrap" ref={profileMenuRef}>
              <button
                className="profile-avatar-btn"
                onClick={() => setProfileMenuOpen((v) => !v)}
              >
                <i className="fas fa-user-circle fa-2x"></i>
                <span className="profile-avatar-name">{parentFirstName}</span>
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
                <div className="welcome-text">
                  <h1>Welcome, {parentFirstName}!</h1>
                  <p>Get a quick overview of your child's activities.</p>
                </div>
                <div className="date-badge-p">
                  <i className="far fa-calendar-alt"></i>
                  <span>{currentDate || "Loading..."}</span>
                </div>
              </div>

              <DashboardOverview onOpenReminder={openReminder} />
            </>
          )}

          {activePage === "profile" && <ChildProfile />}
          {activePage === "record" && <AttendanceRecord />}
          {activePage === "activity" && (
            <AcademicActivity
              focusClasswork={focusClasswork}
              onFocusConsumed={() => setFocusClasswork(null)}
            />
          )}
        </div>

        {/* ── UNIFORM LOGOUT MODAL ── */}
        <ConfirmModal
          open={logoutOpen}
          title="Confirm Logout"
          titleIcon="fa-sign-out-alt"
          titleColor="#a65f81"
          message="Are you sure you want to log out of the parent portal?"
          confirmText="Logout"
          confirmColor="primary"
          onConfirm={handleLogout}
          onCancel={() => setLogoutOpen(false)}
        />

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
        />
      </main>
    </div>
  );
};

function DashboardOverview({ onOpenReminder }) {
  const userId = localStorage.getItem("userId");
  const [selectedKid, setSelectedKid] = useState(null);

  const schoolYearMonths = useMemo(() => getSchoolYearMonths(), []);

  const defaultMonth = useMemo(() => {
    const current = currentMonthId();
    const match = schoolYearMonths.find((m) => m.id === current);
    return match ? match.id : schoolYearMonths[schoolYearMonths.length - 1].id;
  }, [schoolYearMonths]);

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  useEffect(() => {
    setSelectedMonth(defaultMonth);
  }, [defaultMonth]);

  // ── FIXED: children list is now cached under a SHARED key
  // ("children:<userId>"), the same key used by ChildProfile,
  // AttendanceRecord, and AcademicActivity. Whichever page loads it first
  // populates the cache for all the others — so switching tabs renders the
  // roster instantly instead of each page re-fetching it from scratch. ──
  const fetchChildren = useCallback(async () => {
    if (!userId) return [];
    const userSnap = await getDoc(doc(db, "User", userId));
    if (!userSnap.exists()) return [];

    const studentIds = userSnap.data().studentIds || [];
    if (studentIds.length === 0) return [];

    const studentDocs = await Promise.all(
      studentIds.map((id) => getDoc(doc(db, "Student", id))),
    );

    return Promise.all(
      studentDocs
        .filter((d) => d.exists())
        .map(async (d) => {
          const s = { id: d.id, ...d.data() };
          const enrollSnap = await getDocs(
            query(
              collection(db, "Enrolled"),
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
  }, [userId]);

  const { data: cachedKids, loading: kidsLoading } = useCachedFetch(
    `children:${userId || "none"}`,
    fetchChildren,
    [userId],
  );
  const kids = cachedKids || [];
  const showKidsLoading = kidsLoading && !cachedKids;

  // Keep the selection in sync as the cached list loads/refreshes,
  // preferring to preserve the current pick if it still exists.
  useEffect(() => {
    if (kids.length === 0) {
      setSelectedKid(null);
      return;
    }
    setSelectedKid((prev) => {
      const stillThere = prev && kids.find((k) => k.id === prev.id);
      return stillThere || kids[0];
    });
  }, [kids]);

  // ── Active school year — cached, shared with the other pages. ──
  const { data: cachedSchoolYear } = useCachedFetch(
    "schoolYear:active",
    () => getActiveSchoolYearLabel(),
    [],
  );
  const schoolYear = cachedSchoolYear || "";

  // ── FIXED: reminders now cached per user + school year. Because `kids`
  // and `schoolYear` above already resolve synchronously from their own
  // caches before this fetch runs, this reliably has what it needs on a
  // repeat visit without an extra round trip. ──
  const fetchReminders = useCallback(async () => {
    if (!kids.length || !schoolYear) return [];

    const toISO = (raw) => {
      if (!raw) return null;
      if (typeof raw?.toDate === "function") {
        const d = raw.toDate();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      const s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const parsed = new Date(s);
      if (!isNaN(parsed)) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
      }
      return null;
    };

    const perChild = await Promise.all(
      kids.map(async (kid) => {
        if (!kid.enrolledGrade || !kid.enrolledSection) return [];

        const snap = await getDocs(
          query(
            collection(db, "Classwork"),
            where("grade", "==", kid.enrolledGrade),
            where("section", "==", kid.enrolledSection),
            // Scoped to the active school year so a child re-enrolled in
            // the same Grade/Section next year doesn't see last year's
            // leftover classwork/announcements resurface here.
            where("schoolYear", "==", schoolYear),
          ),
        );

        return snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            date: toISO(data.date),
            studentId: kid.id,
            studentName: `${kid.firstName} ${kid.lastName}`,
          };
        });
      }),
    );

    const items = perChild.flat().filter((it) => {
      const markedStatus = it.studentStatus?.[it.studentId];
      const isMarked =
        markedStatus === "Submitted" || markedStatus === "Missed";
      // If the teacher has explicitly graded it, hide it from the "active
      // reminders" list
      return !isMarked;
    });

    // Sorted chronologically descending by its creation timestamp
    items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return items;
  }, [kids, schoolYear]);

  const { data: cachedReminders, loading: remindersLoading } = useCachedFetch(
    `reminders:${userId || "none"}:${schoolYear || "none"}`,
    fetchReminders,
    [kids, schoolYear],
  );
  const reminders = cachedReminders || [];
  const showRemindersLoading = remindersLoading && !cachedReminders;

  // Isolate the single absolute most recently created posting entry for the top banner
  const latestPost = useMemo(() => reminders[0] || null, [reminders]);

  return (
    <div className="pd-dashboard-flow-wrapper" style={{ width: "100%" }}>
      {/* Dynamic Floating Latest Post Alert Banner — shows as soon as
          there's cached data, doesn't wait on a fresh fetch */}
      {latestPost && (
        <div
          className="pd-latest-post-alert-banner"
          onClick={() => onOpenReminder(latestPost)}
        >
          <div className="pd-latest-banner-badge">LATEST POST</div>
          <div className="pd-latest-banner-body">
            <i
              className={`fas ${latestPost.isAnnouncement ? "fa-bullhorn" : "fa-tasks"} pd-latest-banner-icon`}
            ></i>
            <div className="pd-latest-banner-text">
              <strong>
                Grade {latestPost.grade} - {latestPost.section} (
                {latestPost.subject})
              </strong>
              : {latestPost.title}
              <span className="pd-latest-banner-dash"> — </span>
              <span>{latestPost.desc}</span>
            </div>
          </div>
          <i className="fas fa-chevron-right pd-latest-banner-arrow"></i>
        </div>
      )}

      <div className="pd-overview-grid">
        <ParentReminderPanel
          reminders={reminders}
          loading={showRemindersLoading}
          onOpenReminder={onOpenReminder}
        />

        <div className="pd-charts-col">
          <div className="pd-filter-row">
            {kids.length > 1 && (
              <div className="pd-child-filter-group">
                {kids.map((k) => (
                  <button
                    key={k.id}
                    className={`pd-child-filter-btn ${selectedKid?.id === k.id ? "active" : ""}`}
                    onClick={() => setSelectedKid(k)}
                  >
                    <i className="fas fa-user-graduate"></i> {k.firstName}
                  </button>
                ))}
              </div>
            )}

            <select
              className="pd-month-select"
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

          {showKidsLoading ? (
            <div className="pd-panel">
              <p className="pd-panel-status">Loading…</p>
            </div>
          ) : !selectedKid ? (
            <div className="pd-panel">
              <p className="pd-panel-status">
                No children linked to this account.
              </p>
            </div>
          ) : (
            <>
              <ParentAttendanceChart
                child={selectedKid}
                monthId={selectedMonth}
              />
              <ParentClassworkChart
                child={selectedKid}
                monthId={selectedMonth}
                schoolYear={schoolYear}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ParentReminderPanel({ reminders, loading, onOpenReminder }) {
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
    <div className="pd-panel pd-reminder-panel">
      <div className="pd-panel-header">
        <h3>Recent Updates &amp; Reminders</h3>
      </div>

      <div className="pd-reminder-list">
        {loading ? (
          <p className="pd-panel-status">Loading…</p>
        ) : reminders.length === 0 ? (
          <p className="pd-panel-status">No active reminders.</p>
        ) : (
          reminders.map((cw) => (
            <div
              key={`${cw.studentId}-${cw.id}`}
              className="pd-reminder-card"
              onClick={() =>
                onOpenReminder({
                  studentId: cw.studentId,
                  subject: cw.subject,
                  classworkId: cw.id,
                })
              }
            >
              <div
                className={`pd-reminder-icon ${cw.isAnnouncement ? "pd-reminder-icon--announcement" : ""}`}
              >
                <i
                  className={`fas ${cw.isAnnouncement ? "fa-bullhorn" : "fa-tasks"}`}
                ></i>
              </div>
              <div className="pd-reminder-body">
                <h4>
                  Grade {cw.grade} - {cw.section} - {cw.subject}
                </h4>
                <span
                  className={`pd-reminder-type-pill ${cw.isAnnouncement ? "pd-reminder-type-pill--announcement" : ""}`}
                >
                  {cw.title || "Reminder"}
                </span>
                {cw.desc && <p className="pd-reminder-desc">{cw.desc}</p>}
                <p className="pd-reminder-due">
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

function ParentAttendanceChart({ child, monthId }) {
  // ── FIXED: cached per child + month, so re-visiting a month you've
  // already viewed shows the chart instantly. ──
  const fetchAttendance = useCallback(async () => {
    if (!child) return [];
    const snap = await getDocs(
      query(collection(db, "Attendance"), where("studentId", "==", child.id)),
    );

    const map = new Map();
    snap.docs.forEach((d) => {
      const data = d.data();
      if (!data.date || !data.date.startsWith(monthId)) return;
      const status = (data.status || "").toLowerCase();
      if (!map.has(data.subject))
        map.set(data.subject, { present: 0, absent: 0 });
      const entry = map.get(data.subject);
      if (status === "present") entry.present++;
      else if (status === "absent") entry.absent++;
    });

    return [...map.entries()]
      .filter(([, v]) => v.present + v.absent > 0)
      .map(([subject, v]) => ({ subject, ...v }));
  }, [child?.id, monthId]);

  const { data: cachedPerSubject, loading } = useCachedFetch(
    `attendanceChart:${child?.id || "none"}:${monthId}`,
    fetchAttendance,
    [child?.id, monthId],
  );
  const perSubject = cachedPerSubject || [];
  const showLoading = loading && !cachedPerSubject;

  const chartData = {
    labels: perSubject.map((c) => c.subject),
    datasets: [
      {
        label: "Present",
        data: perSubject.map((c) => c.present),
        backgroundColor: "#2ecc71",
        borderRadius: 4,
        barPercentage: 0.6,
        categoryPercentage: 0.7,
      },
      {
        label: "Absent",
        data: perSubject.map((c) => c.absent),
        backgroundColor: "#e74c3c",
        borderRadius: 4,
        barPercentage: 0.6,
        categoryPercentage: 0.7,
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
        ticks: { font: { size: 11 }, color: "#888" },
      },
      y: {
        border: { display: false },
        grid: { color: "rgba(0,0,0,0.06)" },
        ticks: { font: { size: 11 }, color: "#888", precision: 0 },
      },
    },
  };

  const canvasHeight = Math.max(180, perSubject.length * 50 + 60);

  return (
    <div className="pd-panel pd-chart-panel">
      <div className="pd-panel-header">
        <h3>Attendance by Subject</h3>
      </div>

      {showLoading ? (
        <p className="pd-panel-status">Loading…</p>
      ) : perSubject.length === 0 ? (
        <p className="pd-panel-status">No attendance records for this month.</p>
      ) : (
        <>
          <div className="pd-chart-legend">
            <span className="pd-chart-legend-item">
              <span
                className="pd-chart-legend-dot"
                style={{ background: "#2ecc71" }}
              />
              Present
            </span>
            <span className="pd-chart-legend-item">
              <span
                className="pd-chart-legend-dot"
                style={{ background: "#E24B4A" }}
              />
              Absent
            </span>
          </div>
          <div
            className="pd-chart-canvas-wrap"
            style={{ height: canvasHeight }}
          >
            <Bar data={chartData} options={chartOptions} />
          </div>
        </>
      )}
    </div>
  );
}

function ParentClassworkChart({ child, monthId, schoolYear }) {
  // ── FIXED: cached per child + month + school year. ──
  const fetchClasswork = useCallback(async () => {
    if (!child?.enrolledGrade || !child?.enrolledSection || !schoolYear)
      return [];

    const snap = await getDocs(
      query(
        collection(db, "Classwork"),
        where("grade", "==", child.enrolledGrade),
        where("section", "==", child.enrolledSection),
        where("schoolYear", "==", schoolYear),
      ),
    );

    const map = new Map();
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.isAnnouncement) return;
      if (!data.date || !data.date.startsWith(monthId)) return;

      const status = data.studentStatus?.[child.id];
      if (status !== "Submitted" && status !== "Missed") return;

      if (!map.has(data.subject))
        map.set(data.subject, { submitted: 0, missing: 0 });
      const entry = map.get(data.subject);
      if (status === "Submitted") entry.submitted++;
      else entry.missing++;
    });

    return [...map.entries()].map(([subject, v]) => ({ subject, ...v }));
  }, [
    child?.id,
    child?.enrolledGrade,
    child?.enrolledSection,
    monthId,
    schoolYear,
  ]);

  const { data: cachedPerSubject, loading } = useCachedFetch(
    `classworkChart:${child?.id || "none"}:${monthId}:${schoolYear || "none"}`,
    fetchClasswork,
    [
      child?.id,
      child?.enrolledGrade,
      child?.enrolledSection,
      monthId,
      schoolYear,
    ],
  );
  const perSubject = cachedPerSubject || [];
  const showLoading = loading && !cachedPerSubject;

  const chartData = {
    labels: perSubject.map((c) => c.subject),
    datasets: [
      {
        label: "Submitted",
        data: perSubject.map((c) => c.submitted),
        backgroundColor: "#1abc9c",
        borderRadius: 4,
        barPercentage: 0.6,
        categoryPercentage: 0.7,
      },
      {
        label: "Missed",
        data: perSubject.map((c) => c.missing),
        backgroundColor: "#e67e22",
        borderRadius: 4,
        barPercentage: 0.6,
        categoryPercentage: 0.7,
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
        ticks: { font: { size: 11 }, color: "#888" },
      },
      y: {
        border: { display: false },
        grid: { color: "rgba(0,0,0,0.06)" },
        ticks: { font: { size: 11 }, color: "#888", precision: 0 },
      },
    },
  };

  const canvasHeight = Math.max(180, perSubject.length * 50 + 60);

  return (
    <div className="pd-panel pd-chart-panel">
      <div className="pd-panel-header">
        <h3>Classwork Completion</h3>
      </div>

      {showLoading ? (
        <p className="pd-panel-status">Loading…</p>
      ) : perSubject.length === 0 ? (
        <p className="pd-panel-status">No classwork records for this month.</p>
      ) : (
        <>
          <div className="pd-chart-legend">
            <span className="pd-chart-legend-item">
              <span
                className="pd-chart-legend-dot"
                style={{ background: "#1abc9c" }}
              />
              Submitted
            </span>
            <span className="pd-chart-legend-item">
              <span
                className="pd-chart-legend-dot"
                style={{ background: "#e67e22" }}
              />
              Missed
            </span>
          </div>
          <div
            className="pd-chart-canvas-wrap"
            style={{ height: canvasHeight }}
          >
            <Bar data={chartData} options={chartOptions} />
          </div>
        </>
      )}
    </div>
  );
}

export default ParentDashboard;

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import ManageStudents from "./ManageStudents";
import ManageTeachers from "./ManageTeachers";
import ManageUsers from "./ManageUsers";
import ManageClasses from "./ManageClasses";
import GenerateQr from "./GenerateQr";
import Archive from "./Archive";
import {
  getDashboardStats,
  getEnrollmentDropoutStats,
  getSchoolYears,
  addSchoolYear,
  setActiveSchoolYear,
  importPublicHolidaysForSchoolYear,
  backfillEnrollmentTimestamps,
  getTeachers,
  getStudents,
  getUsers,
  getEnrolled,
} from "../api/firebaseApi";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./AdminHomepage.css";
import "./Archive.css";
import "../Layout.css";
import ProfileModal from "../common/ProfileModal";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const titleMap = {
  dashboard: "Overview",
  students: "Manage Students",
  teachers: "Manage Teachers",
  users: "User Accounts",
  classes: "Manage Classes",
  qr: "Generate ID card",
  archive: "Archive",
};

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
const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function formatHolidayDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

function AdminHomepage() {
  const navigateTo = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarClosed, setSidebarClosed] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);

  const storedUsername = localStorage.getItem("username") || "Admin";

  // ── Persist activePage across refresh ──────────────────────────────────
  const [activePage, setActivePage] = useState(
    () => localStorage.getItem("adminPage") || "dashboard",
  );
  const [pageTitle, setPageTitle] = useState(
    () => titleMap[localStorage.getItem("adminPage")] || "Overview",
  );

  // ── Dashboard data ───────────────────────────────────────────────────────
  const [dashboardStats, setDashboardStats] = useState({
    studentCount: 0,
    teacherCount: 0,
  });
  const [enrollmentStats, setEnrollmentStats] = useState([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const loadDashboardData = useCallback(() => {
    setDashboardLoading(true);
    return Promise.all([getDashboardStats(), getEnrollmentDropoutStats()])
      .then(([stats, enrollment]) => {
        setDashboardStats(stats);
        setEnrollmentStats(enrollment);
      })
      .catch((e) => console.error("Failed to load dashboard data:", e))
      .finally(() => setDashboardLoading(false));
  }, []);

  useEffect(() => {
    if (activePage !== "dashboard") return;
    loadDashboardData();
  }, [activePage, loadDashboardData]);

  const toggleSidebar = () => {
    if (window.innerWidth > 768) {
      setSidebarClosed(!sidebarClosed);
    } else {
      setSidebarOpen(!sidebarOpen);
    }
  };

  const navigate = (target) => {
    setActivePage(target);
    setPageTitle(titleMap[target] || "Admin Portal");
    localStorage.setItem("adminPage", target);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const handleLogout = () => {
    localStorage.clear();
    setLogoutOpen(false);
    window.location.href = "/";
  };

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
        id="sidebar"
        className={`sidebar ${sidebarOpen ? "open" : ""} ${sidebarClosed ? "closed" : ""}`}
      >
        <div className="brand-logo">
          <img src="/logo.jpg" alt="School Logo" className="brand-logo-img" />
          <div className="brand-text">
            <span className="brand-title">e-Malaigin</span>
            <small className="brand-subtitle">ADMIN PORTAL</small>
          </div>
        </div>

        <ul className="menu">
          <li
            className={activePage === "dashboard" ? "active" : ""}
            onClick={() => navigate("dashboard")}
          >
            <i className="fas fa-chart-pie"></i> <span>Dashborad</span>
          </li>
          <li
            className={activePage === "students" ? "active" : ""}
            onClick={() => navigate("students")}
          >
            <i className="fas fa-user-graduate"></i>
            <span> Manage Students</span>
          </li>
          <li
            className={activePage === "teachers" ? "active" : ""}
            onClick={() => navigate("teachers")}
          >
            <i className="fas fa-chalkboard-teacher"></i>
            <span> Manage Teachers</span>
          </li>
          <li
            className={activePage === "classes" ? "active" : ""}
            onClick={() => navigate("classes")}
          >
            <i className="fas fa-calendar-alt"></i>
            <span> Manage Classes</span>
          </li>
          <li
            className={activePage === "users" ? "active" : ""}
            onClick={() => navigate("users")}
          >
            <i className="fas fa-users-cog"></i>
            <span>Users Account</span>
          </li>
          <li
            className={activePage === "qr" ? "active" : ""}
            onClick={() => navigate("qr")}
          >
            <i className="fas fa-qrcode"></i>
            <span> Generate ID</span>
          </li>
          <li
            className={activePage === "archive" ? "active" : ""}
            onClick={() => navigate("archive")}
          >
            <i className="fas fa-archive"></i>
            <span> Archive</span>
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
                <span className="profile-avatar-name">{storedUsername}</span>
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
            <DashboardOverview
              stats={dashboardStats}
              enrollment={enrollmentStats}
              loading={dashboardLoading}
              onRefresh={loadDashboardData}
            />
          )}

          {activePage === "students" && <ManageStudents />}
          {activePage === "teachers" && <ManageTeachers />}
          {activePage === "users" && <ManageUsers />}
          {activePage === "classes" && <ManageClasses />}
          {activePage === "qr" && <GenerateQr />}
          {activePage === "archive" && <Archive />}
        </div>

        {/* LOGOUT MODAL */}
        {logoutOpen && (
          <div className="modal-overlay-admin">
            <div className="modal-admin logout-modal">
              <div className="modal-header">
                <h2>Confirm Logout</h2>
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

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
        />
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD OVERVIEW
// ════════════════════════════════════════════════════════════════════════════

function DashboardOverview({ stats, enrollment, loading, onRefresh }) {
  const [searchQuery, setSearchQuery] = useState("");
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="overview-grid">
      <DashboardSearch query={searchQuery} onQueryChange={setSearchQuery} />

      {!isSearching && (
        <div className="overview-main-row">
          <div className="overview-main-col">
            <div className="stat-cards-row">
              <StatCard
                icon="fa-user-graduate"
                label="Total Students"
                value={stats.studentCount}
                accent="purple"
              />
              <StatCard
                icon="fa-chalkboard-teacher"
                label="Total Teachers"
                value={stats.teacherCount}
                accent="orange"
              />
            </div>

            <EnrollmentDropoutChart
              data={enrollment}
              loading={loading}
              onDataFixed={onRefresh}
            />
          </div>

          <MiniCalendar />
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, accent }) {
  return (
    <div className={`stat-card stat-card--${accent}`}>
      <div className="stat-card-icon">
        <i className={`fas ${icon}`}></i>
      </div>
      <div className="stat-card-body">
        <span className="stat-card-value">{value}</span>
        <span className="stat-card-label">{label}</span>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD SEARCH
// ════════════════════════════════════════════════════════════════════════════

const fullStudentName = (s) =>
  `${s.lastName}, ${s.firstName}${s.middleName ? " " + s.middleName : ""}`;

const fullTeacherName = (t) =>
  `${t.lname}, ${t.fname}${t.mname ? " " + t.mname : ""}`;

function DashboardSearch({ query, onQueryChange }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [teachers, setTeachers] = useState([]);
  const [teacherUsers, setTeacherUsers] = useState([]);
  const [students, setStudents] = useState([]);
  const [parentUsers, setParentUsers] = useState([]);
  const [enrolledByStudent, setEnrolledByStudent] = useState({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getTeachers(),
      getUsers("Teacher"),
      getStudents(),
      getUsers("Parent"),
      getEnrolled(),
    ])
      .then(
        ([
          teacherList,
          teacherUserList,
          studentList,
          parentUserList,
          enrolledList,
        ]) => {
          if (cancelled) return;
          setTeachers(teacherList);
          setTeacherUsers(teacherUserList);
          setStudents(studentList);
          setParentUsers(parentUserList);

          const map = {};
          enrolledList.forEach((e) => {
            const existing = map[e.studentId];
            if (
              !existing ||
              (existing.status !== "Enrolled" && e.status === "Enrolled")
            ) {
              map[e.studentId] = e;
            }
          });
          setEnrolledByStudent(map);
        },
      )
      .catch((err) => {
        console.error("Dashboard search load error:", err);
        if (!cancelled) setLoadError("Couldn't load search data.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();

  const matchedTeachers = !q
    ? []
    : teachers
        .map((teacher) => ({
          teacher,
          teacherUser:
            teacherUsers.find((u) => u.teacherId === teacher.id) || null,
        }))
        .filter(
          ({ teacher, teacherUser }) =>
            fullTeacherName(teacher).toLowerCase().includes(q) ||
            (teacher.empId || "").toLowerCase().includes(q) ||
            (teacherUser?.username || "").toLowerCase().includes(q),
        );

  const matchedStudents = !q
    ? []
    : students
        .map((student) => ({
          student,
          parentUser:
            parentUsers.find((u) =>
              (u.studentIds || []).includes(student.id),
            ) || null,
          enrollment: enrolledByStudent[student.id] || null,
        }))
        .filter(
          ({ student, parentUser }) =>
            fullStudentName(student).toLowerCase().includes(q) ||
            (student.lrn || "").toLowerCase().includes(q) ||
            (student.guardian || "").toLowerCase().includes(q) ||
            (parentUser?.username || "").toLowerCase().includes(q),
        );

  const hasResults = matchedTeachers.length > 0 || matchedStudents.length > 0;

  return (
    <div className="dashboard-search-card">
      <div className="dashboard-search-bar-row">
        <div className="dashboard-search-input-wrap">
          <i className="fas fa-search dashboard-search-icon"></i>
          <input
            type="text"
            className="dashboard-search-input"
            placeholder="Search…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="dashboard-search-clear"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {q && (
        <div className="dashboard-search-results">
          {loading ? (
            <div className="dashboard-search-status">
              <i className="fas fa-spinner fa-spin"></i> Loading…
            </div>
          ) : loadError ? (
            <div className="dashboard-search-status dashboard-search-status--error">
              {loadError}
            </div>
          ) : !hasResults ? (
            <div className="dashboard-search-status">
              No teachers, students, or parents found for "{query}".
            </div>
          ) : (
            <>
              {matchedTeachers.length > 0 && (
                <TeacherSearchResults results={matchedTeachers} />
              )}
              {matchedStudents.length > 0 && (
                <StudentSearchResults results={matchedStudents} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TeacherSearchResults({ results }) {
  return (
    <div className="dashboard-search-section">
      <div className="dashboard-search-section-title">
        <i className="fas fa-chalkboard-teacher"></i> Teachers ({results.length}
        )
      </div>
      <div className="archive-table-wrap">
        <table className="archive-table">
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Employee ID</th>
              <th>Teacher Account</th>
              <th>Account Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ teacher, teacherUser }) => (
              <tr key={teacher.id}>
                <td>
                  <div className="archive-name">
                    <div className="archive-avatar teacher">
                      {teacher.lname?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className="archive-fullname">
                        {fullTeacherName(teacher)}
                      </span>
                      <span className="archive-sub">
                        {teacher.contact || "No contact"}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="archive-mono">{teacher.empId || "—"}</td>
                <td>
                  {teacherUser ? (
                    <div className="archive-account-info">
                      <i className="fas fa-user-circle"></i>
                      <span>{teacherUser.username}</span>
                    </div>
                  ) : (
                    <span className="archive-no-account">No account</span>
                  )}
                </td>
                <td>
                  <span
                    className={`archive-status-badge ${(teacherUser?.status || "none").toLowerCase()}`}
                  >
                    {teacherUser?.status || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StudentSearchResults({ results }) {
  return (
    <div className="dashboard-search-section">
      <div className="dashboard-search-section-title">
        <i className="fas fa-user-graduate"></i> Students &amp; Parents (
        {results.length})
      </div>
      <div className="archive-table-wrap">
        <table className="archive-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>LRN</th>
              <th>Parent</th>
              <th>Parent Account</th>
              <th>Account</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ student, parentUser, enrollment }) => (
              <tr key={student.id}>
                <td>
                  <div className="archive-name">
                    <div className="archive-avatar student">
                      {student.lastName?.charAt(0).toUpperCase()}
                    </div>
                    <span className="archive-fullname">
                      {fullStudentName(student)}
                    </span>
                  </div>
                </td>
                <td className="archive-mono">{student.lrn || "—"}</td>
                <td>{student.guardian || "—"}</td>
                <td>
                  {parentUser ? (
                    <div className="archive-account-info">
                      <i className="fas fa-user-circle"></i>
                      <span>{parentUser.username}</span>
                    </div>
                  ) : (
                    <span className="archive-no-account">No account</span>
                  )}
                </td>
                <td>
                  <span
                    className={`archive-status-badge ${(parentUser?.status || "none").toLowerCase()}`}
                  >
                    {parentUser?.status || "—"}
                  </span>
                </td>
                <td>
                  {enrollment ? (
                    <span
                      className={`dashboard-search-enroll-badge ${
                        enrollment.status === "Enrolled"
                          ? "enrolled"
                          : "dropped"
                      }`}
                    >
                      {enrollment.status === "Enrolled"
                        ? "Enrolled"
                        : "Dropped"}{" "}
                      — Grade {enrollment.grade}
                      {enrollment.section ? `-${enrollment.section}` : ""}
                    </span>
                  ) : (
                    <span className="archive-no-account">Not enrolled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MINI CALENDAR
// ════════════════════════════════════════════════════════════════════════════

function MiniCalendar() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [schoolYears, setSchoolYears] = useState([]);
  const [selectedSyId, setSelectedSyId] = useState("");
  const [syLoading, setSyLoading] = useState(true);
  const [showAllHolidays, setShowAllHolidays] = useState(false);

  const [showAddYear, setShowAddYear] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [importHolidays, setImportHolidays] = useState(true);
  const [savingYear, setSavingYear] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [addYearError, setAddYearError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSyLoading(true);
    getSchoolYears()
      .then((years) => {
        if (cancelled) return;
        setSchoolYears(years);
        const active = years.find((y) => y.isActive);
        setSelectedSyId(active ? active.id : years[0]?.id || "");
      })
      .catch((e) => console.error("Failed to load school years:", e))
      .finally(() => {
        if (!cancelled) setSyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedSchoolYear =
    schoolYears.find((y) => y.id === selectedSyId) || null;
  const holidays = selectedSchoolYear?.holidays || [];
  const holidayMap = new Map(holidays.map((h) => [h.date, h.name]));

  const HOLIDAY_PREVIEW_COUNT = 4;
  const previewHolidays = holidays.slice(0, HOLIDAY_PREVIEW_COUNT);
  const hasMoreHolidays = holidays.length > HOLIDAY_PREVIEW_COUNT;

  const jumpToHoliday = (dateStr) => {
    const d = new Date(`${dateStr}T00:00:00`);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setShowAllHolidays(false);
  };

  const handleAddSchoolYear = async (e) => {
    e.preventDefault();
    setAddYearError("");

    if (!newLabel.trim() || !newStart || !newEnd) {
      setAddYearError("Please fill in the label and both dates.");
      return;
    }
    if (newStart > newEnd) {
      setAddYearError("Start date must be before the end date.");
      return;
    }

    setSavingYear(true);
    setImportNotice("");
    try {
      const created = await addSchoolYear({
        label: newLabel.trim(),
        startDate: newStart,
        endDate: newEnd,
      });

      const shouldActivate = !schoolYears.some((y) => y.isActive);
      if (shouldActivate) {
        await setActiveSchoolYear(created.id);
      }

      if (importHolidays) {
        const result = await importPublicHolidaysForSchoolYear(
          created.id,
          newStart,
          newEnd,
        );
        setImportNotice(
          result.imported > 0
            ? `Imported ${result.imported} public holiday${result.imported === 1 ? "" : "s"} from date.nager.at.`
            : "No public holidays found for that date range.",
        );
      }

      const years = await getSchoolYears();
      setSchoolYears(years);
      setSelectedSyId(created.id);

      setNewLabel("");
      setNewStart("");
      setNewEnd("");
      setShowAddYear(false);
    } catch (err) {
      setAddYearError(err.message || "Failed to add school year.");
    } finally {
      setSavingYear(false);
    }
  };

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const pad = (n) => String(n).padStart(2, "0");
  const cellDateKey = (d) => `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isToday = (d) =>
    d === today.getDate() &&
    viewMonth === today.getMonth() &&
    viewYear === today.getFullYear();

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  return (
    <div className="mini-calendar-card">
      <div className="mini-calendar-header">
        <div className="mini-calendar-title">
          <i className="fas fa-calendar-alt"></i>
          <span>Calendar</span>
        </div>

        <div className="mini-calendar-sy-picker">
          {syLoading ? (
            <span className="mini-calendar-sy-loading">Loading…</span>
          ) : schoolYears.length === 0 ? (
            <span className="mini-calendar-sy-empty">No school years yet</span>
          ) : (
            <select
              className="mini-calendar-sy-select"
              value={selectedSyId}
              onChange={(e) => setSelectedSyId(e.target.value)}
              title="View holidays for a school year"
            >
              {schoolYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                  {y.isActive ? " (Active)" : ""}
                </option>
              ))}
            </select>
          )}
          {!syLoading && (
            <button
              type="button"
              className="mini-calendar-sy-add"
              onClick={() => setShowAddYear(true)}
              title="Add a school year"
              aria-label="Add a school year"
            >
              <i className="fas fa-plus"></i>
            </button>
          )}
        </div>
      </div>

      {holidays.length > 0 && (
        <div className="mini-calendar-legend">
          <span className="mini-calendar-legend-dot"></span> Holiday
        </div>
      )}

      <div className="mini-calendar-nav">
        <button onClick={goPrev} aria-label="Previous month">
          <i className="fas fa-chevron-left"></i>
        </button>
        <span className="mini-calendar-month-label">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </span>
        <button onClick={goNext} aria-label="Next month">
          <i className="fas fa-chevron-right"></i>
        </button>
      </div>

      <div className="mini-calendar-weekdays">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="mini-calendar-grid">
        {cells.map((d, i) => {
          if (d === null) {
            return (
              <span
                key={`blank-${i}`}
                className="mini-calendar-cell mini-calendar-cell--empty"
              />
            );
          }
          const dateKey = cellDateKey(d);
          const holidayName = holidayMap.get(dateKey);
          const classes = [
            "mini-calendar-cell",
            isToday(d) ? "mini-calendar-cell--today" : "",
            holidayName ? "mini-calendar-cell--holiday" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <span key={d} className={classes} title={holidayName || undefined}>
              {d}
            </span>
          );
        })}
      </div>

      {holidays.length > 0 && (
        <div className="mini-calendar-holiday-list">
          <div className="mini-calendar-holiday-list-title">
            Holidays — {selectedSchoolYear?.label}
          </div>
          {previewHolidays.map((h) => (
            <button
              key={h.date}
              className="mini-calendar-holiday-item"
              onClick={() => jumpToHoliday(h.date)}
            >
              <span className="mini-calendar-holiday-date">
                {formatHolidayDate(h.date)}
              </span>
              <span className="mini-calendar-holiday-name">{h.name}</span>
            </button>
          ))}
          {hasMoreHolidays && (
            <button
              className="mini-calendar-holiday-seeall"
              onClick={() => setShowAllHolidays(true)}
            >
              See all holidays ({holidays.length})
            </button>
          )}
        </div>
      )}

      {showAllHolidays && (
        <div
          className="modal-overlay-admin"
          onClick={() => setShowAllHolidays(false)}
        >
          <div
            className="modal-admin holiday-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>All Holidays</h2>
              <button
                className="holiday-modal-close"
                onClick={() => setShowAllHolidays(false)}
                aria-label="Close"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <p className="holiday-modal-subtitle">
              {selectedSchoolYear?.label}
            </p>
            <div className="holiday-modal-list">
              {holidays.map((h) => (
                <button
                  key={h.date}
                  className="mini-calendar-holiday-item"
                  onClick={() => jumpToHoliday(h.date)}
                >
                  <span className="mini-calendar-holiday-date">
                    {formatHolidayDate(h.date)}
                  </span>
                  <span className="mini-calendar-holiday-name">{h.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAddYear && (
        <div
          className="modal-overlay-admin"
          onClick={() => !savingYear && setShowAddYear(false)}
        >
          <div
            className="modal-admin holiday-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>Add School Year</h2>
              <button
                className="holiday-modal-close"
                onClick={() => setShowAddYear(false)}
                aria-label="Close"
                disabled={savingYear}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <p className="holiday-modal-subtitle">
              Set the school year's date range, then optionally pull Philippine
              public holidays for it automatically.
            </p>

            <form className="sy-form" onSubmit={handleAddSchoolYear}>
              <label className="sy-form-field">
                <span>Label</span>
                <input
                  type="text"
                  placeholder="2026-2027"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  disabled={savingYear}
                />
              </label>

              <div className="sy-form-row">
                <label className="sy-form-field">
                  <span>Start date</span>
                  <input
                    type="date"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    disabled={savingYear}
                  />
                </label>
                <label className="sy-form-field">
                  <span>End date</span>
                  <input
                    type="date"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    disabled={savingYear}
                  />
                </label>
              </div>

              <label className="sy-form-checkbox">
                <input
                  type="checkbox"
                  checked={importHolidays}
                  onChange={(e) => setImportHolidays(e.target.checked)}
                  disabled={savingYear}
                />
                <span>
                  Import Philippine public holidays for this range (New Year,
                  Independence Day, Christmas, etc.)
                </span>
              </label>

              {addYearError && <p className="sy-form-error">{addYearError}</p>}
              {importNotice && <p className="sy-form-notice">{importNotice}</p>}

              <div className="sy-form-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowAddYear(false)}
                  disabled={savingYear}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-confirm"
                  disabled={savingYear}
                >
                  {savingYear ? "Saving…" : "Save school year"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ENROLLMENT / DROPOUT CHART  — react-chartjs-2 grouped bar chart,
// matching the teacher dashboard's style.
// ════════════════════════════════════════════════════════════════════════════

function EnrollmentDropoutChart({ data, loading, onDataFixed }) {
  const [backfilling, setBackfilling] = useState(false);

  const hasUnknown = data.some(
    (d) => d.year === "Unknown" && (d.enrolled > 0 || d.dropped > 0),
  );

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      await backfillEnrollmentTimestamps();
      if (onDataFixed) await onDataFixed();
    } catch (e) {
      console.error("Backfill failed:", e);
    } finally {
      setBackfilling(false);
    }
  };

  const chartData = {
    labels: data.map((d) => d.year),
    datasets: [
      {
        label: "Enrolled",
        data: data.map((d) => d.enrolled),
        backgroundColor: "#378ADD",
        borderRadius: 4,
        barPercentage: 0.65,
        categoryPercentage: 0.8,
      },
      {
        label: "Dropped",
        data: data.map((d) => d.dropped),
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

  const canvasHeight = Math.max(220, data.length * 55 + 80);

  return (
    <div className="enrollment-chart-card">
      <div className="enrollment-chart-header">
        <div>
          <h3>Enrollment &amp; Dropout</h3>
        </div>
        <div className="enrollment-chart-legend">
          <span className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: "#378ADD" }}
            ></span>{" "}
            Enrolled
          </span>
          <span className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: "#E24B4A" }}
            ></span>{" "}
            Dropped
          </span>
        </div>
      </div>

      {!loading && hasUnknown && (
        <div className="enrollment-chart-unknown-notice">
          <i className="fas fa-exclamation-triangle"></i>
          Some records are missing enrollment dates and are grouped under
          "Unknown".
          <button onClick={handleBackfill} disabled={backfilling}>
            {backfilling ? "Fixing…" : "Fix missing dates"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="enrollment-chart-empty">Loading…</div>
      ) : data.length === 0 ? (
        <div className="enrollment-chart-empty">
          No enrollment history yet. Data will appear here once students are
          enrolled or dropped from a section.
        </div>
      ) : (
        <>
          <div
            className="enrollment-chart-canvas-wrap"
            style={{ height: canvasHeight }}
          >
            <Bar data={chartData} options={chartOptions} />
          </div>
        </>
      )}
    </div>
  );
}

export default AdminHomepage;

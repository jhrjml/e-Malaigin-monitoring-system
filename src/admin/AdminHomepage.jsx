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
  getGradeSectionDistribution,
  getSchoolYears,
  addSchoolYear,
  setActiveSchoolYear,
  importPublicHolidaysForSchoolYear,
  backfillEnrollmentTimestamps,
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

// Palette cycled through for each distinct SECTION NAME in the grade/section
// stacked bar chart — sections are sorted alphabetically once, then each
// gets a fixed color from this list, so e.g. "Rizal" is always the same
// blue in every grade's bar and the legend stays consistent.
const STACK_COLORS = [
  { bg: "#186FAF", text: "#ffffff" },
  { bg: "#A8C8EA", text: "#1a3a55" },
  { bg: "#378ADD", text: "#ffffff" },
  { bg: "#E24B4A", text: "#ffffff" },
  { bg: "#f1c40f", text: "#5c4a00" },
  { bg: "#2ecc71", text: "#0d3d21" },
  { bg: "#9b59b6", text: "#ffffff" },
  { bg: "#e67e22", text: "#ffffff" },
];

/**
 * stackValueLabelsPlugin
 * A Chart.js plugin (scoped to just the grade/section chart via the
 * `plugins` prop, not globally registered) that draws:
 *   1. The raw count centered inside each stacked segment.
 *   2. A "Total: N" label above the topmost segment of each bar.
 * Segment counts under ~14px tall are skipped so the number never
 * overflows a sliver-thin segment.
 */
const stackValueLabelsPlugin = {
  id: "stackValueLabels",
  afterDatasetsDraw(chart) {
    const { ctx, data } = chart;

    data.datasets.forEach((dataset, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      meta.data.forEach((bar, i) => {
        const value = dataset.data[i];
        if (!value) return;
        const height = Math.abs(bar.base - bar.y);
        if (height < 14) return;
        ctx.save();
        ctx.fillStyle = dataset.textColor || "#fff";
        ctx.font = "600 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(value), bar.x, (bar.y + bar.base) / 2);
        ctx.restore();
      });
    });

    for (let i = 0; i < data.labels.length; i++) {
      let topY = Infinity;
      let anchorX = null;
      let total = 0;
      data.datasets.forEach((dataset, dsIndex) => {
        const meta = chart.getDatasetMeta(dsIndex);
        const bar = meta.data[i];
        const value = dataset.data[i];
        if (!bar || !value) return;
        total += value;
        if (bar.y < topY) {
          topY = bar.y;
          anchorX = bar.x;
        }
      });
      if (anchorX === null) continue;
      ctx.save();
      ctx.fillStyle = "#4a4a4a";
      ctx.font = "600 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`Total: ${total}`, anchorX, topY - 12);
      ctx.restore();
    }
  },
};

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
  const [gradeSectionStats, setGradeSectionStats] = useState([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const loadDashboardData = useCallback(() => {
    setDashboardLoading(true);
    return Promise.all([
      getDashboardStats(),
      getEnrollmentDropoutStats(),
      getGradeSectionDistribution(),
    ])
      .then(([stats, enrollment, gradeSection]) => {
        setDashboardStats(stats);
        setEnrollmentStats(enrollment);
        setGradeSectionStats(gradeSection);
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
              gradeSection={gradeSectionStats}
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
            <div className="modal-admin logout-modal-admin">
              <div className="modal-header-admin">
                <h2>Confirm Logout</h2>
              </div>
              <p>Are you sure you want to logout?</p>
              <div className="modal-buttons-admin">
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

function DashboardOverview({
  stats,
  enrollment,
  gradeSection,
  loading,
  onRefresh,
}) {
  return (
    <div className="overview-grid">
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

          <div className="charts-row">
            <EnrollmentDropoutChart
              data={enrollment}
              loading={loading}
              onDataFixed={onRefresh}
            />
            <GradeSectionStackedChart data={gradeSection} loading={loading} />
          </div>
        </div>

        <MiniCalendar />
      </div>
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
          <div className="enrollment-chart-canvas-wrap">
            <Bar data={chartData} options={chartOptions} />
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// GRADE / SECTION STACKED BAR CHART — one bar per grade level (1–6), stacked
// by section, with the count printed inside each segment and the grade's
// total printed above the bar. Sits beside the Enrollment & Dropout chart.
// ════════════════════════════════════════════════════════════════════════════

const GRADE_LEVELS = [1, 2, 3, 4, 5, 6];

function GradeSectionStackedChart({ data, loading }) {
  const hasData = data.length > 0;

  // Look up count for a given grade + section, 0 if that section doesn't
  // exist for that grade.
  const countsByGradeSection = {};
  data.forEach((d) => {
    countsByGradeSection[`${d.grade}|${d.section}`] = d.count;
  });

  // Every distinct section name across the whole school, sorted so the
  // color assigned to a section is always the same no matter which grade
  // it appears in — this is what makes the legend meaningful: "Rizal" is
  // always the same blue everywhere on the chart, in every grade's bar.
  const sectionNames = [...new Set(data.map((d) => d.section))].sort();

  // One dataset PER SECTION NAME (not per stacking "slot"). Each dataset
  // holds that section's count for every grade level (0 where the section
  // doesn't exist in that grade), which is what lets Chart.js draw a
  // correct, real legend using dataset.label.
  const datasets = sectionNames.map((section, i) => {
    const palette = STACK_COLORS[i % STACK_COLORS.length];
    return {
      label: section,
      data: GRADE_LEVELS.map(
        (g) => countsByGradeSection[`${g}|${section}`] || 0,
      ),
      backgroundColor: palette.bg,
      textColor: palette.text,
      borderRadius: 4,
      // Wider bars + wider category slots than before (was 0.55 / 0.7,
      // which is what made the bars look razor-thin) — the chart now
      // matches roughly a 60px+ bar width in a normal 280px-tall card.
      barPercentage: 0.75,
      categoryPercentage: 0.85,
    };
  });

  const chartData = {
    labels: GRADE_LEVELS.map((g) => `Grade ${g}`),
    datasets,
  };

  // Round the y-axis max up to a friendly step above the tallest total, so
  // gridlines land on clean numbers instead of Chart.js picking something
  // like "37".
  const totals = GRADE_LEVELS.map((g) =>
    sectionNames.reduce(
      (sum, s) => sum + (countsByGradeSection[`${g}|${s}`] || 0),
      0,
    ),
  );
  const maxTotal = Math.max(0, ...totals);
  const step =
    maxTotal <= 10 ? 2 : maxTotal <= 20 ? 5 : maxTotal <= 60 ? 10 : 20;
  const suggestedMax = Math.ceil((maxTotal + 1) / step) * step;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 18 } },
    plugins: {
      legend: {
        display: true,
        position: "top",
        align: "end",
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          pointStyle: "rectRounded",
          font: { size: 11, weight: 600 },
          color: "#555",
          padding: 10,
        },
      },
      tooltip: {
        filter: (item) => item.raw > 0,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        title: {
          display: true,
          text: "Grade Level",
          font: { size: 12, weight: 600 },
          color: "#666",
          padding: { top: 8 },
        },
        grid: { display: false },
        border: { display: false },
        ticks: { font: { size: 11 }, color: "#888" },
      },
      y: {
        stacked: true,
        display: true,
        beginAtZero: true,
        suggestedMax,
        title: {
          display: true,
          text: "Number of Students",
          font: { size: 12, weight: 600 },
          color: "#666",
        },
        border: { display: false },
        grid: { color: "rgba(0,0,0,0.06)" },
        ticks: {
          font: { size: 11 },
          color: "#888",
          stepSize: step,
          precision: 0,
        },
      },
    },
  };

  return (
    <div className="gs-chart-card">
      <div className="gs-chart-header">
        <h3>Students by Grade &amp; Section</h3>
      </div>

      {loading ? (
        <div className="gs-chart-empty">Loading…</div>
      ) : !hasData ? (
        <div className="gs-chart-empty">
          No enrolled students yet. Data will appear here once students are
          enrolled into a section.
        </div>
      ) : (
        <div className="gs-chart-canvas-wrap">
          <Bar
            data={chartData}
            options={chartOptions}
            plugins={[stackValueLabelsPlugin]}
          />
        </div>
      )}
    </div>
  );
}

export default AdminHomepage;

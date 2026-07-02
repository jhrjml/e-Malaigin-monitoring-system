// Repository.jsx  (Firebase version)
import { useState, useEffect } from "react";
import { db } from "../api/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./Repository.css";

const col = (name) => collection(db, name);

// DepEd-style single/double-letter day labels — JS getDay(): 0=Sun ... 4=Thu
// School week here runs Sunday–Thursday (Friday–Saturday weekend)
const WEEKDAY_LETTER = { 0: "S", 1: "M", 2: "T", 3: "W", 4: "TH" };

function Repository() {
  // "load" = combined Grade-Section-Subject picker, "month" = month picker,
  // "list" = the day-by-day P/A matrix for the chosen month
  const [currentView, setCurrentView] = useState("load");

  const [repoGrade, setRepoGrade] = useState(null);
  const [repoSection, setRepoSection] = useState("");
  const [repoSubject, setRepoSubject] = useState("");
  const [repoMonth, setRepoMonth] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [availableMonths, setAvailableMonths] = useState([]);
  const [teacherLoads, setTeacherLoads] = useState([]);

  // Matrix data for the "list" view: rows = students, columns = days
  const [monthStudents, setMonthStudents] = useState([]);
  const [monthDays, setMonthDays] = useState([]);
  const [monthMatrix, setMonthMatrix] = useState({});

  const [loading, setLoading] = useState(false);

  // ── load this teacher's assigned schedules ────────────────────────────
  // localStorage "userId" = User document ID.
  // Schedule stores "teacherId" = Teacher document ID.
  // Must resolve User → teacherId first, then query Schedule.
  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) return;

    setLoading(true);
    const load = async () => {
      try {
        const userSnap = await getDoc(doc(db, "User", userId));
        if (!userSnap.exists()) return;

        const teacherDocId = userSnap.data().teacherId;
        if (!teacherDocId) return;

        const snap = await getDocs(
          query(col("Schedule"), where("teacherId", "==", teacherDocId)),
        );
        setTeacherLoads(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        console.error("Failed to load schedules:", e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // ── derived navigation options ────────────────────────────────────────
  // One card per unique Grade + Section + Subject combination, so the
  // teacher only has to pick once instead of drilling through three grids.
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

  // ── handlers ─────────────────────────────────────────────────────────
  const selectLoad = async (load) => {
    setRepoGrade(load.grade);
    setRepoSection(load.section);
    setRepoSubject(load.subject);
    setSearchQuery("");
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          col("Attendance"),
          where("grade", "==", load.grade),
          where("section", "==", load.section),
          where("subject", "==", load.subject),
        ),
      );
      const logs = snap.docs.map((d) => d.data());

      const months = [...new Set(logs.map((l) => l.date.substring(0, 7)))]
        .map((m) => ({
          id: m,
          name: new Date(m + "-01").toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          }),
        }))
        .sort((a, b) => b.id.localeCompare(a.id));

      setAvailableMonths(months);
      setCurrentView("month");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const selectMonth = async (monthId) => {
    setRepoMonth(monthId);
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          col("Attendance"),
          where("grade", "==", repoGrade),
          where("section", "==", repoSection),
          where("subject", "==", repoSubject),
        ),
      );
      const logs = snap.docs
        .map((d) => d.data())
        .filter((l) => l.date.startsWith(monthId));

      // Rows: every student that has at least one record this month
      const students = [...new Set(logs.map((l) => l.name))].sort();

      // Columns: school days only (Sun–Thu), each tagged with its
      // DepEd-style day letter — S, M, T, W, TH
      const [year, month] = monthId.split("-").map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        if (dow >= 0 && dow <= 4) {
          days.push({ day: d, letter: WEEKDAY_LETTER[dow] });
        }
      }

      // name -> { day -> "Present" | "Absent" }
      const matrix = {};
      students.forEach((name) => (matrix[name] = {}));
      logs.forEach((l) => {
        const day = Number(l.date.split("-")[2]);
        matrix[l.name][day] = l.status;
      });

      setMonthStudents(students);
      setMonthDays(days);
      setMonthMatrix(matrix);
      setCurrentView("list");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const displayedMonths = availableMonths.filter((m) =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedMonthLabel =
    availableMonths.find((m) => m.id === repoMonth)?.name || repoMonth;

  // ── PDF export ───────────────────────────────────────────────────────
  const downloadPdf = () => {
    const docPdf = new jsPDF({ orientation: "landscape", unit: "pt" });

    docPdf.setFontSize(13);
    docPdf.text(
      `Attendance — ${repoSubject} (Grade ${repoGrade} - ${repoSection})`,
      40,
      35,
    );

    const head = [
      [
        { content: "#", rowSpan: 2 },
        {
          content: "LEARNER'S NAME\n(Last Name, First Name, Middle Name)",
          rowSpan: 2,
          styles: { halign: "left" },
        },
        {
          content: `${selectedMonthLabel} — Daily Attendance`,
          colSpan: monthDays.length,
        },
      ],
      monthDays.map((d) => ({ content: `${d.day}\n${d.letter}` })),
    ];

    const body = monthStudents.map((name, idx) => [
      idx + 1,
      name,
      ...monthDays.map((d) => {
        const status = monthMatrix[name]?.[d.day];
        if (status === "Absent") return "A";
        if (status === "Present") return "P";
        return "";
      }),
    ]);

    autoTable(docPdf, {
      head,
      body,
      startY: 50,
      styles: {
        fontSize: 7,
        halign: "center",
        cellPadding: 3,
        lineColor: [0, 0, 0],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [241, 241, 241],
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.5,
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
      },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { halign: "left", cellWidth: 160 },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index > 1) {
          if (data.cell.raw === "A") {
            data.cell.styles.textColor = [200, 0, 0];
            data.cell.styles.fontStyle = "bold";
          } else if (data.cell.raw === "P") {
            data.cell.styles.textColor = [0, 0, 0];
            data.cell.styles.fontStyle = "bold";
          }
        }
      },
    });

    docPdf.save(
      `Attendance_${repoSubject}_G${repoGrade}-${repoSection}_${repoMonth}.pdf`,
    );
  };

  return (
    <div className="teacher-dashboard">
      <main className="main-content">
        <div className="page-container">
          {loading && (
            <p style={{ padding: "10px", color: "#a65f81" }}>Loading…</p>
          )}

          {currentView === "load" && (
            <div className="view-section active">
              <div className="toolbar-rep">
                <h2 className="section-title-rep">
                  Select Grade - Section - Subject
                </h2>
              </div>
              {loadOptions.length === 0 && !loading ? (
                <p
                  style={{
                    padding: "20px",
                    textAlign: "center",
                    color: "#999",
                  }}
                >
                  No classes assigned yet.
                </p>
              ) : (
                <div className="grid-container-rep">
                  {loadOptions.map((l) => (
                    <div
                      key={`${l.grade}|${l.section}|${l.subject}`}
                      className="card-link-rep"
                      onClick={() => selectLoad(l)}
                    >
                      <div className="icon-box bg-blue">
                        <i className="fas fa-book"></i>
                      </div>
                      <h3>
                        Grade {l.grade} - {l.section}
                      </h3>
                      <p>{l.subject}</p>
                      {/* ⏰ Added Schedule Time Block */}
                      {l.start && l.end && (
                        <span className="rep-card-time">
                          <i className="fas fa-clock"></i> {l.start} – {l.end}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentView === "month" && (
            <div className="view-section">
              <div
                className="toolbar-rep"
                style={{ flexWrap: "wrap", gap: "10px" }}
              >
                <button
                  className="btn-back-rep"
                  onClick={() => setCurrentView("load")}
                >
                  <i className="fas fa-arrow-left"></i>
                </button>
                <div>
                  <h3>
                    {repoSubject} (G{repoGrade}-{repoSection})
                  </h3>
                  <small style={{ color: "var(--gray)" }}>
                    Select a month to view logs
                  </small>
                </div>
                <div className="search-box" style={{ marginLeft: "auto" }}>
                  <input
                    type="text"
                    placeholder="Search month..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <i className="fas fa-search"></i>
                </div>
              </div>
              <div className="grid-container-rep">
                {displayedMonths.length === 0 ? (
                  <div
                    style={{
                      gridColumn: "1/-1",
                      textAlign: "center",
                      color: "#999",
                      padding: "20px",
                    }}
                  >
                    No attendance records found.
                  </div>
                ) : (
                  displayedMonths.map((m) => (
                    <div
                      key={m.id}
                      className="card-link-rep month-card"
                      onClick={() => selectMonth(m.id)}
                    >
                      <div
                        className="icon-box bg-blue"
                        style={{ fontSize: "1.5rem" }}
                      >
                        <i className="fas fa-calendar-alt"></i>
                      </div>
                      <h3>{m.name}</h3>
                      <p>View Logs</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {currentView === "list" && (
            <div className="view-section">
              <div
                className="toolbar-rep"
                style={{ flexWrap: "wrap", gap: "10px" }}
              >
                <button
                  className="btn-back-rep"
                  onClick={() => setCurrentView("month")}
                >
                  <i className="fas fa-arrow-left"></i>
                </button>
                <div>
                  <h3>{selectedMonthLabel} Attendance</h3>
                  <small style={{ color: "var(--gray)" }}>
                    {repoSubject} - Grade {repoGrade} Section {repoSection}
                  </small>
                </div>
                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  {monthStudents.length > 0 && (
                    <div className="matrix-legend">
                      <span className="status-mark present">P</span> Present
                      <span className="status-mark absent">A</span> Absent
                    </div>
                  )}
                  <button
                    className="btn-download"
                    onClick={downloadPdf}
                    disabled={monthStudents.length === 0}
                  >
                    <i className="fas fa-download"></i> Download PDF
                  </button>
                </div>
              </div>

              <div className="table-container matrix-container">
                <table className="data-table-rep matrix-table">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="sticky-col num-col">
                        #
                      </th>
                      <th rowSpan={2} className="sticky-col name-col">
                        LEARNER'S NAME
                        <br />
                        <span className="name-sub">
                          (Last Name, First Name, Middle Name)
                        </span>
                      </th>
                      <th colSpan={monthDays.length} className="group-label">
                        {selectedMonthLabel} — Daily Attendance
                      </th>
                    </tr>
                    <tr>
                      {monthDays.map((d) => (
                        <th key={d.day} className="day-col">
                          <span className="day-num">{d.day}</span>
                          <span className="day-letter">{d.letter}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthStudents.length === 0 ? (
                      <tr>
                        <td
                          colSpan={monthDays.length + 2}
                          style={{ textAlign: "center", padding: "20px" }}
                        >
                          No records for this month.
                        </td>
                      </tr>
                    ) : (
                      monthStudents.map((name, idx) => (
                        <tr key={name}>
                          <td className="sticky-col num-col">{idx + 1}</td>
                          <td className="sticky-col name-col">
                            <span className="learner-name">{name}</span>
                          </td>
                          {monthDays.map((d) => {
                            const status = monthMatrix[name]?.[d.day];
                            const mark =
                              status === "Absent"
                                ? "A"
                                : status === "Present"
                                  ? "P"
                                  : "";
                            return (
                              <td key={d.day} className="day-col">
                                {mark && (
                                  <span
                                    className={
                                      "status-mark " +
                                      (mark === "A" ? "absent" : "present")
                                    }
                                  >
                                    {mark}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default Repository;

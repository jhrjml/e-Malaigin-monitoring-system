// ClassworkReminding.jsx
import { useState, useEffect, useMemo } from "react";
import { db } from "../api/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  getDoc,
} from "firebase/firestore";
import {
  queueNotification,
  getParentIdsForStudents,
  getActiveSchoolYearLabel,
} from "../api/firebaseApi";
import useSubmitGuard from "../common/useSubmitGuard";
import useNetworkStatus from "../common/useNetworkStatus";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./ClassworkReminding.css";

const col = (name) => collection(db, name);
const CW_TYPES = ["Assignment", "Oral", "Project", "Quiz", "Exam", "Announcement"];
const TYPE_META = {
  Assignment: { icon: "fa-pencil-alt", cls: "cwr-blue" },
  Oral: { icon: "fa-microphone", cls: "cwr-green" },
  Project: { icon: "fa-project-diagram", cls: "cwr-purple" },
  Quiz: { icon: "fa-question-circle", cls: "cwr-orange" },
  Exam: { icon: "fa-file-alt", cls: "cwr-red" },
  Announcement: { icon: "fa-bullhorn", cls: "cwr-teal" },
};

// Sorts classwork/announcement entries with the most recently POSTED item
// first, using the `createdAt` timestamp stamped when the entry was
// created. Falls back to the due-date field for any legacy entries that
// predate `createdAt` being stamped.
const sortMostRecentFirst = (a, b) => {
  const ca = a.createdAt || "";
  const cb = b.createdAt || "";
  if (ca && cb) return cb.localeCompare(ca);
  if (ca && !cb) return -1;
  if (!ca && cb) return 1;
  return (b.date || "").localeCompare(a.date || "");
};

// ── Convert a Firestore Timestamp / ISO string / Date → JS Date (or null) ──
const toJsDate = (val) => {
  if (!val) return null;
  if (typeof val?.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

// ── "Edited …" label — shows both the date and time the post was last
// edited, e.g. "Edited Jul 9, 10:54 AM" (adds the year only if it isn't
// the current year, e.g. "Edited Jul 9, 2025, 10:54 AM").
const formatEditedLabel = (editedAt) => {
  const date = toJsDate(editedAt);
  if (!date) return null;

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();

  const datePart = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return `Edited ${datePart}, ${timePart}`;
};

function ClassworkReminding({ focusClasswork, onFocusConsumed }) {
  const [currentView, setCurrentView] = useState("load");
  const [classGrade, setClassGrade] = useState(null);
  const [classSection, setClassSection] = useState("");
  const [classSubject, setClassSubject] = useState("");

  const [teacherLoads, setTeacherLoads] = useState([]);
  const [students, setStudents] = useState([]);
  const [classworks, setClassworks] = useState([]);
  const [activeCW, setActiveCW] = useState(null);

  const [showModal, setShowModal] = useState(false);
  const [newCW, setNewCW] = useState({ title: "", desc: "", date: "" });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editCW, setEditCW] = useState({ id: null, title: "", desc: "", date: "" });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const guardSave = useSubmitGuard();

  // Intercept Dashboard Click Routing Targets
  useEffect(() => {
    if (focusClasswork) {
      setClassGrade(focusClasswork.grade);
      setClassSection(focusClasswork.section);
      setClassSubject(focusClasswork.subject);
      setActiveCW(focusClasswork);
      
      if (focusClasswork.title === "Announcement" || focusClasswork.isAnnouncement) {
        setCurrentView("announcement-view");
      } else {
        setCurrentView("grading");
      }
      
      if (onFocusConsumed) {
        onFocusConsumed();
      }
    }
  }, [focusClasswork, onFocusConsumed]);

  useEffect(() => {
    const handleTeacherSidebarClick = (e) => {
      const target = e.target.closest("li, button, div, span, a");
      if (target && target.textContent && target.textContent.includes("Classwork Reminder")) {
        setCurrentView("load"); setClassGrade(null); setClassSection(""); setClassSubject(""); setActiveCW(null);
      }
    };
    document.addEventListener("mousedown", handleTeacherSidebarClick);
    return () => document.removeEventListener("mousedown", handleTeacherSidebarClick);
  }, []);

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) { setError("Session expired."); setLoading(false); return; }
    getDoc(doc(db, "User", userId)).then((snap) => {
      if (!snap.exists()) return;
      getDocs(query(col("Schedule"), where("teacherId", "==", snap.data().teacherId)))
        .then((sSnap) => setTeacherLoads(sSnap.docs.map((d) => d.data())))
        .finally(() => setLoading(false));
    });
  }, []);

  useEffect(() => {
    if (!classGrade || !classSection) return;
    getDocs(query(col("Enrolled"), where("grade", "==", classGrade), where("section", "==", classSection), where("status", "==", "Enrolled")))
      .then(async (snap) => {
        const docs_ = await Promise.all(snap.docs.map((d) => getDoc(doc(db, "Student", d.data().studentId))));
        setStudents(docs_.filter((d) => d.exists()).map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => a.lastName.localeCompare(b.lastName)));
      });
  }, [classGrade, classSection]);

  const loadClassworks = async (grade, section, subject) => {
    const snap = await getDocs(query(col("Classwork"), where("grade", "==", grade), where("section", "==", section), where("subject", "==", subject)));
    setClassworks(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a,b) => b.date.localeCompare(a.date)));
  };

  useEffect(() => {
    if (classGrade && classSection && classSubject) loadClassworks(classGrade, classSection, classSubject);
  }, [classGrade, classSection, classSubject]);

  const handleSave = (e) => { e.preventDefault(); guardSave(() => {
    const ref = doc(col("Classwork"));
    const payload = { ...newCW, grade: classGrade, section: classSection, subject: classSubject, isAnnouncement: newCW.title === "Announcement", studentStatus: {}, createdAt: new Date().toISOString() };
    setDoc(ref, payload).then(() => loadClassworks(classGrade, classSection, classSubject));
    setShowModal(false); setNewCW({ title: "", desc: "", date: "" });
  });};

  const handleOpenEditModal = (cw) => {
    setEditCW({ id: cw.id, title: cw.title, desc: cw.desc, date: cw.date });
    setShowEditModal(true);
  };

  const handleUpdateCW = (e) => { e.preventDefault(); guardSave(() => {
    updateDoc(doc(db, "Classwork", editCW.id), {
      title: editCW.title,
      desc: editCW.desc,
      date: editCW.date,
      isAnnouncement: editCW.title === "Announcement"
    }).then(() => {
      loadClassworks(classGrade, classSection, classSubject);
      setShowEditModal(false);
    });
  });};

  const markStudent = async (studentId, status) => {
    const updatedStatus = { ...(activeCW.studentStatus || {}) };
    updatedStatus[studentId] = status;
    
    setActiveCW({ ...activeCW, studentStatus: updatedStatus });
    await updateDoc(doc(db, "Classwork", activeCW.id), { studentStatus: updatedStatus });
  };

  const clearStudentMark = async (studentId) => {
    const updatedStatus = { ...(activeCW.studentStatus || {}) };
    delete updatedStatus[studentId];
    
    setActiveCW({ ...activeCW, studentStatus: updatedStatus });
    await updateDoc(doc(db, "Classwork", activeCW.id), { studentStatus: updatedStatus });
  };

  const summaryStats = useMemo(() => {
    if (!activeCW) return { submitted: 0, missing: 0, notSet: 0 };
    const statusObj = activeCW.studentStatus || {};
    const submitted = Object.values(statusObj).filter(s => s === "Submitted").length;
    const missing = Object.values(statusObj).filter(s => s === "Missing").length;
    const notSet = students.length - submitted - missing;
    return { submitted, missing, notSet };
  }, [activeCW, students]);

  const loadOptions = useMemo(() => {
    return Object.values(
      teacherLoads.reduce((acc, l) => {
        const key = `${l.grade}|${l.section}|${l.subject}`;
        if (!acc[key]) {
          acc[key] = { grade: l.grade, section: l.section, subject: l.subject, start: l.start, end: l.end };
        }
        return acc;
      }, {})
    ).sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      return a.section.localeCompare(b.section);
    });
  }, [teacherLoads]);

  return (
    <div className="cwr-wrapper">
      <main className="cwr-main">
        <div className="cwr-container">
          {currentView === "load" && (
            <div className="cwr-view">
              <h2 className="cwr-page-title">Classwork Reminders</h2>
              <div className="cwr-grid">
                {loadOptions.map((l, i) => (
                  <div key={i} className="cwr-card" onClick={() => { setClassGrade(l.grade); setClassSection(l.section); setClassSubject(l.subject); setCurrentView("list"); }}>
                    <div className="cwr-icon-box cwr-bg-purple"><i className="fas fa-book-open"></i></div>
                    <h3>Grade {l.grade} - {l.section}</h3>
                    <p className="cwr-card-sub">{l.subject}</p>
                    {l.start && l.end && (
                      <p className="cwr-card-time">
                        <i className="far fa-clock"></i> {l.start} – {l.end}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentView === "list" && (
            <div className="cwr-view">
              <div className="cwr-toolbar">
                <button className="btn-back-cwr" onClick={() => setCurrentView("load")}><i className="fas fa-arrow-left"></i></button>
                <div className="cwr-title-block">
                  <h3>{classSubject} — Classwork &amp; Reminders</h3>
                  <small>Grade {classGrade} – Section {classSection}</small>
                </div>
                <button className="cwr-btn-add" onClick={() => setShowModal(true)}><i className="fas fa-plus"></i> Add</button>
              </div>
              
              <div className="cwr-list">
                {classworks.length === 0 ? (
                  <div className="cwr-empty-list">
                    <i className="fas fa-folder-open"></i>
                    <p>No classwork updates created for this class timeline ledger.</p>
                  </div>
                ) : (
                  classworks.map((cw) => {
                    const statusObj = cw.studentStatus || {};
                    const submittedCount = Object.values(statusObj).filter(s => s === "Submitted").length;
                    const missingCount = Object.values(statusObj).filter(s => s === "Missing").length;
                    const meta = TYPE_META[cw.title] || { icon: "fa-tasks", cls: "cwr-blue" };

                    return (
                      <div key={cw.id} className={`cwr-item ${cw.title === "Announcement" ? "cwr-item-ann" : ""}`}>
                        <div className={`cwr-item-icon ${meta.cls}`}>
                          <i className={`fas ${meta.icon}`}></i>
                        </div>
                        <div className="cwr-item-body">
                          <div className="cwr-item-top">
                            <span className={`cwr-type-badge ${meta.cls}`}>{cw.title}</span>
                            <span className="cwr-item-date"><i className="far fa-calendar-alt"></i> {cw.date}</span>
                          </div>
                          <p className="cwr-item-desc" style={{ fontSize: "1.05rem", fontWeight: "600", whiteSpace: "normal" }}>{cw.desc}</p>
                          
                          {cw.title === "Announcement" ? (
                            <div className="cwr-ann-note">
                              <i className="fas fa-info-circle"></i> Announcement — no submission tracking
                            </div>
                          ) : (
                            <div className="cwr-item-stats">
                              <span className="cwr-stat-sub"><i className="fas fa-check-circle"></i> {submittedCount} Submitted</span>
                              <span className="cwr-stat-miss"><i className="fas fa-times-circle"></i> {missingCount} Missed</span>
                            </div>
                          )}
                        </div>
                        <div className="cwr-item-actions">
                          <button 
                            className="cwr-btn-view" 
                            onClick={() => { 
                              setActiveCW(cw); 
                              setCurrentView(cw.title === "Announcement" ? "announcement-view" : "grading"); 
                            }}
                          >
                            {cw.title === "Announcement" ? "View" : "Remark"}
                          </button>
                          <button className="cwr-btn-edit-link" onClick={() => handleOpenEditModal(cw)}>
                            <i className="fas fa-pencil-alt"></i> <span className="cwr-edit-link-text">Edit Post</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {currentView === "announcement-view" && (
            <div className="cwr-view">
              <div className="cwr-toolbar">
                <button className="btn-back-cwr" onClick={() => setCurrentView("list")}><i className="fas fa-arrow-left"></i></button>
                <h3>Announcement Details</h3>
              </div>
              <div className="cwr-ann-card">
                <div className="cwr-ann-header">
                  <div className="cwr-ann-icon"><i className="fas fa-bullhorn"></i></div>
                  <div>
                    <div className="cwr-ann-date"><i className="far fa-calendar-alt"></i> Posted Window: {activeCW?.date}</div>
                    <span className="cwr-ann-tag">Announcement</span>
                  </div>
                </div>
                <p className="cwr-ann-body" style={{ color: "black" }}>{activeCW?.desc}</p>
              </div>
            </div>
          )}

          {currentView === "grading" && (
            <div className="cwr-view">
              <div className="cwr-toolbar">
                <button className="btn-back-cwr" onClick={() => setCurrentView("list")}><i className="fas fa-arrow-left"></i></button>
                <div className="cwr-title-block">
                  <h3>{activeCW?.title}</h3>
                  <small>{activeCW?.desc} • Due: {activeCW?.date} | Grade {classGrade} – {classSection}</small>
                </div>
                <button className="cwr-btn-edit-link cwr-btn-edit-link--inline" onClick={() => handleOpenEditModal(activeCW)}>
                  <i className="fas fa-pencil-alt"></i> <span className="cwr-edit-link-text">Edit</span>
                </button>
              </div>

              {/* Informational Tint Hint Bar */}
              <div className="cwr-grading-hint">
                <i className="fas fa-info-circle"></i> Tap a button to set each student's status. Marks are saved automatically.
              </div>

              <div className="cwr-table-wrap">
                <table className="cwr-table">
                  <thead>
                    <tr>
                      <th style={{ width: "60px", textAlign: "center" }}>#</th>
                      <th>Student Name</th>
                      <th style={{ width: "340px", textAlign: "center" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, idx) => {
                      const submissionStatus = activeCW.studentStatus?.[s.id];
                      let rowClass = "";
                      if (submissionStatus === "Submitted") rowClass = "cwr-row-submitted";
                      if (submissionStatus === "Missing") rowClass = "cwr-row-missing";

                      return (
                        <tr key={s.id} className={rowClass}>
                          <td style={{ textAlign: "center", color: "#888" }}>{idx + 1}</td>
                          <td className="cwr-td-name">{s.lastName}, {s.firstName} {s.middleName || ""}</td>
                          <td className="cwr-td-actions">
                            <button 
                              className={`cwr-toggle-btn ${submissionStatus === "Submitted" ? "cwr-toggle-sub" : ""}`} 
                              onClick={() => markStudent(s.id, "Submitted")}
                            >
                              <i className="fas fa-check"></i> Submitted
                            </button>
                            <button 
                              className={`cwr-toggle-btn ${submissionStatus === "Missing" ? "cwr-toggle-miss" : ""}`} 
                              onClick={() => markStudent(s.id, "Missing")}
                            >
                              <i className="fas fa-times"></i> Missed
                            </button>
                            {submissionStatus && (
                              <button 
                                className="cwr-toggle-btn cwr-toggle-clear"
                                onClick={() => clearStudentMark(s.id)}
                                title="Reset submission state row matrix log entries descriptor"
                              >
                                <i className="fas fa-undo"></i>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Live Statistics Summary Footer Tracker Bar */}
              <div className="cwr-grading-summary">
                <span className="cwr-gs-sub"><i className="fas fa-check-circle"></i> Submitted: {summaryStats.submitted}</span>
                <span className="cwr-gs-miss"><i className="fas fa-times-circle"></i> Missed: {summaryStats.missing}</span>
                <span className="cwr-gs-none"><i className="fas fa-dot-circle"></i> Not set: {summaryStats.notSet}</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* CREATE MODAL */}
      {showModal && (
        <div className="cwr-overlay">
          <div className="cwr-modal">
            <div className="cwr-modal-header">
              <h3><i className="fas fa-plus-circle"></i> Create Post Update</h3>
              <button className="cwr-modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleSave}>
              <div className="cwr-modal-body">
                <div className="cwr-form-group">
                  <label>Type</label>
                  <select value={newCW.title} onChange={(e) => setNewCW({ ...newCW, title: e.target.value })} required>
                    <option value="">Select type...</option>
                    {CW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="cwr-form-group">
                  <label>Details</label>
                  <textarea rows="4" value={newCW.desc} onChange={(e) => setNewCW({ ...newCW, desc: e.target.value })} required />
                </div>
                <div className="cwr-form-group">
                  <label>Due Date</label>
                  <input type="date" value={newCW.date} onChange={(e) => setNewCW({ ...newCW, date: e.target.value })} required />
                </div>
              </div>
              <div className="cwr-modal-footer">
                <button type="button" className="cwr-btn-cancel" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="cwr-btn-save">Post Template</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {showEditModal && (
        <div className="cwr-overlay">
          <div className="cwr-modal">
            <div className="cwr-modal-header">
              <h3><i className="fas fa-edit"></i> Edit Post Update</h3>
              <button className="cwr-modal-close" onClick={() => setShowEditModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleUpdateCW}>
              <div className="cwr-modal-body">
                <div className="cwr-form-group">
                  <label>Type</label>
                  <select value={editCW.title} onChange={(e) => setEditCW({ ...editCW, title: e.target.value })} required>
                    {CW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="cwr-form-group">
                  <label>Details</label>
                  <textarea rows="4" value={editCW.desc} onChange={(e) => setEditCW({ ...editCW, desc: e.target.value })} required />
                </div>
                <div className="cwr-form-group">
                  <label>Due Date</label>
                  <input type="date" value={editCW.date} onChange={(e) => setEditCW({ ...editCW, date: e.target.value })} required />
                </div>
              </div>
              <div className="cwr-modal-footer">
                <button type="button" className="cwr-btn-cancel" onClick={() => setShowEditModal(false)}>Cancel</button>
                <button type="submit" className="cwr-btn-save">Update Profile</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ClassworkReminding;
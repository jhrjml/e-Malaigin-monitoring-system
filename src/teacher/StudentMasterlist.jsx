import React, { useState, useEffect, useMemo } from "react";
import { db } from "../api/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./StudentMasterlist.css";

const col = (name) => collection(db, name);

function StudentMasterlist({ teacherId }) {
  const [resolvedTeacherId, setResolvedTeacherId] = useState(null);
  const [teacherClasses, setTeacherClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  
  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("name"); // "name" or "lrn"
  const [sortOrder, setSortOrder] = useState("asc");  // "asc" or "desc"
  
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [activeStudent, setActiveStudent] = useState(null);

  // 1. Resolve Teacher ID from Prop or Fallback to LocalStorage
  useEffect(() => {
    if (teacherId) {
      setResolvedTeacherId(teacherId);
      setLoading(false);
      return;
    }

    const userId = localStorage.getItem("userId");
    if (!userId) {
      setError("Session expired. Please log in again.");
      setLoading(false);
      return;
    }

    getDoc(doc(db, "User", userId))
      .then((userSnap) => {
        if (userSnap.exists()) {
          const tId = userSnap.data().teacherId || null;
          setResolvedTeacherId(tId);
          if (!tId) setError("No teacher profile linked to this account.");
        } else {
          setError("User record not found.");
        }
      })
      .catch(() => setError("Failed to verify credentials."))
      .finally(() => setLoading(false));
  }, [teacherId]);

  // 2. Fetch Unique Classes Handled by Teacher
  useEffect(() => {
    if (!resolvedTeacherId) return;

    const fetchTeacherClasses = async () => {
      try {
        const schedSnap = await getDocs(
          query(col("Schedule"), where("teacherId", "==", resolvedTeacherId))
        );
        
        const uniqueClassesMap = new Map();
        schedSnap.docs.forEach((d) => {
          const data = d.data();
          if (data.grade && data.section) {
            const gradeNum = parseInt(data.grade, 10);
            const key = `${gradeNum}|${data.section}`;
            if (!uniqueClassesMap.has(key)) {
              uniqueClassesMap.set(key, { grade: gradeNum, section: data.section });
            }
          }
        });

        const formattedClasses = [...uniqueClassesMap.values()].sort((a, b) => {
          if (a.grade !== b.grade) return a.grade - b.grade;
          return a.section.localeCompare(b.section);
        });

        setTeacherClasses(formattedClasses);
      } catch (err) {
        setError("Failed to fetch assigned class configurations.");
      }
    };

    fetchTeacherClasses();
  }, [resolvedTeacherId]);

  // Handle Dropdown Filter Change
  const handleClassFilterChange = async (e) => {
    const val = e.target.value;
    if (!val) {
      setSelectedClass(null);
      setStudents([]);
      setSearchQuery("");
      return;
    }

    const [gradeStr, sectionStr] = val.split("|");
    const gradeNum = parseInt(gradeStr, 10);
    
    setSelectedClass({ grade: gradeNum, section: sectionStr });
    setTableLoading(true);
    setSearchQuery("");

    try {
      const enrollSnap = await getDocs(
        query(
          col("Enrolled"),
          where("grade", "==", gradeNum),
          where("section", "==", sectionStr),
          where("status", "==", "Enrolled")
        )
      );

      const enrollments = enrollSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const studentProfiles = await Promise.all(
        enrollments.map(async (enrollment) => {
          try {
            const studentSnap = await getDoc(doc(db, "Student", enrollment.studentId));
            if (studentSnap.exists()) {
              return {
                ...studentSnap.data(),
                id: studentSnap.id,
                section: enrollment.section,
                enrollId: enrollment.id,
              };
            }
            return null;
          } catch {
            return null;
          }
        })
      );

      setStudents(studentProfiles.filter((p) => p !== null));
    } catch (err) {
      console.error("Error fetching roster details:", err);
    } finally {
      setTableLoading(false);
    }
  };

  // Toggle Column Headers Sorting Parameters
  const handleSortToggle = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // Live Filtering Operation
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const fullName = `${s.lastName || ""} ${s.firstName || ""} ${s.middleName || ""}`.toLowerCase();
      return fullName.includes(q) || String(s.lrn || "").toLowerCase().includes(q);
    });
  }, [students, searchQuery]);

  // Sorting Operation pipeline
  const sortedStudents = useMemo(() => {
    return [...filteredStudents].sort((a, b) => {
      if (sortField === "lrn") {
        const lrnA = String(a.lrn || "");
        const lrnB = String(b.lrn || "");
        return sortOrder === "asc"
          ? lrnA.localeCompare(lrnB, undefined, { numeric: true })
          : lrnB.localeCompare(lrnA, undefined, { numeric: true });
      }
      
      const nameA = `${a.lastName || ""} ${a.firstName || ""}`.toLowerCase();
      const nameB = `${b.lastName || ""} ${b.firstName || ""}`.toLowerCase();
      return sortOrder === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    });
  }, [filteredStudents, sortField, sortOrder]);

  const getStudentDisplayName = (s) => {
    return `${s.lastName || ""}, ${s.firstName || ""}${s.middleName ? ` ${s.middleName.charAt(0).toUpperCase()}.` : ""}`;
  };

  if (loading) {
    return (
      <div className="sml-wrapper">
        <p className="sml-loading-status">Loading masterlist profile data...</p>
      </div>
    );
  }

  return (
    <div className="sml-wrapper">
      {error && (
        <div className="sml-alert-banner">
          <i className="fas fa-exclamation-triangle"></i> {error}
        </div>
      )}

      <div className="sml-view-container">
        {/* Header Title & Floating Pill Search Box Layout Row */}
        <div className="sml-header-flex-row">
          <h2 className="sml-view-title">Student Masterlist</h2>
          
          {selectedClass && (
            <div className="sml-search-input-box-wrapper">
              <i className="fas fa-search sml-search-box-embedded-icon"></i>
              <input 
                type="text" 
                placeholder="Search name or LRN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="sml-search-clear-inline-btn" onClick={() => setSearchQuery("")}>
                  &times;
                </button>
              )}
            </div>
          )}
        </div>
        
        {/* Class Selection Filter Box */}
        <div className="sml-filter-section-container">
          <div className="sml-filter-select-group">
            <label htmlFor="class-filter">Class:</label>
            <select
              id="class-filter"
              className="sml-dropdown-menu-filter"
              value={selectedClass ? `${selectedClass.grade}|${selectedClass.section}` : ""}
              onChange={handleClassFilterChange}
            >
              <option value="">Choose Class</option>
              {teacherClasses.map((c) => (
                <option key={`${c.grade}|${c.section}`} value={`${c.grade}|${c.section}`}>
                  Grade {c.grade} - {c.section}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dynamic Table Block Area */}
        {selectedClass ? (
          tableLoading ? (
            <div className="sml-table-loading-placeholder">
              <i className="fas fa-spinner fa-spin"></i> Loading roster records...
            </div>
          ) : (
            <div className="sml-data-table-container-wrap">
              <table className="sml-custom-data-table">
                <thead>
                  <tr>
                    <th style={{ width: "60px", textAlign: "center" }}>#</th>
                    <th onClick={() => handleSortToggle("lrn")} className="sortable-table-header">
                      LRN 
                      <i className={`fas ${sortField === "lrn" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                      <span className="mt-sort-hint-label">(sort)</span>
                    </th>
                    <th onClick={() => handleSortToggle("name")} className="sortable-table-header">
                      Student Name 
                      <i className={`fas ${sortField === "name" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                      <span className="mt-sort-hint-label">(sort)</span>
                    </th>
                    <th style={{ width: "120px" }}>Age</th>
                    <th>Contact No.</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStudents.length > 0 ? (
                    sortedStudents.map((student, index) => (
                      <tr key={student.id}>
                        <td style={{ textAlign: "center", color: "#888", fontSize: "0.85rem" }}>{index + 1}</td>
                        <td className="sml-font-monospace">{student.lrn || "—"}</td>
                        <td 
                          className="sml-clickable-name" 
                          onClick={() => { setActiveStudent(student); setShowModal(true); }}
                          title="Click to view profile details"
                        >
                          {getStudentDisplayName(student)}
                        </td>
                        <td>{student.age || "—"}</td>
                        <td>{student.contact || "—"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="sml-table-empty-fallback-row">
                        No matching student records found for "{searchQuery}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="sml-empty-area-placeholder" />
        )}
      </div>

      {/* Uniform Student Profile Modal */}
      {showModal && activeStudent && (
        <div className="sml-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="sml-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="sml-modal-header">
              <h3><i className="fas fa-address-card"></i> Student Information</h3>
              <button className="sml-modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            
            <div className="sml-modal-body">
              <div className="sml-profile-header">
                <div className="sml-profile-avatar"><i className="fas fa-user-graduate"></i></div>
                <div className="sml-profile-title">
                  <h4>{activeStudent.lastName}, {activeStudent.firstName} {activeStudent.middleName}</h4>
                  <span className="sml-profile-badge">Grade {selectedClass.grade} - Section {selectedClass.section}</span>
                </div>
              </div>

              <div className="sml-info-grid">
                <div className="sml-info-group">
                  <label>Learner Reference Number (LRN)</label>
                  <p className="sml-font-monospace">{activeStudent.lrn || "Not Provided"}</p>
                </div>
                <div className="sml-info-group">
                  <label>Date of Birth</label>
                  <p>{activeStudent.dob || activeStudent.birthdate || "Not Provided"}</p>
                </div>
                <div className="sml-info-group">
                  <label>Age</label>
                  <p>{activeStudent.age ? `${activeStudent.age} years old` : "Not Provided"}</p>
                </div>
                <div className="sml-info-group">
                  <label>Contact Number</label>
                  <p>{activeStudent.contact || "Not Provided"}</p>
                </div>
                <div className="sml-info-group sml-col-span-2">
                  <label>Complete Address</label>
                  <p>{activeStudent.address || "Not Provided"}</p>
                </div>
                <div className="sml-info-group sml-col-span-2">
                  <label>Parent / Guardian Name</label>
                  <p>{activeStudent.guardianName || activeStudent.parentName || activeStudent.guardian || "Not Provided"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentMasterlist;
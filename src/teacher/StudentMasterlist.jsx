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
  const [currentClassAdviser, setCurrentClassAdviser] = useState("Loading...");

  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");

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

  // 2. Fetch Unique Classes Handled by Teacher (Including their assigned Advisory class)
  useEffect(() => {
    if (!resolvedTeacherId) return;

    const fetchTeacherClasses = async () => {
      try {
        let advisoryText = "";
        try {
          // Fetch the current teacher's own profile to see if they are an adviser
          const tSnap = await getDoc(doc(db, "Teacher", resolvedTeacherId));
          if (tSnap.exists()) {
            advisoryText = tSnap.data().advisory || "";
          }
        } catch (err) {
          console.error("Error fetching teacher profile", err);
        }

        const uniqueClassesMap = new Map();

        // Register their Advisory class forcefully if it exists so they can always view it
        if (advisoryText) {
          const match = advisoryText.match(
            /Grade\s+(\d+)\s*-\s*(?:Section\s+)?(.+)/i,
          );
          if (match) {
            const gNum = parseInt(match[1], 10);
            const sStr = match[2].trim();
            uniqueClassesMap.set(`${gNum}|${sStr}`, {
              grade: gNum,
              section: sStr,
              isAdvisory: true,
            });
          }
        }

        // Fetch their assigned schedule classes
        const schedSnap = await getDocs(
          query(col("Schedule"), where("teacherId", "==", resolvedTeacherId)),
        );

        schedSnap.docs.forEach((d) => {
          const data = d.data();
          if (data.grade && data.section) {
            const gradeNum = parseInt(data.grade, 10);
            let sStr = data.section.trim();
            if (sStr.toLowerCase().startsWith("section ")) {
              sStr = sStr.substring(8).trim();
            }
            const key = `${gradeNum}|${sStr}`;
            // Add if not already there (advisory check preserves priority)
            if (!uniqueClassesMap.has(key)) {
              uniqueClassesMap.set(key, {
                grade: gradeNum,
                section: sStr,
                isAdvisory: false,
              });
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
    setCurrentClassAdviser("Searching...");

    try {
      // Fetch students for selected class
      const enrollSnap = await getDocs(
        query(
          col("Enrolled"),
          where("grade", "==", gradeNum),
          where("section", "==", sectionStr),
          where("status", "==", "Enrolled"),
        ),
      );

      const enrollments = enrollSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      const studentProfiles = await Promise.all(
        enrollments.map(async (enrollment) => {
          try {
            const studentSnap = await getDoc(
              doc(db, "Student", enrollment.studentId),
            );
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
        }),
      );

      setStudents(studentProfiles.filter((p) => p !== null));

      // Fetch the Adviser assigned to this selected class
      const advQuery1 = `Grade ${gradeNum} - Section ${sectionStr}`;
      const advQuery2 = `Grade ${gradeNum} - ${sectionStr}`;

      const teachersRef = col("Teacher");
      const q1 = query(teachersRef, where("advisory", "==", advQuery1));
      const snap1 = await getDocs(q1);

      if (!snap1.empty) {
        const t = snap1.docs[0].data();
        setCurrentClassAdviser(`${t.fname} ${t.lname}`);
      } else {
        const q2 = query(teachersRef, where("advisory", "==", advQuery2));
        const snap2 = await getDocs(q2);
        if (!snap2.empty) {
          const t = snap2.docs[0].data();
          setCurrentClassAdviser(`${t.fname} ${t.lname}`);
        } else {
          setCurrentClassAdviser("No Adviser Assigned");
        }
      }
    } catch (err) {
      console.error("Error fetching roster details:", err);
      setCurrentClassAdviser("Unknown");
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
      const fullName =
        `${s.lastName || ""} ${s.firstName || ""} ${s.middleName || ""}`.toLowerCase();
      return (
        fullName.includes(q) ||
        String(s.lrn || "")
          .toLowerCase()
          .includes(q)
      );
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
      return sortOrder === "asc"
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
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
                <button
                  className="sml-search-clear-inline-btn"
                  onClick={() => setSearchQuery("")}
                >
                  &times;
                </button>
              )}
            </div>
          )}
        </div>

        {/* Class Selection Filter Box */}
        <div className="sml-filter-section-container">
          <div className="sml-filter-select-group">
            <label htmlFor="class-filter">Class View Scope:</label>
            <select
              id="class-filter"
              className="sml-dropdown-menu-filter"
              value={
                selectedClass
                  ? `${selectedClass.grade}|${selectedClass.section}`
                  : ""
              }
              onChange={handleClassFilterChange}
            >
              <option value="">Choose Class</option>
              {teacherClasses.map((c) => (
                <option
                  key={`${c.grade}|${c.section}`}
                  value={`${c.grade}|${c.section}`}
                >
                  Grade {c.grade} - {c.section}{" "}
                  {c.isAdvisory ? "(Your Advisory Class)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dynamic Table Block Area */}
        {selectedClass ? (
          <>
            <div className="sml-class-info-banner">
              <div className="sml-class-info-item">
                <i
                  className="fas fa-users"
                  style={{ color: "var(--sml-accent)" }}
                ></i>
                <span>
                  <strong>Assigned Class:</strong> Grade {selectedClass.grade} -{" "}
                  {selectedClass.section}
                </span>
              </div>
              <div className="sml-class-info-item">
                <i
                  className="fas fa-chalkboard-teacher"
                  style={{ color: "var(--sml-primary)" }}
                ></i>
                <span>
                  <strong>Class Adviser:</strong> {currentClassAdviser}
                </span>
              </div>
            </div>

            {tableLoading ? (
              <div className="sml-table-loading-placeholder">
                <i className="fas fa-spinner fa-spin"></i> Loading roster
                records...
              </div>
            ) : (
              <div className="sml-data-table-container-wrap">
                <table className="sml-custom-data-table">
                  <thead>
                    <tr>
                      <th style={{ width: "50px", textAlign: "center" }}>#</th>
                      <th
                        onClick={() => handleSortToggle("lrn")}
                        className="sortable-table-header"
                      >
                        LRN
                        <i
                          className={`fas ${sortField === "lrn" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}
                        ></i>
                        <span className="mt-sort-hint-label"></span>
                      </th>
                      <th
                        onClick={() => handleSortToggle("name")}
                        className="sortable-table-header"
                      >
                        Student Name
                        <i
                          className={`fas ${sortField === "name" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}
                        ></i>
                        <span className="mt-sort-hint-label"></span>
                      </th>
                      <th>Gender</th>
                      <th>Class Placement</th>
                      <th style={{ width: "80px" }}>Age</th>
                      <th>Contact No.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStudents.length > 0 ? (
                      sortedStudents.map((student, index) => (
                        <tr key={student.id}>
                          <td
                            style={{
                              textAlign: "center",
                              color: "#888",
                              fontSize: "0.85rem",
                            }}
                          >
                            {index + 1}
                          </td>
                          <td className="sml-font-monospace">
                            {student.lrn || "—"}
                          </td>
                          <td
                            className="sml-clickable-name"
                            onClick={() => {
                              setActiveStudent(student);
                              setShowModal(true);
                            }}
                            title="Click to view profile details"
                          >
                            {getStudentDisplayName(student)}
                          </td>
                          <td>{student.gender || "—"}</td>
                          <td>
                            <span className="sml-table-grade-badge">
                              Grade {student.grade} - {student.section}
                            </span>
                          </td>
                          <td>{student.age || "—"}</td>
                          <td>{student.contact || "—"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan="7"
                          className="sml-table-empty-fallback-row"
                        >
                          No matching student records found for "{searchQuery}".
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="sml-empty-area-placeholder" />
        )}
      </div>

      {/* Uniform 3-Column Student Profile Modal */}
      {showModal && activeStudent && (
        <div className="sml-modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="sml-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sml-modal-header">
              <h3>
                <div className="sml-modal-header-icon">
                  <i className="fas fa-address-card"></i>
                </div>
                Student Information
              </h3>
              <button
                className="sml-modal-close"
                onClick={() => setShowModal(false)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="sml-modal-body">
              <div className="sml-student-info-top">
                <div className="sml-student-name-block">
                  <h2 className="sml-student-name">
                    {activeStudent.lastName}, {activeStudent.firstName}{" "}
                    {activeStudent.middleName || ""}
                  </h2>
                  <span className="sml-student-grade-pill">
                    Grade {selectedClass.grade} - Section{" "}
                    {selectedClass.section}
                  </span>
                </div>
              </div>

              <hr className="sml-student-info-divider" />

              <div className="sml-grid">
                <div className="sml-field-group">
                  <label className="sml-field-label">First name</label>
                  <div className="sml-view-box">
                    {activeStudent.firstName || "—"}
                  </div>
                </div>
                <div className="sml-field-group">
                  <label className="sml-field-label">Middle name</label>
                  <div className="sml-view-box">
                    {activeStudent.middleName || "—"}
                  </div>
                </div>
                <div className="sml-field-group">
                  <label className="sml-field-label">Last name</label>
                  <div className="sml-view-box">
                    {activeStudent.lastName || "—"}
                  </div>
                </div>

                <div className="sml-field-group">
                  <label className="sml-field-label">
                    Learner Reference No.
                  </label>
                  <div className="sml-view-box sml-lrn-box">
                    {activeStudent.lrn || "—"}
                  </div>
                </div>
                <div className="sml-field-group">
                  <label className="sml-field-label">Date of birth</label>
                  <div className="sml-view-box">
                    {activeStudent.dob || activeStudent.birthdate || "—"}
                  </div>
                </div>
                <div className="sml-field-group">
                  <label className="sml-field-label">Age</label>
                  <div className="sml-view-box">
                    {activeStudent.age ? `${activeStudent.age} years old` : "—"}
                  </div>
                </div>

                {/* Explicitly displayed Gender Field without hiding the column structure */}
                <div className="sml-field-group">
                  <label className="sml-field-label">Gender</label>
                  <div className="sml-view-box">
                    {activeStudent.gender || "—"}
                  </div>
                </div>
                <div className="sml-field-group">
                  <label className="sml-field-label">Contact number</label>
                  <div className="sml-view-box">
                    {activeStudent.contact || "—"}
                  </div>
                </div>
                <div className="sml-field-group">
                  <label className="sml-field-label">Parent / Guardian</label>
                  <div className="sml-view-box">
                    {activeStudent.guardian ||
                      activeStudent.guardianName ||
                      activeStudent.parentName ||
                      "—"}
                  </div>
                </div>

                <div className="sml-field-group sml-grid-span-3">
                  <label className="sml-field-label">Complete address</label>
                  <div className="sml-view-box">
                    {activeStudent.address || "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* <div className="sml-modal-footer">
              <button
                className="sml-btn-close-full"
                onClick={() => setShowModal(false)}
              >
                Close
              </button>
            </div> */}
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentMasterlist;

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { db } from "../api/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import useCachedFetch from "../common/useCachedFetch";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./StudentMasterlist.css";

const col = (name) => collection(db, name);

function StudentMasterlist({ teacherId }) {
  const [resolvedTeacherId, setResolvedTeacherId] = useState(null);
  const [selectedClass, setSelectedClass] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");

  const [loading, setLoading] = useState(true);
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

  // 2. Fetch Unique Classes Handled by Teacher (Including their assigned
  // Advisory class). Cached via useCachedFetch, keyed per-teacher, so this
  // renders last-known classes instantly on repeat visits instead of
  // blanking out while Firestore's offline cache resolves.
  const fetchTeacherClasses = useCallback(async () => {
    if (!resolvedTeacherId) return [];

    let advisoryText = "";
    try {
      const tSnap = await getDoc(doc(db, "Teacher", resolvedTeacherId));
      if (tSnap.exists()) {
        advisoryText = tSnap.data().advisory || "";
      }
    } catch (err) {
      console.error("Error fetching teacher profile", err);
    }

    const uniqueClassesMap = new Map();

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
        if (!uniqueClassesMap.has(key)) {
          uniqueClassesMap.set(key, {
            grade: gradeNum,
            section: sStr,
            isAdvisory: false,
          });
        }
      }
    });

    return [...uniqueClassesMap.values()].sort((a, b) => {
      if (a.grade !== b.grade) return a.grade - b.grade;
      return a.section.localeCompare(b.section);
    });
  }, [resolvedTeacherId]);

  const { data: cachedTeacherClasses, loading: classesLoading } =
    useCachedFetch(
      `teacherClasses:${resolvedTeacherId || "none"}`,
      fetchTeacherClasses,
      [resolvedTeacherId],
    );
  const teacherClasses = cachedTeacherClasses || [];

  // 3. Fetch the roster + adviser for the selected class.
  // THIS is the piece that was missing a cache: previously this ran as a
  // plain async call inside the dropdown's onChange handler, so every
  // class switch (even to a class you'd already viewed, even offline)
  // blocked the table behind a fresh network round-trip. Routing it
  // through useCachedFetch, keyed by grade|section, means:
  //   - first-ever view of a class: brief loader (nothing cached yet)
  //   - repeat view, online or offline: cached roster renders instantly,
  //     then quietly refreshes in the background if a connection exists
  const fetchRoster = useCallback(async () => {
    if (!selectedClass) return { students: [], adviser: null };
    const { grade, section } = selectedClass;

    const enrollSnap = await getDocs(
      query(
        col("Enrolled"),
        where("grade", "==", grade),
        where("section", "==", section),
        where("status", "==", "Enrolled"),
      ),
    );

    const enrollments = enrollSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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

    const students = studentProfiles.filter((p) => p !== null);

    // Fetch the Adviser assigned to this selected class
    const advQuery1 = `Grade ${grade} - Section ${section}`;
    const advQuery2 = `Grade ${grade} - ${section}`;
    const teachersRef = col("Teacher");

    let adviser = "No Adviser Assigned";
    try {
      const snap1 = await getDocs(
        query(teachersRef, where("advisory", "==", advQuery1)),
      );
      if (!snap1.empty) {
        const t = snap1.docs[0].data();
        adviser = `${t.fname} ${t.lname}`;
      } else {
        const snap2 = await getDocs(
          query(teachersRef, where("advisory", "==", advQuery2)),
        );
        if (!snap2.empty) {
          const t = snap2.docs[0].data();
          adviser = `${t.fname} ${t.lname}`;
        }
      }
    } catch (err) {
      console.error("Error fetching adviser:", err);
      adviser = "Unknown";
    }

    return { students, adviser };
  }, [selectedClass]);

  const {
    data: rosterData,
    loading: rosterLoading,
    error: rosterError,
  } = useCachedFetch(
    `roster:${selectedClass ? `${selectedClass.grade}|${selectedClass.section}` : "none"}`,
    fetchRoster,
    [selectedClass],
  );

  const students = rosterData?.students || [];
  const currentClassAdviser = !selectedClass
    ? "Loading..."
    : (rosterData?.adviser ?? (rosterLoading ? "Searching..." : "Unknown"));

  // Handle Dropdown Filter Change — just updates selectedClass; the
  // useCachedFetch hook above reacts to that change on its own.
  const handleClassFilterChange = (e) => {
    const val = e.target.value;
    if (!val) {
      setSelectedClass(null);
      setSearchQuery("");
      return;
    }

    const [gradeStr, sectionStr] = val.split("|");
    const gradeNum = parseInt(gradeStr, 10);

    setSelectedClass({ grade: gradeNum, section: sectionStr });
    setSearchQuery("");
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

  // Only block the table with a full loading placeholder when there is
  // truly nothing cached to show yet. If cached data exists (even stale,
  // even offline), show it immediately and let it refresh quietly.
  const showRosterLoadingPlaceholder =
    !!selectedClass && rosterLoading && !rosterData;

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
              {classesLoading && teacherClasses.length === 0 ? (
                <option value="" disabled>
                  Loading classes…
                </option>
              ) : teacherClasses.length === 0 ? (
                <option value="" disabled>
                  No classes assigned yet
                </option>
              ) : (
                teacherClasses.map((c) => (
                  <option
                    key={`${c.grade}|${c.section}`}
                    value={`${c.grade}|${c.section}`}
                  >
                    Grade {c.grade} - {c.section}{" "}
                    {c.isAdvisory ? "(Your Advisory Class)" : ""}
                  </option>
                ))
              )}
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
              {/* Subtle, non-blocking indicator that a background refresh
                  is happening while cached data is already on screen */}
              {rosterLoading && rosterData && (
                <div className="sml-class-info-item sml-refresh-indicator">
                  <i className="fas fa-sync fa-spin"></i>
                  <span>Refreshing…</span>
                </div>
              )}
            </div>

            {rosterError && rosterData && (
              <div className="sml-alert-banner">
                <i className="fas fa-exclamation-triangle"></i> Showing
                last-saved roster — couldn't refresh from the server.
              </div>
            )}

            {showRosterLoadingPlaceholder ? (
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
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentMasterlist;

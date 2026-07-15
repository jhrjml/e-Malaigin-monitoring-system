// ManageStudents.jsx  (Firebase version — custom modals + batch import + Action ID Downloader)
// OFFLINE-SAFE VERSION:
//  - Single add/edit no longer awaits the network write before closing
//    the modal. Firestore's persistentLocalCache queues the write and
//    syncs it automatically when back online.
//  - Bulk import no longer awaits each row sequentially (that hung
//    forever offline on the very first row). All rows are fired at once,
//    the import UI closes immediately with an optimistic result, and the
//    list is reconciled quietly in the background once writes resolve.
//  - useSubmitGuard prevents a fast double-click from creating duplicates.
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import QRCode from "react-qr-code";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import {
  getStudents,
  addStudent,
  updateStudent,
  archiveStudent,
  markQrGenerated,
} from "../api/firebaseApi";
import ConfirmModal from "../common/ConfirmModal";
import Toast from "../common/Toast";
import { useToast } from "../common/useToast.js";
import useSubmitGuard from "../common/useSubmitGuard";
import useNetworkStatus from "../common/useNetworkStatus"; // adjust path if different
import "./ManageStudents.css";
import "./GenerateQr.css"; // Imports matching ID card dimensions & layout criteria
import "../Layout.css";
import "@fortawesome/fontawesome-free/css/all.min.css";

function ManageStudents() {
  const [view, setView] = useState("grades");
  const [selectedGrade, setSelectedGrade] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [students, setStudents] = useState([]);
  const [editingStudent, setEditingStudent] = useState(null);
  const [error, setError] = useState("");

  // ── Global Search State ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");

  // ── Sorting State Containers ──────────────────────────────────────────────
  const [sortField, setSortField] = useState("lrn"); // Options: "lrn" or "name"
  const [sortOrder, setSortOrder] = useState("asc");   // 'asc' = A-Z/lowest, 'desc' = Z-A/highest

  // ── Direct ID Card Automation Target State ────────────────────────────────
  const [idTargetStudent, setIdTargetStudent] = useState(null);
  const [downloadingId, setDownloadingId] = useState(false);

  // ── toast / network ──────────────────────────────────────────────────────
  const { toast, showToast } = useToast();
  const { isOnline } = useNetworkStatus();

  // ── submit guards (separate locks for each action) ─────────────────────
  const guardSubmit = useSubmitGuard();
  const guardImport = useSubmitGuard();

  // ── add menu dropdown ───────────────────────────────────────────────────
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── import state ────────────────────────────────────────────────────────
  const [importRows, setImportRows] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importDone, setImportDone] = useState({ success: 0, failed: 0 });
  const [importFinished, setImportFinished] = useState(false);

  // ── confirm modal state ─────────────────────────────────────────────────
  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    titleIcon: "",
    titleColor: "",
    message: "",
    confirmText: "OK",
    confirmColor: "primary",
    onConfirm: null,
  });
  const closeConfirm = () => setConfirm((c) => ({ ...c, open: false }));

  const [formData, setFormData] = useState({
    lrn: "",
    firstName: "",
    middleName: "",
    lastName: "",
    dob: "",
    age: "",
    contact: "",
    guardian: "",
    address: "",
  });

  // Fetch ALL students on mount to support instant global dashboard filtering
  useEffect(() => {
    getStudents()
      .then(setStudents)
      .catch((err) => console.error("Error fetching students:", err));
  }, []);

  // Close add menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target))
        setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── INTERCEPT SIDEBAR NAVIGATION CLICKS TO RESET DESTINATION CONTEXT ──
  useEffect(() => {
    const handleSidebarClick = (e) => {
      const target = e.target.closest("a, button, div, li, span");
      if (target && target.textContent && target.textContent.includes("Manage Students")) {
        setView("grades");
        setSelectedGrade(null);
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleSidebarClick);
    return () => document.removeEventListener("mousedown", handleSidebarClick);
  }, []);

  // ── ID CARD ENGINE INTERCEPT EFFECT TRIGGER ────────────────────────────────
  useEffect(() => {
    if (!idTargetStudent) return;

    const runIdCardGeneration = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));

      const frontNode = document.getElementById("student-action-id-front");
      const backNode = document.getElementById("student-action-id-back");
      if (!frontNode || !backNode) {
        setIdTargetStudent(null);
        return;
      }

      setDownloadingId(true);
      try {
        const [frontPng, backPng] = await Promise.all([
          toPng(frontNode, { pixelRatio: 3, backgroundColor: "#ffffff" }),
          toPng(backNode, { pixelRatio: 3, backgroundColor: "#ffffff" }),
        ]);

        const CARD_WIDTH_IN = 4.5;
        const CARD_HEIGHT_IN = 2.75;
        const PAGE_WIDTH_IN = 8.5;
        const PAGE_HEIGHT_IN = 11;
        const GAP_IN = 0.4;

        const pdf = new jsPDF({
          unit: "in",
          format: [PAGE_WIDTH_IN, PAGE_HEIGHT_IN],
        });

        const marginX = (PAGE_WIDTH_IN - CARD_WIDTH_IN) / 2;
        const totalContentHeight = CARD_HEIGHT_IN * 2 + GAP_IN;
        const marginTop = (PAGE_HEIGHT_IN - totalContentHeight) / 2;

        pdf.addImage(frontPng, "PNG", marginX, marginTop, CARD_WIDTH_IN, CARD_HEIGHT_IN);
        pdf.addImage(backPng, "PNG", marginX, marginTop + CARD_HEIGHT_IN + GAP_IN, CARD_WIDTH_IN, CARD_HEIGHT_IN);

        const fullName = `${idTargetStudent.lastName}, ${idTargetStudent.firstName}${idTargetStudent.middleName ? " " + idTargetStudent.middleName : ""}`;
        const safeName = fullName
          .replace(/,/g, "")
          .replace(/\s+/g, "_")
          .replace(/[^a-zA-Z0-9_]/g, "");
        
        pdf.save(`${safeName}_Grade${idTargetStudent.grade}_ID.pdf`);

        await markQrGenerated(idTargetStudent.lrn);
        showToast("Student ID PDF generated and saved successfully!");
      } catch (err) {
        console.error("ID print failure:", err);
        showToast("Error processing render engine file export.", true);
      } finally {
        setDownloadingId(false);
        setIdTargetStudent(null);
      }
    };

    runIdCardGeneration();
  }, [idTargetStudent]);

  const openGrade = (grade) => {
    setSelectedGrade(grade);
    setView("students");
  };
  const backToGrades = () => {
    setView("grades");
    setSelectedGrade(null);
    setError("");
  };

  const calculateAge = (birthDate) => {
    const today = new Date();
    const dob = new Date(birthDate);
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "dob") {
      setFormData({ ...formData, dob: value, age: calculateAge(value) });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  // ── ADD / EDIT (offline-safe) ───────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    guardSubmit(() => doSubmit());
  };

  const doSubmit = () => {
    const wasEditing = editingStudent;
    
    const payload = {
      lrn: String(formData.lrn),
      firstName: formData.firstName,
      middleName: formData.middleName || "",
      lastName: formData.lastName,
      dob: formData.dob,
      age: parseInt(formData.age, 10),
      contact: formData.contact,
      guardian: formData.guardian,
      address: formData.address,
      grade: wasEditing ? wasEditing.grade : parseInt(selectedGrade, 10),
    };

    setModalOpen(false);
    setEditingStudent(null);
    setFormData({
      lrn: "",
      firstName: "",
      middleName: "",
      lastName: "",
      dob: "",
      age: "",
      contact: "",
      guardian: "",
      address: "",
    });
    showToast(
      isOnline
        ? `${payload.firstName} ${payload.lastName} was ${wasEditing ? "updated" : "added"} successfully.`
        : `${payload.firstName} ${payload.lastName} saved offline — will sync when back online.`,
    );

    const savePromise = wasEditing
      ? updateStudent(wasEditing.id, payload)
      : addStudent(payload);

    savePromise
      .then((result) => {
        if (wasEditing) {
          setStudents((prev) =>
            prev.map((s) => (s.id === wasEditing.id ? result : s)),
          );
        } else {
          setStudents((prev) => [...prev, result]);
        }
      })
      .catch((err) => {
        showToast(
          `Failed to save ${payload.firstName} ${payload.lastName}: ${err.message}`,
          true,
        );
      });
  };

  const handleArchive = (student) => {
    setConfirm({
      open: true,
      title: "Archive Student",
      titleIcon: "fa-archive",
      titleColor: "#e74c3c",
      message: (
        <>
          Are you sure you want to archive{" "}
          <strong>
            {student.firstName} {student.lastName}
          </strong>
          ? They will be removed from the system but their data will be kept.
        </>
      ),
      confirmText: "Yes, Archive",
      confirmColor: "danger",
      onConfirm: () => {
        closeConfirm();
        setStudents((prev) => prev.filter((s) => s.id !== student.id));
        showToast(
          isOnline
            ? `${student.firstName} ${student.lastName} has been archived.`
            : `${student.firstName} ${student.lastName} archived offline — will sync when back online.`,
        );
        archiveStudent(student.id).catch((err) => {
          showToast(err.message || "Failed to archive student.", true);
        });
      },
    });
  };

  const handleEdit = (student) => {
    setEditingStudent(student);
    setError("");
    setFormData({
      lrn: student.lrn,
      firstName: student.firstName,
      middleName: student.middleName,
      lastName: student.lastName,
      dob: student.dob,
      age: student.age,
      contact: student.contact,
      guardian: student.guardian,
      address: student.address,
    });
    setModalOpen(true);
  };

  // ── BATCH IMPORT ────────────────────────────────────────────────────────
  const downloadTemplate = () => {
    const headers = [
      [
        "LRN",
        "First Name",
        "Middle Name",
        "Last Name",
        "Date of Birth (YYYY-MM-DD)",
        "Contact (11 digits — format cell as Text)",
        "Guardian",
        "Address",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(headers);
    ws["!cols"] = [
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 26 },
      { wch: 30 },
      { wch: 20 },
      { wch: 28 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, `Grade${selectedGrade}_Students_Template.xlsx`);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportErrors([]);
    setImportFinished(false);
    setImportDone({ success: 0, failed: 0 });
    setImportRows([]);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, {
          type: "binary",
          cellDates: true,
        });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const rows = raw.slice(1).filter((r) => r.some((c) => c !== ""));

        const parsed = rows.map((r, i) => {
          const lrn = String(r[0] || "").trim();
          const firstName = String(r[1] || "").trim();
          const middleName = String(r[2] || "").trim();
          const lastName = String(r[3] || "").trim();
          let dob = "";
          if (r[4] instanceof Date) dob = r[4].toISOString().split("T")[0];
          else dob = String(r[4] || "").trim();
          const contact = String(r[5] || "")
            .replace(/\D/g, "")
            .padStart(11, "0")
            .slice(0, 11);
          const guardian = String(r[6] || "").trim();
          const address = String(r[7] || "").trim();
          const age = dob ? calculateAge(dob) : "";

          const errs = [];
          if (!/^\d{12}$/.test(lrn)) errs.push("LRN must be 12 digits");
          if (!firstName) errs.push("First name required");
          if (!lastName) errs.push("Last name required");
          if (!dob || isNaN(new Date(dob))) errs.push("Invalid date of birth");
          if (!/^\d{11}$/.test(contact)) errs.push("Contact must be 11 digits");
          if (!guardian) errs.push("Guardian required");
          if (!address) errs.push("Address required");

          return {
            row: i + 2,
            lrn,
            firstName,
            middleName,
            lastName,
            dob,
            age,
            contact,
            guardian,
            address,
            errs,
          };
        });

        const lrnCounts = {};
        parsed.forEach((r) => {
          if (r.lrn) lrnCounts[r.lrn] = (lrnCounts[r.lrn] || 0) + 1;
        });

        const withDupCheck = parsed.map((r) => {
          const errs = [...r.errs];
          if (r.lrn && lrnCounts[r.lrn] > 1)
            errs.push("Duplicate LRN in this file");
          return { ...r, errs };
        });

        setImportRows(withDupCheck);
        setImportModalOpen(true);
      } catch (err) {
        setImportErrors([
          "Failed to read file. Please use the provided template.",
        ]);
        setImportModalOpen(true);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const handleImportSave = () => {
    const validRows = importRows.filter((r) => r.errs.length === 0);
    if (validRows.length === 0) return;
    guardImport(() => doImportSave(validRows));
  };

  const doImportSave = (validRows) => {
    setImportLoading(true);

    const tempRows = validRows.map((row, i) => ({
      ...row,
      _tempId: `temp-${Date.now()}-${i}`,
    }));

    const pending = tempRows.map((row) => {
      const payload = {
        lrn: row.lrn,
        firstName: row.firstName,
        middleName: row.middleName,
        lastName: row.lastName,
        dob: row.dob,
        age: parseInt(row.age, 10),
        contact: row.contact,
        guardian: row.guardian,
        address: row.address,
        grade: parseInt(selectedGrade, 10),
      };
      return addStudent(payload)
        .then((created) => ({ ok: true, row, created }))
        .catch((err) => ({ ok: false, row, error: err }));
    });

    setStudents((prev) => [
      ...prev,
      ...tempRows.map((row) => ({
        id: row._tempId,
        lrn: row.lrn,
        firstName: row.firstName,
        middleName: row.middleName,
        lastName: row.lastName,
        dob: row.dob,
        age: row.age,
        contact: row.contact,
        guardian: row.guardian,
        address: row.address,
        grade: parseInt(selectedGrade, 10),
      })),
    ]);

    setImportLoading(false);
    setImportDone({ success: tempRows.length, failed: 0 });
    setImportFinished(true);
    setImportErrors([]);
    setImportRows([]);
    showToast(
      isOnline
        ? `${tempRows.length} student${tempRows.length !== 1 ? "s" : ""} imported successfully.`
        : `${tempRows.length} student${tempRows.length !== 1 ? "s" : ""} saved offline — will sync when back online.`,
    );

    Promise.allSettled(pending).then((settled) => {
      const failMsgs = [];
      setStudents((prev) => {
        let next = [...prev];
        settled.forEach((s) => {
          const outcome = s.value; 
          if (!outcome) return;
          if (outcome.ok) {
            next = next.map((st) =>
              st.id === outcome.row._tempId ? outcome.created : st,
            );
          } else {
            next = next.filter((st) => st.id !== outcome.row._tempId);
            failMsgs.push(
              `Row ${outcome.row.row} (${outcome.row.firstName} ${outcome.row.lastName}): ${outcome.error.message}`,
            );
          }
        });
        return next;
      });
      if (failMsgs.length > 0) {
        setImportErrors(failMsgs);
        showToast(
          `${failMsgs.length} imported row(s) failed to save. See details below.`,
          true,
        );
      }
    });
  };

  const handleSortToggle = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const processSortingPipeline = (datasetArray) => {
    return [...datasetArray].sort((a, b) => {
      if (sortField === "lrn") {
        const lrnA = String(a.lrn || "");
        const lrnB = String(b.lrn || "");
        return sortOrder === "asc"
          ? lrnA.localeCompare(lrnB, undefined, { numeric: true })
          : lrnB.localeCompare(lrnA, undefined, { numeric: true });
      }
      if (sortField === "name") {
        const nameA = `${a.lastName || ""} ${a.firstName || ""}`.toLowerCase();
        const nameB = `${b.lastName || ""} ${b.firstName || ""}`.toLowerCase();
        return sortOrder === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      }
      return 0;
    });
  };

  // ── LIVE FILTER ENGINE ──
  const isSearching = searchQuery.trim().length > 0;

  const globalFilteredStudents = students.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const fullName = `${s.lastName} ${s.firstName} ${s.middleName || ""}`.toLowerCase();
    return fullName.includes(q) || String(s.lrn).includes(q);
  });

  const activeGradeStudents = students.filter(
    (s) => s.grade === parseInt(selectedGrade, 10)
  );

  const sortedGlobalStudents = processSortingPipeline(globalFilteredStudents);
  const sortedGradeStudents = processSortingPipeline(activeGradeStudents);

  const validCount = importRows.filter((r) => r.errs.length === 0).length;
  const invalidCount = importRows.filter((r) => r.errs.length > 0).length;

  return (
    <>
      <Toast toast={toast} />

      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        titleIcon={confirm.titleIcon}
        titleColor={confirm.titleColor}
        message={confirm.message}
        confirmText={confirm.confirmText}
        confirmColor={confirm.confirmColor}
        onConfirm={confirm.onConfirm}
        onCancel={closeConfirm}
      />

      {/* ── GRADE LIST VIEW (MAIN WINDOW) ── */}
      {view === "grades" && (
        <div className="view-section active">
          <div className="toolbar-ms">
            <div className="toolbar-ms-title">
              <h2 style={{ color: "#000", marginBottom: "5px" }}>
                Grade Level Masterlist
              </h2>
              <p style={{ color: "#000", fontSize: "0.9rem" }}>
                Select a grade level to view registered students or use global lookup.
              </p>
            </div>

            {/* ── ALIGNED ACTION WRAPPER GROUP ── */}
            <div className="ms-toolbar-actions">
              {/* ── GLOBAL SEARCH BOX INPUT ── */}
              <div className="ms-global-search-container">
                <i className="fas fa-search ms-global-search-icon"></i>
                <input
                  type="text"
                  className="ms-global-search-input"
                  placeholder="Global search name or LRN..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {isSearching && (
                  <button
                    className="ms-global-search-clear"
                    onClick={() => setSearchQuery("")}
                  >
                    &times;
                  </button>
                )}
              </div>

              <button
                className="btn-import-ms"
                onClick={() => {
                  const headers = [
                    [
                      "LRN",
                      "First Name",
                      "Middle Name",
                      "Last Name",
                      "Date of Birth (YYYY-MM-DD)",
                      "Contact (11 digits — format cell as Text)",
                      "Guardian",
                      "Address",
                    ],
                  ];
                  const ws = XLSX.utils.aoa_to_sheet(headers);
                  ws["!cols"] = [
                    { wch: 14 },
                    { wch: 16 },
                    { wch: 16 },
                    { wch: 16 },
                    { wch: 26 },
                    { wch: 30 },
                    { wch: 20 },
                    { wch: 28 },
                  ];
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "Students");
                  XLSX.writeFile(wb, "Students_Template.xlsx");
                }}
              >
                <i className="fas fa-download"></i> Download Template
              </button>
            </div>
          </div>

          <div className="pretty-table-container">
            {!isSearching ? (
              /* DEFAULT TRACK VIEW: SHOW LEVEL ROWS (FULLY CLICKABLE) */
              <table className="pretty-table">
                <thead>
                  <tr>
                    <th>Grade Level</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 3, 4, 5, 6].map((grade) => (
                    <tr 
                      key={grade} 
                      onClick={() => openGrade(grade)} 
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div className={`grade-badge grade-${grade}`}>
                          Grade {grade}
                        </div>
                      </td>
                      <td>
                        <span className="status-pill active">Active</span>
                      </td>
                      <td>
                        <button
                          className="btn-view-ms"
                          onClick={(e) => {
                            e.stopPropagation(); // Stops parent tr activation loop clash
                            openGrade(grade);
                          }}
                        >
                          View Students <i className="fas fa-arrow-right"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              /* SEARCH VIEW: SHOW GLOBAL RESULTS TABLE */
              <div className="table-container" style={{ marginTop: "0px" }}>
                <table className="data-table-ms">
                  <thead>
                    <tr>
                      <th onClick={() => handleSortToggle("lrn")} className="sortable-table-header">
                        LRN
                        <i className={`fas ${sortField === "lrn" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                        <span className="mt-sort-hint-label">(sort)</span>
                      </th>
                      <th onClick={() => handleSortToggle("name")} className="sortable-table-header">
                        Name
                        <i className={`fas ${sortField === "name" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                        <span className="mt-sort-hint-label">(sort)</span>
                      </th>
                      <th>Grade Level</th>
                      <th>Age</th>
                      <th>Contact</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGlobalStudents.length === 0 ? (
                      <tr>
                        <td
                          colSpan="6"
                          style={{ textAlign: "center", padding: "20px" }}
                        >
                          No cross-grade matching students found for "{searchQuery}".
                        </td>
                      </tr>
                    ) : (
                      sortedGlobalStudents.map((s) => (
                        <tr key={s.id}>
                          <td>{s.lrn}</td>
                          <td>
                            <button
                              className="student-clickable-name-link"
                              onClick={() => handleEdit(s)}
                              title="Click to view/edit student record profile details"
                            >
                              {s.lastName}, {s.firstName}
                              {s.middleName
                                ? ` ${s.middleName.charAt(0).toUpperCase()}.`
                                : ""}
                            </button>
                          </td>
                          <td>
                            <span className={`grade-badge grade-${s.grade}`} style={{ padding: "4px 10px", fontSize: "0.75rem" }}>
                              Grade {s.grade}
                            </span>
                          </td>
                          <td>{s.age}</td>
                          <td>{s.contact}</td>
                          <td>
                            <button
                              className="btn-download-id-cell"
                              onClick={() => setIdTargetStudent(s)}
                              title="Download Student ID Card"
                              disabled={downloadingId}
                            >
                              <i className={downloadingId && idTargetStudent?.id === s.id ? "fas fa-spinner fa-spin" : "fas fa-id-card"}></i>
                            </button>
                            <button
                              className="btn-edit-student"
                              onClick={() => handleEdit(s)}
                            >
                              <i className="fas fa-edit"></i>
                            </button>
                            <button
                              className="btn-archive-student"
                              onClick={() => handleArchive(s)}
                              title="Archive student"
                            >
                              <i className="fas fa-archive"></i>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── INDIVIDUAL LEVEL WINDOW ── */}
      {view === "students" && (
        <div className="view-section">
          <div className="toolbar-ms">
            <button className="btn-back-ms" onClick={backToGrades}>
              <i className="fas fa-arrow-left"></i>
            </button>
            <h3 style={{ marginLeft: "15px" }}>Grade {selectedGrade} List</h3>

            <div className="ms-toolbar-actions">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />

              <div style={{ position: "relative" }} ref={addMenuRef}>
                <button
                  className="btn-add-ms"
                  onClick={() => setAddMenuOpen(!addMenuOpen)}
                >
                  <i className="fas fa-plus"></i> Add Student
                </button>

                {addMenuOpen && (
                  <div className="add-menu-popup">
                    <button
                      className="add-menu-item"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setEditingStudent(null);
                        setError("");
                        setFormData({
                          lrn: "",
                          firstName: "",
                          middleName: "",
                          lastName: "",
                          dob: "",
                          age: "",
                          contact: "",
                          guardian: "",
                          address: "",
                        });
                        setModalOpen(true);
                      }}
                    >
                      <i
                        className="fas fa-user-plus"
                        style={{ color: "#a65f81" }}
                      ></i>
                      Add Student Manually
                    </button>
                    <div className="add-menu-divider" />
                    <button
                      className="add-menu-item"
                      onClick={() => {
                        setAddMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      <i
                        className="fas fa-file-import"
                        style={{ color: "#27ae60" }}
                      ></i>
                      Import Student
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="table-container">
            <table className="data-table-ms">
              <thead>
                <tr>
                  <th onClick={() => handleSortToggle("lrn")} className="sortable-table-header">
                    LRN
                    <i className={`fas ${sortField === "lrn" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                    <span className="mt-sort-hint-label">(sort)</span>
                  </th>
                  <th onClick={() => handleSortToggle("name")} className="sortable-table-header">
                    Name
                    <i className={`fas ${sortField === "name" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}></i>
                    <span className="mt-sort-hint-label">(sort)</span>
                  </th>
                  <th>Age</th>
                  <th>Contact</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedGradeStudents.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      style={{ textAlign: "center", padding: "20px" }}
                    >
                      No students registered inside Grade {selectedGrade} yet.
                    </td>
                  </tr>
                ) : (
                  sortedGradeStudents.map((s) => (
                    <tr key={s.id}>
                      <td>{s.lrn}</td>
                      <td>
                        <button
                          className="student-clickable-name-link"
                          onClick={() => handleEdit(s)}
                          title="Click to view student profile details"
                        >
                          {s.lastName}, {s.firstName}
                          {s.middleName
                            ? ` ${s.middleName.charAt(0).toUpperCase()}.`
                            : ""}
                        </button>
                      </td>
                      <td>{s.age}</td>
                      <td>{s.contact}</td>
                      <td>
                        <button
                          className="btn-download-id-cell"
                          onClick={() => setIdTargetStudent(s)}
                          title="Download Student ID Card"
                          disabled={downloadingId}
                        >
                          <i className={downloadingId && idTargetStudent?.id === s.id ? "fas fa-spinner fa-spin" : "fas fa-id-card"}></i>
                        </button>
                        <button
                          className="btn-edit-student"
                          onClick={() => handleEdit(s)}
                        >
                          <i className="fas fa-edit"></i>
                        </button>
                        <button
                          className="btn-archive-student"
                          onClick={() => handleArchive(s)}
                          title="Archive student"
                        >
                          <i className="fas fa-archive"></i>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PROFILE MAINTENANCE DATA SHEET MODAL ── */}
      {modalOpen && (
        <div
          className="modal-overlay"
          style={{ display: "flex", zIndex: 9999 }}
        >
          <div className="modal-content-student add-student-modal">
            <div className="modal-header">
              <h3>
                {editingStudent
                  ? "Edit Student Profile"
                  : "Add Student Profile"}
              </h3>
              <div
                className="close-modal"
                onClick={() => {
                  setModalOpen(false);
                  setError("");
                }}
              >
                &times;
              </div>
            </div>
            <div className="modal-body">
              {error && (
                <div
                  style={{
                    color: "red",
                    fontSize: "0.85rem",
                    marginBottom: "10px",
                    background: "#fff0f0",
                    padding: "8px",
                    borderRadius: "6px",
                  }}
                >
                  ⚠ {error}
                </div>
              )}
              <form
                className="grid-form"
                onSubmit={handleSubmit}
                id="studentForm"
              >
                <div className="form-group span-3">
                  <label>
                    LRN{" "}
                    <small style={{ color: "#888" }}>(12-digit number)</small>
                  </label>
                  <input
                    type="text"
                    name="lrn"
                    value={formData.lrn}
                    onChange={(e) => {
                      const val = e.target.value
                        .replace(/\D/g, "")
                        .slice(0, 12);
                      setFormData({ ...formData, lrn: val });
                    }}
                    pattern="\d{12}"
                    maxLength={12}
                    placeholder="Enter 12-digit LRN"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>First Name</label>
                  <input
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Middle Name</label>
                  <input
                    type="text"
                    name="middleName"
                    value={formData.middleName}
                    onChange={handleChange}
                  />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Date of Birth</label>
                  <input
                    type="date"
                    name="dob"
                    value={formData.dob}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Age</label>
                  <input type="number" value={formData.age} readOnly />
                </div>
                <div className="form-group">
                  <label>
                    Contact <small style={{ color: "#888" }}>(11 digits)</small>
                  </label>
                  <input
                    type="text"
                    name="contact"
                    value={formData.contact}
                    onChange={(e) => {
                      const val = e.target.value
                        .replace(/\D/g, "")
                        .slice(0, 11);
                      setFormData({ ...formData, contact: val });
                    }}
                    pattern="\d{11}"
                    maxLength={11}
                    placeholder="e.g. 09xxxxxxxxx"
                    required
                  />
                </div>
                <div className="form-group span-3">
                  <label>Parent/Guardian</label>
                  <input
                    type="text"
                    name="guardian"
                    value={formData.guardian}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group span-3">
                  <label>Address</label>
                  <input
                    type="text"
                    name="address"
                    value={formData.address}
                    onChange={handleChange}
                    required
                  />
                </div>
              </form>
              <div className="modal-footer-ms">
                <button
                  className="btn-cancel"
                  onClick={() => {
                    setModalOpen(false);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button className="btn-save" type="submit" form="studentForm">
                  {editingStudent ? "Update Profile" : "Save Profile"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── IMPORT PREVIEW MODAL ── */}
      {importModalOpen && (
        <div
          className="modal-overlay"
          style={{ display: "flex", zIndex: 9999 }}
        >
          <div
            className="modal-content-student add-student-modal"
            style={{ maxWidth: "780px", width: "95%" }}
          >
            <div className="modal-header">
              <h3>
                <i
                  className="fas fa-file-import"
                  style={{ marginRight: "8px" }}
                ></i>
                Import Students — Grade {selectedGrade}
              </h3>
              <span className="close-modal" onClick={closeImportModal}>
                &times;
              </span>
            </div>

            <div className="modal-body">
              {importErrors.length > 0 && !importFinished && (
                <div className="import-error-box">
                  {importErrors.map((e, i) => (
                    <div key={i}>⚠ {e}</div>
                  ))}
                </div>
              )}

              {importRows.length > 0 && (
                <>
                  <div
                    style={{
                      display: "flex",
                      gap: "12px",
                      marginBottom: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="import-badge import-badge-ok">
                      <i className="fas fa-check-circle"></i> {validCount} valid
                    </span>
                    {invalidCount > 0 && (
                      <span className="import-badge import-badge-err">
                        <i className="fas fa-times-circle"></i> {invalidCount}{" "}
                        with errors
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      overflowX: "auto",
                      maxHeight: "300px",
                      overflowY: "auto",
                    }}
                  >
                    <table
                      className="data-table-ms"
                      style={{ fontSize: "0.8rem" }}
                    >
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>LRN</th>
                          <th>First Name</th>
                          <th>Last Name</th>
                          <th>DOB</th>
                          <th>Contact</th>
                          <th>Guardian</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map((r) => (
                          <tr
                            key={r.row}
                            style={{
                              background: r.errs.length > 0 ? "#fff5f5" : "",
                            }}
                          >
                            <td>{r.row}</td>
                            <td>{r.lrn}</td>
                            <td>{r.firstName}</td>
                            <td>{r.lastName}</td>
                            <td>{r.dob}</td>
                            <td>{r.contact}</td>
                            <td>{r.guardian}</td>
                            <td>
                              {r.errs.length === 0 ? (
                                <span
                                  style={{ color: "#27ae60", fontWeight: 600 }}
                                >
                                  ✓ OK
                                </span>
                              ) : (
                                <span
                                  style={{
                                    color: "#e74c3c",
                                    fontSize: "0.75rem",
                                  }}
                                >
                                  {r.errs.join(", ")}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {importFinished && (
                <div style={{ marginTop: "12px" }}>
                  {importDone.success > 0 && (
                    <div className="import-result-ok">
                      <i className="fas fa-check-circle"></i>{" "}
                      {importDone.success} student(s){" "}
                      {isOnline
                        ? "imported successfully."
                        : "saved offline — will sync when back online."}
                    </div>
                  )}
                  {importErrors.length > 0 && (
                    <div className="import-error-box">
                      {importErrors.map((e, i) => (
                        <div key={i}>⚠ {e}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer-ms">
              <button className="btn-cancel" onClick={closeImportModal}>
                {importFinished ? "Close" : "Cancel"}
              </button>
              {!importFinished && importRows.length > 0 && validCount > 0 && (
                <button
                  className="btn-save"
                  onClick={handleImportSave}
                  disabled={importLoading}
                >
                  {importLoading
                    ? `Importing… (${validCount})`
                    : `Import ${validCount} Student${validCount !== 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── BACKGROUND AUTOMATION TEMPLATE CANVAS NODES ── */}
      {idTargetStudent && (
        <div style={{ position: "absolute", left: "-9999px", top: "-9999px", zIndex: -1 }}>
          {/* FRONT */}
          <div id="student-row-id-front" className="id-card">
            <div className="id-card-topbar">
              <img src="/logo.jpg" alt="School Logo" className="id-card-logo" />
              <div className="id-card-titles">
                <span className="id-card-school">MALAIG ELEMENTARY SCHOOL</span>
              </div>
            </div>
            <div className="id-card-body-front">
              <div className="id-photo-box" aria-label="2x2 photo guide">
                <span className="id-photo-box-label">2×2</span>
                <span className="id-photo-box-sublabel">PASTE PHOTO HERE</span>
              </div>
              <div className="id-info-right">
                <div className="id-info-row">
                  <label>Name</label>
                  <span>{`${idTargetStudent.lastName}, ${idTargetStudent.firstName}${idTargetStudent.middleName ? " " + idTargetStudent.middleName : ""}`}</span>
                </div>
                <div className="id-info-row">
                  <label>Birthdate</label>
                  <span>{idTargetStudent.birthdate || idTargetStudent.dob || "—"}</span>
                </div>
                <div className="id-info-row">
                  <label>LRN</label>
                  <span>{idTargetStudent.lrn}</span>
                </div>
              </div>
            </div>
          </div>

          {/* BACK */}
          <div id="student-row-id-back" className="id-card">
            <div className="id-card-topbar small">
              <img src="/logo.jpg" alt="School Logo" className="id-card-logo" />
              <span className="id-card-school">MALAIG ELEMENTARY SCHOOL</span>
            </div>
            <div className="id-card-body-back">
              <div className="id-emergency-left">
                <h4>EMERGENCY CONTACT</h4>
                <div className="id-info-row">
                  <label>Guardian</label>
                  <span>{idTargetStudent.guardian || "—"}</span>
                </div>
                <div className="id-info-row">
                  <label>Contact No.</label>
                  <span>{idTargetStudent.guardianContact || idTargetStudent.contact || "—"}</span>
                </div>
                <div className="id-info-row">
                  <label>Address</label>
                  <span>{idTargetStudent.address || "—"}</span>
                </div>
              </div>
              <div className="id-qr-right">
                <QRCode
                  value={String(idTargetStudent.lrn)}
                  size={110}
                  viewBox="0 0 256 256"
                  style={{ height: "auto", width: "100%" }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ManageStudents;
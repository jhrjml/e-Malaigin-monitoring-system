// ManageStudents.jsx  (Firebase version — custom modals + batch import)
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
import {
  getStudents,
  addStudent,
  updateStudent,
  archiveStudent,
} from "../api/firebaseApi";
import ConfirmModal from "../common/ConfirmModal";
import Toast from "../common/Toast";
import { useToast } from "../common/useToast.js";
import useSubmitGuard from "../common/useSubmitGuard";
import useNetworkStatus from "../common/useNetworkStatus"; // adjust path if different
import "./ManageStudents.css";
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

  useEffect(() => {
    if (selectedGrade !== null) {
      getStudents(selectedGrade)
        .then(setStudents)
        .catch((err) => console.error("Error fetching students:", err));
    }
  }, [selectedGrade]);

  // Close add menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target))
        setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const openGrade = (grade) => {
    setSelectedGrade(grade);
    setView("students");
  };
  const backToGrades = () => {
    setView("grades");
    setSelectedGrade(null);
    setStudents([]);
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
      grade: parseInt(selectedGrade, 10),
    };
    const wasEditing = editingStudent;

    // Close + reset + notify immediately — do not wait for the network.
    // Firestore's persistentLocalCache has already queued this write and
    // will sync it automatically the moment connectivity returns.
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
        // Optimistic remove — same offline-safe pattern.
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

  // Offline-safe bulk import.
  // IMPORTANT: we do NOT `await` each addStudent() one-by-one anymore.
  // While offline, the very first awaited write never resolves (it just
  // sits in Firestore's local queue), which used to freeze the whole loop
  // and the "Importing…" modal forever. Instead we fire every write at
  // once — Firestore queues them all to its local cache synchronously —
  // then close the modal immediately and reconcile the list quietly once
  // the writes actually resolve (instantly if online, on reconnect if not).
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

    // Fire all writes now. Each returns a promise that resolves once
    // synced — we never block the UI on it.
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

    // Show the optimistic rows in the table immediately.
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

    // Close the import modal right away with an optimistic result.
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

    // Reconcile quietly in the background once writes actually resolve.
    Promise.allSettled(pending).then((settled) => {
      const failMsgs = [];
      setStudents((prev) => {
        let next = [...prev];
        settled.forEach((s) => {
          const outcome = s.value; // each entry above always resolves (errors are caught)
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

  const closeImportModal = () => {
    setImportModalOpen(false);
    setImportRows([]);
    setImportErrors([]);
    setImportFinished(false);
    setImportDone({ success: 0, failed: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const validCount = importRows.filter((r) => r.errs.length === 0).length;
  const invalidCount = importRows.filter((r) => r.errs.length > 0).length;

  const sortedStudents = students
    .slice()
    .sort((a, b) => String(a.lrn).localeCompare(String(b.lrn)));

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

      {/* ── GRADE LIST ── */}
      {view === "grades" && (
        <div className="view-section active">
          <div className="toolbar-ms">
            <div className="toolbar-ms-title">
              <h2 style={{ color: "#000", marginBottom: "5px" }}>
                Grade Level Masterlist
              </h2>
              <p style={{ color: "#000", fontSize: "0.9rem" }}>
                Select a grade level to view registered students.
              </p>
            </div>
            <button
              className="btn-import-ms btn-import-ms--spacing"
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
          <div className="pretty-table-container">
            <table className="pretty-table">
              <thead>
                <tr>
                  <th style={{ width: "150px" }}>Grade Level</th>
                  <th style={{ width: "150px", textAlign: "center" }}>
                    Status
                  </th>
                  <th style={{ width: "150px", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((grade) => (
                  <tr key={grade}>
                    <td>
                      <div className={`grade-badge grade-${grade}`}>
                        Grade {grade}
                      </div>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className="status-pill active">Active</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn-view-ms"
                        onClick={() => openGrade(grade)}
                      >
                        View Students <i className="fas fa-arrow-right"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── STUDENT LIST ── */}
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
                  <th>LRN</th>
                  <th>Name</th>
                  <th>Age</th>
                  <th>Contact</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedStudents.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      style={{ textAlign: "center", padding: "20px" }}
                    >
                      No students yet.
                    </td>
                  </tr>
                ) : (
                  sortedStudents.map((s) => (
                    <tr key={s.id}>
                      <td>{s.lrn}</td>
                      <td>
                        {s.lastName}, {s.firstName}
                        {s.middleName
                          ? ` ${s.middleName.charAt(0).toUpperCase()}.`
                          : ""}
                      </td>
                      <td>{s.age}</td>
                      <td>{s.contact}</td>
                      <td>
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

      {/* ── ADD / EDIT MODAL ── */}
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
              <span
                className="close-modal"
                onClick={() => {
                  setModalOpen(false);
                  setError("");
                }}
              >
                &times;
              </span>
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
    </>
  );
}

export default ManageStudents;

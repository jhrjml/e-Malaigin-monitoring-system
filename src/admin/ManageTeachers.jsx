// ManageTeachers.jsx  (Firebase version — custom modals + batch import)
import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import {
  getTeachers,
  addTeacher,
  updateTeacher,
  archiveTeacher,
} from "../api/firebaseApi";
import { db } from "../api/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import ConfirmModal from "../common/ConfirmModal";
import Toast from "../common/Toast";
import { useToast } from "../common/useToast.js";
import "./ManageTeachers.css";
import "@fortawesome/fontawesome-free/css/all.min.css";

const TIME_SLOTS = [
  { value: "06:00-07:00", label: "6:00 AM – 7:00 AM" },
  { value: "07:00-08:00", label: "7:00 AM – 8:00 AM" },
  { value: "08:00-09:00", label: "8:00 AM – 9:00 AM" },
  { value: "09:00-10:00", label: "9:00 AM – 10:00 AM" },
  { value: "10:00-11:00", label: "10:00 AM – 11:00 AM" },
  { value: "11:00-12:00", label: "11:00 AM – 12:00 PM" },
  { value: "12:00-13:00", label: "12:00 PM – 1:00 PM" },
  { value: "13:00-14:00", label: "1:00 PM – 2:00 PM" },
  { value: "14:00-15:00", label: "2:00 PM – 3:00 PM" },
  { value: "15:00-16:00", label: "3:00 PM – 4:00 PM" },
  { value: "16:00-17:00", label: "4:00 PM – 5:00 PM" },
  { value: "17:00-18:00", label: "5:00 PM – 6:00 PM" },
];

// ── Advisory options (single source of truth) ─────────────────────────────────
const ADVISORY_OPTIONS = [
  "Grade 1 - Section A",
  "Grade 1 - Section B",
  "Grade 2 - Section A",
  "Grade 2 - Section B",
  "Grade 3 - Section A",
  "Grade 3 - Section B",
  "Grade 4 - Section A",
  "Grade 4 - Section B",
  "Grade 5 - Section A",
  "Grade 5 - Section B",
  "Grade 6 - Section A",
  "Grade 6 - Section B",
];

const slotLabel = (value) =>
  TIME_SLOTS.find((s) => s.value === value)?.label ?? value ?? "—";

function ManageTeachers() {
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState("");

  // ── toast ────────────────────────────────────────────────────────────────
  const { toast, showToast } = useToast();

  // ── add menu dropdown ───────────────────────────────────────────────────
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── import state ────────────────────────────────────────────────────────
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importDone, setImportDone] = useState({ success: 0, failed: 0 });
  const [importFinished, setImportFinished] = useState(false);

  // View schedule modal
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewTeacher, setViewTeacher] = useState(null);
  const [teacherSchedules, setTeacherSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);

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

  const emptyForm = {
    empId: "",
    fname: "",
    mname: "",
    lname: "",
    advisory: "",
    contact: "",
    email: "",
  };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    fetchTeachers();
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

  const fetchTeachers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTeachers();
      const sortedData = data.sort((a, b) => {
        const idA = a.empId || "";
        const idB = b.empId || "";
        return idA.localeCompare(idB, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
      setTeachers(sortedData);
    } catch {
      setError("Could not load teachers.");
    } finally {
      setLoading(false);
    }
  };

  // ── Auto-generate Employee ID ─────────────────────────────────────────
  const generateEmpId = (teacherList) => {
    const year = new Date().getFullYear();
    const nextNum = (teacherList.length + 1).toString().padStart(3, "0");
    return `T-${year}-${nextNum}`;
  };

  const openModal = () => {
    setIsEditing(false);
    setEditId(null);
    setFormError("");
    setForm({ ...emptyForm, empId: generateEmpId(teachers) });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setFormError("");
  };

  const validateForm = () => {
    if (!/^\d{11}$/.test(form.contact))
      return "Contact number must be exactly 11 digits.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return "Please enter a valid email address.";
    return "";
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "contact") {
      setForm({ ...form, contact: value.replace(/\D/g, "").slice(0, 11) });
      return;
    }
    setForm({ ...form, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    try {
      const payload = {
        empId: form.empId,
        fname: form.fname,
        mname: form.mname || "",
        lname: form.lname,
        advisory: form.advisory || "",
        contact: form.contact,
        email: form.email || "",
      };
      if (isEditing) await updateTeacher(editId, payload);
      else await addTeacher(payload);

      showToast(
        isEditing
          ? `${form.fname} ${form.lname} was updated successfully.`
          : `${form.fname} ${form.lname} was added successfully.`,
      );
      await fetchTeachers();
      closeModal();
    } catch (err) {
      setFormError(err.message || "Request failed.");
    }
  };

  const editTeacher_ = (t) => {
    setForm({
      empId: t.empId || "",
      fname: t.fname || "",
      mname: t.mname || "",
      lname: t.lname || "",
      advisory: t.advisory || "",
      contact: t.contact || "",
      email: t.email || "",
    });
    setIsEditing(true);
    setEditId(t.id);
    setFormError("");
    setModalOpen(true);
  };

  const archiveTeacher_ = (t) => {
    setConfirm({
      open: true,
      title: "Archive Teacher",
      titleIcon: "fa-archive",
      titleColor: "#e74c3c",
      message: (
        <>
          Are you sure you want to archive{" "}
          <strong>
            {t.fname} {t.lname}
          </strong>
          ? They will be removed from the system but their data will be kept.
        </>
      ),
      confirmText: "Yes, Archive",
      confirmColor: "danger",
      onConfirm: async () => {
        closeConfirm();
        try {
          await archiveTeacher(t.id);
          await fetchTeachers();
          showToast(`${t.fname} ${t.lname} has been archived.`);
        } catch (err) {
          showToast(err.message || "Failed to archive teacher.", true);
        }
      },
    });
  };

  const viewTeacher_ = async (t) => {
    setViewTeacher(t);
    setTeacherSchedules([]);
    setViewModalOpen(true);
    setScheduleLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "Schedule"), where("teacherId", "==", t.id)),
      );
      setTeacherSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setTeacherSchedules([]);
    } finally {
      setScheduleLoading(false);
    }
  };

  // ── BATCH IMPORT ─────────────────────────────────────────────────────────

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Template (data entry sheet) ──────────────────────────────
    const headers = [
      [
        "First Name",
        "Middle Name",
        "Last Name",
        "Advisory Class",
        "Contact (11 digits — format as Text)",
        "Email Address",
      ],
    ];
    const ws = XLSX.utils.aoa_to_sheet(headers);
    ws["!cols"] = [
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 28 },
      { wch: 30 },
      { wch: 28 },
    ];

    // ── Sheet 2: Hidden lookup list for the dropdown ───────────────────────
    const lookupData = [
      ["Advisory Options"],
      ...ADVISORY_OPTIONS.map((o) => [o]),
    ];
    const wsLookup = XLSX.utils.aoa_to_sheet(lookupData);

    XLSX.utils.book_append_sheet(wb, ws, "Teachers");
    XLSX.utils.book_append_sheet(wb, wsLookup, "_AdvisoryList");

    // ── Data validation: dropdown on column D (Advisory Class) ────────────
    // Rows 2–200 (index 1–199) → D2:D200
    // Uses a formula reference to the hidden sheet so the list is dynamic.
    if (!ws["!dataValidation"]) ws["!dataValidation"] = [];
    ws["!dataValidation"].push({
      sqref: "D2:D200",
      type: "list",
      formula1: "_AdvisoryList!$A$2:$A$13",
      showDropDown: false, // false = show the arrow (Excel's counter-intuitive naming)
      showErrorMessage: true,
      errorTitle: "Invalid Advisory Class",
      error:
        "Please select a valid advisory class from the dropdown list, or leave blank for Subject Teacher.",
      errorStyle: "warning",
      showInputMessage: true,
      promptTitle: "Advisory Class",
      prompt:
        "Select from the dropdown, or leave blank if this is a Subject Teacher.",
    });

    XLSX.writeFile(wb, "Teachers_Template.xlsx");
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

        const baseCount = teachers.length;

        // ── Collect advisories already taken in the existing DB list ────────
        // (teachers state is already loaded; we use it for fast in-memory check)
        const takenAdvisoriesInDb = new Set(
          teachers
            .map((t) => (t.advisory || "").trim().toLowerCase())
            .filter(Boolean),
        );

        // ── Track advisories seen so far within this batch ──────────────────
        const advisorySeenInBatch = new Map(); // normalised → row number (1-based)

        const parsed = rows.map((r, i) => {
          const fname = String(r[0] || "").trim();
          const mname = String(r[1] || "").trim();
          const lname = String(r[2] || "").trim();
          const advisory = String(r[3] || "").trim();
          const contact = String(r[4] || "")
            .replace(/\D/g, "")
            .padStart(11, "0")
            .slice(0, 11);
          const email = String(r[5] || "").trim();

          const year = new Date().getFullYear();
          const seqNum = (baseCount + i + 1).toString().padStart(3, "0");
          const empId = `T-${year}-${seqNum}`;

          const errs = [];
          if (!fname) errs.push("First name required");
          if (!lname) errs.push("Last name required");
          if (!/^\d{11}$/.test(contact)) errs.push("Contact must be 11 digits");
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            errs.push("Invalid email");

          // Advisory validations (only when an advisory is provided)
          if (advisory) {
            const normAdvisory = advisory.toLowerCase();

            // 1. Must be one of the recognised advisory options
            const isValidOption = ADVISORY_OPTIONS.some(
              (o) => o.toLowerCase() === normAdvisory,
            );
            if (!isValidOption) {
              errs.push(`"${advisory}" is not a valid advisory class`);
            } else {
              // 2. Already assigned to an existing teacher in the DB
              if (takenAdvisoriesInDb.has(normAdvisory)) {
                errs.push(
                  `${advisory} is already assigned to an existing teacher`,
                );
              }

              // 3. Duplicate advisory within this import batch
              if (advisorySeenInBatch.has(normAdvisory)) {
                errs.push(
                  `${advisory} is already used by Row ${advisorySeenInBatch.get(normAdvisory)} in this file`,
                );
              } else {
                // Only register it if it passed the DB check (avoids cascading dup errors)
                if (!takenAdvisoriesInDb.has(normAdvisory)) {
                  advisorySeenInBatch.set(normAdvisory, i + 2); // row number (header = 1)
                }
              }
            }
          }

          return {
            row: i + 2,
            empId,
            fname,
            mname,
            lname,
            advisory,
            contact,
            email,
            errs,
          };
        });

        setImportRows(parsed);
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

  const handleImportSave = async () => {
    const validRows = importRows.filter((r) => r.errs.length === 0);
    if (validRows.length === 0) return;
    setImportLoading(true);
    let success = 0;
    let failed = 0;
    const newErrors = [...importErrors];

    for (const row of validRows) {
      try {
        await addTeacher({
          empId: row.empId,
          fname: row.fname,
          mname: row.mname,
          lname: row.lname,
          advisory: row.advisory,
          contact: row.contact,
          email: row.email,
        });
        success++;
      } catch (err) {
        newErrors.push(
          `Row ${row.row} (${row.fname} ${row.lname}): ${err.message}`,
        );
        failed++;
      }
    }

    await fetchTeachers();
    setImportLoading(false);
    setImportDone({ success, failed });
    setImportFinished(true);
    setImportErrors(newErrors);
    setImportRows([]);

    if (success > 0) {
      showToast(
        `${success} teacher${success !== 1 ? "s" : ""} imported successfully.${
          failed > 0 ? ` ${failed} failed.` : ""
        }`,
        failed > 0,
      );
    } else if (failed > 0) {
      showToast(`Import failed for all ${failed} row(s).`, true);
    }
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

      <main className="main-content">
        <div className="page-container">
          <div className="toolbar">
            <div>
              <h2>Teacher Masterlist</h2>
              <p>Manage school faculty and class advisers.</p>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button className="btn-import-mt" onClick={downloadTemplate}>
                <i className="fas fa-download"></i> Download Template
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />

              <div style={{ position: "relative" }} ref={addMenuRef}>
                <button
                  className="btn-add-mt"
                  type="button"
                  onClick={() => setAddMenuOpen(!addMenuOpen)}
                >
                  <i className="fas fa-plus"></i> Add Teacher
                </button>

                {addMenuOpen && (
                  <div className="add-menu-popup">
                    <button
                      className="add-menu-item"
                      onClick={() => {
                        setAddMenuOpen(false);
                        openModal();
                      }}
                    >
                      <i
                        className="fas fa-user-plus"
                        style={{ color: "#a65f81" }}
                      ></i>
                      Add Teacher Manually
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
                      Import Teacher
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div style={{ color: "red", marginBottom: "1rem" }}>{error}</div>
          )}

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Teacher Name</th>
                  <th>Advisory Class</th>
                  <th>Contact No.</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center" }}>
                      Loading...
                    </td>
                  </tr>
                ) : teachers.length === 0 ? (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center" }}>
                      No teachers found.
                    </td>
                  </tr>
                ) : (
                  teachers.map((t) => (
                    <tr key={t.id}>
                      <td>{t.empId}</td>
                      <td>
                        <strong>
                          {t.lname}, {t.fname}
                          {t.mname
                            ? ` ${t.mname.charAt(0).toUpperCase()}.`
                            : ""}
                        </strong>
                        <br />
                        <small>{t.email || "No Email"}</small>
                      </td>
                      <td>
                        {t.advisory ? (
                          <strong>{t.advisory} Adviser</strong>
                        ) : (
                          <span>Subject Teacher</span>
                        )}
                      </td>
                      <td>{t.contact}</td>
                      <td>
                        <button
                          className="btn-view-teacher"
                          onClick={() => viewTeacher_(t)}
                          title="View Schedule"
                        >
                          <i className="fas fa-eye"></i>
                        </button>
                        <button
                          className="btn-edit-teacher"
                          onClick={() => editTeacher_(t)}
                          title="Edit"
                        >
                          <i className="fas fa-edit"></i>
                        </button>
                        <button
                          className="btn-archive-teacher"
                          onClick={() => archiveTeacher_(t)}
                          title="Archive teacher"
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
      </main>

      {/* ── ADD / EDIT MODAL ── */}
      {modalOpen && (
        <div
          className="modal-overlay"
          style={{ display: "flex", zIndex: 9999 }}
        >
          <div className="modal-content-teacher add-teacher-modal">
            <div className="modal-header">
              <h3>
                {isEditing ? "Edit Teacher Profile" : "Add Teacher Profile"}
              </h3>
              <span className="close-modal" onClick={closeModal}>
                &times;
              </span>
            </div>
            <div className="modal-body">
              <form
                id="teacherForm"
                className="grid-form"
                onSubmit={handleSubmit}
              >
                <div className="form-group span-3">
                  <label>
                    Employee ID{" "}
                    {!isEditing && (
                      <small style={{ color: "#a65f81" }}>
                        (auto-generated)
                      </small>
                    )}
                  </label>
                  <div className="empID-auto">{form.empId}</div>
                </div>
                <div className="form-group">
                  <label>First Name</label>
                  <input
                    type="text"
                    name="fname"
                    placeholder="First Name"
                    value={form.fname}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Middle Name</label>
                  <input
                    type="text"
                    name="mname"
                    placeholder="Middle Name"
                    value={form.mname}
                    onChange={handleChange}
                  />
                </div>
                <div className="form-group">
                  <label>Last Name</label>
                  <input
                    type="text"
                    name="lname"
                    placeholder="Last Name"
                    value={form.lname}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Advisory Class</label>
                  <select
                    name="advisory"
                    value={form.advisory}
                    onChange={handleChange}
                  >
                    <option value="">-- Subject Teacher --</option>
                    {ADVISORY_OPTIONS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>
                    Contact Number{" "}
                    <small style={{ color: "#888" }}>(11 digits)</small>
                  </label>
                  <input
                    type="text"
                    name="contact"
                    placeholder="e.g. 09123456789"
                    value={form.contact}
                    onChange={handleChange}
                    pattern="\d{11}"
                    maxLength={11}
                    required
                  />
                </div>
                <div className="form-group span-3">
                  <label>E-mail Address</label>
                  <input
                    type="email"
                    name="email"
                    placeholder="e.g. teacher@deped.gov.ph"
                    value={form.email}
                    onChange={handleChange}
                  />
                </div>
              </form>
              {formError && (
                <div
                  style={{
                    color: "red",
                    fontSize: "0.85rem",
                    marginTop: "8px",
                    background: "#fff0f0",
                    padding: "8px",
                    borderRadius: "6px",
                  }}
                >
                  ⚠ {formError}
                </div>
              )}
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={closeModal}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-save" form="teacherForm">
                  {isEditing ? "Update Profile" : "Save Profile"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW SCHEDULE MODAL ── */}
      {viewModalOpen && viewTeacher && (
        <div
          className="modal-overlay"
          style={{ display: "flex", zIndex: 9999 }}
        >
          <div className="modal-content-teacher add-teacher-modal">
            <div className="modal-header">
              <h3>
                {viewTeacher.lname}, {viewTeacher.fname} — Schedule
              </h3>
              <span
                className="close-modal"
                onClick={() => setViewModalOpen(false)}
              >
                &times;
              </span>
            </div>
            <div className="modal-body">
              {scheduleLoading ? (
                <p style={{ textAlign: "center", padding: "20px" }}>
                  Loading...
                </p>
              ) : teacherSchedules.length === 0 ? (
                <p
                  style={{
                    textAlign: "center",
                    color: "#999",
                    padding: "20px",
                  }}
                >
                  No schedules assigned to this teacher.
                </p>
              ) : (
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th>Grade & Section</th>
                        <th>Days</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacherSchedules.map((s) => (
                        <tr key={s.id}>
                          <td>{s.subject}</td>
                          <td>
                            Grade {s.grade} — {s.section}
                          </td>
                          <td>{s.days || "Sunday – Thursday"}</td>
                          <td>
                            {slotLabel(
                              s.timeSlot ||
                                (s.start && s.end
                                  ? `${s.start}-${s.end}`
                                  : null),
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
            className="modal-content-teacher add-teacher-modal"
            style={{ maxWidth: "780px", width: "95%" }}
          >
            <div className="modal-header">
              <h3>
                <i
                  className="fas fa-file-import"
                  style={{ marginRight: "8px" }}
                ></i>
                Import Teachers
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
                      className="data-table"
                      style={{ fontSize: "0.8rem" }}
                    >
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Emp ID (Auto)</th>
                          <th>First Name</th>
                          <th>Last Name</th>
                          <th>Advisory</th>
                          <th>Contact</th>
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
                            <td style={{ color: "#a65f81", fontWeight: 600 }}>
                              {r.empId}
                            </td>
                            <td>{r.fname}</td>
                            <td>{r.lname}</td>
                            <td>
                              {r.advisory ? (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    background: "#eaf4fb",
                                    color: "#2980b9",
                                    padding: "2px 8px",
                                    borderRadius: "12px",
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {r.advisory}
                                </span>
                              ) : (
                                <span
                                  style={{ color: "#aaa", fontSize: "0.75rem" }}
                                >
                                  Subject Teacher
                                </span>
                              )}
                            </td>
                            <td>{r.contact}</td>
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
                                  {r.errs.join("; ")}
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
                      {importDone.success} teacher(s) imported successfully.
                    </div>
                  )}
                  {importDone.failed > 0 && (
                    <div className="import-error-box">
                      {importErrors.map((e, i) => (
                        <div key={i}>⚠ {e}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
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
                    : `Import ${validCount} Teacher${validCount !== 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default ManageTeachers;

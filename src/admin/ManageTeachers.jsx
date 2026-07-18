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
import useSubmitGuard from "../common/useSubmitGuard";
import useNetworkStatus from "../common/useNetworkStatus";
import useCachedFetch from "../common/useCachedFetch";
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

const normalizeForMatch = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "");

const matchAdvisoryOption = (raw) => {
  const norm = normalizeForMatch(raw);
  if (!norm) return null;
  return ADVISORY_OPTIONS.find((o) => normalizeForMatch(o) === norm) || null;
};

const GENDER_OPTIONS = ["Male", "Female"];

const matchGenderOption = (raw) => {
  const norm = String(raw || "")
    .trim()
    .toLowerCase();
  if (!norm) return null;
  if (norm === "m" || norm === "male") return "Male";
  if (norm === "f" || norm === "female") return "Female";
  return null;
};

function ManageTeachers() {
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState("");

  const [sortField, setSortField] = useState("empId");
  const [sortOrder, setSortOrder] = useState("asc");

  const [teacherSearch, setTeacherSearch] = useState("");
  const [scheduleSortConfig, setScheduleSortConfig] = useState({
    key: "time",
    direction: "asc",
  });

  const { toast, showToast } = useToast();
  const { isOnline } = useNetworkStatus();

  const guardSubmit = useSubmitGuard();
  const guardImport = useSubmitGuard();

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef(null);
  const fileInputRef = useRef(null);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importDone, setImportDone] = useState({ success: 0, failed: 0 });
  const [importFinished, setImportFinished] = useState(false);

  // Separate states for Profile View vs Schedule View
  const [viewProfileOpen, setViewProfileOpen] = useState(false);
  const [viewingProfile, setViewingProfile] = useState(null);

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
    gender: "",
    advisory: "",
    contact: "",
    email: "",
  };
  // FIX: this was `const [form = form, setForm] = useState(emptyForm);`
  // — a default-value destructure referencing itself, which is invalid.
  const [form, setForm] = useState(emptyForm);

  // Cached teacher list — renders last-known data instantly (even before
  // Firestore's offline cache resolves), same pattern as ManageStudents.
  const {
    data: cachedTeachers,
    setData: setTeachers,
    loading: teachersLoading,
    refresh: refreshTeachers,
  } = useCachedFetch("teachers:all", () => getTeachers(), []);
  const teachers = cachedTeachers || [];

  useEffect(() => {
    const handler = (e) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target))
        setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const generateEmpId = (teacherList) => {
    const year = new Date().getFullYear();
    let maxNum = 0;

    teacherList.forEach((t) => {
      if (t.empId) {
        const parts = t.empId.split("-");
        if (parts.length === 3) {
          const num = parseInt(parts[2], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    });

    const nextNum = (maxNum + 1).toString().padStart(3, "0");
    return `T-${year}-${nextNum}`;
  };

  const takenAdvisories = new Set(
    teachers
      .filter((t) => t.id !== editId)
      .map((t) => (t.advisory || "").trim())
      .filter(Boolean),
  );

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
    if (!form.gender) return "Please select a gender.";
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

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError("");
    const err = validateForm();
    if (err) {
      setFormError(err);
      return;
    }
    guardSubmit(() => doSubmit());
  };

  const doSubmit = () => {
    const payload = {
      empId: form.empId,
      fname: form.fname,
      mname: form.mname || "",
      lname: form.lname,
      gender: form.gender || "",
      advisory: form.advisory || "",
      contact: form.contact,
      email: form.email || "",
    };
    const wasEditing = isEditing;
    const editingId = editId;

    closeModal();
    showToast(
      isOnline
        ? `${form.fname} ${form.lname} was ${wasEditing ? "updated" : "added"} successfully.`
        : `${form.fname} ${form.lname} saved offline — will sync when back online.`,
    );

    if (wasEditing) {
      setTeachers((prev) =>
        (prev || []).map((t) =>
          t.id === editingId ? { ...t, ...payload } : t,
        ),
      );
    }

    const savePromise = wasEditing
      ? updateTeacher(editingId, payload)
      : addTeacher(payload);

    savePromise
      .then(() => refreshTeachers())
      .catch((err) => {
        if (wasEditing) refreshTeachers();
        showToast(
          `Failed to save ${form.fname} ${form.lname}: ${err.message}`,
          true,
        );
      });
  };

  const editTeacher_ = (t) => {
    const resolvedAdvisory = t.advisory
      ? matchAdvisoryOption(t.advisory) || t.advisory
      : "";

    setForm({
      empId: t.empId || "",
      fname: t.fname || "",
      mname: t.mname || "",
      lname: t.lname || "",
      gender: matchGenderOption(t.gender) || t.gender || "",
      advisory: resolvedAdvisory,
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
      onConfirm: () => {
        closeConfirm();
        setTeachers((prev) => (prev || []).filter((x) => x.id !== t.id));
        showToast(
          isOnline
            ? `${t.fname} ${t.lname} has been archived.`
            : `${t.fname} ${t.lname} archived offline — will sync when back online.`,
        );
        archiveTeacher(t.id)
          .then(() => refreshTeachers())
          .catch((err) => {
            showToast(err.message || "Failed to archive teacher.", true);
          });
      },
    });
  };

  // Opens the read-only Teacher Information Modal
  const handleViewProfile = (t) => {
    setViewingProfile(t);
    setViewProfileOpen(true);
  };

  // Opens the Teacher Schedule Modal
  const viewTeacher_ = async (t) => {
    setViewTeacher(t);
    setTeacherSchedules([]);
    setScheduleSortConfig({ key: "time", direction: "asc" });
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

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    const headers = [
      [
        "First Name",
        "Middle Name",
        "Last Name",
        "Gender (Male/Female)",
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
      { wch: 18 },
      { wch: 28 },
      { wch: 30 },
      { wch: 28 },
    ];

    const lookupData = [
      ["Advisory Options"],
      ...ADVISORY_OPTIONS.map((o) => [o]),
    ];
    const wsLookup = XLSX.utils.aoa_to_sheet(lookupData);

    XLSX.utils.book_append_sheet(wb, ws, "Teachers");
    XLSX.utils.book_append_sheet(wb, wsLookup, "_AdvisoryList");

    if (!ws["!dataValidation"]) ws["!dataValidation"] = [];

    ws["!dataValidation"].push({
      sqref: "D2:D200",
      type: "list",
      formula1: '"Male,Female"',
      showDropDown: false,
      showErrorMessage: true,
      errorTitle: "Invalid Gender",
      error: "Please select Male or Female from the dropdown.",
      errorStyle: "warning",
      showInputMessage: true,
      promptTitle: "Gender",
      prompt: "Select Male or Female.",
    });

    ws["!dataValidation"].push({
      sqref: "E2:E200",
      type: "list",
      formula1: "_AdvisoryList!$A$2:$A$13",
      showDropDown: false,
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

        let maxNum = 0;
        teachers.forEach((t) => {
          if (t.empId) {
            const parts = t.empId.split("-");
            if (parts.length === 3) {
              const num = parseInt(parts[2], 10);
              if (!isNaN(num) && num > maxNum) {
                maxNum = num;
              }
            }
          }
        });

        const takenAdvisoriesInDb = new Set(
          teachers
            .map((t) => (t.advisory || "").trim().toLowerCase())
            .filter(Boolean),
        );

        const advisorySeenInBatch = new Map();

        const parsed = rows.map((r, i) => {
          const fname = String(r[0] || "").trim();
          const mname = String(r[1] || "").trim();
          const lname = String(r[2] || "").trim();
          const genderRaw = String(r[3] || "").trim();
          const advisoryRaw = String(r[4] || "").trim();
          const contact = String(r[5] || "")
            .replace(/\D/g, "")
            .padStart(11, "0")
            .slice(0, 11);
          const email = String(r[6] || "").trim();

          const year = new Date().getFullYear();
          const seqNum = (maxNum + i + 1).toString().padStart(3, "0");
          const empId = `T-${year}-${seqNum}`;

          const errs = [];
          if (!fname) errs.push("First name required");
          if (!lname) errs.push("Last name required");
          if (!/^\d{11}$/.test(contact)) errs.push("Contact must be 11 digits");
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            errs.push("Invalid email");

          let gender = "";
          const matchedGender = matchGenderOption(genderRaw);
          if (genderRaw && !matchedGender) {
            errs.push(`"${genderRaw}" is not a valid gender`);
          } else {
            gender = matchedGender;
          }

          let advisory = "";
          if (advisoryRaw) {
            const matchedOption = matchAdvisoryOption(advisoryRaw);

            if (!matchedOption) {
              errs.push(`"${advisoryRaw}" is not a valid advisory class`);
            } else {
              advisory = matchedOption;
              const normAdvisory = matchedOption.toLowerCase();

              if (takenAdvisoriesInDb.has(normAdvisory)) {
                errs.push(
                  `${matchedOption} is already assigned to an existing teacher`,
                );
              }

              if (advisorySeenInBatch.has(normAdvisory)) {
                errs.push(
                  `${matchedOption} is already used by Row ${advisorySeenInBatch.get(normAdvisory)} in this file`,
                );
              } else {
                if (!takenAdvisoriesInDb.has(normAdvisory)) {
                  advisorySeenInBatch.set(normAdvisory, i + 2);
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
            gender,
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
        empId: row.empId,
        fname: row.fname,
        mname: row.mname,
        lname: row.lname,
        gender: row.gender,
        advisory: row.advisory,
        contact: row.contact,
        email: row.email,
      };
      return addTeacher(payload)
        .then((created) => ({ ok: true, row, created }))
        .catch((err) => ({ ok: false, row, error: err }));
    });

    setTeachers((prev) => [
      ...(prev || []),
      ...tempRows.map((row) => ({
        id: row._tempId,
        empId: row.empId,
        fname: row.fname,
        mname: row.mname,
        lname: row.lname,
        gender: row.gender,
        advisory: row.advisory,
        contact: row.contact,
        email: row.email,
      })),
    ]);

    setImportLoading(false);
    setImportDone({ success: tempRows.length, failed: 0 });
    setImportFinished(true);
    setImportErrors([]);
    setImportRows([]);
    showToast(
      isOnline
        ? `${tempRows.length} teacher${tempRows.length !== 1 ? "s" : ""} imported successfully.`
        : `${tempRows.length} teacher${tempRows.length !== 1 ? "s" : ""} saved offline — will sync when back online.`,
    );

    Promise.allSettled(pending).then((settled) => {
      const failMsgs = [];
      let anyFailed = false;
      settled.forEach((s) => {
        const outcome = s.value;
        if (!outcome) return;
        if (!outcome.ok) {
          anyFailed = true;
          failMsgs.push(
            `Row ${outcome.row.row} (${outcome.row.fname} ${outcome.row.lname}): ${outcome.error.message}`,
          );
        }
      });
      refreshTeachers();
      if (anyFailed) {
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

  const handleSortToggle = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const filteredTeachers = teachers.filter((t) => {
    if (!teacherSearch) return true;

    const term = teacherSearch.toLowerCase();
    const fullName =
      `${t.fname || ""} ${t.mname || ""} ${t.lname || ""}`.toLowerCase();
    const empId = (t.empId || "").toLowerCase();
    const advisory = (t.advisory || "").toLowerCase();

    return (
      fullName.includes(term) || empId.includes(term) || advisory.includes(term)
    );
  });

  const sortedTeachers = [...filteredTeachers].sort((a, b) => {
    if (sortField === "empId") {
      const idA = a.empId || "";
      const idB = b.empId || "";
      return sortOrder === "asc"
        ? idA.localeCompare(idB, undefined, { numeric: true })
        : idB.localeCompare(idA, undefined, { numeric: true });
    }

    if (sortField === "name") {
      const nameA = `${a.lname || ""} ${a.fname || ""}`.toLowerCase();
      const nameB = `${b.lname || ""} ${b.fname || ""}`.toLowerCase();
      return sortOrder === "asc"
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
    }
    return 0;
  });

  const handleScheduleSort = (key) => {
    let direction = "asc";
    if (
      scheduleSortConfig.key === key &&
      scheduleSortConfig.direction === "asc"
    ) {
      direction = "desc";
    }
    setScheduleSortConfig({ key, direction });
  };

  const visibleSchedules = [...teacherSchedules].sort((a, b) => {
    const dir = scheduleSortConfig.direction === "asc" ? 1 : -1;

    if (scheduleSortConfig.key === "gradeSection") {
      const gradeA = parseInt(a.grade, 10) || 0;
      const gradeB = parseInt(b.grade, 10) || 0;
      if (gradeA !== gradeB) return (gradeA - gradeB) * dir;
      const secA = (a.section || "").toLowerCase();
      const secB = (b.section || "").toLowerCase();
      return secA.localeCompare(secB) * dir;
    }

    if (scheduleSortConfig.key === "time") {
      const timeA = a.timeSlot || a.start || "";
      const timeB = b.timeSlot || b.start || "";
      return timeA.localeCompare(timeB) * dir;
    }

    const valA = String(a[scheduleSortConfig.key] || "").toLowerCase();
    const valB = String(b[scheduleSortConfig.key] || "").toLowerCase();
    return valA.localeCompare(valB, undefined, { numeric: true }) * dir;
  });

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
          <div className="toolbar-mt">
            <div>
              <h2>Teacher Masterlist</h2>
              <p>Manage school faculty</p>
            </div>

            <div className="teacher-toolbar-actions">
              <div className="mt-search-input-wrap">
                <i className="fas fa-search mt-search-icon"></i>
                <input
                  type="text"
                  className="mt-search-input"
                  placeholder="Search name or ID..."
                  value={teacherSearch}
                  onChange={(e) => setTeacherSearch(e.target.value)}
                />

                {teacherSearch && (
                  <button
                    type="button"
                    className="mt-search-clear"
                    onClick={() => setTeacherSearch("")}
                    aria-label="Clear search"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                )}
              </div>
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
            <table className="data-table-mt">
              <thead>
                <tr>
                  <th
                    onClick={() => handleSortToggle("empId")}
                    className="sortable-table-header"
                  >
                    Employee ID
                    <i
                      className={`fas ${sortField === "empId" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}
                    ></i>
                    <span className="mt-sort-hint-label"></span>
                  </th>
                  <th
                    onClick={() => handleSortToggle("name")}
                    className="sortable-table-header"
                  >
                    Teacher Name
                    <i
                      className={`fas ${sortField === "name" ? (sortOrder === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}
                    ></i>
                    <span className="mt-sort-hint-label"></span>
                  </th>
                  <th>Gender</th>
                  <th>Advisory Class</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {teachersLoading && teachers.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      style={{ textAlign: "center", padding: "20px" }}
                    >
                      Loading...
                    </td>
                  </tr>
                ) : sortedTeachers.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      style={{ textAlign: "center", padding: "20px" }}
                    >
                      {teacherSearch
                        ? `No teachers found for "${teacherSearch}".`
                        : "No teachers found."}
                    </td>
                  </tr>
                ) : (
                  sortedTeachers.map((t) => (
                    <tr key={t.id}>
                      <td>{t.empId}</td>
                      <td>
                        <button
                          className="teacher-clickable-name-link"
                          onClick={() => handleViewProfile(t)}
                          title="Click to view teacher profile details"
                        >
                          {t.lname}, {t.fname}
                          {t.mname
                            ? ` ${t.mname.charAt(0).toUpperCase()}.`
                            : ""}
                        </button>
                        <br />
                        <small style={{ color: "#7f8c8d" }}>
                          {t.email || "No Email"}
                        </small>
                      </td>
                      <td>{t.gender || "—"}</td>
                      <td>
                        {t.advisory ? (
                          <strong>{t.advisory} Adviser</strong>
                        ) : (
                          <span style={{ color: "#888" }}>Subject Teacher</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
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

      {/* ── EXACT READ-ONLY VIEW PROFILE MODAL ── */}
      {viewProfileOpen && viewingProfile && (
        <div
          className="mt-modal-overlay"
          onClick={() => setViewProfileOpen(false)}
        >
          <div
            className="mt-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                <div className="modal-header-icon">
                  <i className="fas fa-address-card"></i>
                </div>
                Teacher Information
              </h3>
              <button
                className="close-modal"
                onClick={() => setViewProfileOpen(false)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="modal-body">
              <div className="teacher-info-top">
                <div className="teacher-name-block">
                  <h2 className="teacher-name">
                    {viewingProfile.lname}, {viewingProfile.fname}{" "}
                    {viewingProfile.mname}
                  </h2>
                  {viewingProfile.advisory ? (
                    <span className="teacher-role-pill">
                      Adviser: {viewingProfile.advisory}
                    </span>
                  ) : (
                    <span className="teacher-role-pill">Subject Teacher</span>
                  )}
                </div>
              </div>

              <hr className="teacher-info-divider" />

              <div className="mt-grid">
                <div className="mt-field-group mt-grid-span-2">
                  <label className="mt-field-label">Employee ID</label>
                  <div className="mt-view-box emp-highlight">
                    {viewingProfile.empId}
                  </div>
                </div>
                <div className="mt-field-group">
                  <label className="mt-field-label">First name</label>
                  <div className="mt-view-box">{viewingProfile.fname}</div>
                </div>
                <div className="mt-field-group">
                  <label className="mt-field-label">Middle name</label>
                  <div className="mt-view-box">
                    {viewingProfile.mname || "—"}
                  </div>
                </div>
                <div className="mt-field-group">
                  <label className="mt-field-label">Last name</label>
                  <div className="mt-view-box">{viewingProfile.lname}</div>
                </div>

                {viewingProfile.gender && (
                  <div className="mt-field-group">
                    <label className="mt-field-label">Gender</label>
                    <div className="mt-view-box">{viewingProfile.gender}</div>
                  </div>
                )}
                <div className="mt-field-group">
                  <label className="mt-field-label">Advisory Class</label>
                  <div className="mt-view-box">
                    {viewingProfile.advisory || "Subject Teacher"}
                  </div>
                </div>
                <div className="mt-field-group">
                  <label className="mt-field-label">Contact number</label>
                  <div className="mt-view-box">{viewingProfile.contact}</div>
                </div>

                <div className="mt-field-group mt-grid-span-3">
                  <label className="mt-field-label">E-mail address</label>
                  <div className="mt-view-box">
                    {viewingProfile.email || "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {modalOpen && (
        <div
          className="mt-modal-overlay"
          onClick={() => {
            setModalOpen(false);
            setFormError("");
          }}
        >
          <div
            className="mt-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                <div className="modal-header-icon">
                  <i
                    className={
                      isEditing ? "fas fa-user-edit" : "fas fa-user-plus"
                    }
                  ></i>
                </div>
                {isEditing ? "Edit Teacher Profile" : "Add Teacher Profile"}
              </h3>
              <button className="close-modal" onClick={closeModal}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="modal-body">
              {formError && (
                <div
                  style={{
                    color: "#c0392b",
                    fontSize: "0.85rem",
                    marginBottom: "15px",
                    background: "rgba(231, 76, 60, 0.1)",
                    padding: "10px 14px",
                    borderRadius: "12px",
                    border: "1px solid rgba(231, 76, 60, 0.2)",
                  }}
                >
                  <i
                    className="fas fa-exclamation-circle"
                    style={{ marginRight: "6px" }}
                  ></i>{" "}
                  {formError}
                </div>
              )}

              <form
                id="teacherForm"
                className="mt-grid"
                onSubmit={handleSubmit}
              >
                <div className="mt-field-group mt-grid-span-3">
                  <label className="mt-field-label">
                    Employee ID{" "}
                    {!isEditing && (
                      <span
                        style={{
                          textTransform: "none",
                          letterSpacing: "normal",
                          fontWeight: "500",
                        }}
                      >
                        (auto-generated)
                      </span>
                    )}
                  </label>
                  <input
                    className="mt-input emp-highlight"
                    type="text"
                    value={form.empId}
                    readOnly
                  />
                </div>

                <div className="mt-field-group">
                  <label className="mt-field-label">First Name</label>
                  <input
                    className="mt-input"
                    type="text"
                    name="fname"
                    value={form.fname}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="mt-field-group">
                  <label className="mt-field-label">Middle Name</label>
                  <input
                    className="mt-input"
                    type="text"
                    name="mname"
                    value={form.mname}
                    onChange={handleChange}
                  />
                </div>
                <div className="mt-field-group">
                  <label className="mt-field-label">Last Name</label>
                  <input
                    className="mt-input"
                    type="text"
                    name="lname"
                    value={form.lname}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="mt-field-group">
                  <label className="mt-field-label">Gender</label>
                  <select
                    className="mt-input"
                    name="gender"
                    value={form.gender}
                    onChange={handleChange}
                    required
                  >
                    <option value="">-- Select Gender --</option>
                    {GENDER_OPTIONS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-field-group">
                  <label className="mt-field-label">Advisory Class</label>
                  <select
                    className="mt-input"
                    name="advisory"
                    value={form.advisory}
                    onChange={handleChange}
                  >
                    <option value="">-- Subject Teacher --</option>
                    {ADVISORY_OPTIONS.map((o) => {
                      const isTaken =
                        takenAdvisories.has(o) && o !== form.advisory;
                      return (
                        <option key={o} value={o} disabled={isTaken}>
                          {o}
                          {isTaken ? " (Already assigned)" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="mt-field-group">
                  <label className="mt-field-label">
                    Contact Number{" "}
                    <span
                      style={{
                        textTransform: "none",
                        letterSpacing: "normal",
                        fontWeight: "500",
                      }}
                    >
                      (11 digits)
                    </span>
                  </label>
                  <input
                    className="mt-input"
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
                <div className="mt-field-group mt-grid-span-3">
                  <label className="mt-field-label">E-mail Address</label>
                  <input
                    className="mt-input"
                    type="email"
                    name="email"
                    placeholder="e.g. teacher@deped.gov.ph"
                    value={form.email}
                    onChange={handleChange}
                  />
                </div>
              </form>
            </div>

            <div className="modal-footer-mt">
              <button type="submit" className="btn-save" form="teacherForm">
                {isEditing ? "Update Profile" : "Save Profile"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW SCHEDULE MODAL ── */}
      {viewModalOpen && viewTeacher && (
        <div
          className="mt-modal-overlay"
          onClick={() => setViewModalOpen(false)}
        >
          <div
            className="mt-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                <div className="modal-header-icon">
                  <i className="fas fa-calendar-alt"></i>
                </div>
                {viewTeacher.lname}, {viewTeacher.fname} — Schedule
              </h3>
              <button
                className="close-modal"
                onClick={() => setViewModalOpen(false)}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            <div className="modal-body">
              {scheduleLoading ? (
                <p
                  style={{
                    textAlign: "center",
                    padding: "30px",
                    color: "#95a5a6",
                  }}
                >
                  Loading schedules...
                </p>
              ) : teacherSchedules.length === 0 ? (
                <p
                  style={{
                    textAlign: "center",
                    padding: "30px",
                    color: "#95a5a6",
                  }}
                >
                  No schedules assigned to this teacher.
                </p>
              ) : (
                <div
                  className="table-container"
                  style={{
                    borderRadius: "12px",
                    border: "1px solid #eef1f6",
                    boxShadow: "none",
                    marginTop: "0",
                  }}
                >
                  <table className="data-table-mt" style={{ margin: "0" }}>
                    <thead>
                      <tr>
                        <th
                          className="sortable-table-header"
                          onClick={() => handleScheduleSort("subject")}
                          style={{ borderTop: "none" }}
                        >
                          Subject{" "}
                          <i
                            className={`fas ${scheduleSortConfig.key === "subject" ? (scheduleSortConfig.direction === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}
                          ></i>
                          <span className="mt-sort-hint-label"></span>
                        </th>
                        <th
                          className="sortable-table-header"
                          onClick={() => handleScheduleSort("gradeSection")}
                          style={{ borderTop: "none" }}
                        >
                          Grade & Section{" "}
                          <i
                            className={`fas ${scheduleSortConfig.key === "gradeSection" ? (scheduleSortConfig.direction === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}
                          ></i>
                          <span className="mt-sort-hint-label"></span>
                        </th>
                        <th
                          className="sortable-table-header"
                          onClick={() => handleScheduleSort("time")}
                          style={{ borderTop: "none" }}
                        >
                          Time{" "}
                          <i
                            className={`fas ${scheduleSortConfig.key === "time" ? (scheduleSortConfig.direction === "asc" ? "fa-sort-up mt-header-sorted" : "fa-sort-down mt-header-sorted") : "fa-sort mt-header-unsorted"}`}
                          ></i>
                          <span className="mt-sort-hint-label"></span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSchedules.map((s) => (
                        <tr key={s.id}>
                          <td>{s.subject}</td>
                          <td>
                            <span
                              className={`grade-badge grade-${s.grade}`}
                              style={{
                                padding: "4px 10px",
                                fontSize: "0.75rem",
                              }}
                            >
                              Grade {s.grade} — {s.section}
                            </span>
                          </td>
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

            <div className="modal-footer-mt"></div>
          </div>
        </div>
      )}

      {/* ── IMPORT PREVIEW MODAL ── */}
      {importModalOpen && (
        <div className="mt-modal-overlay" onClick={closeImportModal}>
          <div
            className="mt-modal-content"
            style={{ maxWidth: "850px", width: "95%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>
                <div className="modal-header-icon">
                  <i className="fas fa-file-import"></i>
                </div>
                Import Teachers
              </h3>
              <button className="close-modal" onClick={closeImportModal}>
                <i className="fas fa-times"></i>
              </button>
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
                      marginBottom: "15px",
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
                      maxHeight: "350px",
                      overflowY: "auto",
                      borderRadius: "12px",
                      border: "1px solid #eef1f6",
                    }}
                  >
                    <table
                      className="data-table-mt"
                      style={{ fontSize: "0.8rem", margin: 0 }}
                    >
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Emp ID (Auto)</th>
                          <th>First Name</th>
                          <th>Last Name</th>
                          <th>Gender</th>
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
                              background:
                                r.errs.length > 0
                                  ? "rgba(231, 76, 60, 0.05)"
                                  : "",
                            }}
                          >
                            <td>{r.row}</td>
                            <td style={{ color: "#a65f81", fontWeight: 600 }}>
                              {r.empId}
                            </td>
                            <td>{r.fname}</td>
                            <td>{r.lname}</td>
                            <td>{r.gender || "—"}</td>
                            <td>
                              {r.advisory ? (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    background: "#eaf4fb",
                                    color: "#2980b9",
                                    padding: "4px 10px",
                                    borderRadius: "12px",
                                    fontWeight: 700,
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
                                  style={{ color: "#27ae60", fontWeight: 700 }}
                                >
                                  ✓ OK
                                </span>
                              ) : (
                                <span
                                  style={{
                                    color: "#e74c3c",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
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
                      {importDone.success} teacher(s){" "}
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

            <div className="modal-footer-mt">
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

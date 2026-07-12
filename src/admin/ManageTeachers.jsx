// ManageTeachers.jsx  (Firebase version — custom modals + batch import)
// OFFLINE-SAFE VERSION — see ManageStudents.jsx header comment for the
// full explanation of the pattern used here.
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
import useNetworkStatus from "../common/useNetworkStatus"; // adjust path if different
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

// Normalizes a string for "fuzzy" advisory matching — strips ALL whitespace
// and lowercases, so "grade1-sectiona", "Grade 1-SectionA", and
// "Grade 1 - Section A" all resolve to the same canonical option.
const normalizeForMatch = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "");

// Given any raw advisory text, returns the canonically-formatted option from
// ADVISORY_OPTIONS (matching regardless of case/spacing), or null if it
// doesn't match any known advisory class.
const matchAdvisoryOption = (raw) => {
  const norm = normalizeForMatch(raw);
  if (!norm) return null;
  return ADVISORY_OPTIONS.find((o) => normalizeForMatch(o) === norm) || null;
};

// ── Gender options (single source of truth) ───────────────────────────────
const GENDER_OPTIONS = ["Male", "Female"];

// Matches raw gender text ("M", "m", "male", "Female", "f", ...) to the
// canonical "Male" / "Female" label used everywhere else. Returns null if
// the text doesn't resolve to either.
const matchGenderOption = (raw) => {
  const norm = String(raw || "")
    .trim()
    .toLowerCase();
  if (!norm) return null;
  if (norm === "m" || norm === "male") return "Male";
  if (norm === "f" || norm === "female") return "Female";
  return null;
};

function SortIcon({ active, direction }) {
  if (!active) {
    return <i className="fas fa-sort mt-sort-icon"></i>;
  }
  return direction === "asc" ? (
    <i className="fas fa-sort-up mt-sort-icon mt-sort-icon--active"></i>
  ) : (
    <i className="fas fa-sort-down mt-sort-icon mt-sort-icon--active"></i>
  );
}

function ManageTeachers() {
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState("");

  // ── search ────────────────────────────────────────────────────────────
  const [teacherSearch, setTeacherSearch] = useState("");

  // ── sorting (main teacher table) ────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState({
    key: "empId",
    direction: "asc",
  });
  const handleSort = (key) => {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  // ── sorting (teacher schedule modal) ────────────────────────────────────
  const [scheduleSortConfig, setScheduleSortConfig] = useState({
    key: "time",
    direction: "asc",
  });
  const handleScheduleSort = (key) => {
    setScheduleSortConfig((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  // ── toast / network ──────────────────────────────────────────────────────
  const { toast, showToast } = useToast();
  const { isOnline } = useNetworkStatus();

  // ── submit guards ────────────────────────────────────────────────────────
  const guardSubmit = useSubmitGuard();
  const guardImport = useSubmitGuard();

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
    gender: "",
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

  // ── Advisory classes already assigned to another teacher ────────────────
  // Used to disable those options in the Add/Edit dropdown so an advisory
  // that's already taken can't be picked again. When editing, the teacher's
  // own current advisory is excluded from this "taken" set so it stays
  // selectable for them.
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

  // ── ADD / EDIT (offline-safe) ───────────────────────────────────────────
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
      // Explicitly "" clears the advisory back to Subject Teacher — this is
      // a real, intentional value, not something to skip/omit.
      advisory: form.advisory || "",
      contact: form.contact,
      email: form.email || "",
    };
    const wasEditing = isEditing;
    const editingId = editId;

    // Snapshot so we can roll back the optimistic update if the save fails.
    const previousTeachers = teachers;

    // Close + notify immediately — don't wait for the network.
    closeModal();
    showToast(
      isOnline
        ? `${form.fname} ${form.lname} was ${wasEditing ? "updated" : "added"} successfully.`
        : `${form.fname} ${form.lname} saved offline — will sync when back online.`,
    );

    // Optimistically reflect the edit in the table right away (including
    // clearing the advisory to Subject Teacher) instead of waiting for the
    // network round-trip — this is what makes the change to "Subject
    // Teacher" (or any other change) visibly stick immediately.
    if (wasEditing) {
      setTeachers((prev) =>
        prev.map((t) => (t.id === editingId ? { ...t, ...payload } : t)),
      );
    }

    const savePromise = wasEditing
      ? updateTeacher(editingId, payload)
      : addTeacher(payload);

    savePromise
      .then(() => fetchTeachers())
      .catch((err) => {
        // Roll back the optimistic change since the save didn't go through.
        if (wasEditing) setTeachers(previousTeachers);
        showToast(
          `Failed to save ${form.fname} ${form.lname}: ${err.message}`,
          true,
        );
      });
  };

  const editTeacher_ = (t) => {
    // If the stored advisory doesn't exactly match a dropdown option (e.g.
    // it was saved with different casing/spacing before the import
    // normalization fix), resolve it to the canonical option so it shows up
    // correctly selected instead of silently falling back to "Subject
    // Teacher" in the dropdown. Falls back to the raw value if it truly
    // doesn't match anything, so no data is lost.
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
        // Optimistic remove — same offline-safe pattern.
        setTeachers((prev) => prev.filter((x) => x.id !== t.id));
        showToast(
          isOnline
            ? `${t.fname} ${t.lname} has been archived.`
            : `${t.fname} ${t.lname} archived offline — will sync when back online.`,
        );
        archiveTeacher(t.id)
          .then(() => fetchTeachers())
          .catch((err) => {
            showToast(err.message || "Failed to archive teacher.", true);
          });
      },
    });
  };

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

  // ── BATCH IMPORT ─────────────────────────────────────────────────────────

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Template (data entry sheet) ──────────────────────────────
    // Column order: First, Middle, Last, Gender, Advisory Class, Contact, Email
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

    // ── Sheet 2: Hidden lookup list for the Advisory Class dropdown ────────
    const lookupData = [
      ["Advisory Options"],
      ...ADVISORY_OPTIONS.map((o) => [o]),
    ];
    const wsLookup = XLSX.utils.aoa_to_sheet(lookupData);

    XLSX.utils.book_append_sheet(wb, ws, "Teachers");
    XLSX.utils.book_append_sheet(wb, wsLookup, "_AdvisoryList");

    if (!ws["!dataValidation"]) ws["!dataValidation"] = [];

    // ── Data validation: dropdown on column D (Gender) ─────────────────────
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

    // ── Data validation: dropdown on column E (Advisory Class) ─────────────
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

        const baseCount = teachers.length;

        // ── Collect advisories already taken in the existing DB list ────────
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
          const genderRaw = String(r[3] || "").trim();
          const advisoryRaw = String(r[4] || "").trim();
          const contact = String(r[5] || "")
            .replace(/\D/g, "")
            .padStart(11, "0")
            .slice(0, 11);
          const email = String(r[6] || "").trim();

          const year = new Date().getFullYear();
          const seqNum = (baseCount + i + 1).toString().padStart(3, "0");
          const empId = `T-${year}-${seqNum}`;

          const errs = [];
          if (!fname) errs.push("First name required");
          if (!lname) errs.push("Last name required");
          if (!/^\d{11}$/.test(contact)) errs.push("Contact must be 11 digits");
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            errs.push("Invalid email");

          // ── Gender normalization + validation ─────────────────────────────
          // Accepts "M"/"F"/"male"/"female" in any case and stores the
          // canonical "Male"/"Female" label.
          let gender = genderRaw;
          const matchedGender = matchGenderOption(genderRaw);
          if (!matchedGender) {
            errs.push(
              genderRaw
                ? `"${genderRaw}" is not a valid gender (use Male or Female)`
                : "Gender is required (Male or Female)",
            );
          } else {
            gender = matchedGender;
          }

          // ── Advisory normalization + validation ──────────────────────────
          // Matches regardless of case or missing spaces (e.g.
          // "grade1-sectiona" or "GRADE 1-SECTION A" both resolve to the
          // canonical "Grade 1 - Section A"), then stores/displays the
          // canonical, dropdown-formatted value. A blank cell simply means
          // "Subject Teacher" — no advisory assigned, which is a valid,
          // error-free default.
          let advisory = "";
          if (advisoryRaw) {
            const matchedOption = matchAdvisoryOption(advisoryRaw);

            if (!matchedOption) {
              errs.push(`"${advisoryRaw}" is not a valid advisory class`);
            } else {
              advisory = matchedOption; // canonical formatting
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
          // advisory stays "" (Subject Teacher) whenever the cell was left blank.

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

  // Offline-safe bulk import — see ManageStudents.jsx for full explanation.
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

    // Fire all writes now — never blocks the UI.
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

    // Optimistically show them in the table immediately.
    setTeachers((prev) => [
      ...prev,
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

    // Close the import modal right away with an optimistic result.
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

    // Reconcile quietly in the background once writes actually resolve.
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
      // Re-sync the full teacher list from the server rather than trying to
      // splice each temp entry, since empId sequencing depends on final count.
      fetchTeachers();
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

  const validCount = importRows.filter((r) => r.errs.length === 0).length;
  const invalidCount = importRows.filter((r) => r.errs.length > 0).length;

  // ── search filter (teacher table) ───────────────────────────────────────
  const teacherQuery = teacherSearch.trim().toLowerCase();
  const filteredTeachers = !teacherQuery
    ? teachers
    : teachers.filter((t) => {
        const fullName = `${t.lname}, ${t.fname}${
          t.mname ? " " + t.mname : ""
        }`.toLowerCase();
        return (
          fullName.includes(teacherQuery) ||
          String(t.empId || "")
            .toLowerCase()
            .includes(teacherQuery) ||
          String(t.advisory || "")
            .toLowerCase()
            .includes(teacherQuery) ||
          String(t.contact || "")
            .toLowerCase()
            .includes(teacherQuery) ||
          String(t.email || "")
            .toLowerCase()
            .includes(teacherQuery)
        );
      });

  // ── sorting (teacher table) ─────────────────────────────────────────────
  const getTeacherSortValue = (t, key) => {
    switch (key) {
      case "empId":
        return String(t.empId || "");
      case "name":
        return `${t.lname}, ${t.fname}${
          t.mname ? " " + t.mname : ""
        }`.toLowerCase();
      case "gender":
        return (t.gender || "").toLowerCase();
      case "advisory":
        return (t.advisory || "").toLowerCase();
      case "contact":
        return String(t.contact || "");
      default:
        return "";
    }
  };

  const visibleTeachers = filteredTeachers.slice().sort((a, b) => {
    const va = getTeacherSortValue(a, sortConfig.key);
    const vb = getTeacherSortValue(b, sortConfig.key);
    const cmp = String(va).localeCompare(String(vb), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return sortConfig.direction === "asc" ? cmp : -cmp;
  });

  // ── sorting (schedule modal) ────────────────────────────────────────────
  const getScheduleSortValue = (s, key) => {
    switch (key) {
      case "subject":
        return String(s.subject || "").toLowerCase();
      case "gradeSection":
        return `${String(s.grade || "").padStart(2, "0")}-${s.section || ""}`.toLowerCase();
      case "days":
        return String(s.days || "Sunday – Thursday").toLowerCase();
      case "time":
        return String(
          s.timeSlot || (s.start && s.end ? `${s.start}-${s.end}` : ""),
        );
      default:
        return "";
    }
  };

  const visibleSchedules = teacherSchedules.slice().sort((a, b) => {
    const va = getScheduleSortValue(a, scheduleSortConfig.key);
    const vb = getScheduleSortValue(b, scheduleSortConfig.key);
    const cmp = String(va).localeCompare(String(vb), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return scheduleSortConfig.direction === "asc" ? cmp : -cmp;
  });

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
              <p>Manage school faculty and class advisers.</p>
            </div>

            <div className="teacher-toolbar-actions">
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

          {/* ── search bar (same design as the admin dashboard search) ── */}
          <div className="mt-search-bar-row">
            <div className="mt-search-input-wrap">
              <i className="fas fa-search mt-search-icon"></i>
              <input
                type="text"
                className="mt-search-input"
                placeholder="Search name, employee ID, advisory, or contact…"
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
                  ×
                </button>
              )}
            </div>
          </div>

          <div className="table-container">
            <table className="data-table-mt">
              <thead>
                <tr>
                  <th
                    className="mt-th-sortable"
                    onClick={() => handleSort("empId")}
                  >
                    Employee ID{" "}
                    <SortIcon
                      active={sortConfig.key === "empId"}
                      direction={sortConfig.direction}
                    />
                  </th>
                  <th
                    className="mt-th-sortable"
                    onClick={() => handleSort("name")}
                  >
                    Teacher Name{" "}
                    <SortIcon
                      active={sortConfig.key === "name"}
                      direction={sortConfig.direction}
                    />
                  </th>
                  <th
                    className="mt-th-sortable"
                    onClick={() => handleSort("gender")}
                  >
                    Gender{" "}
                    <SortIcon
                      active={sortConfig.key === "gender"}
                      direction={sortConfig.direction}
                    />
                  </th>
                  <th
                    className="mt-th-sortable"
                    onClick={() => handleSort("advisory")}
                  >
                    Advisory Class{" "}
                    <SortIcon
                      active={sortConfig.key === "advisory"}
                      direction={sortConfig.direction}
                    />
                  </th>
                  <th
                    className="mt-th-sortable"
                    onClick={() => handleSort("contact")}
                  >
                    Contact No.{" "}
                    <SortIcon
                      active={sortConfig.key === "contact"}
                      direction={sortConfig.direction}
                    />
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center" }}>
                      Loading...
                    </td>
                  </tr>
                ) : visibleTeachers.length === 0 ? (
                  <tr>
                    <td colSpan="6" style={{ textAlign: "center" }}>
                      {teacherQuery
                        ? `No teachers found for "${teacherSearch}".`
                        : "No teachers found."}
                    </td>
                  </tr>
                ) : (
                  visibleTeachers.map((t) => (
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
                      <td>{t.gender || "—"}</td>
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
                  <label>Gender</label>
                  <select
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
                <div className="form-group">
                  <label>Advisory Class</label>
                  <select
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
              <div className="modal-footer-mt">
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
                  <table className="data-table-mt">
                    <thead>
                      <tr>
                        <th
                          className="mt-th-sortable"
                          onClick={() => handleScheduleSort("subject")}
                        >
                          Subject{" "}
                          <SortIcon
                            active={scheduleSortConfig.key === "subject"}
                            direction={scheduleSortConfig.direction}
                          />
                        </th>
                        <th
                          className="mt-th-sortable"
                          onClick={() => handleScheduleSort("gradeSection")}
                        >
                          Grade & Section{" "}
                          <SortIcon
                            active={scheduleSortConfig.key === "gradeSection"}
                            direction={scheduleSortConfig.direction}
                          />
                        </th>
                        <th
                          className="mt-th-sortable"
                          onClick={() => handleScheduleSort("days")}
                        >
                          Days{" "}
                          <SortIcon
                            active={scheduleSortConfig.key === "days"}
                            direction={scheduleSortConfig.direction}
                          />
                        </th>
                        <th
                          className="mt-th-sortable"
                          onClick={() => handleScheduleSort("time")}
                        >
                          Time{" "}
                          <SortIcon
                            active={scheduleSortConfig.key === "time"}
                            direction={scheduleSortConfig.direction}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSchedules.map((s) => (
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
                      className="data-table-mt"
                      style={{ fontSize: "0.8rem" }}
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
                              background: r.errs.length > 0 ? "#fff5f5" : "",
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

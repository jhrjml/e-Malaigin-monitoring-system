// firebaseApi.js
// ─────────────────────────────────────────────────────────────────────────────
// Collections used:
//   Student | Teacher | Schedule | Enrolled | User | GeneratedQR | SchoolYear
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

// ── helpers ───────────────────────────────────────────────────────────────────
const col = (name) => collection(db, name);
const snap = (docSnap) => ({ id: docSnap.id, ...docSnap.data() });
const snapAll = (qs) => qs.docs.map(snap);

const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const overlaps = (aS, aE, bS, bE) =>
  toMin(aS) < toMin(bE) && toMin(bS) < toMin(aE);
const normName = (s) => (s || "").trim().toLowerCase();

// 90 days in milliseconds
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** Convert a Firestore Timestamp, JS Date, or ISO string → JS Date (or null) */
function toDate(val) {
  if (!val) return null;
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  // Firestore-like object with toDate()
  if (typeof val.toDate === "function") return val.toDate();
  return null;
}

/** True if the given date is more than 90 days in the past */
function olderThan90Days(val) {
  const d = toDate(val);
  if (!d) return false;
  return Date.now() - d.getTime() > NINETY_DAYS_MS;
}

/**
 * School-year label for a given date, e.g. a date in Aug 2025 – May 2026
 * is bucketed as "2025-2026" (Philippine school year runs June–March-ish,
 * but the simple convention used here: months 6-12 belong to "year–year+1",
 * months 1-5 belong to "year-1–year").
 *
 * This is only a LAST-RESORT fallback. Prefer resolving against actual
 * configured SchoolYear date ranges (see resolveSchoolYearByDate below) or
 * the explicit schoolYear/droppedSchoolYear field on the Enrolled record.
 */
function schoolYearLabel(date) {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();
  if (month >= 6) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

// ── Auto-credential helpers ───────────────────────────────────────────────────

async function uniqueUsername(base) {
  const sanitised = base.toLowerCase().replace(/[^a-z0-9]/g, "");
  const padded = sanitised.padEnd(6, "x");
  let candidate = padded;
  let suffix = 1;
  for (;;) {
    const q = await getDocs(
      query(col("User"), where("username", "==", candidate)),
    );
    if (q.empty) return candidate;
    candidate = padded + suffix++;
  }
}

function teacherUsernameBase(fname, lname) {
  return (
    (fname || "").replace(/\s/g, "").charAt(0).toLowerCase() +
    (lname || "").replace(/\s/g, "").toLowerCase()
  );
}

function teacherPassword(empId) {
  return (empId || "").replace(/-/g, "").padEnd(6, "0");
}

function guardianUsernameBase(guardianName) {
  const parts = (guardianName || "")
    .trim()
    .split(/\s+/)
    .map((p) => p.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return parts.length === 1 ? parts[0] : parts[0] + parts[parts.length - 1];
}

function guardianPassword(guardianName) {
  const s = (guardianName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    s.slice(0, 4).padEnd(4, "x") + String(new Date().getFullYear()).slice(-2)
  );
}

async function teacherUserExists(teacherId) {
  const q = await getDocs(
    query(col("User"), where("teacherId", "==", teacherId)),
  );
  return q.docs.some((d) => d.data().role === "Teacher");
}

async function parentUserExists(guardianName) {
  const key = (guardianName || "").trim().toLowerCase();
  const q = await getDocs(query(col("User"), where("role", "==", "Parent")));
  return q.docs.find(
    (d) => (d.data().guardianName || "").trim().toLowerCase() === key,
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ACCOUNT MAINTENANCE  (call once on app load from ManageUsers)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * runAccountMaintenanceTasks()
 *
 * Rule A — Inactive user accounts (Teacher OR Parent):
 *   If a User has been Inactive for >90 days → set status "Archived".
 *   The deactivatedAt timestamp is written by toggleUserStatus() when it first
 *   sets status to Inactive.  If the field is missing on legacy records we
 *   write it now (so they get 90 more days before archiving).
 *
 * Rule B — Parent accounts linked to children who are ALL archived/graduated:
 *   - If ANY child is still active (not archived, grade < 7) keep parent Active
 *     (and re-activate it if it was previously deactivated by this rule).
 *   - If ALL children are inactive (archived or graduated):
 *       find the most recent archivedAt / graduatedAt across all children.
 *       Set the parent to Inactive and stamp deactivatedAt with that date.
 *       Rule A then archives the account 90 days after that stamp.
 *   The timestamps archivedAt / graduatedAt are written by archiveStudent() and
 *   graduateStudent() respectively.
 *
 * Rule C — Teacher accounts whose linked teacher record is archived:
 *   When a teacher is archived, archiveTeacher() immediately sets the account
 *   to Inactive. Rule C is a safety net for legacy records where the teacher
 *   was archived before this rule existed — it finds any Teacher User that is
 *   still Active but linked to an archived teacher, sets it to Inactive, and
 *   stamps deactivatedAt from the teacher's archivedAt so the 90-day countdown
 *   is measured from when the teacher was actually archived, not today.
 *   Rule A then archives the account 90 days after deactivatedAt.
 */
export async function runAccountMaintenanceTasks() {
  try {
    // ── Rule A: inactive accounts ──────────────────────────────────────────
    const allUsersSnap = await getDocs(col("User"));
    for (const userDoc of allUsersSnap.docs) {
      const u = userDoc.data();
      if (u.status === "Archived") continue; // already archived, skip

      if (u.status === "Inactive") {
        if (!u.deactivatedAt) {
          // Legacy record — stamp it now, will archive 90 days from today
          await updateDoc(userDoc.ref, { deactivatedAt: serverTimestamp() });
        } else if (olderThan90Days(u.deactivatedAt)) {
          await updateDoc(userDoc.ref, { status: "Archived" });
        }
      }
    }

    // ── Rule B: parent accounts whose ALL children are inactive ──────────
    const parentUsersSnap = await getDocs(
      query(col("User"), where("role", "==", "Parent")),
    );

    for (const parentDoc of parentUsersSnap.docs) {
      const parent = parentDoc.data();
      if (parent.status === "Archived") continue;

      const studentIds = parent.studentIds || [];
      if (studentIds.length === 0) continue;

      // Fetch all linked student docs
      const studentDocs = await Promise.all(
        studentIds.map((sid) =>
          getDoc(doc(db, "Student", sid)).then((d) =>
            d.exists() ? { id: d.id, ...d.data() } : null,
          ),
        ),
      );
      const students = studentDocs.filter(Boolean);
      if (students.length === 0) continue;

      // A student is "inactive" if it is archived OR graduated (grade === 7)
      const isInactive = (s) => s.archived === true || s.grade === 7;
      const allInactive = students.every(isInactive);

      if (!allInactive) {
        // At least one child is still active — ensure parent is Active
        if (parent.status === "Inactive") {
          await updateDoc(parentDoc.ref, {
            status: "Active",
            deactivatedAt: null,
          });
        }
        continue;
      }

      // All children inactive — find the most-recent inactivity timestamp
      let latestInactiveDate = null;
      for (const s of students) {
        const d = toDate(s.archivedAt) || toDate(s.graduatedAt);
        if (d && (!latestInactiveDate || d > latestInactiveDate)) {
          latestInactiveDate = d;
        }
      }

      // If timestamps are missing (legacy records), use now as the start date
      const countdownStart = latestInactiveDate
        ? Timestamp.fromDate(latestInactiveDate)
        : serverTimestamp();

      // Only deactivate if not already Inactive/Archived — avoid overwriting
      // an earlier deactivatedAt that was set by a previous run or by an admin
      if (parent.status === "Active") {
        await updateDoc(parentDoc.ref, {
          status: "Inactive",
          deactivatedAt: countdownStart,
        });
      } else if (parent.status === "Inactive" && !parent.deactivatedAt) {
        // Inactive but missing the timestamp — stamp it so Rule A can fire
        await updateDoc(parentDoc.ref, { deactivatedAt: countdownStart });
      }
      // Rule A (above) will archive it once deactivatedAt is >90 days old
    }

    // ── Rule C: teacher accounts whose teacher record is archived ─────────
    // Safety net for legacy records where archiveTeacher() didn't deactivate
    // the account (i.e. records archived before this rule was added).
    // archiveTeacher() now handles new archives immediately; this catches the
    // rest on the next maintenance run.
    const teacherUsersSnap = await getDocs(
      query(col("User"), where("role", "==", "Teacher")),
    );

    for (const teacherUserDoc of teacherUsersSnap.docs) {
      const tu = teacherUserDoc.data();
      // Already Inactive/Archived — Rule A handles the countdown, skip.
      if (tu.status === "Inactive" || tu.status === "Archived") continue;
      if (!tu.teacherId) continue;

      const teacherDocSnap = await getDoc(doc(db, "Teacher", tu.teacherId));
      if (!teacherDocSnap.exists()) continue;

      const teacher = teacherDocSnap.data();
      if (teacher.archived === true) {
        // Teacher is archived but account is still Active — deactivate now.
        // Use archivedAt as the countdown start so the 90 days is measured
        // from when the teacher was actually archived, not from today.
        const archivedAtDate = toDate(teacher.archivedAt);
        const countdownStart = archivedAtDate
          ? Timestamp.fromDate(archivedAtDate)
          : serverTimestamp();

        await updateDoc(teacherUserDoc.ref, {
          status: "Inactive",
          deactivatedAt: countdownStart,
        });
      }
    }
  } catch (err) {
    console.error("Account maintenance error:", err);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════

export async function login({ username, password }) {
  const q = query(col("User"), where("username", "==", username));
  const result = await getDocs(q);
  if (result.empty) throw new Error("Invalid username or password.");

  const userDoc = result.docs[0];
  const user = { id: userDoc.id, ...userDoc.data() };

  if (user.password !== password)
    throw new Error("Invalid username or password.");
  if (user.status === "Inactive" || user.status === "Archived")
    throw new Error(
      "Your account has been deactivated. Please contact the administrator.",
    );

  return {
    role: user.role.toLowerCase(),
    username: user.username,
    fullName: user.fullName || user.guardianName || "",
    id: user.id,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// STUDENTS
// ═════════════════════════════════════════════════════════════════════════════

export async function getStudents(grade) {
  let q = query(col("Student"), where("archived", "!=", true));
  if (grade != null)
    q = query(
      col("Student"),
      where("grade", "==", grade),
      where("archived", "!=", true),
    );
  return snapAll(await getDocs(q));
}

export async function getStudent(id) {
  const d = await getDoc(doc(db, "Student", id));
  if (!d.exists()) throw new Error("Student not found.");
  return snap(d);
}

/**
 * addStudent — saves student AND auto-creates/updates Parent account.
 * ManageStudents needs NO changes.
 */
export async function addStudent(data) {
  const dup = await getDocs(
    query(col("Student"), where("lrn", "==", data.lrn)),
  );
  if (!dup.empty) throw new Error("A student with this LRN already exists.");

  const ref = await addDoc(col("Student"), { ...data, archived: false });
  const studentId = ref.id;

  const guardianName = (data.guardian || "").trim();
  if (guardianName) {
    const existingParentDoc = await parentUserExists(guardianName);
    if (!existingParentDoc) {
      const username = await uniqueUsername(guardianUsernameBase(guardianName));
      const password = guardianPassword(guardianName);
      await addDoc(col("User"), {
        role: "Parent",
        username,
        password,
        status: "Active",
        teacherId: "",
        fullName: "",
        guardianName,
        studentIds: [studentId],
      });
    } else {
      const existing = existingParentDoc.data().studentIds || [];
      if (!existing.includes(studentId)) {
        await updateDoc(existingParentDoc.ref, {
          studentIds: [...existing, studentId],
        });
      }
    }
  }

  return { id: studentId, ...data, archived: false };
}

export async function updateStudent(id, data) {
  if (data.lrn) {
    const dup = await getDocs(
      query(col("Student"), where("lrn", "==", data.lrn)),
    );
    if (!dup.empty && dup.docs[0].id !== id)
      throw new Error("A student with this LRN already exists.");
  }
  await updateDoc(doc(db, "Student", id), data);
  return snap(await getDoc(doc(db, "Student", id)));
}

/** archiveStudent — soft delete, stamps archivedAt for the 90-day parent rule */
export async function archiveStudent(id) {
  await updateDoc(doc(db, "Student", id), {
    archived: true,
    archivedAt: serverTimestamp(),
  });
}

export async function getEligibleStudents(grade) {
  const [allStudents, enrolledDocs] = await Promise.all([
    getDocs(
      query(
        col("Student"),
        where("grade", "==", grade),
        where("archived", "!=", true),
      ),
    ),
    getDocs(query(col("Enrolled"), where("status", "==", "Enrolled"))),
  ]);
  const enrolledIds = new Set(enrolledDocs.docs.map((d) => d.data().studentId));
  return allStudents.docs.map(snap).filter((s) => !enrolledIds.has(s.id));
}

export async function getStudentsWithoutParentAccount() {
  const [allStudents, parentUsers] = await Promise.all([
    getDocs(query(col("Student"), where("archived", "!=", true))),
    getDocs(query(col("User"), where("role", "==", "Parent"))),
  ]);
  const takenGuardians = new Set(
    parentUsers.docs.map((d) =>
      (d.data().guardianName || "").trim().toLowerCase(),
    ),
  );
  return allStudents.docs
    .map(snap)
    .filter(
      (s) => !takenGuardians.has((s.guardian || "").trim().toLowerCase()),
    );
}

export async function getStudentsQrAvailable() {
  const [allStudents, generatedDocs] = await Promise.all([
    getDocs(query(col("Student"), where("archived", "!=", true))),
    getDocs(col("GeneratedQR")),
  ]);
  const generatedLrns = new Set(generatedDocs.docs.map((d) => d.data().lrn));
  return allStudents.docs.map(snap).filter((s) => !generatedLrns.has(s.lrn));
}

// ═════════════════════════════════════════════════════════════════════════════
// TEACHERS
// ═════════════════════════════════════════════════════════════════════════════

export async function getTeachers() {
  return snapAll(
    await getDocs(query(col("Teacher"), where("archived", "!=", true))),
  );
}

export async function getTeacher(id) {
  const d = await getDoc(doc(db, "Teacher", id));
  if (!d.exists()) throw new Error("Teacher not found.");
  return snap(d);
}

/**
 * addTeacher — saves teacher AND auto-creates Teacher User account.
 * Also validates: duplicate name, duplicate contact, advisory conflict.
 */
export async function addTeacher(data) {
  const activeSnap = await getDocs(
    query(col("Teacher"), where("archived", "!=", true)),
  );

  const fname = normName(data.fname);
  const mname = normName(data.mname);
  const lname = normName(data.lname);
  const contact = (data.contact || "").trim();
  const advisory = (data.advisory || "").trim();

  const nameMatch = activeSnap.docs.find((d) => {
    const t = d.data();
    return (
      normName(t.fname) === fname &&
      normName(t.lname) === lname &&
      normName(t.mname) === mname
    );
  });
  if (nameMatch) {
    const t = nameMatch.data();
    throw new Error(
      `${t.fname} ${t.lname} is already registered (Employee ID: ${t.empId}).`,
    );
  }

  if (contact) {
    const contactMatch = activeSnap.docs.find(
      (d) => (d.data().contact || "").trim() === contact,
    );
    if (contactMatch) {
      const t = contactMatch.data();
      throw new Error(
        `Contact already used by ${t.fname} ${t.lname} (${t.empId}).`,
      );
    }
  }

  if (advisory) {
    const advMatch = activeSnap.docs.find(
      (d) => (d.data().advisory || "").trim() === advisory,
    );
    if (advMatch) {
      const t = advMatch.data();
      throw new Error(
        `${advisory} already has an assigned adviser: ${t.fname} ${t.lname}.`,
      );
    }
  }

  if (activeSnap.docs.find((d) => d.data().empId === data.empId))
    throw new Error("A teacher with this Employee ID already exists.");

  const ref = await addDoc(col("Teacher"), { ...data, archived: false });
  const teacherId = ref.id;

  if (!(await teacherUserExists(teacherId))) {
    const username = await uniqueUsername(
      teacherUsernameBase(data.fname, data.lname),
    );
    const password = teacherPassword(data.empId);
    const fullName = `${data.lname}, ${data.fname}${data.mname ? " " + data.mname : ""}`;
    await addDoc(col("User"), {
      role: "Teacher",
      username,
      password,
      status: "Active",
      teacherId,
      fullName,
      guardianName: "",
      studentIds: [],
    });
  }

  return { id: teacherId, ...data, archived: false };
}

export async function updateTeacher(id, data) {
  const activeSnap = await getDocs(
    query(col("Teacher"), where("archived", "!=", true)),
  );

  if (data.fname && data.lname) {
    const fname = normName(data.fname),
      mname = normName(data.mname),
      lname = normName(data.lname);
    const nm = activeSnap.docs.find((d) => {
      if (d.id === id) return false;
      const t = d.data();
      return (
        normName(t.fname) === fname &&
        normName(t.lname) === lname &&
        normName(t.mname) === mname
      );
    });
    if (nm) {
      const t = nm.data();
      throw new Error(
        `${t.fname} ${t.lname} is already registered (${t.empId}).`,
      );
    }
  }

  if (data.contact) {
    const cm = activeSnap.docs.find(
      (d) =>
        d.id !== id && (d.data().contact || "").trim() === data.contact.trim(),
    );
    if (cm) {
      const t = cm.data();
      throw new Error(
        `Contact already used by ${t.fname} ${t.lname} (${t.empId}).`,
      );
    }
  }

  if (data.advisory) {
    const am = activeSnap.docs.find(
      (d) =>
        d.id !== id &&
        (d.data().advisory || "").trim() === data.advisory.trim(),
    );
    if (am) {
      const t = am.data();
      throw new Error(
        `${data.advisory} already has an assigned adviser: ${t.fname} ${t.lname}.`,
      );
    }
  }

  if (data.empId) {
    const em = activeSnap.docs.find(
      (d) => d.id !== id && d.data().empId === data.empId,
    );
    if (em) throw new Error("Employee ID already used by another teacher.");
  }

  await updateDoc(doc(db, "Teacher", id), data);
  return snap(await getDoc(doc(db, "Teacher", id)));
}

/**
 * archiveTeacher — soft deletes the teacher AND immediately sets the linked
 * teacher User account to Inactive, starting the 90-day countdown (Rule A).
 * archivedAt is stamped so Rule C can use it as the countdown start date for
 * any records that slip through without an account deactivation.
 */
export async function archiveTeacher(id) {
  // Archive the teacher record and stamp archivedAt for Rule C
  await updateDoc(doc(db, "Teacher", id), {
    archived: true,
    archivedAt: serverTimestamp(),
  });

  // Immediately deactivate the linked teacher User account so Rule A's
  // 90-day countdown starts from the moment the teacher is archived.
  const userSnap = await getDocs(
    query(
      col("User"),
      where("role", "==", "Teacher"),
      where("teacherId", "==", id),
    ),
  );
  if (!userSnap.empty) {
    const userDoc = userSnap.docs[0];
    if (userDoc.data().status !== "Archived") {
      await updateDoc(userDoc.ref, {
        status: "Inactive",
        deactivatedAt: serverTimestamp(),
      });
    }
  }
}

export async function getTeachersWithoutAccount() {
  const [allTeachers, teacherUsers] = await Promise.all([
    getDocs(query(col("Teacher"), where("archived", "!=", true))),
    getDocs(query(col("User"), where("role", "==", "Teacher"))),
  ]);
  const takenIds = new Set(teacherUsers.docs.map((d) => d.data().teacherId));
  return allTeachers.docs.map(snap).filter((t) => !takenIds.has(t.id));
}

// ═════════════════════════════════════════════════════════════════════════════
// SCHEDULES
// ═════════════════════════════════════════════════════════════════════════════

export async function getSchedules(grade, section) {
  let q = col("Schedule");
  if (grade != null && section != null)
    q = query(
      col("Schedule"),
      where("grade", "==", grade),
      where("section", "==", section),
    );
  else if (grade != null)
    q = query(col("Schedule"), where("grade", "==", grade));
  return snapAll(await getDocs(q));
}

export async function addSchedule(data) {
  if (toMin(data.start) >= toMin(data.end))
    throw new Error("End time must be after start time.");

  const sectionSched = await getDocs(
    query(
      col("Schedule"),
      where("grade", "==", data.grade),
      where("section", "==", data.section),
    ),
  );
  for (const s of sectionSched.docs) {
    const d = s.data();
    if (
      d.day === data.day &&
      d.subject.toLowerCase() === data.subject.toLowerCase()
    )
      throw new Error(
        `'${data.subject}' is already scheduled in this section.`,
      );
    if (d.day === data.day && overlaps(data.start, data.end, d.start, d.end))
      throw new Error(
        `Time conflict with '${d.subject}' on ${data.day} (${d.start}–${d.end}) in this section.`,
      );
  }

  const teacherSched = await getDocs(
    query(col("Schedule"), where("teacherId", "==", data.teacherId)),
  );
  for (const s of teacherSched.docs) {
    const d = s.data();
    if (d.day === data.day && overlaps(data.start, data.end, d.start, d.end))
      throw new Error(
        `Teacher already assigned to Grade ${d.grade}-${d.section} on (${d.start}–${d.end}).`,
      );
  }

  const ref = await addDoc(col("Schedule"), data);
  return { id: ref.id, ...data };
}

export async function updateSchedule(id, data) {
  const current = snap(await getDoc(doc(db, "Schedule", id)));
  const merged = {
    subject: data.subject ?? current.subject,
    day: data.day ?? current.day,
    start: data.start ?? current.start,
    end: data.end ?? current.end,
    teacherId: data.teacherId ?? current.teacherId,
  };

  if (toMin(merged.start) >= toMin(merged.end))
    throw new Error("End time must be after start time.");

  const sectionSched = await getDocs(
    query(
      col("Schedule"),
      where("grade", "==", current.grade),
      where("section", "==", current.section),
    ),
  );
  for (const s of sectionSched.docs) {
    if (s.id === id) continue;
    const d = s.data();
    if (
      d.day === merged.day &&
      d.subject.toLowerCase() === merged.subject.toLowerCase()
    )
      throw new Error(
        `'${merged.subject}' is already scheduled in this section.`,
      );
    if (
      d.day === merged.day &&
      overlaps(merged.start, merged.end, d.start, d.end)
    )
      throw new Error(
        `Time conflict with '${d.subject}' (${d.start}–${d.end}) in this section.`,
      );
  }

  const teacherSched = await getDocs(
    query(col("Schedule"), where("teacherId", "==", merged.teacherId)),
  );
  for (const s of teacherSched.docs) {
    if (s.id === id) continue;
    const d = s.data();
    if (
      d.day === merged.day &&
      overlaps(merged.start, merged.end, d.start, d.end)
    )
      throw new Error(
        `Teacher conflict with Grade ${d.grade}-${d.section} on ${merged.day} (${d.start}–${d.end}).`,
      );
  }

  await updateDoc(doc(db, "Schedule", id), data);
  return snap(await getDoc(doc(db, "Schedule", id)));
}

export async function deleteSchedule(id) {
  await deleteDoc(doc(db, "Schedule", id));
}

/**
 * clearSectionSchedules(grade, section)
 * Deletes ALL Schedule documents for a given grade + section.
 * Called by ManageClasses when the last student is removed from a section,
 * so the schedule resets cleanly for the next school year.
 */
export async function clearSectionSchedules(grade, section) {
  const schedSnap = await getDocs(
    query(
      col("Schedule"),
      where("grade", "==", grade),
      where("section", "==", section),
    ),
  );
  await Promise.all(schedSnap.docs.map((d) => deleteDoc(d.ref)));
}

// ═════════════════════════════════════════════════════════════════════════════
// ENROLLED
// ═════════════════════════════════════════════════════════════════════════════

export async function getEnrolled(grade, section) {
  let q = col("Enrolled");
  if (grade != null && section != null)
    q = query(
      col("Enrolled"),
      where("grade", "==", grade),
      where("section", "==", section),
    );
  else if (grade != null)
    q = query(col("Enrolled"), where("grade", "==", grade));
  return snapAll(await getDocs(q));
}

/**
 * enrollStudent — now stamps enrolledAt so the dashboard's enrollment chart
 * can bucket new enrollments by school year going forward.
 */
export async function enrollStudent({ studentId, grade, section }) {
  const student = snap(await getDoc(doc(db, "Student", studentId)));
  if (!student) throw new Error("Student not found.");
  if (student.grade !== grade)
    throw new Error(
      `Student is Grade ${student.grade} but enrolling in Grade ${grade}.`,
    );

  const activeQ = await getDocs(
    query(
      col("Enrolled"),
      where("studentId", "==", studentId),
      where("status", "==", "Enrolled"),
    ),
  );
  if (!activeQ.empty) {
    const e = activeQ.docs[0].data();
    throw new Error(
      `Student already enrolled in Grade ${e.grade}-${e.section}.`,
    );
  }

  // Tag with the admin-set active school year (falls back to date-derived
  // label only if no school year has been configured yet)
  const schoolYear = await getActiveSchoolYearLabel();

  const droppedQ = await getDocs(
    query(
      col("Enrolled"),
      where("studentId", "==", studentId),
      where("status", "==", "Dropped"),
    ),
  );
  if (!droppedQ.empty) {
    const droppedRef = droppedQ.docs[0].ref;
    await updateDoc(droppedRef, {
      status: "Enrolled",
      grade,
      section,
      enrolledAt: serverTimestamp(),
      schoolYear,
    });
    return snap(await getDoc(droppedRef));
  }

  const ref = await addDoc(col("Enrolled"), {
    studentId,
    grade,
    section,
    status: "Enrolled",
    enrolledAt: serverTimestamp(),
    schoolYear,
  });
  return {
    id: ref.id,
    studentId,
    grade,
    section,
    status: "Enrolled",
    schoolYear,
  };
}

/**
 * dropStudent — stamps droppedAt AND the admin-set active school year label,
 * so the dashboard's dropout chart groups by the real school year instead of
 * guessing from a timestamp.
 */
export async function dropStudent(enrollId) {
  const schoolYear = await getActiveSchoolYearLabel();
  await updateDoc(doc(db, "Enrolled", enrollId), {
    status: "Dropped",
    droppedAt: serverTimestamp(),
    droppedSchoolYear: schoolYear,
  });
}

export async function promoteStudent(enrollId) {
  const enrollment = snap(await getDoc(doc(db, "Enrolled", enrollId)));
  const student = snap(await getDoc(doc(db, "Student", enrollment.studentId)));
  if (student.grade >= 6)
    throw new Error("Student is Grade 6. Use graduate instead.");
  await updateDoc(doc(db, "Student", enrollment.studentId), {
    grade: student.grade + 1,
  });
  await deleteDoc(doc(db, "Enrolled", enrollId));
  return { message: `Student promoted to Grade ${student.grade + 1}.` };
}

/**
 * graduateStudent — stamps graduatedAt for the 90-day parent-archive rule.
 */
export async function graduateStudent(enrollId) {
  const enrollment = snap(await getDoc(doc(db, "Enrolled", enrollId)));
  const student = snap(await getDoc(doc(db, "Student", enrollment.studentId)));
  if (student.grade !== 6)
    throw new Error(`Student is Grade ${student.grade}, not Grade 6.`);
  await updateDoc(doc(db, "Student", enrollment.studentId), {
    grade: 7,
    status: "Graduated",
    graduatedAt: serverTimestamp(),
  });
  await deleteDoc(doc(db, "Enrolled", enrollId));
  return { message: "Student successfully graduated." };
}

// ═════════════════════════════════════════════════════════════════════════════
// USERS
// ═════════════════════════════════════════════════════════════════════════════

export async function getUsers(role) {
  const q = role ? query(col("User"), where("role", "==", role)) : col("User");
  return snapAll(await getDocs(q));
}

export async function createUser(data) {
  const dupQ = await getDocs(
    query(col("User"), where("username", "==", data.username)),
  );
  if (!dupQ.empty) throw new Error("Username already taken.");

  let fullName = "";
  if (data.role === "Teacher") {
    if (!data.teacherId)
      throw new Error("teacherId is required for Teacher accounts.");
    const teacher = snap(await getDoc(doc(db, "Teacher", data.teacherId)));
    if (!teacher) throw new Error("Teacher not found.");
    if (await teacherUserExists(data.teacherId))
      throw new Error("This teacher already has an account.");
    fullName = `${teacher.lname}, ${teacher.fname}${teacher.mname ? " " + teacher.mname : ""}`;
  } else if (data.role === "Parent") {
    if (!data.guardianName)
      throw new Error("guardianName is required for Parent accounts.");
    fullName = data.guardianName;
  } else {
    throw new Error("Role must be 'Teacher' or 'Parent'.");
  }

  const doc_ = {
    role: data.role,
    username: data.username,
    password: data.password,
    status: "Active",
    teacherId: data.role === "Teacher" ? data.teacherId : "",
    fullName,
    guardianName: data.role === "Parent" ? data.guardianName : "",
    studentIds: data.role === "Parent" ? data.studentIds || [] : [],
  };
  const ref = await addDoc(col("User"), doc_);
  return { id: ref.id, ...doc_ };
}

/**
 * toggleUserStatus — when setting Inactive, stamps deactivatedAt so the
 * 90-day auto-archive countdown begins immediately.
 */
export async function toggleUserStatus(userId) {
  const user = snap(await getDoc(doc(db, "User", userId)));
  const newStatus = user.status === "Active" ? "Inactive" : "Active";

  const update = { status: newStatus };
  if (newStatus === "Inactive") {
    update.deactivatedAt = serverTimestamp(); // start 90-day countdown
  } else {
    update.deactivatedAt = null; // reset on re-activation
  }

  await updateDoc(doc(db, "User", userId), update);
  return snap(await getDoc(doc(db, "User", userId)));
}

export async function deleteUser(userId) {
  await deleteDoc(doc(db, "User", userId));
}

// ═════════════════════════════════════════════════════════════════════════════
// GENERATED QR
// ═════════════════════════════════════════════════════════════════════════════

export async function markQrGenerated(lrn) {
  const dup = await getDocs(query(col("GeneratedQR"), where("lrn", "==", lrn)));
  if (!dup.empty) return { id: dup.docs[0].id, lrn };
  const ref = await addDoc(col("GeneratedQR"), { lrn });
  return { id: ref.id, lrn };
}

export async function deleteGeneratedQr(lrn) {
  const q = await getDocs(query(col("GeneratedQR"), where("lrn", "==", lrn)));
  if (q.empty) throw new Error("No QR record found for this LRN.");
  await deleteDoc(q.docs[0].ref);
}

// ═════════════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS (Web Push — no FCM, no Blaze plan)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * getParentIdsForStudents(studentIds)
 * Given an array of Student doc ids, returns the User doc ids (role
 * "Parent") linked via their `studentIds` array. Works for a single
 * student too (pass a one-element array) — used both by the bulk
 * classwork-notification flow and the single-scan attendance flow.
 * Deduplicates and chunks queries to respect Firestore's 30-value cap on
 * `array-contains-any`.
 */
export async function getParentIdsForStudents(studentIds) {
  const ids = [...new Set((studentIds || []).filter(Boolean))];
  if (ids.length === 0) return [];

  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

  const results = await Promise.all(
    chunks.map((chunk) =>
      getDocs(
        query(
          col("User"),
          where("role", "==", "Parent"),
          where("studentIds", "array-contains-any", chunk),
        ),
      ),
    ),
  );

  const parentIds = new Set();
  results.forEach((qs) => qs.docs.forEach((d) => parentIds.add(d.id)));
  return [...parentIds];
}

/**
 * savePushSubscription(parentId, subscriptionJSON)
 * Saves/updates a parent's Web Push subscription for one device/browser.
 * One doc per device — a parent using two devices gets notified on both.
 * `parentId` is the User doc id (same id stored as localStorage "userId").
 */
export async function savePushSubscription(parentId, subscriptionJSON) {
  const safeId = encodeURIComponent(subscriptionJSON.endpoint).slice(-150);
  const ref = doc(col("PushSubscriptions"), safeId);
  await setDoc(ref, {
    parentId,
    subscription: subscriptionJSON,
    updatedAt: serverTimestamp(),
  });
  return { id: safeId, parentId };
}

// ADD this function to src/api/firebaseApi.js, right after savePushSubscription
// in the "PUSH NOTIFICATIONS" section.

/**
 * deletePushSubscription(endpoint)
 * Removes a device's push subscription record — called on logout so a
 * browser that's no longer "logged in" as that parent stops receiving
 * their notifications. Uses the same endpoint-derived doc id that
 * savePushSubscription() creates, so no lookup query is needed.
 */
export async function deletePushSubscription(endpoint) {
  const safeId = encodeURIComponent(endpoint).slice(-150);
  await deleteDoc(doc(col("PushSubscriptions"), safeId));
}

/**
 * queueNotification({ parentIds, title, body, url })
 * Writes a doc to "NotificationQueue" (offline-safe via persistentLocalCache),
 * then immediately fires a non-blocking fetch to /api/process-notification-queue
 * so the notification sends within seconds if the caller is online, instead of
 * waiting for the once-a-day cron fallback (see api/process-notification-queue.js
 * and NotificationQueueSync.jsx for the two other triggers that cover the
 * "offline at time of action" case).
 */
export async function queueNotification({ parentIds, title, body, url }) {
  if (!parentIds || parentIds.length === 0) return null;
  const ref = doc(col("NotificationQueue"));
  await setDoc(ref, {
    parentIds,
    title,
    body,
    url: url || "/",
    status: "pending",
    createdAt: serverTimestamp(),
  });

  // Fire-and-forget: trigger immediate processing if we're online right now.
  // Never awaited, never thrown upward — if this fails (offline, cold start,
  // etc.) the write above is already safely queued and NotificationQueueSync
  // will retry the moment connectivity returns.
  fetch("/api/process-notification-queue").catch(() => {});

  return { id: ref.id };
}

// ═════════════════════════════════════════════════════════════════════════════
// ARCHIVE — read
// ═════════════════════════════════════════════════════════════════════════════

/**
 * getArchivedStudents()
 * Returns every archived student paired with their parent User document
 * (if one exists). Shape: [{ student, parentUser | null }]
 */
export async function getArchivedStudents() {
  const [studentSnap, userSnap] = await Promise.all([
    getDocs(query(col("Student"), where("archived", "==", true))),
    getDocs(query(col("User"), where("role", "==", "Parent"))),
  ]);

  const parentUsers = userSnap.docs.map(snap);

  return studentSnap.docs.map((d) => {
    const student = snap(d);
    const parentUser =
      parentUsers.find((u) => (u.studentIds || []).includes(student.id)) ||
      null;
    return { student, parentUser };
  });
}

/**
 * getArchivedTeachers()
 * Returns every archived teacher paired with their teacher User document
 * (if one exists). Shape: [{ teacher, teacherUser | null }]
 */
export async function getArchivedTeachers() {
  const [teacherSnap, userSnap] = await Promise.all([
    getDocs(query(col("Teacher"), where("archived", "==", true))),
    getDocs(query(col("User"), where("role", "==", "Teacher"))),
  ]);

  const teacherUsers = userSnap.docs.map(snap);

  return teacherSnap.docs.map((d) => {
    const teacher = snap(d);
    const teacherUser =
      teacherUsers.find((u) => u.teacherId === teacher.id) || null;
    return { teacher, teacherUser };
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// ARCHIVE — unarchive
// ═════════════════════════════════════════════════════════════════════════════

/**
 * unarchiveStudent(studentId, targetGrade)
 * - Sets student.archived = false, clears archivedAt.
 * - Updates student.grade to the admin-chosen targetGrade (1–6).
 * - Finds the linked parent User and sets status back to "Active",
 *   clearing deactivatedAt so the 90-day countdown resets.
 *
 * @param {string} studentId  - Firestore document ID of the Student record.
 * @param {number} targetGrade - Grade level (1–6) chosen by the admin in the
 *                               Archive UI before confirming the restore.
 */
export async function unarchiveStudent(studentId, targetGrade) {
  if (!targetGrade || targetGrade < 1 || targetGrade > 6) {
    throw new Error(
      "A valid grade level (1–6) is required to restore a student.",
    );
  }

  // Restore the student record with the admin-chosen grade level
  await updateDoc(doc(db, "Student", studentId), {
    archived: false,
    archivedAt: null,
    grade: targetGrade,
  });

  // Reactivate the parent user account if it exists and was deactivated
  const parentSnap = await getDocs(
    query(col("User"), where("role", "==", "Parent")),
  );
  for (const parentDoc of parentSnap.docs) {
    const data = parentDoc.data();
    if ((data.studentIds || []).includes(studentId)) {
      if (data.status !== "Active") {
        await updateDoc(parentDoc.ref, {
          status: "Active",
          deactivatedAt: null,
        });
      }
      break;
    }
  }
}

/**
 * unarchiveTeacher(teacherId)
 * - Sets teacher.archived = false, clears archivedAt.
 * - Finds the linked teacher User and sets status back to "Active",
 *   clearing deactivatedAt so the 90-day countdown resets.
 */
export async function unarchiveTeacher(teacherId) {
  await updateDoc(doc(db, "Teacher", teacherId), {
    archived: false,
    archivedAt: null,
  });

  // Reactivate the teacher user account if it exists
  const userSnap = await getDocs(
    query(
      col("User"),
      where("role", "==", "Teacher"),
      where("teacherId", "==", teacherId),
    ),
  );
  if (!userSnap.empty) {
    await updateDoc(userSnap.docs[0].ref, {
      status: "Active",
      deactivatedAt: null,
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// SCHOOL YEAR
// ═════════════════════════════════════════════════════════════════════════════

/**
 * getSchoolYears()
 * Returns every school year record, most recent first (by label).
 * Shape: [{ id, label, startDate, endDate, isActive, holidays }]
 * `holidays` is always an array (defaults to [] for older records that
 * predate the holiday feature).
 */
export async function getSchoolYears() {
  const snap_ = await getDocs(col("SchoolYear"));
  return snap_.docs
    .map((d) => {
      const data = snap(d);
      return { ...data, holidays: data.holidays || [] };
    })
    .sort((a, b) => (b.label || "").localeCompare(a.label || ""));
}

/**
 * getActiveSchoolYear()
 * Returns the school year currently marked isActive: true, or null if none
 * has been configured yet.
 */
export async function getActiveSchoolYear() {
  const q = await getDocs(
    query(col("SchoolYear"), where("isActive", "==", true)),
  );
  if (q.empty) return null;
  const data = snap(q.docs[0]);
  return { ...data, holidays: data.holidays || [] };
}

/**
 * getActiveSchoolYearLabel()
 * Convenience helper used internally by enrollStudent()/dropStudent().
 * Falls back to a date-derived label (old heuristic) only if no school
 * year has been configured yet, so the system never breaks for admins who
 * haven't set one up.
 */
export async function getActiveSchoolYearLabel() {
  const active = await getActiveSchoolYear();
  if (active) return active.label;
  // Fallback — no school year configured yet
  return schoolYearLabel(new Date());
}

/**
 * addSchoolYear({ label, startDate, endDate })
 * Creates a new school year record. label should be like "2025-2026".
 * startDate/endDate should be "YYYY-MM-DD" strings — they're used both to
 * resolve legacy enrollment records to a year (see
 * getEnrollmentDropoutStats below) and as the basis for the holiday
 * calendar feature.
 * Does not automatically activate it — call setActiveSchoolYear() for that.
 * Throws if a school year with the same label already exists.
 */
export async function addSchoolYear({ label, startDate, endDate }) {
  const trimmed = (label || "").trim();
  if (!trimmed) throw new Error("School year label is required.");

  const dup = await getDocs(
    query(col("SchoolYear"), where("label", "==", trimmed)),
  );
  if (!dup.empty) throw new Error(`School year "${trimmed}" already exists.`);

  const ref = await addDoc(col("SchoolYear"), {
    label: trimmed,
    startDate: startDate || "",
    endDate: endDate || "",
    isActive: false,
    holidays: [],
  });
  return {
    id: ref.id,
    label: trimmed,
    startDate: startDate || "",
    endDate: endDate || "",
    isActive: false,
    holidays: [],
  };
}

/**
 * setActiveSchoolYear(id)
 * Marks the given school year as active and deactivates all others, so
 * exactly one school year is ever active at a time.
 */
export async function setActiveSchoolYear(id) {
  const allSnap = await getDocs(col("SchoolYear"));
  await Promise.all(
    allSnap.docs.map((d) => updateDoc(d.ref, { isActive: d.id === id })),
  );
}

/**
 * deleteSchoolYear(id)
 * Removes a school year record. Does not touch any Enrolled documents that
 * were previously tagged with its label — those keep their historical tag.
 */
export async function deleteSchoolYear(id) {
  await deleteDoc(doc(db, "SchoolYear", id));
}

/**
 * addSchoolYearHoliday(schoolYearId, { date, name })
 * Adds a single holiday (e.g. a DepEd-declared non-working day) to a school
 * year's holiday list. date must be "YYYY-MM-DD". Holidays are kept sorted
 * by date and deduplicated by date — adding a date that already exists
 * throws rather than silently overwriting it.
 */
export async function addSchoolYearHoliday(schoolYearId, { date, name }) {
  const trimmedDate = (date || "").trim();
  const trimmedName = (name || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate))
    throw new Error("Holiday date must be in YYYY-MM-DD format.");
  if (!trimmedName) throw new Error("Holiday name is required.");

  const ref = doc(db, "SchoolYear", schoolYearId);
  const d = await getDoc(ref);
  if (!d.exists()) throw new Error("School year not found.");
  const current = snap(d);

  const holidays = current.holidays || [];
  if (holidays.some((h) => h.date === trimmedDate)) {
    throw new Error("A holiday is already set for this date.");
  }

  const updated = [...holidays, { date: trimmedDate, name: trimmedName }].sort(
    (a, b) => a.date.localeCompare(b.date),
  );
  await updateDoc(ref, { holidays: updated });
  return updated;
}

/**
 * removeSchoolYearHoliday(schoolYearId, date)
 * Removes a holiday by its date ("YYYY-MM-DD") from a school year's list.
 */
export async function removeSchoolYearHoliday(schoolYearId, date) {
  const ref = doc(db, "SchoolYear", schoolYearId);
  const d = await getDoc(ref);
  if (!d.exists()) throw new Error("School year not found.");
  const current = snap(d);

  const updated = (current.holidays || []).filter((h) => h.date !== date);
  await updateDoc(ref, { holidays: updated });
  return updated;
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC HOLIDAYS — auto-import from the free Nager.Date API (no key needed)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * fetchPublicHolidays(startDate, endDate)
 * Pulls Philippine *national* public holidays (New Year, Independence Day,
 * Christmas, etc.) from the free Nager.Date API — https://date.nager.at —
 * for every calendar year the [startDate, endDate] range touches, then
 * trims the combined result down to just that range.
 *
 * No API key needed, CORS-enabled, no rate limit. Country code "PH".
 *
 * IMPORTANT: this only covers *national* public holidays. It has no idea
 * about DepEd-specific school-calendar items (semestral break, foundation
 * day, typhoon suspensions, etc.) — there's no public API for that DepEd
 * data, so those still need to be added manually with addSchoolYearHoliday().
 *
 * Returns [{ date: "YYYY-MM-DD", name }], sorted by date. Returns [] (never
 * throws) if the network call fails, so a bad connection just means "no
 * holidays imported" rather than blocking school-year creation.
 */
export async function fetchPublicHolidays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const years = [];
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) years.push(y);

  const results = await Promise.all(
    years.map((y) =>
      fetch(`https://date.nager.at/api/v3/publicholidays/${y}/PH`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ),
  );

  return results
    .flat()
    .filter((h) => h.date >= startDate && h.date <= endDate)
    .map((h) => ({ date: h.date, name: h.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * importPublicHolidaysForSchoolYear(schoolYearId, startDate, endDate)
 * Fetches PH public holidays for the date range and adds each one to the
 * given school year via addSchoolYearHoliday(). Dates that are already on
 * the list are skipped instead of throwing (addSchoolYearHoliday rejects
 * duplicate dates one at a time, so we just swallow that specific error).
 * Returns { imported, skipped, total }.
 */
export async function importPublicHolidaysForSchoolYear(
  schoolYearId,
  startDate,
  endDate,
) {
  const holidays = await fetchPublicHolidays(startDate, endDate);
  let imported = 0;
  let skipped = 0;

  for (const h of holidays) {
    try {
      await addSchoolYearHoliday(schoolYearId, { date: h.date, name: h.name });
      imported++;
    } catch {
      skipped++; // already exists for that date — not a real failure
    }
  }

  return { imported, skipped, total: holidays.length };
}

// ═════════════════════════════════════════════════════════════════════════════
// ONE-TIME MIGRATION — backfill missing enrollment timestamps
// ═════════════════════════════════════════════════════════════════════════════

/**
 * backfillEnrollmentTimestamps()
 *
 * Stamps enrolledAt / droppedAt on legacy "Enrolled" documents that were
 * created before enrollStudent() and dropStudent() started writing these
 * fields. Without this, those records show up under "Unknown" in the
 * dashboard's Enrollment & Dropout chart forever.
 *
 * IMPORTANT — this is an approximation, not a true historical date:
 * there is no reliable "created at" field anywhere upstream (Student records
 * don't track when they were added either), so every backfilled record is
 * stamped with TODAY's date. This means legacy enrollments/drops will all
 * land in the CURRENT school year bucket on the chart, rather than the
 * (unknowable) year they actually happened in.
 *
 * Safe to run multiple times — only touches documents missing the relevant
 * field, so it will never overwrite a real timestamp written by
 * enrollStudent()/dropStudent() going forward.
 *
 * Exposed in the dashboard as a one-click "Fix missing dates" button
 * (shown automatically whenever the Enrollment & Dropout chart has an
 * "Unknown" bucket) — see EnrollmentDropoutChart in AdminHomepage.jsx.
 *
 * Returns { enrolledStamped, droppedStamped } counts for confirmation.
 */
export async function backfillEnrollmentTimestamps() {
  const enrolledSnap = await getDocs(col("Enrolled"));

  let enrolledStamped = 0;
  let droppedStamped = 0;

  for (const d of enrolledSnap.docs) {
    const data = d.data();
    const update = {};

    if (!data.enrolledAt) {
      update.enrolledAt = serverTimestamp();
      enrolledStamped++;
    }
    if (data.status === "Dropped" && !data.droppedAt) {
      update.droppedAt = serverTimestamp();
      droppedStamped++;
    }

    if (Object.keys(update).length > 0) {
      await updateDoc(d.ref, update);
    }
  }

  return { enrolledStamped, droppedStamped };
}

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * getDashboardStats()
 * Returns headline counts for the admin overview cards.
 * studentCount / teacherCount exclude archived records, matching
 * getStudents() / getTeachers().
 */
export async function getDashboardStats() {
  const [studentSnap, teacherSnap] = await Promise.all([
    getDocs(query(col("Student"), where("archived", "!=", true))),
    getDocs(query(col("Teacher"), where("archived", "!=", true))),
  ]);
  return {
    studentCount: studentSnap.size,
    teacherCount: teacherSnap.size,
  };
}

/**
 * resolveSchoolYearByDate(date, schoolYears)
 * Given a JS Date and the list of configured SchoolYear docs, finds the
 * school year whose [startDate, endDate] range contains that date and
 * returns its label, or null if no configured year covers it.
 * This lets legacy Enrolled records (created before the schoolYear field
 * existed) resolve to a real DepEd school year label as soon as the admin
 * configures one with a matching date range — instead of staying stuck
 * under "Unknown" forever.
 */
function resolveSchoolYearByDate(date, schoolYears) {
  if (!date) return null;
  const iso = date.toISOString().slice(0, 10);
  const match = schoolYears.find(
    (sy) =>
      sy.startDate && sy.endDate && iso >= sy.startDate && iso <= sy.endDate,
  );
  return match ? match.label : null;
}

/**
 * getEnrollmentDropoutStats()
 * Returns enrollment vs. dropout counts bucketed by school year, for the
 * dashboard's bar chart.
 *
 * Resolution order for each record's year (most to least reliable):
 *   1. The explicit `schoolYear` / `droppedSchoolYear` field — set by
 *      enrollStudent() / dropStudent() from the admin-configured active
 *      School Year (see addSchoolYear() / setActiveSchoolYear()).
 *   2. A configured SchoolYear whose [startDate, endDate] range contains
 *      the record's enrolledAt/droppedAt date — this is what lets DepEd's
 *      real school-year calendar resolve OLDER records too, as soon as the
 *      admin has entered school years covering those dates.
 *   3. The enrolledAt/droppedAt timestamp run through the simple
 *      month-based heuristic (schoolYearLabel).
 *   4. "Unknown" — only when there's no usable date at all. The dashboard
 *      surfaces a "Fix missing dates" action for this case (see
 *      backfillEnrollmentTimestamps above).
 *
 * Shape: [{ year: "2025-2026", enrolled: 42, dropped: 3 }, ...]
 * sorted ascending by year, with "Unknown" (if present) placed first.
 */
export async function getEnrollmentDropoutStats() {
  const [enrolledSnap, schoolYearSnap] = await Promise.all([
    getDocs(col("Enrolled")),
    getDocs(col("SchoolYear")),
  ]);

  const schoolYears = schoolYearSnap.docs.map(snap);

  const buckets = {}; // year -> { enrolled, dropped }
  const ensure = (year) => {
    if (!buckets[year]) buckets[year] = { year, enrolled: 0, dropped: 0 };
    return buckets[year];
  };

  enrolledSnap.docs.forEach((d) => {
    const data = d.data();

    // Count the enrollment event
    const enrolledDate = toDate(data.enrolledAt);
    const enrolledYear =
      data.schoolYear ||
      resolveSchoolYearByDate(enrolledDate, schoolYears) ||
      (enrolledDate ? schoolYearLabel(enrolledDate) : "Unknown");
    ensure(enrolledYear).enrolled += 1;

    // Count the dropout event, if this record was ever dropped
    if (data.status === "Dropped") {
      const droppedDate = toDate(data.droppedAt);
      const droppedYear =
        data.droppedSchoolYear ||
        resolveSchoolYearByDate(droppedDate, schoolYears) ||
        (droppedDate ? schoolYearLabel(droppedDate) : "Unknown");
      ensure(droppedYear).dropped += 1;
    }
  });

  return Object.values(buckets).sort((a, b) => {
    if (a.year === "Unknown") return -1;
    if (b.year === "Unknown") return 1;
    return a.year.localeCompare(b.year);
  });
}

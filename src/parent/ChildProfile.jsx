// ChildProfile.jsx  (Firebase version)
// Reads the logged-in parent's linked studentIds from Firestore,
// then fetches each student's full profile and enrollment info.
// Also resolves the adviser (homeroom teacher) of the child's section,
// and lets the parent re-download the student's ID card (same format as
// the admin GenerateQr.jsx) — but only once the admin has actually
// generated it (i.e. a matching GeneratedQR record exists).
import "../Layout.css";
import React, { useState, useEffect } from "react";
import { db } from "../api/firebase";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import QRCode from "react-qr-code";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./ChildProfile.css";

const col = (name) => collection(db, name);

// Same physical card size used by the admin GenerateQr.jsx, so the
// downloaded PDF here is identical to the one admins produce.
const CARD_WIDTH_IN = 4.5;
const CARD_HEIGHT_IN = 2.75;

// ── resolve the adviser of a grade+section from the Teacher collection ──────
async function getSectionAdvisor(grade, section) {
  if (!section) return null;
  try {
    const snap = await getDocs(
      query(col("Teacher"), where("archived", "!=", true)),
    );
    const teachers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const sectionNorm = section.trim().toLowerCase();
    const candidates = [
      `grade ${grade} - ${section}`,
      `grade ${grade}-${section}`,
      `${grade} - ${section}`,
      `${grade}-${section}`,
      section,
    ].map((s) => s.trim().toLowerCase());

    let match = teachers.find((t) =>
      candidates.includes((t.advisory || "").trim().toLowerCase()),
    );

    if (!match) {
      match = teachers.find((t) =>
        (t.advisory || "").trim().toLowerCase().includes(sectionNorm),
      );
    }

    if (!match) return null;
    return `${match.lname}, ${match.fname}${match.mname ? " " + match.mname : ""}`;
  } catch (e) {
    console.error("Failed to load section adviser:", e);
    return null;
  }
}

// ── check whether the admin has already generated this student's ID ────────
// Mirrors GenerateQr.jsx / firebaseApi.js: a generated ID is recorded as a
// GeneratedQR doc keyed by lrn. No record = no ID has ever been printed,
// so there's nothing valid for the parent to re-download yet.
async function checkIdGenerated(lrn) {
  if (!lrn) return false;
  try {
    const snap = await getDocs(
      query(col("GeneratedQR"), where("lrn", "==", lrn)),
    );
    return !snap.empty;
  } catch (e) {
    console.error("Failed to check ID generation status:", e);
    return false;
  }
}

const ChildProfile = () => {
  const [children, setChildren] = useState([]); // array — a parent can have multiple children
  const [selected, setSelected] = useState(null); // currently displayed child
  const [loading, setLoading] = useState(true);

  const [advisorName, setAdvisorName] = useState("");
  const [advisorLoading, setAdvisorLoading] = useState(false);

  const [idGenerated, setIdGenerated] = useState(false);
  const [checkingId, setCheckingId] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        // 1. Get the parent User document to find their studentIds
        const userSnap = await getDoc(doc(db, "User", userId));
        if (!userSnap.exists()) {
          setLoading(false);
          return;
        }

        const userData = userSnap.data();
        const studentIds = userData.studentIds || [];

        if (studentIds.length === 0) {
          setLoading(false);
          return;
        }

        // 2. Fetch each student document
        const studentDocs = await Promise.all(
          studentIds.map((id) => getDoc(doc(db, "Student", id))),
        );

        // 3. For each student fetch their active enrollment (grade + section)
        const enriched = await Promise.all(
          studentDocs
            .filter((d) => d.exists())
            .map(async (d) => {
              const s = { id: d.id, ...d.data() };

              const enrollSnap = await getDocs(
                query(
                  col("Enrolled"),
                  where("studentId", "==", s.id),
                  where("status", "==", "Enrolled"),
                ),
              );
              const enrollment = enrollSnap.docs[0]?.data() || {};

              return {
                ...s,
                enrolledGrade: enrollment.grade || s.grade || "—",
                enrolledSection: enrollment.section || "—",
              };
            }),
        );

        setChildren(enriched);
        setSelected(enriched[0] || null);
      } catch (e) {
        console.error("Failed to load child profile:", e);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  // ── resolve the section adviser whenever the selected child changes ──────
  useEffect(() => {
    if (!selected) {
      setAdvisorName("");
      return;
    }
    let active = true;
    setAdvisorLoading(true);
    getSectionAdvisor(selected.enrolledGrade, selected.enrolledSection).then(
      (name) => {
        if (active) {
          setAdvisorName(name || "");
          setAdvisorLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [selected]);

  // ── check whether this child's ID has actually been generated ────────────
  useEffect(() => {
    if (!selected) {
      setIdGenerated(false);
      return;
    }
    let active = true;
    setCheckingId(true);
    checkIdGenerated(selected.lrn).then((generated) => {
      if (active) {
        setIdGenerated(generated);
        setCheckingId(false);
      }
    });
    return () => {
      active = false;
    };
  }, [selected]);

  // ── avatar helper (same canvas approach as GenerateQr) ────────────────
  const avatarUrl = (name) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "Student")}&background=3498db&color=fff&size=120`;
  };

  const formatDob = (dob) => {
    if (!dob) return "—";
    try {
      return new Date(dob).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return dob;
    }
  };

  // ── download the ID card (front + back) as a single PDF ─────────────────
  // Guarded: only proceeds if the admin has already generated this
  // student's ID (idGenerated). The button is also hidden/disabled in the
  // UI, but this check stays here too in case it's ever called directly.
  const downloadIDCard = async () => {
    if (!selected || downloading || !idGenerated) return;

    const frontNode = document.getElementById("profile-id-card-front");
    const backNode = document.getElementById("profile-id-card-back");
    if (!frontNode || !backNode) return;

    setDownloading(true);
    try {
      const [frontPng, backPng] = await Promise.all([
        toPng(frontNode, { pixelRatio: 3, backgroundColor: "#ffffff" }),
        toPng(backNode, { pixelRatio: 3, backgroundColor: "#ffffff" }),
      ]);

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

      pdf.addImage(
        frontPng,
        "PNG",
        marginX,
        marginTop,
        CARD_WIDTH_IN,
        CARD_HEIGHT_IN,
      );
      pdf.addImage(
        backPng,
        "PNG",
        marginX,
        marginTop + CARD_HEIGHT_IN + GAP_IN,
        CARD_WIDTH_IN,
        CARD_HEIGHT_IN,
      );

      const fullName = `${selected.lastName}, ${selected.firstName}${selected.middleName ? " " + selected.middleName : ""}`;
      const safeName = fullName
        .replace(/,/g, "")
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "");
      pdf.save(`${safeName}_Grade${selected.enrolledGrade}_ID.pdf`);
    } catch (err) {
      console.error("ID card download error:", err);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <p
              style={{ padding: "30px", textAlign: "center", color: "#a65f81" }}
            >
              Loading child profile…
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <div className="toolbar">
              <h2 className="section-title">My Child</h2>
            </div>
            <p style={{ padding: "30px", textAlign: "center", color: "#999" }}>
              No children linked to this account. Please contact the
              administrator.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const fullName = selected
    ? `${selected.lastName}, ${selected.firstName}${selected.middleName ? " " + selected.middleName : ""}`
    : "";

  return (
    <div className="app-container">
      <main className="main-content">
        <div className="page-container">
          <div className="toolbar">
            <h2 className="section-title">My Child</h2>
          </div>

          {/* CHILD FILTER — same pattern as the admin Archive.jsx filter bar */}
          {children.length > 1 && (
            <div className="cp-filter-group">
              {children.map((c) => (
                <button
                  key={c.id}
                  className={`cp-filter-btn ${selected?.id === c.id ? "active" : ""}`}
                  onClick={() => setSelected(c)}
                >
                  <i className="fas fa-user-graduate"></i>
                  {c.firstName} {c.lastName}
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="profile-layout-cp">
              <div className="profile-header-card">
                <img
                  src={avatarUrl(`${selected.firstName} ${selected.lastName}`)}
                  alt="Student"
                  className="student-photo"
                />
                <h1>{fullName}</h1>
                <p className="grade-level">
                  <i className="fas fa-award"></i> Grade{" "}
                  {selected.enrolledGrade} — Section {selected.enrolledSection}
                </p>
                <p className="advisor-name">
                  <i className="fas fa-chalkboard-teacher"></i>{" "}
                  {advisorLoading
                    ? "Loading adviser…"
                    : `Adviser: ${advisorName || "—"}`}
                </p>

                {checkingId ? (
                  <p className="id-status-note">
                    <i className="fas fa-spinner fa-spin"></i> Checking ID
                    status…
                  </p>
                ) : idGenerated ? (
                  <button
                    className="btn-download-id"
                    onClick={downloadIDCard}
                    disabled={downloading}
                  >
                    <i className="fas fa-download"></i>{" "}
                    {downloading ? "Generating PDF…" : "Download ID Card"}
                  </button>
                ) : (
                  <p className="id-not-ready-note">
                    <i className="fas fa-info-circle"></i> The school has not
                    generated this student's ID card yet.
                  </p>
                )}
              </div>

              <div className="profile-details-grid grid-two-columns">
                <div className="info-card">
                  <h3>
                    <i className="fas fa-user"></i> Personal Information
                  </h3>
                  <ul className="info-list">
                    <li>
                      <strong>Date of Birth:</strong> {formatDob(selected.dob)}
                    </li>
                    <li>
                      <strong>Age:</strong> {selected.age}
                    </li>
                    <li>
                      <strong>LRN:</strong> {selected.lrn}
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>
                    <i className="fas fa-map-marker-alt"></i> Contact &amp;
                    Address
                  </h3>
                  <ul className="info-list">
                    <li>
                      <strong>Address:</strong> {selected.address || "—"}
                    </li>
                    <li>
                      <strong>Contact No.:</strong> {selected.contact || "—"}
                    </li>
                    <li>
                      <strong>Guardian:</strong> {selected.guardian || "—"}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* HIDDEN ID CARD — rendered off-screen so it can be captured by
              html-to-image on demand. Only meaningful once idGenerated is
              true, but it's harmless to keep mounted either way. */}
          {selected && (
            <div
              style={{
                position: "absolute",
                top: "-9999px",
                left: "-9999px",
                pointerEvents: "none",
              }}
              aria-hidden="true"
            >
              <div id="profile-id-card-front" className="id-card">
                <div className="id-card-topbar">
                  <img
                    src="/logo.jpg"
                    alt="School Logo"
                    className="id-card-logo"
                  />
                  <div className="id-card-titles">
                    <span className="id-card-school">
                      MALAIG ELEMENTARY SCHOOL
                    </span>
                    <span className="id-card-type">
                      STUDENT IDENTIFICATION CARD
                    </span>
                  </div>
                </div>
                <div className="id-card-body-front">
                  <div className="id-photo-box" aria-label="2x2 photo guide">
                    <span className="id-photo-box-label">2×2</span>
                    <span className="id-photo-box-sublabel">
                      PASTE PHOTO HERE
                    </span>
                  </div>
                  <div className="id-info-right">
                    <div className="id-info-row">
                      <label>Name</label>
                      <span>{fullName}</span>
                    </div>
                    <div className="id-info-row">
                      <label>Birthdate</label>
                      <span>{selected.birthdate || selected.dob || "—"}</span>
                    </div>
                    <div className="id-info-row">
                      <label>LRN</label>
                      <span>{selected.lrn}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div id="profile-id-card-back" className="id-card">
                <div className="id-card-topbar small">
                  <span className="id-card-school">
                    MALAIG ELEMENTARY SCHOOL
                  </span>
                </div>
                <div className="id-card-body-back">
                  <div className="id-emergency-left">
                    <h4>EMERGENCY CONTACT</h4>
                    <div className="id-info-row">
                      <label>Guardian</label>
                      <span>{selected.guardian || "—"}</span>
                    </div>
                    <div className="id-info-row">
                      <label>Contact No.</label>
                      <span>
                        {selected.guardianContact || selected.contact || "—"}
                      </span>
                    </div>
                    <div className="id-info-row">
                      <label>Address</label>
                      <span>{selected.address || "—"}</span>
                    </div>
                  </div>
                  <div className="id-qr-right">
                    <QRCode
                      value={selected.lrn || ""}
                      size={110}
                      viewBox="0 0 256 256"
                      style={{ height: "auto", width: "100%" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ChildProfile;

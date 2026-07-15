// ChildProfile.jsx (Firebase version)
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
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./ChildProfile.css";

const col = (name) => collection(db, name);

// Resolve the adviser of a grade+section from the Teacher collection
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

const ChildProfile = () => {
  const [children, setChildren] = useState([]); 
  const [selected, setSelected] = useState(null); 
  const [loading, setLoading] = useState(true);

  const [advisorName, setAdvisorName] = useState("");
  const [advisorLoading, setAdvisorLoading] = useState(false);

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    if (!userId) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
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

        const studentDocs = await Promise.all(
          studentIds.map((id) => getDoc(doc(db, "Student", id))),
        );

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

  // Resolve the section adviser whenever the selected child changes
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

  const avatarUrl = (name) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "Student")}&background=3f3f97&color=fff&size=120`;
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

  if (loading) {
    return (
      <div className="app-container">
        <main className="main-content">
          <div className="page-container">
            <p style={{ padding: "30px", textAlign: "center", color: "#a65f81", fontWeight: "600" }}>
              <i className="fas fa-spinner fa-spin"></i> Loading child profile…
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
            <div className="toolbar-cp">
              <h2 className="section-title-cp">My Child</h2>
            </div>
            <p style={{ padding: "30px", textAlign: "center", color: "#999" }}>
              No children linked to this account. Please contact the administrator.
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
          <div className="toolbar-cp">
            <h2 className="section-title-cp">My Child</h2>
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
              {/* Premium Header Profile Deck */}
              <div className="profile-header-card">
                <div className="profile-header-banner-accent"></div>
                <div className="profile-header-content-block">
                  <img
                    src={avatarUrl(`${selected.firstName} ${selected.lastName}`)}
                    alt="Student"
                    className="student-photo"
                  />
                  <h1>{fullName}</h1>
                  <div className="profile-header-badge-row">
                    <span className="profile-badge-pill">
                      <i className="fas fa-award"></i> Grade {selected.enrolledGrade} — Section {selected.enrolledSection}
                    </span>
                    <span className="profile-badge-pill advisor">
                      <i className="fas fa-chalkboard-teacher"></i>{" "}
                      {advisorLoading ? "Loading adviser…" : `Adviser: ${advisorName || "—"}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Enhanced Visual Details Information Grid Matrix */}
              <div className="profile-details-grid grid-two-columns">
                <div className="info-card">
                  <h3>
                    <i className="fas fa-user"></i> Personal Information
                  </h3>
                  <ul className="info-list">
                    <li>
                      <div className="info-item-label"><i className="far fa-id-card"></i> Learner Reference Number (LRN)</div>
                      <strong className="sml-font-monospace">{selected.lrn}</strong>
                    </li>
                    <li>
                      <div className="info-item-label"><i className="far fa-calendar-alt"></i> Date of Birth</div>
                      <strong>{formatDob(selected.dob)}</strong>
                    </li>
                    <li>
                      <div className="info-item-label"><i className="fas fa-birthday-cake"></i> Age</div>
                      <strong>{selected.age ? `${selected.age} years old` : "—"}</strong>
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>
                    <i className="fas fa-map-marker-alt"></i> Contact &amp; Address
                  </h3>
                  <ul className="info-list">
                    <li>
                      <div className="info-item-label"><i className="fas fa-home"></i> Address</div>
                      <strong>{selected.address || "—"}</strong>
                    </li>
                    <li>
                      <div className="info-item-label"><i className="fas fa-phone-alt"></i> Contact No.</div>
                      <strong>{selected.contact || "—"}</strong>
                    </li>
                    <li>
                      <div className="info-item-label"><i className="fas fa-user-shield"></i> Parent / Guardian</div>
                      <strong>{selected.guardian || "—"}</strong>
                    </li>
                  </ul>
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
// GenerateQr.jsx  (Firebase version)
// Run `npm install jspdf` if jsPDF is not already a project dependency.
import React, { useState, useEffect } from "react";
import QRCode from "react-qr-code";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import { getStudentsQrAvailable, markQrGenerated } from "../api/firebaseApi";
import "./GenerateQr.css";

// Physical ID card size in inches. Sized so a true 2in x 2in photo guide
// box fits on the front alongside the header and student info. The CSS
// preview (.id-card) is drawn at exactly 100px per inch so it stays in the
// same proportion as the printed PDF.
const CARD_WIDTH_IN = 4.5;
const CARD_HEIGHT_IN = 2.75;

const GenerateQR = () => {
  const [availableStudents, setAvailableStudents] = useState([]);
  const [selectedLrn, setSelectedLrn] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [displayData, setDisplayData] = useState({
    name: "",
    lrn: "",
    grade: "",
    birthdate: "",
    address: "",
    guardianName: "",
    guardianContact: "",
  });

  const fetchAvailableStudents = async () => {
    setLoading(true);
    try {
      setAvailableStudents(await getStudentsQrAvailable());
    } catch (e) {
      console.error("Failed to load students:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailableStudents();
  }, []);

  const handleLrnSelect = (e) => {
    const lrn = e.target.value;
    setSelectedLrn(lrn);
    setShowPreview(false);
    if (!lrn) {
      setSelectedStudent(null);
      return;
    }
    const found = availableStudents.find((s) => s.lrn === lrn);
    setSelectedStudent(found || null);
  };

  const handleGenerate = (e) => {
    e.preventDefault();
    if (!selectedStudent) return;
    const fullName = `${selectedStudent.lastName}, ${selectedStudent.firstName}${selectedStudent.middleName ? " " + selectedStudent.middleName : ""}`;
    setDisplayData({
      name: fullName,
      lrn: selectedStudent.lrn,
      grade: selectedStudent.grade,
      birthdate: selectedStudent.birthdate || selectedStudent.dob || "—",
      address: selectedStudent.address || "—",
      guardianName: selectedStudent.guardian || "—",
      guardianContact:
        selectedStudent.guardianContact || selectedStudent.contact || "—",
    });
    setShowPreview(true);
  };

  const downloadIDCard = async () => {
    const frontNode = document.getElementById("id-card-front");
    const backNode = document.getElementById("id-card-back");
    if (!frontNode || !backNode) return;

    setGenerating(true);
    try {
      const [frontPng, backPng] = await Promise.all([
        toPng(frontNode, { pixelRatio: 3, backgroundColor: "#ffffff" }),
        toPng(backNode, { pixelRatio: 3, backgroundColor: "#ffffff" }),
      ]);

      // Single standard bond-paper sheet (Letter, 8.5in x 11in) with both
      // sides of the card centered on it — print as-is, then cut out.
      const PAGE_WIDTH_IN = 8.5;
      const PAGE_HEIGHT_IN = 11;
      const GAP_IN = 0.4; // space between the front and back card

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

      const safeName = displayData.name
        .replace(/,/g, "")
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "");
      pdf.save(`${safeName}_Grade${displayData.grade}_ID.pdf`);

      await markQrGenerated(displayData.lrn);
      await fetchAvailableStudents();
      setSelectedLrn("");
      setSelectedStudent(null);
      setShowPreview(false);
    } catch (err) {
      console.error("Download error:", err);
    } finally {
      setGenerating(false);
    }
  };

  const fullNameDisplay = selectedStudent
    ? `${selectedStudent.lastName}, ${selectedStudent.firstName}${selectedStudent.middleName ? " " + selectedStudent.middleName : ""}`
    : "";

  return (
    <main
      className="main-content"
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
    >
      <div className="page-container">
        <div className="qr-layout">
          {/* FORM */}
          <div className="card search-card">
            <div className="card-header-qr">
              <h3>
                <i className="fas fa-user-graduate"></i> Student QR ID card
              </h3>
              <p>
                Select a student from the list to generate their QR ID card.
              </p>
            </div>

            <form onSubmit={handleGenerate}>
              <div className="form-group-qr">
                <label>Select Student (LRN)</label>
                {loading ? (
                  <p style={{ color: "#3498db", fontSize: "0.875rem" }}>
                    Loading students…
                  </p>
                ) : availableStudents.length === 0 ? (
                  <p
                    style={{
                      color: "#888",
                      fontSize: "0.875rem",
                      background: "#f5f5f5",
                      padding: "10px",
                      borderRadius: "6px",
                    }}
                  >
                    All students have already had their QR ID generated.
                  </p>
                ) : (
                  <select
                    value={selectedLrn}
                    onChange={handleLrnSelect}
                    required
                  >
                    <option value="">— Select a student LRN —</option>
                    {availableStudents.map((s) => (
                      <option key={s.id} value={s.lrn}>
                        {s.lrn} — {s.lastName}, {s.firstName} (Grade {s.grade})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="form-group-qr">
                <label>Student Name</label>
                <input
                  type="text"
                  value={fullNameDisplay}
                  readOnly
                  placeholder="Auto-filled when LRN is selected"
                  style={{ background: "#f5f5f5", cursor: "not-allowed" }}
                />
                {selectedStudent && (
                  <small style={{ color: "#27ae60" }}>
                    ✓ Grade {selectedStudent.grade} — Guardian:{" "}
                    {selectedStudent.guardian}
                  </small>
                )}
              </div>

              <div className="form-group-qr" style={{ marginTop: "20px" }}>
                <button
                  type="submit"
                  className="btn-generate"
                  disabled={!selectedStudent || loading}
                >
                  <i className="fas fa-magic"></i> Generate ID Card
                </button>
              </div>
            </form>

            <div className="tips">
              <h4>
                <i className="fas fa-lightbulb"></i> Tips:
              </h4>
              <ul>
                <li>
                  Only students without a generated QR ID appear in the
                  dropdown.
                </li>

                <li>
                  Downloading saves one Letter-size (8.5"×11") bond paper PDF
                  with the front and back centered, ready to print and cut.
                </li>
                <li>
                  After downloading, the student is automatically removed from
                  the list.
                </li>
              </ul>
            </div>
          </div>

          {/* PREVIEW */}
          {showPreview ? (
            <div className="card preview-card">
              <div className="id-sides-wrapper">
                {/* FRONT */}
                <div className="id-side-block">
                  <span className="side-label">FRONT</span>
                  <div id="id-card-front" className="id-card">
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
                      <div
                        className="id-photo-box"
                        aria-label="2x2 photo guide"
                      >
                        <span className="id-photo-box-label">2×2</span>
                        <span className="id-photo-box-sublabel">
                          PASTE PHOTO HERE
                        </span>
                      </div>
                      <div className="id-info-right">
                        <div className="id-info-row">
                          <label>Name</label>
                          <span>{displayData.name}</span>
                        </div>
                        <div className="id-info-row">
                          <label>Birthdate</label>
                          <span>{displayData.birthdate}</span>
                        </div>

                        <div className="id-info-row">
                          <label>LRN</label>
                          <span>{displayData.lrn}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* BACK */}
                <div className="id-side-block">
                  <span className="side-label">BACK</span>
                  <div id="id-card-back" className="id-card">
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
                          <span>{displayData.guardianName}</span>
                        </div>
                        <div className="id-info-row">
                          <label>Contact No.</label>
                          <span>{displayData.guardianContact}</span>
                        </div>
                        <div className="id-info-row">
                          <label>Address</label>
                          <span>{displayData.address}</span>
                        </div>
                      </div>
                      <div className="id-qr-right">
                        <QRCode
                          value={displayData.lrn}
                          size={110}
                          viewBox="0 0 256 256"
                          style={{ height: "auto", width: "100%" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="action-buttons">
                <button
                  className="btn-download"
                  onClick={downloadIDCard}
                  disabled={generating}
                >
                  <i className="fas fa-download"></i>{" "}
                  {generating ? "Saving PDF…" : "Download & Save"}
                </button>
              </div>
              <p
                style={{
                  textAlign: "center",
                  fontSize: "0.8rem",
                  color: "#999",
                  marginTop: "8px",
                }}
              >
                Downloading will mark this student as generated and remove them
                from the list.
              </p>
            </div>
          ) : (
            <div className="card empty-state">
              <i
                className="fas fa-id-card"
                style={{
                  fontSize: "4rem",
                  color: "#eee",
                  marginBottom: "15px",
                }}
              ></i>
              <h3>Ready to Generate</h3>
              <p>
                Select a student LRN from the dropdown to preview their ID card.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};

export default GenerateQR;

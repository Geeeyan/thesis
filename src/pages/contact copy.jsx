import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/navbar";
import bgImage from "../assets/img1.jpg";
import "../style.css";

function ContactManage() {
  const navigate = useNavigate();

  const [mainTab, setMainTab] = useState("contact");

  const [manageTab, setManageTab] = useState("cancel");

  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  const [contactSubmitted, setContactSubmitted] = useState(false);

  const [bookingId, setBookingId] = useState("");
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [manageNote, setManageNote] = useState("");
  const [manageSubmitted, setManageSubmitted] = useState(false);
  const [manageError, setManageError] = useState("");

  const cancelReasons = [
    "Change of plans",
    "Found a better option",
    "Personal emergency",
    "Financial reasons",
    "Duplicate booking",
    "Other",
  ];

  const timeSlots = [
    "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM",
    "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM",
    "4:00 PM", "5:00 PM", "6:00 PM",
  ];

  const today = new Date().toISOString().split("T")[0];

  const handleContactChange = (e) => {
    setContactForm({ ...contactForm, [e.target.name]: e.target.value });
  };

  const handleContactSubmit = (e) => {
    e.preventDefault();
    setContactSubmitted(true);
  };

  const handleManageSubmit = (e) => {
    e.preventDefault();
    if (!bookingId.trim()) {
      setManageError("Please enter your Booking ID.");
      return;
    }
    if (manageTab === "cancel" && !reason) {
      setManageError("Please select a reason for cancellation.");
      return;
    }
    if (manageTab === "reschedule" && (!newDate || !newTime)) {
      setManageError("Please select a new date and time slot.");
      return;
    }
    setManageError("");
    setManageSubmitted(true);
  };

  const resetManage = () => {
    setManageSubmitted(false);
    setBookingId("");
    setReason("");
    setNewDate("");
    setNewTime("");
    setManageNote("");
    setManageError("");
  };

  const mainTabStyle = (tab) => ({
    flex: 1,
    padding: "0.9rem 1rem",
    border: "none",
    background: mainTab === tab ? "#fff8ee" : "#f5f5f5",
    borderBottom: mainTab === tab ? "3px solid #f0a500" : "3px solid transparent",
    fontWeight: mainTab === tab ? 700 : 500,
    color: mainTab === tab ? "#b07800" : "#666",
    cursor: "pointer",
    fontSize: "1rem",
    transition: "all 0.2s",
  });

  const subTabStyle = (tab, activeColor, activeBg, activeBorder) => ({
    flex: 1,
    padding: "0.75rem",
    border: "none",
    background: manageTab === tab ? activeBg : "#fafafa",
    borderBottom: manageTab === tab ? `3px solid ${activeBorder}` : "3px solid transparent",
    fontWeight: manageTab === tab ? 700 : 500,
    color: manageTab === tab ? activeColor : "#777",
    cursor: "pointer",
    fontSize: "0.92rem",
    transition: "all 0.2s",
  });

  return (
    <div>
      <Navbar />

      <div
        className="contact-hero"
        style={{ backgroundImage: `url(${bgImage})` }}
      >
        <div className="contact-hero-overlay" />
        <div className="contact-hero-text">
          <span className="section-tag">We're Here to Help</span>
          <h1>Contact & Booking Management</h1>
          <p>Send us a message or manage your existing reservation — all in one place.</p>
        </div>
      </div>

      <div className="contact-page">

        <div className="contact-info-grid">
          <div className="contact-info-card">
            <div className="contact-info-icon">
              <i className="bi bi-geo-alt-fill"></i>
            </div>
            <h4>Location</h4>
            <p>Biñan City, Laguna<br />Philippines</p>
          </div>
          <div className="contact-info-card">
            <div className="contact-info-icon">
              <i className="bi bi-telephone-fill"></i>
            </div>
            <h4>Phone</h4>
            <p>+63 912 345 6789<br />Mon – Sun, 8am – 9pm</p>
          </div>
          <div className="contact-info-card">
            <div className="contact-info-icon">
              <i className="bi bi-envelope-fill"></i>
            </div>
            <h4>Email</h4>
            <p>hello@villatjeozabel.com<br />We reply within 24 hours</p>
          </div>
        </div>

        <div className="contact-form-wrapper" style={{ padding: 0, overflow: "hidden" }}>

          <div className="d-flex" style={{ borderBottom: "1px solid #eee" }}>
            <button style={mainTabStyle("contact")} onClick={() => setMainTab("contact")}>
              <i className="bi bi-envelope me-2"></i>Send an Inquiry
            </button>
            <button style={mainTabStyle("manage")} onClick={() => setMainTab("manage")}>
              <i className="bi bi-calendar3 me-2"></i>Manage Booking
            </button>
          </div>

          {mainTab === "contact" && (
            <div className="p-4">
              {contactSubmitted ? (
                <div className="contact-success">
                  <div className="contact-success-icon">
                    <i className="bi bi-check-circle-fill"></i>
                  </div>
                  <h3>Message Sent!</h3>
                  <p>Thank you for reaching out. We'll get back to you within 24 hours.</p>
                  <button
                    className="btn auth-btn"
                    style={{ maxWidth: 200, margin: "20px auto 0" }}
                    onClick={() => {
                      setContactSubmitted(false);
                      setContactForm({ name: "", email: "", phone: "", subject: "", message: "" });
                    }}
                  >
                    Send Another
                  </button>
                  <Link to="/" className="contact-back-link">← Back to Home</Link>
                </div>
              ) : (
                <>
                  <div className="contact-form-header">
                    <h2>Send an Inquiry</h2>
                    <p className="section-sub" style={{ marginBottom: 0 }}>
                      Fill out the form below and our team will contact you shortly.
                    </p>
                  </div>

                  <form className="contact-form" onSubmit={handleContactSubmit}>
                    <div className="contact-form-row">
                      <div className="contact-field">
                        <label>Full Name <span>*</span></label>
                        <input
                          type="text"
                          name="name"
                          className="auth-input"
                          placeholder="Juan dela Cruz"
                          value={contactForm.name}
                          onChange={handleContactChange}
                          required
                        />
                      </div>
                      <div className="contact-field">
                        <label>Email Address <span>*</span></label>
                        <input
                          type="email"
                          name="email"
                          className="auth-input"
                          placeholder="juan@email.com"
                          value={contactForm.email}
                          onChange={handleContactChange}
                          required
                        />
                      </div>
                    </div>

                    <div className="contact-form-row">
                      <div className="contact-field">
                        <label>Phone Number</label>
                        <input
                          type="tel"
                          name="phone"
                          className="auth-input"
                          placeholder="+63 912 345 6789"
                          value={contactForm.phone}
                          onChange={handleContactChange}
                        />
                      </div>
                      <div className="contact-field">
                        <label>Subject <span>*</span></label>
                        <select
                          name="subject"
                          className="auth-input contact-select"
                          value={contactForm.subject}
                          onChange={handleContactChange}
                          required
                        >
                          <option value="" disabled>Select a subject</option>
                          <option value="reservation">Room Reservation</option>
                          <option value="event">Event Booking</option>
                          <option value="pricing">Pricing Inquiry</option>
                          <option value="cancellation">Cancellation / Reschedule</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    </div>

                    <div className="contact-field">
                      <label>Message <span>*</span></label>
                      <textarea
                        name="message"
                        className="auth-input contact-textarea"
                        placeholder="Tell us about your inquiry, preferred dates, number of guests..."
                        value={contactForm.message}
                        onChange={handleContactChange}
                        required
                        rows={5}
                      />
                    </div>

                    <button type="submit" className="btn auth-btn contact-submit">
                      Send Message →
                    </button>
                  </form>
                </>
              )}
            </div>
          )}

          {mainTab === "manage" && (
            <>
              <div className="d-flex" style={{ borderBottom: "1px solid #eee", background: "#fafafa" }}>
                <button
                  style={subTabStyle("cancel", "#b07800", "#fff8ee", "#f0a500")}
                  onClick={() => { setManageTab("cancel"); setManageSubmitted(false); setManageError(""); }}
                >
                  <i className="bi bi-x-circle me-2"></i>Cancel Booking
                </button>
                <button
                  style={subTabStyle("reschedule", "#1a56cc", "#eef6ff", "#3a86ff")}
                  onClick={() => { setManageTab("reschedule"); setManageSubmitted(false); setManageError(""); }}
                >
                  <i className="bi bi-calendar2-week me-2"></i>Reschedule Booking
                </button>
              </div>

              <div className="p-4">
                {manageSubmitted ? (
                  <div className="contact-success">
                    <div className="contact-success-icon">
                      {manageTab === "cancel"
                        ? <i className="bi bi-check-circle-fill"></i>
                        : <i className="bi bi-stars"></i>
                      }
                    </div>
                    <h3>
                      {manageTab === "cancel"
                        ? "Cancellation Request Submitted!"
                        : "Reschedule Request Submitted!"}
                    </h3>
                    <p>
                      {manageTab === "cancel"
                        ? `Your cancellation for Booking #${bookingId} has been received. A confirmation email will be sent shortly.`
                        : `Your reschedule for Booking #${bookingId} to ${newDate} at ${newTime} has been received. We'll confirm availability shortly.`}
                    </p>
                    <button
                      className="btn auth-btn"
                      style={{ maxWidth: 200, margin: "20px auto 0" }}
                      onClick={resetManage}
                    >
                      Submit Another
                    </button>
                    <Link to="/" className="contact-back-link">← Back to Home</Link>
                  </div>
                ) : (
                  <form onSubmit={handleManageSubmit}>

                    <div className="contact-field mb-3">
                      <label>
                        Booking ID <span style={{ color: "red" }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="auth-input"
                        placeholder="e.g. VT-20260001"
                        value={bookingId}
                        onChange={(e) => setBookingId(e.target.value)}
                      />
                      <small style={{ color: "#888" }}>
                        Find your Booking ID in your confirmation email.
                      </small>
                    </div>

                    {manageTab === "cancel" && (
                      <div className="contact-field mb-3">
                        <label>
                          Reason for Cancellation <span style={{ color: "red" }}>*</span>
                        </label>
                        <select
                          className="auth-input contact-select"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        >
                          <option value="">-- Select a reason --</option>
                          {cancelReasons.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {manageTab === "reschedule" && (
                      <>
                        <div className="contact-field mb-3">
                          <label>
                            New Date <span style={{ color: "red" }}>*</span>
                          </label>
                          <input
                            type="date"
                            className="auth-input"
                            min={today}
                            value={newDate}
                            onChange={(e) => setNewDate(e.target.value)}
                          />
                        </div>

                        <div className="contact-field mb-3">
                          <label>
                            Preferred Time Slot <span style={{ color: "red" }}>*</span>
                          </label>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(4, 1fr)",
                              gap: "8px",
                              marginTop: "6px",
                            }}
                          >
                            {timeSlots.map((slot) => (
                              <button
                                key={slot}
                                type="button"
                                onClick={() => setNewTime(slot)}
                                style={{
                                  padding: "0.4rem 0.2rem",
                                  fontSize: "0.8rem",
                                  borderRadius: "8px",
                                  border: newTime === slot ? "2px solid #3a86ff" : "1px solid #ddd",
                                  background: newTime === slot ? "#eef6ff" : "#fafafa",
                                  color: newTime === slot ? "#1a56cc" : "#555",
                                  fontWeight: newTime === slot ? 700 : 400,
                                  cursor: "pointer",
                                  transition: "all 0.15s",
                                }}
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}

                    <div className="contact-field mb-3">
                      <label>
                        Additional Notes{" "}
                        <span style={{ color: "#aaa", fontWeight: 400 }}>(optional)</span>
                      </label>
                      <textarea
                        className="auth-input contact-textarea"
                        placeholder="Any other details we should know..."
                        value={manageNote}
                        onChange={(e) => setManageNote(e.target.value)}
                        rows={3}
                      />
                    </div>

                    {manageError && (
                      <div
                        className="mb-3 px-3 py-2"
                        style={{
                          background: "#fff0f0",
                          border: "1px solid #f5c6cb",
                          borderRadius: "8px",
                          color: "#c0392b",
                          fontSize: "0.9rem",
                        }}
                      >
                        <i className="bi bi-exclamation-triangle-fill me-2"></i>
                        {manageError}
                      </div>
                    )}

                    <div className="d-flex gap-3">
                      <button type="submit" className="btn auth-btn contact-submit" style={{ flex: 1 }}>
                        {manageTab === "cancel" ? "Submit Cancellation →" : "Submit Reschedule →"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={() => navigate("/")}
                        style={{ padding: "0.65rem 1.2rem" }}
                      >
                        Back
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="text-center py-3 footer">
        © 2026 Villa Tjeozabel
      </footer>
    </div>
  );
}

export default ContactManage;
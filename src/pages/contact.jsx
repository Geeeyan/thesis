import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/navbar";
import bgImage from "../assets/img1.jpg";
import { apiRequest, getSessionToken, getSessionUser } from "../api";
import { formatArrivalTime } from "../utils/arrivalTime";
import ReservationDatePicker from "../components/reservationdatepicker";
import "../style.css";

function dateAfter(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function InquiryConversation({ ticket }) {
  const [conversation, setConversation] = useState(null);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isCurrent = true;
    async function loadConversation() {
      try {
        const result = await apiRequest(`/messages/${ticket.id}`, {
          headers: ticket.accessToken ? { "X-Inquiry-Token": ticket.accessToken } : {},
        });
        if (isCurrent) {
          setConversation(result);
          setError("");
        }
      } catch (requestError) {
        if (isCurrent) setError(requestError.message);
      } finally {
        if (isCurrent) setLoading(false);
      }
    }
    loadConversation();
    const timer = setInterval(loadConversation, 15000);
    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [ticket.id, ticket.accessToken]);

  async function sendReply(event) {
    event.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setError("");
    try {
      const sent = await apiRequest(`/messages/${ticket.id}/replies`, {
        method: "POST",
        headers: ticket.accessToken ? { "X-Inquiry-Token": ticket.accessToken } : {},
        body: JSON.stringify({ body: reply }),
      });
      setConversation((current) => current ? { ...current, messages: [...current.messages, sent] } : current);
      setReply("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ marginTop: 24, border: "1px solid #FED7AA", borderRadius: 16, padding: 20, background: "#fff" }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>Inquiry conversation</h3>
      <p style={{ margin: "0 0 16px", color: "#6B7280", fontSize: 13 }}>Ticket #{ticket.id} · {ticket.subject}</p>
      {loading && <p>Loading conversation…</p>}
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
      {conversation && (
        <>
          <div aria-live="polite" style={{ display: "grid", gap: 10, maxHeight: 320, overflowY: "auto", marginBottom: 16 }}>
            {conversation.messages.map((message) => {
              const fromTeam = message.senderRole === "staff" || message.senderRole === "admin";
              return (
                <div key={message.id} style={{ justifySelf: fromTeam ? "start" : "end", maxWidth: "85%", padding: "10px 14px", borderRadius: 14, background: fromTeam ? "#FFF7ED" : "#F3F4F6" }}>
                  <strong style={{ display: "block", fontSize: 12, marginBottom: 4 }}>{fromTeam ? message.senderName || "Villa Tjeozabel team" : "You"}</strong>
                  <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{message.body}</div>
                  <time style={{ display: "block", color: "#9CA3AF", fontSize: 11, marginTop: 6 }}>{new Date(`${message.createdAt.replace(" ", "T")}Z`).toLocaleString()}</time>
                </div>
              );
            })}
          </div>
          <form onSubmit={sendReply}>
            <label htmlFor={`inquiry-reply-${ticket.id}`} style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Reply to our team</label>
            <textarea id={`inquiry-reply-${ticket.id}`} className="auth-input contact-textarea" rows={3} maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} required />
            <button type="submit" className="btn auth-btn" disabled={sending} style={{ marginTop: 10 }}>
              {sending ? "Sending…" : "Send Reply"}
            </button>
          </form>
        </>
      )}
      {!ticket.accessToken && <p style={{ margin: "12px 0 0", color: "#6B7280", fontSize: 12 }}>This conversation is linked to your account.</p>}
    </div>
  );
}

function ContactManage() {
  const navigate = useNavigate();

  const [mainTab, setMainTab] = useState("contact");

  const [manageTab, setManageTab] = useState("cancel");

  const [contactForm, setContactForm] = useState(() => {
    const user = getSessionUser();
    return {
    name: user?.name || "",
    email: user?.email || "",
    phone: "",
    subject: "",
    message: "",
    };
  });
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState("");
  const [tickets, setTickets] = useState(() => JSON.parse(localStorage.getItem("inquiryTickets") || "[]"));
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [manageLoading, setManageLoading] = useState(false);

  useEffect(() => {
    if (!getSessionToken()) return undefined;
    let isCurrent = true;
    apiRequest("/messages")
      .then((items) => {
        if (!Array.isArray(items)) throw new Error("The conversation response was not a list.");
        if (!isCurrent) return;
        setTickets((current) => {
          const known = new Map(current.map((ticket) => [ticket.id, ticket]));
          const merged = items.map((item) => ({ ...known.get(item.id), ...item }));
          const currentIds = new Set(merged.map((ticket) => ticket.id));
          return [...merged, ...current.filter((ticket) => !currentIds.has(ticket.id))];
        });
      })
      .catch((requestError) => {
        if (isCurrent) setContactError(requestError.message);
      });
    return () => { isCurrent = false; };
  }, []);

  const [bookingId, setBookingId] = useState("");
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newCheckOut, setNewCheckOut] = useState("");
  const [newPreferredTime, setNewPreferredTime] = useState("");
  const [rescheduleTimeOptions, setRescheduleTimeOptions] = useState([]);
  const [loadingRescheduleTimes, setLoadingRescheduleTimes] = useState(false);
  const [manageNote, setManageNote] = useState("");
  const [manageSubmitted, setManageSubmitted] = useState(false);
  const [manageError, setManageError] = useState("");
  const [manageReservation, setManageReservation] = useState(null);
  const [manageLookupLoading, setManageLookupLoading] = useState(false);

  const cancelReasons = [
    "Change of plans",
    "Found a better option",
    "Personal emergency",
    "Financial reasons",
    "Duplicate booking",
    "Other",
  ];

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    if (!manageReservation?.sameDayCheckout || manageTab !== "reschedule") {
      setRescheduleTimeOptions([]);
      setLoadingRescheduleTimes(false);
      return undefined;
    }
    let active = true;
    const query = new URLSearchParams({ from: today, to: dateAfter(today, 365) });
    setLoadingRescheduleTimes(true);
    apiRequest(`/reservations/${manageReservation.id}/available-dates?${query}`)
      .then(({ availableDates }) => {
        if (active) setRescheduleTimeOptions(availableDates);
      })
      .catch((requestError) => {
        if (active) setManageError(requestError.message);
      })
      .finally(() => {
        if (active) setLoadingRescheduleTimes(false);
      });
    return () => { active = false; };
  }, [manageReservation?.id, manageReservation?.sameDayCheckout, manageTab]);

  const handleContactChange = (e) => {
    setContactForm({ ...contactForm, [e.target.name]: e.target.value });
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setContactError("");
    setContactLoading(true);
    try {
      const result = await apiRequest("/messages/inquiries", {
        method: "POST",
        body: JSON.stringify(contactForm),
      });
      const ticket = {
        id: result.conversationId,
        accessToken: result.accessToken,
        subject: contactForm.subject,
        guestEmail: contactForm.email,
      };
      const updatedTickets = [ticket, ...tickets.filter((item) => item.id !== ticket.id)];
      localStorage.setItem("inquiryTickets", JSON.stringify(updatedTickets));
      setTickets(updatedTickets);
      setActiveTicketId(ticket.id);
      setContactSubmitted(true);
    } catch (requestError) {
      setContactError(requestError.message);
    } finally {
      setContactLoading(false);
    }
  };

  const handleManageSubmit = async (e) => {
    e.preventDefault();
    setManageError("");
    if (!bookingId.trim()) {
      setManageError("Please enter your Booking ID.");
      return;
    }
    if (manageTab === "cancel" && !reason) {
      setManageError("Please select a reason for cancellation.");
      return;
    }
    if (manageTab === "reschedule" && (!newDate || (manageReservation?.sameDayCheckout
      ? !newPreferredTime
      : !newCheckOut || newCheckOut <= newDate))) {
      setManageError(manageReservation?.sameDayCheckout
        ? "Please select a date and available start time."
        : "Please select valid new check-in and check-out dates.");
      return;
    }
    if (!getSessionToken()) {
      setManageError("Please sign in to your account to submit a booking change request.");
      return;
    }

    setManageLoading(true);
    try {
      const reservations = await apiRequest("/reservations");
      const reservation = reservations.find((item) => item.reference === bookingId.trim().toUpperCase());
      if (!reservation) throw new Error("We couldn't find that booking in your account. Check the reference or sign in with the account used to book.");
      setManageReservation(reservation);
      if (!reservation.changeRequestsAllowed) {
        setManageError("Cancellation and rescheduling are only available until 72 hours before check-in.");
        return;
      }
      const request = manageTab === "cancel"
        ? { type: "cancellation", reason, note: manageNote }
        : {
          type: "reschedule",
          checkIn: newDate,
          checkOut: manageReservation?.sameDayCheckout ? newDate : newCheckOut,
          ...(manageReservation?.sameDayCheckout ? { preferredTime: newPreferredTime } : {}),
          note: manageNote,
        };
      await apiRequest(`/reservations/${reservation.id}/change-requests`, {
        method: "POST",
        body: JSON.stringify(request),
      });
      setManageSubmitted(true);
    } catch (requestError) {
      setManageError(requestError.message);
    } finally {
      setManageLoading(false);
    }
  };

  const handleBookingIdBlur = async () => {
    const reference = bookingId.trim().toUpperCase();
    if (!reference || !getSessionToken()) return;

    setManageLookupLoading(true);
    setManageError("");
    try {
      const reservations = await apiRequest("/reservations");
      if (bookingId.trim().toUpperCase() !== reference) return;
      const reservation = reservations.find((item) => item.reference === reference);
      if (!reservation) {
        setManageReservation(null);
        setManageError("We couldn't find that booking in your account. Check the reference or sign in with the account used to book.");
        return;
      }
      setManageReservation(reservation);
    } catch (requestError) {
      if (bookingId.trim().toUpperCase() === reference) setManageError(requestError.message);
    } finally {
      if (bookingId.trim().toUpperCase() === reference) setManageLookupLoading(false);
    }
  };

  const resetManage = () => {
    setManageSubmitted(false);
    setBookingId("");
    setManageReservation(null);
    setReason("");
    setNewDate("");
    setNewCheckOut("");
    setNewPreferredTime("");
    setManageNote("");
    setManageError("");
  };

  const manageOptionsDisabled = manageLoading || manageLookupLoading
    || Boolean(manageReservation && !manageReservation.changeRequestsAllowed);

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
              {contactError && <p role="alert" style={{ color: "#b42318" }}>{contactError}</p>}
              {contactSubmitted ? (
                <div className="contact-success">
                  <div className="contact-success-icon">
                    <i className="bi bi-check-circle-fill"></i>
                  </div>
                  <h3>Inquiry Sent!</h3>
                  <p>Your message is saved. Our team can reply here; this ticket is saved in this browser.</p>
                  {tickets.find((ticket) => ticket.id === activeTicketId) && (
                    <InquiryConversation ticket={tickets.find((ticket) => ticket.id === activeTicketId)} />
                  )}
                  <button
                    className="btn auth-btn"
                    style={{ maxWidth: 200, margin: "20px auto 0" }}
                    onClick={() => {
                      setContactSubmitted(false);
                      setActiveTicketId(null);
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

                    <button type="submit" className="btn auth-btn contact-submit" disabled={contactLoading}>
                      {contactLoading ? "Sending…" : "Send Message →"}
                    </button>
                  </form>
                  {tickets.length > 0 && (
                    <div style={{ marginTop: 28 }}>
                      <h3 style={{ fontSize: 18 }}>Your conversations</h3>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {tickets.map((ticket) => (
                          <button key={ticket.id} type="button" className="btn btn-outline-secondary" onClick={() => setActiveTicketId(ticket.id)}>
                            #{ticket.id} · {ticket.subject}
                          </button>
                        ))}
                      </div>
                      {tickets.find((ticket) => ticket.id === activeTicketId) && (
                        <InquiryConversation ticket={tickets.find((ticket) => ticket.id === activeTicketId)} />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {mainTab === "manage" && (
            <>
              <div className="d-flex" style={{ borderBottom: "1px solid #eee", background: "#fafafa" }}>
                <button
                  style={{ ...subTabStyle("cancel", "#b07800", "#fff8ee", "#f0a500"), cursor: manageOptionsDisabled ? "not-allowed" : "pointer", opacity: manageOptionsDisabled ? 0.55 : 1 }}
                  disabled={manageOptionsDisabled}
                  onClick={() => { setManageTab("cancel"); setManageSubmitted(false); setManageError(""); }}
                >
                  <i className="bi bi-x-circle me-2"></i>Cancel Booking
                </button>
                <button
                  style={{ ...subTabStyle("reschedule", "#1a56cc", "#eef6ff", "#3a86ff"), cursor: manageOptionsDisabled ? "not-allowed" : "pointer", opacity: manageOptionsDisabled ? 0.55 : 1 }}
                  disabled={manageOptionsDisabled}
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
                        ? `Your cancellation request for Booking #${bookingId} has been sent to our team for review. Your booking remains active until staff confirms the request.`
                        : `Your reschedule request for Booking #${bookingId}, from ${newDate}${newPreferredTime ? ` at ${formatArrivalTime(newPreferredTime)}` : ""} to ${manageReservation?.sameDayCheckout ? newDate : newCheckOut}, has been sent to our team. Dates are subject to availability and staff confirmation.`}
                    </p>
                    <p>Follow up with our team from Messages on your account dashboard.</p>
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
                    {!getSessionToken() && (
                      <p role="note" style={{ color: "#6B7280" }}>
                        <Link to="/login" style={{ color: "#C2410C", fontWeight: 700 }}>Sign in</Link> to submit a booking change request.
                      </p>
                    )}

                    <div className="contact-field mb-3">
                      <label>
                        Booking ID <span style={{ color: "red" }}>*</span>
                      </label>
                      <input
                        type="text"
                        className="auth-input"
                        placeholder="e.g. VT-20260001"
                        value={bookingId}
                        onBlur={handleBookingIdBlur}
                        onChange={(e) => {
                          setBookingId(e.target.value);
                          setManageReservation(null);
                          setManageLookupLoading(false);
                          setManageError("");
                        }}
                        required
                      />
                      <small style={{ color: "#888" }}>
                        Find your Booking ID in your confirmation email.
                      </small>
                      {manageLookupLoading && <small role="status" style={{ color: "#6B7280" }}>Checking booking eligibility…</small>}
                      {manageReservation && !manageReservation.changeRequestsAllowed && (
                        <small role="status" style={{ color: "#b42318" }}>
                          Cancellation and rescheduling are only available until 72 hours before check-in.
                        </small>
                      )}
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
                          disabled={manageOptionsDisabled}
                          required
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
                        {manageReservation?.sameDayCheckout ? (
                          <ReservationDatePicker
                            label="New Check-in"
                            value={newDate}
                            minDate={today}
                            loading={loadingRescheduleTimes}
                            isDateDisabled={(date) => manageOptionsDisabled || loadingRescheduleTimes
                              || !rescheduleTimeOptions.some((available) => available.checkIn === date)}
                            onChange={(date) => {
                              setNewDate(date);
                              setNewCheckOut(date);
                              setNewPreferredTime("");
                            }}
                            helpText={rescheduleTimeOptions.length ? "Unavailable dates are disabled." : "No available dates were found in the next 12 months."}
                          />
                        ) : <div className="contact-field mb-3">
                          <label>
                            New Check-in <span style={{ color: "red" }}>*</span>
                          </label>
                          <input
                            type="date"
                            className="auth-input"
                            min={today}
                            value={newDate}
                            disabled={manageOptionsDisabled}
                            onChange={(e) => {
                              setNewDate(e.target.value);
                              setNewPreferredTime("");
                              if (manageReservation?.sameDayCheckout) setNewCheckOut(e.target.value);
                              else if (newCheckOut && e.target.value >= newCheckOut) setNewCheckOut("");
                            }}
                            required
                          />
                        </div>}

                        {!manageReservation?.sameDayCheckout && <div className="contact-field mb-3">
                          <label>
                            New Check-out <span style={{ color: "red" }}>*</span>
                          </label>
                          <input
                            type="date"
                            className="auth-input"
                            min={newDate || today}
                            value={newCheckOut}
                            disabled={manageOptionsDisabled}
                            onChange={(e) => setNewCheckOut(e.target.value)}
                            required
                          />
                        </div>}
                        {manageReservation?.sameDayCheckout && (
                          <div className="contact-field mb-3">
                            <label>New Preferred Start Time <span style={{ color: "red" }}>*</span></label>
                            <select
                              className="auth-input contact-select"
                              value={newPreferredTime}
                              onChange={(event) => setNewPreferredTime(event.target.value)}
                              disabled={!newDate || loadingRescheduleTimes}
                              required
                            >
                              <option value="">{loadingRescheduleTimes ? "Checking available times…" : "Choose an available time"}</option>
                              {(rescheduleTimeOptions.find((date) => date.checkIn === newDate)?.options || [])
                                .filter((option) => option.available).map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                            <small className="res-availability-note">Duration: {manageReservation.durationMinutes / 60} hours</small>
                          </div>
                        )}
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
                        disabled={manageOptionsDisabled}
                        onChange={(e) => setManageNote(e.target.value)}
                        maxLength={1000}
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
                      <button type="submit" className="btn auth-btn contact-submit" style={{ flex: 1 }} disabled={manageOptionsDisabled}>
                        {manageLoading ? "Sending request…" : manageTab === "cancel" ? "Submit Cancellation Request →" : "Submit Reschedule Request →"}
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
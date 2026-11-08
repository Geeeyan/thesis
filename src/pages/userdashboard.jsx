import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import Navbar from "../components/navbar";
import MessageAttachment from "../components/messageattachment";
import { apiRequest, getSessionUser, reservationStatusLabel, uploadReservationDocument } from "../api";
import ReservationDatePicker from "../components/reservationdatepicker";
import { formatArrivalTime } from "../utils/arrivalTime";
import "../style.css";

function paymentLabel(reservation) {
  if (reservation.paymentStatus === "Paid") return "Payment confirmed";
  if (reservation.paymentProofSubmitted) {
    return reservation.paymentStatus === "Partial"
      ? `Payment proof submitted · ₱${Number(reservation.balance || 0).toLocaleString("en-PH")} awaiting verification`
      : "Payment proof submitted — awaiting verification";
  }
  if (reservation.paymentStatus === "Partial") return `Partially paid · ₱${Number(reservation.balance || 0).toLocaleString("en-PH")} balance`;
  return "Awaiting payment";
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatPeso(amount) {
  return `₱${Number(amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function addDays(date, days) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return localDateString(result);
}

function PaymentProofComposer({ reservation, onSubmitted }) {
  const [file, setFile] = useState(null);
  const [method, setMethod] = useState("ewallet");
  const [message, setMessage] = useState("");
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submitProof(event) {
    event.preventDefault();
    setError("");
    if (!file) {
      setError("Choose a payment screenshot first.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP screenshot.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("The screenshot must be no larger than 10 MB.");
      return;
    }

    setLoading(true);
    try {
      const intent = await apiRequest(`/reservations/${encodeURIComponent(reservation.reference)}/payment-intent`, {
        method: "POST",
        body: JSON.stringify({ method }),
      });
      setInstructions(intent.instructions || "");
      const document = await uploadReservationDocument(reservation.id, file);
      const result = await apiRequest("/messages/payment-proof", {
        method: "POST",
        body: JSON.stringify({
          reservationId: reservation.id,
          documentId: document.id,
          method,
          message: message.trim() || "Payment screenshot attached for review.",
        }),
      });
      setSent(true);
      setFile(null);
      onSubmitted(result.conversationId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <details style={{ marginTop: 16, borderTop: "1px solid #F3F4F6", paddingTop: 12 }}>
      <summary style={{ cursor: "pointer", color: "#C2410C", fontWeight: 700 }}>Send payment screenshot to admin</summary>
      <form onSubmit={submitProof} style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 5, color: "#374151", fontSize: 13 }}>
          Payment method
          <select value={method} onChange={(event) => setMethod(event.target.value)} style={{ border: "1px solid #FED7AA", borderRadius: 8, padding: 9 }}>
            <option value="ewallet">E-Wallet</option>
            <option value="bank">Bank transfer</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 5, color: "#374151", fontSize: 13 }}>
          Screenshot (JPEG, PNG, or WebP; 10 MB max)
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { setFile(event.target.files?.[0] || null); setSent(false); }} required />
        </label>
        <label style={{ display: "grid", gap: 5, color: "#374151", fontSize: 13 }}>
          Message to admin (optional)
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={5000} rows={2} style={{ border: "1px solid #FED7AA", borderRadius: 8, padding: 9, resize: "vertical" }} />
        </label>
        {instructions && <p style={{ margin: 0, color: "#6B7280", fontSize: 13 }}>Payment instructions: {instructions}</p>}
        {error && <p role="alert" style={{ color: "#b42318", margin: 0 }}>{error}</p>}
        {sent && <p role="status" className="payment-proof-toast">Payment screenshot submitted successfully. You can follow the review in Messages from staff.</p>}
        <button type="submit" className="btn auth-btn" disabled={loading} style={{ justifySelf: "start" }}>
          {loading ? "Sending screenshot…" : "Send screenshot"}
        </button>
      </form>
    </details>
  );
}

function GuestConversation({ conversationId, onError, onViewed }) {
  const [conversation, setConversation] = useState(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const reportedReadFor = useRef(null);

  const loadConversation = useCallback(async () => {
    try {
      const result = await apiRequest(`/messages/${conversationId}`);
      setConversation(result);
      if (reportedReadFor.current !== conversationId) {
        reportedReadFor.current = conversationId;
        onViewed();
      }
      onError("");
    } catch (error) {
      onError(error.message);
    }
  }, [conversationId, onError, onViewed]);

  useEffect(() => {
    loadConversation();
    const timer = setInterval(loadConversation, 15000);
    return () => clearInterval(timer);
  }, [loadConversation]);

  async function submitReply(event) {
    event.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    onError("");
    try {
      await apiRequest(`/messages/${conversationId}/replies`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      await loadConversation();
    } catch (error) {
      onError(error.message);
    } finally {
      setSending(false);
    }
  }

  if (!conversation) return <p style={{ color: "#6B7280" }}>Loading conversation…</p>;

  return (
    <div>
      <h3 style={{ margin: "0 0 14px", fontSize: 19 }}>{conversation.subject}</h3>
      <div aria-live="polite" style={{ display: "grid", gap: 12, maxHeight: 380, overflowY: "auto", padding: "4px 0 18px" }}>
        {conversation.messages.map((message) => {
          const fromTeam = message.senderRole === "staff" || message.senderRole === "admin";
          return (
            <div key={message.id} style={{ justifySelf: fromTeam ? "start" : "end", maxWidth: "88%", padding: "12px 15px", borderRadius: 14, background: fromTeam ? "#FFF7ED" : "#F3F4F6", overflowWrap: "anywhere" }}>
              <strong style={{ display: "block", marginBottom: 4, fontSize: 12 }}>{fromTeam ? message.senderName || "Villa Tjeozabel team" : "You"}</strong>
              <div style={{ whiteSpace: "pre-wrap" }}>{message.body}</div>
              {message.attachments?.map((attachment) => <MessageAttachment key={attachment.id} attachment={attachment} />)}
              <time style={{ display: "block", marginTop: 6, color: "#9CA3AF", fontSize: 11 }}>
                {new Date(`${message.createdAt.replace(" ", "T")}Z`).toLocaleString()}
              </time>
            </div>
          );
        })}
      </div>
      <form onSubmit={submitReply}>
        <label htmlFor={`guest-reply-${conversationId}`} style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Reply to staff</label>
        <textarea
          id={`guest-reply-${conversationId}`}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          maxLength={5000}
          rows={3}
          required
          style={{ width: "100%", border: "1px solid #FED7AA", borderRadius: 12, padding: 12, resize: "vertical" }}
        />
        <button type="submit" className="btn auth-btn" disabled={sending} style={{ marginTop: 10 }}>
          {sending ? "Sending…" : "Send Reply"}
        </button>
      </form>
    </div>
  );
}

function BookingChangeActions({ reservation, disabled, onSubmitted }) {
  const [requestType, setRequestType] = useState("");
  const [reason, setReason] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const minDate = localDateString();
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedNights, setSelectedNights] = useState(reservation.nights);
  const [loadingDates, setLoadingDates] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");

  useEffect(() => {
    if (requestType !== "reschedule") return undefined;
    let active = true;
    const query = new URLSearchParams({ from: minDate, to: addDays(minDate, 365), nights: String(selectedNights) });
    setLoadingDates(true);
    setAvailabilityError("");
    apiRequest(`/reservations/${reservation.id}/available-dates?${query}`)
      .then((result) => {
        if (active) setAvailableDates(result.availableDates);
      })
      .catch((requestError) => {
        if (active) setAvailabilityError(requestError.message);
      })
      .finally(() => {
        if (active) setLoadingDates(false);
      });
    return () => { active = false; };
  }, [requestType, reservation.id, selectedNights, minDate]);

  async function submitRequest(event) {
    event.preventDefault();
    setError("");
    setSending(true);
    try {
      const request = requestType === "cancellation"
        ? { type: requestType, reason, note }
        : { type: requestType, checkIn, checkOut, ...(reservation.sameDayCheckout ? { preferredTime } : {}), note };
      const result = await apiRequest(`/reservations/${reservation.id}/change-requests`, {
        method: "POST",
        body: JSON.stringify(request),
      });
      setSubmitted(true);
      onSubmitted(result.conversationId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(false);
    }
  }

  function chooseRequest(type) {
    setRequestType(type);
    setSubmitted(false);
    setError("");
    setAvailabilityError("");
    setCheckIn("");
    setCheckOut("");
    setPreferredTime("");
    setSelectedNights(reservation.nights);
  }

  return (
    <div className="user-booking-change">
      <div className="user-booking-change-actions">
        <button type="button" className="user-change-button" disabled={disabled} onClick={() => chooseRequest("cancellation")}>Request cancellation</button>
        <button type="button" className="user-change-button" disabled={disabled} onClick={() => chooseRequest("reschedule")}>Request reschedule</button>
      </div>
      {disabled && <p className="user-change-hint">Cancellation and rescheduling are available for upcoming bookings until 72 hours before check-in.</p>}
      {requestType && (
        <form className="user-change-form" onSubmit={submitRequest}>
          <div className="user-change-form-heading">
            <strong>{requestType === "cancellation" ? "Cancellation request" : "Reschedule request"}</strong>
            <button type="button" className="user-change-close" onClick={() => setRequestType("")} aria-label="Close request form">×</button>
          </div>
          {submitted ? (
            <p className="user-change-success" role="status">Your request was sent to our team. We’ll follow up in Messages from staff; your booking has not changed yet.</p>
          ) : (
            <>
              {requestType === "cancellation" ? (
                <label className="user-change-field">
                  Reason for cancellation
                  <select value={reason} onChange={(event) => setReason(event.target.value)} required>
                    <option value="">Choose a reason</option>
                    <option>Change of plans</option>
                    <option>Found a better option</option>
                    <option>Personal emergency</option>
                    <option>Financial reasons</option>
                    <option>Duplicate booking</option>
                    <option>Other</option>
                  </select>
                </label>
              ) : (
                <>
                  <p className="user-change-hint">
                    {reservation.sameDayCheckout
                      ? `Choose a date and available start time. Duration is fixed at ${reservation.durationMinutes / 60} hours.`
                      : "Choose a stay length and an available check-in date. Check-out is calculated automatically."}
                  </p>
                  {!reservation.sameDayCheckout && <label className="user-change-field">
                    Length of stay
                    <select
                      value={selectedNights}
                      onChange={(event) => {
                        setSelectedNights(Number(event.target.value));
                        setCheckIn("");
                        setCheckOut("");
                      }}
                    >
                      {Array.from({ length: 30 }, (_, index) => index + 1).map((nights) => (
                        <option key={nights} value={nights}>{nights} {nights === 1 ? "night" : "nights"}</option>
                      ))}
                    </select>
                  </label>}
                  {loadingDates && <p role="status" className="user-change-hint">Loading available dates…</p>}
                  {availabilityError && <p role="alert" className="user-dashboard-error">{availabilityError}</p>}
                  {!loadingDates && !availabilityError && (
                    <>
                      <ReservationDatePicker
                        label="Available check-in date"
                        value={checkIn}
                        minDate={minDate}
                        isDateDisabled={(date) => !availableDates.some((option) => option.checkIn === date)}
                        onChange={(date) => {
                          const option = availableDates.find((available) => available.checkIn === date);
                          setCheckIn(option?.checkIn || "");
                          setCheckOut(option?.checkOut || "");
                          setPreferredTime("");
                        }}
                        helpText={availableDates.length ? "Unavailable dates are disabled." : "No available dates were found in the next 12 months."}
                      />
                      {reservation.sameDayCheckout && checkIn && (
                        <label className="user-change-field">
                          Preferred start time
                          <select value={preferredTime} onChange={(event) => setPreferredTime(event.target.value)} required>
                            <option value="">Choose an available time</option>
                            {(availableDates.find((available) => available.checkIn === checkIn)?.options || []).map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      )}
                      {checkOut && <p className="user-change-hint">New check-out: <strong>{checkOut}{reservation.sameDayCheckout && preferredTime ? ` at ${formatArrivalTime(`${String((Number(preferredTime.slice(0, 2)) + reservation.durationMinutes / 60) % 24).padStart(2, "0")}:00`)}` : ""}</strong></p>}
                    </>
                  )}
                </>
              )}
              <label className="user-change-field">
                Additional notes <span>(optional)</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} />
              </label>
              {requestType === "reschedule" && <p className="user-change-hint">New dates are subject to room availability and staff confirmation. The room type will stay the same.</p>}
              {error && <p className="user-dashboard-error" role="alert">{error}</p>}
              <button type="submit" className="user-primary-button" disabled={sending || (requestType === "cancellation" && !reason) || (requestType === "reschedule" && (!checkIn || !checkOut || (reservation.sameDayCheckout && !preferredTime) || loadingDates || !!availabilityError))}>
                {sending ? "Sending request…" : "Send request to staff"}
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}

export default function UserDashboard() {
  const location = useLocation();
  const [user] = useState(() => {
    try {
      return getSessionUser() || {};
    } catch {
      return {};
    }
  });
  const [reservations, setReservations] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [conversationError, setConversationError] = useState("");
  const searchParams = new URLSearchParams(location.search);
  const unpaidFilter = searchParams.get("status") === "unpaid";
  const bookingDetailId = searchParams.get("booking");
  const requestedThreadId = searchParams.get("thread");
  const today = localDateString();
  const upcomingBookings = reservations.filter((reservation) =>
    reservation.checkIn >= today && ["Pending", "Confirmed"].includes(reservation.status));
  const dueReservations = reservations.filter((reservation) =>
    reservation.status !== "Cancelled" && Number(reservation.balance) > 0);
  const totalDue = dueReservations.reduce((total, reservation) => total + Number(reservation.balance || 0), 0);
  const unreadMessages = conversations.reduce((total, conversation) => total + Number(conversation.unreadCount || 0), 0);
  const visibleReservations = unpaidFilter
    ? dueReservations
    : bookingDetailId
      ? reservations.filter((reservation) => String(reservation.id) === bookingDetailId)
      : reservations;

  const refreshReadState = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    let isCurrent = true;
    async function loadDashboard() {
      try {
        const [reservationRows, conversationRows] = await Promise.all([
          apiRequest("/reservations"),
          apiRequest("/messages"),
        ]);
        if (!Array.isArray(reservationRows) || !Array.isArray(conversationRows)) {
          throw new Error("The dashboard data response was invalid.");
        }
        if (isCurrent) {
          setReservations(reservationRows);
          setConversations(conversationRows);
          setError("");
          setSelectedConversation((current) => {
            if (requestedThreadId) return Number(requestedThreadId);
            if (current && conversationRows.some((item) => item.id === current)) return current;
            return conversationRows[0]?.id ?? null;
          });
        }
      } catch (requestError) {
        if (isCurrent) setError(requestError.message);
      } finally {
        if (isCurrent) setLoading(false);
      }
    }
    loadDashboard();
    const timer = setInterval(loadDashboard, 20000);
    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [refreshVersion, location.search, requestedThreadId]);

  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash, location.search]);

  return (
    <>
      <Navbar />
      <main className="user-dashboard">
        <div className="user-dashboard-content">
          <header className="user-dashboard-hero">
            <div>
              <p className="user-dashboard-eyebrow">YOUR ACCOUNT</p>
              <h1>Welcome back, {user.name || "Guest"}</h1>
              <p>Everything you need for your stay, all in one place.</p>
            </div>
            <div className="user-dashboard-actions" style={{ alignItems: "center" }}>
              <button type="button" className="user-secondary-button" onClick={() => setRefreshVersion((version) => version + 1)}>Refresh details</button>
            </div>
          </header>

          <div className="user-dashboard-stats" aria-label="Account overview">
            {loading ? (
              <article className="user-stat-card" role="status">
                <span className="user-stat-icon" aria-hidden="true">⌂</span>
                <div><strong>…</strong><span>Loading bookings</span></div>
              </article>
            ) : reservations.length > 0 ? (
              <Link
                className="user-stat-card user-stat-card-link"
                to="/user/dashboard#bookings"
                aria-label="View all bookings"
              >
                <span className="user-stat-icon" aria-hidden="true">⌂</span>
                <div><strong>{upcomingBookings.length}</strong><span>Upcoming bookings</span></div>
              </Link>
            ) : (
              <article className="user-stat-card" aria-label="No bookings">
                <span className="user-stat-icon" aria-hidden="true">⌂</span>
                <div><strong>0</strong><span>Upcoming bookings</span></div>
              </article>
            )}
            {loading ? (
              <article className="user-stat-card" role="status">
                <span className="user-stat-icon user-stat-icon-payment" aria-hidden="true">₱</span>
                <div><strong>…</strong><span>Loading payments</span></div>
              </article>
            ) : dueReservations.length > 0 ? (
              <Link
                className="user-stat-card user-stat-card-link"
                to="/user/dashboard?status=unpaid#bookings"
                aria-label="View payments due"
              >
                <span className="user-stat-icon user-stat-icon-payment" aria-hidden="true">₱</span>
                <div>
                  <strong>{formatPeso(totalDue)}</strong>
                  <span>{`${dueReservations.length} payment${dueReservations.length === 1 ? "" : "s"} due`}</span>
                </div>
              </Link>
            ) : (
              <article className="user-stat-card" aria-label="No payments due">
                <span className="user-stat-icon user-stat-icon-payment" aria-hidden="true">₱</span>
                <div><strong>{formatPeso(0)}</strong><span>No payments due</span></div>
              </article>
            )}
            {loading ? (
              <article className="user-stat-card" role="status">
                <span className="user-stat-icon user-stat-icon-message" aria-hidden="true">✉</span>
                <div><strong>…</strong><span>Loading messages</span></div>
              </article>
            ) : conversations.length > 0 ? (
              <Link
                className="user-stat-card user-stat-card-link"
                to="/user/dashboard#messages"
                aria-label="View messages"
              >
                <span className="user-stat-icon user-stat-icon-message" aria-hidden="true">✉</span>
                <div>
                  <strong>{conversations.length}</strong>
                  <span>{conversations.length === 1 ? "Message thread" : "Message threads"}</span>
                  {unreadMessages > 0 && <span className="user-stat-unread-badge">{unreadMessages} unread</span>}
                </div>
              </Link>
            ) : (
              <article className="user-stat-card" aria-label="No messages">
                <span className="user-stat-icon user-stat-icon-message" aria-hidden="true">✉</span>
                <div><strong>0</strong><span>No message threads</span></div>
              </article>
            )}
          </div>

          {error && <p className="user-dashboard-error" role="alert">{error}</p>}

          <section className="user-dashboard-section" id="bookings">
            <div className="user-section-heading">
              <div>
                <p className="user-section-eyebrow">YOUR STAYS</p>
                <h2>{unpaidFilter ? "Payments due" : bookingDetailId ? "Booking details" : "My bookings"}</h2>
              </div>
              {unpaidFilter || bookingDetailId
                ? <Link className="user-inquiry-link" to="/user/dashboard#bookings">View all bookings</Link>
                : <Link className="user-primary-button" to="/reservation"><span aria-hidden="true">＋</span> Make a reservation</Link>}
            </div>
            {loading && <div className="user-dashboard-notice" role="status">Loading your bookings…</div>}
            {!loading && reservations.length === 0 && !unpaidFilter && !bookingDetailId && (
              <div className="user-dashboard-empty">
                <span className="user-empty-icon" aria-hidden="true">⌂</span>
                <h3>Your next getaway starts here</h3>
                <p>There are no bookings linked to this account yet. Explore your options and plan your stay.</p>
                <Link className="user-primary-button" to="/reservation">Make your first reservation</Link>
              </div>
            )}
            {!loading && visibleReservations.length === 0 && (unpaidFilter || bookingDetailId) && (
              <div className="user-dashboard-empty">
                <span className="user-empty-icon" aria-hidden="true">{unpaidFilter ? "₱" : "⌂"}</span>
                <h3>{unpaidFilter ? "No payments due" : "Booking not found"}</h3>
                <p>{unpaidFilter ? "You have no unpaid reservation balances." : "This booking could not be found in your account."}</p>
              </div>
            )}
            <div className="user-booking-list">
              {visibleReservations.map((reservation) => {
                const paid = reservation.paymentStatus === "Paid";
                const paymentColor = paid ? "#166534" : reservation.paymentStatus === "Partial" || reservation.paymentProofSubmitted ? "#92400E" : "#6B7280";
                const paymentBackground = paid ? "#DCFCE7" : reservation.paymentStatus === "Partial" || reservation.paymentProofSubmitted ? "#FEF3C7" : "#F3F4F6";
                return (
                  <article key={reservation.id} className="user-booking-card">
                    <Link
                      className="user-booking-main user-booking-main-link"
                      to={`/user/dashboard?booking=${encodeURIComponent(reservation.id)}#bookings`}
                      aria-label={`View booking details for ${reservation.reference}`}
                    >
                      <div>
                        <span className="user-booking-reference-label">BOOKING REFERENCE</span>
                        <strong className="user-booking-reference">{reservation.reference}</strong>
                        <h3>{reservation.roomName}</h3>
                        <p className="user-booking-details">
                          {reservation.checkIn}{reservation.preferredTime ? ` · ${formatArrivalTime(reservation.preferredTime)}` : ""} – {reservation.checkOut}{reservation.checkOutTime ? ` · ${formatArrivalTime(reservation.checkOutTime)}` : ""}{reservation.sameDayCheckout ? ` · ${reservation.durationMinutes / 60} hours` : ""} · {reservation.guests} guest{reservation.guests === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="user-booking-statuses">
                        <span className="user-status-badge user-booking-status">
                          {reservationStatusLabel(reservation.status)}
                        </span>
                        <span role="status" className="user-status-badge" style={{ background: paymentBackground, color: paymentColor }}>
                          {paymentLabel(reservation)}
                        </span>
                      </div>
                    </Link>
                    <div className="user-booking-footer">
                      <div className="user-booking-total"><span>Total</span><strong>₱{Number(reservation.total).toLocaleString("en-PH")}</strong></div>
                      {reservation.bookingType !== "Walk-in" && reservation.paymentStatus !== "Paid" && reservation.status !== "Cancelled" && (
                        <Link
                          className="user-payment-link"
                          to="/payment"
                          state={{
                            reference: reservation.reference,
                            firstName: reservation.guestName.split(/\s+/)[0] || "Guest",
                            lastName: reservation.guestName.split(/\s+/).slice(1).join(" "),
                            checkIn: reservation.checkIn,
                            preferredTime: reservation.preferredTime || "",
                            checkOut: reservation.checkOut,
                            checkOutTime: reservation.checkOutTime,
                            sameDayCheckout: reservation.sameDayCheckout,
                            durationMinutes: reservation.durationMinutes,
                            room: reservation.room,
                            guests: reservation.guests,
                            nights: reservation.nights,
                            totalAmount: reservation.total,
                            quotedRoom: {
                              name: reservation.roomName,
                              price: reservation.roomPrice,
                              unit: reservation.roomUnit,
                              pricingMode: reservation.roomPricingMode,
                              total: reservation.roomTotal,
                            },
                          }}
                        >
                          Continue to payment
                        </Link>
                      )}
                    </div>
                    {["Pending", "Confirmed"].includes(reservation.status) && (
                      <BookingChangeActions
                        reservation={reservation}
                        disabled={!reservation.changeRequestsAllowed}
                        onSubmitted={(conversationId) => {
                          setSelectedConversation(conversationId);
                          setRefreshVersion((version) => version + 1);
                          setConversationError("");
                        }}
                      />
                    )}
                    {reservation.bookingType !== "Walk-in" && reservation.paymentStatus !== "Paid" && reservation.status !== "Cancelled" && (
                      <PaymentProofComposer
                        reservation={reservation}
                        onSubmitted={(conversationId) => {
                          setSelectedConversation(conversationId);
                          setRefreshVersion((version) => version + 1);
                          setConversationError("");
                        }}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="user-dashboard-section user-messages-section" id="messages">
            <div className="user-section-heading">
              <div>
                <p className="user-section-eyebrow">HERE TO HELP</p>
                <h2>Messages from staff</h2>
              </div>
            </div>
            <div className="user-message-layout">
              <div className="user-conversation-list">
                {conversations.length === 0 && <p className="user-message-empty">No staff conversations yet. Send us an inquiry if you need help.</p>}
                <div className="user-conversation-buttons">
                  {conversations.map((conversation) => (
                    <Link
                      key={conversation.id}
                      to={`/user/dashboard?thread=${encodeURIComponent(conversation.id)}#messages`}
                      aria-current={selectedConversation === conversation.id ? "page" : undefined}
                      className={`user-conversation-button${selectedConversation === conversation.id ? " is-selected" : ""}`}
                    >
                      <strong style={{ display: "block" }}>{conversation.subject}</strong>
                      <span>{conversation.lastMessage}</span>
                      {conversation.unreadCount > 0 && (
                        <span className="user-thread-unread-badge" aria-label={`${conversation.unreadCount} unread messages`}>
                          {conversation.unreadCount} unread
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
                <Link className="user-inquiry-link" to="/contact">Start a new inquiry</Link>
              </div>
              <div className="user-conversation-detail">
                {conversationError && <p className="user-dashboard-error" role="alert">{conversationError}</p>}
                {selectedConversation
                  ? <GuestConversation conversationId={selectedConversation} onError={setConversationError} onViewed={refreshReadState} />
                  : <div className="user-message-placeholder"><span aria-hidden="true">✉</span><p>Select a conversation to read staff replies and respond.</p></div>}
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

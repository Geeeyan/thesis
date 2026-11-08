import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Navbar from "../components/navbar";
import qrCode from "../assets/qr.png";
import "../style.css";
import { apiRequest } from "../api";
import useSiteAssets from "../hooks/useSiteAssets";
import { formatArrivalTime } from "../utils/arrivalTime";

const roomPricing = {
  regular: { label: "Regular Room", basePrice: 350, unit: "3 hours", pricingMode: "stay" },
  deluxe:  { label: "Deluxe Room", basePrice: 800, unit: "night", pricingMode: "night" },
  luxury:  { label: "Luxury Room", basePrice: 1200, unit: "night", pricingMode: "night" },
  "entire-villa": { label: "Entire Villa", basePrice: 15000, unit: "night", pricingMode: "night" },
  pool: { label: "Private Pool", basePrice: 300, unit: "guest", pricingMode: "guest" },
  event: { label: "Event Space", basePrice: 10000, unit: "12 hours", pricingMode: "stay" },
};

function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 1;
  const diff = new Date(checkOut) - new Date(checkIn);
  return Math.max(1, Math.round(diff / (1000 * 60 * 60 * 24)));
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-PH", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function formatPeso(amount) {
  return "₱" + amount.toLocaleString("en-PH");
}

function generateRef() {
  return "VT-" + Date.now().toString(36).toUpperCase();
}

export default function Payment() {
  const siteAssets = useSiteAssets();
  const navigate  = useNavigate();
  const location  = useLocation();

  const reservation = location.state || {};

  const {
    firstName = "Guest",
    lastName  = "",
    checkIn   = "",
    preferredTime = "",
    checkOut  = "",
    checkOutTime = "",
    sameDayCheckout = false,
    durationMinutes = 0,
    room      = "deluxe",
    guests    = 1,
  } = reservation;
  const bookingType = reservation.bookingType || "Online";
  const paymentDueAt = reservation.paymentDueAt || null;

  const defaultRoom = roomPricing[room] || roomPricing.deluxe;
  const roomInfo = reservation.quotedRoom
    ? {
        label: reservation.quotedRoom.name,
        basePrice: reservation.quotedRoom.price,
        unit: reservation.quotedRoom.unit,
        pricingMode: reservation.quotedRoom.pricingMode,
        rateUnit: reservation.quotedRoom.rateUnit,
      }
    : defaultRoom;
  const roomRateUnit = roomInfo.rateUnit || (roomInfo.pricingMode === "guest"
    ? "guest"
    : roomInfo.pricingMode === "stay"
      ? "booking"
      : roomInfo.unit);
  const nights = reservation.nights ?? nightsBetween(checkIn, checkOut);
  const calculatedTotal = reservation.quotedRoom?.total ?? (
    roomInfo.pricingMode === "guest"
      ? roomInfo.basePrice * guests
      : roomInfo.pricingMode === "stay"
        ? roomInfo.basePrice
        : roomInfo.basePrice * nights
  );
  const grandTotal = reservation.totalAmount ?? calculatedTotal;
  const generatedRefCode = React.useRef(generateRef()).current;
  const refCode = reservation.reference || generatedRefCode;

  const [method,    setMethod]    = useState("ewallet"); // card, ewallet, bank
  const [cardForm,  setCardForm]  = useState({ name: "", number: "", expiry: "", cvv: "" });
  const eWallet = "+63 912 345 6789";
  const [errors,    setErrors]    = useState({});
  const [paid,      setPaid]      = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("Pending");
  const [reservationStatus, setReservationStatus] = useState(reservation.status || "Pending");
  const [statusError, setStatusError] = useState("");

  React.useEffect(() => {
    if (!reservation.reference) return undefined;
    if (!paid && !paymentDueAt) return undefined;
    let isCurrent = true;
    let timer;

    async function refreshReservationStatus() {
      try {
        const latest = await apiRequest(`/reservations/${encodeURIComponent(reservation.reference)}`);
        if (!isCurrent) return;
        setPaymentStatus(latest.paymentStatus);
        setReservationStatus(latest.status);
        setStatusError("");
        if (latest.paymentStatus !== "Paid" && latest.status !== "Cancelled") timer = setTimeout(refreshReservationStatus, 15000);
      } catch (error) {
        if (!isCurrent) return;
        setStatusError(`Payment status could not be refreshed: ${error.message}`);
        timer = setTimeout(refreshReservationStatus, 15000);
      }
    }

    refreshReservationStatus();
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [paid, paymentDueAt, reservation.reference]);

  function handleCard(e) {
    let { name, value } = e.target;

    if (name === "number") {
      value = value.replace(/\D/g, "").slice(0, 16);
      value = value.replace(/(.{4})/g, "$1 ").trim();
    }
    if (name === "expiry") {
      value = value.replace(/\D/g, "").slice(0, 4);
      if (value.length > 2) value = value.slice(0, 2) + " / " + value.slice(2);
    }
    if (name === "cvv") value = value.replace(/\D/g, "").slice(0, 4);

    setCardForm((p) => ({ ...p, [name]: value }));
    setErrors((p) => ({ ...p, [name]: "" }));
  }

  function validate() {
    const e = {};
    if (method === "card") {
      if (!cardForm.name.trim())                              e.name   = "Cardholder name is required.";
      if (cardForm.number.replace(/\s/g, "").length < 16)    e.number = "Enter a valid 16-digit card number.";
      if (cardForm.expiry.replace(/[\s/]/g, "").length < 4)  e.expiry = "Enter a valid expiry date.";
      if (cardForm.cvv.length < 3)                           e.cvv    = "CVV must be 3–4 digits.";
    }
    if (method === "ewallet" && !eWallet.trim())             e.ewallet = "Phone number or email is required.";
    return e;
  }

  async function handlePay(e) {
    e.preventDefault();
    const e2 = validate();
    if (Object.keys(e2).length) { setErrors(e2); return; }
    if (!reservation.reference) {
      setPaymentError("Your reservation could not be found. Please submit the reservation form again.");
      return;
    }
    if (reservationStatus === "Cancelled") {
      setPaymentError("This reservation has been cancelled and cannot be paid.");
      return;
    }

    setPaymentError("");
    setLoading(true);
    try {
      await apiRequest(`/reservations/${reservation.reference}/payment-intent`, {
        method: "POST",
        body: JSON.stringify({ method }),
      });
      setPaid(true);
    } catch (requestError) {
      setPaymentError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  if (paid) {
    return (
      <div className="app-shell">
        <Navbar />
        <div className="res-success-wrapper">
          <div className="contact-success">
            <div className="contact-success-icon">
              <i className={`bi ${method === "bank" ? "bi-bank" : "bi-check-circle-fill"}`} aria-hidden="true" />
            </div>
            <h3>{paymentStatus === "Paid" ? "Payment Confirmed" : "Payment Submitted for Confirmation"}</h3>
            <p>
              {paymentStatus === "Paid"
                ? <>Thank you, <strong>{firstName}</strong>! An administrator has confirmed payment for reference <strong>{refCode}</strong>.</>
                : <>Thank you, <strong>{firstName}</strong>! Your payment request for <strong>{formatPeso(grandTotal)}</strong> was recorded. Reference: <strong>{refCode}</strong>. It will show as paid after an administrator verifies receipt.</>}
            </p>
            {paymentStatus !== "Paid" && <p role="status">Payment status: {paymentStatus}. This page checks for an administrator's confirmation automatically.</p>}
            {statusError && <p role="status" className="res-error">{statusError}</p>}
            <button className="btn btn-warning mt-3" onClick={() => navigate("/")}>
              Back to Home
            </button>
            <button type="button" className="contact-back-link" onClick={() => navigate("/reservation")} style={{ cursor: "pointer" }}>
              Make another reservation
            </button>
          </div>
        </div>
        <footer className="footer">© 2026 Villa Tjeozabel</footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Navbar />

      <div
        className="contact-hero"
        style={{ backgroundImage: "url('/assets/img1.jpg')", marginTop: 0 }}
      >
        <div className="contact-hero-overlay" />
        <div className="contact-hero-text">
          <span className="section-tag">Almost There</span>
          <h1>{bookingType === "Walk-in" ? "Walk-in Reservation Received" : "Complete Your Payment"}</h1>
          <p>
            {bookingType === "Walk-in"
              ? "Your request is awaiting confirmation. No online payment is required."
              : "Your reservation request is awaiting confirmation while our team verifies availability and payment."}
          </p>
        </div>
      </div>

      <div className="contact-page">
        <div className="res-body">

          <div className="contact-form-wrapper">

            <div className="pay-confirmed-banner">
              <span className="pay-confirmed-icon"><i className="bi bi-calendar-check" aria-hidden="true" /></span>
              <div>
                <strong>{bookingType} Reservation Request Received</strong>
                <p>
                  {bookingType === "Walk-in"
                    ? <>Hi {firstName}, your booking request is awaiting confirmation. No online payment is required; our team will contact you to confirm availability.</>
                    : <>Hi {firstName}, your booking request is awaiting confirmation. Submit a payment request below; our team will verify availability and payment before confirming your stay.</>}
                </p>
                {reservationStatus === "Cancelled" && (
                  <p role="alert" className="res-error">This reservation has been cancelled.</p>
                )}
              </div>
            </div>
            {bookingType === "Walk-in" ? (
              <p className="res-availability-note" role="status">
                Payment will be handled in person if your reservation is confirmed.
              </p>
            ) : (
              <>
            <div className="contact-form-header" style={{ marginTop: "1.5rem" }}>
              <span className="section-tag">Payment Details</span>
              <h2 style={{ marginTop: "10px" }}>Payment Method</h2>
            </div>

            <div className="pay-method-tabs">
              {[
                { key: "ewallet", label: <><i className="bi bi-phone me-2" aria-hidden="true" />E-Wallet</> },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={`pay-method-tab${method === key ? " active" : ""}`}
                  onClick={() => { setMethod(key); setErrors({}); }}
                >
                  {label}
                </button>
              ))}
            </div>

            <form className="contact-form" onSubmit={handlePay} noValidate>

              {paymentError && <p role="alert" className="res-error">{paymentError}</p>}

              {method === "card" && (
                <>
                  <div className="contact-field">
                    <label>Cardholder Name <span style={{ color: "var(--orange)" }}>*</span></label>
                    <input
                      className="auth-input"
                      type="text"
                      name="name"
                      placeholder="As it appears on card"
                      value={cardForm.name}
                      onChange={handleCard}
                    />
                    {errors.name && <small className="res-error">{errors.name}</small>}
                  </div>

                  <div className="contact-field">
                    <label>Card Number <span style={{ color: "var(--orange)" }}>*</span></label>
                    <div style={{ position: "relative" }}>
                      <input
                        className="auth-input"
                        type="text"
                        name="number"
                        placeholder="0000  0000  0000  0000"
                        value={cardForm.number}
                        onChange={handleCard}
                        style={{ paddingRight: "80px" }}
                      />
                      <div className="pay-card-badges">
                        <span className="pay-card-badge">VISA</span>
                        <span className="pay-card-badge">MC</span>
                      </div>
                    </div>
                    {errors.number && <small className="res-error">{errors.number}</small>}
                  </div>

                  <div className="contact-form-row">
                    <div className="contact-field">
                      <label>Expiry Date <span style={{ color: "var(--orange)" }}>*</span></label>
                      <input
                        className="auth-input"
                        type="text"
                        name="expiry"
                        placeholder="MM / YY"
                        value={cardForm.expiry}
                        onChange={handleCard}
                      />
                      {errors.expiry && <small className="res-error">{errors.expiry}</small>}
                    </div>
                    <div className="contact-field">
                      <label>CVV <span style={{ color: "var(--orange)" }}>*</span></label>
                      <input
                        className="auth-input"
                        type="text"
                        name="cvv"
                        placeholder="•••"
                        value={cardForm.cvv}
                        onChange={handleCard}
                      />
                      {errors.cvv && <small className="res-error">{errors.cvv}</small>}
                    </div>
                  </div>
                </>
              )}

              {method === "ewallet" && (
                <div className="contact-field">
                  <label>GCash / Maya Number<span style={{ color: "var(--orange)" }}>*</span></label>
                  <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                    <small style={{ color: "var(--text-light)", margin: 0, textAlign: "center" }}>
                      Scan the QR code to pay using your preferred e-wallet app.
                    </small>
                    <img
                      src={siteAssets["payment-qr"] || qrCode}
                      alt="QR code for e-wallet payment"
                      style={{ width: "180px", height: "180px", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "8px", background: "#fff" }}
                    />
                  </div>
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "12px 14px",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      background: "#f8fafc",
                      fontWeight: 600,
                      color: "var(--text-dark)",
                      textAlign: "center"
                    }}
                  >
                    +63 912 345 6789
                  </div>
                  {errors.ewallet && <small className="res-error">{errors.ewallet}</small>}
                  <small style={{ color: "var(--text-light)", marginTop: "6px", display: "block" }}>
                    You'll receive an authorization prompt in your e-wallet app to confirm payment.
                  </small>
                </div>
              )}

              {method === "bank" && (
                <div className="pay-bank-info">
                  <p className="pay-bank-title">Transfer to:</p>
                  {[
                    ["Bank",           "BDO Unibank"],
                    ["Account Name",   "Villa Tjeozabel"],
                    ["Account Number", "1234-5678-9012"],
                    ["Reference",      refCode],
                    ["Amount",         formatPeso(grandTotal)],
                  ].map(([key, val]) => (
                    <div className="pay-bank-row" key={key}>
                      <span className="pay-bank-key">{key}</span>
                      <span className="pay-bank-val">{val}</span>
                    </div>
                  ))}
                  <p className="pay-bank-note">
                    <i className="bi bi-info-circle me-2" aria-hidden="true" />
                    Use the reference code above when transferring. Our team will confirm once received.
                  </p>
                </div>
              )}

              <p className="pay-security-note">
                <i className="bi bi-shield-lock me-2" aria-hidden="true" />
                Payments are encrypted and secure. We never store your card details.
              </p>

              <button
                type="submit"
                className="auth-btn contact-submit"
                disabled={loading || reservationStatus === "Cancelled"}
                style={{ opacity: loading ? 0.7 : 1 }}
              >
                {loading
                  ? "Processing…"
                  : method === "bank"
                    ? "I've Read the Instructions"
                    : `Pay ${formatPeso(grandTotal)}`}
              </button>

            </form>
              </>
            )}
          </div>

          <div className="res-summary-sticky">
            <div className="res-summary-card">

              <div className="res-summary-header">
                <div className="res-summary-header-icon"><i className="bi bi-house-heart-fill" aria-hidden="true" /></div>
                <div>
                  <p className="res-summary-eyebrow">Order Summary</p>
                  <p className="res-summary-title">Villa Tjeozabel</p>
                </div>
              </div>

              <hr className="res-summary-divider" />

              <SummaryRow label="Guest"    value={`${firstName} ${lastName}`} />
              <SummaryRow label="Booking type" value={bookingType} />
              {bookingType === "Walk-in" && <SummaryRow label="Payment" value="Pay in person if confirmed" />}
              <SummaryRow label="Room / package" value={roomInfo.label} sub={`₱${roomInfo.basePrice.toLocaleString()} / ${roomRateUnit}`} />
              <SummaryRow label="Check-in" value={`${formatDate(checkIn)}${preferredTime ? `, ${formatArrivalTime(preferredTime)}` : ""}`} />
              {!sameDayCheckout && <SummaryRow label="Preferred time" value={formatArrivalTime(preferredTime) || "—"} />}
              <SummaryRow label="Check-out" value={`${formatDate(checkOut)}${checkOutTime ? `, ${formatArrivalTime(checkOutTime)}` : ""}`} />
              <SummaryRow label={sameDayCheckout ? "Duration" : "Nights / Sessions"} value={sameDayCheckout ? `${durationMinutes / 60} hours` : nights} />
              <SummaryRow label="Guests"   value={`${guests} guest${guests > 1 ? "s" : ""}`} />

              <hr className="res-summary-bottom-divider" />

              <div className="pay-breakdown">
                <div className="pay-breakdown-total">
                  <span>{bookingType === "Walk-in" ? "Reservation total" : "Total Due"}</span>
                  <span>{formatPeso(grandTotal)}</span>
                </div>
              </div>

            </div>

            <div className="res-back-link-wrapper">
              <button
                type="button"
                className="contact-back-link"
                onClick={() => navigate("/reservation")}
                style={{ cursor: "pointer" }}
              >
                ← Edit reservation
              </button>
            </div>
          </div>

        </div>
      </div>

      <footer className="footer">© 2026 Villa Tjeozabel</footer>
    </div>
  );
}

function SummaryRow({ label, value, sub }) {
  return (
    <div className="res-summary-row">
      <span className="res-summary-row-label">{label}</span>
      <div className="res-summary-row-value">
        <strong>{value}</strong>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminProfilePictureUrl, apiRequest, getSessionUser, logoutSession, reservationStatusLabel, toDashboardReservation } from "../api";
import MessageAttachment from "../components/messageattachment";
import RoomServiceManagement from "../components/roomservicemanagement";
import { formatArrivalTime } from "../utils/arrivalTime";

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() + days);
  return formatLocalDate(result);
}

function today() {
  return formatLocalDate(new Date());
}

function formatMoney(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH")}`;
}

const STATUS_TRANSITIONS = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Checked-in", "Completed", "Cancelled"],
  "Checked-in": ["Completed"],
  Completed: [],
  Cancelled: [],
};

const ROOM_ICONS = {
  regular: "bi-door-closed",
};

const navItems = [
  { key: "dashboard", label: "Dashboard", icon: "bi-grid-1x2"        },
  { key: "bookings",  label: "Bookings",  icon: "bi-calendar-check"  },
  { key: "guests",    label: "Guests",    icon: "bi-people"           },
  { key: "rooms",     label: "Rooms and Services",     icon: "bi-house-door"       },
  { key: "messages",  label: "Messages",  icon: "bi-chat-dots"        },
];

function StatusBadge({ status }) {
  const map = {
    Confirmed:    { bg: "#DCFCE7", color: "#166534" },
    "Checked-in": { bg: "#DBEAFE", color: "#1D4ED8" },
    Completed:    { bg: "#F3F4F6", color: "#6B7280" },
    Pending:      { bg: "#FFEDD5", color: "#C2410C" },
    Cancelled:    { bg: "#FEE2E2", color: "#991B1B" },
    Available:    { bg: "#DCFCE7", color: "#166534" },
    "Fully booked": { bg: "#FFEDD5", color: "#C2410C" },
  };
  const s = map[status] || { bg: "#FFF7ED", color: "#F97316" };
  return (
    <span style={{ background: s.bg, color: s.color, padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
      {reservationStatusLabel(status)}
    </span>
  );
}

function Avatar({ init, size = 38, bg = "#F97316", color = "#fff" }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.35, flexShrink: 0 }}>
      {init}
    </div>
  );
}

function DashboardPanel({ bookings, summary, loading, onViewAll }) {
  const cards = [
    { label: "TOTAL RESERVATIONS", value: summary?.totalReservations ?? "—", text: `${summary?.guestCount ?? 0} unique booking guests`, icon: "bi-journal-text" },
    { label: "REGISTERED GUESTS", value: summary?.registeredGuests ?? "—", text: "Guest accounts in the system", icon: "bi-people" },
    { label: "REVENUE COLLECTED", value: summary ? formatMoney(summary.revenue?.collected) : "—", text: summary ? `${formatMoney(summary.revenue?.outstanding)} outstanding` : "Payments marked paid", icon: "bi-cash-stack" },
    { label: "ARRIVALS TODAY", value: summary?.arrivalsTodayCount ?? "—", text: summary ? `For ${summary.date}` : "Today's check-ins", icon: "bi-box-arrow-in-right" },
    { label: "GUESTS IN-HOUSE", value: summary?.inHouse ?? "—", text: "Currently checked in", icon: "bi-house-door" },
    { label: "UPCOMING 7 DAYS", value: summary?.upcomingWeek ?? "—", text: "Awaiting arrival or confirmed stays", icon: "bi-calendar-week" },
    { label: "AWAITING CUSTOMER APPEARANCE/ARRIVAL", value: summary?.pendingReservationsCount ?? "—", text: `${summary?.pendingPayments ?? 0} pending payments`, icon: "bi-hourglass-split" },
  ];

  return (
    <>
      <div className="staff-stats-grid" style={{ ...S.statsGrid, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {cards.map(c => (
          <div key={c.label} style={S.card}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FFF7ED", border: "1px solid #FED7AA", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <i className={`bi ${c.icon}`} style={{ fontSize: 18, color: "#F97316" }} />
            </div>
            <h3 style={S.cardLabel}>{c.label}</h3>
            <h2 style={S.cardValue}>{c.value}</h2>
            <p style={S.cardText}>{c.text}</p>
          </div>
        ))}
      </div>
      <div style={S.tableCard}>
        <div style={S.tableHeader}>
          <h2 style={S.tableTitle}>Recent Reservations</h2>
          <button type="button" style={S.orangeBtn} onClick={onViewAll}>View All</button>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>{["Guest","Room","Check In","Amount","Status"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {bookings.slice(0, 5).map((b, i) => (
              <tr key={b.id}>
                <td style={{ ...S.td, borderBottom: i === Math.min(bookings.length, 5) - 1 ? "none" : S.td.borderBottom }}>{b.customer}</td>
                <td style={{ ...S.td, borderBottom: i === Math.min(bookings.length, 5) - 1 ? "none" : S.td.borderBottom }}>{b.room}</td>
                <td style={{ ...S.td, borderBottom: i === Math.min(bookings.length, 5) - 1 ? "none" : S.td.borderBottom }}>{b.checkin}{b.preferredTime ? ` · ${formatArrivalTime(b.preferredTime)}` : ""}{b.sameDayCheckout ? ` → ${b.checkout}` : ""}</td>
                <td style={{ ...S.td, borderBottom: i === Math.min(bookings.length, 5) - 1 ? "none" : S.td.borderBottom }}>{b.amount}</td>
                <td style={{ ...S.td, borderBottom: i === Math.min(bookings.length, 5) - 1 ? "none" : S.td.borderBottom }}><StatusBadge status={b.status} /></td>
              </tr>
            ))}
            {!loading && bookings.length === 0 && <tr><td colSpan={5} style={S.td}>No reservations yet.</td></tr>}
            {loading && <tr><td colSpan={5} style={S.td}>Loading reservations…</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

function WalkInBookingForm({ services, onCreated, onClose }) {
  const defaultService = services.find((service) => service.code === services[0]?.code);
  const [form, setForm] = useState({
    guestName: "",
    guestEmail: "",
    guestPhone: "",
    room: services[0]?.code || "",
    checkIn: today(),
    preferredTime: "",
    checkOut: defaultService?.sameDayCheckout ? today() : addDays(today(), 1),
    guests: 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [arrivalOptions, setArrivalOptions] = useState([]);
  const [loadingArrivalOptions, setLoadingArrivalOptions] = useState(false);
  const selectedService = services.find((service) => service.code === form.room);
  const sameDayBooking = Boolean(selectedService?.sameDayCheckout);

  useEffect(() => {
    if (!sameDayBooking || !form.room || !form.checkIn) {
      setArrivalOptions([]);
      return undefined;
    }
    let active = true;
    async function loadOptions() {
      setLoadingArrivalOptions(true);
      try {
        const query = new URLSearchParams({ date: form.checkIn, room: form.room });
        const result = await apiRequest(`/reservations/arrival-times?${query}`);
        if (active) setArrivalOptions(result.options);
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoadingArrivalOptions(false);
      }
    }
    loadOptions();
    const timer = window.setInterval(loadOptions, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [form.checkIn, form.room, sameDayBooking]);

  useEffect(() => {
    if (sameDayBooking && form.checkOut !== form.checkIn) {
      setForm((current) => ({ ...current, checkOut: current.checkIn }));
    }
  }, [sameDayBooking, form.checkIn, form.checkOut]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => {
      if (name === "room") {
        const service = services.find((option) => option.code === value);
        return { ...current, room: value, preferredTime: "", checkOut: service?.sameDayCheckout ? current.checkIn : addDays(current.checkIn, 1) };
      }
      if (name === "checkIn") {
        return {
          ...current,
          checkIn: value,
          checkOut: sameDayBooking ? value : current.checkOut <= value ? addDays(value, 1) : current.checkOut,
          preferredTime: "",
        };
      }
      return { ...current, [name]: name === "guests" ? Number(value) : value };
    });
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const reservation = await apiRequest("/reservations/walk-in", {
        method: "POST",
        body: JSON.stringify({ ...form, checkOut: sameDayBooking ? form.checkIn : form.checkOut }),
      });
      onCreated(reservation);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ ...S.card, display: "grid", gap: 14, marginBottom: 20 }}>
      <div style={S.tableHeader}>
        <div>
          <h2 style={S.tableTitle}>Record a walk-in</h2>
          <p style={{ margin: "6px 0 0", color: "#6B7280", fontSize: 13 }}>This booking will be recorded as checked in and marked Walk-in.</p>
        </div>
        <button type="button" onClick={onClose} style={S.orangeBtn}>Close</button>
      </div>
      <div className="staff-walkin-grid">
        <label className="staff-walkin-field">Guest name
          <input required name="guestName" value={form.guestName} onChange={updateField} maxLength={100} />
        </label>
        <label className="staff-walkin-field">Guest email
          <input required type="email" name="guestEmail" value={form.guestEmail} onChange={updateField} maxLength={200} />
        </label>
        <label className="staff-walkin-field">Phone (optional)
          <input name="guestPhone" value={form.guestPhone} onChange={updateField} maxLength={40} />
        </label>
        <label className="staff-walkin-field">Room / service
          <select required name="room" value={form.room} onChange={updateField}>
            {services.filter((service) => service.category === "room" && service.active).map((service) => (
              <option key={service.code} value={service.code}>{service.name}</option>
            ))}
          </select>
        </label>
        <label className="staff-walkin-field">Check-in
          <input required type="date" name="checkIn" min={today()} value={form.checkIn} onChange={updateField} />
        </label>
        {!sameDayBooking && <label className="staff-walkin-field">Check-out
          <input required type="date" name="checkOut" min={addDays(form.checkIn, 1)} value={form.checkOut} onChange={updateField} />
        </label>}
        <label className="staff-walkin-field">{sameDayBooking ? "Preferred start time" : "Check-in time (optional)"}
          {sameDayBooking ? (
            <select required name="preferredTime" value={form.preferredTime} onChange={updateField} disabled={loadingArrivalOptions}>
              <option value="">{loadingArrivalOptions ? "Checking available times…" : "Choose an available time"}</option>
              {arrivalOptions.map((option) => <option key={option.value} value={option.value} disabled={!option.available}>{option.label}{!option.available ? " — Not available" : ""}</option>)}
            </select>
          ) : <input type="time" step="3600" name="preferredTime" value={form.preferredTime} onChange={updateField} />}
          {sameDayBooking && <small>Duration: {selectedService.durationMinutes / 60} hours</small>}
          {!sameDayBooking && <small>Whole hours only.</small>}
        </label>
        <label className="staff-walkin-field">Guests
          <input required type="number" min={1} max={100} name="guests" value={form.guests} onChange={updateField} />
        </label>
      </div>
      {error && <p role="alert" style={{ color: "#b42318", margin: 0 }}>{error}</p>}
      <button type="submit" className="user-primary-button" disabled={saving || !services.some((service) => service.category === "room" && service.active) || (sameDayBooking && (!form.preferredTime || !arrivalOptions.some((option) => option.value === form.preferredTime && option.available)))}>
        {saving ? "Recording walk-in…" : "Record walk-in booking"}
      </button>
    </form>
  );
}

function BookingsPanel({ bookings, summary, services, loading, onStatusChange, onWalkInCreated }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [checkInFilter, setCheckInFilter] = useState("");
  const [showWalkInForm, setShowWalkInForm] = useState(false);

  const filtered = bookings.filter(b => {
    const query = search.toLowerCase();
    const matchSearch = b.customer.toLowerCase().includes(query)
      || b.room.toLowerCase().includes(query)
      || b.id.toLowerCase().includes(query)
      || (b.guestEmail || "").toLowerCase().includes(query);
    const matchFilter = filter === "All" || b.status === filter;
    return matchSearch && matchFilter && (!checkInFilter || b.checkIn === checkInFilter);
  });

  const stats = [
    { label: "TOTAL BOOKINGS", value: summary?.totalReservations ?? bookings.length, icon: "bi-journal-text" },
    { label: "CONFIRMED", value: summary?.reservationCountsByStatus?.Confirmed ?? bookings.filter((b) => b.status === "Confirmed").length, icon: "bi-check-circle" },
    { label: "AWAITING CUSTOMER APPEARANCE/ARRIVAL", value: summary?.reservationCountsByStatus?.Pending ?? bookings.filter((b) => b.status === "Pending").length, icon: "bi-hourglass-split" },
    { label: "CHECKED IN", value: summary?.reservationCountsByStatus?.["Checked-in"] ?? bookings.filter((b) => b.status === "Checked-in").length, icon: "bi-door-open" },
  ];

  return (
    <>
      <div className="staff-stats-grid" style={S.statsGrid}>
        {stats.map(s => (
          <div key={s.label} style={S.card}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FFF7ED", border: "1px solid #FED7AA", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <i className={`bi ${s.icon}`} style={{ fontSize: 18, color: "#F97316" }} />
            </div>
            <h3 style={S.cardLabel}>{s.label}</h3>
            <h2 style={{ ...S.cardValue, fontSize: 36 }}>{s.value}</h2>
          </div>
        ))}
      </div>

      <div className="staff-booking-filters" style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <i className="bi bi-search" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 15 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by guest, room, or booking ID..." style={{ ...S.searchInput, paddingLeft: 40 }} />
        </div>
        <label style={{ color: "#6B7280", fontSize: 12, whiteSpace: "nowrap" }}>
          Check-in date
          <input type="date" value={checkInFilter} onChange={(event) => setCheckInFilter(event.target.value)} style={{ ...S.searchInput, display: "block", width: "auto", marginTop: 6 }} />
        </label>
        {["All", ...Object.keys(STATUS_TRANSITIONS)].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "10px 16px", borderRadius: 12, border: "1px solid", borderColor: filter === f ? "#F97316" : "#FED7AA", background: filter === f ? "#F97316" : "#fff", color: filter === f ? "#fff" : "#6B7280", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "Inter, sans-serif" }}>
            {reservationStatusLabel(f)}
          </button>
        ))}
      </div>

      <div style={S.tableCard}>
        <div style={S.tableHeader}>
          <div>
            <h2 style={S.tableTitle}>All Bookings</h2>
            <span style={{ color: "#6B7280", fontSize: 13 }}>Online reservations and walk-ins are listed by check-in date.</span>
          </div>
          <button type="button" style={S.orangeBtn} onClick={() => setShowWalkInForm((open) => !open)}>
            {showWalkInForm ? "Hide walk-in form" : "Record walk-in"}
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>{["Booking ID","Type","Guest","Room","Check In","Check Out","Pax","Amount","Status",""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((b, i) => (
              <tr key={b.id}>
                <td style={{ ...S.td, color: "#9CA3AF", fontSize: 12, borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>{b.id}</td>
                <td style={{ ...S.td, borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>{b.bookingType}</td>
                <td style={{ ...S.td, fontWeight: 600, borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>{b.customer}</td>
                <td style={{ ...S.td, borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>{b.room}</td>
                <td style={{ ...S.td, color: "#6B7280", borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>{b.checkin}{b.preferredTime ? ` · ${formatArrivalTime(b.preferredTime)}` : ""}</td>
                <td style={{ ...S.td, color: "#6B7280", borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>{b.checkout}</td>
                <td style={{ ...S.td, textAlign: "center", borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>{b.pax}</td>
                <td style={{ ...S.td, fontWeight: 700, color: "#F97316", borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>{b.amount}</td>
                <td style={{ ...S.td, borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}><StatusBadge status={b.status} /></td>
                <td style={{ ...S.td, borderBottom: i === filtered.length-1 ? "none" : S.td.borderBottom }}>
                  <select aria-label={`Update ${b.id} status`} style={S.searchInput} value={b.status} disabled={STATUS_TRANSITIONS[b.status]?.length === 0} onChange={(event) => onStatusChange(b, event.target.value)}>
                    {[b.status, ...(STATUS_TRANSITIONS[b.status] || [])].map((status) => <option key={status} value={status}>{reservationStatusLabel(status)}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={10} style={{ ...S.td, textAlign: "center", color: "#9CA3AF", padding: 32, borderBottom: "none" }}>{bookings.length ? "No bookings match your search." : "No reservations yet."}</td></tr>
            )}
            {loading && <tr><td colSpan={10} style={{ ...S.td, textAlign: "center" }}>Loading bookings…</td></tr>}
          </tbody>
        </table>
        </div>
        {showWalkInForm && (
          <WalkInBookingForm
            services={services}
            onClose={() => setShowWalkInForm(false)}
            onCreated={(reservation) => {
              onWalkInCreated(reservation);
              setShowWalkInForm(false);
            }}
          />
        )}
      </div>
    </>
  );
}

function GuestsPanel({ bookings, loading }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);

  const guests = Object.values(bookings.reduce((byEmail, booking) => {
    const email = booking.guestEmail || booking.customer.toLowerCase();
    const guest = byEmail[email] || {
      name: booking.customer,
      email: booking.guestEmail || "No email provided",
      phone: booking.guestPhone || "—",
      bookings: [],
    };
    guest.bookings.push(booking);
    if (!guest.phone || guest.phone === "—") guest.phone = booking.guestPhone || "—";
    byEmail[email] = guest;
    return byEmail;
  }, {})).map((guest) => {
    const history = [...guest.bookings].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    return { ...guest, history, latest: history[0] };
  });
  const query = search.trim().toLowerCase();
  const filtered = guests.filter((guest) =>
    guest.name.toLowerCase().includes(query) || guest.email.toLowerCase().includes(query)
  );
  const guest = guests.find((item) => item.email === selected);

  return (
    <div className="staff-guests-layout" style={{ display: "grid", gridTemplateColumns: guest ? "minmax(0, 1fr) minmax(280px, 340px)" : "1fr", gap: 20 }}>
      <div>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <i className="bi bi-search" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#9CA3AF", fontSize: 15 }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search guests..." style={{ ...S.searchInput, paddingLeft: 40 }} />
          </div>
        </div>

        <div style={S.tableCard}>
          <div style={S.tableHeader}>
            <h2 style={S.tableTitle}>Guest Directory</h2>
            <span style={{ fontSize: 13, color: "#9CA3AF" }}>{guests.length} guests</span>
          </div>
          <div style={{ overflowX: "auto" }}>
          <table style={S.table}>
            <thead>
              <tr>{["Guest","Contact","Bookings","Latest Stay","Status"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((g, i) => (
                <tr key={g.email} onClick={() => setSelected(g.email)} style={{ cursor: "pointer", background: selected === g.email ? "#FFF7ED" : "transparent" }}>
                  <td style={{ ...S.td, borderBottom: i === filtered.length - 1 ? "none" : S.td.borderBottom }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar init={g.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()} size={36} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{g.name}</div>
                        <div style={{ fontSize: 12, color: "#9CA3AF" }}>{g.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ ...S.td, color: "#6B7280", fontSize: 13 }}>{g.phone}</td>
                  <td style={{ ...S.td, textAlign: "center", fontWeight: 700 }}>{g.bookings.length}</td>
                  <td style={{ ...S.td, color: "#6B7280" }}>{g.latest.checkin}</td>
                  <td style={S.td}><StatusBadge status={g.latest.status} /></td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && <tr><td colSpan={5} style={{ ...S.td, textAlign: "center", color: "#9CA3AF" }}>{bookings.length ? "No guests match your search." : "Guest profiles appear after a reservation is made."}</td></tr>}
              {loading && <tr><td colSpan={5} style={{ ...S.td, textAlign: "center" }}>Loading guests…</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {guest && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ ...S.tableCard, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <h2 style={{ ...S.tableTitle, fontSize: 16 }}>Guest Profile</h2>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#9CA3AF", cursor: "pointer", lineHeight: 1 }}>
                <i className="bi bi-x-lg" style={{ fontSize: 18 }} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 20, padding: 16, background: "#FFF7ED", borderRadius: 16, border: "1px solid #FED7AA" }}>
              <Avatar init={guest.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()} size={60} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 800, fontSize: 17, color: "#111827" }}>{guest.name}</div>
                <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 8 }}>Guest</div>
                <StatusBadge status={guest.latest.status} />
              </div>
            </div>
            {[["Email", guest.email],["Phone", guest.phone],["Bookings", guest.bookings.length],["Latest Stay", guest.latest.checkin]].map(([l,v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #F9FAFB" }}>
                <span style={{ fontSize: 13, color: "#9CA3AF", fontWeight: 600 }}>{l}</span>
                <span style={{ fontSize: 13, color: "#111827", fontWeight: 600 }}>{v}</span>
              </div>
            ))}
            <h3 style={{ fontSize: 14, margin: "20px 0 10px" }}>Reservation history</h3>
            <div style={{ maxHeight: 250, overflowY: "auto" }}>
              {guest.history.map((booking) => (
                <div key={booking.id} style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
                  <div style={{ fontWeight: 700 }}>{booking.id}</div>
                  <div style={{ color: "#6B7280" }}>{booking.room} · {booking.checkin}{booking.preferredTime ? ` · ${formatArrivalTime(booking.preferredTime)}` : ""} · Check-out {booking.checkout} · {booking.status}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoomsPanel() {
  return <RoomServiceManagement />;
}

function MessagesPanel() {
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [reply, setReply] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    let requestInProgress = false;
    const refreshMessages = async () => {
      if (requestInProgress) return;
      requestInProgress = true;
      setLoading(true);
      try {
        const items = await apiRequest("/messages");
        if (!Array.isArray(items)) throw new Error("The messages response was not a list.");
        if (isCurrent) {
          setConversations(items);
          setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? null);
          setError("");
        }
      } catch (requestError) {
        if (isCurrent) setError(requestError.message);
      } finally {
        if (isCurrent) setLoading(false);
        requestInProgress = false;
      }
    };
    refreshMessages();
    return () => {
      isCurrent = false;
    };
  }, [refreshVersion]);

  useEffect(() => {
    const refresh = () => setRefreshVersion((version) => version + 1);
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refreshOnVisibility, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setConversation(null);
      setConversationLoading(false);
      return undefined;
    }
    let isCurrent = true;
    setConversation(null);
    setConversationLoading(true);
    apiRequest(`/messages/${selectedId}`)
      .then((result) => {
        if (isCurrent) {
          setConversation(result);
          setError("");
        }
      })
      .catch((requestError) => {
        if (isCurrent) setError(requestError.message);
      })
      .finally(() => {
        if (isCurrent) setConversationLoading(false);
      });
    return () => { isCurrent = false; };
  }, [selectedId, refreshVersion]);

  async function sendReply(event) {
    event.preventDefault();
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    setError("");
    try {
      await apiRequest(`/messages/${selectedId}/replies`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      setRefreshVersion((version) => version + 1);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(false);
    }
  }

  const filteredConversations = conversations.filter((item) =>
    [item.guestName, item.guestEmail, item.subject, item.lastMessage]
      .some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())),
  );

  return (
    <div className="staff-message-layout">
      <section className="staff-message-inbox">
        <header className="staff-message-inbox-header">
          <div>
            <h2>Guest messages</h2>
            <span>{conversations.length} conversation{conversations.length === 1 ? "" : "s"}</span>
          </div>
          <button type="button" className="staff-message-refresh" aria-label="Refresh messages" onClick={() => setRefreshVersion((version) => version + 1)}>
            <i className="bi bi-arrow-clockwise" aria-hidden="true" />
          </button>
        </header>
        <label className="staff-message-search">
          <i className="bi bi-search" aria-hidden="true" />
          <span className="visually-hidden">Search guest messages</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" />
        </label>
        <div className="staff-message-thread-list">
          {loading && <p className="staff-message-empty">Loading messages…</p>}
          {!loading && conversations.length === 0 && <p className="staff-message-empty">No inquiries yet. Guest messages will appear here.</p>}
          {!loading && conversations.length > 0 && filteredConversations.length === 0 && <p className="staff-message-empty">No messages match your search.</p>}
          {filteredConversations.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedId(item.id);
                setReply("");
                setError("");
              }}
              aria-current={selectedId === item.id ? "true" : undefined}
              className={`staff-message-thread${selectedId === item.id ? " is-active" : ""}`}
            >
              <span className="staff-message-avatar" aria-hidden="true">{(item.guestName || item.guestEmail || "G").trim().slice(0, 1).toUpperCase()}</span>
              <span className="staff-message-thread-copy">
                <strong>{item.guestName || item.guestEmail}</strong>
                <span>{item.guestEmail}</span>
                <b>{item.subject}</b>
                <small>{item.lastMessage || "No messages yet"}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="staff-message-conversation">
        {!conversation && conversationLoading && <p className="staff-message-empty">Loading conversation…</p>}
        {!conversation && !conversationLoading && <div className="staff-message-placeholder"><i className="bi bi-chat-square-text" aria-hidden="true" /><h2>Select a conversation</h2><p>Choose a guest message to read and reply.</p></div>}
        {conversation && (
          <>
            <header className="staff-message-conversation-header">
              <span className="staff-message-avatar large" aria-hidden="true">{(conversation.guestName || conversation.guestEmail || "G").trim().slice(0, 1).toUpperCase()}</span>
              <div>
                <h2>{conversation.subject}</h2>
                <p>{conversation.guestName} · {conversation.guestEmail}{conversation.guestPhone ? ` · ${conversation.guestPhone}` : ""}</p>
              </div>
            </header>
            <div className="staff-message-log" aria-live="polite" aria-label="Conversation messages">
              {conversation.messages.map((message) => {
                const fromGuest = message.senderRole === "guest";
                return (
                  <article key={message.id} className={`staff-message-bubble${fromGuest ? " from-guest" : " from-team"}`}>
                    <strong>{fromGuest ? conversation.guestName : message.senderName || "Villa Tjeozabel team"}</strong>
                    <div className="staff-message-body">{message.body}</div>
                    {message.attachments?.map((attachment) => <MessageAttachment key={attachment.id} attachment={attachment} />)}
                    <time>{new Date(message.createdAt.includes("T") ? message.createdAt : `${message.createdAt.replace(" ", "T")}Z`).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                  </article>
                );
              })}
            </div>
            <form className="staff-message-reply" onSubmit={sendReply}>
              <label htmlFor="staff-message-reply">Reply to guest</label>
              <textarea id="staff-message-reply" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} rows={3} required placeholder="Write a helpful reply…" />
              <div>
                <span>{reply.length}/5000</span>
                <button type="submit" disabled={sending || !reply.trim()}>
                  <i className={`bi ${sending ? "bi-hourglass-split" : "bi-send-fill"}`} aria-hidden="true" />
                  {sending ? "Sending…" : "Send reply"}
                </button>
              </div>
            </form>
          </>
        )}
        {error && <p className="staff-message-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

const S = {
  shell:        { display: "flex", minHeight: "100vh", background: "#FFF7ED", fontFamily: "Inter, sans-serif" },
  sidebar:      { width: 250, background: "#fff", borderRight: "1px solid #FED7AA", padding: 24, display: "flex", flexDirection: "column" },
  logoBox:      { display: "flex", alignItems: "center", gap: 14, marginBottom: 40 },
  logoTitle:    { margin: 0, fontSize: 18, fontWeight: 800, color: "#1F2937" },
  logoSub:      { margin: "4px 0 0", fontSize: 11, letterSpacing: 2, color: "#9CA3AF" },
  nav:          { display: "flex", flexDirection: "column", gap: 10, flex: 1 },
  navItem:      { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 14, border: "none", background: "transparent", color: "#6B7280", fontWeight: 600, fontSize: 14, cursor: "pointer", transition: "0.2s", fontFamily: "Inter, sans-serif" },
  activeNav:    { background: "#F97316", color: "#fff", boxShadow: "0 6px 18px rgba(249,115,22,0.25)" },
  logoutBtn:    { marginTop: "auto", border: "1px solid #FED7AA", background: "#FFF7ED", padding: "14px 16px", borderRadius: 14, color: "#EA580C", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, fontFamily: "Inter, sans-serif", fontSize: 14 },
  main:         { flex: 1, padding: 32, overflowY: "auto" },
  topbar:       { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 },
  title:        { margin: 0, fontSize: 28, fontWeight: 800, color: "#111827" },
  subtitle:     { margin: "6px 0 0", color: "#6B7280", fontSize: 14 },
  topActions:   { display: "flex", alignItems: "center", gap: 18 },
  notification: { width: 46, height: 46, borderRadius: 14, background: "#fff", border: "1px solid #FED7AA", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer" },
  notifBadge:   { position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#F97316", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  profile:      { display: "flex", alignItems: "center", gap: 12, background: "#fff", padding: "10px 14px", borderRadius: 16, border: "1px solid #FED7AA" },
  profileAvatar:{ width: 42, height: 42, borderRadius: "50%", background: "#F97316", color: "#fff", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  profileName:  { margin: 0, fontSize: 14, fontWeight: 700, color: "#111827" },
  profileRole:  { fontSize: 12, color: "#9CA3AF" },
  statsGrid:    { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 28 },
  card:         { background: "#fff", borderRadius: 22, padding: 24, border: "1px solid #FED7AA", boxShadow: "0 10px 30px rgba(249,115,22,0.06)" },
  cardLabel:    { margin: 0, fontSize: 12, color: "#9CA3AF", letterSpacing: 1, fontWeight: 700 },
  cardValue:    { margin: "14px 0 8px", fontSize: 32, fontWeight: 800, color: "#111827" },
  cardText:     { margin: 0, color: "#6B7280", fontSize: 13 },
  tableCard:    { background: "#fff", borderRadius: 22, padding: 24, border: "1px solid #FED7AA", boxShadow: "0 10px 30px rgba(249,115,22,0.06)" },
  tableHeader:  { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  tableTitle:   { margin: 0, fontSize: 20, fontWeight: 800, color: "#111827" },
  orangeBtn:    { background: "#F97316", color: "#fff", border: "none", borderRadius: 12, padding: "10px 18px", fontWeight: 700, cursor: "pointer", fontFamily: "Inter, sans-serif", display: "inline-flex", alignItems: "center" },
  table:        { width: "100%", borderCollapse: "collapse" },
  th:           { textAlign: "left", padding: 14, color: "#9CA3AF", fontSize: 12, fontWeight: 700, borderBottom: "1px solid #F3F4F6" },
  td:           { padding: 16, fontSize: 14, color: "#374151", borderBottom: "1px solid #F9FAFB" },
  searchInput:  { width: "100%", height: 44, padding: "0 16px", border: "1.5px solid #FED7AA", borderRadius: 14, fontSize: 14, color: "#111827", background: "#fff", fontFamily: "Inter, sans-serif", outline: "none", boxSizing: "border-box" },
};

const PAGE_META = {
  dashboard: { title: "Dashboard Overview",  sub: "Welcome back! Here's today's resort summary." },
  bookings:  { title: "Bookings",            sub: "Manage all guest reservations."               },
  guests:    { title: "Guests",              sub: "View and manage guest profiles."              },
  rooms:     { title: "Rooms & Spaces",      sub: "Monitor room availability and status."       },
  messages:  { title: "Messages",            sub: "Communicate with guests and admin."           },
};

export default function StaffDashboard() {
  const navigate = useNavigate();
  const [active, setActive] = useState("dashboard");
  const [user] = useState(() => {
    try {
      return getSessionUser() || {};
    } catch {
      return {};
    }
  });
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const refreshRef = useRef(() => {});
  const profileMenuRef = useRef(null);

  useEffect(() => {
    if (!profileMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);
  useEffect(() => {
    let isCurrent = true;
    let requestInProgress = false;
    setLoading(true);
    const refresh = async () => {
      if (requestInProgress) return;
      requestInProgress = true;
      if (isCurrent) setRefreshing(true);
      const [reservationResult, summaryResult, serviceResult] = await Promise.allSettled([
        apiRequest("/reservations?limit=500"),
        apiRequest("/dashboard"),
        apiRequest("/services"),
      ]);
      const errors = [];
      if (reservationResult.status === "fulfilled" && Array.isArray(reservationResult.value)) {
        if (isCurrent) setBookings(reservationResult.value.map(toDashboardReservation));
      } else {
        errors.push(reservationResult.status === "rejected" ? reservationResult.reason.message : "The reservations response was not a list.");
      }
      if (summaryResult.status === "fulfilled" && summaryResult.value && typeof summaryResult.value === "object") {
        if (isCurrent) setSummary(summaryResult.value);
      } else {
        errors.push(summaryResult.status === "rejected" ? summaryResult.reason.message : "The dashboard summary response was invalid.");
      }
      if (serviceResult.status === "fulfilled" && Array.isArray(serviceResult.value)) {
        if (isCurrent) setServices(serviceResult.value);
      } else {
        errors.push(serviceResult.status === "rejected" ? serviceResult.reason.message : "The services response was not a list.");
      }
      if (isCurrent) {
        setDashboardError(errors.join(" "));
        setLoading(false);
        setRefreshing(false);
        setLastUpdated(new Date());
      }
      requestInProgress = false;
    };
    refreshRef.current = refresh;
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);
    const refreshOnFocus = () => refresh();
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      isCurrent = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, []);

  async function updateBookingStatus(booking, status) {
    try {
      const updated = await apiRequest(`/reservations/${booking.reservationId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setBookings((current) => current.map((item) => item.reservationId === booking.reservationId ? toDashboardReservation(updated) : item));
      setDashboardError("");
      refreshRef.current();
    } catch (error) {
      setDashboardError(error.message);
    }
  }

  const initials = user.name ? user.name.split(" ").map(n => n[0]).join("").toUpperCase() : "S";

  const panels = {
    dashboard: <DashboardPanel bookings={bookings} summary={summary} loading={loading} onViewAll={() => setActive("bookings")} />,
    bookings:  <BookingsPanel
      bookings={bookings}
      summary={summary}
      services={services}
      loading={loading}
      onStatusChange={updateBookingStatus}
      onWalkInCreated={() => refreshRef.current()}
    />,
    guests:    <GuestsPanel bookings={bookings} loading={loading} />,
    rooms:     <RoomsPanel services={services} />,
    messages:  <MessagesPanel />,
  };

  const handleLogout = async () => {
    if (!window.confirm("Are you sure you want to log out?")) return;
    try {
      await logoutSession();
      navigate("/login");
    } catch (error) {
      window.alert(error.message);
    }
  };

  const meta = PAGE_META[active];

  return (
    <div className="staff-dashboard-shell" style={S.shell}>
      <aside className="staff-dashboard-sidebar" style={S.sidebar}>
        <div style={S.logoBox}>
          <div>
            <h2 style={S.logoTitle}>Villa Tjeozabel</h2>
            <p style={S.logoSub}>STAFF DASHBOARD</p>
          </div>
        </div>

        <nav className="staff-dashboard-nav" style={S.nav}>
          {navItems.map(item => (
            <button
              key={item.key}
              onClick={() => setActive(item.key)}
              style={{ ...S.navItem, ...(active === item.key ? S.activeNav : {}) }}
            >
              <i
                className={`bi ${item.icon}`}
                style={{ fontSize: 18, color: active === item.key ? "#fff" : "#EA580C", flexShrink: 0 }}
              />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

      </aside>

      <main className="staff-dashboard-main" style={S.main}>
        <div style={S.topbar}>
          <div>
            <h1 style={S.title}>{meta.title}</h1>
            <p style={S.subtitle}>{meta.sub}</p>
          </div>
          <div style={S.topActions}>
            <span aria-live="polite" style={{ fontSize: 12, color: dashboardError ? "#b42318" : "#15803D", whiteSpace: "nowrap" }}>
              {refreshing ? "Updating…" : dashboardError ? "Refresh error" : `Live · ${lastUpdated?.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" }) || "Waiting"}`}
            </span>
            <button type="button" aria-label="Refresh staff dashboard" disabled={refreshing} onClick={() => refreshRef.current()} style={{ ...S.notification, opacity: refreshing ? 0.6 : 1 }}>
              <i className={`bi ${refreshing ? "bi-arrow-repeat" : "bi-arrow-clockwise"}`} style={{ color: "#EA580C" }} />
            </button>
            <div ref={profileMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                aria-label="Open staff profile options"
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                onClick={() => setProfileMenuOpen((open) => !open)}
                style={{ ...S.profile, cursor: "pointer", fontFamily: "Inter, sans-serif", textAlign: "left" }}
              >
                {user.profileImage ? (
                  <img
                    src={adminProfilePictureUrl(user.profileImage)}
                    alt=""
                    style={{ ...S.profileAvatar, objectFit: "cover" }}
                  />
                ) : (
                  <div style={S.profileAvatar}>{initials}</div>
                )}
                <span>
                  <span style={{ ...S.profileName, display: "block" }}>{user.name || "Staff Member"}</span>
                  <span style={S.profileRole}>Staff Member</span>
                </span>
                <i className="bi bi-chevron-down" aria-hidden="true" style={{ color: "#9CA3AF", fontSize: 12 }} />
              </button>
              {profileMenuOpen && (
                <div role="menu" aria-label="Staff profile options" style={{ position: "absolute", zIndex: 30, top: "calc(100% + 8px)", right: 0, minWidth: 180, padding: 6, background: "#fff", border: "1px solid #FED7AA", borderRadius: 12, boxShadow: "0 10px 28px rgba(31,41,55,0.14)" }}>
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); navigate("/user/profile-settings"); }} style={{ display: "block", width: "100%", padding: "10px 12px", border: 0, borderRadius: 8, background: "transparent", color: "#374151", textAlign: "left", cursor: "pointer", fontSize: 14 }}>Profile Settings</button>
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); handleLogout(); }} style={{ display: "block", width: "100%", padding: "10px 12px", border: 0, borderRadius: 8, background: "transparent", color: "#C2410C", textAlign: "left", cursor: "pointer", fontSize: 14 }}>Log out</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {dashboardError && <p role="alert" style={{ color: "#b42318", marginBottom: 16 }}>{dashboardError}</p>}
        {panels[active]}
      </main>
    </div>
  );
}
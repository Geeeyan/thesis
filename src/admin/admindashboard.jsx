import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminProfilePictureUrl, apiRequest, downloadDocument, getSessionUser, logoutSession, removeSiteAsset, reservationStatusLabel, saveSessionUser, siteAssetUrl, toDashboardReservation, uploadSiteAsset } from "../api";
import MessageAttachment from "../components/messageattachment";
import PasswordInput from "../components/passwordinput";
import RoomServiceManagement from "../components/roomservicemanagement";
import WeeklyComboChart from "../components/weeklycombochart";
import { formatArrivalTime } from "../utils/arrivalTime";

const RESERVATION_TRANSITIONS = {
  Pending: ["Confirmed", "Cancelled"],
  Confirmed: ["Checked-in", "Completed", "Cancelled"],
  "Checked-in": ["Completed"],
  Completed: [],
  Cancelled: [],
};

const SITE_MEDIA_GROUPS = [
  {
    title: "Payment",
    description: "Shown to customers when they choose e-wallet payment.",
    assets: [{ key: "payment-qr", label: "E-wallet QR code" }],
  },
  {
    title: "Landing page",
    description: "The hero image and featured service and room photos.",
    assets: [
      { key: "landing-hero", label: "Hero banner" },
      { key: "service-entire-villa", label: "Entire Villa" },
      { key: "service-private-pool", label: "Private Pool" },
      { key: "service-event-space", label: "Event Space" },
      { key: "service-romantic-stay", label: "Romantic Stay" },
      { key: "room-regular", label: "Regular Room" },
      { key: "room-luxury", label: "Luxury Room" },
      { key: "room-event", label: "Event Space room card" },
    ],
  },
  {
    title: "Services & rooms",
    description: "Photos shown on the Services page and service detail pages.",
    assets: [
      { key: "service-luxury-room", label: "Luxury Room service" },
      { key: "room-pool", label: "Private Pool room card" },
    ],
  },
];

function SiteAssetCard({ asset, value, busy, onUpload, onRemove }) {
  const inputId = `site-asset-${asset.key}`;
  return (
    <article className="site-asset-card">
      <div className={`site-asset-preview${asset.key === "payment-qr" ? " is-qr" : ""}`}>
        {value ? (
          <img src={siteAssetUrl(asset.key, value.updatedAt)} alt={`${asset.label} current image`} />
        ) : (
          <div><i className="bi bi-image" aria-hidden="true" /><span>Default image</span></div>
        )}
      </div>
      <div className="site-asset-card-info">
        <div>
          <h4>{asset.label}</h4>
          <p>{value ? "Custom image active" : "Using the built-in image"}</p>
        </div>
        <div className="site-asset-actions">
          <label htmlFor={inputId} className="site-asset-upload">
            <i className={`bi ${busy ? "bi-hourglass-split" : "bi-upload"}`} aria-hidden="true" />
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </label>
          <input id={inputId} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => onUpload(asset.key, event)} />
          {value && (
            <button type="button" className="site-asset-reset" disabled={busy} onClick={() => onRemove(asset.key)}>
              Restore default
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

const PAYMENT_TRANSITIONS = {
  Pending: ["Paid", "Failed"],
  Paid: ["Refunded"],
  Failed: ["Pending"],
  Refunded: [],
};

const NAV = [
  { id: "overview",     label: "Overview",     section: "Main",       icon: "bi-grid"              },
  { id: "reservations", label: "Reservations", section: "Main",       icon: "bi-calendar-check"    },
  { id: "transactions", label: "Transactions", section: "Main",       icon: "bi-credit-card"       },
  { id: "messages",     label: "Messages",     section: "Main",       icon: "bi-chat-dots"         },
  { id: "documents",    label: "Documents",    section: "Main",       icon: "bi-file-earmark"      },
  { id: "customers",    label: "Customers",    section: "Management", icon: "bi-people"            },
  { id: "rooms",        label: "Rooms",        section: "Management", icon: "bi-house-door"        },
  { id: "services",     label: "Services",     section: "Management", icon: "bi-layers"            },
  { id: "reports",      label: "Reports",      section: "Analytics",  icon: "bi-bar-chart-line"    },
  { id: "settings",     label: "Settings",     section: "Analytics",  icon: "bi-gear"              },
];

const S = {
  shell:      { display: "flex", height: "100vh", overflow: "hidden", fontFamily: "'Inter', sans-serif", background: "#FFF7ED", color: "#111827" },

  sidebar:    { width: 250, flexShrink: 0, background: "#fff", borderRight: "1px solid #FED7AA", padding: 24, display: "flex", flexDirection: "column" },
  logoBox:    { display: "flex", alignItems: "center", gap: 12, marginBottom: 36 },
  logoDot:    { width: 10, height: 10, background: "#F97316", borderRadius: "50%", flexShrink: 0 },
  logoTitle:  { fontSize: 17, fontWeight: 800, color: "#1F2937", lineHeight: 1.2, margin: 0 },
  logoSub:    { fontSize: 10, letterSpacing: 2, color: "#9CA3AF", marginTop: 3, textTransform: "uppercase", margin: 0 },
  navSection: { fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#D1D5DB", padding: "14px 8px 6px" },
  navItem:    (active) => ({
    display: "flex", alignItems: "center", gap: 12,
    padding: "12px 16px", borderRadius: 14, border: "none",
    background: active ? "#F97316" : "transparent",
    color: active ? "#fff" : "#6B7280",
    fontWeight: 600, fontSize: 14, cursor: "pointer",
    width: "100%", textAlign: "left", fontFamily: "'Inter', sans-serif",
    boxShadow: active ? "0 6px 18px rgba(249,115,22,0.25)" : "none",
    transition: "all 0.18s",
  }),
  logoutBtn:  {
    marginTop: "auto", border: "1px solid #FED7AA", background: "#FFF7ED",
    padding: "14px 16px", borderRadius: 14, display: "flex", alignItems: "center",
    gap: 10, cursor: "pointer", width: "100%", fontFamily: "'Inter', sans-serif",
    fontSize: 14, fontWeight: 700, color: "#EA580C", transition: "all 0.18s",
  },

  main:       { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  topbar:     { background: "#fff", borderBottom: "1px solid #FED7AA", padding: "0 32px", height: 72, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, boxShadow: "0 2px 12px rgba(249,115,22,0.06)" },
  topbarTitle:{ fontSize: 20, fontWeight: 800, color: "#111827", margin: 0 },
  topbarRight:{ display: "flex", alignItems: "center", gap: 12 },
  notifBtn:   { width: 46, height: 46, borderRadius: 14, background: "#fff", border: "1px solid #FED7AA", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", cursor: "pointer" },
  notifBadge: { position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: "50%", background: "#F97316", color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" },
  profileBox: { display: "flex", alignItems: "center", gap: 12, background: "#fff", padding: "8px 14px", borderRadius: 16, border: "1px solid #FED7AA" },
  profileAvatar: { width: 36, height: 36, borderRadius: "50%", background: "#F97316", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 },
  profileName:{ fontSize: 13, fontWeight: 700, color: "#111827", margin: 0 },
  profileRole:{ fontSize: 11, color: "#9CA3AF", margin: 0 },

  content:    { flex: 1, overflowY: "auto", padding: "28px 32px" },

  card:       { background: "#fff", borderRadius: 22, padding: 24, border: "1px solid #FED7AA", boxShadow: "0 10px 30px rgba(249,115,22,0.06)", marginBottom: 0 },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  cardTitle:  { fontSize: 16, fontWeight: 800, color: "#111827", margin: 0 },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 20, marginBottom: 28 },
  metricCard: { background: "#fff", borderRadius: 22, padding: "22px 24px", border: "1px solid #FED7AA", boxShadow: "0 10px 30px rgba(249,115,22,0.06)" },
  metricIcon: { width: 44, height: 44, background: "#FFF7ED", borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, marginBottom: 14, border: "1px solid #FED7AA" },
  metricLabel:{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  metricValue:{ fontSize: 30, fontWeight: 800, color: "#111827", letterSpacing: -1, marginBottom: 6 },
  twoCol:     { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 },

  table:      { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th:         { textAlign: "left", padding: "0 14px 12px", color: "#9CA3AF", fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", borderBottom: "1px solid #F3F4F6" },
  td:         { padding: 14, color: "#374151", borderBottom: "1px solid #F9FAFB" },
  tdLast:     { padding: 14, color: "#374151" },

  badge: (status) => {
    const map = { Confirmed: ["#DCFCE7","#166534"], Paid: ["#DCFCE7","#166534"], New: ["#DCFCE7","#166534"], Active: ["#DCFCE7","#166534"], Available: ["#DCFCE7","#166534"], Pending: ["#FFEDD5","#C2410C"], Limited: ["#FFEDD5","#C2410C"], Cancelled: ["#FEE2E2","#991B1B"], Refunded: ["#FEE2E2","#991B1B"], "Checked In": ["#DBEAFE","#1D4ED8"], Regular: ["#DBEAFE","#1D4ED8"], VIP: ["#FFF7ED","#F97316"], Featured: ["#FFF7ED","#F97316"] };
    const [bg, color] = map[status] || ["#FFF7ED","#F97316"];
    return { display: "inline-block", fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 999, background: bg, color, border: status === "VIP" || status === "Featured" ? "1px solid #FED7AA" : "none" };
  },

  inlineUser: { display: "flex", alignItems: "center", gap: 10 },
  avatar:     { width: 32, height: 32, borderRadius: "50%", background: "#FFF7ED", border: "1.5px solid #FED7AA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#F97316", flexShrink: 0 },

  searchRow:  { display: "flex", gap: 10, marginBottom: 18, alignItems: "center" },
  searchInput:{ flex: 1, height: 44, padding: "0 16px", border: "1.5px solid #FED7AA", borderRadius: 14, fontSize: 14, color: "#111827", background: "#fff", fontFamily: "'Inter', sans-serif", outline: "none" },
  selectInput:{ height: 44, padding: "0 14px", border: "1.5px solid #FED7AA", borderRadius: 14, fontSize: 13, color: "#6B7280", background: "#fff", cursor: "pointer", fontFamily: "'Inter', sans-serif", outline: "none" },
  primaryBtn: { background: "#F97316", color: "#fff", border: "none", borderRadius: 14, padding: "12px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Inter', sans-serif", boxShadow: "0 6px 18px rgba(249,115,22,0.3)" },
  secondaryBtn: { background: "#fff", color: "#6B7280", border: "1px solid #FED7AA", borderRadius: 14, padding: "12px 20px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Inter', sans-serif" },
  smallBtn:   { background: "#F97316", color: "#fff", border: "none", borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'Inter', sans-serif" },

  serviceGrid:{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 },
  serviceCard:(featured) => ({ background: "#fff", border: featured ? "2px solid #F97316" : "1px solid #FED7AA", borderRadius: 22, padding: 22, boxShadow: "0 4px 16px rgba(249,115,22,0.06)", transition: "transform 0.2s, box-shadow 0.2s" }),
  serviceIcon:{ width: 46, height: 46, background: "#FFF7ED", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 12, border: "1px solid #FED7AA" },

  statMiniGrid:{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 20 },
  statMini:   { background: "#fff", border: "1px solid #FED7AA", borderRadius: 18, padding: "18px 20px", boxShadow: "0 4px 16px rgba(249,115,22,0.06)" },

  tabBar:     { display: "flex", gap: 4, borderBottom: "1.5px solid #FED7AA", marginBottom: 20 },
  tab:        (active) => ({ padding: "10px 18px", fontSize: 14, fontWeight: active ? 700 : 600, color: active ? "#F97316" : "#9CA3AF", borderBottom: active ? "2.5px solid #F97316" : "2.5px solid transparent", marginBottom: -1.5, cursor: "pointer", border: "none", background: "none", fontFamily: "'Inter', sans-serif" }),

  settingsGrid:{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  settingField:{ display: "flex", flexDirection: "column", gap: 6 },
  settingLabel:{ fontSize: 12, fontWeight: 700, color: "#6B7280" },
  settingInput:{ height: 42, padding: "0 14px", border: "1.5px solid #FED7AA", borderRadius: 12, fontSize: 14, color: "#111827", background: "#fff", fontFamily: "'Inter', sans-serif", outline: "none" },
  toggleRow:  { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid #F9FAFB" },
};

function Badge({ label, reservation = false }) {
  const displayLabel = reservation ? reservationStatusLabel(label) : label;
  return <span style={S.badge(label)}>{displayLabel}</span>;
}

function Avatar({ init }) {
  return <div style={S.avatar}>{init}</div>;
}

function InlineUser({ init, name }) {
  return (
    <div style={S.inlineUser}>
      <Avatar init={init} />
      <span style={{ fontWeight: 600 }}>{name}</span>
    </div>
  );
}

function MetricCard({ icon, label, value, change, up }) {
  return (
    <div style={S.metricCard}>
      <div style={S.metricIcon}>
        <i className={`bi ${icon}`} style={{ fontSize: 20, color: "#F97316" }} />
      </div>
      <div style={S.metricLabel}>{label}</div>
      <div style={S.metricValue}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: up ? "#16A34A" : "#DC2626" }}>
        {up ? "▲" : "▼"} {change}
      </div>
    </div>
  );
}

const formatPeso = (amount) => `₱${Number(amount || 0).toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
function LineChart({ data, formatValue = (value) => value }) {
  const maxValue = Math.max(1, ...data.map((point) => point.value));
  const points = data.map((point, index) => {
    const x = data.length === 1 ? 50 : 5 + (index / (data.length - 1)) * 90;
    const y = 88 - (point.value / maxValue) * 70;
    return { ...point, x, y };
  });
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");
  const labelStep = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div>
      <svg
        role="img"
        aria-label="Line chart"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: 130, overflow: "visible" }}
      >
        {[18, 53, 88].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#F3F4F6" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
        ))}
        {points.length > 1 && (
          <polyline
            points={path}
            fill="none"
            stroke="#F97316"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {points.map((point) => (
          <circle key={point.label} cx={point.x} cy={point.y} r="1.8" fill="#F97316" stroke="#fff" strokeWidth="0.7" vectorEffect="non-scaling-stroke">
            <title>{`${point.label}: ${formatValue(point.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        {data.map((point, index) => (
          <div key={point.label} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "#9CA3AF", whiteSpace: "nowrap" }}>
            {index % labelStep === 0 || index === data.length - 1 ? point.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function dailySeries(from, to, amounts, limit = 30) {
  if (!from || !to) return amounts.slice(-limit);
  const amountsByDate = new Map(amounts.map((item) => [item.date, item.amount]));
  const dates = [];
  for (let timestamp = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); timestamp <= end; timestamp += 86400000) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    dates.push({
      date,
      amount: amountsByDate.get(date) || 0,
      label: new Date(`${date}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
    });
  }
  return dates.slice(-limit);
}
const serviceRateUnit = (service) => service.pricingMode === "guest"
  ? "guest"
  : service.code === "regular"
    ? "3 hours"
    : service.code === "event"
      ? "12 hours"
      : service.pricingMode === "night"
        ? "night"
        : "booking";

function Overview({ reservations, overview, report }) {
  const recentReservations = reservations.slice(0, 4);
  const statusCounts = overview?.reservations?.byStatus || {};
  const totalReservations = overview?.reservations?.total ?? reservations.length;
  const cancelled = statusCounts.Cancelled || 0;
  const cancellationRate = totalReservations ? `${((cancelled / totalReservations) * 100).toFixed(1)}%` : "0%";
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, label: date.toLocaleDateString("en-PH", { weekday: "short" }) };
  });
  const reservationsByDate = new Map((report?.dailyReservations || []).map((day) => [day.date, day.count]));
  const reservationsByDay = weekDays.map(({ key }) => reservationsByDate.get(key) || 0);
  const serviceRows = report?.byRoom || [];
  return (
    <>
      <div style={S.metricGrid}>
        <MetricCard icon="bi-calendar-check" label="TOTAL RESERVATIONS" value={totalReservations.toLocaleString("en-PH")} change={`${statusCounts.Pending || 0} ${reservationStatusLabel("Pending")}`} up />
        <MetricCard icon="bi-cash-stack" label="REVENUE COLLECTED" value={formatPeso(overview?.revenue?.collected)} change={`${formatPeso(overview?.revenue?.bookedValue)} booked value`} up />
        <MetricCard icon="bi-people" label="TOTAL USERS" value={(overview?.users?.total || 0).toLocaleString("en-PH")} change={`${overview?.users?.guest || 0} customers · ${overview?.users?.active || 0} active`} up />
        <MetricCard icon="bi-hourglass-split" label="OUTSTANDING BALANCE" value={formatPeso(overview?.revenue?.outstanding)} change="Unpaid on active reservations" up={false} />
        <MetricCard icon="bi-x-circle" label="CANCELLATION RATE" value={cancellationRate} change={`${cancelled} cancelled reservations`} up={false} />
      </div>

      <div style={S.twoCol}>
        <div style={S.card}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>Reservations Created · Last 7 Days</span>
            <Badge label="Live" />
          </div>
          <LineChart data={weekDays.map(({ key, label }, index) => ({
            label,
            value: reservationsByDay[index],
          }))} />
        </div>

        <div style={S.card}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>Booked Value by Reservation Type</span>
            <Badge label="Last 30 days" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {serviceRows.length ? (
              <div style={{ display: "grid", gap: 10, width: "100%" }}>
                {serviceRows.slice(0, 4).map((service) => (
                  <div key={service.room} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, color: "#6B7280" }}>
                    <span>{service.name} · {service.reservations} bookings</span>
                    <strong style={{ color: "#F97316", whiteSpace: "nowrap" }}>{formatPeso(service.bookedValue)}</strong>
                  </div>
                ))}
              </div>
            ) : <p style={{ color: "#6B7280", margin: 0 }}>No service bookings in the current report period.</p>}
          </div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>Recent Reservations</span>
          <Badge label="Latest" />
        </div>
        <table style={S.table}>
          <thead>
            <tr>{["ID","Customer","Room / Service","Date","Amount","Status"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {recentReservations.map((r, i) => (
              <tr key={r.id}>
                <td style={i === recentReservations.length - 1 ? S.tdLast : S.td}><span style={{ color: "#9CA3AF", fontSize: 12 }}>{r.id}</span></td>
                <td style={i === recentReservations.length - 1 ? S.tdLast : S.td}><InlineUser init={r.init} name={r.customer} /></td>
                <td style={i === recentReservations.length - 1 ? S.tdLast : S.td}>{r.room}</td>
                <td style={{ ...(i === recentReservations.length - 1 ? S.tdLast : S.td), color: "#9CA3AF" }}>{r.checkin}{r.preferredTime ? ` · ${formatArrivalTime(r.preferredTime)}` : ""}{r.sameDayCheckout ? ` → ${r.checkout}` : ""}</td>
                <td style={{ ...(i === recentReservations.length - 1 ? S.tdLast : S.td), fontWeight: 700, color: "#F97316" }}>{r.amount}</td>
                <td style={i === recentReservations.length - 1 ? S.tdLast : S.td}><Badge label={r.status} reservation /></td>
              </tr>
            ))}
            {recentReservations.length === 0 && <tr><td colSpan={6} style={S.td}>No reservations yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Reservations({ reservations, services, loading, error, onStatusChange }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [serviceFilter, setServiceFilter] = useState("All");
  const [checkInFilter, setCheckInFilter] = useState("");
  const filtered = reservations.filter((reservation) => {
    const query = search.trim().toLowerCase();
    const matchesQuery = !query
      || reservation.id.toLowerCase().includes(query)
      || reservation.customer.toLowerCase().includes(query)
      || reservation.guestEmail.toLowerCase().includes(query)
      || reservation.room.toLowerCase().includes(query);
    return matchesQuery
      && (statusFilter === "All" || reservation.status === statusFilter)
      && (serviceFilter === "All" || reservation.roomCode === serviceFilter)
      && (!checkInFilter || reservation.checkIn === checkInFilter);
  });

  return (
    <>
      <div style={{ ...S.searchRow, marginBottom: 20 }}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by booking, customer, email, or service..." style={S.searchInput} />
        <input type="date" value={checkInFilter} onChange={(event) => setCheckInFilter(event.target.value)} style={S.selectInput} aria-label="Filter reservations by check-in date" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={S.selectInput} aria-label="Filter reservations by status">
          {["All", ...Object.keys(RESERVATION_TRANSITIONS)].map((status) => <option key={status} value={status}>{reservationStatusLabel(status)}</option>)}
        </select>
        <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} style={S.selectInput} aria-label="Filter reservations by service">
          <option value="All">All Services</option>
          {services.filter((service) => service.category === "room").map((service) => <option key={service.code} value={service.code}>{service.name}</option>)}
        </select>
      </div>
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
      <div style={S.card}>
        <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>{["Res. ID","Type","Customer","Room / Service","Check-in","Check-out","Pax","Amount","Status",""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const last = i === filtered.length - 1;
              return (
                <tr key={r.id}>
                  <td style={last ? S.tdLast : S.td}><span style={{ color: "#9CA3AF", fontSize: 12 }}>{r.id}</span></td>
                  <td style={last ? S.tdLast : S.td}>{r.bookingType}</td>
                  <td style={last ? S.tdLast : S.td}><InlineUser init={r.init} name={r.customer} /></td>
                  <td style={last ? S.tdLast : S.td}>{r.room}</td>
                  <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF" }}>{r.checkin}{r.preferredTime ? ` · ${formatArrivalTime(r.preferredTime)}` : ""}</td>
                  <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF" }}>{r.checkout}</td>
                  <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF" }}>{r.pax}</td>
                  <td style={{ ...(last ? S.tdLast : S.td), fontWeight: 700, color: "#F97316" }}>{r.amount}</td>
                  <td style={last ? S.tdLast : S.td}><Badge label={r.status} reservation /></td>
                  <td style={last ? S.tdLast : S.td}>
                    <select aria-label={`Update ${r.id} status`} style={S.selectInput} value={r.status} onChange={(event) => onStatusChange(r, event.target.value)}>
                      {[r.status, ...(RESERVATION_TRANSITIONS[r.status] || [])].map((status) => <option key={status} value={status}>{reservationStatusLabel(status)}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={10} style={S.td}>{reservations.length ? "No reservations match your filters." : "No reservations yet."}</td></tr>}
            {loading && <tr><td colSpan={10} style={S.td}>Loading reservations…</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

function Transactions({ payments, loading, error, onStatusChange }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const collected = payments.filter((payment) => payment.status === "Paid").reduce((total, payment) => total + payment.amount, 0);
  const refunded = payments.filter((payment) => payment.status === "Refunded").reduce((total, payment) => total + payment.amount, 0);
  const pending = payments.filter((payment) => payment.status === "Pending");
  const filtered = payments.filter((payment) => {
    const query = search.trim().toLowerCase();
    const matchesQuery = !query
      || String(payment.id).includes(query)
      || payment.reservation.toLowerCase().includes(query)
      || payment.guestName.toLowerCase().includes(query);
    return matchesQuery && (statusFilter === "All" || payment.status === statusFilter);
  });
  const money = (amount, currency) => new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: currency || "PHP",
  }).format(Number(amount));

  return (
    <>
      <div style={{ ...S.metricGrid, gridTemplateColumns: "repeat(3,1fr)" }}>
        <MetricCard icon="bi-wallet2" label="TOTAL COLLECTED" value={money(collected, "PHP")} change="Confirmed payments" up />
        <MetricCard icon="bi-arrow-counterclockwise" label="REFUNDS ISSUED" value={money(refunded, "PHP")} change="Recorded refunds" up={false} />
        <MetricCard icon="bi-hourglass-split" label="PENDING PAYMENTS" value={money(pending.reduce((total, payment) => total + payment.amount, 0), "PHP")} change={`${pending.length} awaiting review`} up={false} />
      </div>
      <div style={{ ...S.searchRow, marginBottom: 20 }}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by transaction, reservation, or guest..." style={S.searchInput} />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={S.selectInput} aria-label="Filter transactions by status">
          {["All", "Pending", "Paid", "Failed", "Refunded"].map((status) => <option key={status}>{status}</option>)}
        </select>
      </div>
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
      <div style={S.card}>
        <p style={{ marginTop: 0, color: "#6B7280", fontSize: 13 }}>
          Confirm a payment only after verifying that the funds have actually arrived. This system does not connect to a payment provider.
        </p>
        <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>{["Txn ID","Reservation","Customer","Method","Date","Amount","Status","Admin action"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map((payment, i) => {
              const last = i === filtered.length - 1;
              return (
                <tr key={payment.id}>
                  <td style={last ? S.tdLast : S.td}><span style={{ color: "#9CA3AF", fontSize: 12 }}>#{payment.id}</span></td>
                  <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF" }}>{payment.reservation}</td>
                  <td style={last ? S.tdLast : S.td}>{payment.guestName}</td>
                  <td style={last ? S.tdLast : S.td}>{payment.method === "ewallet" ? "E-Wallet" : "Bank transfer"}</td>
                  <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF" }}>{payment.createdAt ? new Date(payment.createdAt).toLocaleDateString("en-PH") : "—"}</td>
                  <td style={{ ...(last ? S.tdLast : S.td), fontWeight: 700, color: "#F97316" }}>{money(payment.amount, payment.currency)}</td>
                  <td style={last ? S.tdLast : S.td}><Badge label={payment.status} /></td>
                  <td style={last ? S.tdLast : S.td}>
                    <select
                      aria-label={`Update payment ${payment.id} status`}
                      style={S.selectInput}
                      value={payment.status}
                      disabled={(PAYMENT_TRANSITIONS[payment.status] || []).length === 0}
                      onChange={(event) => onStatusChange(payment, event.target.value)}
                    >
                      {[payment.status, ...(PAYMENT_TRANSITIONS[payment.status] || [])].map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} style={S.td}>{payments.length ? "No transactions match your search." : "No payment requests have been submitted."}</td></tr>}
            {loading && <tr><td colSpan={8} style={S.td}>Loading payment requests…</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

function Customers({ users, loading, error }) {
  return (
    <>
      <div style={S.card}>
        <table style={S.table}>
          <thead>
            <tr>{["Guest","Email","Role","Account","Status","Saved Since"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {users.map((user, i) => {
              const last = i === users.length - 1;
              return (
                <tr key={user.id}>
                  <td style={last ? S.tdLast : S.td}><InlineUser init={user.name.slice(0, 2).toUpperCase()} name={user.name} /></td>
                  <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF", fontSize: 12 }}>{user.email}</td>
                  <td style={last ? S.tdLast : S.td}>{user.role}</td>
                  <td style={last ? S.tdLast : S.td}>{user.loginEnabled ? "Registered account" : "Reservation guest"}</td>
                  <td style={last ? S.tdLast : S.td}>{user.active ? "Active" : "Inactive"}</td>
                  <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF" }}>{new Date(`${user.createdAt}Z`).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {!loading && !error && users.length === 0 && <tr><td colSpan={6} style={S.td}>No guest records yet.</td></tr>}
            {loading && <tr><td colSpan={6} style={S.td}>Loading guest records…</td></tr>}
            {error && <tr><td colSpan={6} role="alert" style={S.td}>{error}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Services({ inventoryType, onViewBookings }) {
  return <RoomServiceManagement inventoryType={inventoryType} onViewBookings={onViewBookings} />;
}

function currentReportDate(period) {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (period === "daily") return localDate;
  if (period === "monthly") return localDate.slice(0, 7);
  return localDate.slice(0, 4);
}

function reportRange(period, value) {
  if (period === "daily" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { from: value, to: value };
  }
  if (period === "monthly" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    return { from: `${value}-01`, to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
  }
  if (period === "yearly" && /^\d{4}$/.test(value) && Number(value) > 0) {
    return { from: `${value}-01-01`, to: `${value}-12-31` };
  }
  throw new Error("Choose a valid date for this report period.");
}

function csvCell(value) {
  const text = String(value ?? "");
  const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function Reports() {
  const [tab, setTab] = useState("monthly");
  const [period, setPeriod] = useState("monthly");
  const [periodValue, setPeriodValue] = useState(() => currentReportDate("monthly"));
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  function invalidateReport() {
    requestRef.current += 1;
    setReport(null);
    setError("");
    setLoading(false);
  }

  const generateReport = useCallback(async (selectedPeriod, selectedValue) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const range = reportRange(selectedPeriod, selectedValue);
      const result = await apiRequest(`/reports?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
      if (requestId === requestRef.current) setReport(result);
    } catch (requestError) {
      if (requestId === requestRef.current) setError(requestError.message);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    generateReport("monthly", currentReportDate("monthly"));
    return () => { requestRef.current += 1; };
  }, [generateReport]);

  function downloadReport() {
    if (!report) return;
    const rows = [
      ["Villa Tjeozabel Report"],
      ["Period", period[0].toUpperCase() + period.slice(1)],
      ["From", report.from],
      ["To", report.to],
      [],
      ["Summary"],
      ["Reservations", report.reservations],
      ["Nights sold", report.nightsSold],
      ["Occupancy", `${report.occupancyPercent}%`],
      ["Booked value", report.bookedValue],
      ["Collected", report.collected],
      ["New customers", report.newCustomers],
      [],
      ["Reservations by status"],
      ["Status", "Count"],
      ...(report.byStatus || []).map((item) => [item.status, item.count]),
      [],
      ["Booked value by service"],
      ["Service", "Bookings", "Nights", "Booked value"],
      ...(report.byRoom || []).map((item) => [item.name, item.reservations, item.nights, item.bookedValue]),
      [],
      ["Top customers"],
      ["Customer", "Email", "Visits", "Booked value"],
      ...(report.topCustomers || []).map((item) => [item.name, item.email, item.visits, item.bookedValue]),
      [],
      ["Collected payments by date"],
      ["Date", "Collected"],
      ...(report.dailyCollected || []).map((item) => [item.date, item.amount]),
      [],
      ["Payments by method"],
      ["Method", "Count", "Amount"],
      ...(report.paymentsByMethod || []).map((item) => [item.method, item.count, item.amount]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `villa-tjeozabel-${period}-report-${report.from}-to-${report.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function printReport() {
    if (!report) return;
    const cleanup = () => document.body.classList.remove("admin-report-printing");
    document.body.classList.add("admin-report-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  const daily = report?.dailyCollected || [];
  const chartDays = dailySeries(report?.from, report?.to, daily);
  const totalBookings = report?.reservations || 0;
  const averageBooking = totalBookings ? report.bookedValue / totalBookings : 0;
  const periodLabel = period[0].toUpperCase() + period.slice(1);

  return (
    <div className="admin-reports-view">
      <WeeklyComboChart />
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
      <form
        className="admin-report-controls"
        onSubmit={(event) => {
          event.preventDefault();
          generateReport(period, periodValue);
        }}
      >
        <label>
          <span>Report period</span>
          <select
            value={period}
            onChange={(event) => {
              const nextPeriod = event.target.value;
              invalidateReport();
              setPeriod(nextPeriod);
              setPeriodValue(currentReportDate(nextPeriod));
            }}
          >
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label>
          <span>{period === "daily" ? "Date" : period === "monthly" ? "Month" : "Year"}</span>
          <input
            required
            type={period === "daily" ? "date" : period === "monthly" ? "month" : "number"}
            min={period === "yearly" ? "1000" : undefined}
            max={period === "yearly" ? "9999" : undefined}
            step={period === "yearly" ? "1" : undefined}
            value={periodValue}
            onChange={(event) => {
              invalidateReport();
              setPeriodValue(event.target.value);
            }}
            aria-label={period === "daily" ? "Report date" : period === "monthly" ? "Report month" : "Report year"}
          />
        </label>
        <button type="submit" className="admin-report-button" disabled={loading}>
          <i className={`bi ${loading ? "bi-hourglass-split" : "bi-bar-chart-line"}`} aria-hidden="true" />
          {loading ? "Generating…" : "Generate report"}
        </button>
        <div className="admin-report-actions">
          <button type="button" className="admin-report-button secondary" disabled={!report || loading} onClick={downloadReport}>
            <i className="bi bi-download" aria-hidden="true" />Download CSV
          </button>
          <button type="button" className="admin-report-button secondary" disabled={!report || loading} onClick={printReport}>
            <i className="bi bi-printer" aria-hidden="true" />Print
          </button>
        </div>
      </form>
      {loading && !report && <p style={{ color: "#6B7280" }}>Generating report…</p>}
      <div style={S.tabBar}>
        {[["monthly","Summary"],["services","By Service"],["customers","By Customer"]].map(([id, label]) => (
          <button key={id} style={S.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div id="admin-report-print-area">
        <header className="admin-report-print-header">
          <h1>Villa Tjeozabel</h1>
          <p>{periodLabel} Report · {report?.from || "—"} to {report?.to || "—"}</p>
          <p>Generated {new Date().toLocaleString("en-PH")}</p>
        </header>
        <section className="admin-report-print-summary">
          <h2>Summary</h2>
          <table>
            <tbody>
              <tr><th>Reservations</th><td>{totalBookings}</td><th>Nights sold</th><td>{report?.nightsSold ?? 0}</td></tr>
              <tr><th>Occupancy</th><td>{report?.occupancyPercent ?? 0}%</td><th>New customers</th><td>{report?.newCustomers ?? 0}</td></tr>
              <tr><th>Booked value</th><td>{formatPeso(report?.bookedValue)}</td><th>Collected</th><td>{formatPeso(report?.collected)}</td></tr>
            </tbody>
          </table>
        </section>
        <section className="admin-report-print-section admin-report-daily-section">
          <h2>Collected payments by date</h2>
          <table>
            <thead><tr><th>Date</th><th>Collected</th></tr></thead>
            <tbody>
              {daily.map((day) => <tr key={day.date}><td>{day.date}</td><td>{formatPeso(day.amount)}</td></tr>)}
              {!daily.length && <tr><td colSpan={2}>No collected payments in this period.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="admin-report-print-section">
          <h2>Reservations by status</h2>
          <table>
            <thead><tr><th>Status</th><th>Count</th></tr></thead>
            <tbody>
              {(report?.byStatus || []).map((item) => <tr key={item.status}><td>{item.status}</td><td>{item.count}</td></tr>)}
              {!report?.byStatus?.length && <tr><td colSpan={2}>No reservations in this period.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="admin-report-print-section">
          <h2>Booked value by service</h2>
          <table>
            <thead><tr><th>Service</th><th>Bookings</th><th>Nights</th><th>Booked value</th></tr></thead>
            <tbody>
              {(report?.byRoom || []).map((item) => <tr key={item.room}><td>{item.name}</td><td>{item.reservations}</td><td>{item.nights}</td><td>{formatPeso(item.bookedValue)}</td></tr>)}
              {!report?.byRoom?.length && <tr><td colSpan={4}>No service bookings in this period.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="admin-report-print-section">
          <h2>Top customers</h2>
          <table>
            <thead><tr><th>Customer</th><th>Email</th><th>Visits</th><th>Booked value</th></tr></thead>
            <tbody>
              {(report?.topCustomers || []).map((item) => <tr key={item.email}><td>{item.name}</td><td>{item.email}</td><td>{item.visits}</td><td>{formatPeso(item.bookedValue)}</td></tr>)}
              {!report?.topCustomers?.length && <tr><td colSpan={4}>No customers in this period.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>

      {tab === "monthly" && (
        <>
          <div style={S.statMiniGrid}>
            {[
              ["COLLECTED", formatPeso(report?.collected)],
              ["RESERVATIONS", totalBookings.toLocaleString("en-PH")],
              ["AVG. BOOKING VALUE", formatPeso(averageBooking)],
              ["NEW CUSTOMERS", (report?.newCustomers || 0).toLocaleString("en-PH")],
            ].map(([label, value]) => (
              <div key={label} style={S.statMini}>
                <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#111827", letterSpacing: -0.5 }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={S.card}>
            <div style={S.cardHeader}>
              <span style={S.cardTitle}>Daily Collected Payments · {report?.from || "—"} to {report?.to || "—"}</span>
              <Badge label={`${report?.occupancyPercent || 0}% occupancy`} />
            </div>
            <LineChart
              data={chartDays.map((day) => ({ label: day.label, value: day.amount }))}
              formatValue={formatPeso}
            />
          </div>
          <div style={{ ...S.card, marginTop: 20 }}>
            <div style={S.cardHeader}><span style={S.cardTitle}>Reservations by Status</span></div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {(report?.byStatus || []).map((item, index, rows) => (
                <div key={item.status} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: index === rows.length - 1 ? "none" : "1px solid #F9FAFB" }}>
                  <strong style={{ fontSize: 14, color: "#111827" }}>{item.status}</strong>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#F97316" }}>{item.count}</span>
                </div>
              ))}
              {!report?.byStatus?.length && <p style={{ color: "#6B7280" }}>No reservations in the report period.</p>}
            </div>
          </div>
        </>
      )}

      {tab === "services" && (
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>Booked Value by Service</span></div>
          <table style={S.table}>
            <thead><tr>{["Service","Bookings","Booked Value","Avg. Value","Share"].map((heading) => <th key={heading} style={S.th}>{heading}</th>)}</tr></thead>
            <tbody>
              {(report?.byRoom || []).map((service, index, rows) => (
                <tr key={service.room}>
                  <td style={index === rows.length - 1 ? S.tdLast : S.td}>{service.name}</td>
                  <td style={index === rows.length - 1 ? S.tdLast : S.td}>{service.reservations}</td>
                  <td style={{ ...(index === rows.length - 1 ? S.tdLast : S.td), fontWeight: 700, color: "#F97316" }}>{formatPeso(service.bookedValue)}</td>
                  <td style={index === rows.length - 1 ? S.tdLast : S.td}>{formatPeso(service.reservations ? service.bookedValue / service.reservations : 0)}</td>
                  <td style={index === rows.length - 1 ? S.tdLast : S.td}>{totalBookings ? `${((service.reservations / totalBookings) * 100).toFixed(1)}%` : "0%"}</td>
                </tr>
              ))}
              {!report?.byRoom?.length && <tr><td colSpan={5} style={S.td}>No service bookings in the report period.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "customers" && (
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>Top Customers by Booking Value</span></div>
          <div style={{ overflowX: "auto" }}>
            <table style={S.table}>
              <thead><tr>{["Customer","Email","Visits","Booking Value","Avg. Booking"].map((heading) => <th key={heading} style={S.th}>{heading}</th>)}</tr></thead>
              <tbody>
                {(report?.topCustomers || []).map((customer, index, rows) => (
                  <tr key={customer.email}>
                    <td style={index === rows.length - 1 ? S.tdLast : S.td}><InlineUser init={customer.name.slice(0, 2).toUpperCase()} name={customer.name} /></td>
                    <td style={{ ...(index === rows.length - 1 ? S.tdLast : S.td), color: "#9CA3AF" }}>{customer.email}</td>
                    <td style={index === rows.length - 1 ? S.tdLast : S.td}>{customer.visits}</td>
                    <td style={{ ...(index === rows.length - 1 ? S.tdLast : S.td), fontWeight: 700, color: "#F97316" }}>{formatPeso(customer.bookedValue)}</td>
                    <td style={index === rows.length - 1 ? S.tdLast : S.td}>{formatPeso(customer.bookedValue / customer.visits)}</td>
                  </tr>
                ))}
                {!report?.topCustomers?.length && <tr><td colSpan={5} style={S.td}>No customers in the report period.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Settings({ users, onStatusChange, overview, services, onDataChanged }) {
  const [tab, setTab] = useState("accounts");
  const [siteAssets, setSiteAssets] = useState({});
  const [siteAssetsLoading, setSiteAssetsLoading] = useState(false);
  const [siteAssetsError, setSiteAssetsError] = useState("");
  const [siteAssetsNotice, setSiteAssetsNotice] = useState("");
  const [busyAsset, setBusyAsset] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [userStatusFilter, setUserStatusFilter] = useState("All");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({ name: "", email: "", password: "", role: "staff" });
  const [createUserError, setCreateUserError] = useState("");
  const [createUserLoading, setCreateUserLoading] = useState(false);
  const filteredUsers = users.filter((user) => {
    const query = userSearch.trim().toLowerCase();
    return (!query || user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))
      && (roleFilter === "All" || user.role === roleFilter.toLowerCase())
      && (userStatusFilter === "All" || (user.active ? "Active" : "Inactive") === userStatusFilter);
  });

  const loadSiteAssets = useCallback(async () => {
    setSiteAssetsLoading(true);
    setSiteAssetsError("");
    try {
      const result = await apiRequest("/site-assets");
      setSiteAssets(result.assets || {});
    } catch (requestError) {
      setSiteAssetsError(requestError.message);
    } finally {
      setSiteAssetsLoading(false);
    }
  }, []);

  useEffect(() => { loadSiteAssets(); }, [loadSiteAssets]);

  async function uploadAsset(key, event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setSiteAssetsError("Choose an image no larger than 10 MB.");
      return;
    }
    setBusyAsset(key);
    setSiteAssetsError("");
    setSiteAssetsNotice("");
    try {
      const result = await uploadSiteAsset(key, file);
      setSiteAssets((current) => ({ ...current, [key]: { updatedAt: result.updatedAt } }));
      setSiteAssetsNotice("Image uploaded. The change is now live on the website.");
    } catch (requestError) {
      setSiteAssetsError(requestError.message);
    } finally {
      setBusyAsset("");
    }
  }

  async function restoreAsset(key) {
    if (!window.confirm("Restore the built-in default image for this section?")) return;
    setBusyAsset(key);
    setSiteAssetsError("");
    setSiteAssetsNotice("");
    try {
      await removeSiteAsset(key);
      setSiteAssets((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setSiteAssetsNotice("Built-in default image restored.");
    } catch (requestError) {
      setSiteAssetsError(requestError.message);
    } finally {
      setBusyAsset("");
    }
  }

  async function createUser(event) {
    event.preventDefault();
    setCreateUserLoading(true);
    setCreateUserError("");
    try {
      await apiRequest("/users", {
        method: "POST",
        body: JSON.stringify(createUserForm),
      });
      setCreateUserForm({ name: "", email: "", password: "", role: "staff" });
      setShowCreateUser(false);
      onDataChanged();
    } catch (requestError) {
      setCreateUserError(requestError.message);
    } finally {
      setCreateUserLoading(false);
    }
  }

  return (
    <>
      <div style={S.tabBar}>
        {[["accounts","Accounts"],["userManagement","User Management"],["media","Site Media"],["system","System Data"]].map(([id, label]) => (
          <button key={id} style={S.tab(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "media" && (
        <div className="site-media-settings">
          <div className="site-media-heading">
            <div>
              <h2>Website images</h2>
              <p>Upload images to update the customer-facing website. JPEG, PNG, or WebP up to 10 MB.</p>
            </div>
            <button type="button" className="site-media-refresh" onClick={loadSiteAssets} disabled={siteAssetsLoading}>
              <i className={`bi ${siteAssetsLoading ? "bi-hourglass-split" : "bi-arrow-clockwise"}`} aria-hidden="true" />
              Refresh
            </button>
          </div>
          {siteAssetsError && <p className="site-media-message error" role="alert">{siteAssetsError}</p>}
          {siteAssetsNotice && <p className="site-media-message success" role="status">{siteAssetsNotice}</p>}
          {siteAssetsLoading && Object.keys(siteAssets).length === 0 ? (
            <p className="site-media-loading">Loading site images…</p>
          ) : SITE_MEDIA_GROUPS.map((group) => (
            <section className="site-media-group" key={group.title}>
              <div className="site-media-group-heading">
                <h3>{group.title}</h3>
                <p>{group.description}</p>
              </div>
              <div className="site-media-grid">
                {group.assets.map((asset) => (
                  <SiteAssetCard
                    key={asset.key}
                    asset={asset}
                    value={siteAssets[asset.key]}
                    busy={busyAsset === asset.key}
                    onUpload={uploadAsset}
                    onRemove={restoreAsset}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "accounts" && (
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>Personal account settings</span></div>
          <p>Manage your profile, security, and privacy preferences from the shared Profile Settings page.</p>
          <a className="user-primary-button" href="/user/profile-settings">Open Profile Settings</a>
        </div>
      )}

      {tab === "userManagement" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} style={{ ...S.searchInput, flex: "none", width: 280 }} placeholder="Search users..." />
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} style={S.selectInput} aria-label="Filter users by role">
                {["All", "Admin", "Staff", "Guest"].map((role) => <option key={role}>{role}</option>)}
              </select>
              <select value={userStatusFilter} onChange={(event) => setUserStatusFilter(event.target.value)} style={S.selectInput} aria-label="Filter users by status">
                {["All", "Active", "Inactive"].map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
            <button type="button" style={S.primaryBtn} onClick={() => { setShowCreateUser((current) => !current); setCreateUserError(""); }}>
              <i className="bi bi-person-plus" style={{ marginRight: 6 }} />{showCreateUser ? "Close" : "Add User"}
            </button>
          </div>

          {showCreateUser && (
            <form onSubmit={createUser} style={{ ...S.card, marginBottom: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}>
              <label style={S.settingField}><span style={S.settingLabel}>Name</span><input required maxLength={100} value={createUserForm.name} onChange={(event) => setCreateUserForm({ ...createUserForm, name: event.target.value })} style={S.settingInput} /></label>
              <label style={S.settingField}><span style={S.settingLabel}>Email</span><input required type="email" value={createUserForm.email} onChange={(event) => setCreateUserForm({ ...createUserForm, email: event.target.value })} style={S.settingInput} /></label>
              <label style={S.settingField}><span style={S.settingLabel}>Temporary password</span><PasswordInput id="new-user-temporary-password" required autoComplete="new-password" minLength={8} value={createUserForm.password} onChange={(event) => setCreateUserForm({ ...createUserForm, password: event.target.value })} style={S.settingInput} /></label>
              <label style={S.settingField}><span style={S.settingLabel}>Role</span><select value={createUserForm.role} onChange={(event) => setCreateUserForm({ ...createUserForm, role: event.target.value })} style={S.settingInput}><option value="staff">Staff</option><option value="admin">Admin</option><option value="guest">Guest</option></select></label>
              <button type="submit" disabled={createUserLoading} style={S.primaryBtn}>{createUserLoading ? "Creating…" : "Create User"}</button>
              {createUserError && <p role="alert" style={{ color: "#b42318", gridColumn: "1 / -1", margin: 0 }}>{createUserError}</p>}
            </form>
          )}

          <div style={S.card}>
            <table style={S.table}>
              <thead>
                <tr>{["User","Email","Role","Status","Login Access",""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filteredUsers.map((u, i) => {
                  const last = i === filteredUsers.length - 1;
                  const roleName = u.role.charAt(0).toUpperCase() + u.role.slice(1);
                  const status = u.active ? "Active" : "Inactive";
                  return (
                    <tr key={u.email}>
                      <td style={last ? S.tdLast : S.td}>
                        <div style={S.inlineUser}>
                          <div style={{ ...S.avatar, background: u.role === "admin" ? "#F97316" : "#FFF7ED", color: u.role === "admin" ? "#fff" : "#F97316" }}>{u.name.slice(0, 2).toUpperCase()}</div>
                          <span style={{ fontWeight: 600 }}>{u.name}</span>
                        </div>
                      </td>
                      <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF", fontSize: 13 }}>{u.email}</td>
                      <td style={last ? S.tdLast : S.td}>
                        <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 999, background: u.role === "admin" ? "#FFF7ED" : "#DBEAFE", color: u.role === "admin" ? "#F97316" : "#1D4ED8", border: u.role === "admin" ? "1px solid #FED7AA" : "none" }}>
                          {roleName}
                        </span>
                      </td>
                      <td style={last ? S.tdLast : S.td}>
                        <span style={{ display: "inline-block", fontSize: 11, fontWeight: 700, padding: "4px 12px", borderRadius: 999, background: u.active ? "#DCFCE7" : "#F3F4F6", color: u.active ? "#166534" : "#6B7280" }}>
                          {status}
                        </span>
                      </td>
                      <td style={{ ...(last ? S.tdLast : S.td), color: "#9CA3AF", fontSize: 13 }}>{u.loginEnabled ? "Enabled" : "No login (guest record)"}</td>
                      <td style={last ? S.tdLast : S.td}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => onStatusChange(u, !u.active)}
                            style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 8, border: "1px solid #FEE2E2", background: "#FFF5F5", color: "#DC2626", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                          >
                            <i className={`bi ${u.active ? "bi-person-dash" : "bi-person-check"}`} />
                            {u.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && <tr><td colSpan={6} style={S.td}>{users.length ? "No users match your filters." : "No user accounts found."}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "system" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
          <div style={S.card}>
            <div style={S.cardHeader}><span style={S.cardTitle}>Live System Data</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
              {[
                ["Reservations", overview?.reservations?.total ?? 0],
                ["Guest accounts", overview?.users?.guest ?? 0],
                ["Services", services.length],
                ["Uploaded documents", overview?.documents ?? 0],
                ["Collected", formatPeso(overview?.revenue?.collected)],
                ["Outstanding", formatPeso(overview?.revenue?.outstanding)],
              ].map(([label, value]) => (
                <div key={label} style={S.statMini}>
                  <div style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>{value}</div>
                </div>
              ))}
            </div>
            <p style={{ color: "#6B7280", fontSize: 13, margin: "16px 0 0" }}>This page reflects current database values and refreshes automatically. Business contact preferences are not configured in the system.</p>
          </div>
        </div>
      )}
    </>
  );
}

function AdminDocuments({ documents, loading, error, onDownload }) {
  return (
    <>
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>Uploaded reservation documents</span>
          <Badge label={`${documents.length} files`} />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={S.table}>
            <thead><tr>{["File","Reservation","Type","Size","Uploaded",""].map((heading) => <th key={heading} style={S.th}>{heading}</th>)}</tr></thead>
            <tbody>
              {documents.map((document, index) => (
                <tr key={document.id}>
                  <td style={index === documents.length - 1 ? S.tdLast : S.td}>{document.originalName}</td>
                  <td style={index === documents.length - 1 ? S.tdLast : S.td}>{document.reservation}</td>
                  <td style={index === documents.length - 1 ? S.tdLast : S.td}>{document.mimeType}</td>
                  <td style={index === documents.length - 1 ? S.tdLast : S.td}>{(document.size / 1024).toFixed(1)} KB</td>
                  <td style={index === documents.length - 1 ? S.tdLast : S.td}>{new Date(`${document.createdAt}Z`).toLocaleString("en-PH")}</td>
                  <td style={index === documents.length - 1 ? S.tdLast : S.td}>
                    <button type="button" style={S.smallBtn} onClick={() => onDownload(document)}>
                      <i className="bi bi-download" style={{ marginRight: 6 }} />Download
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && documents.length === 0 && <tr><td colSpan={6} style={S.td}>No documents have been uploaded.</td></tr>}
              {loading && <tr><td colSpan={6} style={S.td}>Loading documents…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function AdminMessages({ onChanged }) {
  const [threads, setThreads] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [reply, setReply] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [confirmingPaymentId, setConfirmingPaymentId] = useState(null);
  const [reviewingRequest, setReviewingRequest] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState("");

  async function loadThreads() {
    try {
      const result = await apiRequest("/messages");
      setThreads(result);
      setSelectedId((current) => result.some((thread) => thread.id === current) ? current : result[0]?.id || null);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadConversation(id) {
    if (!id) {
      setConversation(null);
      return;
    }
    try {
      setConversation(await apiRequest(`/messages/${id}`));
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => {
    loadThreads();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadThreads();
    }, 15000);
    const refreshOnFocus = () => loadThreads();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);
  useEffect(() => {
    loadConversation(selectedId);
    if (!selectedId) return undefined;
    const timer = setInterval(() => loadConversation(selectedId), 15000);
    return () => clearInterval(timer);
  }, [selectedId]);

  async function sendReply(event) {
    event.preventDefault();
    if (!reply.trim() || !selectedId) return;
    setSending(true);
    try {
      await apiRequest(`/messages/${selectedId}/replies`, {
        method: "POST",
        body: JSON.stringify({ body: reply }),
      });
      setReply("");
      await Promise.all([loadConversation(selectedId), loadThreads()]);
      onChanged?.();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(false);
    }
  }

  async function confirmPayment(attachment) {
    setConfirmingPaymentId(attachment.paymentId);
    try {
      await apiRequest(`/payments/${attachment.paymentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Paid" }),
      });
      await loadConversation(selectedId);
      await loadThreads();
      onChanged?.();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setConfirmingPaymentId(null);
    }
  }

  async function reviewChangeRequest(decision) {
    const changeRequest = conversation?.changeRequest;
    if (!changeRequest || changeRequest.status !== "Pending") return;
    const action = decision === "Approved" ? "approve" : "decline";
    const summary = changeRequest.type === "cancellation"
      ? `This will cancel reservation ${changeRequest.reservation.reference} and release the booking dates.`
      : `This will move reservation ${changeRequest.reservation.reference} to ${changeRequest.requestedCheckIn} – ${changeRequest.requestedCheckOut} and update its total to ₱${Number(changeRequest.requestedTotal).toLocaleString("en-PH")}.`;
    if (!window.confirm(`Are you sure you want to ${action} this ${changeRequest.type} request?\n\n${decision === "Approved" ? summary : "The reservation will remain unchanged."}`)) return;

    setReviewingRequest(true);
    try {
      await apiRequest(`/messages/${selectedId}/change-request`, {
        method: "PATCH",
        body: JSON.stringify({ decision, note: reviewNote }),
      });
      setReviewNote("");
      await Promise.all([loadConversation(selectedId), loadThreads()]);
      onChanged?.();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReviewingRequest(false);
    }
  }

  const filteredThreads = threads.filter((thread) =>
    [thread.guestName, thread.guestEmail, thread.subject, thread.lastMessage]
      .some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())),
  );

  return (
    <div className="admin-message-layout">
      <section className="admin-message-inbox">
        <div className="admin-message-inbox-header">
          <div>
            <h2>Messages</h2>
            <span>{threads.length} conversation{threads.length === 1 ? "" : "s"}</span>
          </div>
          <button type="button" onClick={loadThreads} aria-label="Refresh messages" title="Refresh messages" className="admin-message-refresh">
            <i className="bi bi-arrow-clockwise" aria-hidden="true" />
          </button>
        </div>
        <label className="admin-message-search">
          <i className="bi bi-search" aria-hidden="true" />
          <span className="visually-hidden">Search messages</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" />
        </label>
        <div className="admin-message-thread-list">
          {loading && <p className="admin-message-empty">Loading messages…</p>}
          {!loading && threads.length === 0 && <p className="admin-message-empty">No messages yet. Guest inquiries will appear here.</p>}
          {!loading && threads.length > 0 && filteredThreads.length === 0 && <p className="admin-message-empty">No conversations match your search.</p>}
          {filteredThreads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => {
                setSelectedId(thread.id);
                setReviewNote("");
                setError("");
              }}
              aria-current={selectedId === thread.id ? "true" : undefined}
              className={`admin-message-thread${selectedId === thread.id ? " is-active" : ""}`}
            >
              <span className="admin-message-avatar" aria-hidden="true">
                {(thread.guestName || thread.guestEmail || "G").trim().slice(0, 1).toUpperCase()}
              </span>
              <span className="admin-message-thread-copy">
                <span className="admin-message-thread-title">{thread.guestName || thread.guestEmail}</span>
                <span className="admin-message-thread-subject">{thread.subject}</span>
                <span className="admin-message-thread-preview">{thread.lastMessage || "No messages yet"}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="admin-message-conversation">
        {conversation ? (
          <>
            <header className="admin-message-conversation-header">
              <span className="admin-message-avatar admin-message-avatar-large" aria-hidden="true">
                {(conversation.guestName || conversation.guestEmail || "G").trim().slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2>{conversation.subject}</h2>
                <span>{conversation.guestName} · {conversation.guestEmail}</span>
              </div>
            </header>
            {conversation.changeRequest && (
              <section className="admin-change-request">
                <div className="admin-change-request-heading">
                  <div>
                    <span className={`admin-change-request-badge ${conversation.changeRequest.status.toLowerCase()}`}>
                      {conversation.changeRequest.status}
                    </span>
                    <h3>{conversation.changeRequest.type === "cancellation" ? "Cancellation request" : "Reschedule request"}</h3>
                  </div>
                  <span>Booking {conversation.changeRequest.reservation.reference}</span>
                </div>
                <div className="admin-change-request-details">
                  <div>
                    <span>Current stay</span>
                    <strong>
                      {conversation.changeRequest.reservation.checkIn}
                      {conversation.changeRequest.reservation.preferredTime ? ` · ${formatArrivalTime(conversation.changeRequest.reservation.preferredTime)}` : ""}
                      {" – "}{conversation.changeRequest.reservation.checkOut}
                      {conversation.changeRequest.reservation.checkOutTime ? ` · ${formatArrivalTime(conversation.changeRequest.reservation.checkOutTime)}` : ""}
                      {conversation.changeRequest.reservation.sameDayCheckout ? ` · ${conversation.changeRequest.reservation.durationMinutes / 60} hours` : ""}
                    </strong>
                  </div>
                  {conversation.changeRequest.type === "cancellation" ? (
                    <div>
                      <span>Reason</span>
                      <strong>{conversation.changeRequest.reason || "Not provided"}</strong>
                    </div>
                  ) : (
                    <>
                      <div>
                        <span>Requested stay</span>
                        <strong>
                          {conversation.changeRequest.requestedCheckIn}
                          {conversation.changeRequest.requestedPreferredTime ? ` · ${formatArrivalTime(conversation.changeRequest.requestedPreferredTime)}` : ""}
                          {" – "}{conversation.changeRequest.requestedCheckOut}
                          {conversation.changeRequest.requestedCheckOutTime ? ` · ${formatArrivalTime(conversation.changeRequest.requestedCheckOutTime)}` : ""}
                          {conversation.changeRequest.reservation.sameDayCheckout ? ` · ${conversation.changeRequest.reservation.durationMinutes / 60} hours` : ""}
                        </strong>
                      </div>
                      <div>
                        <span>Updated total</span>
                        <strong>₱{Number(conversation.changeRequest.requestedTotal).toLocaleString("en-PH")}</strong>
                      </div>
                    </>
                  )}
                </div>
                {conversation.changeRequest.note && (
                  <p className="admin-change-request-note"><strong>Customer note:</strong> {conversation.changeRequest.note}</p>
                )}
                {conversation.changeRequest.status === "Pending" && (
                  <div className="admin-change-request-actions">
                    <input
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      maxLength={1000}
                      placeholder="Optional note to the customer"
                      aria-label="Optional note to the customer"
                    />
                    <div>
                      <button type="button" className="decline" disabled={reviewingRequest} onClick={() => reviewChangeRequest("Declined")}>
                        Decline
                      </button>
                      <button type="button" className="approve" disabled={reviewingRequest} onClick={() => reviewChangeRequest("Approved")}>
                        {reviewingRequest ? "Saving…" : "Approve request"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
            <div className="admin-message-log" aria-live="polite" aria-label="Conversation messages">
              {conversation.messages.map((message) => {
                const fromGuest = message.senderRole === "guest";
                return (
                  <article key={message.id} className={`admin-message-bubble${fromGuest ? " from-guest" : " from-team"}`}>
                    <strong>{fromGuest ? conversation.guestName : message.senderName || "Villa Tjeozabel team"}</strong>
                    <div className="admin-message-body">{message.body}</div>
                    {fromGuest && message.attachments
                      ?.filter((attachment) => ["image/jpeg", "image/png", "image/webp"].includes(attachment.mimeType))
                      .map((attachment) => (
                      <MessageAttachment
                        key={attachment.id}
                        attachment={attachment}
                        onConfirmPayment={confirmPayment}
                        confirming={confirmingPaymentId === attachment.paymentId}
                      />
                    ))}
                    <time>
                      {new Date(message.createdAt.includes("T") ? message.createdAt : `${message.createdAt.replace(" ", "T")}Z`).toLocaleString("en-PH", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </time>
                  </article>
                );
              })}
            </div>
            <form className="admin-message-reply" onSubmit={sendReply}>
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} rows={3} required placeholder="Write a helpful reply…" aria-label="Reply to guest" />
              <div>
                <span>{reply.length}/5000</span>
                <button type="submit" disabled={sending || !reply.trim()}>
                  <i className={`bi ${sending ? "bi-hourglass-split" : "bi-send-fill"}`} aria-hidden="true" />
                  {sending ? "Sending…" : "Send reply"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="admin-message-placeholder">
            <span><i className="bi bi-chat-square-text" aria-hidden="true" /></span>
            <h2>Select a conversation</h2>
            <p>Choose a guest message to read the conversation and reply.</p>
          </div>
        )}
      </section>
      {error && <p className="admin-message-error" role="alert">{error}</p>}
    </div>
  );
}

export default function AdminDashboard() {
  const [active, setActive] = useState("overview");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [reservations, setReservations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [notifications, setNotifications] = useState({
    pendingCount: 0, pendingReservationsCount: 0, pendingPaymentsCount: 0, pendingMessagesCount: 0,
    reservations: [], payments: [], messages: [],
  });
  const [users, setUsers] = useState([]);
  const [overview, setOverview] = useState(null);
  const [report, setReport] = useState(null);
  const [services, setServices] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [reservationError, setReservationError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [notificationsError, setNotificationsError] = useState("");
  const [usersError, setUsersError] = useState("");
  const [overviewError, setOverviewError] = useState("");
  const [reportError, setReportError] = useState("");
  const [servicesError, setServicesError] = useState("");
  const [documentsError, setDocumentsError] = useState("");
  const [usersLoading, setUsersLoading] = useState(true);
  const [reservationsLoading, setReservationsLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [dashboardOffline, setDashboardOffline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [adminUser, setAdminUser] = useState(() => {
    try {
      return getSessionUser() || {};
    } catch {
      return {};
    }
  });
  const refreshRef = useRef(() => {});
  const notificationsRef = useRef(null);
  const profileMenuRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    let isCurrent = true;
    let requestInProgress = false;
    const refresh = async () => {
      if (requestInProgress) return;
      requestInProgress = true;
      if (isCurrent) setRefreshing(true);
      const results = await Promise.allSettled([
        apiRequest("/reservations?limit=500"),
        apiRequest("/payments"),
        apiRequest("/admin/notifications"),
        apiRequest("/users"),
        apiRequest("/admin/overview"),
        apiRequest("/services?includeInactive=true"),
        apiRequest("/reports"),
        apiRequest("/documents"),
        apiRequest("/auth/me"),
      ]);
      if (isCurrent) {
        const [reservationResult, paymentResult, notificationsResult, usersResult, overviewResult, servicesResult, reportResult, documentsResult, profileResult] = results;
        setDashboardOffline(results.some((result) => result.status === "rejected"));
        if (profileResult.status === "fulfilled" && profileResult.value?.user?.role === "admin") {
          setAdminUser(profileResult.value.user);
          saveSessionUser(profileResult.value.user);
        }
        const applyList = (result, setData, setError, label, map = (value) => value) => {
          if (result.status === "fulfilled" && Array.isArray(result.value)) {
            setData(result.value.map(map));
            setError("");
          } else {
            setError(result.status === "rejected" ? result.reason.message : `The ${label} response was not a list.`);
          }
        };
        applyList(reservationResult, setReservations, setReservationError, "reservations", toDashboardReservation);
        applyList(paymentResult, setPayments, setPaymentError, "payments");
        if (notificationsResult.status === "fulfilled"
          && notificationsResult.value
          && Array.isArray(notificationsResult.value.reservations)
          && Array.isArray(notificationsResult.value.payments)
          && Array.isArray(notificationsResult.value.messages)
          && Number.isInteger(notificationsResult.value.pendingCount)
          && Number.isInteger(notificationsResult.value.pendingReservationsCount)
          && Number.isInteger(notificationsResult.value.pendingPaymentsCount)
          && Number.isInteger(notificationsResult.value.pendingMessagesCount)) {
          setNotifications({
            pendingCount: notificationsResult.value.pendingCount,
            pendingReservationsCount: notificationsResult.value.pendingReservationsCount,
            pendingPaymentsCount: notificationsResult.value.pendingPaymentsCount,
            pendingMessagesCount: notificationsResult.value.pendingMessagesCount,
            reservations: notificationsResult.value.reservations.map(toDashboardReservation),
            payments: notificationsResult.value.payments,
            messages: notificationsResult.value.messages,
          });
          setNotificationsError("");
        } else {
          setNotificationsError(notificationsResult.status === "rejected"
            ? notificationsResult.reason.message
            : "The notifications response was invalid.");
        }
        applyList(usersResult, setUsers, setUsersError, "users");
        applyList(servicesResult, setServices, setServicesError, "services");
        applyList(documentsResult, setDocuments, setDocumentsError, "documents");
        if (overviewResult.status === "fulfilled") {
          setOverview(overviewResult.value);
          setOverviewError("");
        } else {
          setOverviewError(overviewResult.reason.message);
        }
        if (reportResult.status === "fulfilled") {
          setReport(reportResult.value);
          setReportError("");
        } else {
          setReportError(reportResult.reason.message);
        }
        setLastUpdated(new Date());
        setPaymentsLoading(false);
        setReservationsLoading(false);
        setUsersLoading(false);
        setServicesLoading(false);
        setDocumentsLoading(false);
        setRefreshing(false);
      }
      requestInProgress = false;
    };
    refreshRef.current = refresh;
    refresh();
    const timer = setInterval(() => {
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
      clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

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

  async function updateReservationStatus(reservation, status) {
    try {
      await apiRequest(`/reservations/${reservation.reservationId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setReservations((current) => current.map((item) => item.reservationId === reservation.reservationId ? { ...item, status } : item));
      setReservationError("");
      refreshRef.current();
    } catch (error) {
      setReservationError(error.message);
    }
  }

  async function updatePaymentStatus(payment, status) {
    try {
      const updated = await apiRequest(`/payments/${payment.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setPayments((current) => current.map((item) => item.id === payment.id ? updated : item));
      setPaymentError("");
      refreshRef.current();
    } catch (error) {
      setPaymentError(error.message);
    }
  }

  async function updateUserStatus(user, active) {
    try {
      const updated = await apiRequest(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      setUsers((current) => current.map((item) => item.id === user.id ? updated : item));
      setUsersError("");
      refreshRef.current();
    } catch (error) {
      setUsersError(error.message);
    }
  }

  async function handleDocumentDownload(file) {
    try {
      const blob = await downloadDocument(file.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.originalName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDocumentsError("");
    } catch (error) {
      setDocumentsError(error.message);
    }
  }

  const handleLogout = async () => {
    if (!window.confirm("Are you sure you want to log out?")) return;
    try {
      await logoutSession();
      navigate("/login");
    } catch (error) {
      window.alert(error.message);
    }
  };

  function openProfileSettings() {
    setProfileMenuOpen(false);
    navigate("/user/profile-settings");
  }

  const panels = {
    overview: <Overview reservations={reservations} overview={overview} report={report} />,
    reservations: <Reservations reservations={reservations} services={services} loading={reservationsLoading} error={reservationError} onStatusChange={updateReservationStatus} />,
    transactions: <Transactions payments={payments} loading={paymentsLoading} error={paymentError} onStatusChange={updatePaymentStatus} />,
    messages: <AdminMessages onChanged={() => refreshRef.current()} />,
    customers: <Customers users={users.filter((user) => user.role === "guest")} loading={usersLoading} error={usersError} />,
    documents: <AdminDocuments documents={documents} loading={documentsLoading} error={documentsError} onDownload={handleDocumentDownload} />,
    rooms: <Services inventoryType="room" onViewBookings={() => setActive("reservations")} />,
    services: <Services inventoryType="service" onViewBookings={() => setActive("reservations")} />,
    reports: <Reports />,
    settings: <Settings
      users={users}
      onStatusChange={updateUserStatus}
      overview={overview}
      services={services}
      onDataChanged={() => refreshRef.current()}
    />,
  };
  const sections = ["Main", "Management", "Analytics"];
  const {
    pendingCount, pendingReservationsCount, pendingPaymentsCount, pendingMessagesCount,
    reservations: pendingReservations, payments: pendingPayments, messages: pendingMessages,
  } = notifications;
  const openNotificationsTab = (tab) => {
    setActive(tab);
    setNotificationsOpen(false);
  };
  return (
    <div className="admin-dashboard-shell" style={S.shell}>
      <aside className="admin-dashboard-sidebar" style={S.sidebar}>
        <div style={S.logoBox}>
          <div style={S.logoDot} />
          <div>
            <p style={S.logoTitle}>Villa Tjeozabel</p>
            <p style={S.logoSub}>Admin Dashboard</p>
          </div>
        </div>

        <nav style={{ flex: 1 }}>
          {sections.map(section => (
            <div key={section}>
              <div style={S.navSection}>{section}</div>
              {NAV.filter(n => n.section === section).map(n => (
                <button key={n.id} style={S.navItem(active === n.id)} onClick={() => setActive(n.id)}>
                  <i className={`bi ${n.icon}`} style={{ fontSize: 17 }} />
                  {n.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

      </aside>

      <div className="admin-dashboard-main" style={S.main}>
        <div className="admin-dashboard-topbar" style={S.topbar}>
          <span style={S.topbarTitle}>{NAV.find(n => n.id === active)?.label}</span>
          <div style={S.topbarRight}>
            <span aria-live="polite" style={{ fontSize: 11, color: refreshing ? "#9CA3AF" : "#15803D", whiteSpace: "nowrap" }}>
              {refreshing ? "Updating…" : dashboardOffline ? "Connection issue · retrying" : `Live · ${lastUpdated?.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) || "Waiting"}`}
            </span>
            <button type="button" aria-label="Refresh dashboard now" title="Refresh dashboard now" onClick={() => refreshRef.current()} disabled={refreshing} style={{ ...S.notifBtn, opacity: refreshing ? 0.6 : 1 }}>
              <i className={`bi ${refreshing ? "bi-arrow-repeat" : "bi-arrow-clockwise"}`} style={{ fontSize: 18, color: "#374151" }} />
            </button>
            <div ref={notificationsRef} style={{ position: "relative" }}>
              <button
                type="button"
                aria-label={`${pendingCount} pending notifications`}
                aria-expanded={notificationsOpen}
                aria-haspopup="dialog"
                aria-controls="admin-notifications"
                onClick={() => setNotificationsOpen((open) => !open)}
                style={S.notifBtn}
              >
                <i className="bi bi-bell" style={{ fontSize: 18, color: "#374151" }} />
                {pendingCount > 0 && <span style={S.notifBadge}>{pendingCount > 99 ? "99+" : pendingCount}</span>}
              </button>
              {notificationsOpen && (
                <section
                  id="admin-notifications"
                  role="dialog"
                  aria-label="Pending notifications"
                  style={{
                    position: "absolute",
                    zIndex: 20,
                    top: 56,
                    right: 0,
                    width: 360,
                    maxWidth: "calc(100vw - 32px)",
                    maxHeight: "min(70vh, 520px)",
                    overflowY: "auto",
                    background: "#fff",
                    border: "1px solid #FED7AA",
                    borderRadius: 16,
                    boxShadow: "0 12px 32px rgba(31,41,55,0.16)",
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <strong style={{ color: "#111827", fontSize: 15 }}>Pending notifications</strong>
                    <span style={{ color: "#6B7280", fontSize: 12 }}>{pendingCount} total</span>
                  </div>
                  {notificationsError && (
                    <p role="alert" style={{ color: "#b42318", fontSize: 12, marginBottom: 8 }}>
                      Notifications could not be loaded. {notificationsError}
                    </p>
                  )}
                  {pendingReservations.length === 0 && pendingPayments.length === 0 && pendingMessages.length === 0 && pendingCount === 0 && !notificationsError ? (
                    <p style={{ color: "#6B7280", fontSize: 13, padding: "12px 0" }}>You’re all caught up.</p>
                  ) : pendingReservations.length === 0 && pendingPayments.length === 0 && pendingMessages.length === 0 ? (
                    <div style={{ padding: "8px 0" }}>
                      <p style={{ color: "#6B7280", fontSize: 13, marginBottom: 8 }}>Pending items could not be listed.</p>
                      <button type="button" onClick={() => refreshRef.current()} style={{ border: 0, background: "transparent", color: "#EA580C", fontSize: 12, fontWeight: 700, padding: 0, cursor: "pointer" }}>
                        Retry
                      </button>
                    </div>
                  ) : (
                    <>
                      {pendingReservations.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <p style={{ color: "#9CA3AF", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>
                            RESERVATIONS ({pendingReservationsCount})
                          </p>
                          {pendingReservations.slice(0, 5).map((reservation) => (
                            <button
                              key={reservation.reservationId}
                              type="button"
                              onClick={() => openNotificationsTab("reservations")}
                              style={{ display: "block", width: "100%", border: 0, borderRadius: 8, background: "transparent", padding: "9px 8px", textAlign: "left", cursor: "pointer" }}
                            >
                              <span style={{ display: "block", color: "#111827", fontSize: 13, fontWeight: 600 }}>
                                {reservation.customer} · {reservation.id}
                              </span>
                              <span style={{ display: "block", color: "#6B7280", fontSize: 12 }}>
                                {reservation.room} · Check-in {reservation.checkin}{reservation.preferredTime ? ` at ${formatArrivalTime(reservation.preferredTime)}` : ""}{reservation.checkout ? ` · Check-out ${reservation.checkout}` : ""}
                              </span>
                            </button>
                          ))}
                          <button type="button" onClick={() => openNotificationsTab("reservations")} style={{ border: 0, background: "transparent", color: "#EA580C", fontSize: 12, fontWeight: 700, padding: "6px 8px", cursor: "pointer" }}>
                            View reservations
                          </button>
                        </div>
                      )}
                      {pendingReservations.length > 5 && (
                        <p style={{ color: "#6B7280", fontSize: 12, padding: "4px 8px" }}>
                          Showing 5 of {pendingReservations.length} listed reservations ({pendingReservationsCount} awaiting customer arrival).
                        </p>
                      )}
                      {pendingPayments.length > 0 && (
                        <div>
                          <p style={{ color: "#9CA3AF", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>
                            PAYMENTS ({pendingPaymentsCount})
                          </p>
                          {pendingPayments.slice(0, 5).map((payment) => (
                            <button
                              key={payment.id}
                              type="button"
                              onClick={() => openNotificationsTab("transactions")}
                              style={{ display: "block", width: "100%", border: 0, borderRadius: 8, background: "transparent", padding: "9px 8px", textAlign: "left", cursor: "pointer" }}
                            >
                              <span style={{ display: "block", color: "#111827", fontSize: 13, fontWeight: 600 }}>
                                {payment.guestName} · {payment.reservation}
                              </span>
                              <span style={{ display: "block", color: "#6B7280", fontSize: 12 }}>
                                {payment.method} · ₱{Number(payment.amount).toLocaleString("en-PH")}
                              </span>
                            </button>
                          ))}
                          <button type="button" onClick={() => openNotificationsTab("transactions")} style={{ border: 0, background: "transparent", color: "#EA580C", fontSize: 12, fontWeight: 700, padding: "6px 8px", cursor: "pointer" }}>
                            View payments
                          </button>
                        </div>
                      )}
                      {pendingPayments.length > 5 && (
                        <p style={{ color: "#6B7280", fontSize: 12, padding: "4px 8px" }}>
                          Showing 5 of {pendingPayments.length} listed payments ({pendingPaymentsCount} pending).
                        </p>
                      )}
                      {pendingMessages.length > 0 && (
                        <div>
                          <p style={{ color: "#9CA3AF", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 6 }}>
                            MESSAGES ({pendingMessagesCount})
                          </p>
                          {pendingMessages.slice(0, 5).map((message) => (
                            <button
                              key={message.id}
                              type="button"
                              onClick={() => openNotificationsTab("messages")}
                              style={{ display: "block", width: "100%", border: 0, borderRadius: 8, background: "transparent", padding: "9px 8px", textAlign: "left", cursor: "pointer" }}
                            >
                              <span style={{ display: "block", color: "#111827", fontSize: 13, fontWeight: 600 }}>
                                {message.guestName} · {message.subject}
                              </span>
                              <span style={{ display: "block", color: "#6B7280", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {message.lastMessage}
                              </span>
                            </button>
                          ))}
                          <button type="button" onClick={() => openNotificationsTab("messages")} style={{ border: 0, background: "transparent", color: "#EA580C", fontSize: 12, fontWeight: 700, padding: "6px 8px", cursor: "pointer" }}>
                            View messages
                          </button>
                        </div>
                      )}
                      {pendingMessages.length > 5 && (
                        <p style={{ color: "#6B7280", fontSize: 12, padding: "4px 8px" }}>
                          Showing 5 of {pendingMessages.length} listed messages ({pendingMessagesCount} awaiting a reply).
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}
            </div>
            <div ref={profileMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                aria-label="Open admin profile options"
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                onClick={() => setProfileMenuOpen((open) => !open)}
                style={{ ...S.profileBox, cursor: "pointer", fontFamily: "'Inter', sans-serif", textAlign: "left" }}
              >
                {adminUser.profileImage ? (
                  <img
                    src={adminProfilePictureUrl(adminUser.profileImage)}
                    alt=""
                    style={{ ...S.profileAvatar, objectFit: "cover" }}
                  />
                ) : (
                  <div style={S.profileAvatar}>{String(adminUser.name || "Admin").slice(0, 2).toUpperCase()}</div>
                )}
                <span>
                  <span style={{ ...S.profileName, display: "block" }}>{adminUser.name || "Administrator"}</span>
                  <span style={S.profileRole}>Admin</span>
                </span>
                <i className="bi bi-chevron-down" aria-hidden="true" style={{ color: "#9CA3AF", fontSize: 12 }} />
              </button>
              {profileMenuOpen && (
                <div role="menu" aria-label="Admin profile options" style={{ position: "absolute", zIndex: 30, top: "calc(100% + 8px)", right: 0, minWidth: 180, padding: 6, background: "#fff", border: "1px solid #FED7AA", borderRadius: 12, boxShadow: "0 10px 28px rgba(31,41,55,0.14)" }}>
                  <button type="button" role="menuitem" onClick={openProfileSettings} style={{ display: "block", width: "100%", padding: "10px 12px", border: 0, borderRadius: 8, background: "transparent", color: "#374151", textAlign: "left", cursor: "pointer", fontSize: 14 }}>Profile Settings</button>
                  <button type="button" role="menuitem" onClick={() => { setProfileMenuOpen(false); handleLogout(); }} style={{ display: "block", width: "100%", padding: "10px 12px", border: 0, borderRadius: 8, background: "transparent", color: "#C2410C", textAlign: "left", cursor: "pointer", fontSize: 14 }}>Log out</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="admin-dashboard-content" style={S.content}>
          {reservationError && <p role="alert" style={{ color: "#b42318" }}>{reservationError}</p>}
          {overviewError && active === "overview" && <p role="alert" style={{ color: "#b42318" }}>{overviewError}</p>}
          {reportError && active === "overview" && <p role="alert" style={{ color: "#b42318" }}>{reportError}</p>}
          {active === "settings" && usersError && <p role="alert" style={{ color: "#b42318" }}>{usersError}</p>}
          {panels[active]}
        </div>
      </div>
    </div>
  );
}
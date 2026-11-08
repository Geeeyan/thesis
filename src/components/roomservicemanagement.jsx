import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, fetchListingPhoto, toDashboardReservation } from "../api";
import ListingPhotoManager from "./listingphotomanager";
import { can } from "../permissions";

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function priceUnit(service) {
  if (service.sameDayCheckout) return `${service.durationMinutes / 60} hours`;
  if (service.pricingMode === "guest") return "guest";
  if (service.pricingMode === "night") return "night";
  return service.unit === "stay" ? "stay" : "booking";
}

const statusColors = {
  Available: { background: "#DCFCE7", color: "#166534" },
  "Partially booked": { background: "#FFEDD5", color: "#C2410C" },
  "Fully booked": { background: "#FEE2E2", color: "#991B1B" },
  Inactive: { background: "#F3F4F6", color: "#6B7280" },
};

const defaultForm = {
  code: "",
  name: "",
  description: "",
  inventoryType: "room",
  price: "",
  unit: "night",
  pricingMode: "night",
  durationMinutes: 0,
  sameDayCheckout: false,
  capacity: 2,
  quantity: 1,
  active: true,
};

const fieldStyle = {
  display: "grid",
  gap: 6,
  color: "#6B7280",
  fontSize: 13,
  fontWeight: 600,
};
const inputStyle = {
  width: "100%",
  minHeight: 42,
  padding: "9px 12px",
  border: "1px solid #FED7AA",
  borderRadius: 10,
  color: "#111827",
  background: "#fff",
  font: "inherit",
  boxSizing: "border-box",
};
const buttonStyle = {
  border: "1px solid #FED7AA",
  borderRadius: 10,
  background: "#fff",
  color: "#374151",
  padding: "9px 14px",
  fontWeight: 700,
  cursor: "pointer",
};
const primaryButtonStyle = { ...buttonStyle, borderColor: "#F97316", background: "#F97316", color: "#fff" };

function Dialog({ title, children, onClose, footer }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector("button, input, select, textarea")?.focus();
    function closeOnEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus?.();
    };
  }, []);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(17,24,39,.45)", display: "grid", placeItems: "center", padding: 16 }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-service-dialog-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = [...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
          if (!controls.length) return;
          if (event.shiftKey && document.activeElement === controls[0]) {
            event.preventDefault();
            controls.at(-1).focus();
          } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
            event.preventDefault();
            controls[0].focus();
          }
        }}
        style={{ width: "min(680px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "#fff", border: "1px solid #FED7AA", borderRadius: 18, padding: 24, boxShadow: "0 16px 48px rgba(31,41,55,.2)" }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <h2 id="room-service-dialog-title" style={{ margin: 0, color: "#111827", fontSize: 20 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" style={buttonStyle}>Close</button>
        </header>
        {children}
        {footer && <footer style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>{footer}</footer>}
      </section>
    </div>
  );
}

export default function RoomServiceManagement({ inventoryType, onViewBookings }) {
  const [date, setDate] = useState("");
  const [serverToday, setServerToday] = useState("");
  const [services, setServices] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [sortBy, setSortBy] = useState("name");
  const [minimumPrice, setMinimumPrice] = useState("");
  const [maximumPrice, setMaximumPrice] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [dialog, setDialog] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [bookingConflicts, setBookingConflicts] = useState([]);
  const isAdmin = can(permissions, "services.update");
  const permissionScope = inventoryType === "service" ? "services" : "rooms";
  const isRoomPage = inventoryType === "room";
  const pageTitle = inventoryType === "room" ? "Rooms" : inventoryType === "service" ? "Services" : "Rooms and Services";
  const itemLabel = inventoryType === "service" ? "service" : inventoryType === "room" ? "room" : "room or service";

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (inventoryType) params.set("type", inventoryType);
      const query = params.toString();
      const result = await apiRequest(`/services/management${query ? `?${query}` : ""}`);
      if (!date) setDate(result.date);
      setServerToday(result.today);
      setServices(result.services);
      setPermissions(result.permissions);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [date, inventoryType]);

  useEffect(() => { loadServices(); }, [loadServices]);

  const filteredServices = useMemo(() => services.filter((service) => {
    const matchesSearch = `${service.name} ${service.code} ${service.description}`.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStatus = statusFilter === "All statuses" || service.availability.status === statusFilter;
    const timed = Boolean(service.sameDayCheckout || service.durationMinutes > 0);
    const matchesType = typeFilter === "All types"
      || (typeFilter === "Timed services" ? timed : !timed);
    const matchesMinimum = minimumPrice === "" || service.price >= Number(minimumPrice);
    const matchesMaximum = maximumPrice === "" || service.price <= Number(maximumPrice);
    return matchesSearch && matchesStatus && matchesType && matchesMinimum && matchesMaximum;
  }).sort((left, right) => sortBy === "price"
    ? left.price - right.price || left.name.localeCompare(right.name)
    : left.name.localeCompare(right.name)), [services, search, statusFilter, typeFilter, minimumPrice, maximumPrice, sortBy]);

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredServices.length / pageSize));
  const visibleServices = useMemo(
    () => filteredServices.slice((page - 1) * pageSize, page * pageSize),
    [filteredServices, page],
  );
  const [thumbnails, setThumbnails] = useState({});
  const [photoError, setPhotoError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const objectUrls = [];
    Promise.all(visibleServices.map(async (service) => {
      if (!service.thumbnailPhotoId) return [service.code, null];
      const url = await fetchListingPhoto(service.code, service.thumbnailPhotoId, "thumbnail");
      objectUrls.push(url);
      return [service.code, url];
    })).then((entries) => {
      if (cancelled) {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      setThumbnails(Object.fromEntries(entries));
      setPhotoError("");
    }).catch((requestError) => {
      if (!cancelled) setPhotoError(requestError.message);
    });
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [visibleServices]);
  const counts = useMemo(() => ({
    total: services.length,
    available: services.filter((service) => service.availability.status === "Available").length,
    fullyBooked: services.filter((service) => service.availability.status === "Fully booked").length,
    inactive: services.filter((service) => service.availability.status === "Inactive").length,
  }), [services]);
  useEffect(() => { setPage(1); }, [date, search, statusFilter, typeFilter, minimumPrice, maximumPrice, sortBy, inventoryType]);

  async function openDetails(service) {
    setSelected(service);
    setDialog("details");
    setBookings([]);
    try {
      const query = new URLSearchParams({ room: service.code, from: date, to: date, limit: "500" });
      const [details, reservations] = await Promise.all([
        apiRequest(`/services/${encodeURIComponent(service.code)}?date=${encodeURIComponent(date)}`),
        apiRequest(`/reservations?${query}`),
      ]);
      setSelected(details.service);
      setBookings(reservations.map(toDashboardReservation));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  function openCreate() {
    setForm({ ...defaultForm, inventoryType: inventoryType || "room", category: "room" });
    setSelected(null);
    setMessage("");
    setError("");
    setDirty(false);
    setDialog("form");
  }

  function openEdit(service) {
    setSelected(service);
    setMessage("");
    setForm({
      code: service.code,
      name: service.name,
      description: service.description || "",
      inventoryType: service.inventoryType,
      price: service.price,
      unit: service.unit,
      pricingMode: service.pricingMode,
      durationMinutes: service.durationMinutes || 0,
      sameDayCheckout: service.sameDayCheckout,
      capacity: service.capacity,
      quantity: service.quantity,
      active: service.active,
    });
    setError("");
    setDirty(false);
    setDialog("form");
  }

  async function saveService(event) {
    event.preventDefault();
    const durationMinutes = Number(form.durationMinutes);
    const timedSettingsChanged = !selected
      || durationMinutes !== selected.durationMinutes
      || form.sameDayCheckout !== selected.sameDayCheckout;
    if ((timedSettingsChanged && durationMinutes > 0 && !form.sameDayCheckout)
      || (form.sameDayCheckout && durationMinutes === 0)) {
      setError("Set a duration and enable same-day timed booking to offer time slots.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        category: "room",
        price: Number(form.price),
        durationMinutes: Number(form.durationMinutes),
        capacity: Number(form.capacity),
        quantity: Number(form.quantity),
      };
      if (selected) {
        const { code, category, ...updates } = payload;
        await apiRequest(`/services/${encodeURIComponent(selected.code)}`, { method: "PATCH", body: JSON.stringify(updates) });
      } else {
        const { active, ...newService } = payload;
        await apiRequest("/services", { method: "POST", body: JSON.stringify(newService) });
      }
      setDialog("");
      setDirty(false);
      setMessage(selected ? "Room or service updated." : "Room or service added.");
      await loadServices();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(service) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/services/${encodeURIComponent(service.code)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !service.active }),
      });
      setMessage(`${service.name} ${service.active ? "deactivated" : "activated"}.`);
      await loadServices();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteService() {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/services/${encodeURIComponent(selected.code)}`, { method: "DELETE" });
      setMessage(`${selected.name} deleted and retained as inactive to preserve booking history.`);
      setSelected(null);
      setDialog("");
      await loadServices();
    } catch (requestError) {
      setError(requestError.message);
      setBookingConflicts(requestError.details?.bookings || []);
    } finally {
      setBusy(false);
    }
  }

  const closeDialog = useCallback(() => {
    if (busy) return;
    if (dialog === "form" && dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDialog("");
    setDirty(false);
  }, [busy, dialog, dirty]);

  return (
    <section aria-label={`${pageTitle} management`}>
      <header style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: "0 0 5px", color: "#111827", fontSize: 20 }}>{pageTitle}</h2>
          <p style={{ margin: 0, color: "#6B7280", fontSize: 13 }}>Inventory and booking availability for a selected date.</p>
        </div>
        {isAdmin
          ? <button type="button" style={primaryButtonStyle} onClick={openCreate}>Add {itemLabel}</button>
          : <span aria-label="View only access" style={{ border: "1px solid #FED7AA", borderRadius: 999, color: "#C2410C", background: "#FFF7ED", padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>View only</span>}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
        {[["Total", counts.total], ["Available", counts.available], ["Fully booked", counts.fullyBooked], ["Inactive", counts.inactive]].map(([label, count]) => (
          <article key={label} style={{ background: "#fff", border: "1px solid #FED7AA", borderRadius: 14, padding: "12px 16px" }}>
            <p style={{ margin: 0, color: "#6B7280", fontSize: 12 }}>{label}</p>
            <strong style={{ color: "#111827", fontSize: 20 }}>{count}</strong>
          </article>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 18 }}>
        <label style={fieldStyle}>Availability date
          <input type="date" value={date} min={serverToday || localDate()} onChange={(event) => setDate(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>Search
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search rooms and services" style={inputStyle} />
        </label>
        <label style={fieldStyle}>Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
            {["All statuses", "Available", "Partially booked", "Fully booked", "Inactive"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>Type
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={inputStyle}>
            {["All types", "Timed services", "Overnight or stay"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>Minimum price
          <input type="number" min="0" value={minimumPrice} onChange={(event) => setMinimumPrice(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>Maximum price
          <input type="number" min="0" value={maximumPrice} onChange={(event) => setMaximumPrice(event.target.value)} style={inputStyle} />
        </label>
        <label style={fieldStyle}>Sort by
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} style={inputStyle}>
            <option value="name">Name</option><option value="price">Price</option>
          </select>
        </label>
      </div>

      {message && <p role="status" style={{ color: "#166534" }}>{message}</p>}
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
      {photoError && <p role="alert" style={{ color: "#b42318" }}>{photoError}</p>}
      {loading && <p role="status" style={{ color: "#6B7280" }}>Loading rooms and services…</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 }}>
        {visibleServices.map((service) => {
          const badge = statusColors[service.availability.status] || statusColors.Available;
          return (
            <article key={service.code} style={{ background: "#fff", border: "1px solid #FED7AA", borderRadius: 18, padding: 18, boxShadow: "0 4px 16px rgba(249,115,22,.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {thumbnails[service.code]
                    ? <img src={thumbnails[service.code]} alt="" style={{ width: 64, height: 56, objectFit: "cover", borderRadius: 10, border: "1px solid #FED7AA" }} />
                    : <div aria-hidden="true" style={{ width: 64, height: 56, display: "grid", placeItems: "center", color: "#C2410C", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10 }}><i className="bi bi-image" /></div>}
                  <div>
                  <h3 style={{ margin: "0 0 4px", color: "#111827", fontSize: 16 }}>{service.name}</h3>
                  <p style={{ margin: 0, color: "#6B7280", fontSize: 12 }}>{service.inventoryType === "service" ? "Service" : "Room"} · {service.sameDayCheckout ? `${service.durationMinutes / 60} hours` : service.pricingMode}</p>
                  </div>
                </div>
                <span style={{ whiteSpace: "nowrap", borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 700, ...badge }}>{service.availability.status}</span>
              </div>
              <p style={{ margin: "14px 0", color: "#6B7280", fontSize: 13 }}>{service.description || "No description provided."}</p>
              {service.retired && <p style={{ margin: "0 0 12px", color: "#6B7280", fontSize: 12 }}>Retired inventory retained for booking history. Editing is disabled.</p>}
              <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "7px 12px", margin: "0 0 14px", fontSize: 13 }}>
                <dt style={{ color: "#6B7280" }}>Capacity</dt><dd style={{ margin: 0, fontWeight: 700 }}>{service.capacity} guests</dd>
                <dt style={{ color: "#6B7280" }}>Price</dt><dd style={{ margin: 0, fontWeight: 700 }}>₱{Number(service.price).toLocaleString("en-PH")} / {priceUnit(service)}</dd>
                {service.durationMinutes > 0 && <><dt style={{ color: "#6B7280" }}>Duration</dt><dd style={{ margin: 0, fontWeight: 700 }}>{service.durationMinutes / 60} hours</dd></>}
                <dt style={{ color: "#6B7280" }}>Availability on {date}</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>{service.availability.availableUnits}/{service.availability.totalUnits} units</dd>
              </dl>
              {service.availability.slots.length > 0 && (
                <div aria-label="Time slot availability" style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
                  {service.availability.slots.map((slot) => (
                    <span key={slot.value} title={`${slot.label}: ${slot.available ? "Free" : "Taken"}`} style={{ borderRadius: 999, padding: "3px 7px", fontSize: 10, fontWeight: 700, background: slot.available ? "#DCFCE7" : "#FEE2E2", color: slot.available ? "#166534" : "#991B1B" }}>
                      {slot.label} {slot.available ? "Free" : "Taken"}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" style={buttonStyle} onClick={() => openDetails(service)}>View details</button>
                {can(permissions, `${permissionScope}.update`) && !service.retired && (
                  <button type="button" style={buttonStyle} onClick={() => openEdit(service)}>Edit</button>
                )}
                {can(permissions, `${permissionScope}.update`) && !service.retired && (
                  <button type="button" style={buttonStyle} disabled={busy} onClick={() => toggleActive(service)}>
                    {service.active ? "Deactivate" : "Activate"}
                  </button>
                )}
                {can(permissions, `${permissionScope}.delete`) && !service.retired && (
                  <button type="button" style={{ ...buttonStyle, color: "#991B1B" }} disabled={busy} onClick={() => { setSelected(service); setError(""); setBookingConflicts([]); setDialog("delete"); }}>
                    Delete
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!loading && !error && services.length === 0 && isAdmin && (
        <div style={{ textAlign: "center", padding: 28, color: "#6B7280" }}>
          <p>{isRoomPage ? "No rooms yet." : inventoryType === "service" ? "No services yet." : "No rooms or services yet."}</p>
          <button type="button" style={primaryButtonStyle} onClick={openCreate}>Add {itemLabel}</button>
        </div>
      )}
      {!loading && !error && services.length > 0 && filteredServices.length === 0 && <p style={{ color: "#6B7280" }}>No {itemLabel} match these filters.</p>}
      {!loading && filteredServices.length > pageSize && (
        <nav aria-label={`${pageTitle} pages`} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 18 }}>
          <button type="button" style={buttonStyle} disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span aria-live="polite">Page {page} of {pageCount}</span>
          <button type="button" style={buttonStyle} disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
        </nav>
      )}

      {dialog === "details" && selected && (
        <Dialog title={selected.name} onClose={closeDialog}>
          <p style={{ color: "#6B7280", marginTop: 0 }}>{selected.description || "No description provided."}</p>
          <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, color: "#374151" }}>
            <div><dt style={{ color: "#6B7280" }}>Type</dt><dd>{selected.inventoryType === "service" ? "Service" : "Room"} · {selected.sameDayCheckout ? `${selected.durationMinutes / 60}-hour booking` : selected.pricingMode}</dd></div>
            <div><dt style={{ color: "#6B7280" }}>Capacity</dt><dd>{selected.capacity} guests</dd></div>
            <div><dt style={{ color: "#6B7280" }}>Price</dt><dd>₱{Number(selected.price).toLocaleString("en-PH")} / {priceUnit(selected)}</dd></div>
            <div><dt style={{ color: "#6B7280" }}>Availability</dt><dd>{selected.availability.status} · {selected.availability.availableUnits}/{selected.availability.totalUnits} units on {date}</dd></div>
          </dl>
          {selected.availability.slots.length > 0 && (
            <div>
              <h3 style={{ color: "#111827", fontSize: 15 }}>Time slots</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {selected.availability.slots.map((slot) => (
                  <span key={slot.value} style={{ ...buttonStyle, cursor: "default", background: slot.available ? "#DCFCE7" : "#FEE2E2", color: slot.available ? "#166534" : "#991B1B" }}>
                    {slot.label} · {slot.available ? "Free" : "Taken"}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 18 }}>
            <h3 style={{ color: "#111827", fontSize: 15 }}>Bookings on {date}</h3>
            {bookings.length === 0
              ? <p style={{ color: "#6B7280" }}>No bookings for this date.</p>
              : <ul>{bookings.map((booking) => <li key={booking.reservationId}>{booking.id} · {booking.customer} · {booking.status}{booking.preferredTime ? ` · ${booking.preferredTime}` : ""}</li>)}</ul>}
          </div>
        </Dialog>
      )}

      {dialog === "form" && isAdmin && (
        <Dialog title={selected ? "Edit room or service" : "Add room or service"} onClose={closeDialog}>
          <form onSubmit={saveService}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {!selected && <label style={fieldStyle}>Code<input style={inputStyle} value={form.code} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, code: event.target.value })); }} pattern="[a-z0-9][a-z0-9-]{1,38}" required /></label>}
              <label style={fieldStyle}>Name<input style={inputStyle} value={form.name} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, name: event.target.value })); }} maxLength={100} required aria-describedby="room-service-name-hint" /></label>
              <label style={fieldStyle}>{isRoomPage ? "Room type" : "Service category"}
                <input style={inputStyle} value={form.inventoryType === "service" ? "Service" : "Room"} readOnly />
              </label>
              <label style={fieldStyle}>Price<input style={inputStyle} type="number" min="0" max="10000000" step="0.01" value={form.price} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, price: event.target.value })); }} required /></label>
              <label style={fieldStyle}>Capacity<input style={inputStyle} type="number" min="1" max="100" value={form.capacity} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, capacity: event.target.value })); }} required /></label>
              <label style={fieldStyle}>Units<input style={inputStyle} type="number" min="1" max="1000" value={form.quantity} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, quantity: event.target.value })); }} required /></label>
              <label style={fieldStyle}>Pricing mode
                <select style={inputStyle} value={form.pricingMode} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, pricingMode: event.target.value })); }}>
                  <option value="night">Per night</option><option value="stay">Per stay</option><option value="guest">Per guest</option>
                </select>
              </label>
              <label style={fieldStyle}>Unit
                <select style={inputStyle} value={form.unit} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, unit: event.target.value })); }}>
                  <option value="night">Night</option><option value="stay">Stay</option>
                </select>
              </label>
              <label style={fieldStyle}>Duration (minutes)
                <input style={inputStyle} type="number" min="0" max="1440" value={form.durationMinutes} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, durationMinutes: event.target.value })); }} />
              </label>
            </div>
            <label style={{ ...fieldStyle, marginTop: 12 }}>Description
              <textarea style={{ ...inputStyle, minHeight: 76 }} maxLength={1000} value={form.description} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, description: event.target.value })); }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, color: "#374151", fontSize: 13 }}>
              <input type="checkbox" checked={form.sameDayCheckout} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, sameDayCheckout: event.target.checked })); }} />
              Same-day timed booking (enables available time slots)
            </label>
            {selected && <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "#374151", fontSize: 13 }}>
              <input type="checkbox" checked={form.active} onChange={(event) => { setDirty(true); setForm((current) => ({ ...current, active: event.target.checked })); }} />
              Active
            </label>}
            <p id="room-service-name-hint" style={{ margin: "8px 0 0", color: "#6B7280", fontSize: 12 }}>Names must be unique. Existing reservations keep their saved price and dates.</p>
            {selected && <div style={{ marginTop: 16 }}><ListingPhotoManager service={selected} /></div>}
            {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
            <footer style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" style={buttonStyle} disabled={busy} onClick={closeDialog}>Cancel</button>
              <button type="submit" style={primaryButtonStyle} disabled={busy}>{busy ? "Saving…" : selected ? "Save changes" : "Add room or service"}</button>
            </footer>
          </form>
        </Dialog>
      )}

      {dialog === "delete" && selected && isAdmin && (
        <Dialog title="Delete room or service?" onClose={closeDialog} footer={
          <>
            <button type="button" style={buttonStyle} disabled={busy} onClick={closeDialog}>Cancel</button>
            <button type="button" style={{ ...primaryButtonStyle, background: "#B42318", borderColor: "#B42318" }} disabled={busy} onClick={deleteService}>{busy ? "Deleting…" : "Delete"}</button>
          </>
        }>
          <p style={{ color: "#374151" }}>Delete <strong>{selected.name}</strong>?</p>
          <p style={{ color: "#6B7280", fontSize: 13 }}>This is a soft delete: the item will be hidden from guests and retained as inactive so past bookings and reports keep their details. Upcoming bookings must be handled before deletion.</p>
          {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
          {bookingConflicts.length > 0 && (
            <div role="alert" style={{ marginTop: 12, padding: 12, border: "1px solid #FED7AA", borderRadius: 10, background: "#FFF7ED" }}>
              <p style={{ marginTop: 0 }}>Upcoming bookings prevent deletion. Deactivate this item instead.</p>
              <ul>{bookingConflicts.map((booking) => <li key={booking.reference}>{booking.reference} · {booking.check_in} to {booking.check_out}</li>)}</ul>
              {onViewBookings && <button type="button" style={buttonStyle} onClick={() => { setDialog(""); onViewBookings(); }}>Open reservations</button>}
            </div>
          )}
        </Dialog>
      )}
    </section>
  );
}

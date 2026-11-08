import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Navbar from "../components/navbar";
import regularRoomImage from "../assets/regular.png";
import luxuryRoomImage from "../assets/lux.png";
import entireVillaImage from "../assets/entirevilla.png";
import poolImage from "../assets/pool.png";
import eventImage from "../assets/event.png";
import propertyImage1 from "../assets/img1.jpg";
import propertyImage2 from "../assets/img2.jpg";
import propertyImage3 from "../assets/img3.png";
import "../style.css";
import { apiRequest, getSessionToken, getSessionUser, listingPhotoUrl } from "../api";
import ReservationDatePicker from "../components/reservationdatepicker";
import ReservationPolicies from "../components/reservationpolicies";
import ListingPhotoGallery from "../components/listingphotogallery";
import useSiteAssets from "../hooks/useSiteAssets";
import { formatArrivalTime } from "../utils/arrivalTime";

const roomImages = {
  regular: regularRoomImage,
  luxury: luxuryRoomImage,
  "entire-villa": entireVillaImage,
  pool: poolImage,
  event: eventImage,
};
const fallbackGalleries = {
  regular: [regularRoomImage],
  luxury: [luxuryRoomImage],
  "entire-villa": [entireVillaImage, propertyImage1, propertyImage2, propertyImage3],
  pool: [poolImage, propertyImage2, propertyImage3, propertyImage1],
  event: [eventImage, entireVillaImage],
};
const listingAssetKeys = {
  regular: "room-regular",
  luxury: "room-luxury",
  "entire-villa": "service-entire-villa",
  pool: "room-pool",
  event: "room-event",
};

// Make sure Bootstrap Icons CSS is loaded in your index.html or main entry:
// <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" />

// ─── Helpers ──────────────────────────────────────────────────────────────────
function today() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().split("T")[0];
}

function addLocalDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatBookingDate(value) {
  if (!value) return "Not set";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function sameDayCheckoutTime(startTime, durationMinutes) {
  if (!startTime || !durationMinutes) return "";
  const [hour, minute] = startTime.split(":").map(Number);
  const totalMinutes = hour * 60 + minute + durationMinutes;
  return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function monthsBetween(startMonth, endMonth) {
  const [startYear, startNumber] = startMonth.split("-").map(Number);
  const [endYear, endNumber] = endMonth.split("-").map(Number);
  const current = new Date(startYear, startNumber - 1, 1, 12);
  const end = new Date(endYear, endNumber - 1, 1, 12);
  const months = [];
  while (current <= end) {
    months.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`);
    current.setMonth(current.getMonth() + 1);
  }
  return months;
}

// ─── Reservation Page ─────────────────────────────────────────────────────────
export default function Reservation() {
  const navigate = useNavigate();
  const location = useLocation();
  const siteAssets = useSiteAssets();

  const prefill = location.state || {};
  const bookingType = prefill.bookingType === "Walk-in" ? "Walk-in" : "Online";
  const storedUser = getSessionUser();
  const loggedInUser = getSessionToken() ? storedUser : null;
  const nameParts = (loggedInUser?.name || "").trim().split(/\s+/);
  const [reservedDates, setReservedDates] = useState(new Set());
  const [loadingReservedDates, setLoadingReservedDates] = useState(Boolean(loggedInUser));
  const [reservedDatesError, setReservedDatesError] = useState("");
  const [services, setServices] = useState([]);
  const [servicesError, setServicesError] = useState("");
  const [loadingServices, setLoadingServices] = useState(true);
  const [availability, setAvailability] = useState({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [listingPhotos, setListingPhotos] = useState([]);
  const [listingPhotosError, setListingPhotosError] = useState("");
  const [favoriteCodes, setFavoriteCodes] = useState([]);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [galleryMessage, setGalleryMessage] = useState("");

  const [form, setForm] = useState({
    firstName: loggedInUser ? nameParts[0] || "" : prefill.firstName || "",
    lastName:  loggedInUser ? nameParts.slice(1).join(" ") : prefill.lastName || "",
    guestEmail: loggedInUser?.email || prefill.guestEmail || "",
    checkIn:   prefill.checkIn   || today(),
    preferredTime: prefill.preferredTime || "",
    checkOut:  prefill.checkOut  || "",
    room:      prefill.room || new URLSearchParams(location.search).get("room") || "",
    guests:    prefill.guests    || 1,
  });
  const [arrivalTimeOptions, setArrivalTimeOptions] = useState([]);
  const [arrivalTimesLoading, setArrivalTimesLoading] = useState(true);
  const [arrivalTimesError, setArrivalTimesError] = useState("");
  const [checkInCalendarMonth, setCheckInCalendarMonth] = useState(form.checkIn.slice(0, 7));
  const [checkOutCalendarMonth, setCheckOutCalendarMonth] = useState((form.checkOut || form.checkIn).slice(0, 7));
  const [calendarAvailability, setCalendarAvailability] = useState({});
  const [calendarRefreshVersion, setCalendarRefreshVersion] = useState(0);
  const updateCheckInCalendarMonth = useCallback((month) => setCheckInCalendarMonth(month), []);
  const updateCheckOutCalendarMonth = useCallback((month) => setCheckOutCalendarMonth(month), []);

  useEffect(() => {
    let active = true;
    async function loadArrivalTimes() {
      try {
        const query = new URLSearchParams({ date: form.checkIn, ...(form.room ? { room: form.room } : {}) });
        const result = await apiRequest(`/reservations/arrival-times?${query}`);
        if (!Array.isArray(result.options)) throw new Error("Arrival times could not be loaded.");
        if (!active) return;
        setArrivalTimeOptions(result.options);
        setArrivalTimesError("");
        setForm((current) => (
          current.preferredTime && !result.options.some((option) => option.value === current.preferredTime && option.available)
            ? { ...current, preferredTime: "" }
            : current
        ));
      } catch (error) {
        if (active) {
          setArrivalTimeOptions([]);
          setArrivalTimesError(error.message);
        }
      } finally {
        if (active) setArrivalTimesLoading(false);
      }
    }
    setArrivalTimesLoading(true);
    loadArrivalTimes();
    const timer = window.setInterval(loadArrivalTimes, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [form.checkIn, form.room]);

  const [submitted, setSubmitted] = useState(false);
  const [errors,    setErrors]    = useState({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loggedInUser) return undefined;
    let active = true;
    apiRequest("/reservations?limit=500")
      .then((reservations) => {
        if (!active) return;
        const dates = new Set();
        reservations.filter((reservation) => ["Pending", "Confirmed", "Checked-in"].includes(reservation.status)).forEach((reservation) => {
          const date = new Date(`${reservation.checkIn}T12:00:00`);
          const end = new Date(`${reservation.checkOut}T12:00:00`);
          while (date < end) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            dates.add(`${year}-${month}-${day}`);
            date.setDate(date.getDate() + 1);
          }
        });
        setReservedDates(dates);
        setReservedDatesError("");
      })
      .catch((error) => {
        if (active) setReservedDatesError(error.message);
      })
      .finally(() => {
        if (active) setLoadingReservedDates(false);
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!form.room) {
      setListingPhotos([]);
      setListingPhotosError("");
      return undefined;
    }
    let active = true;
    apiRequest(`/services/${encodeURIComponent(form.room)}/photos`)
      .then(({ photos }) => {
        if (active) {
          setListingPhotos((photos || []).map((photo) => ({
            ...photo,
            url: listingPhotoUrl(form.room, photo.id, "large"),
            mediumUrl: listingPhotoUrl(form.room, photo.id, "medium"),
            thumbnailUrl: listingPhotoUrl(form.room, photo.id, "thumbnail"),
          })));
          setListingPhotosError("");
        }
      })
      .catch((error) => {
        if (active) {
          setListingPhotos([]);
          setListingPhotosError(error.message);
        }
      });
    return () => { active = false; };
  }, [form.room]);

  useEffect(() => {
    if (!loggedInUser) {
      setFavoriteCodes([]);
      return undefined;
    }
    let active = true;
    apiRequest("/profile/favorites")
      .then(({ favorites }) => { if (active) setFavoriteCodes(favorites); })
      .catch((error) => { if (active) setGalleryMessage(`Saved listings could not be loaded: ${error.message}`); });
    return () => { active = false; };
  }, [loggedInUser?.id]);

  useEffect(() => {
    let active = true;
    apiRequest("/services")
      .then((availableServices) => {
        if (!active) return;
        const activeRooms = availableServices.filter((service) => service.category === "room");
        setServices(activeRooms);
        setForm((current) => ({
          ...current,
          room: activeRooms.some((room) => room.code === current.room)
            ? current.room
            : activeRooms.find((room) => room.code === "regular")?.code || activeRooms[0]?.code || "",
        }));
      })
      .catch((error) => {
        if (active) setServicesError(error.message);
      })
      .finally(() => {
        if (active) setLoadingServices(false);
      });
    return () => { active = false; };
  }, []);
  const roomOptions = services.filter((service) => service.category === "room");
  const selectedService = roomOptions.find((service) => service.code === form.room);
  const sameDayBooking = Boolean(selectedService?.sameDayCheckout);

  useEffect(() => {
    if (sameDayBooking && form.checkOut !== form.checkIn) {
      setForm((current) => ({ ...current, checkOut: current.checkIn }));
    }
  }, [sameDayBooking, form.checkIn, form.checkOut]);

  useEffect(() => {
    if (!form.room || !checkInCalendarMonth || !checkOutCalendarMonth) return undefined;
    const months = new Set([checkInCalendarMonth, checkOutCalendarMonth]);
    if (form.checkIn) {
      const lastPossibleNight = addLocalDays(form.checkIn, 30).slice(0, 7);
      const lastMonth = checkOutCalendarMonth < lastPossibleNight ? checkOutCalendarMonth : lastPossibleNight;
      monthsBetween(form.checkIn.slice(0, 7), lastMonth).forEach((month) => months.add(month));
    }

    let active = true;
    const monthList = [...months];
    setCalendarAvailability((current) => {
      const missingMonths = monthList.filter((month) => current[`${form.room}:${month}`]?.status !== "ready");
      return {
        ...current,
        ...Object.fromEntries(missingMonths.map((month) => [`${form.room}:${month}`, { status: "loading", unavailableDates: new Set() }])),
      };
    });
    monthList.forEach((month) => {
      const query = new URLSearchParams({ room: form.room, month });
      apiRequest(`/availability/calendar?${query}`)
        .then((result) => {
          if (!active) return;
          setCalendarAvailability((current) => ({
            ...current,
            [`${form.room}:${month}`]: { status: "ready", unavailableDates: new Set(result.unavailableDates) },
          }));
        })
        .catch((error) => {
          if (!active) return;
          setCalendarAvailability((current) => ({
            ...current,
            [`${form.room}:${month}`]: { status: "error", unavailableDates: new Set(), error: error.message },
          }));
        });
    });
    return () => { active = false; };
  }, [form.room, form.checkIn, checkInCalendarMonth, checkOutCalendarMonth, calendarRefreshVersion]);

  useEffect(() => {
    if (!form.checkIn || !form.checkOut || sameDayBooking || form.checkOut <= form.checkIn || !roomOptions.length) {
      setAvailability({});
      setAvailabilityError("");
      setAvailabilityLoading(false);
      return undefined;
    }

    let isCurrent = true;
    async function loadAvailability() {
      try {
        const query = new URLSearchParams({ checkIn: form.checkIn, checkOut: form.checkOut });
        const rows = await apiRequest(`/availability?${query}`);
        if (isCurrent) {
          setAvailability(Object.fromEntries(rows.map((room) => [room.room, room])));
          setAvailabilityError("");
        }
      } catch (error) {
        if (isCurrent) setAvailabilityError(error.message);
      } finally {
        if (isCurrent) setAvailabilityLoading(false);
      }
    }

    setAvailabilityLoading(true);
    setAvailability({});
    loadAvailability();
    const timer = setInterval(loadAvailability, 15000);
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") loadAvailability();
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      isCurrent = false;
      clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [form.checkIn, form.checkOut, sameDayBooking, roomOptions.length, calendarRefreshVersion]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => {
      if (name === "room") {
        const service = roomOptions.find((option) => option.code === value);
        return { ...prev, room: value, preferredTime: "", checkOut: service?.sameDayCheckout ? prev.checkIn : "" };
      }
      if (name === "checkIn") {
        return { ...prev, checkIn: value, checkOut: sameDayBooking ? value : prev.checkOut && value >= prev.checkOut ? "" : prev.checkOut };
      }
      return { ...prev, [name]: name === "guests" ? Number(value) : value };
    });
    setErrors((prev) => ({ ...prev, [name]: "" }));
    setSubmitError("");
  }

  function validate() {
    const e = {};
    if (!loggedInUser) {
      if (!form.firstName.trim()) e.firstName = "First name is required.";
      if (!form.lastName.trim())  e.lastName  = "Last name is required.";
      if (!form.guestEmail.trim()) e.guestEmail = "Email address is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.guestEmail.trim()))
        e.guestEmail = "Enter a valid email address.";
    }
    if (!form.checkIn)          e.checkIn   = "Check-in date is required.";
    if (!form.preferredTime)    e.preferredTime = "Preferred check-in time is required.";
    else if (arrivalTimesLoading) e.preferredTime = "Wait while available arrival times are checked.";
    else if (arrivalTimesError) e.preferredTime = "Arrival times could not be checked. Please try again.";
    else if (!arrivalTimeOptions.some((option) => option.value === form.preferredTime && option.available)) {
      e.preferredTime = "Choose an available whole-hour arrival time.";
    }
    if (sameDayBooking && form.checkOut !== form.checkIn) e.checkOut = "Check-out must be on the same day as check-in.";
    if (!sameDayBooking && !form.checkOut) e.checkOut = "Check-out date is required.";
    if (!sameDayBooking && form.checkOut && form.checkOut <= form.checkIn)
      e.checkOut = "Check-out must be after check-in.";
    if (!sameDayBooking && form.room === "event" && form.checkOut && form.checkIn) {
      const stayLength = (Date.parse(`${form.checkOut}T00:00:00Z`) - Date.parse(`${form.checkIn}T00:00:00Z`)) / 86400000;
      if (stayLength !== 1) e.checkOut = "Event Space bookings are for one 12-hour date at a time.";
    }
    if (form.checkIn && sameDayBooking) {
      const calendar = calendarAvailability[`${form.room}:${form.checkIn.slice(0, 7)}`];
      if (!calendar || calendar.status !== "ready") e.checkIn = "Please wait while availability is checked for your selected date.";
      else if (calendar.unavailableDates.has(form.checkIn)) e.checkIn = "No start time is available on this date.";
    } else if (form.checkIn && form.checkOut && form.checkOut > form.checkIn && !e.checkOut) {
      const date = new Date(`${form.checkIn}T12:00:00`);
      const end = new Date(`${form.checkOut}T12:00:00`);
      while (date < end) {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const calendar = calendarAvailability[`${form.room}:${key.slice(0, 7)}`];
        if (!calendar || calendar.status !== "ready") {
          e.checkOut = "Please wait while availability is checked for your selected dates.";
          break;
        }
        if (calendar.unavailableDates.has(key)) {
          e.checkOut = "Your selected stay includes an unavailable date. Choose different dates.";
          break;
        }
        date.setDate(date.getDate() + 1);
      }
    }
    if (loggedInUser && !sameDayBooking && form.checkIn && form.checkOut) {
      const date = new Date(`${form.checkIn}T12:00:00`);
      const end = new Date(`${form.checkOut}T12:00:00`);
      while (date < end) {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        if (reservedDates.has(key)) {
          e.checkIn = "You already have a reservation that overlaps these dates. Choose different dates.";
          break;
        }
        date.setDate(date.getDate() + 1);
      }
    }
    if (!Number.isInteger(form.guests) || form.guests < 1) e.guests = "Enter at least 1 guest.";
    if (!form.room) e.room = "Choose a room or package.";
    return e;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const e2 = validate();
    if (Object.keys(e2).length) {
      setErrors(e2);
      return;
    }

    setSubmitError("");
    setSubmitting(true);
    try {
      const reservation = await apiRequest("/reservations", {
        method: "POST",
        body: JSON.stringify({
          ...(loggedInUser ? {} : {
            guestName: `${form.firstName.trim()} ${form.lastName.trim()}`,
            guestEmail: form.guestEmail.trim(),
          }),
          room: form.room,
          checkIn: form.checkIn,
          preferredTime: form.preferredTime,
          checkOut: sameDayBooking ? form.checkIn : form.checkOut,
          guests: form.guests,
          bookingType,
        }),
      });
      navigate("/payment", {
        state: {
          ...form,
          checkOut: sameDayBooking ? form.checkIn : form.checkOut,
          sameDayCheckout: sameDayBooking,
          durationMinutes: selectedRoom?.durationMinutes || null,
          reservationId: reservation.id,
          reference: reservation.reference,
          bookingType: reservation.bookingType,
          paymentDueAt: reservation.paymentDueAt,
          checkOutTime: reservation.checkOutTime,
          totalAmount: reservation.total,
          quotedRoom: {
            name: reservation.roomName,
            price: reservation.roomPrice,
            unit: reservation.roomUnit,
            pricingMode: reservation.roomPricingMode,
            rateUnit: selectedRateUnit,
            total: reservation.roomTotal,
          },
        },
      });
    } catch (requestError) {
      setSubmitError(requestError.message);
      setCalendarAvailability((current) => Object.fromEntries(
        Object.entries(current).map(([key, calendar]) => [
          key,
          key.startsWith(`${form.room}:`) ? { ...calendar, status: "loading", unavailableDates: new Set() } : calendar,
        ]),
      ));
      setCalendarRefreshVersion((version) => version + 1);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived values ───────────────────────────────────────────────────────────
  const selectedRoom   = selectedService;
  const computedCheckoutTime = sameDayBooking
    ? sameDayCheckoutTime(form.preferredTime, selectedRoom.durationMinutes)
    : "";
  const summaryTotal = selectedRoom
    ? selectedRoom.pricingMode === "guest"
      ? selectedRoom.price * form.guests
      : selectedRoom.pricingMode === "night"
        ? selectedRoom.price * (sameDayBooking ? 1 : form.checkIn && form.checkOut > form.checkIn
          ? (Date.parse(`${form.checkOut}T00:00:00Z`) - Date.parse(`${form.checkIn}T00:00:00Z`)) / 86400000
          : 0)
        : selectedRoom.price
    : 0;
  const selectedRoomImage = roomImages[form.room] || null;
  const galleryPhotos = useMemo(() => {
    if (listingPhotos.length) return listingPhotos;
    const fallbacks = fallbackGalleries[form.room] || (selectedRoomImage ? [selectedRoomImage] : []);
    const customImage = siteAssets[listingAssetKeys[form.room]];
    return fallbacks.map((url, index) => ({
      url: index === 0 && customImage ? customImage : url,
      mediumUrl: index === 0 && customImage ? customImage : url,
      thumbnailUrl: index === 0 && customImage ? customImage : url,
      alt: `${selectedRoom?.name || "Villa Tjeozabel"}, photo ${index + 1}`,
    }));
  }, [form.room, listingPhotos, selectedRoom?.name, selectedRoomImage, siteAssets]);
  const isFavorite = favoriteCodes.includes(form.room);

  async function shareListing() {
    const listingUrl = new URL(window.location.href);
    if (form.room) listingUrl.searchParams.set("room", form.room);
    const shareData = { title: selectedRoom?.name || "Villa Tjeozabel", url: listingUrl.toString() };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setGalleryMessage("");
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareData.url);
      } else {
        const field = document.createElement("textarea");
        field.value = shareData.url;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand("copy");
        field.remove();
        if (!copied) throw new Error("Clipboard access is unavailable.");
      }
      setGalleryMessage("Listing link copied to clipboard.");
    } catch (error) {
      if (error.name !== "AbortError") setGalleryMessage(`Could not share the listing: ${error.message}`);
    }
  }

  async function toggleFavorite() {
    if (!loggedInUser) {
      navigate("/login", { state: { returnTo: "/reservation", reservationState: { ...prefill, room: form.room } } });
      return;
    }
    setFavoriteLoading(true);
    setGalleryMessage("");
    try {
      if (isFavorite) {
        await apiRequest(`/profile/favorites/${encodeURIComponent(form.room)}`, { method: "DELETE" });
        setFavoriteCodes((codes) => codes.filter((code) => code !== form.room));
        setGalleryMessage("Removed from your saved listings.");
      } else {
        await apiRequest(`/profile/favorites/${encodeURIComponent(form.room)}`, { method: "PUT" });
        setFavoriteCodes((codes) => [...codes, form.room]);
        setGalleryMessage("Listing saved to your favorites.");
      }
    } catch (error) {
      setGalleryMessage(`Could not update saved listings: ${error.message}`);
    } finally {
      setFavoriteLoading(false);
    }
  }
  const selectedRateUnit = selectedRoom?.pricingMode === "guest"
    ? "guest"
    : selectedRoom?.sameDayCheckout
      ? `${selectedRoom.durationMinutes / 60} hours`
    : selectedRoom?.code === "regular"
      ? "3 hours"
      : selectedRoom?.pricingMode === "stay"
        ? "booking"
        : selectedRoom?.unit;

  // ── Success screen ───────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="app-shell">
        <Navbar />
        <div className="res-success-wrapper">
          <div className="contact-success">
            <div className="contact-success-icon">
              <i className="bi bi-stars"></i>
            </div>
            <h3>Reservation Received!</h3>
            <p>
              Thank you, <strong>{form.firstName}</strong>! Your reservation at Villa Tjeozabel
              has been submitted. We'll reach out shortly to confirm your booking.
            </p>
            <button
              className="btn btn-warning mt-3"
              onClick={() => navigate("/")}
            >
              Back to Home
            </button>
            <button
              type="button"
              className="contact-back-link"
              onClick={() => setSubmitted(false)}
              style={{ cursor: "pointer" }}
            >
              Make another reservation
            </button>
          </div>
        </div>
        <footer className="footer">© 2026 Villa Tjeozabel</footer>
      </div>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <Navbar />

      {/* PAGE BODY */}
      <div className="contact-page">
        <div className="res-body">
          <ListingPhotoGallery
            title={selectedRoom?.name || "Villa Tjeozabel"}
            photos={galleryPhotos}
            favorite={isFavorite}
            savingFavorite={favoriteLoading}
            onSave={toggleFavorite}
            onShare={shareListing}
            shareMessage={galleryMessage || listingPhotosError}
          />

          {/* ── LEFT: FORM ── */}
          <div className="contact-form-wrapper">
            <div className="contact-form-header">
              <span className="section-tag">Book Your Stay · Reservation Details</span>
              <h2 style={{ marginTop: "10px" }}>Make a Reservation</h2>
              <p>Fill in the details below and we'll confirm your booking shortly.</p>
              <h3>Your Information</h3>
              <p className="section-sub" style={{ marginBottom: 0 }}>
                All fields marked <span style={{ color: "var(--orange)" }}>*</span> are required.
              </p>
            </div>

            <form className="contact-form" onSubmit={handleSubmit} noValidate>

              {loggedInUser ? (
                <div className="reservation-account-details">
                  <strong>Booking as {loggedInUser.name}</strong>
                  <span>{loggedInUser.email}</span>
                </div>
              ) : (
                <>
                  <div className="contact-form-row">
                    <div className="contact-field">
                      <label>First Name <span>*</span></label>
                      <input className="auth-input" type="text" name="firstName" placeholder="Juan" value={form.firstName} onChange={handleChange} />
                      {errors.firstName && <small className="res-error">{errors.firstName}</small>}
                    </div>
                    <div className="contact-field">
                      <label>Last Name <span>*</span></label>
                      <input className="auth-input" type="text" name="lastName" placeholder="dela Cruz" value={form.lastName} onChange={handleChange} />
                      {errors.lastName && <small className="res-error">{errors.lastName}</small>}
                    </div>
                  </div>

                  <div className="contact-field">
                    <label>Email <span>*</span></label>
                    <input className="auth-input" type="email" name="guestEmail" placeholder="you@example.com" value={form.guestEmail} onChange={handleChange} autoComplete="email" />
                    {errors.guestEmail && <small className="res-error">{errors.guestEmail}</small>}
                  </div>
                </>
              )}
              {bookingType === "Walk-in" && (
                <p className="res-availability-note" role="note">
                  No online payment is required for a Walk-in booking. Our team will contact you to confirm availability.
                </p>
              )}

              {/* Date row */}
              <div className="contact-form-row">
                <ReservationDatePicker
                  label="Check-in Date"
                  value={form.checkIn}
                  minDate={today()}
                  disabledDates={sameDayBooking ? undefined : reservedDates}
                  isDateDisabled={(candidate) => {
                    const calendar = calendarAvailability[`${form.room}:${candidate.slice(0, 7)}`];
                    return !calendar || calendar.status !== "ready" || calendar.unavailableDates.has(candidate);
                  }}
                  getDateDisabledReason={(candidate) => {
                    if (!sameDayBooking && reservedDates.has(candidate)) return "Not available";
                    const calendar = calendarAvailability[`${form.room}:${candidate.slice(0, 7)}`];
                    return !calendar || calendar.status === "loading"
                      ? "Checking availability"
                      : calendar.status === "error" || calendar.unavailableDates.has(candidate)
                        ? "Not available"
                        : "";
                  }}
                  loading={calendarAvailability[`${form.room}:${checkInCalendarMonth}`]?.status === "loading"}
                  onChange={(value) => handleChange({ target: { name: "checkIn", value } })}
                  onMonthChange={updateCheckInCalendarMonth}
                  error={errors.checkIn}
                  helpText={sameDayBooking
                    ? "Choose a date with an available 12-hour start time."
                    : loggedInUser && loadingReservedDates ? "Loading your existing reservations…" : undefined}
                />
                {!sameDayBooking && <ReservationDatePicker
                  label="Check-out Date"
                  value={form.checkOut}
                  minDate={form.checkIn ? addLocalDays(form.checkIn, 1) : today()}
                  isDateDisabled={(candidate) => {
                    if (!form.checkIn || candidate <= form.checkIn) return true;
                    if (form.room === "event" && candidate !== addLocalDays(form.checkIn, 1)) return true;
                    if (candidate > addLocalDays(form.checkIn, 30)) return true;
                    const date = new Date(`${form.checkIn}T12:00:00`);
                    const end = new Date(`${candidate}T12:00:00`);
                    while (date < end) {
                      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                      const calendar = calendarAvailability[`${form.room}:${key.slice(0, 7)}`];
                      if (reservedDates.has(key) || !calendar || calendar.status !== "ready" || calendar.unavailableDates.has(key)) return true;
                      date.setDate(date.getDate() + 1);
                    }
                    return false;
                  }}
                  getDateDisabledReason={(candidate) => {
                    if (!form.checkIn || candidate <= form.checkIn) return "Choose a check-out after check-in";
                    if (form.room === "event" && candidate !== addLocalDays(form.checkIn, 1)) return "Event Space bookings are for one day";
                    if (candidate > addLocalDays(form.checkIn, 30)) return "Stays are limited to 30 nights";
                    const date = new Date(`${form.checkIn}T12:00:00`);
                    const end = new Date(`${candidate}T12:00:00`);
                    while (date < end) {
                      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                      const calendar = calendarAvailability[`${form.room}:${key.slice(0, 7)}`];
                      if (reservedDates.has(key) || !calendar || calendar.status !== "ready" || calendar.unavailableDates.has(key)) {
                        return calendar?.status === "loading" ? "Checking availability" : "Not available";
                      }
                      date.setDate(date.getDate() + 1);
                    }
                    return "";
                  }}
                  loading={calendarAvailability[`${form.room}:${checkOutCalendarMonth}`]?.status === "loading"}
                  onChange={(value) => handleChange({ target: { name: "checkOut", value } })}
                  onMonthChange={updateCheckOutCalendarMonth}
                  error={errors.checkOut}
                  helpText={form.room === "event" ? "Event Space bookings include one 12-hour date." : undefined}
                />}
              </div>
              {sameDayBooking && errors.checkOut && <small className="res-error">{errors.checkOut}</small>}
              {calendarAvailability[`${form.room}:${checkInCalendarMonth}`]?.status === "loading"
                && <p className="res-availability-note" role="status">Checking room availability for calendar dates…</p>}
              {[checkInCalendarMonth, checkOutCalendarMonth]
                .map((month) => calendarAvailability[`${form.room}:${month}`])
                .find((calendar) => calendar?.status === "error")?.error
                && <p role="alert" className="res-error">
                  Calendar availability could not be checked. Dates remain disabled until availability is available.
                </p>}
              {reservedDatesError && <p role="alert" className="res-error">Your existing reservation dates could not be loaded: {reservedDatesError}. The server will still check for overlaps when you submit.</p>}

              <div className="contact-field">
                <label htmlFor="preferredTime">{sameDayBooking ? "Preferred Start Time" : "Preferred Time of Arrival"} <span>*</span></label>
                <select
                  className="auth-input contact-select"
                  id="preferredTime"
                  name="preferredTime"
                  value={form.preferredTime}
                  onChange={handleChange}
                  required
                  disabled={arrivalTimesLoading || !!arrivalTimesError}
                  aria-invalid={Boolean(errors.preferredTime)}
                  aria-describedby={errors.preferredTime ? "preferredTime-error" : "preferredTime-help"}
                >
                  <option value="">Select arrival time</option>
                  {arrivalTimeOptions.map((option) => (
                    <option key={option.value} value={option.value} disabled={!option.available}>
                      {option.label}{!option.available ? " — Not available" : ""}
                    </option>
                  ))}
                </select>
                {arrivalTimesLoading && <small id="preferredTime-help" className="res-availability-note" role="status">Checking available arrival times…</small>}
                {!arrivalTimesLoading && !arrivalTimesError && arrivalTimeOptions.length > 0
                  && arrivalTimeOptions.every((option) => !option.available)
                  && <small id="preferredTime-help" className="res-error" role="status">No arrival hours are available for this date.</small>}
                {arrivalTimesError && <small id="preferredTime-help" className="res-error" role="alert">{arrivalTimesError}</small>}
                {errors.preferredTime && <small id="preferredTime-error" className="res-error">{errors.preferredTime}</small>}
                {sameDayBooking && form.preferredTime && computedCheckoutTime && (
                  <small className="res-availability-note" role="status">
                    Check-in: {formatBookingDate(form.checkIn)}, {formatArrivalTime(form.preferredTime)} / Check-out: {formatBookingDate(form.checkIn)}, {formatArrivalTime(computedCheckoutTime)}
                  </small>
                )}
                {sameDayBooking && <small className="res-availability-note">Duration: {selectedRoom.durationMinutes / 60} hours</small>}
              </div>

              {/* Room + Guests row */}
              <div className="contact-form-row">
                <div className="contact-field">
                  <label>Room / Package <span>*</span></label>
                  <select
                    className="auth-input contact-select"
                    name="room"
                    value={form.room}
                    onChange={handleChange}
                    disabled={loadingServices || roomOptions.length === 0}
                  >
                    {loadingServices && <option value="">Loading rooms...</option>}
                    {!loadingServices && roomOptions.map((room) => (
                      <option key={room.code} value={room.code}>
                        {room.name} — ₱{room.price.toLocaleString("en-PH")} / {room.pricingMode === "guest" ? "guest" : room.sameDayCheckout ? `${room.durationMinutes / 60} hours` : room.code === "regular" ? "3 hours" : room.pricingMode === "stay" ? "booking" : room.unit}
                        {availability[room.code] ? ` · ${availability[room.code].unitsLeft} of ${availability[room.code].totalUnits} available` : ""}
                      </option>
                    ))}
                  </select>
                  {errors.room && <small className="res-error">{errors.room}</small>}
                  {sameDayBooking && (
                    <small role="status" className="res-availability-note">
                      {arrivalTimeOptions.some((option) => option.available)
                        ? "Available start times update automatically."
                        : "No start times are available for this date. Choose another date."}
                    </small>
                  )}
                  {!sameDayBooking && form.checkIn && form.checkOut > form.checkIn && (
                    <small role={availabilityError ? "alert" : "status"} className={availabilityError ? "res-error" : "res-availability-note"}>
                      {availabilityError
                        ? `Live availability could not be checked: ${availabilityError}`
                        : availabilityLoading && !availability[form.room]
                          ? "Checking live availability…"
                          : availability[form.room]
                            ? availability[form.room].unitsLeft > 0
                              ? `${availability[form.room].unitsLeft} of ${availability[form.room].totalUnits} booking ${availability[form.room].unitsLeft === 1 ? "slot" : "slots"} available for these dates. Updates automatically.`
                              : "No availability for these dates. Please choose different dates."
                            : "Availability for these dates is not available."}
                    </small>
                  )}
                </div>
                <div className="contact-field">
                  <label>Number of Guests <span>*</span></label>
                  <input
                    className="auth-input"
                    type="number"
                    name="guests"
                    min={1}
                    max={100}
                    value={form.guests}
                    onChange={handleChange}
                  />
                  {errors.guests && <small className="res-error">{errors.guests}</small>}
                </div>
              </div>

              {/* Submit */}
              {servicesError && <p role="alert" className="res-error">Could not load rooms: {servicesError}</p>}
              {submitError && <p role="alert" className="res-error">{submitError}</p>}
              <button type="submit" className="auth-btn contact-submit" disabled={submitting || loadingServices || roomOptions.length === 0 || (!sameDayBooking && availability[form.room]?.unitsLeft === 0)}>
                {submitting ? "Saving reservation..." : loadingServices ? "Loading rooms..." : "Confirm Reservation"}
              </button>

            </form>
          </div>

          {/* ── RIGHT: BOOKING SUMMARY ── */}
          <div className="res-summary-column">
            <div className="res-summary-sticky">
              <div className="res-summary-card">

                {/* Header */}
                <div className="res-summary-header">
                  <div className="res-summary-header-icon">
                    <i className="bi bi-house-heart-fill"></i>
                  </div>
                  <div>
                    <p className="res-summary-eyebrow">Booking Summary</p>
                    <p className="res-summary-title">Villa Tjeozabel</p>
                  </div>
                </div>

                <hr className="res-summary-divider" />

                {/* Room */}
                <SummaryRow
                  label="Room / Package"
                  value={selectedRoom?.name || "—"}
                  sub={selectedRoom ? `₱${selectedRoom.price.toLocaleString("en-PH")} / ${selectedRateUnit}` : undefined}
                />

                {/* Dates */}
                <SummaryRow
                  label="Check-in"
                  value={sameDayBooking
                    ? `${formatBookingDate(form.checkIn)}, ${formatArrivalTime(form.preferredTime) || "Not set"}`
                    : form.checkIn || "Not set"}
                />
                {!sameDayBooking && <SummaryRow label="Preferred time" value={formatArrivalTime(form.preferredTime) || "Not set"} />}
                <SummaryRow
                  label="Check-out"
                  value={sameDayBooking
                    ? `${formatBookingDate(form.checkIn)}, ${formatArrivalTime(computedCheckoutTime) || "Not set"}`
                    : form.checkOut || "Not set"}
                />
                {sameDayBooking && <SummaryRow label="Duration" value={`${selectedRoom.durationMinutes / 60} hours`} />}

                {/* Guests */}
                <SummaryRow
                  label="Guests"
                  value={`${form.guests} guest${form.guests > 1 ? "s" : ""}`}
                />
                <SummaryRow label="Total price" value={`₱${summaryTotal.toLocaleString("en-PH")}`} />

                <hr className="res-summary-bottom-divider" />

                <p className="res-summary-note">
                  <i className="bi bi-chat-dots-fill me-2"></i>
                  {bookingType === "Walk-in"
                    ? "Our team will contact you to confirm availability."
                    : "Our team will contact you to confirm availability and finalize payment."}
                </p>
              </div>
            </div>

            <ReservationPolicies />

            {/* Back link */}
            <div className="res-back-link-wrapper">
              <button
                type="button"
                className="contact-back-link"
                onClick={() => navigate("/services")}
                style={{ cursor: "pointer" }}
              >
                ← Change services
              </button>
            </div>
          </div>

        </div>
      </div>

      <footer className="footer">© 2026 Villa Tjeozabel</footer>
    </div>
  );
}

// ─── Summary Row ──────────────────────────────────────────────────────────────
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

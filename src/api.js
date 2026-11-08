import { formatArrivalTime } from "./utils/arrivalTime";

const API_URL = process.env.REACT_APP_API_URL
  || (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "");

export function siteAssetUrl(key, updatedAt) {
  const version = updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : "";
  return `${API_URL}/api/site-assets/${encodeURIComponent(key)}${version}`;
}

export function listingPhotoUrl(code, photoId, size = "large") {
  return `${API_URL}/api/services/${encodeURIComponent(code)}/photos/${encodeURIComponent(photoId)}/image?size=${encodeURIComponent(size)}`;
}

export async function fetchListingPhoto(code, photoId, size = "large") {
  const token = getSessionToken();
  const response = await fetch(listingPhotoUrl(code, photoId, size), {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  if (!response.ok) throw new Error("Could not load this listing photo.");
  return URL.createObjectURL(await response.blob());
}

export async function uploadListingPhoto(code, variants, alt) {
  const token = getSessionToken();
  const form = new FormData();
  form.append("large", variants.large, "large.webp");
  form.append("medium", variants.medium, "medium.webp");
  form.append("thumbnail", variants.thumbnail, "thumbnail.webp");
  form.append("alt", alt);
  const response = await fetch(`${API_URL}/api/services/${encodeURIComponent(code)}/photos`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Photo upload failed.");
  return result.photo;
}

export async function uploadSiteAsset(key, file) {
  const token = getSessionToken();
  const form = new FormData();
  form.append("asset", file);
  const response = await fetch(`${API_URL}/api/site-assets/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: token ? { Authorization: "Bearer " + token } : {},
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Image upload failed. Please try again.");
  return result;
}

export function updateProfileDetails(profile) {
  return apiRequest("/profile", {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export async function uploadProfileAvatar(file, currentPassword) {
  const form = new FormData();
  form.append("profilePicture", file);
  form.append("currentPassword", currentPassword);
  const response = await fetch(`${API_URL}/api/profile/avatar`, {
    method: "POST",
    headers: getSessionToken() ? { Authorization: `Bearer ${getSessionToken()}` } : {},
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Profile photo upload failed.");
  return result.user;
}

export async function downloadProfileExport(exportId) {
  const response = await fetch(`${API_URL}/api/profile/data-exports/${encodeURIComponent(exportId)}/download`, {
    headers: getSessionToken() ? { Authorization: `Bearer ${getSessionToken()}` } : {},
  });
  if (!response.ok) {
    let message = "Could not download your personal data.";
    try {
      const result = await response.json();
      message = result.error || message;
    } catch {
      // Keep the download error visible if the server response is not JSON.
    }
    throw new Error(message);
  }
  return response.blob();
}

export function adminProfilePictureUrl(fileName) {
  return fileName ? `${API_URL}/api/admin/profile-picture/${encodeURIComponent(fileName)}` : "";
}

export const profilePictureUrl = adminProfilePictureUrl;

export async function removeSiteAsset(key) {
  const token = getSessionToken();
  const response = await fetch(`${API_URL}/api/site-assets/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  if (!response.ok) {
    let message = "Could not restore the default image.";
    try {
      const result = await response.json();
      message = result.error || message;
    } catch {
      // Keep the delete error visible if the server response is not JSON.
    }
    throw new Error(message);
  }
}

export async function apiRequest(path, options = {}) {
  const token = getSessionToken();
  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || "Request failed. Please try again.");
    error.details = result.details;
    throw error;
  }
  return result;
}

export async function uploadReservationDocument(reservationId, file) {
  const token = getSessionToken();
  const form = new FormData();
  form.append("reservationId", String(reservationId));
  form.append("document", file);
  const response = await fetch(`${API_URL}/api/documents`, {
    method: "POST",
    headers: token ? { Authorization: "Bearer " + token } : {},
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Upload failed. Please try again.");
  return result;
}

export async function downloadDocument(documentId) {
  const token = getSessionToken();
  const response = await fetch(`${API_URL}/api/documents/${documentId}/download`, {
    headers: token ? { Authorization: "Bearer " + token } : {},
  });
  if (!response.ok) {
    let message = "Could not open the attachment.";
    try {
      const result = await response.json();
      message = result.error || message;
    } catch {
      // Keep the download error visible if the server response is not JSON.
    }
    throw new Error(message);
  }
  return response.blob();
}

export function saveSession({ user, token }, rememberMe = true) {
  const storage = rememberMe ? localStorage : sessionStorage;
  const otherStorage = storage === localStorage ? sessionStorage : localStorage;
  otherStorage.removeItem("user");
  otherStorage.removeItem("token");
  storage.setItem("user", JSON.stringify(user));
  storage.setItem("token", token);
}

export function getSessionToken() {
  return sessionStorage.getItem("token") || localStorage.getItem("token");
}

export function getSessionUser() {
  const user = sessionStorage.getItem("user") || localStorage.getItem("user");
  return user ? JSON.parse(user) : null;
}

export function saveSessionUser(user) {
  const storage = sessionStorage.getItem("user") ? sessionStorage : localStorage;
  storage.setItem("user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("user");
  localStorage.removeItem("token");
  sessionStorage.removeItem("user");
  sessionStorage.removeItem("token");
  localStorage.removeItem("isAdminAuthenticated");
}

export async function logoutSession() {
  await apiRequest("/auth/logout", { method: "POST" });
  clearSession();
}

export function toDashboardReservation(reservation) {
  const dateOptions = { month: "short", day: "numeric", year: "numeric" };
  const customer = reservation.guestName
    || [reservation.firstName, reservation.lastName].filter(Boolean).join(" ")
    || "Guest";
  const amount = reservation.total ?? reservation.totalAmount ?? 0;

  return {
    id: reservation.reference,
    reservationId: reservation.id,
    guestEmail: reservation.guestEmail || "",
    guestPhone: reservation.guestPhone || "",
    bookingType: reservation.bookingType || "Online",
    checkIn: reservation.checkIn || "",
    preferredTime: reservation.preferredTime || "",
    checkOut: reservation.checkOut || "",
    checkOutTime: reservation.checkOutTime || "",
    sameDayCheckout: Boolean(reservation.sameDayCheckout),
    durationMinutes: reservation.durationMinutes || 0,
    customer,
    init: customer.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    roomCode: reservation.room || "",
    room: reservation.roomName || reservation.room,
    checkin: new Date(`${reservation.checkIn}T00:00:00`).toLocaleDateString("en-PH", dateOptions),
    checkout: `${new Date(`${reservation.checkOut}T00:00:00`).toLocaleDateString("en-PH", dateOptions)}${reservation.checkOutTime ? ` · ${formatArrivalTime(reservation.checkOutTime)}` : ""}${reservation.sameDayCheckout ? ` · ${reservation.durationMinutes / 60} hours` : ""}`,
    pax: reservation.guests,
    amount: `₱${Number(amount).toLocaleString("en-PH")}`,
    status: reservation.status,
    createdAt: reservation.createdAt || "",
  };
}

export function reservationStatusLabel(status) {
  return status === "Pending" ? "Awaiting Customer Arrival" : status;
}
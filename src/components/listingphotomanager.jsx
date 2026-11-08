import { useEffect, useRef, useState } from "react";
import { apiRequest, fetchListingPhoto, uploadListingPhoto } from "../api";

function resizeListingPhoto(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const ratio = Math.min(1, maxWidth / image.naturalWidth, maxWidth / image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not resize this photo.")), "image/webp", 0.86);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This photo could not be opened."));
    };
    image.src = objectUrl;
  });
}

export default function ListingPhotoManager({ service }) {
  const [opened, setOpened] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [draggedPhotoId, setDraggedPhotoId] = useState(null);
  const photoUrls = useRef([]);

  useEffect(() => () => photoUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function loadPhotos() {
    setLoading(true);
    setMessage("");
    const generatedUrls = [];
    try {
      const result = await apiRequest(`/services/${encodeURIComponent(service.code)}/photos`);
      const nextPhotos = await Promise.all(result.photos.map(async (photo) => {
        const thumbnailUrl = await fetchListingPhoto(service.code, photo.id, "thumbnail");
        generatedUrls.push(thumbnailUrl);
        return { ...photo, thumbnailUrl };
      }));
      photoUrls.current.forEach((url) => URL.revokeObjectURL(url));
      photoUrls.current = generatedUrls;
      setPhotos(nextPhotos);
    } catch (error) {
      generatedUrls.forEach((url) => URL.revokeObjectURL(url));
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleOpen() {
    const next = !opened;
    setOpened(next);
    if (next) await loadPhotos();
  }

  async function uploadFiles(event) {
    const files = [...event.target.files];
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setMessage("");
    try {
      for (const file of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          throw new Error("Choose JPG, PNG, or WEBP photos.");
        }
        if (file.size > 10 * 1024 * 1024) throw new Error("Each photo must be no larger than 10 MB.");
        const [large, medium, thumbnail] = await Promise.all([
          resizeListingPhoto(file, 1600),
          resizeListingPhoto(file, 900),
          resizeListingPhoto(file, 400),
        ]);
        await uploadListingPhoto(service.code, { large, medium, thumbnail }, file.name.replace(/\.[^.]+$/, "").slice(0, 250));
      }
      await loadPhotos();
      setMessage(`${files.length} photo${files.length === 1 ? "" : "s"} uploaded.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function updatePhoto(id, updates) {
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/services/${encodeURIComponent(service.code)}/photos/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      await loadPhotos();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePhoto(photo) {
    if (!window.confirm("Delete this listing photo?")) return;
    setBusy(true);
    setMessage("");
    try {
      await apiRequest(`/services/${encodeURIComponent(service.code)}/photos/${photo.id}`, { method: "DELETE" });
      await loadPhotos();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="listing-photo-manager">
      <button type="button" className="listing-photo-manager-toggle" onClick={toggleOpen} aria-expanded={opened}>
        {opened ? "Close photo manager" : "Manage listing photos"}
      </button>
      {opened && (
        <div className="listing-photo-manager-body">
          <label className="listing-photo-upload">
            {busy ? "Uploading or saving…" : "Upload photos"}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy}
              onChange={uploadFiles} />
          </label>
          <small>JPG, PNG, or WEBP · 10 MB max each. Photos are resized to gallery versions in your browser.</small>
          {loading && <p role="status">Loading listing photos…</p>}
          {message && <p role={message.toLowerCase().includes("could not") || message.toLowerCase().includes("must") || message.toLowerCase().includes("choose") ? "alert" : "status"}>{message}</p>}
          <ol className="listing-photo-manager-list">
            {photos.map((photo, index) => (
              <li
                key={photo.id}
                draggable={!busy}
                onDragStart={() => setDraggedPhotoId(photo.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedPhotoId && draggedPhotoId !== photo.id) {
                    updatePhoto(draggedPhotoId, { sortOrder: index });
                  }
                  setDraggedPhotoId(null);
                }}
                onDragEnd={() => setDraggedPhotoId(null)}
                aria-label={`Photo ${index + 1}${index === 0 ? ", cover photo" : ""}. Drag to reorder.`}
              >
                <img src={photo.thumbnailUrl} alt={photo.alt || `${service.name}, photo ${index + 1}`} />
                <label>
                  Alt text
                  <input value={photo.alt} maxLength={250} disabled={busy}
                    onChange={(event) => setPhotos((current) => current.map((item) =>
                      item.id === photo.id ? { ...item, alt: event.target.value } : item))}
                    onBlur={(event) => updatePhoto(photo.id, { alt: event.target.value })} />
                </label>
                <div className="listing-photo-manager-actions">
                  <button type="button" disabled={busy || index === 0} onClick={() => updatePhoto(photo.id, { sortOrder: index - 1 })}>Move up</button>
                  <button type="button" disabled={busy || index === photos.length - 1} onClick={() => updatePhoto(photo.id, { sortOrder: index + 1 })}>Move down</button>
                  {index === 0 && <strong>Cover photo</strong>}
                  <button type="button" disabled={busy} onClick={() => deletePhoto(photo)}>Delete</button>
                </div>
              </li>
            ))}
            {!loading && photos.length === 0 && <li>No uploaded gallery photos. The existing listing image will be shown.</li>}
          </ol>
        </div>
      )}
    </div>
  );
}

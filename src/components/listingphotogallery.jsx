import { useEffect, useRef, useState } from "react";

function PhotoFallback({ title }) {
  return (
    <span className="listing-gallery-fallback" role="img" aria-label={`${title} photo unavailable`}>
      <i className="bi bi-image" aria-hidden="true" />
      <span>Photo unavailable</span>
    </span>
  );
}

export default function ListingPhotoGallery({
  title,
  photos,
  favorite,
  savingFavorite,
  onSave,
  onShare,
  shareMessage,
}) {
  const [activeIndex, setActiveIndex] = useState(null);
  const [mobileIndex, setMobileIndex] = useState(0);
  const [brokenPhotos, setBrokenPhotos] = useState({});
  const photoButtons = useRef([]);
  const closeButton = useRef(null);
  const touchStart = useRef(null);
  const returnFocus = useRef(null);
  const photoCount = photos.length;

  useEffect(() => {
    setBrokenPhotos({});
    setMobileIndex(0);
  }, [photos]);

  useEffect(() => {
    if (activeIndex === null) return undefined;
    returnFocus.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setActiveIndex(null);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % photoCount);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + photoCount) % photoCount);
      } else if (event.key === "Tab") {
        const dialog = document.querySelector(".listing-gallery-viewer");
        if (!dialog) return;
        const controls = [...dialog.querySelectorAll("button:not(:disabled)")];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocus.current?.focus();
    };
  }, [activeIndex !== null, photoCount]);

  function showPhoto(index) {
    setActiveIndex(index);
  }

  function handleMobileScroll(event) {
    const width = event.currentTarget.clientWidth;
    if (width) setMobileIndex(Math.round(event.currentTarget.scrollLeft / width));
  }

  function swipeViewer(event) {
    if (touchStart.current === null) return;
    const distance = event.changedTouches[0].clientX - touchStart.current;
    touchStart.current = null;
    if (Math.abs(distance) < 40) return;
    setActiveIndex((index) => (index + (distance < 0 ? 1 : -1) + photoCount) % photoCount);
  }

  const photoButton = (photo, index, className = "") => (
    <button
      type="button"
      key={`${photo.url}-${index}`}
      ref={(element) => { photoButtons.current[index] = element; }}
      className={`listing-gallery-photo ${className}`}
      onClick={() => showPhoto(index)}
      aria-label={`View photo ${index + 1} of ${photoCount}`}
    >
      {brokenPhotos[index]
        ? <PhotoFallback title={title} />
        : <img
            src={photo.mediumUrl || photo.url}
            alt={photo.alt || `${title}, photo ${index + 1}`}
            loading={index === 0 ? "eager" : "lazy"}
            onError={() => setBrokenPhotos((current) => ({ ...current, [index]: true }))}
          />}
    </button>
  );

  return (
    <section className="listing-gallery-section" aria-label={`${title} photos`}>
      <div className="listing-gallery-title-row">
        <h1>{title}</h1>
        <div className="listing-gallery-actions">
          <button type="button" className="listing-gallery-action" onClick={onShare} aria-label="Share this listing">
            <i className="bi bi-share" aria-hidden="true" /><span>Share</span>
          </button>
          <button type="button" className="listing-gallery-action" onClick={onSave} disabled={savingFavorite}
            aria-label={favorite ? "Remove this listing from saved listings" : "Save this listing"}
            aria-pressed={favorite}>
            <i className={`bi ${favorite ? "bi-heart-fill" : "bi-heart"}`} aria-hidden="true" />
            <span>{favorite ? "Saved" : "Save"}</span>
          </button>
        </div>
      </div>

      {shareMessage && <p className="listing-gallery-toast" role="status">{shareMessage}</p>}

      {photoCount === 0 ? (
        <div className="listing-gallery-empty">
          <PhotoFallback title={title} />
        </div>
      ) : (
        <>
          <div className={`listing-gallery-grid listing-gallery-count-${Math.min(photoCount, 5)}`}>
            {photos.slice(0, 5).map((photo, index) => photoButton(photo, index))}
            {photoCount > 1 && (
              <button type="button" className="listing-gallery-show-all" onClick={() => showPhoto(0)}>
                <i className="bi bi-grid-3x3-gap" aria-hidden="true" /> Show all photos
              </button>
            )}
          </div>
          <div className="listing-gallery-mobile">
            <div className="listing-gallery-carousel" onScroll={handleMobileScroll}>
              {photos.map((photo, index) => (
                <div className="listing-gallery-slide" key={`${photo.url}-${index}`}>
                  {photoButton(photo, index)}
                </div>
              ))}
            </div>
            <span className="listing-gallery-counter" aria-live="polite">
              {mobileIndex + 1}/{photoCount}
            </span>
          </div>
        </>
      )}

      {activeIndex !== null && photoCount > 0 && (
        <div className="listing-gallery-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setActiveIndex(null);
        }}>
          <div className="listing-gallery-viewer" role="dialog" aria-modal="true" aria-label={`${title} photo viewer`}>
            <div className="listing-gallery-viewer-header">
              <button ref={closeButton} type="button" className="listing-gallery-viewer-close"
                onClick={() => setActiveIndex(null)} aria-label="Close photo viewer">
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
              <span>{activeIndex + 1} / {photoCount}</span>
              <span />
            </div>
            <div className="listing-gallery-viewer-image"
              onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
              onTouchEnd={swipeViewer}>
              <button type="button" className="listing-gallery-arrow" onClick={() =>
                setActiveIndex((activeIndex - 1 + photoCount) % photoCount)} aria-label="Previous photo">
                <i className="bi bi-chevron-left" aria-hidden="true" />
              </button>
              {brokenPhotos[activeIndex]
                ? <PhotoFallback title={title} />
                : <img src={photos[activeIndex].url} alt={photos[activeIndex].alt || `${title}, photo ${activeIndex + 1}`} />}
              <button type="button" className="listing-gallery-arrow" onClick={() =>
                setActiveIndex((activeIndex + 1) % photoCount)} aria-label="Next photo">
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </button>
            </div>
            <div className="listing-gallery-thumbnails" aria-label="Choose a photo">
              {photos.map((photo, index) => (
                <button key={`${photo.url}-thumb-${index}`} type="button"
                  className={index === activeIndex ? "is-current" : ""}
                  onClick={() => setActiveIndex(index)} aria-label={`Show photo ${index + 1}`}>
                  <img src={photo.thumbnailUrl || photo.mediumUrl || photo.url}
                    alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

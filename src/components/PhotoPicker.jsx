import { useState } from "react";

// The two ways to attach invoice photos, side by side:
// - "Take photo" opens the camera directly (capture). One shot per tap; tap again for the next
//   page — phones don't allow several camera shots from one tap.
// - "Choose existing" has no capture, so the phone offers its photo library and files, and
//   `multiple` lets several be picked at once.
// Both inputs are remounted after every pick so the same button can be used again and again.
export function PhotoPicker({ onPick, hasPhotos = false, disabled = false }) {
  const [key, setKey] = useState(0);

  function handleChange(e) {
    const picked = Array.from(e.target.files ?? []);
    setKey((k) => k + 1);
    if (picked.length > 0) onPick(picked);
  }

  return (
    <div className="photo-pick">
      <label className={`camera-btn${disabled ? " is-disabled" : ""}`}>
        {hasPhotos ? "Take another" : "Take photo"}
        <input
          key={`cam-${key}`}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          onChange={handleChange}
        />
      </label>
      <label className={`camera-btn camera-btn-alt${disabled ? " is-disabled" : ""}`}>
        {hasPhotos ? "Add existing" : "Choose existing"}
        <input
          key={`lib-${key}`}
          type="file"
          accept="image/*,application/pdf"
          multiple
          disabled={disabled}
          onChange={handleChange}
        />
      </label>
    </div>
  );
}

// A small square preview with a remove (×) button. Shows "PDF" for PDFs, and a plain "Photo"
// tile for images the browser can't preview (e.g. HEIC outside Safari).
export function PhotoTile({ src, label, isPdf = false, href, onRemove }) {
  const [broken, setBroken] = useState(false);
  const inner =
    src && !isPdf && !broken ? (
      <img src={src} alt={label} onError={() => setBroken(true)} />
    ) : (
      <span className="photo-tile-file">{isPdf ? "PDF" : "Photo"}</span>
    );

  return (
    <div className="photo-tile">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" title="Open full size">
          {inner}
        </a>
      ) : (
        inner
      )}
      {onRemove && (
        <button type="button" className="photo-tile-remove" aria-label={`Remove ${label}`} onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}

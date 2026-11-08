import { useEffect, useState } from "react";
import { downloadDocument } from "../api";

export default function MessageAttachment({ attachment, onConfirmPayment, confirming = false }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let isCurrent = true;
    let objectUrl = "";
    downloadDocument(attachment.id)
      .then((blob) => {
        if (!isCurrent) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setError("");
      })
      .catch((requestError) => {
        if (isCurrent) setError(requestError.message);
      });
    return () => {
      isCurrent = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id]);

  return (
    <div style={{ marginTop: 10, border: "1px solid #FED7AA", borderRadius: 10, padding: 10, background: "#fff" }}>
      <strong style={{ display: "block", fontSize: 12 }}>Payment proof · {attachment.reservation}</strong>
      <span style={{ display: "block", color: "#6B7280", fontSize: 12 }}>{attachment.originalName}</span>
      {error && <p role="alert" style={{ color: "#b42318", fontSize: 12, margin: "8px 0 0" }}>{error}</p>}
      {!url && !error && <p style={{ color: "#6B7280", fontSize: 12, margin: "8px 0 0" }}>Loading screenshot…</p>}
      {url && attachment.mimeType.startsWith("image/") && (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={`Payment proof for booking ${attachment.reservation}`} style={{ display: "block", maxWidth: "100%", maxHeight: 260, objectFit: "contain", marginTop: 8, borderRadius: 6 }} />
        </a>
      )}
      {url && (
        <a href={url} download={attachment.originalName} style={{ display: "inline-block", marginTop: 8, color: "#C2410C", fontWeight: 700, fontSize: 12 }}>
          Download screenshot
        </a>
      )}
      {attachment.paymentStatus && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#374151" }}>
          Payment: <strong>{attachment.paymentStatus}</strong>
          {attachment.paymentAmount !== null && ` · ₱${Number(attachment.paymentAmount).toLocaleString("en-PH")}`}
        </p>
      )}
      {onConfirmPayment && attachment.paymentStatus === "Pending" && attachment.paymentId && (
        <button type="button" disabled={confirming} onClick={() => onConfirmPayment(attachment)} style={{ display: "block", marginTop: 10, border: 0, borderRadius: 8, padding: "8px 12px", background: "#15803D", color: "#fff", fontWeight: 700, cursor: confirming ? "wait" : "pointer" }}>
          {confirming ? "Confirming…" : "Confirm payment received"}
        </button>
      )}
    </div>
  );
}

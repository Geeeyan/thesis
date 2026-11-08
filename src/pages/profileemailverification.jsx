import { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/navbar";
import { apiRequest } from "../api";
import "../style.css";

export default function ProfileEmailVerification() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") || "");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  async function confirmEmail() {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest("/profile/email-verification/confirm", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setMessage(result.message);
      setComplete(true);
      window.history.replaceState({}, "", window.location.pathname);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="user-dashboard profile-settings-page">
        <div className="user-dashboard-content profile-settings-content">
          <section className="profile-settings-card">
            <p className="user-section-eyebrow">ACCOUNT VERIFICATION</p>
            <h1>{complete ? "Email address confirmed" : "Confirm your email address"}</h1>
            {message && <p className="user-dashboard-notice" role="status">{message}</p>}
            {error && <p className="user-dashboard-error" role="alert">{error}</p>}
            {!token && !complete && <p className="user-dashboard-error" role="alert">This confirmation link is incomplete. Request a new link from Profile Settings.</p>}
            {token && !complete && (
              <button type="button" className="user-primary-button" disabled={loading} onClick={confirmEmail}>
                {loading ? "Confirming…" : "Confirm email address"}
              </button>
            )}
            <p><Link to="/login">Continue to sign in</Link></p>
          </section>
        </div>
      </main>
    </>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/navbar";
import PasswordInputControl from "../components/passwordinput";
import {
  apiRequest,
  clearSession,
  downloadProfileExport,
  getSessionUser,
  profilePictureUrl,
  saveSessionUser,
  updateProfileDetails,
  uploadProfileAvatar,
} from "../api";
import "../style.css";

const EMPTY_PROFILE = {
  name: "",
  nickname: "",
  email: "",
  phone: "",
  address: "",
};

function friendlyDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(`${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function deviceName(userAgent = "") {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Firefox\//.test(userAgent) ? "Firefox"
    : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /Windows/.test(userAgent) ? "Windows" : /Mac OS/.test(userAgent) ? "macOS"
    : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS"
      : /Linux/.test(userAgent) ? "Linux" : "Device";
  return `${browser} on ${os}`;
}

function ProfileInput({ id, label, value, disabled, onChange, type = "text", required = false, autoComplete }) {
  return (
    <label className="profile-settings-field" htmlFor={id}>
      {label}
      <input id={id} type={type} value={value} disabled={disabled} required={required}
        autoComplete={autoComplete} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ProfileSelect({ id, label, value, options, disabled, onChange }) {
  return (
    <label className="profile-settings-field" htmlFor={id}>
      {label}
      <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function PasswordInput({ id, label, value, onChange, autoComplete = "current-password" }) {
  return (
    <label className="profile-settings-field" htmlFor={id}>
      {label}
      <PasswordInputControl id={id} value={value} onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete} required className="profile-settings-password-input" />
    </label>
  );
}

export default function ProfileSettings() {
  const [user, setUser] = useState(getSessionUser());
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarPassword, setAvatarPassword] = useState("");
  const [sessions, setSessions] = useState([]);
  const [loginActivity, setLoginActivity] = useState([]);
  const [auditEntries, setAuditEntries] = useState([]);
  const [accountRequests, setAccountRequests] = useState([]);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [policyAcceptance, setPolicyAcceptance] = useState(null);
  const [consents, setConsents] = useState({
    email_notifications: { enabled: false, updatedAt: null },
    marketing: { enabled: false, updatedAt: null },
  });
  const [form, setForm] = useState({ currentPassword: "", password: "", confirmPassword: "" });
  const [securityCode, setSecurityCode] = useState("");
  const [emailChange, setEmailChange] = useState({ email: "", currentPassword: "" });
  const [showSecondaryEmailModal, setShowSecondaryEmailModal] = useState(false);
  const [secondaryEmail, setSecondaryEmail] = useState({ email: "", currentPassword: "" });
  const [secondaryEmailError, setSecondaryEmailError] = useState("");
  const [sessionPassword, setSessionPassword] = useState("");
  const [requestPassword, setRequestPassword] = useState("");
  const [requestType, setRequestType] = useState("deactivation");
  const [exportPassword, setExportPassword] = useState("");
  const [exportBusy, setExportBusy] = useState(false);

  const loadSecondary = useCallback(async () => {
    const [sessionResult, loginResult, auditResult, requestResult] = await Promise.all([
      apiRequest("/profile/sessions"),
      apiRequest("/profile/login-activity"),
      apiRequest("/profile/audit-log"),
      apiRequest("/profile/account-requests"),
    ]);
    setSessions(sessionResult.sessions);
    setLoginActivity(loginResult.activity);
    setAuditEntries(auditResult.entries);
    setAccountRequests(requestResult.requests);
  }, []);

  const refreshProfile = useCallback(async () => {
    const result = await apiRequest("/profile");
    setUser(result.user);
    saveSessionUser(result.user);
    setProfile({
      name: result.user.name || "",
      nickname: result.user.nickname || "",
      email: result.user.email || "",
      phone: result.user.phone || "",
      address: result.user.address || "",
    });
    setTwoFactorEnabled(result.twoFactorEnabled);
    setConsents(result.consents);
    setPolicyAcceptance(result.policyAcceptance);
    setEmails(result.emails || []);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([refreshProfile(), loadSecondary()])
      .catch((error) => { if (active) setPageError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadSecondary, refreshProfile]);

  const avatar = avatarPreview || (user?.profileImage ? profilePictureUrl(user.profileImage) : "");
  const dateToday = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const normalizedQuery = query.trim().toLowerCase();
  const visibleAccountFields = [
    { key: "name", label: "Full name", type: "input", required: true },
    { key: "nickname", label: "Nickname", type: "input" },
    { key: "email", label: "Email address", type: "input", readOnly: true },
    { key: "phone", label: "Phone number", type: "input", inputType: "tel" },
    { key: "address", label: "Address (optional)", type: "input" },
  ].filter((field) => `${field.label} ${profile[field.key]}`.toLowerCase().includes(normalizedQuery));

  function setProfileField(key, value) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  function cancelEdit() {
    setProfile({
      name: user?.name || "",
      nickname: user?.nickname || "",
      email: user?.email || "",
      phone: user?.phone || "",
      address: user?.address || "",
    });
    setEditing(false);
    setPageError("");
    setNotice("");
  }

  async function saveProfile(event) {
    event.preventDefault();
    setPageError("");
    setNotice("");
    if (!profile.name.trim()) return setPageError("Enter your full name.");
    setSaving(true);
    try {
      const result = await updateProfileDetails({
        name: profile.name.trim(),
        nickname: profile.nickname.trim(),
        phone: profile.phone.trim(),
        address: profile.address.trim(),
      });
      setUser(result.user);
      saveSessionUser(result.user);
      setEditing(false);
      setNotice("Your account details have been saved.");
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function changeAvatar(file) {
    setNotice("");
    setPageError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setPageError("Choose a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPageError("Choose an image no larger than 10 MB.");
      return;
    }
    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);
    setAvatarBusy(true);
    try {
      const updatedUser = await uploadProfileAvatar(file, avatarPassword);
      setUser(updatedUser);
      saveSessionUser(updatedUser);
      setAvatarPassword("");
      setNotice("Your profile photo has been updated.");
      await loadSecondary();
    } catch (error) {
      setAvatarPreview("");
      setPageError(error.message);
    } finally {
      URL.revokeObjectURL(preview);
      setAvatarPreview("");
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setPageError("");
    setNotice("");
    setAvatarBusy(true);
    try {
      if (!avatarPassword) return setPageError("Enter your password to remove your profile photo.");
      const result = await apiRequest("/profile/avatar", {
        method: "DELETE",
        body: JSON.stringify({ currentPassword: avatarPassword }),
      });
      setUser(result.user);
      saveSessionUser(result.user);
      setAvatarPassword("");
      setNotice("Your profile photo has been removed.");
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function requestEmailChange(event) {
    event.preventDefault();
    setPageError("");
    setNotice("");
    try {
      const result = await apiRequest("/profile/email-verification", {
        method: "POST",
        body: JSON.stringify(emailChange),
      });
      setNotice(result.message);
      setEmailChange({ email: "", currentPassword: "" });
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function addSecondaryEmail(event) {
    event.preventDefault();
    setSecondaryEmailError("");
    try {
      const result = await apiRequest("/profile/secondary-emails", {
        method: "POST",
        body: JSON.stringify(secondaryEmail),
      });
      setShowSecondaryEmailModal(false);
      setSecondaryEmail({ email: "", currentPassword: "" });
      setNotice(result.message);
      await loadSecondary();
    } catch (error) {
      setSecondaryEmailError(error.message);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPageError("");
    setNotice("");
    if (form.password !== form.confirmPassword) return setPageError("The new passwords do not match.");
    if (new TextEncoder().encode(form.password).length > 72) return setPageError("Your password is too long (72 bytes max).");
    try {
      const result = await apiRequest("/profile/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword: form.currentPassword, password: form.password }),
      });
      setForm({ currentPassword: "", password: "", confirmPassword: "" });
      setNotice(result.message);
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function beginTwoFactor(event) {
    event.preventDefault();
    setPageError("");
    setNotice("");
    if (!twoFactorPassword) return setPageError("Enter your current password to start two-factor setup.");
    try {
      const result = await apiRequest("/profile/two-factor/setup", {
        method: "POST",
        body: JSON.stringify({ currentPassword: twoFactorPassword }),
      });
      setTwoFactorSecret(result.secret);
      setSecurityCode("");
      setRecoveryCodes([]);
      setTwoFactorPassword("");
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function enableTwoFactor(event) {
    event.preventDefault();
    setPageError("");
    try {
      const result = await apiRequest("/profile/two-factor/enable", {
        method: "POST",
        body: JSON.stringify({ code: securityCode }),
      });
      setTwoFactorEnabled(true);
      setTwoFactorSecret("");
      setSecurityCode("");
      setRecoveryCodes(result.recoveryCodes);
      setNotice("Two-factor authentication is enabled. Save these recovery codes somewhere safe.");
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function disableTwoFactor(event) {
    event.preventDefault();
    setPageError("");
    setNotice("");
    if (!window.confirm("Disable two-factor authentication for this account?")) return;
    try {
      await apiRequest("/profile/two-factor", {
        method: "DELETE",
        body: JSON.stringify({ currentPassword: form.currentPassword, code: securityCode }),
      });
      setTwoFactorEnabled(false);
      setSecurityCode("");
      setForm((current) => ({ ...current, currentPassword: "" }));
      setNotice("Two-factor authentication has been disabled.");
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function updateConsent(type, enabled) {
    setPageError("");
    setNotice("");
    const next = Object.fromEntries(Object.entries(consents).map(([key, value]) => [key, value.enabled]));
    next[type] = enabled;
    try {
      const result = await apiRequest("/profile/consents", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setConsents(result.consents);
      setNotice("Your privacy preferences have been saved.");
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function logoutSession(sessionId) {
    setPageError("");
    setNotice("");
    if (!sessionPassword) return setPageError("Enter your password to log out a device.");
    try {
      const result = await apiRequest(`/profile/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        body: JSON.stringify({ currentPassword: sessionPassword }),
      });
      setSessionPassword("");
      if (result.current) {
        clearSession();
        setNotice("This device has been logged out.");
        window.setTimeout(() => { window.location.assign("/"); }, 500);
      } else {
        setNotice("The selected device has been logged out.");
        await loadSecondary();
      }
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function logoutOtherSessions() {
    setPageError("");
    setNotice("");
    if (!sessionPassword) return setPageError("Enter your password to log out other devices.");
    try {
      const result = await apiRequest("/profile/sessions/logout-others", {
        method: "POST",
        body: JSON.stringify({ currentPassword: sessionPassword }),
      });
      setSessionPassword("");
      setNotice(`${result.count} other session${result.count === 1 ? "" : "s"} logged out.`);
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    }
  }

  async function requestExport(event) {
    event.preventDefault();
    setPageError("");
    setNotice("");
    setExportBusy(true);
    try {
      const result = await apiRequest("/profile/data-exports", {
        method: "POST",
        body: JSON.stringify({ currentPassword: exportPassword }),
      });
      const blob = await downloadProfileExport(result.requestId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "villa-tjeozabel-personal-data.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportPassword("");
      setNotice("Your data export has been downloaded.");
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    } finally {
      setExportBusy(false);
    }
  }

  async function requestAccountChange(event) {
    event.preventDefault();
    setPageError("");
    setNotice("");
    if (!window.confirm(`Submit a ${requestType} request for your account? It will be reviewed before any action is taken.`)) return;
    try {
      const result = await apiRequest("/profile/account-requests", {
        method: "POST",
        body: JSON.stringify({ type: requestType, currentPassword: requestPassword }),
      });
      setRequestPassword("");
      setNotice(`Your ${result.request.type} request has been submitted for review.`);
      await loadSecondary();
    } catch (error) {
      setPageError(error.message);
    }
  }

  const filteredActivity = auditEntries.filter((entry) =>
    `${entry.action} ${JSON.stringify(entry.details)} ${entry.ipAddress}`.toLowerCase().includes(normalizedQuery));

  return (
    <>
      <Navbar />
      <main className="user-dashboard profile-settings-page">
        <div className="user-dashboard-content profile-settings-content">
          <header className="user-dashboard-hero profile-settings-hero">
            <div>
              <p className="user-dashboard-eyebrow">PROFILE SETTINGS</p>
              <h1>Welcome, {user?.name || "there"}</h1>
              <p>{dateToday}</p>
            </div>
            <div className="profile-settings-tools">
              <label className="profile-settings-search">
                <i className="bi bi-search" aria-hidden="true" />
                <input type="search" aria-label="Search profile settings" placeholder="Search settings"
                  value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
              <Link className="profile-settings-notifications" to={user?.role === "admin" ? "/admin/dashboard" : user?.role === "staff" ? "/staff/dashboard" : "/user/dashboard"} aria-label="Dashboard and notifications">
                <i className="bi bi-bell" aria-hidden="true" />
              </Link>
            </div>
          </header>

          {notice && <p className="user-dashboard-notice profile-settings-notice" role="status">{notice}</p>}
          {pageError && <p className="user-dashboard-error profile-settings-form-error" role="alert">{pageError}</p>}
          {loading && <div className="user-dashboard-notice" role="status">Loading your profile settings…</div>}
          {!loading && !user && <p className="user-dashboard-error" role="alert">Your profile could not be loaded. Please sign in again.</p>}

          {!loading && user && (
            <div className="profile-settings-sections">
              <section className="profile-settings-card" aria-labelledby="profile-photo-heading">
                <div className="profile-settings-section-heading">
                  <div>
                    <p className="user-section-eyebrow">PROFILE</p>
                    <h2 id="profile-photo-heading">Avatar / profile picture</h2>
                  </div>
                </div>
                <div className="profile-settings-summary-body profile-settings-avatar-section">
                  <div className="profile-settings-avatar-wrap">
                    {avatar
                      ? <img className="profile-settings-avatar" src={avatar} alt={`${user.name}'s profile`} />
                      : <span className="profile-settings-avatar profile-settings-avatar-fallback" aria-hidden="true">{String(user.name || "U").trim().slice(0, 1).toUpperCase()}</span>}
                  </div>
                  <div className="profile-settings-summary-text">
                    <h3>{user.name}</h3>
                    <p>{user.email}</p>
                    <small>JPG, PNG, or WEBP · maximum 10 MB</small>
                  </div>
                  <div className="profile-settings-avatar-actions">
                    <PasswordInput id="avatar-current-password" label="Confirm password for photo changes"
                      value={avatarPassword} onChange={setAvatarPassword} />
                    <label className="user-primary-button profile-settings-file-button">
                      {avatarBusy ? "Uploading…" : "Upload photo"}
                      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={avatarBusy}
                        onChange={(event) => { changeAvatar(event.target.files?.[0]); event.target.value = ""; }} />
                    </label>
                    {user.profileImage && (
                      <button type="button" className="user-secondary-button" disabled={avatarBusy} onClick={removeAvatar}>Remove photo</button>
                    )}
                  </div>
                </div>
              </section>

              <section className="profile-settings-card" aria-labelledby="account-details-heading">
                <div className="profile-settings-section-heading">
                  <div>
                    <p className="user-section-eyebrow">ACCOUNT & CONTACT DETAILS</p>
                    <h2 id="account-details-heading">Personal information</h2>
                  </div>
                  {!editing ? (
                    <button type="button" className="user-primary-button" onClick={() => { setEditing(true); setNotice(""); setPageError(""); }}>Edit</button>
                  ) : (
                    <div className="profile-settings-edit-actions">
                      <button type="button" className="user-secondary-button" disabled={saving} onClick={cancelEdit}>Cancel</button>
                      <button type="submit" form="profile-details-form" className="user-primary-button" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                    </div>
                  )}
                </div>
                <form id="profile-details-form" onSubmit={saveProfile}>
                  {visibleAccountFields.length ? (
                    <div className="profile-settings-grid">
                      {visibleAccountFields.map((field) => field.type === "select" ? (
                        <ProfileSelect key={field.key} id={`profile-${field.key}`} label={field.label}
                          value={profile[field.key]} options={field.options} disabled={!editing || saving}
                          onChange={(value) => setProfileField(field.key, value)} />
                      ) : (
                        <ProfileInput key={field.key} id={`profile-${field.key}`} label={field.label}
                          type={field.inputType || "text"} value={profile[field.key]} required={field.required}
                          disabled={!editing || field.readOnly || saving}
                          autoComplete={field.key === "email" ? "email" : field.key === "name" ? "name" : undefined}
                          onChange={(value) => setProfileField(field.key, value)} />
                      ))}
                    </div>
                  ) : <p className="user-dashboard-notice">No account fields match “{query}”.</p>}
                  <div className="profile-settings-readonly">
                    <span><strong>Role</strong>{user.role}</span>
                    <span><strong>Member since</strong>{friendlyDate(user.createdAt)}</span>
                  </div>
                </form>

                <div className="profile-settings-inline-form">
                  <div className="profile-settings-section-heading">
                    <div><h3>My email addresses</h3><p>Additional email addresses are added after confirmation.</p></div>
                    <button type="button" className="user-primary-button" onClick={() => { setSecondaryEmailError(""); setShowSecondaryEmailModal(true); }}>
                      Add email address
                    </button>
                  </div>
                  {emails.length ? (
                    <ul className="profile-settings-email-list">
                      {emails.map((item) => (
                        <li key={item.email} className="profile-settings-email">
                          <span className="profile-settings-email-icon" aria-hidden="true"><i className="bi bi-envelope" /></span>
                          <span className="profile-settings-email-copy">
                            <strong>{item.email}</strong>
                            <small>{item.primary ? "Primary · " : "Added "}{friendlyDate(item.addedAt)}</small>
                          </span>
                          {item.primary && <span className="profile-settings-primary-badge">Primary</span>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="user-dashboard-notice">No email addresses have been added yet.</p>}
                </div>

                <form className="profile-settings-inline-form" onSubmit={requestEmailChange}>
                  <div>
                    <h3>Change email address</h3>
                    <p>A confirmation link will be sent before the new address is applied.</p>
                  </div>
                  <div className="profile-settings-grid">
                    <ProfileInput id="new-profile-email" label="New email address" type="email"
                      value={emailChange.email} autoComplete="email" onChange={(email) => setEmailChange((state) => ({ ...state, email }))} />
                    <PasswordInput id="email-current-password" label="Current password"
                      value={emailChange.currentPassword} onChange={(currentPassword) => setEmailChange((state) => ({ ...state, currentPassword }))} />
                  </div>
                  <button type="submit" className="user-secondary-button">Send confirmation link</button>
                </form>
              </section>

              <section className="profile-settings-card" aria-labelledby="security-heading">
                <div className="profile-settings-section-heading">
                  <div>
                    <p className="user-section-eyebrow">SECURITY & ACCESS MANAGEMENT</p>
                    <h2 id="security-heading">Security</h2>
                  </div>
                  <span className={`profile-settings-status ${twoFactorEnabled ? "is-enabled" : ""}`}>
                    Two-factor {twoFactorEnabled ? "enabled" : "not enabled"}
                  </span>
                </div>

                <form className="profile-settings-inline-form" onSubmit={changePassword}>
                  <h3>Change password</h3>
                  <div className="profile-settings-grid">
                    <PasswordInput id="current-password" label="Current password" value={form.currentPassword}
                      onChange={(currentPassword) => setForm((state) => ({ ...state, currentPassword }))} />
                    <PasswordInput id="new-password" label="New password" autoComplete="new-password"
                      value={form.password} onChange={(password) => setForm((state) => ({ ...state, password }))} />
                    <PasswordInput id="confirm-password" label="Confirm new password" autoComplete="new-password"
                      value={form.confirmPassword} onChange={(confirmPassword) => setForm((state) => ({ ...state, confirmPassword }))} />
                  </div>
                  <div className="profile-settings-password-strength" aria-live="polite">
                    <span>Password strength</span>
                    <div className="profile-settings-strength-track"><span style={{ width: `${form.password.length >= 12 ? 100 : form.password.length >= 8 ? 65 : form.password.length ? 30 : 0}%` }} /></div>
                    <small>{form.password.length >= 12 ? "Strong" : form.password.length >= 8 ? "Meets minimum length" : "At least 8 characters"}</small>
                  </div>
                  <button type="submit" className="user-primary-button">Update password</button>
                </form>

                <div className="profile-settings-inline-form">
                  <h3>Two-factor authentication</h3>
                  <p>Use an authenticator app and recovery codes to protect your account.</p>
                  {!twoFactorEnabled && !twoFactorSecret && (
                    <form className="profile-settings-grid" onSubmit={beginTwoFactor}>
                      <PasswordInput id="two-factor-setup-password" label="Current password"
                        value={twoFactorPassword} onChange={setTwoFactorPassword} />
                      <button type="submit" className="user-secondary-button">Set up two-factor authentication</button>
                    </form>
                  )}
                  {twoFactorSecret && (
                    <form onSubmit={enableTwoFactor}>
                      <p>Add this secret to your authenticator app: <code>{twoFactorSecret}</code></p>
                      <ProfileInput id="two-factor-setup-code" label="6-digit authenticator code" value={securityCode}
                        onChange={setSecurityCode} />
                      <button type="submit" className="user-primary-button">Verify and enable</button>
                    </form>
                  )}
                  {twoFactorEnabled && (
                    <form className="profile-settings-grid" onSubmit={disableTwoFactor}>
                      <PasswordInput id="two-factor-current-password" label="Current password"
                        value={form.currentPassword} onChange={(currentPassword) => setForm((state) => ({ ...state, currentPassword }))} />
                      <ProfileInput id="two-factor-disable-code" label="Authenticator or recovery code"
                        value={securityCode} onChange={setSecurityCode} />
                      <button type="submit" className="user-secondary-button">Disable two-factor</button>
                    </form>
                  )}
                  {recoveryCodes.length > 0 && (
                    <div className="profile-settings-recovery-codes" role="status">
                      <strong>Save your recovery codes now. They will not be shown again.</strong>
                      <p>{recoveryCodes.join(" · ")}</p>
                      <button type="button" className="user-secondary-button" onClick={() => setRecoveryCodes([])}>I saved these codes</button>
                    </div>
                  )}
                </div>

                <div className="profile-settings-inline-form">
                  <div className="profile-settings-section-heading">
                    <div><h3>Active sessions and devices</h3><p>Location is shown as IP address; precise location is not available.</p></div>
                    <button type="button" className="user-secondary-button" onClick={logoutOtherSessions}>Log out all other devices</button>
                  </div>
                  <div className="profile-settings-session-password">
                    <PasswordInput id="session-current-password" label="Confirm password for session changes"
                      value={sessionPassword} onChange={setSessionPassword} />
                  </div>
                  {sessions.length ? (
                    <ul className="profile-settings-record-list">
                      {sessions.map((session) => (
                        <li key={session.id}>
                          <span><strong>{deviceName(session.userAgent)}{session.current ? " · This device" : ""}</strong>
                            <small>{session.ipAddress || "IP unavailable"} · Last active {friendlyDate(session.lastActiveAt)}</small></span>
                          {!session.current && <button type="button" className="user-secondary-button" onClick={() => logoutSession(session.id)}>Log out device</button>}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="user-dashboard-notice">No active sessions found.</p>}
                </div>

                <div className="profile-settings-inline-form">
                  <h3>Recent login activity</h3>
                  {loginActivity.length ? (
                    <ul className="profile-settings-record-list">
                      {loginActivity.map((item, index) => (
                        <li key={`${item.createdAt}-${index}`}>
                          <span><strong>{item.success ? "Successful sign-in" : "Unsuccessful sign-in"}</strong>
                            <small>{friendlyDate(item.createdAt)} · {item.ipAddress || "IP unavailable"} · {deviceName(item.userAgent)}</small></span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="user-dashboard-notice">No login activity has been recorded.</p>}
                </div>
              </section>

              <section className="profile-settings-card" aria-labelledby="compliance-heading">
                <div className="profile-settings-section-heading">
                  <div>
                    <p className="user-section-eyebrow">MANAGEMENT & COMPLIANCE</p>
                    <h2 id="compliance-heading">Privacy and account controls</h2>
                  </div>
                </div>

                <div className="profile-settings-inline-form">
                  <h3>Terms and Privacy Policy</h3>
                  <p>Terms version: {policyAcceptance?.termsVersion || "No acceptance record available"}</p>
                  <p>Privacy version: {policyAcceptance?.privacyVersion || "No acceptance record available"}</p>
                  <p>Acceptance date: {friendlyDate(policyAcceptance?.acceptedAt)}</p>
                </div>

                <div className="profile-settings-inline-form">
                  <h3>Consent preferences</h3>
                  {[
                    ["email_notifications", "Email notifications"],
                    ["marketing", "Marketing messages"],
                  ].map(([key, label]) => (
                    <label className="profile-settings-consent" key={key}>
                      <span><strong>{label}</strong><small>Updated {friendlyDate(consents[key]?.updatedAt)}</small></span>
                      <input type="checkbox" checked={Boolean(consents[key]?.enabled)}
                        onChange={(event) => updateConsent(key, event.target.checked)} />
                    </label>
                  ))}
                </div>

                <form className="profile-settings-inline-form" onSubmit={requestExport}>
                  <h3>Export personal data</h3>
                  <p>Download a copy of the account information currently available to this system.</p>
                  <div className="profile-settings-grid">
                    <PasswordInput id="export-current-password" label="Current password" value={exportPassword} onChange={setExportPassword} />
                  </div>
                  <button type="submit" className="user-secondary-button" disabled={exportBusy}>{exportBusy ? "Preparing…" : "Request data export"}</button>
                </form>

                <form className="profile-settings-inline-form" onSubmit={requestAccountChange}>
                  <h3>Account deactivation or deletion request</h3>
                  <p>Your account will not be changed immediately. A request is submitted for review.</p>
                  <div className="profile-settings-grid">
                    <ProfileSelect id="account-request-type" label="Request type" value={requestType}
                      options={[{ value: "deactivation", label: "Deactivate account" }, { value: "deletion", label: "Delete account" }]}
                      onChange={setRequestType} />
                    <PasswordInput id="account-request-password" label="Current password" value={requestPassword} onChange={setRequestPassword} />
                  </div>
                  <button type="submit" className="user-secondary-button">Submit request</button>
                  {accountRequests.length > 0 && (
                    <ul className="profile-settings-record-list">
                      {accountRequests.map((item) => <li key={item.id}><span><strong>{item.type} request · {item.status}</strong><small>{friendlyDate(item.createdAt)}</small></span></li>)}
                    </ul>
                  )}
                </form>

                <div className="profile-settings-inline-form">
                  <h3>Personal activity log</h3>
                  {filteredActivity.length ? (
                    <ul className="profile-settings-record-list">
                      {filteredActivity.map((entry, index) => (
                        <li key={`${entry.createdAt}-${index}`}>
                          <span><strong>{entry.action.replaceAll("_", " ")}</strong>
                            <small>{friendlyDate(entry.createdAt)} · {entry.ipAddress || "IP unavailable"}
                              {Object.keys(entry.details || {}).length > 0 ? ` · ${JSON.stringify(entry.details)}` : ""}</small></span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="user-dashboard-notice">No profile activity has been recorded.</p>}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
      {showSecondaryEmailModal && (
        <div className="profile-settings-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowSecondaryEmailModal(false);
        }}>
          <form className="profile-settings-modal" role="dialog" aria-modal="true"
            aria-labelledby="secondary-email-title" onSubmit={addSecondaryEmail}>
            <div className="profile-settings-section-heading">
              <div>
                <p className="user-section-eyebrow">ACCOUNT CONTACT DETAILS</p>
                <h2 id="secondary-email-title">Add email address</h2>
              </div>
              <button type="button" className="profile-settings-modal-close" aria-label="Close dialog"
                onClick={() => setShowSecondaryEmailModal(false)}>×</button>
            </div>
            <p>A confirmation link will be sent before this address is added.</p>
            <ProfileInput id="secondary-email-address" label="Email address" type="email"
              value={secondaryEmail.email} autoComplete="email"
              onChange={(email) => setSecondaryEmail((current) => ({ ...current, email }))} />
            <PasswordInput id="secondary-email-password" label="Current password"
              value={secondaryEmail.currentPassword}
              onChange={(currentPassword) => setSecondaryEmail((current) => ({ ...current, currentPassword }))} />
            {secondaryEmailError && <p className="user-dashboard-error" role="alert">{secondaryEmailError}</p>}
            <button type="submit" className="user-primary-button">Send confirmation link</button>
          </form>
        </div>
      )}
    </>
  );
}

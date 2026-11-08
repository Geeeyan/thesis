import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "../style.css";
import bgImage from "../assets/img1.jpg";
import { apiRequest, saveSession } from "../api";
import PasswordInput from "../components/passwordinput";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();

  function navigateAfterLogin(role) {
    const returnTo = location.state?.returnTo;
    if (role === "guest" && typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      navigate(returnTo, { state: location.state?.reservationState || {} });
      return;
    }
    if (role === "admin") navigate("/admin/dashboard");
    else if (role === "staff") navigate("/staff/dashboard");
    else navigate("/user/dashboard");
  }

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [resetStep, setResetStep] = useState("request");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetExpiresAt, setResetExpiresAt] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resetSecondsLeft, setResetSecondsLeft] = useState(0);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
  const [message, setMessage] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");

  useEffect(() => {
    if (!forgotPassword || resetStep !== "verify") return undefined;
    const updateCountdowns = () => {
      setResetSecondsLeft(Math.max(0, Math.ceil((resetExpiresAt - Date.now()) / 1000)));
      setResendSecondsLeft(Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)));
    };
    updateCountdowns();
    const interval = window.setInterval(updateCountdowns, 1000);
    return () => window.clearInterval(interval);
  }, [forgotPassword, resetStep, resetExpiresAt, resendAvailableAt]);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      if (session.mfaRequired) {
        setChallengeToken(session.challengeToken);
        setTwoFactorCode("");
        return;
      }
      saveSession(session, rememberMe);
      navigateAfterLogin(session.user.role);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyTwoFactor = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await apiRequest("/auth/verify-two-factor", {
        method: "POST",
        body: JSON.stringify({ challengeToken, code: twoFactorCode }),
      });
      saveSession(session, rememberMe);
      navigateAfterLogin(session.user.role);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const requestResetCode = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    const email = resetEmail.trim().toLowerCase();
    try {
      const result = await apiRequest("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResetEmail(email);
      setResetStep("verify");
      setResetCode("");
      setResetExpiresAt(Date.now() + 10 * 60 * 1000);
      setResendAvailableAt(Date.now() + 60 * 1000);
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const resendResetCode = async () => {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const result = await apiRequest("/auth/resend-reset-code", {
        method: "POST",
        body: JSON.stringify({ email: resetEmail }),
      });
      setResetCode("");
      setResetExpiresAt(Date.now() + 10 * 60 * 1000);
      setResendAvailableAt(Date.now() + 60 * 1000);
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyResetCode = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const result = await apiRequest("/auth/verify-reset-code", {
        method: "POST",
        body: JSON.stringify({ email: resetEmail, code: resetCode }),
      });
      setResetToken(result.resetToken);
      setResetStep("password");
      setMessage("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const result = await apiRequest("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ resetToken, password: newPassword, confirmPassword }),
      });
      setForgotPassword(false);
      setResetStep("request");
      setResetToken("");
      setNewPassword("");
      setConfirmPassword("");
      setResetCode("");
      setFormData((current) => ({ ...current, password: "" }));
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const showLogin = () => {
    setForgotPassword(false);
    setResetStep("request");
    setError("");
    setMessage("");
    setResetCode("");
    setResetToken("");
    setNewPassword("");
    setConfirmPassword("");
    setResetExpiresAt(0);
    setResendAvailableAt(0);
    setChallengeToken("");
    setTwoFactorCode("");
  };

  const startPasswordReset = () => {
    setForgotPassword(true);
    setResetStep("request");
    setResetEmail(formData.email);
    setError("");
    setMessage("");
    setResetCode("");
    setResetToken("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const maskedEmail = (email) => {
    const [localPart, domain] = email.split("@");
    return `${localPart?.[0] || "*"}***@${domain || ""}`;
  };

  const formattedCountdown = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div
      className="auth-wrapper"
      style={{ backgroundImage: `url(${bgImage})` }}
    >
      <div className="auth-overlay" />

      <div className="auth-card">

        <div className="auth-header">
          <div className="brand-circle mb-2" />
          <h2>{forgotPassword ? (resetStep === "request" ? "Forgot Password" : resetStep === "verify" ? "Verify Code" : "Set New Password") : challengeToken ? "Two-Factor Verification" : "Welcome Back"}</h2>
          <p>{forgotPassword ? "We'll email you a verification code" : challengeToken ? "Enter your authenticator or recovery code" : "Login to Villa Tjeozabel"}</p>
        </div>

        {forgotPassword ? (
          <form onSubmit={resetStep === "request" ? requestResetCode : resetStep === "verify" ? verifyResetCode : resetPassword}>
            {error && <p id="reset-error" role="alert" style={{ color: "#b42318" }}>{error}</p>}
            {message && <p role="status">{message}</p>}
            <p className="text-start" aria-label={`Step ${resetStep === "request" ? 1 : resetStep === "verify" ? 2 : 3} of 3`}>
              Step {resetStep === "request" ? 1 : resetStep === "verify" ? 2 : 3} of 3
            </p>
            {resetStep === "request" && (
                <div className="mb-3 text-start">
                  <label htmlFor="reset-email">Email</label>
                  <input
                    id="reset-email"
                    type="email"
                    className="form-control auth-input"
                    placeholder="Enter your account email"
                    value={resetEmail}
                    onChange={(event) => setResetEmail(event.target.value)}
                    autoComplete="email"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "reset-error" : undefined}
                    required
                  />
                </div>
            )}
            {resetStep === "verify" && (
              <>
                <p className="mb-3 text-start">Enter the code sent to <strong>{maskedEmail(resetEmail)}</strong>.</p>
                <div className="mb-3 text-start">
                  <label htmlFor="reset-code">6-digit verification code</label>
                  <input
                    id="reset-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    className="form-control auth-input"
                    placeholder="Enter the 6-digit code"
                    value={resetCode}
                    onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "reset-error" : "reset-countdown"}
                    required
                  />
                </div>
                <p id="reset-countdown" className="text-start" role="timer">
                  {resetSecondsLeft > 0 ? `Code expires in ${formattedCountdown(resetSecondsLeft)}` : "This code has expired. Request a new one."}
                </p>
                <p className="text-start">
                  Didn't receive a code?{" "}
                  <button type="button" className="btn btn-link p-0" onClick={resendResetCode} disabled={loading || resendSecondsLeft > 0}>
                    {loading ? "Sending..." : resendSecondsLeft > 0 ? `Resend in ${formattedCountdown(resendSecondsLeft)}` : "Resend code"}
                  </button>
                </p>
              </>
            )}
            {resetStep === "password" && (
              <>
                <div className="mb-3 text-start">
                  <label htmlFor="reset-new-password">New Password</label>
                  <PasswordInput
                    id="reset-new-password"
                    minLength={8}
                    autoComplete="new-password"
                    className="form-control auth-input"
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "reset-error" : undefined}
                    required
                  />
                </div>
                <div className="mb-3 text-start">
                  <label htmlFor="reset-confirm-password">Confirm New Password</label>
                  <PasswordInput
                    id="reset-confirm-password"
                    minLength={8}
                    autoComplete="new-password"
                    className="form-control auth-input"
                    placeholder="Re-enter your new password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "reset-error" : undefined}
                    required
                  />
                </div>
              </>
            )}
            <button className="btn auth-btn w-100" type="submit" disabled={loading || (resetStep === "verify" && resetSecondsLeft === 0)}>
              {loading ? "Please wait..." : resetStep === "request" ? "Send code" : resetStep === "verify" ? "Verify code" : "Set new password"}
            </button>
            <p className="auth-switch mt-3">
              <button type="button" className="btn btn-link p-0" onClick={showLogin} disabled={loading}>← Back to Login</button>
            </p>
          </form>
        ) : (
          <form onSubmit={challengeToken ? verifyTwoFactor : handleLogin}>
            {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
            {message && <p role="status">{message}</p>}
            {challengeToken ? (
              <>
                <div className="mb-3 text-start">
                  <label>Authenticator or recovery code</label>
                  <input
                    type="text"
                    autoComplete="one-time-code"
                    className="form-control auth-input"
                    placeholder="Enter your code"
                    value={twoFactorCode}
                    onChange={(event) => setTwoFactorCode(event.target.value.trim())}
                    required
                  />
                </div>
                <button type="button" className="btn btn-link p-0" onClick={showLogin}>Back to Login</button>
              </>
            ) : (
              <>
                <div className="mb-3 text-start">
                  <label>Email</label>
                  <input
                    type="email"
                    name="email"
                    className="form-control auth-input"
                    placeholder="Enter your email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="mb-2 text-start">
                  <label htmlFor="login-password">Password</label>
                  <PasswordInput
                    id="login-password"
                    name="password"
                    className="form-control auth-input"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="auth-options">
                  <label className="auth-remember" htmlFor="remember-me">
                    <input
                      id="remember-me"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                    />
                    Remember me
                  </label>
                  <button type="button" className="btn btn-link p-0" onClick={startPasswordReset}>
                    Forgot password?
                  </button>
                </div>
              </>
            )}
            <button className="btn auth-btn w-100" type="submit" disabled={loading}>
              {loading ? "Please wait..." : challengeToken ? "Verify" : "Login"}
            </button>
            {!challengeToken && <p className="auth-switch mt-3">
              Don't have an account?{" "}
              <Link to="/signup">Sign Up</Link>
            </p>}
          </form>
        )}

        <p className="auth-back">
          <Link to="/">← Back to Home</Link>
        </p>
      </div>
    </div>
  );
}

export default Login;

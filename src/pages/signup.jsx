import React from "react";
import { Link, useNavigate } from "react-router-dom";
import "../style.css";
import bgImage from "../assets/img1.jpg";
import { apiRequest, saveSession } from "../api";
import PasswordInput from "../components/passwordinput";

function Signup() {
  const navigate = useNavigate();
  const [formData, setFormData] = React.useState({ name: "", email: "", password: "" });
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function handleSignup(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const session = await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      saveSession(session);
      navigate("/user/dashboard");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="auth-wrapper"
      style={{ backgroundImage: `url(${bgImage})` }}
    >
      <div className="auth-overlay" />

      <div className="auth-card">

        <div className="auth-header">
          <div className="brand-circle mb-2" />
          <h2>Create Account</h2>
          <p>Join Villa Tjeozabel</p>
        </div>

        <form onSubmit={handleSignup}>

          {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}

          <div className="mb-3 text-start">
            <label>Full Name</label>
            <input
              type="text"
              name="name"
              className="form-control auth-input"
              placeholder="Enter your full name"
              value={formData.name}
              onChange={(event) => setFormData({ ...formData, name: event.target.value })}
              required
            />
          </div>

          <div className="mb-3 text-start">
            <label>Email</label>
            <input
              type="email"
              name="email"
              className="form-control auth-input"
              placeholder="Enter your email"
              value={formData.email}
              onChange={(event) => setFormData({ ...formData, email: event.target.value })}
              required
            />
          </div>

          <div className="mb-3 text-start">
            <label htmlFor="signup-password">Password</label>
            <PasswordInput
              id="signup-password"
              name="password"
              className="form-control auth-input"
              placeholder="Create password"
              minLength={8}
              autoComplete="new-password"
              value={formData.password}
              onChange={(event) => setFormData({ ...formData, password: event.target.value })}
              required
            />
          </div>

          <button className="btn auth-btn w-100" type="submit">
            {loading ? "Creating account..." : "Sign Up"}
          </button>

          <p className="auth-switch mt-3">
            Already have an account?{" "}
            <Link to="/login">Login</Link>
          </p>

          <p className="auth-back">
            <Link to="/">← Back to Home</Link>
          </p>

        </form>
      </div>
    </div>
  );
}

export default Signup;

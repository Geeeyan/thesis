import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSessionUser, logoutSession, profilePictureUrl } from "../api";
import "../style.css";

function Navbar() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const user = getSessionUser();

  const closeMenu = () => setMenuOpen(false);
  const closeProfileMenu = () => setProfileMenuOpen(false);
  const dashboardPath = user?.role === "admin"
    ? "/admin/dashboard"
    : user?.role === "staff"
      ? "/staff/dashboard"
      : "/user/dashboard";

  useEffect(() => {
    if (!profileMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) closeProfileMenu();
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeProfileMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  return (
    <nav className="custom-navbar">
      <div className="container navbar-inner">

        {/* BRAND */}
        <Link className="navbar-brand" to="/" onClick={closeMenu}>
          <span className="brand-circle"></span>
          Villa Tjeozabel
        </Link>

        {/* HAMBURGER */}
        <button
          className="navbar-toggler"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label="Toggle navigation"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        {/* MENU */}
        <div className={`navbar-menu ${menuOpen ? "open" : ""}`}>

          <ul className="navbar-nav">
            <li>
              <Link className="nav-link" to="/" onClick={closeMenu}>
                Home
              </Link>
            </li>

            <li>
              <Link className="nav-link" to="/services" onClick={closeMenu}>
                Services
              </Link>
            </li>

            <li>
              <Link className="nav-link" to="/about" onClick={closeMenu}>
                About
              </Link>
            </li>

            <li>
              <Link className="nav-link" to="/contact" onClick={closeMenu}>
                Contact
              </Link>
            </li>
          </ul>

          <div className="navbar-actions">
            {user ? (
              <div ref={profileMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  aria-label="Open profile options"
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="menu"
                  title={user.name || "Profile"}
                  onClick={() => setProfileMenuOpen((open) => !open)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: 4, border: "1px solid var(--border)", borderRadius: 999, background: "var(--white)", cursor: "pointer" }}
                >
                  {user.profileImage ? (
                    <img
                      src={profilePictureUrl(user.profileImage)}
                      alt=""
                      style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--orange)", color: "var(--white)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700 }}>
                      {String(user.name || "U").trim().slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span style={{ color: "var(--text-dark)", fontSize: 14, fontWeight: 600, paddingLeft: 4 }}>
                    {user.name || "Profile"}
                  </span>
                  <i className="bi bi-chevron-down" aria-hidden="true" style={{ color: "var(--text-mid)", fontSize: 12, marginRight: 8 }} />
                </button>
                {profileMenuOpen && (
                  <div role="menu" aria-label="Profile options" style={{ position: "absolute", zIndex: 1100, top: "calc(100% + 8px)", right: 0, minWidth: 180, padding: 6, background: "var(--white)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "0 10px 28px rgba(31,41,55,0.14)" }}>
                    <button type="button" role="menuitem" onClick={() => { closeProfileMenu(); closeMenu(); navigate("/user/profile-settings"); }} style={{ display: "block", width: "100%", padding: "10px 12px", border: 0, borderRadius: 8, background: "transparent", color: "var(--text-dark)", textAlign: "left", cursor: "pointer", fontSize: 14 }}>
                      Profile Settings
                    </button>
                    <button type="button" role="menuitem" onClick={() => { closeProfileMenu(); closeMenu(); navigate(dashboardPath); }} style={{ display: "block", width: "100%", padding: "10px 12px", border: 0, borderRadius: 8, background: "transparent", color: "var(--text-dark)", textAlign: "left", cursor: "pointer", fontSize: 14 }}>
                      My Dashboard
                    </button>
                    <button type="button" role="menuitem" onClick={async () => {
                      closeProfileMenu();
                      if (window.confirm("Are you sure you want to log out?")) {
                        try {
                          await logoutSession();
                          navigate("/");
                        } catch (error) {
                          window.alert(error.message);
                        }
                      }
                      closeMenu();
                    }} style={{ display: "block", width: "100%", padding: "10px 12px", border: 0, borderRadius: 8, background: "transparent", color: "#C2410C", textAlign: "left", cursor: "pointer", fontSize: 14 }}>
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button className="btn login-btn" onClick={() => { navigate("/login"); closeMenu(); }}>
                  Login
                </button>
                <button className="btn signup-btn" onClick={() => { navigate("/signup"); closeMenu(); }}>
                  Sign Up
                </button>
              </>
            )}
          </div>

        </div>
      </div>
    </nav>
  );
}

export default Navbar;
import React from "react";
import { useNavigate } from "react-router-dom";

import Navbar from "../components/navbar";
import "../style.css";

function About() {
  const navigate = useNavigate();

  const highlights = [
    { label: "Years of Service",     value: "5+",     icon: "bi-clock-history"       },
    { label: "Happy Guests",         value: "2,000+", icon: "bi-emoji-smile-fill"    },
    { label: "Events Hosted",        value: "300+",   icon: "bi-balloon-heart-fill"  },
    { label: "Awards & Recognition", value: "8",      icon: "bi-trophy-fill"         },
  ];

  const values = [
    { icon: "bi-shield-check",  title: "Privacy & Safety",  desc: "Your comfort and security are our top priority at all times."         },
    { icon: "bi-gem",           title: "Luxury & Quality",  desc: "Only the finest amenities and experiences make it through our doors."  },
    { icon: "bi-heart-fill",    title: "Warm Hospitality",  desc: "Every guest is treated like family — with care, respect, and joy."     },
    { icon: "bi-leaf",          title: "Eco-Conscious",     desc: "We are committed to sustainable practices to protect our environment."  },
  ];

  const team = [
    { name: "", role: "",           icon: "bi-person-badge-fill",    desc: ""   },
    { name: "",   role: "", icon: "bi-person-hearts",        desc: "."     },
    { name: "",     role: "",      icon: "bi-calendar2-heart-fill", desc: ""           },
  ];

  return (
    <div className="landing-page">

      <Navbar />

      {/* ── Hero ── */}
      <header className="about-hero">
        <div className="about-hero-inner container">
          <span className="about-location-badge">
            <i className="bi bi-geo-alt-fill me-1"></i>
            VILLA TJEOZABEL · BIÑAN CITY
          </span>
          <h1 className="about-hero-title">About Us</h1>
          <p className="about-hero-sub">
            A sanctuary of luxury, privacy, and unforgettable memories.
          </p>
        </div>
      </header>

      {/* ── Our Story ── */}
      <section className="container about-section">
        <div className="about-section-header">
          <h2>Our Story</h2>
          <p>
            From a humble dream to a premier destination in Biñan City,
            discover how Villa Tjeozabel came to life.
          </p>
        </div>

        <div className="row align-items-center g-5">
          <div className="col-md-6 text-center">
            <div className="about-story-icon">
              <i className="bi bi-house-heart-fill"></i>
            </div>
          </div>
          <div className="col-md-6">
            <p className="about-body-text">
              Villa Tjeozabel was born from a dream — to create a private haven
              where families, couples, and friends could escape the noise of the
              city and immerse themselves in comfort and joy.
            </p>
            <p className="about-body-text">
              Nestled in Biñan City, our villa offers a seamless blend of
              modern luxury and warm Filipino hospitality. From our sparkling
              private pools to elegantly designed rooms and versatile event
              spaces, every corner is crafted with care and intention.
            </p>
            <button
              className="btn btn-warning mt-3"
              onClick={() => navigate("/reservation")}
            >
              <i className="bi bi-calendar-check me-2"></i>
              Reserve Now
            </button>
          </div>
        </div>
      </section>

      {/* ── Villa at a Glance ── */}
      <section className="about-alt-section">
        <div className="container about-section">
          <div className="about-section-header">
            <h2>Villa at a Glance</h2>
            <p>A few numbers that speak for themselves.</p>
          </div>

          <div className="row g-4">
            {highlights.map((h) => (
              <div className="col-6 col-md-3" key={h.label}>
                <div className="about-stat-card">
                  <div className="about-icon-box">
                    <i className={`bi ${h.icon}`}></i>
                  </div>
                  <div className="about-stat-value">{h.value}</div>
                  <div className="about-stat-label">{h.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── What We Stand For ── */}
      <section className="container about-section">
        <div className="about-section-header">
          <h2>What We Stand For</h2>
          <p>Our values shape every experience we create for our guests.</p>
        </div>

        <div className="row g-4">
          {values.map((v) => (
            <div className="col-md-3 col-sm-6" key={v.title}>
              <div className="about-value-card">
                <div className="about-icon-box">
                  <i className={`bi ${v.icon}`}></i>
                </div>
                <h5>{v.title}</h5>
                <p>{v.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Meet the Team ── */}
      <section className="about-alt-section">
        <div className="container about-section">
          <div className="about-section-header">
            <h2>Meet Our Team</h2>
            <p>The people behind every perfect stay at Villa Tjeozabel.</p>
          </div>

          <div className="row g-4 justify-content-center">
            {team.map((member) => (
              <div className="col-md-4" key={member.name}>
                <div className="about-team-card">
                  <div className="about-icon-box">
                    <i className={`bi ${member.icon}`}></i>
                  </div>
                  <h5>{member.name}</h5>
                  <span className="about-team-role">{member.role}</span>
                  <p>{member.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="cta-section text-center py-5 text-white">
        <div className="container">
          <h2>Ready to Experience Villa Tjeozabel?</h2>
          <p className="mt-2">Book your stay today and create memories that last a lifetime.</p>
          <button
            className="btn btn-light mt-3"
            onClick={() => navigate("/reservation")}
          >
            <i className="bi bi-calendar-check me-2"></i>
            Reserve Now
          </button>
        </div>
      </section>

      <footer className="text-center py-3 footer">
        <i className="bi bi-c-circle me-1"></i>
        2026 Villa Tjeozabel
      </footer>

    </div>
  );
}

export default About;

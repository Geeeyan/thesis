import React from "react";
import { useNavigate } from "react-router-dom";
import useSiteAssets from "./hooks/useSiteAssets";

import Navbar from "./components/navbar";
import heroImage from "./assets/img1.jpg";
import entireVillaImage from "./assets/entirevilla.png";
import poolImage from "./assets/pool.png";
import eventImage from "./assets/event.png";
import romanticImage from "./assets/img3.png";
import regularRoomImage from "./assets/regular.png";
import luxuryRoomImage from "./assets/lux.png";
import "./style.css";


function Landing() {
  const navigate = useNavigate();
  const siteAssets = useSiteAssets();

  const categories = [
    { title: "Entire Villa",  icon: "bi-house-heart-fill", desc: "Enjoy full privacy and luxury comfort.",         image: entireVillaImage, asset: "service-entire-villa" },
    { title: "Private Pool",  icon: "bi-water",            desc: "Relax with exclusive swimming experience.",      image: poolImage, asset: "service-private-pool" },
    { title: "Event Space",   icon: "bi-stars",            desc: "Perfect venue for birthdays and gatherings.",    image: eventImage, asset: "service-event-space" },
    { title: "Romantic Stay", icon: "bi-heart-fill",       desc: "Create unforgettable memories with loved ones.", image: romanticImage, asset: "service-romantic-stay" },
  ];

  const rooms = [
    { title: "Regular Room", price: "₱350 / 3hrs",     icon: "bi-door-closed-fill",   image: regularRoomImage, asset: "room-regular" },
    { title: "Luxury Room",  price: "₱1200 / Night",   icon: "bi-gem",                image: luxuryRoomImage, asset: "room-luxury" },
    { title: "Event Space",  price: "₱10,000 / 12hrs", icon: "bi-balloon-heart-fill", image: eventImage, asset: "room-event" },
  ];

  const features = [
    {
      icon: "bi-shield-lock-fill",
      title: "Private & Secure",
      desc: "Exclusively yours — no shared spaces, no strangers. Full privacy guaranteed for every booking.",
    },
    {
      icon: "bi-wifi",
      title: "High-Speed Wi-Fi",
      desc: "Stay connected with fast and reliable internet throughout the entire villa premises.",
    },
    {
      icon: "bi-thermometer-sun",
      title: "Air-Conditioned Rooms",
      desc: "Beat the heat with fully air-conditioned bedrooms, living areas, and event spaces.",
    },
    {
      icon: "bi-camera-video-fill",
      title: "24/7 CCTV Security",
      desc: "Round-the-clock surveillance for your peace of mind during your entire stay.",
    },
    {
      icon: "bi-car-front-fill",
      title: "Free Parking",
      desc: "Spacious on-site parking available for all guests at no additional charge.",
    },
    {
      icon: "bi-headset",
      title: "Dedicated Support",
      desc: "Our team is always on-call to assist with anything you need, day or night.",
    },
  ];

  return (
    <div className="landing-page">

      <Navbar />

      {/* ── Hero ── */}
      <header
        id="home"
        className="hero-section"
        style={{ backgroundImage: `url(${siteAssets["landing-hero"] || heroImage})` }}
      >
        <div className="hero-overlay"></div>
        <div className="container hero-content text-white">
          <h1>Experience Luxury & Relaxation</h1>
          <p>Your perfect private villa getaway in Biñan City.</p>
          <div className="landing-reservation-options">
            <button className="btn btn-warning" onClick={() => navigate("/reservation", { state: { bookingType: "Online" } })}>
              <i className="bi bi-calendar-check me-2"></i>
              Online Reservation
            </button>
            <button className="btn btn-outline-light" onClick={() => navigate("/reservation", { state: { bookingType: "Walk-in" } })}>
              <i className="bi bi-person-walking me-2"></i>
              Walk-in
            </button>
          </div>
          <p className="landing-walkin-note">
            Choose Walk-in to submit your reservation request. No online payment is required; our team will contact you to confirm availability.
          </p>
        </div>
      </header>

      {/* ── About ── */}
      <section id="about" className="container py-5 text-center">
        <h2>About Villa Tjeozabel</h2>
        <p>
          Villa Tjeozabel offers luxury stays, private pools,
          and unforgettable experiences.
        </p>
      </section>

      {/* ── Features ── */}
      <section id="features" className="features-section py-5">
        <div className="container text-center">
          <h2 className="mb-2">Why Choose Us</h2>
          <p className="features-subtitle mb-5">
            Everything you need for a perfect stay — all under one roof.
          </p>

          <div className="row g-4">
            {features.map((f) => (
              <div className="col-md-4 col-sm-6" key={f.title}>
                <div className="feature-card">
                  <div className="feature-icon-box">
                    <i className={`bi ${f.icon}`}></i>
                  </div>
                  <h5>{f.title}</h5>
                  <p>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Services ── */}
      <section id="services" className="container py-5 text-center">
        <h2 className="mb-4">Our Services</h2>
        <div className="row">
          {categories.map((item) => (
            <div className="col-md-3 mb-4" key={item.title}>
              <div className="service-card p-3">
                  <div className="landing-card-image">
                    <img src={siteAssets[item.asset] || item.image} alt={item.title} loading="lazy" />
                  </div>
                <div className="service-icon">
                  <i className={`bi ${item.icon}`}></i>
                </div>
                <h5>{item.title}</h5>
                <p>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Rooms ── */}
      <section id="rooms" className="container py-5 text-center">
        <h2 className="mb-4">Featured Rooms</h2>
        <div className="row">
          {rooms.map((room) => (
            <div className="col-md-4 mb-4" key={room.title}>
              <div className="card room-card p-3">
                <div className="landing-card-image">
                  <img src={siteAssets[room.asset] || room.image} alt={room.title} loading="lazy" />
                </div>
                <div className="mb-2" style={{ fontSize: "2rem", color: "#f0a500" }}>
                  <i className={`bi ${room.icon}`}></i>
                </div>
                <h5>{room.title}</h5>
                <p>{room.price}</p>
                <button
                  className="btn btn-warning"
                  onClick={() => navigate("/reservation", {
                    state: { room: room.title === "Luxury Room" ? "luxury" : room.title === "Event Space" ? "event" : "regular" },
                  })}
                >
                  <i className="bi bi-bookmark-check me-2"></i>
                  Book Now
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section id="contact" className="cta-section text-center py-5 text-white">
        <div className="container">
          <h2>Reserve Your Dream Stay Today</h2>
          <button
            className="btn btn-light mt-3"
            onClick={() => navigate("/login")}
          >
            <i className="bi bi-envelope me-2"></i>
            Contact Us
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

export default Landing;

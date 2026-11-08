import React, { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Navbar from "../components/navbar";
import useSiteAssets from "../hooks/useSiteAssets";
import { apiRequest, listingPhotoUrl } from "../api";
import entireVillaImg from "../assets/entirevilla.png";
import eventImg from "../assets/event.png";
import img3 from "../assets/img3.png";
import regular from "../assets/regular.png";
import img4 from "../assets/pool.png";
import lux from "../assets/lux.png";
import bgImage from "../assets/entirevilla.png";
import "../style.css";

const services = [
  {
    slug: "entire-villa",
    inventoryCode: "entire-villa",
    icon: "bi-house-heart-fill",
    title: "Entire Villa",
    desc: "Rent the full property for total privacy. Ideal for barkadas, family reunions, and group retreats with access to all areas.",
    image: entireVillaImg,
    asset: "service-entire-villa",
  },
  {
    slug: "private-pool",
    inventoryCode: "pool",
    icon: "bi-water",
    title: "Private Pool",
    desc: "Take a dip in our crystal-clear private pool surrounded by lush tropical greenery — available day and night.",
    image: img4,
    asset: "service-private-pool",
  },
  {
    slug: "event-space",
    inventoryCode: "event",
    icon: "bi-stars",
    title: "Event Space",
    desc: "Host birthdays, debuts, and special gatherings in our fully equipped outdoor venue with lighting and sound setup.",
    image: eventImg,
    asset: "service-event-space",
  },
  {
    slug: "romantic-stay",
    inventoryCode: "luxury",
    icon: "bi-heart-fill",
    title: "Romantic Stay",
    desc: "Surprise your partner with flower petals, candles, a private dinner setup, and a beautifully decorated room.",
    image: img3,
    asset: "service-romantic-stay",
  },
  {
    slug: "luxury-room",
    inventoryCode: "luxury",
    icon: "bi-gem",
    title: "Luxury Room",
    desc: "Rest in our premium rooms featuring king-size beds, en-suite bathrooms, smart TV, and modern air conditioning.",
    image: lux,
    asset: "service-luxury-room",
  },
];

const rooms = [
  {
    value: "regular",
    inventoryCode: "regular",
    title: "Regular Room",
    price: "₱350 / 3hrs",
    icon: "bi-door-closed-fill",
    desc: "Cozy and comfortable for a short daytime stay.",
    image: regular,
    asset: "room-regular",
  },
  {
    value: "pool",
    inventoryCode: "pool",
    title: "Private Pool",
    price: "₱300 / person",
    icon: "bi-water",
    desc: "Relax poolside in a private water oasis with lounge seating and tropical ambiance.",
    image: img4,
    asset: "room-pool",
  },
  {
    value: "luxury",
    inventoryCode: "luxury",
    title: "Luxury Room",
    price: "₱1,200 / Night",
    icon: "bi-gem",
    desc: "Our finest room — king bed, smart TV, and en-suite bath.",
    image: lux,
    asset: "room-luxury",
  },
  {
    value: "event",
    inventoryCode: "event",
    title: "Event Space",
    price: "₱10,000 / 12hrs",
    icon: "bi-balloon-heart-fill",
    desc: "Full venue for celebrations with up to 100 guests.",
    image: eventImg,
    asset: "room-event",
  },
];

function Services() {
  const navigate = useNavigate();
  const siteAssets = useSiteAssets();
  const [coverPhotos, setCoverPhotos] = useState({});

  useEffect(() => {
    let active = true;
    apiRequest("/services")
      .then((items) => {
        if (!active) return;
        setCoverPhotos(Object.fromEntries(items
          .filter((item) => item.coverPhotoId)
          .map((item) => [item.code, item.coverPhotoId])));
      })
      .catch((error) => console.error("Could not load room and service photos:", error));
    return () => { active = false; };
  }, []);

  function handleBookNow(roomValue) {
    navigate("/reservation", { state: { room: roomValue } });
  }

  return (
    <div className="app-shell">

      <Navbar />

      <div
        className="contact-hero"
        style={{ backgroundImage: `url(${siteAssets["landing-hero"] || bgImage})`, backgroundSize: "cover", backgroundPosition: "center", marginTop: 0 }}
      >
        <div className="contact-hero-overlay" />
        <div className="contact-hero-text">
          <span className="section-tag">Villa Tjeozabel · Biñan City</span>
          <h1>Services &amp; Facilities</h1>
          <p>Everything you need for an unforgettable stay — all in one place.</p>
        </div>
      </div>

      {/* ── What We Offer ── */}
      <section id="services">
        <div className="container">
          <h2>What We Offer</h2>
          <p className="section-sub">
            From private pools to event spaces, Villa Tjeozabel has something for every occasion.
          </p>

          <div className="row">
            {services.map((item) => (
              <div className="col-md-4 mb-4" key={item.slug}>
                <Link to={`/services/${item.slug}`} className="service-card-link">
                  <div className="service-card h-100">
                    <div className="service-card-image" style={{ height: "200px", overflow: "hidden", borderRadius: "12px 12px 0 0", marginBottom: "12px" }}>
                      <img src={coverPhotos[item.inventoryCode]
                        ? listingPhotoUrl(item.inventoryCode, coverPhotos[item.inventoryCode], "medium")
                        : siteAssets[item.asset] || item.image}
                        alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    <div className="service-icon">
                      <i className={`bi ${item.icon}`}></i>
                    </div>
                    <h5>{item.title}</h5>
                    <p>{item.desc}</p>
                    <span className="sd-learn-more">
                      Learn more <i className="bi bi-arrow-right"></i>
                    </span>
                  </div>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Rooms & Rates ── */}
      <section id="rooms">
        <div className="container">
          <h2>Rooms &amp; Rates</h2>
          <p className="section-sub">
            Choose the perfect setup for your stay — whether it's a few hours or a full event.
          </p>

          <div className="row justify-content-center">
            {rooms.map((room) => (
              <div className="col-md-3 mb-4" key={room.value}>
                <div className="room-card h-100 d-flex flex-column">
                  <div className="room-card-image" style={{ height: "150px", overflow: "hidden", borderRadius: "12px 12px 0 0", marginBottom: "12px" }}>
                    <img src={coverPhotos[room.inventoryCode]
                      ? listingPhotoUrl(room.inventoryCode, coverPhotos[room.inventoryCode], "medium")
                      : siteAssets[room.asset] || room.image}
                      alt={room.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="service-icon mb-2">
                      <i className={`bi ${room.icon}`}></i>
                    </div>
                    <h5>{room.title}</h5>
                    <p>{room.price}</p>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-light)", lineHeight: 1.7 }}>
                      {room.desc}
                    </span>
                  </div>
                  <button
                    className="btn btn-warning mt-3"
                    onClick={() => handleBookNow(room.value)}
                  >
                    <i className="bi bi-bookmark-check me-2"></i>
                    Book Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="cta-section">
        <div className="container">
          <h2>Ready to Experience the Villa?</h2>
          <p>Reach out and we'll craft the perfect package for your visit.</p>
          <button className="btn btn-light" onClick={() => navigate("/contact")}>
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

export default Services;

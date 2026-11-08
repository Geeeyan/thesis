import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Navbar from "../components/navbar";
import useSiteAssets from "../hooks/useSiteAssets";
import { apiRequest, listingPhotoUrl } from "../api";
import "../style.css";

const serviceData = {
  "entire-villa": {
    icon: "bi-house-heart-fill",
    title: "Entire Villa",
    tagline: "Total privacy. Unlimited memories.",
    hero: "The whole villa — just for you and your group.",
    about:
      "Whether you're celebrating a milestone, hosting a reunion, or simply craving a full retreat, renting the entire Villa Tjeozabel gives your group exclusive access to every corner of the property. No sharing, no strangers — just pure, uninterrupted comfort.",
    highlights: [
      { icon: "bi-people-fill",        label: "Up to 30 Guests"             },
      { icon: "bi-moon-stars-fill",    label: "Overnight Stays Available"   },
      { icon: "bi-shield-lock-fill",   label: "Fully Private & Gated"       },
      { icon: "bi-water",              label: "Pool Access Included"        },
      { icon: "bi-car-front-fill",     label: "Free On-Site Parking"        },
      { icon: "bi-music-note-beamed",  label: "Sound System Available"      },
    ],
    inclusions: [
      "Access to all rooms and common areas",
      "Private pool (day & night)",
      "Outdoor event area",
      "Full kitchen use",
      "Free Wi-Fi throughout the property",
      "Air-conditioned bedrooms",
      "On-call villa staff",
    ],
    price: "Starting at ₱15,000 / Night",
    roomValue: "entire-villa",
  },

  "private-pool": {
    icon: "bi-water",
    title: "Private Pool",
    tagline: "Dive into your own slice of paradise.",
    hero: "Crystal-clear waters, yours alone — day or night.",
    about:
      "Our private pool is the heart of Villa Tjeozabel. Surrounded by lush tropical greenery and soft lighting at night, it's perfect for a morning swim, afternoon splash, or a moonlit dip. No crowds, no schedules — just the pool and your people.",
    highlights: [
      { icon: "bi-sun-fill",           label: "Open 24 Hours"               },
      { icon: "bi-people-fill",        label: "Private — No Sharing"        },
      { icon: "bi-droplet-fill",       label: "Regularly Cleaned & Treated" },
      { icon: "bi-lightbulb-fill",     label: "Night Lighting Included"     },
      { icon: "bi-life-preserver",     label: "Safety Equipment On-Site"    },
      { icon: "bi-thermometer-sun",    label: "Poolside Lounge Area"        },
    ],
    inclusions: [
      "Full-day or overnight pool access",
      "Poolside lounge chairs & umbrella",
      "Ambient night lighting",
      "Changing room access",
      "Life rings and safety gear",
      "Optional BBQ setup nearby",
    ],
    price: "₱300 / person",
    roomValue: "pool",
  },

  "event-space": {
    icon: "bi-stars",
    title: "Event Space",
    tagline: "Your celebration, perfectly set.",
    hero: "A stunning venue for every milestone worth remembering.",
    about:
      "From intimate birthday dinners to grand debut celebrations, our outdoor event space is designed to make your occasion unforgettable. Equipped with lighting rigs, sound system, and flexible table arrangements, we handle the setup so you can focus on the moments.",
    highlights: [
      { icon: "bi-people-fill",        label: "Up to 100 Guests"            },
      { icon: "bi-balloon-heart-fill", label: "Birthdays & Debuts"          },
      { icon: "bi-speaker-fill",       label: "Sound System Included"       },
      { icon: "bi-lamp-fill",          label: "Event Lighting Setup"        },
      { icon: "bi-table",              label: "Tables & Chairs Provided"    },
      { icon: "bi-camera-fill",        label: "Photo-Ready Backdrops"       },
    ],
    inclusions: [
      "12-hour venue access",
      "Lights and sound system",
      "Tables, chairs, and basic linens",
      "Dedicated event coordinator",
      "Access to prep kitchen",
      "Parking for guests",
      "Optional catering coordination",
    ],
    price: "₱10,000 / 12 hours",
    roomValue: "event",
  },

  "romantic-stay": {
    icon: "bi-heart-fill",
    title: "Romantic Stay",
    tagline: "Because love deserves a beautiful setting.",
    hero: "Create a moment they'll never forget.",
    about:
      "Surprise your partner with a thoughtfully arranged romantic experience at Villa Tjeozabel. From rose petals on arrival to a candlelit dinner by the pool, every detail is carefully prepared to make your special night feel like something out of a dream.",
    highlights: [
      { icon: "bi-flower1",            label: "Rose Petal Setup"            },
      { icon: "bi-fire",               label: "Candlelit Ambiance"          },
      { icon: "bi-cup-hot-fill",       label: "Welcome Drinks"              },
      { icon: "bi-moon-stars-fill",    label: "Overnight Stay"              },
      { icon: "bi-camera2",            label: "Photo Setup Available"       },
    ],
    inclusions: [
      "Decorated room with rose petals & candles",
      "Welcome drinks for two",
      "Private poolside dinner setup (optional)",
      "Overnight room stay",
      "Complimentary breakfast in the morning",
      "Personalized note or greeting card",
    ],
    price: "Starting at ₱3,500 / Night",
    roomValue: "luxury",
  },

  "luxury-room": {
    icon: "bi-gem",
    title: "Luxury Room",
    tagline: "Rest. Recharge. Indulge.",
    hero: "Our finest room — where comfort meets elegance.",
    about:
      "The Luxury Room at Villa Tjeozabel is our crown jewel. Designed for guests who want the very best, it features a plush king-size bed, a modern en-suite bathroom, smart TV, blackout curtains, and premium linen. Fall asleep to cool air and wake up refreshed.",
    highlights: [
      { icon: "bi-door-closed-fill",   label: "King-Size Bed"               },
      { icon: "bi-tv-fill",            label: "Smart TV"                    },
      { icon: "bi-thermometer-snow",   label: "Air-Conditioned"             },
      { icon: "bi-droplet-half",       label: "En-Suite Hot & Cold Shower"  },
      { icon: "bi-wifi",               label: "High-Speed Wi-Fi"            },
      { icon: "bi-moon-fill",          label: "Blackout Curtains"           },
    ],
    inclusions: [
      "King-size bed with premium linen",
      "En-suite bathroom with hot & cold shower",
      "Smart TV with streaming apps",
      "High-speed Wi-Fi",
      "Air conditioning with remote",
      "Complimentary toiletries",
      "Daily housekeeping",
    ],
    price: "₱1,200 / Night",
    roomValue: "luxury",
  },
};

function ServiceDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const siteAssets = useSiteAssets();
  const service = serviceData[slug];
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
      .catch((error) => console.error("Could not load service photos:", error));
    return () => { active = false; };
  }, []);

  if (!service) {
    return (
      <div className="app-shell">
        <Navbar />
        <div className="container text-center" style={{ padding: "120px 20px" }}>
          <i className="bi bi-exclamation-circle" style={{ fontSize: "3rem", color: "var(--orange)" }}></i>
          <h2 className="mt-3">Service Not Found</h2>
          <p className="text-muted mt-2">The service you're looking for doesn't exist.</p>
          <button className="btn btn-warning mt-4" onClick={() => navigate("/services")}>
            <i className="bi bi-arrow-left me-2"></i>
            Back to Services
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Navbar />

      {/* ── Hero ── */}
      <div
        className="sd-hero"
        style={coverPhotos[service.roomValue] || siteAssets[`service-${slug}`] ? {
          backgroundImage: `linear-gradient(90deg, rgba(17,24,39,.82), rgba(17,24,39,.35)), url(${coverPhotos[service.roomValue]
            ? listingPhotoUrl(service.roomValue, coverPhotos[service.roomValue], "large")
            : siteAssets[`service-${slug}`]})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        } : undefined}
      >
        <div className="sd-hero-inner container">
          <button className="sd-back-btn" onClick={() => navigate("/services")}>
            <i className="bi bi-arrow-left me-2"></i>
            Back to Services
          </button>
          <div className="sd-hero-icon">
            <i className={`bi ${service.icon}`}></i>
          </div>
          <span className="section-tag">Villa Tjeozabel · Biñan City</span>
          <h1 className="sd-hero-title">{service.title}</h1>
          <p className="sd-hero-sub">{service.hero}</p>
        </div>
      </div>

      {/* ── About ── */}
      <section className="sd-section">
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-lg-8 text-center">
              <p className="sd-tagline">{service.tagline}</p>
              <p className="sd-about">{service.about}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Highlights ── */}
      <section className="sd-alt-section">
        <div className="container sd-section">
          <h2 className="sd-section-title">What's Included</h2>
          <p className="section-sub">Everything you get with this package at a glance.</p>

          <div className="row g-3 justify-content-center">
            {service.highlights.map((h) => (
              <div className="col-6 col-md-4 col-lg-2" key={h.label}>
                <div className="sd-highlight-card">
                  <div className="sd-highlight-icon">
                    <i className={`bi ${h.icon}`}></i>
                  </div>
                  <span>{h.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Inclusions ── */}
      <section className="sd-section">
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-lg-7">
              <h2 className="sd-section-title text-center mb-4">Package Inclusions</h2>
              <div className="sd-inclusions-list">
                {service.inclusions.map((item) => (
                  <div className="sd-inclusion-item" key={item}>
                    <div className="sd-inclusion-check">
                      <i className="bi bi-check-lg"></i>
                    </div>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="cta-section">
        <div className="container">
          <p className="sd-cta-price">{service.price}</p>
          <h2>Ready to Book {service.title}?</h2>
          <p>Secure your stay today before slots fill up.</p>
          <div className="sd-cta-btns">
            <button
              className="btn btn-light"
              onClick={() => navigate("/reservation", { state: { room: service.roomValue } })}
            >
              <i className="bi bi-calendar-check me-2"></i>
              Reserve Now
            </button>
            <button
              className="btn sd-cta-outline"
              onClick={() => navigate("/contact")}
            >
              <i className="bi bi-envelope me-2"></i>
              Ask a Question
            </button>
          </div>
        </div>
      </section>

      <footer className="text-center py-3 footer">
        <i className="bi bi-c-circle me-1"></i>
        2026 Villa Tjeozabel
      </footer>
    </div>
  );
}

export default ServiceDetail;

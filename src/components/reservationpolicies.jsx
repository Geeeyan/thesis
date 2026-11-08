import React from "react";

export default function ReservationPolicies() {
  return (
    <section className="reservation-policies" aria-labelledby="reservation-policies-title">
      <h3 id="reservation-policies-title">Rescheduling &amp; Cancellation Policy</h3>
      <p>
        Cancellation and rescheduling options are available until 72 hours before check-in. They are unavailable within the 72-hour window. Cancellation requests are reviewed by the Villa Tjeozabel team, and your reservation remains active until the team confirms the cancellation.
      </p>
      <p>
        One free reschedule is allowed per booking, at least 72 hours before check-in. Rescheduling is subject to availability for the same room type and requires team confirmation.
      </p>
      <p className="reservation-policy-contact">
        Cancellations made at least 72 hours before check-in are eligible for a full refund. Refunds are processed within 5–7 business days.
      </p>
    </section>
  );
}

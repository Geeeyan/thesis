const config = require('../config');
const db = require('../db');
const mailer = require('./mailer');
const R = require('./reservations');
const { emailDetails } = require('./booking-email');

const REMINDER_TYPE = 'booking_reminder';
const REMINDER_INTERVAL_MS = 5 * 60 * 1000;

async function sendDueBookingReminders(now = Date.now()) {
  if (!mailer.isConfigured()) return;
  const target = now + config.bookingReminderHours * 60 * 60 * 1000;
  const windowMs = REMINDER_INTERVAL_MS;
  const rows = db.prepare(`SELECT r.*, s.name AS room_name, s.price AS room_price, s.unit AS room_unit,
      s.pricing_mode AS room_pricing_mode, s.duration_minutes AS room_duration_minutes,
      s.same_day_checkout AS room_same_day_checkout,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.reservation_id = r.id AND p.status = 'Paid'), 0) AS paid,
      0 AS payment_proof_submitted
    FROM reservations r JOIN services s ON s.code = r.room_code
    WHERE r.status = 'Confirmed' AND r.start_datetime IS NOT NULL
      AND julianday(r.start_datetime) BETWEEN julianday(?) AND julianday(?)
      AND NOT EXISTS (
        SELECT 1 FROM reservation_email_notifications n
        WHERE n.reservation_id = r.id AND n.notification_type = ?
      )`)
    .all(new Date(target - windowMs).toISOString(), new Date(target + windowMs).toISOString(), REMINDER_TYPE);

  for (const row of rows) {
    const claimed = db.prepare(`INSERT OR IGNORE INTO reservation_email_notifications
      (reservation_id, notification_type) VALUES (?, ?)`).run(row.id, REMINDER_TYPE);
    if (!claimed.changes) continue;
    try {
      await mailer.sendTemplate(row.guest_email, REMINDER_TYPE, emailDetails(R.toReservation(row)));
      db.prepare(`UPDATE reservation_email_notifications SET sent_at = CURRENT_TIMESTAMP
        WHERE reservation_id = ? AND notification_type = ?`).run(row.id, REMINDER_TYPE);
    } catch (error) {
      db.prepare(`DELETE FROM reservation_email_notifications
        WHERE reservation_id = ? AND notification_type = ? AND sent_at IS NULL`).run(row.id, REMINDER_TYPE);
      if (error.message !== 'Email delivery failed') {
        console.error('Booking reminder could not be sent:', error.message === 'SMTP email delivery is not configured' ? 'not_configured' : 'render_error');
      }
    }
  }
}

module.exports = { sendDueBookingReminders, REMINDER_INTERVAL_MS };

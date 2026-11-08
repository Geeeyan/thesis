const db = require('../db');

function expireUnpaidWalkIns() {
  return db.prepare(`UPDATE reservations
    SET status = 'Cancelled', updated_at = datetime('now')
    WHERE booking_type = 'Walk-in'
      AND payment_due_at IS NOT NULL
      AND payment_due_at <= datetime('now')
      AND status IN ('Pending', 'Confirmed')
      AND total_price > COALESCE((
        SELECT SUM(p.amount) FROM payments p
        WHERE p.reservation_id = reservations.id AND p.status = 'Paid'
      ), 0)`).run().changes;
}

module.exports = { expireUnpaidWalkIns };

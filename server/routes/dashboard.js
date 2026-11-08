const router = require('express').Router();
const db = require('../db');
const { authenticate, staffOnly } = require('../middleware/auth');
const { today, addDays, round2 } = require('../lib/util');
const R = require('../lib/reservations');

router.get('/', authenticate, staffOnly, (_req, res) => {
  const t = today();
  const list = (where, ...v) => db.prepare(`${R.SELECT} WHERE ${where} ORDER BY r.check_in, r.id LIMIT 50`).all(...v).map((r) => R.toReservation(r));
  const count = (sql, ...v) => db.prepare(sql).get(...v).c;
  const arrivalsTodayCount = count("SELECT COUNT(*) AS c FROM reservations WHERE check_in = ? AND status IN ('Pending','Confirmed')", t);
  const departuresTodayCount = count("SELECT COUNT(*) AS c FROM reservations WHERE check_out = ? AND status IN ('Confirmed','Checked-in')", t);
  const pendingReservationsCount = count("SELECT COUNT(*) AS c FROM reservations WHERE status = 'Pending'");
  const reservationCountsByStatus = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS c FROM reservations GROUP BY status').all().map((row) => [row.status, row.c])
  );
  const revenue = db.prepare(`SELECT
    COALESCE((SELECT SUM(amount) FROM payments WHERE status = 'Paid'), 0) AS collected,
    COALESCE((SELECT SUM(total_price) FROM reservations WHERE status != 'Cancelled'), 0) AS bookedValue,
    COALESCE((SELECT SUM(MAX(r.total_price - COALESCE((
      SELECT SUM(p.amount) FROM payments p WHERE p.reservation_id = r.id AND p.status = 'Paid'
    ), 0), 0)) FROM reservations r WHERE r.status != 'Cancelled'), 0) AS outstanding`).get();
  res.json({
    date: t,
    arrivalsToday: list("r.check_in = ? AND r.status IN ('Pending','Confirmed')", t),
    arrivalsTodayCount,
    departuresToday: list("r.check_out = ? AND r.status IN ('Confirmed','Checked-in')", t),
    departuresTodayCount,
    inHouse: count("SELECT COUNT(*) AS c FROM reservations WHERE status = 'Checked-in'"),
    upcomingWeek: count("SELECT COUNT(*) AS c FROM reservations WHERE status IN ('Pending','Confirmed') AND check_in > ? AND check_in <= ?", t, addDays(t, 7)),
    pendingReservations: list("r.status = 'Pending'"),
    pendingReservationsCount,
    reservationCountsByStatus,
    pendingPayments: count("SELECT COUNT(*) AS c FROM payments WHERE status = 'Pending'"),
    totalReservations: count('SELECT COUNT(*) AS c FROM reservations'),
    guestCount: count('SELECT COUNT(DISTINCT lower(guest_email)) AS c FROM reservations WHERE guest_email IS NOT NULL'),
    registeredGuests: count("SELECT COUNT(*) AS c FROM users WHERE role = 'guest'"),
    revenue: {
      collected: round2(revenue.collected),
      bookedValue: round2(revenue.bookedValue),
      outstanding: round2(revenue.outstanding),
    },
  });
});

module.exports = router;

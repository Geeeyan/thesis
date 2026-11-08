const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');
const { today, addDays, dateSchema, nightsBetween, eachNight, round2, HttpError } = require('../lib/util');
const config = require('../config');

function mondayOf(date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function weeklyReport({ from, to, metric }) {
  const firstWeek = mondayOf(from);
  const lastWeek = mondayOf(to);
  const weeks = [];
  for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) weeks.push(week);
  const afterLastWeek = addDays(lastWeek, 7);
  const rows = db.prepare(`SELECT
      date(r.check_in, '-' || ((CAST(strftime('%w', r.check_in) AS INTEGER) + 6) % 7) || ' days') AS week_start,
      s.name AS category,
      COUNT(*) AS bookings,
      COALESCE(SUM(r.total_price), 0) AS revenue
    FROM reservations r
    JOIN services s ON s.code = r.room_code
    WHERE r.status IN ('Confirmed', 'Completed')
      AND r.check_in >= ? AND r.check_in < ?
    GROUP BY week_start, s.name
    ORDER BY week_start, s.name`).all(firstWeek, afterLastWeek);
  const categories = [...new Set(rows.map((row) => row.category))].sort((a, b) => a.localeCompare(b));
  const categorySet = new Set(categories);
  const valuesByWeek = new Map(weeks.map((week) => [week, Object.fromEntries(categories.map((category) => [category, 0]))]));
  for (const row of rows) {
    const values = valuesByWeek.get(row.week_start);
    if (values) values[row.category] = metric === 'revenue' ? round2(row.revenue) : row.bookings;
  }
  const actual = weeks.map((week) => {
    const values = valuesByWeek.get(week);
    const total = Object.values(values).reduce((sum, value) => sum + value, 0);
    return { week_start: week, categories: values, total: metric === 'revenue' ? round2(total) : total };
  });
  const hasHistory = weeks.length >= 4 && actual.some((week) => week.total > 0);
  const history = actual.slice(-4);
  const average = hasHistory
    ? history.reduce((sum, week) => sum + week.total, 0) / history.length
    : null;
  const forecast = hasHistory
    ? Array.from({ length: 8 }, (_unused, index) => ({
      week_start: addDays(lastWeek, (index + 1) * 7),
      total: metric === 'revenue' ? round2(average) : Math.round(average),
      estimate: true,
    }))
    : [];
  return {
    from,
    to,
    timezone: config.timezone,
    metric,
    groupBy: 'category',
    categories: [...categorySet],
    weeks: actual,
    forecast,
    forecastAvailable: hasHistory,
    forecastMethod: hasHistory ? 'Four-week moving average' : null,
  };
}

router.get('/weekly', authenticate, adminOnly, (req, res) => {
  const q = z.strictObject({
    from: dateSchema,
    to: dateSchema,
    metric: z.enum(['bookings', 'revenue']).default('bookings'),
    groupBy: z.literal('category').default('category'),
  }).parse(req.query);
  if (q.from > q.to) throw new HttpError(400, '"from" must not be after "to"');
  if (nightsBetween(q.from, q.to) > 366) throw new HttpError(400, 'Weekly reports are limited to 366 days');
  res.json(weeklyReport(q));
});

router.get('/', authenticate, adminOnly, (req, res) => {
  const q = z.object({ from: dateSchema.optional(), to: dateSchema.optional() }).parse(req.query);
  const to = q.to ?? today(), from = q.from ?? addDays(to, -29);
  if (from > to) throw new HttpError(400, '"from" must not be after "to"');
  if (nightsBetween(from, to) > 366) throw new HttpError(400, 'Reports are limited to 366 days');
  const days = nightsBetween(from, to) + 1;

  // Reservations that have at least one night inside the range.
  const rows = db.prepare(`SELECT r.*, s.name AS room_name FROM reservations r JOIN services s ON s.code = r.room_code
    WHERE r.status != 'Cancelled' AND r.check_in <= ? AND r.check_out > ?`).all(to, from);
  const byRoom = new Map();
  let nights = 0;
  for (const r of rows) {
    const n = eachNight(r.check_in > from ? r.check_in : from, r.check_out < addDays(to, 1) ? r.check_out : addDays(to, 1)).length;
    nights += n;
    const e = byRoom.get(r.room_code) || { room: r.room_code, name: r.room_name, reservations: 0, nights: 0, bookedValue: 0 };
    e.reservations++; e.nights += n; e.bookedValue += r.total_price; byRoom.set(r.room_code, e);
  }
  const units = db.prepare("SELECT COALESCE(SUM(quantity),0) AS u FROM services WHERE category = 'room' AND active = 1").get().u;
  const paid = db.prepare(`SELECT method, SUM(amount) AS amount, COUNT(*) AS count FROM payments
    WHERE status = 'Paid' AND date(paid_at) BETWEEN ? AND ? GROUP BY method`).all(from, to);
  const daily = db.prepare(`SELECT date(paid_at) AS date, SUM(amount) AS amount FROM payments
    WHERE status = 'Paid' AND date(paid_at) BETWEEN ? AND ? GROUP BY date(paid_at) ORDER BY date`).all(from, to);
  const dailyReservations = db.prepare(`SELECT date(created_at) AS date, COUNT(*) AS count FROM reservations
    WHERE date(created_at) BETWEEN ? AND ? GROUP BY date(created_at) ORDER BY date`).all(from, to);
  const byStatus = db.prepare('SELECT status, COUNT(*) AS count FROM reservations WHERE check_in BETWEEN ? AND ? GROUP BY status').all(from, to);
  const topCustomers = new Map();
  for (const r of rows) {
    const customer = topCustomers.get(r.guest_email) || { name: r.guest_name, email: r.guest_email, visits: 0, bookedValue: 0 };
    customer.visits++;
    customer.bookedValue += r.total_price;
    topCustomers.set(r.guest_email, customer);
  }
  const newCustomers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'guest' AND date(created_at) BETWEEN ? AND ?").get(from, to).count;

  res.json({
    from, to,
    reservations: rows.length,
    nightsSold: nights,
    occupancyPercent: units ? round2((nights / (units * days)) * 100) : 0,
    bookedValue: round2(rows.reduce((t, r) => t + r.total_price, 0)),
    collected: round2(paid.reduce((t, p) => t + p.amount, 0)),
    newCustomers,
    byStatus,
    byRoom: [...byRoom.values()].map((r) => ({ ...r, bookedValue: round2(r.bookedValue) })),
    topCustomers: [...topCustomers.values()]
      .map((customer) => ({ ...customer, bookedValue: round2(customer.bookedValue) }))
      .sort((a, b) => b.bookedValue - a.bookedValue)
      .slice(0, 10),
    paymentsByMethod: paid.map((p) => ({ method: p.method, count: p.count, amount: round2(p.amount) })),
    dailyCollected: daily.map((d) => ({ date: d.date, amount: round2(d.amount) })),
    dailyReservations,
  });
});

module.exports = router;

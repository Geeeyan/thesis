const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { dateSchema, HttpError, addDays, eachNight } = require('../lib/util');
const { validateStay, unitsLeft } = require('../lib/reservations');
const { publicLimiter } = require('../middleware/errors');
const { expireUnpaidWalkIns } = require('../lib/walkin-expiration');
const { getArrivalTimeOptions } = require('../lib/arrival-times');
const { optionalAuth } = require('../middleware/auth');

router.get('/calendar', publicLimiter, optionalAuth, (req, res) => {
  expireUnpaidWalkIns();
  const q = z.object({
    room: z.string().min(1).max(40),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
  }).refine((query) => Boolean(query.month) !== Boolean(query.from || query.to)
    && (!query.from && !query.to || Boolean(query.from && query.to)),
  'Provide either a month or both from and to dates').parse(req.query);
  if (!db.prepare("SELECT 1 FROM services WHERE code = ? AND category = 'room' AND active = 1").get(q.room)) {
    throw new HttpError(404, 'That room type does not exist');
  }

  let from = q.from;
  let to = q.to;
  if (q.month) {
    from = `${q.month}-01`;
    const [year, month] = q.month.split('-').map(Number);
    to = addDays(from, new Date(Date.UTC(year, month, 0)).getUTCDate() - 1);
  }
  if (from > to) throw new HttpError(400, '"from" must not be after "to"');
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400000) {
    throw new HttpError(400, 'Date search is limited to 366 days');
  }
  const service = db.prepare('SELECT same_day_checkout FROM services WHERE code = ?').get(q.room);
  const unavailableDates = eachNight(from, addDays(to, 1))
    .filter((date) => service.same_day_checkout
      ? !getArrivalTimeOptions(date, q.room, new Date(), { userId: req.user?.id }).some((option) => option.available)
      : unitsLeft(q.room, date, addDays(date, 1)) === 0);
  res.json({ room: q.room, ...(q.month ? { month: q.month } : { from, to }), unavailableDates });
});

router.get('/', publicLimiter, (req, res) => {
  expireUnpaidWalkIns();
  const q = z.object({ room: z.string().max(40).optional(), checkIn: dateSchema, checkOut: dateSchema }).parse(req.query);
  const nights = validateStay(q.checkIn, q.checkOut);
  const rooms = db.prepare("SELECT * FROM services WHERE category = 'room' AND active = 1 AND (? IS NULL OR code = ?) ORDER BY price").all(q.room ?? null, q.room ?? null);
  if (q.room && !rooms.length) throw new HttpError(404, 'That room type does not exist');
  res.json(rooms.map((r) => {
    const left = r.same_day_checkout
      ? getArrivalTimeOptions(q.checkIn, r.code).some((option) => option.available) ? 1 : 0
      : unitsLeft(r.code, q.checkIn, q.checkOut);
    const roomTotal = r.pricing_mode === 'night' ? r.price * nights : r.pricing_mode === 'stay' ? r.price : null;
    return {
      room: r.code,
      name: r.name,
      capacity: r.capacity,
      totalUnits: r.quantity,
      price: r.price,
      pricingMode: r.pricing_mode,
      pricePerNight: r.pricing_mode === 'night' ? r.price : null,
      nights: r.same_day_checkout ? 1 : nights,
      roomTotal: roomTotal === null ? null : Math.round(roomTotal * 100) / 100,
      available: left > 0,
      unitsLeft: left,
    };
  }));
});

module.exports = router;

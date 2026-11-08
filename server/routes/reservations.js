const crypto = require('node:crypto');
const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { authenticate, optionalAuth, staffOnly } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/errors');
const { HttpError, emailSchema, dateSchema, parseId, today, addDays, nightsBetween, timeInTimezone } = require('../lib/util');
const { recordGuest } = require('../lib/users');
const { expireUnpaidWalkIns } = require('../lib/walkin-expiration');
const config = require('../config');
const R = require('../lib/reservations');
const { arrivalTimeSchema, getArrivalTimeOptions, validateArrivalTimeForDate } = require('../lib/arrival-times');
const mailer = require('../lib/mailer');
const { emailDetails } = require('../lib/booking-email');

const createSchema = z.object({
  guestName: z.string().trim().min(1).max(100).optional(),
  guestEmail: emailSchema.optional(),
  guestPhone: z.string().trim().max(40).optional(),
  room: z.string().min(1).max(40),
  checkIn: dateSchema,
  preferredTime: arrivalTimeSchema.optional(),
  checkOut: dateSchema,
  guests: z.number().int().min(1).max(100),
  bookingType: z.enum(['Online', 'Walk-in']).default('Online'),
  addons: z.array(z.unknown()).max(0, 'Add-on services are no longer available').default([]),
  notes: z.string().trim().max(1000).optional(),
});

const changeRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('cancellation'),
    reason: z.enum(['Change of plans', 'Found a better option', 'Personal emergency', 'Financial reasons', 'Duplicate booking', 'Other']),
    note: z.string().trim().max(1000).default(''),
  }),
  z.strictObject({
    type: z.literal('reschedule'),
    checkIn: dateSchema,
    checkOut: dateSchema,
    preferredTime: arrivalTimeSchema.optional(),
    note: z.string().trim().max(1000).default(''),
  }),
]);

function saveReservation(body, { user = null, bookingType = 'Online', recordAnonymousGuest = true, initialStatus } = {}) {
  expireUnpaidWalkIns();
  const service = R.getService(body.room);
  validateArrivalTimeForDate(body.checkIn, body.preferredTime, service);
  const name = user?.name ?? body.guestName;
  const email = user?.email ?? body.guestEmail;
  if (!name || !email) throw new HttpError(400, 'Guest name and email are required');
  const quote = R.buildQuote(body);
  const dateTimes = R.reservationDateTimes(body.room, body.checkIn, body.checkOut, body.preferredTime);

  const id = db.transaction(() => {
    const userOverlap = user && (service.same_day_checkout
      ? R.userHasOverlappingReservation(user.id, body.room, body.checkIn, body.preferredTime, service.duration_minutes)
      : db.prepare(`SELECT 1 FROM reservations
        WHERE user_id = ? AND status != 'Cancelled' AND check_in < ? AND check_out > ?`).get(user.id, body.checkOut, body.checkIn));
    if (userOverlap) {
      throw new HttpError(409, 'You already have a reservation that overlaps those dates');
    }
    const remaining = service.same_day_checkout
      ? R.sameDayUnitsLeft(body.room, body.checkIn, body.preferredTime)
      : R.unitsLeft(body.room, body.checkIn, body.checkOut);
    if (remaining < 1) {
      throw new HttpError(409, 'Sorry, that room is no longer available for those dates');
    }
    let reference;
    do reference = R.generateReference(); while (db.prepare('SELECT 1 FROM reservations WHERE reference = ?').get(reference));
    if (!user && recordAnonymousGuest) recordGuest({ name, email });
    const status = initialStatus ?? (bookingType === 'Walk-in' ? 'Checked-in' : 'Pending');
    return db.prepare(`INSERT INTO reservations
      (reference, user_id, guest_name, guest_email, guest_phone, room_code, check_in, preferred_time, check_out, start_datetime, end_datetime, guests, addons, notes, total_price, booking_type, payment_due_at, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`)
      .run(reference, user?.id ?? null, name, email, body.guestPhone ?? null,
        body.room, body.checkIn, body.preferredTime ?? null, body.checkOut,
        dateTimes.startDateTime, dateTimes.endDateTime, body.guests,
        JSON.stringify(quote.addons), body.notes ?? null, quote.total, bookingType, status).lastInsertRowid;
  }).immediate();
  return R.toReservation(db.prepare(`${R.SELECT} WHERE r.id = ?`).get(id));
}

router.get('/arrival-times', publicLimiter, optionalAuth, (req, res) => {
  const { date, room } = z.strictObject({ date: dateSchema, room: z.string().min(1).max(40).optional() }).parse(req.query);
  if (room && !R.getService(room)) throw new HttpError(404, 'That service does not exist');
  res.json({ options: getArrivalTimeOptions(date, room, new Date(), { userId: req.user?.id }) });
});

// Guests may book without an account. If a valid token is sent the booking is linked to that account.
router.post('/', publicLimiter, optionalAuth, (req, res) => {
  const b = createSchema.parse(req.body);
  const reservation = saveReservation(b, {
    user: req.user,
    bookingType: b.bookingType,
    initialStatus: 'Pending',
  });
  mailer.sendEmailInBackground(reservation.guestEmail, 'booking_received', emailDetails(reservation));
  res.status(201).json(reservation);
});

router.post('/walk-in', authenticate, staffOnly, (req, res) => {
  const body = z.strictObject({
    guestName: z.string().trim().min(1).max(100),
    guestEmail: emailSchema,
    guestPhone: z.string().trim().max(40).optional(),
    room: z.string().min(1).max(40),
    checkIn: dateSchema,
    preferredTime: arrivalTimeSchema.optional(),
    checkOut: dateSchema,
    guests: z.number().int().min(1).max(100),
    notes: z.string().trim().max(1000).optional(),
  }).parse(req.body);
  res.status(201).json(saveReservation(body, { bookingType: 'Walk-in', recordAnonymousGuest: false }));
});

router.get('/', authenticate, (req, res) => {
  expireUnpaidWalkIns();
  const q = z.object({
    status: z.enum(R.STATUSES).optional(), room: z.string().max(40).optional(), from: dateSchema.optional(), to: dateSchema.optional(),
    q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0),
  }).parse(req.query);
  const where = [], vals = [];
  if (req.user.role === 'guest') { where.push('r.user_id = ?'); vals.push(req.user.id); }
  if (q.status) { where.push('r.status = ?'); vals.push(q.status); }
  if (q.room) { where.push('r.room_code = ?'); vals.push(q.room); }
  if (q.from) { where.push('r.check_out >= ?'); vals.push(q.from); }
  if (q.to) { where.push('r.check_in <= ?'); vals.push(q.to); }
  if (q.q) { where.push('(r.guest_name LIKE ? OR r.guest_email LIKE ? OR r.reference LIKE ?)'); vals.push(...Array(3).fill(`%${q.q}%`)); }
  const rows = db.prepare(`${R.SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.check_in ASC, r.id ASC LIMIT ? OFFSET ?`).all(...vals, q.limit, q.offset);
  res.json(rows.map((r) => R.toReservation(r)));
});

router.get('/:id/available-dates', authenticate, publicLimiter, (req, res) => {
  expireUnpaidWalkIns();
  if (req.user.role !== 'guest') throw new HttpError(403, 'Only guests can reschedule bookings');
  const { from, to, nights: requestedNights } = z.strictObject({
    from: dateSchema,
    to: dateSchema,
    nights: z.coerce.number().int().min(1).max(R.MAX_NIGHTS).optional(),
  }).parse(req.query);
  if (from > to) throw new HttpError(400, '"from" must not be after "to"');
  if (nightsBetween(from, to) > 366) throw new HttpError(400, 'Date search is limited to 366 days');

  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?')
    .get(parseId(req.params.id), req.user.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');
  if (!R.changeRequestsAllowed(reservation)) {
    throw new HttpError(409, 'Cancellation and rescheduling are only available until 72 hours before check-in');
  }
  const service = R.getService(reservation.room_code);
  const nights = service.same_day_checkout ? 1 : requestedNights ?? nightsBetween(reservation.check_in, reservation.check_out);
  const availableDates = [];
  const firstDate = from < today() ? today() : from;
  const hasOtherBooking = db.prepare(`SELECT 1 FROM reservations
    WHERE user_id = ? AND id != ? AND status != 'Cancelled' AND check_in < ? AND check_out > ?`);
  for (let date = firstDate; date <= to; date = addDays(date, 1)) {
    const checkOut = service.same_day_checkout ? date : addDays(date, nights);
    if (service.same_day_checkout) {
      const options = getArrivalTimeOptions(date, reservation.room_code, new Date(), {
        excludeReservationId: reservation.id,
        userId: req.user.id,
      }).filter((option) => option.available);
      if (options.length) availableDates.push({ checkIn: date, checkOut, options });
      continue;
    }
    if (
      !hasOtherBooking.get(req.user.id, reservation.id, checkOut, date)
      && R.unitsLeft(reservation.room_code, date, checkOut, reservation.id) > 0
    ) {
      availableDates.push({ checkIn: date, checkOut });
    }
  }
  res.json({ availableDates });
});

// Anyone holding the reference can look the booking up, but only owner/staff see contact details.
router.get('/:reference', publicLimiter, optionalAuth, (req, res) => {
  expireUnpaidWalkIns();
  const r = db.prepare(`${R.SELECT} WHERE r.reference = ?`).get(String(req.params.reference).toUpperCase());
  if (!r) throw new HttpError(404, 'Reservation not found');
  if (req.user?.role === 'guest' && r.user_id !== req.user.id) throw new HttpError(404, 'Reservation not found');
  res.json(R.toReservation(r, R.canAccess(req.user, r) ? 'full' : 'public'));
});

router.patch('/:id/status', authenticate, staffOnly, (req, res) => {
  const { status } = z.strictObject({ status: z.enum(R.STATUSES) }).parse(req.body);
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(parseId(req.params.id));
  if (!r) throw new HttpError(404, 'Reservation not found');
  if (!R.TRANSITIONS[r.status].includes(status))
    throw new HttpError(409, `A ${r.status} reservation cannot be changed to ${status}`, { allowed: R.TRANSITIONS[r.status] });
  db.prepare("UPDATE reservations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, r.id);
  const reservation = R.toReservation(db.prepare(`${R.SELECT} WHERE r.id = ?`).get(r.id));
  if (status === 'Confirmed') {
    mailer.sendEmailInBackground(reservation.guestEmail, 'booking_confirmation', emailDetails(reservation));
  } else if (status === 'Cancelled') {
    mailer.sendEmailInBackground(reservation.guestEmail, 'booking_cancellation', emailDetails(reservation));
  }
  res.json(reservation);
});

router.post('/:id/change-requests', authenticate, publicLimiter, (req, res) => {
  if (req.user.role !== 'guest') throw new HttpError(403, 'Only guests can request booking changes');
  const body = changeRequestSchema.parse(req.body);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?')
    .get(parseId(req.params.id), req.user.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');
  if (!R.changeRequestsAllowed(reservation)) {
    throw new HttpError(409, 'Cancellation and rescheduling are only available until 72 hours before check-in');
  }

  let requestDetails;
  if (body.type === 'cancellation') {
    requestDetails = `Request: Cancellation\nReason: ${body.reason}`;
  } else {
    const service = R.getService(reservation.room_code);
    if (service?.same_day_checkout) {
      if (body.checkOut !== body.checkIn) throw new HttpError(400, 'Check-out must be on the same day as check-in.');
      validateArrivalTimeForDate(body.checkIn, body.preferredTime, service);
      if (R.sameDayUnitsLeft(reservation.room_code, body.checkIn, body.preferredTime, reservation.id) < 1
        || R.userHasOverlappingReservation(req.user.id, reservation.room_code, body.checkIn, body.preferredTime, service.duration_minutes, reservation.id)) {
        throw new HttpError(409, 'The requested time is no longer available. Choose another start time.');
      }
    } else {
      R.validateStay(body.checkIn, body.checkOut);
    }
    if (body.checkIn === reservation.check_in && body.checkOut === reservation.check_out) {
      if (!service?.same_day_checkout || body.preferredTime === reservation.preferred_time) {
        throw new HttpError(400, 'Choose a different date or time for a reschedule request');
      }
    }
    if (!service?.same_day_checkout) {
      const hasOtherBooking = db.prepare(`SELECT 1 FROM reservations
        WHERE user_id = ? AND id != ? AND status != 'Cancelled' AND check_in < ? AND check_out > ?`)
        .get(req.user.id, reservation.id, body.checkOut, body.checkIn);
      if (hasOtherBooking || R.unitsLeft(reservation.room_code, body.checkIn, body.checkOut, reservation.id) < 1) {
        throw new HttpError(409, 'The requested dates are no longer available. Choose different dates.');
      }
    }
    const requestedEndTime = service?.same_day_checkout
      ? timeInTimezone(R.reservationDateTimes(reservation.room_code, body.checkIn, body.checkOut, body.preferredTime).endDateTime)
      : null;
    requestDetails = `Request: Reschedule\nRequested check-in: ${body.checkIn}${body.preferredTime ? ` at ${body.preferredTime}` : ''}\nRequested check-out: ${body.checkOut}${requestedEndTime ? ` at ${requestedEndTime}` : ''}${service?.same_day_checkout ? `\nDuration: ${service.duration_minutes / 60} hours` : ''}\nAvailability and applicable policy will need to be confirmed by staff.`;
  }
  if (body.note) requestDetails += `\nAdditional notes: ${body.note}`;
  const subject = `${body.type === 'cancellation' ? 'Cancellation' : 'Reschedule'} request: ${reservation.reference}`;
  const accessHash = crypto.randomBytes(32).toString('hex');
  const conversationId = db.transaction(() => {
    const id = db.prepare(`INSERT INTO conversations (user_id, guest_name, guest_email, guest_phone, subject, access_hash)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, reservation.guest_name, reservation.guest_email, reservation.guest_phone, subject, accessHash).lastInsertRowid;
    const message = `Booking reference: ${reservation.reference}\nCurrent stay: ${reservation.check_in}${reservation.preferred_time ? ` at ${reservation.preferred_time}` : ''} to ${reservation.check_out}${reservation.end_datetime && R.getService(reservation.room_code)?.same_day_checkout ? ` at ${timeInTimezone(reservation.end_datetime)}` : ''}\n${requestDetails}`;
    db.prepare(`INSERT INTO conversation_messages (conversation_id, sender_user_id, sender_role, body)
      VALUES (?, ?, 'guest', ?)`).run(id, req.user.id, message);
    db.prepare(`INSERT INTO reservation_change_requests
      (conversation_id, reservation_id, request_type, requested_check_in, requested_check_out, requested_preferred_time, reason, guest_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      reservation.id,
      body.type,
      body.type === 'reschedule' ? body.checkIn : null,
      body.type === 'reschedule' ? body.checkOut : null,
      body.type === 'reschedule' ? body.preferredTime ?? null : null,
      body.type === 'cancellation' ? body.reason : null,
      body.note,
    );
    return id;
  })();
  const notice = emailDetails(R.toReservation(db.prepare(`${R.SELECT} WHERE r.id = ?`).get(reservation.id)));
  if (body.type === 'reschedule') {
    const service = R.getService(reservation.room_code);
    notice.date = body.checkIn === body.checkOut ? body.checkIn : `${body.checkIn} to ${body.checkOut}`;
    notice.startTime = body.preferredTime || '—';
    notice.endTime = service?.same_day_checkout
      ? timeInTimezone(R.reservationDateTimes(
        reservation.room_code, body.checkIn, body.checkOut, body.preferredTime,
      ).endDateTime)
      : body.checkOut;
    notice.total = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: config.currency,
    }).format(R.buildQuote({
      room: reservation.room_code,
      checkIn: body.checkIn,
      checkOut: body.checkOut,
      guests: reservation.guests,
    }).total);
  }
  mailer.sendEmailInBackground(
    reservation.guest_email,
    body.type === 'cancellation' ? 'cancellation_request' : 'reschedule_request',
    notice,
  );
  res.status(201).json({ conversationId, subject });
});

module.exports = router;

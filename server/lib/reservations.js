const crypto = require('crypto');
const db = require('../db');
const { HttpError, today, addDays, nightsBetween, eachNight, round2, dateTimeInTimezone, dateInTimezone, timeInTimezone, checkInWithin72Hours } = require('./util');

const MAX_NIGHTS = 30;
const STATUSES = ['Pending', 'Confirmed', 'Checked-in', 'Completed', 'Cancelled'];
const TRANSITIONS = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Checked-in', 'Completed', 'Cancelled'],
  'Checked-in': ['Completed'],
  Completed: [],
  Cancelled: [],
};

// Every query that returns reservations uses this so `paid` is always computed the same way.
const SELECT = `SELECT r.*, s.name AS room_name, s.price AS room_price, s.unit AS room_unit, s.pricing_mode AS room_pricing_mode,
  s.duration_minutes AS room_duration_minutes, s.same_day_checkout AS room_same_day_checkout,
  COALESCE((SELECT SUM(amount) FROM payments p WHERE p.reservation_id = r.id AND p.status = 'Paid'), 0) AS paid,
  EXISTS (
    SELECT 1 FROM conversation_message_documents a
    JOIN documents d ON d.id = a.document_id
    JOIN conversation_messages m ON m.id = a.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE d.reservation_id = r.id AND c.subject = 'Payment proof: ' || r.reference
      AND EXISTS (SELECT 1 FROM payments p WHERE p.reservation_id = r.id AND p.status = 'Pending')
  ) AS payment_proof_submitted
  FROM reservations r JOIN services s ON s.code = r.room_code`;

const getService = (code) => db.prepare('SELECT * FROM services WHERE code = ?').get(code);
const mask = (e) => e.replace(/^(.).*(@.*)$/, '$1***$2');

function toReservation(r, view = 'full') {
  const total = round2(r.total_price), paid = round2(r.paid || 0);
  const sameDayCheckout = Boolean(r.room_same_day_checkout && r.check_in === r.check_out
    && r.start_datetime && r.end_datetime
    && dateInTimezone(r.start_datetime) === dateInTimezone(r.end_datetime));
  const nights = sameDayCheckout ? 1 : nightsBetween(r.check_in, r.check_out);
  const roomTotal = r.room_pricing_mode === 'guest'
    ? round2(r.room_price * r.guests)
    : r.room_pricing_mode === 'stay'
      ? round2(r.room_price)
      : round2(r.room_price * nights);
  const out = {
    id: r.id, reference: r.reference, guestName: r.guest_name, guestEmail: r.guest_email, guestPhone: r.guest_phone,
    bookingType: r.booking_type || 'Online',
    room: r.room_code, roomName: r.room_name, roomPrice: round2(r.room_price), roomUnit: r.room_unit,
    roomTotal, roomPricingMode: r.room_pricing_mode, checkIn: r.check_in, preferredTime: r.preferred_time || null, checkOut: r.check_out,
    sameDayCheckout, durationMinutes: r.room_duration_minutes || null,
    startDateTime: r.start_datetime || null, endDateTime: r.end_datetime || null,
    checkOutTime: sameDayCheckout ? timeInTimezone(r.end_datetime) : null,
    nights, guests: r.guests, addons: JSON.parse(r.addons), notes: r.notes,
    total, paid, balance: round2(Math.max(0, total - paid)),
    paymentStatus: paid >= total && total > 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid',
    paymentProofSubmitted: !!r.payment_proof_submitted,
    paymentDueAt: r.payment_due_at
      ? new Date(`${r.payment_due_at.replace(' ', 'T')}Z`).toISOString()
      : null,
    changeRequestsAllowed: ['Pending', 'Confirmed'].includes(r.status)
      && r.check_in >= today()
      && !checkInWithin72Hours(r.check_in),
    status: r.status, createdAt: r.created_at,
  };
  if (view === 'public') { // someone who only knows the reference
    delete out.id; delete out.guestPhone; delete out.notes;
    out.guestEmail = mask(out.guestEmail);
  }
  return out;
}

const generateReference = () => {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  const bytes = crypto.randomBytes(10);
  return 'VT-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

// How many units of this room are still free for every night of the stay.
function unitsLeft(roomCode, checkIn, checkOut, excludeReservationId) {
  const room = getService(roomCode);
  const start = Date.parse(dateTimeInTimezone(checkIn, '00:00'));
  const end = Date.parse(dateTimeInTimezone(checkOut, '00:00'));
  const overlapping = db.prepare(`SELECT r.*, s.same_day_checkout AS room_same_day_checkout FROM reservations r
    JOIN services s ON s.code = r.room_code
    WHERE r.status IN ('Pending', 'Confirmed', 'Checked-in') ${excludeReservationId === undefined ? '' : 'AND r.id != ?'}`)
    .all(...(excludeReservationId === undefined ? [] : [excludeReservationId]))
    .filter((reservation) => {
      const [reservationStart, reservationEnd] = intervalForReservation(reservation);
      return reservationStart < end && reservationEnd > start;
    });
  const villaBooked = overlapping.some((reservation) => reservation.room_code === 'entire-villa');
  if (roomCode === 'entire-villa') {
    return villaBooked || overlapping.length > 0 ? 0 : room.quantity;
  }
  if (villaBooked) return 0;
  const rows = overlapping.filter((reservation) => reservation.room_code === roomCode);
  let busiest = 0;
  for (const night of eachNight(checkIn, checkOut)) {
    const nightStart = Date.parse(dateTimeInTimezone(night, '00:00'));
    const nightEnd = Date.parse(dateTimeInTimezone(addDays(night, 1), '00:00'));
    busiest = Math.max(busiest, rows.filter((reservation) => {
      const [reservationStart, reservationEnd] = intervalForReservation(reservation);
      return reservationStart < nightEnd && reservationEnd > nightStart;
    }).length);
  }
  return Math.max(0, room.quantity - busiest);
}

function intervalForReservation(reservation) {
  if (reservation.start_datetime && reservation.end_datetime) {
    return [Date.parse(reservation.start_datetime), Date.parse(reservation.end_datetime)];
  }
  const start = Date.parse(dateTimeInTimezone(reservation.check_in, '00:00'));
  const endDate = reservation.check_out > reservation.check_in
    ? reservation.check_out
    : addDays(reservation.check_in, 1);
  return [start, Date.parse(dateTimeInTimezone(endDate, '00:00'))];
}

function requestedSameDayInterval(date, time, durationMinutes) {
  const start = Date.parse(dateTimeInTimezone(date, time));
  const end = start + durationMinutes * 60_000;
  if (dateInTimezone(end) !== date) {
    throw new HttpError(400, 'Check-out must be on the same day as check-in.');
  }
  return [start, end];
}

function sameDayUnitsLeft(roomCode, date, time, excludeReservationId) {
  const service = getService(roomCode);
  if (!service?.same_day_checkout) return unitsLeft(roomCode, date, addDays(date, 1), excludeReservationId);
  const [start, end] = requestedSameDayInterval(date, time, service.duration_minutes);
  const rows = db.prepare(`SELECT r.*, s.same_day_checkout AS room_same_day_checkout FROM reservations r
    JOIN services s ON s.code = r.room_code
    WHERE r.status IN ('Pending', 'Confirmed', 'Checked-in') ${excludeReservationId === undefined ? '' : 'AND r.id != ?'}`)
    .all(...(excludeReservationId === undefined ? [] : [excludeReservationId]));
  const conflicts = rows.filter((reservation) => {
    if (roomCode === 'entire-villa') return true;
    return reservation.room_code === roomCode || reservation.room_code === 'entire-villa';
  }).filter((reservation) => {
    const [existingStart, existingEnd] = intervalForReservation(reservation);
    return start < existingEnd && end > existingStart;
  });
  if (conflicts.some((reservation) => reservation.room_code === 'entire-villa')) return 0;
  const occupied = roomCode === 'entire-villa'
    ? conflicts.length
    : conflicts.filter((reservation) => reservation.room_code === roomCode).length;
  return Math.max(0, service.quantity - occupied);
}

function userHasOverlappingReservation(userId, roomCode, date, time, durationMinutes, excludeReservationId) {
  const [start, end] = requestedSameDayInterval(date, time, durationMinutes);
  const rows = db.prepare(`SELECT * FROM reservations WHERE user_id = ? AND status != 'Cancelled'
    AND id != ?`).all(userId, excludeReservationId ?? -1);
  return rows.some((reservation) => {
    const [existingStart, existingEnd] = intervalForReservation(reservation);
    return start < existingEnd && end > existingStart;
  });
}

function reservationDateTimes(roomCode, checkIn, checkOut, preferredTime) {
  const service = getService(roomCode);
  if (service?.same_day_checkout) {
    const [start, end] = requestedSameDayInterval(checkIn, preferredTime, service.duration_minutes);
    return { startDateTime: new Date(start).toISOString(), endDateTime: new Date(end).toISOString() };
  }
  return {
    startDateTime: dateTimeInTimezone(checkIn, '00:00'),
    endDateTime: dateTimeInTimezone(checkOut, '00:00'),
  };
}

function validateStay(checkIn, checkOut) {
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) throw new HttpError(400, 'Check-out must be after check-in');
  if (nights > MAX_NIGHTS) throw new HttpError(400, `Stays are limited to ${MAX_NIGHTS} nights online. Please contact us for longer stays`);
  if (checkIn < today()) throw new HttpError(400, 'Check-in cannot be in the past');
  return nights;
}

// All prices come from the database. The client never tells us what something costs.
function buildQuote({ room, checkIn, checkOut, guests }, { allowInactive = false } = {}) {
  const svc = getService(room);
  if (!svc || svc.category !== 'room' || (!svc.active && !allowInactive)) throw new HttpError(404, 'That room type does not exist');
  const nights = svc.same_day_checkout
    ? (() => {
      if (checkOut !== checkIn) throw new HttpError(400, 'Check-out must be on the same day as check-in.');
      if (checkIn < today()) throw new HttpError(400, 'Check-in cannot be in the past');
      return 1;
    })()
    : validateStay(checkIn, checkOut);
  if (guests > svc.capacity) throw new HttpError(400, `${svc.name} sleeps at most ${svc.capacity} guests`);
  if (svc.code === 'event' && nights !== 1) throw new HttpError(400, 'Event Space bookings are for one 12-hour date at a time');
  const roomTotal = svc.pricing_mode === 'guest'
    ? round2(svc.price * guests)
    : svc.pricing_mode === 'stay'
      ? round2(svc.price)
      : round2(svc.price * nights);
  return { nights, room: svc, roomTotal, addons: [], total: roomTotal };
}

const canAccess = (user, r) => !!user && (user.role !== 'guest' || r.user_id === user.id);

const changeRequestsAllowed = (reservation, now) => ['Pending', 'Confirmed'].includes(reservation.status)
  && reservation.check_in >= today()
  && !checkInWithin72Hours(reservation.check_in, now);

module.exports = { MAX_NIGHTS, STATUSES, TRANSITIONS, SELECT, getService, toReservation, generateReference, unitsLeft, sameDayUnitsLeft, userHasOverlappingReservation, reservationDateTimes, requestedSameDayInterval, validateStay, buildQuote, canAccess, changeRequestsAllowed };

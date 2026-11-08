const crypto = require('node:crypto');
const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { authenticate, optionalAuth, staffOnly } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/errors');
const { HttpError, emailSchema, parseId, round2, nightsBetween, today, timeInTimezone } = require('../lib/util');
const { recordGuest } = require('../lib/users');
const R = require('../lib/reservations');
const mailer = require('../lib/mailer');
const { emailDetails } = require('../lib/booking-email');

const MESSAGE_SELECT = `SELECT m.*, u.name AS sender_name
  FROM conversation_messages m LEFT JOIN users u ON u.id = m.sender_user_id`;
const conversationSelect = `SELECT c.*,
  (SELECT body FROM conversation_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
  (SELECT created_at FROM conversation_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_at
  FROM conversations c`;
const conversationListSelect = `SELECT c.*,
  (SELECT body FROM conversation_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message,
  (SELECT created_at FROM conversation_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS last_message_at,
  (SELECT COUNT(*) FROM conversation_messages unread
    WHERE unread.conversation_id = c.id
      AND unread.sender_role IN ('staff', 'admin')
      AND unread.id > c.guest_last_read_message_id) AS unread_count
  FROM conversations c`;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const attachmentSelect = `SELECT d.id, d.original_name, d.mime_type, d.size, d.reservation_id,
  r.reference, (SELECT p.id FROM payments p WHERE p.reservation_id = r.id ORDER BY p.id DESC LIMIT 1) AS payment_id,
  (SELECT p.status FROM payments p WHERE p.reservation_id = r.id ORDER BY p.id DESC LIMIT 1) AS payment_status,
  (SELECT p.amount FROM payments p WHERE p.reservation_id = r.id ORDER BY p.id DESC LIMIT 1) AS payment_amount
  FROM conversation_message_documents a
  JOIN documents d ON d.id = a.document_id
  JOIN reservations r ON r.id = d.reservation_id`;

function toMessage(row) {
  const attachments = db.prepare(`${attachmentSelect} WHERE a.message_id = ?`).all(row.id).map((attachment) => ({
    id: attachment.id,
    originalName: attachment.original_name,
    mimeType: attachment.mime_type,
    size: attachment.size,
    reservationId: attachment.reservation_id,
    reservation: attachment.reference,
    paymentId: attachment.payment_id,
    paymentStatus: attachment.payment_status,
    paymentAmount: attachment.payment_amount,
  }));
  return {
    id: row.id,
    senderRole: row.sender_role,
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at,
    attachments,
  };
}

function canAccess(req, conversation) {
  if (req.user?.role === 'admin' || req.user?.role === 'staff') return true;
  if (req.user && conversation.user_id === req.user.id) return true;
  const token = req.get('x-inquiry-token') || '';
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = Buffer.from(conversation.access_hash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function findConversation(req) {
  const conversation = db.prepare(`${conversationSelect} WHERE c.id = ?`).get(parseId(req.params.id));
  if (!conversation || !canAccess(req, conversation)) throw new HttpError(404, 'Conversation not found');
  return conversation;
}

function getChangeRequest(conversationId) {
  const changeRequest = db.prepare('SELECT * FROM reservation_change_requests WHERE conversation_id = ?').get(conversationId);
  if (!changeRequest) return null;
  const reservation = db.prepare(`${R.SELECT} WHERE r.id = ?`).get(changeRequest.reservation_id);
  const reservationView = R.toReservation(reservation);
  const service = R.getService(reservation.room_code);
  const details = {
    id: changeRequest.id,
    type: changeRequest.request_type,
    status: changeRequest.status,
    reason: changeRequest.reason,
    note: changeRequest.guest_note,
    requestedCheckIn: changeRequest.requested_check_in,
    requestedCheckOut: changeRequest.requested_check_out,
    requestedPreferredTime: changeRequest.requested_preferred_time,
    requestedCheckOutTime: changeRequest.requested_preferred_time && service?.same_day_checkout
      ? timeInTimezone(R.reservationDateTimes(
        reservation.room_code,
        changeRequest.requested_check_in,
        changeRequest.requested_check_out,
        changeRequest.requested_preferred_time,
      ).endDateTime)
      : null,
    reviewedAt: changeRequest.reviewed_at,
    reservation: {
      id: reservation.id,
      reference: reservation.reference,
      status: reservation.status,
      checkIn: reservation.check_in,
      checkOut: reservation.check_out,
      preferredTime: reservation.preferred_time,
      checkOutTime: reservationView.checkOutTime,
      sameDayCheckout: reservationView.sameDayCheckout,
      durationMinutes: reservationView.durationMinutes,
      total: round2(reservation.total_price),
      paid: round2(reservation.paid),
    },
  };
  if (changeRequest.request_type === 'reschedule') {
    const room = service;
    if (room) {
      const nights = room.same_day_checkout ? 1 : nightsBetween(changeRequest.requested_check_in, changeRequest.requested_check_out);
      details.requestedTotal = round2(room.pricing_mode === 'guest'
        ? room.price * reservation.guests
        : room.pricing_mode === 'stay'
          ? room.price
          : room.price * nights);
    }
  }
  return details;
}

router.post('/inquiries', publicLimiter, optionalAuth, (req, res) => {
  const body = z.strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    email: emailSchema.optional(),
    phone: z.string().trim().max(40).optional(),
    subject: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(5000),
  }).parse(req.body);
  const name = req.user?.name || body.name;
  const email = req.user?.email || body.email;
  if (!name || !email) throw new HttpError(400, 'Name and email are required');

  const accessToken = crypto.randomBytes(32).toString('hex');
  const userId = req.user?.id ?? recordGuest({ name, email });
  const create = db.transaction(() => {
    const id = db.prepare(`INSERT INTO conversations (user_id, guest_name, guest_email, guest_phone, subject, access_hash)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(userId, name, email, body.phone ?? null, body.subject, hashToken(accessToken)).lastInsertRowid;
    db.prepare(`INSERT INTO conversation_messages (conversation_id, sender_user_id, sender_role, body)
      VALUES (?, ?, 'guest', ?)`).run(id, req.user?.id ?? null, body.message);
    return id;
  });
  const conversationId = create();
  res.status(201).json({ conversationId, accessToken });
});

router.post('/payment-proof', authenticate, (req, res) => {
  if (req.user.role !== 'guest') throw new HttpError(403, 'Only guests can submit payment proof');
  const body = z.strictObject({
    reservationId: z.coerce.number().int().positive(),
    documentId: z.coerce.number().int().positive(),
    method: z.enum(['ewallet', 'bank']),
    message: z.string().trim().max(5000).default('Payment screenshot attached for review.'),
  }).parse(req.body);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ? AND user_id = ?').get(body.reservationId, req.user.id);
  if (!reservation) throw new HttpError(404, 'Reservation not found');
  if (reservation.status === 'Cancelled' || reservation.status === 'Completed') {
    throw new HttpError(409, `A ${reservation.status} reservation cannot be paid`);
  }
  const document = db.prepare(`SELECT d.*, r.user_id AS owner_id FROM documents d
    JOIN reservations r ON r.id = d.reservation_id
    WHERE d.id = ? AND d.reservation_id = ?`).get(body.documentId, reservation.id);
  if (!document || document.uploaded_by !== req.user.id || document.owner_id !== req.user.id) {
    throw new HttpError(404, 'Payment screenshot not found');
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(document.mime_type)) {
    throw new HttpError(400, 'Payment proof must be a JPEG, PNG, or WebP screenshot');
  }
  const payment = db.prepare('SELECT id, status, method FROM payments WHERE reservation_id = ? ORDER BY id DESC LIMIT 1').get(reservation.id);
  if (!payment || payment.status !== 'Pending' || payment.method !== body.method) {
    throw new HttpError(409, 'Submit a payment request first; payment proof can only be sent for a pending payment');
  }
  const accessHash = hashToken(crypto.randomBytes(32).toString('hex'));
  const create = db.transaction(() => {
    const conversationId = db.prepare(`INSERT INTO conversations (user_id, guest_name, guest_email, guest_phone, subject, access_hash)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, reservation.guest_name, reservation.guest_email, reservation.guest_phone,
        `Payment proof: ${reservation.reference}`, accessHash).lastInsertRowid;
    const messageId = db.prepare(`INSERT INTO conversation_messages (conversation_id, sender_user_id, sender_role, body)
      VALUES (?, ?, 'guest', ?)`).run(conversationId, req.user.id, body.message || 'Payment screenshot attached for review.').lastInsertRowid;
    db.prepare('INSERT INTO conversation_message_documents (message_id, document_id) VALUES (?, ?)').run(messageId, document.id);
    return { conversationId, messageId };
  }).immediate();
  const message = db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(create.messageId);
  res.status(201).json({ conversationId: create.conversationId, message: toMessage(message) });
});

router.get('/', authenticate, (req, res) => {
  const isStaff = req.user.role === 'admin' || req.user.role === 'staff';
  const rows = db.prepare(`${conversationListSelect} ${isStaff ? '' : 'WHERE c.user_id = ?'}
    ORDER BY COALESCE(last_message_at, c.updated_at) DESC, c.id DESC LIMIT 500`)
    .all(...(isStaff ? [] : [req.user.id]));
  res.json(rows.map((row) => ({
    id: row.id,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    subject: row.subject,
    lastMessage: row.last_message || '',
    updatedAt: row.last_message_at || row.updated_at,
    ...(!isStaff ? { unreadCount: row.unread_count } : {}),
  })));
});

router.get('/:id', optionalAuth, (req, res) => {
  const conversation = findConversation(req);
  if (req.user?.role === 'guest' && conversation.user_id === req.user.id) {
    db.prepare(`UPDATE conversations
      SET guest_last_read_message_id = MAX(guest_last_read_message_id, COALESCE((
        SELECT MAX(id) FROM conversation_messages
        WHERE conversation_id = ? AND sender_role IN ('staff', 'admin')
      ), 0))
      WHERE id = ? AND user_id = ?`)
      .run(conversation.id, conversation.id, req.user.id);
  }
  const messages = db.prepare(`${MESSAGE_SELECT} WHERE m.conversation_id = ? ORDER BY m.id`).all(conversation.id);
  res.json({
    id: conversation.id,
    guestName: conversation.guest_name,
    guestEmail: conversation.guest_email,
    guestPhone: conversation.guest_phone,
    subject: conversation.subject,
    changeRequest: getChangeRequest(conversation.id),
    messages: messages.map(toMessage),
  });
});

router.patch('/:id/change-request', authenticate, staffOnly, (req, res) => {
  const conversationId = parseId(req.params.id);
  const { decision, note } = z.strictObject({
    decision: z.enum(['Approved', 'Declined']),
    note: z.string().trim().max(1000).default(''),
  }).parse(req.body);
  const changeRequest = db.prepare('SELECT * FROM reservation_change_requests WHERE conversation_id = ?').get(conversationId);
  if (!changeRequest) throw new HttpError(404, 'Reservation change request not found');
  if (changeRequest.status !== 'Pending') throw new HttpError(409, 'This request has already been reviewed');

  const outcome = db.transaction(() => {
    const reservation = db.prepare(`${R.SELECT} WHERE r.id = ?`).get(changeRequest.reservation_id);
    if (decision === 'Approved') {
      if (!['Pending', 'Confirmed'].includes(reservation.status) || reservation.check_in < today()) {
        throw new HttpError(409, 'Only upcoming pending or confirmed reservations can be changed');
      }
      if (changeRequest.request_type === 'cancellation') {
        if (!R.TRANSITIONS[reservation.status].includes('Cancelled')) {
          throw new HttpError(409, `A ${reservation.status} reservation cannot be cancelled`);
        }
        db.prepare("UPDATE reservations SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?")
          .run(reservation.id);
        db.prepare("UPDATE payments SET status = 'Failed', updated_at = datetime('now') WHERE reservation_id = ? AND status = 'Pending'")
          .run(reservation.id);
      } else {
        const checkIn = changeRequest.requested_check_in;
        const checkOut = changeRequest.requested_check_out;
        const service = R.getService(reservation.room_code);
        const preferredTime = changeRequest.requested_preferred_time;
        if (service.same_day_checkout) {
          const { validateArrivalTimeForDate } = require('../lib/arrival-times');
          if (checkOut !== checkIn) throw new HttpError(400, 'Check-out must be on the same day as check-in.');
          validateArrivalTimeForDate(checkIn, preferredTime, service);
          if (R.sameDayUnitsLeft(reservation.room_code, checkIn, preferredTime, reservation.id) < 1
            || reservation.user_id && R.userHasOverlappingReservation(reservation.user_id, reservation.room_code, checkIn, preferredTime, service.duration_minutes, reservation.id)) {
            throw new HttpError(409, 'The requested time is no longer available');
          }
        } else {
          R.validateStay(checkIn, checkOut);
          if (R.unitsLeft(reservation.room_code, checkIn, checkOut, reservation.id) < 1) {
            throw new HttpError(409, 'The requested dates are no longer available');
          }
        }
        const quote = R.buildQuote({
          room: reservation.room_code,
          checkIn,
          checkOut,
          guests: reservation.guests,
        }, { allowInactive: true });
        if (quote.total + 0.005 < reservation.paid) {
          throw new HttpError(409, 'The new total is less than the amount already paid. Reconcile the difference before approving this reschedule');
        }
        const dateTimes = R.reservationDateTimes(reservation.room_code, checkIn, checkOut, preferredTime || reservation.preferred_time);
        db.prepare(`UPDATE reservations SET check_in = ?, check_out = ?, preferred_time = ?, start_datetime = ?, end_datetime = ?, total_price = ?,
          updated_at = datetime('now') WHERE id = ?`).run(checkIn, checkOut, preferredTime || reservation.preferred_time,
          dateTimes.startDateTime, dateTimes.endDateTime, quote.total, reservation.id);
        db.prepare("UPDATE payments SET status = 'Failed', updated_at = datetime('now') WHERE reservation_id = ? AND status = 'Pending'")
          .run(reservation.id);
      }
    }

    const reviewedAt = new Date().toISOString();
    db.prepare(`UPDATE reservation_change_requests SET status = ?, reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND status = 'Pending'`).run(decision, req.user.id, reviewedAt, changeRequest.id);
    const reference = reservation.reference;
    let message;
    if (decision === 'Declined') {
      message = `Your ${changeRequest.request_type} request for reservation ${reference} was not approved.`;
    } else if (changeRequest.request_type === 'cancellation') {
      message = `Your cancellation request was approved. Reservation ${reference} has been cancelled.`;
    } else {
      const updated = db.prepare('SELECT total_price FROM reservations WHERE id = ?').get(reservation.id);
      message = `Your reschedule request was approved. Your booking is now ${changeRequest.requested_check_in}${changeRequest.requested_preferred_time ? ` at ${changeRequest.requested_preferred_time}` : ''} to ${changeRequest.requested_check_out}${changeRequest.requested_preferred_time ? ` at ${timeInTimezone(R.reservationDateTimes(reservation.room_code, changeRequest.requested_check_in, changeRequest.requested_check_out, changeRequest.requested_preferred_time).endDateTime)}` : ''}. Updated total: ₱${round2(updated.total_price).toLocaleString('en-PH')}.`;
    }
    if (note) message += `\nStaff note: ${note}`;
    db.prepare(`INSERT INTO conversation_messages (conversation_id, sender_user_id, sender_role, body)
      VALUES (?, ?, ?, ?)`).run(conversationId, req.user.id, req.user.role, message);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
    return {
      changeRequest: db.prepare('SELECT * FROM reservation_change_requests WHERE id = ?').get(changeRequest.id),
      reservation: db.prepare(`${R.SELECT} WHERE r.id = ?`).get(reservation.id),
    };
  })();

  if (decision === 'Approved') {
    const reservation = R.toReservation(outcome.reservation);
    mailer.sendEmailInBackground(
      reservation.guestEmail,
      outcome.changeRequest.request_type === 'cancellation' ? 'booking_cancellation' : 'booking_reschedule',
      emailDetails(reservation),
    );
  }
  res.json({
    changeRequest: {
      id: outcome.changeRequest.id,
      type: outcome.changeRequest.request_type,
      status: outcome.changeRequest.status,
      reviewedAt: outcome.changeRequest.reviewed_at,
    },
    reservation: R.toReservation(outcome.reservation),
  });
});

router.post('/:id/replies', publicLimiter, optionalAuth, (req, res) => {
  const conversation = findConversation(req);
  const { body } = z.strictObject({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
  const senderRole = req.user?.role === 'admin' || req.user?.role === 'staff' ? req.user.role : 'guest';
  const result = db.transaction(() => {
    const info = db.prepare(`INSERT INTO conversation_messages (conversation_id, sender_user_id, sender_role, body)
      VALUES (?, ?, ?, ?)`).run(conversation.id, req.user?.id ?? null, senderRole, body);
    db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversation.id);
    return db.prepare(`${MESSAGE_SELECT} WHERE m.id = ?`).get(info.lastInsertRowid);
  })();
  res.status(201).json(toMessage(result));
});

module.exports = router;

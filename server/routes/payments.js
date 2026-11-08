const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { authenticate, optionalAuth, adminOnly } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/errors');
const { HttpError, parseId, round2 } = require('../lib/util');
const R = require('../lib/reservations');
const { expireUnpaidWalkIns } = require('../lib/walkin-expiration');

const toPayment = (p) => ({
  id: p.id, reservation: p.reference, guestName: p.guest_name, method: p.method, amount: round2(p.amount), status: p.status, paidAt: p.paid_at, createdAt: p.created_at, currency: config.currency,
});
const SELECT = 'SELECT p.*, r.reference, r.guest_name FROM payments p JOIN reservations r ON r.id = p.reservation_id';

// Records the guest's intention to pay and returns instructions. It confirms nothing:
// an admin reconciles it once the money has really arrived (no provider/webhook is connected).
router.post('/reservations/:reference/payment-intent', publicLimiter, optionalAuth, (req, res) => {
  expireUnpaidWalkIns();
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).some((k) => /card|cvv|cvc|expir|pan/i.test(k)))
    throw new HttpError(400, 'Card details must never be sent to this API');
  const { method } = z.strictObject({ method: z.enum(['ewallet', 'bank']) }).parse(req.body);
  const r = db.prepare(`${R.SELECT} WHERE r.reference = ?`).get(String(req.params.reference).toUpperCase());
  if (!r) throw new HttpError(404, 'Reservation not found');
  if (req.user?.role === 'guest' && r.user_id !== req.user.id) throw new HttpError(404, 'Reservation not found');
  if (r.booking_type === 'Walk-in') throw new HttpError(409, 'Walk-in reservations do not accept online payments');
  if (r.status === 'Cancelled' || r.status === 'Completed') throw new HttpError(409, `A ${r.status} reservation cannot be paid`);
  const balance = round2(r.total_price - r.paid);
  if (balance <= 0) throw new HttpError(409, 'This reservation is already fully paid');

  const existing = db.prepare("SELECT id FROM payments WHERE reservation_id = ? AND method = ? AND status = 'Pending'").get(r.id, method);
  const id = existing ? existing.id : db.prepare('INSERT INTO payments (reservation_id, method, amount) VALUES (?,?,?)').run(r.id, method, balance).lastInsertRowid;
  const payment = toPayment(db.prepare(`${SELECT} WHERE p.id = ?`).get(id));
  res.status(existing ? 200 : 201).json({ payment, instructions: config.paymentInstructions[method] || null, message: 'Payment is pending until our team confirms it.' });
});

router.get('/payments', authenticate, adminOnly, (req, res) => {
  const q = z.object({ status: z.enum(['Pending', 'Paid', 'Failed', 'Refunded']).optional(), reservation: z.string().max(30).optional() }).parse(req.query);
  const where = [], vals = [];
  if (q.status) { where.push('p.status = ?'); vals.push(q.status); }
  if (q.reservation) { where.push('r.reference = ?'); vals.push(q.reservation.toUpperCase()); }
  res.json(db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 500`).all(...vals).map(toPayment));
});

const NEXT = { Pending: ['Paid', 'Failed'], Paid: ['Refunded'], Failed: ['Pending'], Refunded: [] };

router.patch('/payments/:id/status', authenticate, adminOnly, (req, res) => {
  expireUnpaidWalkIns();
  const { status } = z.strictObject({ status: z.enum(['Pending', 'Paid', 'Failed', 'Refunded']) }).parse(req.body);
  const p = db.prepare('SELECT * FROM payments WHERE id = ?').get(parseId(req.params.id));
  if (!p) throw new HttpError(404, 'Payment not found');
  if (!NEXT[p.status].includes(status)) throw new HttpError(409, `A ${p.status} payment cannot be changed to ${status}`, { allowed: NEXT[p.status] });
  if (status === 'Paid') {
    const r = db.prepare(`${R.SELECT} WHERE r.id = ?`).get(p.reservation_id);
    if (r.paid + p.amount > r.total_price + 0.005) throw new HttpError(409, 'Marking this paid would exceed the reservation total. Mark the other payment as Failed first');
  }
  db.prepare("UPDATE payments SET status = ?, paid_at = ?, updated_at = datetime('now') WHERE id = ?").run(status, status === 'Paid' ? new Date().toISOString() : p.paid_at, p.id);
  res.json(toPayment(db.prepare(`${SELECT} WHERE p.id = ?`).get(p.id)));
});

module.exports = router;

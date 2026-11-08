const router = require('express').Router();
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { authenticate, adminOnly } = require('../middleware/auth');
const { toUser } = require('../lib/users');
const { HttpError, round2 } = require('../lib/util');
const R = require('../lib/reservations');

const profileImageDirectory = path.join(config.uploadDir, 'admin-profile-images');
fs.mkdirSync(profileImageDirectory, { recursive: true });

router.get('/profile-picture/:filename', (req, res) => {
  if (!/^[a-f0-9]{40}\.(?:jpg|png|webp)$/.test(req.params.filename)) throw new HttpError(404, 'Profile picture not found');
  const user = db.prepare('SELECT profile_image FROM users WHERE profile_image = ?').get(req.params.filename);
  if (!user) throw new HttpError(404, 'Profile picture not found');
  const filePath = path.join(profileImageDirectory, user.profile_image);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Profile picture is unavailable');
  res.set({
    'Content-Type': `image/${path.extname(user.profile_image).slice(1) === 'jpg' ? 'jpeg' : path.extname(user.profile_image).slice(1)}`,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=300',
  });
  res.sendFile(filePath);
});

const one = (sql) => db.prepare(sql).get();

router.use(authenticate, adminOnly);

router.get('/overview', (_req, res) => {
  const collected = one("SELECT COALESCE(SUM(amount),0) AS v FROM payments WHERE status = 'Paid'").v;
  const booked = one("SELECT COALESCE(SUM(total_price),0) AS v FROM reservations WHERE status != 'Cancelled'").v;
  const outstanding = one(`SELECT COALESCE(SUM(MAX(r.total_price - COALESCE((
    SELECT SUM(p.amount) FROM payments p WHERE p.reservation_id = r.id AND p.status = 'Paid'
  ), 0), 0)), 0) AS v FROM reservations r WHERE r.status != 'Cancelled'`).v;
  const userCounts = db.prepare('SELECT role, COUNT(*) AS c, SUM(active) AS active FROM users GROUP BY role').all();
  const users = Object.fromEntries(userCounts.map((row) => [row.role, row.c]));
  users.total = userCounts.reduce((total, row) => total + row.c, 0);
  users.active = userCounts.reduce((total, row) => total + (row.active || 0), 0);
  res.json({
    users,
    reservations: { total: one('SELECT COUNT(*) AS c FROM reservations').c, byStatus: Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS c FROM reservations GROUP BY status').all().map((r) => [r.status, r.c])) },
    revenue: { collected: round2(collected), bookedValue: round2(booked), outstanding: round2(outstanding) },
    services: { rooms: one("SELECT COUNT(*) AS c FROM services WHERE category = 'room'").c },
    documents: one('SELECT COUNT(*) AS c FROM documents').c,
  });
});

router.get('/notifications', (_req, res) => {
  const pendingReservationsCount = one("SELECT COUNT(*) AS c FROM reservations WHERE status = 'Pending'").c;
  const pendingPaymentsCount = one("SELECT COUNT(*) AS c FROM payments WHERE status = 'Pending'").c;
  const pendingMessagesCount = one(`SELECT COUNT(*) AS c FROM conversations c
    WHERE (SELECT m.sender_role FROM conversation_messages m
      WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) = 'guest'`).c;
  const reservations = db.prepare(`${R.SELECT} WHERE r.status = 'Pending' ORDER BY r.check_in ASC, r.id ASC LIMIT 50`)
    .all().map((r) => R.toReservation(r));
  const payments = db.prepare(`SELECT p.id, p.method, p.amount, p.created_at, r.reference, r.guest_name
    FROM payments p JOIN reservations r ON r.id = p.reservation_id
    WHERE p.status = 'Pending' ORDER BY p.created_at DESC, p.id DESC LIMIT 50`).all();
  const messages = db.prepare(`SELECT c.id, c.guest_name, c.subject, m.body AS last_message, m.created_at AS last_message_at
    FROM conversations c
    JOIN conversation_messages m ON m.id = (
      SELECT latest.id FROM conversation_messages latest
      WHERE latest.conversation_id = c.id ORDER BY latest.id DESC LIMIT 1
    )
    WHERE m.sender_role = 'guest'
    ORDER BY m.id DESC LIMIT 50`).all();
  res.json({
    pendingCount: pendingReservationsCount + pendingPaymentsCount + pendingMessagesCount,
    pendingReservationsCount,
    pendingPaymentsCount,
    pendingMessagesCount,
    reservations,
    payments: payments.map((p) => ({
      id: p.id, method: p.method, amount: round2(p.amount), createdAt: p.created_at,
      reservation: p.reference, guestName: p.guest_name,
    })),
    messages: messages.map((m) => ({
      id: m.id, guestName: m.guest_name, subject: m.subject,
      lastMessage: m.last_message, lastMessageAt: m.last_message_at,
    })),
  });
});

router.get('/management', (_req, res) => {
  res.json({
    staff: db.prepare("SELECT * FROM users WHERE role = 'staff' ORDER BY name").all().map(toUser),
    admins: db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY name").all().map(toUser),
    services: db.prepare("SELECT * FROM services WHERE category = 'room' ORDER BY name").all().map((s) => ({ ...s, active: !!s.active })),
    pendingReservations: db.prepare(`${R.SELECT} WHERE r.status = 'Pending' ORDER BY r.check_in ASC, r.id ASC LIMIT 50`).all().map((r) => R.toReservation(r)),
    pendingPayments: db.prepare(`SELECT p.id, p.method, p.amount, p.created_at, r.reference, r.guest_name FROM payments p JOIN reservations r ON r.id = p.reservation_id WHERE p.status = 'Pending' ORDER BY p.id LIMIT 50`).all(),
  });
});

module.exports = router;  

const router = require('express').Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { publicLimiter } = require('../middleware/errors');
const { HttpError, parseId } = require('../lib/util');
const R = require('../lib/reservations');

const MAX_BYTES = 10 * 1024 * 1024, MAX_PER_RESERVATION = 10;
fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

// Trust the file's own bytes, never the name or Content-Type the browser claims.
function sniff(b) {
  if (b.subarray(0, 4).toString('latin1') === '%PDF') return ['application/pdf', '.pdf'];
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', '.jpg'];
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', '.png'];
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return ['image/webp', '.webp'];
  return null;
}
const cleanName = (n) => path.basename(String(n || 'document')).replace(/[^\w .()-]/g, '_').slice(0, 120) || 'document';
const toDoc = (d) => ({ id: d.id, reservationId: d.reservation_id, reservation: d.reference, originalName: d.original_name, mimeType: d.mime_type, size: d.size, uploadedBy: d.uploaded_by, createdAt: d.created_at });
const SELECT = 'SELECT d.*, r.reference, r.user_id AS owner_id FROM documents d JOIN reservations r ON r.id = d.reservation_id';
const allowed = (user, ownerId) => user.role !== 'guest' || ownerId === user.id;

router.post('/', authenticate, publicLimiter, upload.single('document'), (req, res) => {
  const { reservationId } = z.object({ reservationId: z.coerce.number().int().positive() }).parse(req.body);
  if (!req.file) throw new HttpError(400, 'Attach a file in the "document" field');
  const r = db.prepare('SELECT id, user_id FROM reservations WHERE id = ?').get(reservationId);
  if (!r || !R.canAccess(req.user, r)) throw new HttpError(404, 'Reservation not found');
  if (db.prepare('SELECT COUNT(*) AS c FROM documents WHERE reservation_id = ?').get(r.id).c >= MAX_PER_RESERVATION)
    throw new HttpError(409, `A reservation can have at most ${MAX_PER_RESERVATION} documents`);
  const type = sniff(req.file.buffer);
  if (!type) throw new HttpError(400, 'Only PDF, JPEG, PNG and WebP files are accepted');

  const stored = crypto.randomBytes(16).toString('hex') + type[1];
  fs.writeFileSync(path.join(config.uploadDir, stored), req.file.buffer, { flag: 'wx' });
  const id = db.prepare('INSERT INTO documents (reservation_id, uploaded_by, original_name, stored_name, mime_type, size) VALUES (?,?,?,?,?,?)')
    .run(r.id, req.user.id, cleanName(req.file.originalname), stored, type[0], req.file.size).lastInsertRowid;
  res.status(201).json(toDoc(db.prepare(`${SELECT} WHERE d.id = ?`).get(id)));
});

router.get('/', authenticate, (req, res) => {
  const where = [], vals = [];
  if (req.user.role === 'guest') { where.push('r.user_id = ?'); vals.push(req.user.id); }
  if (req.query.reservationId) { where.push('d.reservation_id = ?'); vals.push(parseId(req.query.reservationId)); }
  res.json(db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.id DESC LIMIT 500`).all(...vals).map(toDoc));
});

function findAllowed(req) {
  const d = db.prepare(`${SELECT} WHERE d.id = ?`).get(parseId(req.params.id));
  if (!d || !allowed(req.user, d.owner_id)) throw new HttpError(404, 'Document not found'); // same answer either way
  return d;
}

router.get('/:id/download', authenticate, (req, res) => {
  const d = findAllowed(req);
  res.download(path.join(config.uploadDir, d.stored_name), d.original_name, { headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' } });
});

router.delete('/:id', authenticate, (req, res) => {
  const d = findAllowed(req);
  db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
  fs.rmSync(path.join(config.uploadDir, d.stored_name), { force: true });
  res.status(204).end();
});

module.exports = router;

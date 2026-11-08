const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { authenticate, adminOnly } = require('../middleware/auth');
const { HttpError } = require('../lib/util');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_KEYS = new Set([
  'payment-qr',
  'landing-hero',
  'service-entire-villa',
  'service-private-pool',
  'service-event-space',
  'service-romantic-stay',
  'service-luxury-room',
  'room-regular',
  'room-pool',
  'room-luxury',
  'room-event',
]);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });
const assetDirectory = path.join(config.uploadDir, 'site-assets');
fs.mkdirSync(assetDirectory, { recursive: true });

function sniffImage(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

router.get('/', (_req, res) => {
  const assets = Object.fromEntries(db.prepare('SELECT key, updated_at FROM site_assets').all()
    .map((asset) => [asset.key, { updatedAt: asset.updated_at }]));
  res.json({ assets });
});

router.get('/:key', (req, res) => {
  if (!ALLOWED_KEYS.has(req.params.key)) throw new HttpError(404, 'Image not found');
  const asset = db.prepare('SELECT stored_name, mime_type FROM site_assets WHERE key = ?').get(req.params.key);
  if (!asset) throw new HttpError(404, 'Image not found');
  const filePath = path.join(assetDirectory, asset.stored_name);
  if (!fs.existsSync(filePath)) throw new HttpError(404, 'Image file is unavailable');
  res.set({
    'Content-Type': asset.mime_type,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=300',
  });
  res.sendFile(filePath);
});

router.post('/:key', authenticate, adminOnly, upload.single('asset'), (req, res) => {
  if (!ALLOWED_KEYS.has(req.params.key)) throw new HttpError(404, 'Image slot not found');
  if (!req.file) throw new HttpError(400, 'Choose an image to upload');
  const mimeType = sniffImage(req.file.buffer);
  if (!mimeType) throw new HttpError(400, 'Only JPEG, PNG, and WebP images are accepted');

  const storedName = `${crypto.randomBytes(20).toString('hex')}.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice(6)}`;
  const filePath = path.join(assetDirectory, storedName);
  fs.writeFileSync(filePath, req.file.buffer, { flag: 'wx' });
  let previous;
  let updatedAt;
  try {
    previous = db.prepare('SELECT stored_name FROM site_assets WHERE key = ?').get(req.params.key);
    updatedAt = new Date().toISOString();
    db.prepare(`INSERT INTO site_assets (key, stored_name, mime_type, size, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET stored_name = excluded.stored_name,
        mime_type = excluded.mime_type, size = excluded.size, updated_at = excluded.updated_at`)
      .run(req.params.key, storedName, mimeType, req.file.size, updatedAt);
  } catch (error) {
    fs.rmSync(filePath, { force: true });
    throw error;
  }
  if (previous) fs.rmSync(path.join(assetDirectory, previous.stored_name), { force: true });
  res.status(201).json({ key: req.params.key, updatedAt });
});

router.delete('/:key', authenticate, adminOnly, (req, res) => {
  if (!ALLOWED_KEYS.has(req.params.key)) throw new HttpError(404, 'Image slot not found');
  const asset = db.prepare('SELECT stored_name FROM site_assets WHERE key = ?').get(req.params.key);
  if (!asset) throw new HttpError(404, 'Uploaded image not found');
  db.prepare('DELETE FROM site_assets WHERE key = ?').run(req.params.key);
  fs.rmSync(path.join(assetDirectory, asset.stored_name), { force: true });
  res.status(204).end();
});

module.exports = router;

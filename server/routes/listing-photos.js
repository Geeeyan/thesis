const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const router = require('express').Router();
const multer = require('multer');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { authenticate, optionalAuth, requirePermission } = require('../middleware/auth');
const { HttpError, parseId } = require('../lib/util');
const { audit } = require('../lib/profile-security');

const directory = path.join(config.uploadDir, 'listing-photos');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 3 } });
fs.mkdirSync(directory, { recursive: true });

function detectImage(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function service(req, publicOnly = false) {
  const found = db.prepare('SELECT code, active FROM services WHERE code = ? AND category = ?').get(req.params.code, 'room');
  if (!found || (publicOnly && !found.active)) throw new HttpError(404, 'Listing not found');
  return found;
}

function photoUrl(code, id, size) {
  return `/api/services/${encodeURIComponent(code)}/photos/${id}/image?size=${size}`;
}

function toPhoto(photo) {
  return {
    id: photo.id,
    alt: photo.alt_text,
    sortOrder: photo.sort_order,
    url: photoUrl(photo.listing_id, photo.id, 'large'),
    thumbnailUrl: photoUrl(photo.listing_id, photo.id, 'thumbnail'),
    mediumUrl: photoUrl(photo.listing_id, photo.id, 'medium'),
  };
}

router.get('/:code/photos', optionalAuth, (req, res) => {
  service(req, req.user?.role !== 'admin' && req.user?.role !== 'staff');
  const photos = db.prepare('SELECT * FROM listing_photos WHERE listing_id = ? ORDER BY sort_order, id')
    .all(req.params.code).map(toPhoto);
  res.json({ photos });
});

router.get('/:code/photos/:id/image', optionalAuth, (req, res) => {
  service(req, req.user?.role !== 'admin' && req.user?.role !== 'staff');
  const photo = db.prepare('SELECT * FROM listing_photos WHERE id = ? AND listing_id = ?')
    .get(parseId(req.params.id), req.params.code);
  if (!photo) throw new HttpError(404, 'Listing photo not found');
  const size = z.enum(['thumbnail', 'medium', 'large']).catch('large').parse(req.query.size);
  const storedPath = size === 'thumbnail' ? photo.thumbnail_path : size === 'medium' ? photo.medium_path : photo.path;
  const file = path.join(directory, storedPath);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Listing photo is unavailable');
  const extension = path.extname(storedPath).slice(1);
  res.set({
    'Content-Type': `image/${extension === 'jpg' ? 'jpeg' : extension}`,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'public, max-age=3600',
  });
  res.sendFile(file);
});

router.post('/:code/photos', authenticate, requirePermission('services.update'), upload.fields([
  { name: 'large', maxCount: 1 },
  { name: 'medium', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]), (req, res) => {
  service(req);
  const alt = z.string().trim().max(250).default('').parse(req.body?.alt || '');
  const files = req.files || {};
  const variants = ['large', 'medium', 'thumbnail'].map((key) => files[key]?.[0]);
  if (variants.some((file) => !file)) throw new HttpError(400, 'Upload all three photo sizes');
  const extensions = variants.map((file) => detectImage(file.buffer));
  if (extensions.some((extension) => !extension)) throw new HttpError(400, 'Only valid JPEG, PNG, and WebP photos are accepted');

  const storedNames = variants.map((file, index) => `${crypto.randomBytes(20).toString('hex')}.${extensions[index]}`);
  const filePaths = storedNames.map((name) => path.join(directory, name));
  try {
    variants.forEach((file, index) => fs.writeFileSync(filePaths[index], file.buffer, { flag: 'wx' }));
    const sortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM listing_photos WHERE listing_id = ?')
      .get(req.params.code).next;
    const id = db.transaction(() => {
      const photoId = db.prepare(`INSERT INTO listing_photos
        (listing_id, path, medium_path, thumbnail_path, alt_text, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(req.params.code, storedNames[0], storedNames[1], storedNames[2], alt, sortOrder).lastInsertRowid;
      audit(db, req, req.user.id, 'service_photo_created', { code: req.params.code, photoId, alt });
      return photoId;
    })();
    res.status(201).json({ photo: toPhoto(db.prepare('SELECT * FROM listing_photos WHERE id = ?').get(id)) });
  } catch (error) {
    filePaths.forEach((file) => fs.rmSync(file, { force: true }));
    throw error;
  }
});

router.patch('/:code/photos/:id', authenticate, requirePermission('services.update'), (req, res) => {
  service(req);
  const id = parseId(req.params.id);
  const photo = db.prepare('SELECT * FROM listing_photos WHERE id = ? AND listing_id = ?').get(id, req.params.code);
  if (!photo) throw new HttpError(404, 'Listing photo not found');
  const body = z.strictObject({
    alt: z.string().trim().max(250).optional(),
    sortOrder: z.number().int().min(0).optional(),
  }).refine((value) => Object.keys(value).length > 0).parse(req.body);
  const nextOrder = body.sortOrder ?? photo.sort_order;
  db.transaction(() => {
    if (body.sortOrder !== undefined && body.sortOrder !== photo.sort_order) {
      const direction = body.sortOrder < photo.sort_order ? 1 : -1;
      db.prepare(`UPDATE listing_photos SET sort_order = sort_order + ?
        WHERE listing_id = ? AND sort_order BETWEEN ? AND ?`)
        .run(direction, req.params.code, Math.min(photo.sort_order, body.sortOrder), Math.max(photo.sort_order, body.sortOrder));
    }
    db.prepare('UPDATE listing_photos SET alt_text = ?, sort_order = ? WHERE id = ?')
      .run(body.alt ?? photo.alt_text, nextOrder, id);
    audit(db, req, req.user.id, 'service_photo_updated', {
      code: req.params.code,
      photoId: id,
      changes: {
        alt: { from: photo.alt_text, to: body.alt ?? photo.alt_text },
        sortOrder: { from: photo.sort_order, to: nextOrder },
      },
    });
  })();
  res.json({ photo: toPhoto(db.prepare('SELECT * FROM listing_photos WHERE id = ?').get(id)) });
});

router.delete('/:code/photos/:id', authenticate, requirePermission('services.delete'), (req, res) => {
  service(req);
  const photo = db.prepare('SELECT * FROM listing_photos WHERE id = ? AND listing_id = ?')
    .get(parseId(req.params.id), req.params.code);
  if (!photo) throw new HttpError(404, 'Listing photo not found');
  db.transaction(() => {
    db.prepare('DELETE FROM listing_photos WHERE id = ?').run(photo.id);
    audit(db, req, req.user.id, 'service_photo_deleted', { code: req.params.code, photoId: photo.id });
  })();
  [photo.path, photo.medium_path, photo.thumbnail_path].forEach((name) => fs.rmSync(path.join(directory, name), { force: true }));
  const rows = db.prepare('SELECT id FROM listing_photos WHERE listing_id = ? ORDER BY sort_order, id').all(req.params.code);
  const reorder = db.prepare('UPDATE listing_photos SET sort_order = ? WHERE id = ?');
  db.transaction(() => rows.forEach((row, index) => reorder.run(index, row.id)))();
  res.status(204).end();
});

module.exports = router;

const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { authenticate, optionalAuth, requirePermission } = require('../middleware/auth');
const { HttpError, dateSchema, today, addDays } = require('../lib/util');
const { unitsLeft } = require('../lib/reservations');
const { getArrivalTimeOptions } = require('../lib/arrival-times');
const { permissionsForRole, can } = require('../lib/permissions');
const { audit } = require('../lib/profile-security');

const RETIRED_ROOM_CODES = new Set(['family']);
const toService = (s) => ({ code: s.code, name: s.name, description: s.description, category: s.category, inventoryType: s.inventory_type, coverPhotoId: s.cover_photo_id ?? null, price: s.price, unit: s.unit, pricingMode: s.pricing_mode, durationMinutes: s.duration_minutes, sameDayCheckout: !!s.same_day_checkout, capacity: s.capacity, quantity: s.quantity, active: !!s.active, retired: RETIRED_ROOM_CODES.has(s.code) });
function managementItem(row, date) {
  let availableUnits;
  let slots = [];
  if (row.same_day_checkout) {
    slots = getArrivalTimeOptions(date, row.code);
    availableUnits = slots.some((slot) => slot.available) ? row.quantity : 0;
  } else {
    availableUnits = unitsLeft(row.code, date, addDays(date, 1));
  }
  const availabilityStatus = !row.active
    ? 'Inactive'
    : availableUnits === 0
      ? 'Fully booked'
      : availableUnits < row.quantity || (slots.length > 0 && db.prepare(`SELECT EXISTS(
        SELECT 1 FROM reservations
        WHERE room_code = ? AND check_in = ? AND status IN ('Pending', 'Confirmed', 'Checked-in')
      ) AS booked`).get(row.code, date).booked)
        ? 'Partially booked'
        : 'Available';
  const cover = db.prepare('SELECT id FROM listing_photos WHERE listing_id = ? ORDER BY sort_order, id LIMIT 1')
    .get(row.code);
  return {
    ...toService(row),
    thumbnailPhotoId: cover?.id ?? null,
    availability: {
      status: availabilityStatus,
      availableUnits,
      totalUnits: row.quantity,
      slots,
    },
  };
}
const fields = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
  category: z.literal('room'),
  inventoryType: z.enum(['room', 'service']),
  price: z.number().min(0).max(1e7),
  unit: z.enum(['night', 'stay']),
  pricingMode: z.enum(['night', 'stay', 'guest']),
  durationMinutes: z.number().int().min(0).max(1440),
  sameDayCheckout: z.boolean(),
  capacity: z.number().int().min(1).max(100),
  quantity: z.number().int().min(1).max(1000),
  active: z.boolean(),
};

// Public sees only active services. Admins can add ?includeInactive=true.
router.get('/', optionalAuth, (req, res) => {
  const all = req.user?.role === 'admin' && req.query.includeInactive === 'true';
  const rows = db.prepare(`SELECT services.*,
    (SELECT id FROM listing_photos WHERE listing_id = services.code ORDER BY sort_order, id LIMIT 1) AS cover_photo_id
    FROM services WHERE category = 'room' AND code NOT IN (${[...RETIRED_ROOM_CODES].map(() => '?').join(',')}) ${all ? '' : 'AND active = 1'} ORDER BY name`)
    .all(...RETIRED_ROOM_CODES);
  res.json(rows.map(toService));
});

router.get('/management', authenticate, requirePermission('rooms.view'), (req, res) => {
  const { date, type } = z.strictObject({
    date: dateSchema.default(today()),
    type: z.enum(['room', 'service']).optional(),
  })
    .refine((query) => query.date >= today(), 'Choose today or a future date')
    .parse(req.query);
  const includeInactive = can(req.user.role, 'services.update');
  const rows = db.prepare(`SELECT * FROM services
    WHERE category = 'room'
      ${includeInactive ? '' : 'AND active = 1'}
      ${type ? 'AND inventory_type = ?' : ''}
    ORDER BY name`).all(...(type ? [type] : []));
  const services = rows.map((row) => managementItem(row, date));
  res.json({ date, today: today(), permissions: permissionsForRole(req.user.role), services });
});

router.get('/:code', authenticate, requirePermission('rooms.view'), (req, res) => {
  const { date } = z.strictObject({ date: dateSchema.default(today()) })
    .refine((query) => query.date >= today(), 'Choose today or a future date')
    .parse(req.query);
  const service = db.prepare("SELECT * FROM services WHERE code = ? AND category = 'room'").get(req.params.code);
  if (!service) throw new HttpError(404, 'Room or service not found');
  res.json({ date, service: managementItem(service, date) });
});

router.post('/', authenticate, requirePermission('services.create'), (req, res) => {
  const b = z.strictObject({ code: z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/, 'Use lowercase letters, numbers and dashes'), ...fields, description: fields.description.default(''), inventoryType: fields.inventoryType.default('room'), unit: fields.unit.default('night'), pricingMode: fields.pricingMode.default('night'), durationMinutes: fields.durationMinutes.default(0), sameDayCheckout: fields.sameDayCheckout.default(false), capacity: fields.capacity.default(2), quantity: fields.quantity.default(1) }).omit({ active: true }).parse(req.body);
  if (RETIRED_ROOM_CODES.has(b.code)) throw new HttpError(400, 'That room type is no longer offered');
  if (b.durationMinutes > 0 && !b.sameDayCheckout) throw new HttpError(400, 'Timed services must use same-day booking windows');
  if (b.sameDayCheckout && (!b.durationMinutes || b.durationMinutes >= 1440)) throw new HttpError(400, 'Same-day services require a duration shorter than one day');
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM services WHERE name = ? COLLATE NOCASE').get(b.name)) {
      throw new HttpError(409, 'A room or service with that name already exists');
    }
    if (db.prepare('SELECT 1 FROM services WHERE code = ?').get(b.code)) throw new HttpError(409, 'That code is already in use');
    db.prepare('INSERT INTO services (code, name, description, category, inventory_type, price, unit, pricing_mode, duration_minutes, same_day_checkout, capacity, quantity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(b.code, b.name, b.description, b.category, b.inventoryType, b.price, b.unit, b.pricingMode, b.durationMinutes, b.sameDayCheckout ? 1 : 0, b.capacity, b.quantity);
    audit(db, req, req.user.id, 'service_created', { code: b.code, changes: b });
  }).immediate();
  res.status(201).json(toService(db.prepare('SELECT * FROM services WHERE code = ?').get(b.code)));
});

router.patch('/:code', authenticate, requirePermission('services.update'), (req, res) => {
  const cur = db.prepare('SELECT * FROM services WHERE code = ?').get(req.params.code);
  if (!cur || cur.category !== 'room' || RETIRED_ROOM_CODES.has(cur.code)) throw new HttpError(404, 'Service not found');
  // Category/code are fixed: changing them would silently change old reservations.
  const b = z.strictObject(fields).omit({ category: true }).partial().parse(req.body);
  const durationMinutes = b.durationMinutes ?? cur.duration_minutes;
  const sameDayCheckout = b.sameDayCheckout ?? Boolean(cur.same_day_checkout);
  const timedSettingsChanged = (b.durationMinutes !== undefined && b.durationMinutes !== cur.duration_minutes)
    || (b.sameDayCheckout !== undefined && b.sameDayCheckout !== Boolean(cur.same_day_checkout));
  if (timedSettingsChanged && durationMinutes > 0 && !sameDayCheckout) {
    throw new HttpError(400, 'Timed services must use same-day booking windows');
  }
  if (sameDayCheckout && (!durationMinutes || durationMinutes >= 1440)) throw new HttpError(400, 'Same-day services require a duration shorter than one day');
  const column = (key) => ({ pricingMode: 'pricing_mode', durationMinutes: 'duration_minutes', sameDayCheckout: 'same_day_checkout', inventoryType: 'inventory_type' })[key] || key;
  const sets = Object.keys(b).map((key) => `${column(key)} = ?`);
  if (sets.length) {
    const changes = Object.fromEntries(Object.keys(b).map((key) => [key, {
      from: cur[column(key)],
      to: typeof b[key] === 'boolean' ? Number(b[key]) : b[key],
    }]));
    db.transaction(() => {
      if (b.name && db.prepare('SELECT 1 FROM services WHERE name = ? COLLATE NOCASE AND code <> ?').get(b.name, cur.code)) {
        throw new HttpError(409, 'A room or service with that name already exists');
      }
      db.prepare(`UPDATE services SET ${sets.join(', ')} WHERE code = ?`).run(...Object.values(b).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v)), cur.code);
      audit(db, req, req.user.id, 'service_updated', { code: cur.code, changes });
    }).immediate();
  }
  res.json(toService(db.prepare('SELECT * FROM services WHERE code = ?').get(cur.code)));
});

router.delete('/:code', authenticate, requirePermission('services.delete'), (req, res) => {
  const service = db.prepare("SELECT * FROM services WHERE code = ? AND category = 'room'").get(req.params.code);
  if (!service || RETIRED_ROOM_CODES.has(service.code)) throw new HttpError(404, 'Room or service not found');
  db.transaction(() => {
    const upcoming = db.prepare(`SELECT reference, check_in, check_out FROM reservations
      WHERE room_code = ? AND status IN ('Pending', 'Confirmed', 'Checked-in') AND check_out >= ?
      ORDER BY check_in LIMIT 20`).all(service.code, today());
    if (upcoming.length) {
      throw new HttpError(409, 'Cannot delete this room or service because it has upcoming bookings. Deactivate it instead.', {
        bookings: upcoming,
      });
    }
    db.prepare('UPDATE services SET active = 0 WHERE code = ?').run(service.code);
    audit(db, req, req.user.id, 'service_deleted', {
      code: service.code,
      name: service.name,
      softDeleted: true,
    });
  }).immediate();
  res.status(204).end();
});

module.exports = router;

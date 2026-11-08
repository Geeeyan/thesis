const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

// Placeholder catalogue so a fresh install works. Edit prices/rooms via PATCH /api/services/:code.
const DEFAULT_SERVICES = [
  ['regular', 'Regular Room', 'Comfortable room for up to two guests. Rate is per 3-hour booking.', 'room', 350, 'stay', 2, 6, 'stay'],
  ['luxury', 'Luxury Room', 'Premium room with a king-size bed and en-suite bathroom.', 'room', 1200, 'night', 2, 6, 'night'],
  ['entire-villa', 'Entire Villa', 'Exclusive access to the villa, rooms, pool, and event area.', 'room', 15000, 'night', 30, 1, 'night'],
  ['pool', 'Private Pool', 'Private pool booking, charged per guest.', 'room', 300, 'stay', 30, 1, 'guest'],
  ['event', 'Event Space', '12-hour event venue booking.', 'room', 10000, 'stay', 100, 1, 'stay'],
];

function seedServices() {
  const ins = db.prepare('INSERT OR IGNORE INTO services (code, name, description, category, price, unit, capacity, quantity, pricing_mode) VALUES (?,?,?,?,?,?,?,?,?)');
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS app_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const migration = 'six-regular-and-luxury-rooms';
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(migration)) {
      if (db.prepare('SELECT COUNT(*) AS c FROM services').get().c === 0) {
        DEFAULT_SERVICES.forEach((service) => ins.run(...service));
      } else {
        ins.run(...DEFAULT_SERVICES.find((service) => service[0] === 'luxury'));
      }
      db.prepare("UPDATE services SET quantity = 6 WHERE code IN ('regular', 'luxury') AND category = 'room'").run();
      db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(migration);
    }
    const inventoryMigration = 'villa-pool-event-inventory';
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(inventoryMigration)) {
      for (const code of ['entire-villa', 'pool', 'event']) {
        ins.run(...DEFAULT_SERVICES.find((service) => service[0] === code));
      }
      db.prepare("UPDATE services SET quantity = 1 WHERE code IN ('entire-villa', 'pool', 'event') AND category = 'room'").run();
      db.prepare("UPDATE services SET pricing_mode = 'guest', price = 300, unit = 'stay' WHERE code = 'pool' AND category = 'room'").run();
      db.prepare("UPDATE services SET pricing_mode = 'stay', price = 10000, unit = 'stay' WHERE code = 'event' AND category = 'room'").run();
      db.prepare("UPDATE services SET pricing_mode = 'night', price = 15000, unit = 'night' WHERE code = 'entire-villa' AND category = 'room'").run();
      db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(inventoryMigration);
    }
    const pricingMigration = 'original-regular-room-rate';
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(pricingMigration)) {
      db.prepare(`UPDATE services SET price = 350, unit = 'stay', pricing_mode = 'stay',
        description = 'Comfortable room for up to two guests. Rate is per 3-hour booking.'
        WHERE code = 'regular' AND category = 'room' AND price = 100 AND unit = 'night' AND pricing_mode = 'night'`).run();
      db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(pricingMigration);
    }
    const sameDayCheckoutMigration = 'same-day-event-and-villa-bookings';
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(sameDayCheckoutMigration)) {
      db.prepare(`UPDATE services SET duration_minutes = 720, same_day_checkout = 1
        WHERE code IN ('event', 'entire-villa') AND category = 'room'`).run();
      db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(sameDayCheckoutMigration);
    }
    const inventoryTypeMigration = 'rooms-and-services-inventory-type';
    if (!db.prepare('SELECT 1 FROM app_migrations WHERE name = ?').get(inventoryTypeMigration)) {
      db.prepare(`UPDATE services SET inventory_type = CASE
        WHEN code IN ('pool', 'event') THEN 'service' ELSE 'room' END
        WHERE category = 'room'`).run();
      db.prepare('INSERT INTO app_migrations (name) VALUES (?)').run(inventoryTypeMigration);
    }
    db.prepare("UPDATE services SET active = 0 WHERE category = 'addon'").run();
    db.prepare("DELETE FROM services WHERE category = 'addon' AND code NOT IN (SELECT room_code FROM reservations)").run();
    db.prepare("UPDATE services SET active = 0 WHERE code = 'family' AND category = 'room'").run();
    db.prepare("DELETE FROM services WHERE code = 'family' AND category = 'room' AND code NOT IN (SELECT room_code FROM reservations)").run();
  })();
}

// Created only when the email does not exist yet, so restarting never resets a password.
function seedAccounts() {
  for (const a of config.seedAccounts) {
    if (!a.email || !a.password) continue;
    const email = a.email.trim().toLowerCase();
    if (a.password.length < 8) { console.warn(`Skipping ${a.role} account ${email}: password must be at least 8 characters.`); continue; }
    const existing = db.prepare('SELECT id, login_enabled FROM users WHERE email = ?').get(email);
    if (existing) {
      if (!existing.login_enabled) {
        db.prepare('UPDATE users SET name = ?, password_hash = ?, role = ?, active = 1, login_enabled = 1 WHERE id = ?')
          .run(a.name, bcrypt.hashSync(a.password, 10), a.role, existing.id);
      }
      continue;
    }
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run(a.name, email, bcrypt.hashSync(a.password, 10), a.role);
    console.log(`Created ${a.role} account ${email}`);
  }
}

module.exports = { seedServices, seedAccounts };

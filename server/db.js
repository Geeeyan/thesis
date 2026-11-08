const fs = require('node:fs');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(require('node:path').dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  profile_image TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'guest' CHECK (role IN ('guest', 'staff', 'admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  login_enabled INTEGER NOT NULL DEFAULT 1 CHECK (login_enabled IN (0, 1)),
  auth_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expiry ON password_reset_tokens(expires_at);
CREATE TABLE IF NOT EXISTS password_reset_email_limits (
  email_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  last_requested_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_emails_user ON user_emails(user_id, id);
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at, last_active_at);
CREATE TABLE IF NOT EXISTS login_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_activity_user ON login_activity(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS profile_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_profile_audit_user ON profile_audit_log(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS profile_consents (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('email_notifications', 'marketing')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, consent_type)
);
CREATE TABLE IF NOT EXISTS email_change_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pending_email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_change_user ON email_change_verifications(user_id);
CREATE TABLE IF NOT EXISTS profile_email_verifications (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pending_email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_profile_email_verification_user ON profile_email_verifications(user_id);
CREATE TABLE IF NOT EXISTS two_factor_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL DEFAULT '',
  pending_secret_encrypted TEXT NOT NULL DEFAULT '',
  recovery_code_hashes TEXT NOT NULL DEFAULT '[]',
  enabled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profile_export_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_profile_exports_user ON profile_export_requests(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS account_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('deactivation', 'deletion')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Reviewed', 'Completed', 'Declined')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_account_requests_user ON account_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS services (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('room', 'addon')),
  inventory_type TEXT NOT NULL DEFAULT 'room' CHECK (inventory_type IN ('room', 'service')),
  price REAL NOT NULL CHECK (price >= 0),
  unit TEXT NOT NULL DEFAULT 'night' CHECK (unit IN ('night', 'stay')),
  pricing_mode TEXT NOT NULL DEFAULT 'night' CHECK (pricing_mode IN ('night', 'stay', 'guest')),
  duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  same_day_checkout INTEGER NOT NULL DEFAULT 0 CHECK (same_day_checkout IN (0, 1)),
  capacity INTEGER NOT NULL DEFAULT 2,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  room_code TEXT NOT NULL REFERENCES services(code),
  check_in TEXT NOT NULL,
  preferred_time TEXT,
  check_out TEXT NOT NULL,
  start_datetime TEXT,
  end_datetime TEXT,
  guests INTEGER NOT NULL CHECK (guests >= 1),
  addons TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  total_price REAL NOT NULL CHECK (total_price >= 0),
  booking_type TEXT NOT NULL DEFAULT 'Online' CHECK (booking_type IN ('Online', 'Walk-in')),
  payment_due_at TEXT,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Confirmed', 'Checked-in', 'Completed', 'Cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reservations_room_dates
  ON reservations(room_code, check_in, check_out, status);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
CREATE TABLE IF NOT EXISTS reservation_email_notifications (
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  PRIMARY KEY (reservation_id, notification_type)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  method TEXT NOT NULL CHECK (method IN ('ewallet', 'bank')),
  amount REAL NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Paid', 'Failed', 'Refunded')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  guest_phone TEXT,
  subject TEXT NOT NULL,
  access_hash TEXT NOT NULL,
  guest_last_read_message_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id INTEGER REFERENCES users(id),
  sender_role TEXT NOT NULL CHECK (sender_role IN ('guest', 'staff', 'admin')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread ON conversation_messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS conversation_message_documents (
  message_id INTEGER NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, document_id)
);

CREATE TABLE IF NOT EXISTS reservation_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  request_type TEXT NOT NULL CHECK (request_type IN ('cancellation', 'reschedule')),
  requested_check_in TEXT,
  requested_check_out TEXT,
  requested_preferred_time TEXT,
  reason TEXT,
  guest_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Declined')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (request_type = 'cancellation' AND requested_check_in IS NULL AND requested_check_out IS NULL)
    OR (request_type = 'reschedule' AND requested_check_in IS NOT NULL AND requested_check_out IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS site_assets (
  key TEXT PRIMARY KEY,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size INTEGER NOT NULL CHECK (size > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS listing_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES services(code) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  thumbnail_path TEXT NOT NULL UNIQUE,
  medium_path TEXT NOT NULL UNIQUE,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_listing_photos_order ON listing_photos(listing_id, sort_order, id);
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES services(code) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, listing_id)
);
`);

if (!db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'auth_version')) {
  db.exec('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0');
}
if (!db.prepare("PRAGMA table_info(users)").all().some((column) => column.name === 'login_enabled')) {
  db.exec('ALTER TABLE users ADD COLUMN login_enabled INTEGER NOT NULL DEFAULT 1 CHECK (login_enabled IN (0, 1))');
}
if (!db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'phone')) {
  db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
}
if (!db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'address')) {
  db.exec("ALTER TABLE users ADD COLUMN address TEXT NOT NULL DEFAULT ''");
}
if (!db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'profile_image')) {
  db.exec('ALTER TABLE users ADD COLUMN profile_image TEXT');
}
for (const column of ['nickname', 'gender', 'country', 'language', 'timezone']) {
  if (!db.prepare('PRAGMA table_info(users)').all().some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
  }
}
if (!db.prepare("PRAGMA table_info(services)").all().some((column) => column.name === 'pricing_mode')) {
  db.exec("ALTER TABLE services ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'night' CHECK (pricing_mode IN ('night', 'stay', 'guest'))");
}
if (!db.prepare('PRAGMA table_info(services)').all().some((column) => column.name === 'duration_minutes')) {
  db.exec('ALTER TABLE services ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0)');
}
if (!db.prepare('PRAGMA table_info(services)').all().some((column) => column.name === 'same_day_checkout')) {
  db.exec('ALTER TABLE services ADD COLUMN same_day_checkout INTEGER NOT NULL DEFAULT 0 CHECK (same_day_checkout IN (0, 1))');
}
if (!db.prepare('PRAGMA table_info(services)').all().some((column) => column.name === 'inventory_type')) {
  db.exec("ALTER TABLE services ADD COLUMN inventory_type TEXT NOT NULL DEFAULT 'room' CHECK (inventory_type IN ('room', 'service'))");
  db.prepare("UPDATE services SET inventory_type = 'service' WHERE code IN ('pool', 'event') AND category = 'room'").run();
}
if (!db.prepare('PRAGMA table_info(reservations)').all().some((column) => column.name === 'preferred_time')) {
  db.exec('ALTER TABLE reservations ADD COLUMN preferred_time TEXT');
}
if (!db.prepare('PRAGMA table_info(reservations)').all().some((column) => column.name === 'booking_type')) {
  db.exec("ALTER TABLE reservations ADD COLUMN booking_type TEXT NOT NULL DEFAULT 'Online' CHECK (booking_type IN ('Online', 'Walk-in'))");
}
if (!db.prepare('PRAGMA table_info(reservations)').all().some((column) => column.name === 'payment_due_at')) {
  db.exec('ALTER TABLE reservations ADD COLUMN payment_due_at TEXT');
}
for (const column of ['start_datetime', 'end_datetime']) {
  if (!db.prepare('PRAGMA table_info(reservations)').all().some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE reservations ADD COLUMN ${column} TEXT`);
  }
}
const { dateTimeInTimezone } = require('./lib/util');
const legacyDateTimes = db.prepare(`SELECT id, check_in, check_out FROM reservations
  WHERE start_datetime IS NULL OR end_datetime IS NULL`).all();
const backfillDateTimes = db.prepare(`UPDATE reservations SET start_datetime = ?, end_datetime = ?
  WHERE id = ?`);
for (const reservation of legacyDateTimes) {
  backfillDateTimes.run(
    dateTimeInTimezone(reservation.check_in, '00:00'),
    dateTimeInTimezone(reservation.check_out, '00:00'),
    reservation.id,
  );
}
if (!db.prepare('PRAGMA table_info(reservation_change_requests)').all().some((column) => column.name === 'requested_preferred_time')) {
  db.exec('ALTER TABLE reservation_change_requests ADD COLUMN requested_preferred_time TEXT');
}
if (!db.prepare('PRAGMA table_info(conversations)').all().some((column) => column.name === 'guest_last_read_message_id')) {
  db.exec('ALTER TABLE conversations ADD COLUMN guest_last_read_message_id INTEGER NOT NULL DEFAULT 0');
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_reservations_walkin_payment_due
  ON reservations(booking_type, payment_due_at, status)`);

// Preserve change requests created before they had structured review records.
const legacyRequests = db.prepare(`SELECT c.id AS conversation_id, c.subject, m.body
  FROM conversations c
  JOIN conversation_messages m ON m.id = (
    SELECT first_message.id FROM conversation_messages first_message
    WHERE first_message.conversation_id = c.id ORDER BY first_message.id LIMIT 1
  )
  WHERE c.subject LIKE '% request: %' AND m.sender_role = 'guest'
    AND NOT EXISTS (
      SELECT 1 FROM reservation_change_requests cr WHERE cr.conversation_id = c.id
    )`).all();
const insertLegacyRequest = db.prepare(`INSERT OR IGNORE INTO reservation_change_requests
  (conversation_id, reservation_id, request_type, requested_check_in, requested_check_out, reason, guest_note)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
for (const legacy of legacyRequests) {
  const subject = /^(Cancellation|Reschedule) request: (VT-[A-Z0-9]+)$/i.exec(legacy.subject);
  const reference = /^Booking reference: (VT-[A-Z0-9]+)/m.exec(legacy.body);
  if (!subject || !reference) continue;
  const reservation = db.prepare('SELECT id FROM reservations WHERE reference = ?').get(reference[1]);
  if (!reservation) continue;
  const requestType = subject[1].toLowerCase();
  const checkIn = /^Requested check-in: (\d{4}-\d{2}-\d{2})$/m.exec(legacy.body)?.[1] ?? null;
  const checkOut = /^Requested check-out: (\d{4}-\d{2}-\d{2})$/m.exec(legacy.body)?.[1] ?? null;
  if (requestType === 'reschedule' && (!checkIn || !checkOut)) continue;
  const reason = /^Reason: (.+)$/m.exec(legacy.body)?.[1] ?? null;
  const note = /^Additional notes: ([\s\S]*)$/m.exec(legacy.body)?.[1] ?? '';
  insertLegacyRequest.run(legacy.conversation_id, reservation.id, requestType, checkIn, checkOut, reason, note);
}

module.exports = db;

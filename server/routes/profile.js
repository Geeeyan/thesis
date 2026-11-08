const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { z } = require('zod');
const db = require('../db');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { profileSensitiveLimiter, twoFactorLimiter } = require('../middleware/errors');
const { HttpError, emailSchema, passwordSchema } = require('../lib/util');
const { toUser } = require('../lib/users');
const mailer = require('../lib/mailer');
const {
  hashToken, encrypt, decrypt, createTotpSecret, verifyTotp, createRecoveryCodes,
  verifyRecoveryCode, requestIp, userAgent, audit,
} = require('../lib/profile-security');
const R = require('../lib/reservations');

const profileImageDirectory = path.join(config.uploadDir, 'admin-profile-images');
const exportDirectory = path.join(config.uploadDir, 'profile-exports');
fs.mkdirSync(profileImageDirectory, { recursive: true });
fs.mkdirSync(exportDirectory, { recursive: true });
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const passwordBody = z.strictObject({ currentPassword: z.string().min(1).max(200) });

function currentUser(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new HttpError(401, 'Please log in again');
  return user;
}

function verifyPassword(user, password) {
  if (!bcrypt.compareSync(password, user.password_hash)) throw new HttpError(401, 'Your current password is incorrect');
}

function imageType(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function profileEmails(user) {
  return [
    { email: user.email, addedAt: user.created_at, primary: true },
    ...db.prepare('SELECT email, added_at AS addedAt FROM user_emails WHERE user_id = ? ORDER BY id')
      .all(user.id)
      .map((item) => ({ ...item, primary: false })),
  ];
}

function confirmEmailChange(req, res) {
  const { token } = z.strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/i) }).parse(req.body);
  const pending = db.prepare('SELECT * FROM email_change_verifications WHERE token_hash = ?')
    .get(hashToken(token));
  const pendingSecondary = pending ? null : db.prepare('SELECT * FROM profile_email_verifications WHERE token_hash = ?')
    .get(hashToken(token));
  const verification = pending || pendingSecondary;
  if (!verification || verification.expires_at <= Date.now()) {
    if (verification) {
      const table = pending ? 'email_change_verifications' : 'profile_email_verifications';
      db.prepare(`DELETE FROM ${table} WHERE token_hash = ?`).run(verification.token_hash);
    }
    throw new HttpError(400, 'This email confirmation link is invalid or expired. Request a new one.');
  }
  try {
    db.transaction(() => {
      if (pending) {
        db.prepare('UPDATE users SET email = ? WHERE id = ?').run(pending.pending_email, pending.user_id);
        db.prepare('DELETE FROM email_change_verifications WHERE user_id = ?').run(pending.user_id);
        audit(db, req, pending.user_id, 'email_changed', { email: pending.pending_email });
      } else {
        db.prepare('INSERT INTO user_emails (user_id, email) VALUES (?, ?)')
          .run(pendingSecondary.user_id, pendingSecondary.pending_email);
        db.prepare('DELETE FROM profile_email_verifications WHERE token_hash = ?').run(pendingSecondary.token_hash);
        audit(db, req, pendingSecondary.user_id, 'secondary_email_added', { email: pendingSecondary.pending_email });
      }
    })();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That email address is already associated with an account');
    throw error;
  }
  res.json({ message: pending ? 'Your email address has been updated.' : 'Your additional email address has been verified and added.' });
}

router.post('/email-verification/confirm', profileSensitiveLimiter, confirmEmailChange);
router.use(authenticate);

router.get('/', (req, res) => {
  const user = currentUser(req.user.id);
  const settings = db.prepare('SELECT * FROM two_factor_settings WHERE user_id = ?').get(user.id);
  const consents = db.prepare('SELECT consent_type, enabled, updated_at FROM profile_consents WHERE user_id = ?')
    .all(user.id);
  const consentMap = Object.fromEntries(consents.map((item) => [item.consent_type, {
    enabled: Boolean(item.enabled), updatedAt: item.updated_at,
  }]));
  res.json({
    user: toUser(user),
    emails: profileEmails(user),
    twoFactorEnabled: Boolean(settings?.enabled_at),
    consents: {
      email_notifications: consentMap.email_notifications || { enabled: false, updatedAt: null },
      marketing: consentMap.marketing || { enabled: false, updatedAt: null },
    },
    policyAcceptance: null,
  });
});

router.get('/favorites', (req, res) => {
  const favorites = db.prepare(`SELECT listing_id AS listingId FROM user_favorites
    WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.id).map((item) => item.listingId);
  res.json({ favorites });
});

router.put('/favorites/:code', (req, res) => {
  const code = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/).parse(req.params.code);
  const listing = db.prepare("SELECT code FROM services WHERE code = ? AND category = 'room' AND active = 1").get(code);
  if (!listing) throw new HttpError(404, 'Listing not found');
  db.prepare('INSERT OR IGNORE INTO user_favorites (user_id, listing_id) VALUES (?, ?)').run(req.user.id, code);
  res.json({ saved: true });
});

router.delete('/favorites/:code', (req, res) => {
  const code = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/).parse(req.params.code);
  db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND listing_id = ?').run(req.user.id, code);
  res.status(204).end();
});

router.put('/', (req, res) => {
  const body = z.strictObject({
    name: z.string().trim().min(1).max(100),
    nickname: z.string().trim().max(100).default(''),
    phone: z.string().trim().max(30).regex(/^[+()\d\s.-]*$/, 'Enter a valid phone number').default(''),
    address: z.string().trim().max(500).default(''),
  }).parse(req.body);
  const user = currentUser(req.user.id);
  const changes = Object.keys(body).filter((key) => (user[key] || '') !== body[key]);
  if (!changes.length) throw new HttpError(400, 'Make a change before saving your profile');
  db.prepare(`UPDATE users SET name = ?, nickname = ?, phone = ?, address = ?
    WHERE id = ?`).run(body.name, body.nickname, body.phone, body.address, user.id);
  audit(db, req, user.id, 'profile_updated', { fields: changes });
  res.json({ user: toUser(currentUser(user.id)) });
});

router.post('/email-verification', profileSensitiveLimiter, async (req, res) => {
  const body = z.strictObject({ email: emailSchema, currentPassword: z.string().min(1).max(200) }).parse(req.body);
  const user = currentUser(req.user.id);
  verifyPassword(user, body.currentPassword);
  db.prepare('DELETE FROM email_change_verifications WHERE expires_at <= ?').run(Date.now());
  db.prepare('DELETE FROM profile_email_verifications WHERE expires_at <= ?').run(Date.now());
  if (body.email === user.email) throw new HttpError(400, 'That is already your primary email address');
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?
    UNION SELECT user_id AS id FROM user_emails WHERE email = ?
    UNION SELECT user_id AS id FROM email_change_verifications WHERE pending_email = ? AND user_id != ?
    UNION SELECT user_id AS id FROM profile_email_verifications WHERE pending_email = ?`)
    .get(body.email, body.email, body.email, user.id, body.email);
  if (existing) throw new HttpError(409, 'That email address is already associated with an account');
  if (!mailer.isConfigured()) throw new HttpError(503, 'Email delivery is not configured. Contact the site administrator.');

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + 30 * 60 * 1000;
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM email_change_verifications WHERE user_id = ?').run(user.id);
      db.prepare(`INSERT INTO email_change_verifications (token_hash, user_id, pending_email, expires_at)
        VALUES (?, ?, ?, ?)`).run(tokenHash, user.id, body.email, expiresAt);
    })();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That email address already has a pending verification');
    throw error;
  }
  const verifyUrl = `${config.origins[0]}/verify-profile-email?token=${encodeURIComponent(token)}`;
  try {
    await mailer.sendEmail({
      to: body.email,
      subject: 'Confirm your Villa Tjeozabel email address',
      text: `To confirm this email address for your account, open this link within 30 minutes:\n${verifyUrl}\nIf you did not request this change, you can ignore this message.`,
      html: `<p>Confirm this email address for your Villa Tjeozabel account within 30 minutes:</p><p><a href="${verifyUrl}">Confirm email address</a></p><p>If you did not request this change, you can ignore this message.</p>`,
    });
  } catch (error) {
    db.prepare('DELETE FROM email_change_verifications WHERE token_hash = ?').run(tokenHash);
    console.error('Could not send profile email verification:', error.message);
    throw new HttpError(503, 'Could not send the verification email. Please try again later.');
  }
  audit(db, req, user.id, 'email_change_verification_requested', { pendingEmail: body.email });
  res.json({ message: 'A confirmation link has been sent to the new email address.' });
});

router.post('/secondary-emails', profileSensitiveLimiter, async (req, res) => {
  const body = z.strictObject({ email: emailSchema, currentPassword: z.string().min(1).max(200) }).parse(req.body);
  const user = currentUser(req.user.id);
  verifyPassword(user, body.currentPassword);
  db.prepare('DELETE FROM email_change_verifications WHERE expires_at <= ?').run(Date.now());
  db.prepare('DELETE FROM profile_email_verifications WHERE expires_at <= ?').run(Date.now());
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?
    UNION SELECT user_id AS id FROM user_emails WHERE email = ?
    UNION SELECT user_id AS id FROM email_change_verifications WHERE pending_email = ?
    UNION SELECT user_id AS id FROM profile_email_verifications WHERE pending_email = ?`)
    .get(body.email, body.email, body.email, body.email);
  if (existing) throw new HttpError(409, 'That email address is already associated with an account or pending verification');
  if (!mailer.isConfigured()) throw new HttpError(503, 'Email delivery is not configured. Contact the site administrator.');
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  try {
    db.prepare(`INSERT INTO profile_email_verifications (token_hash, user_id, pending_email, expires_at)
      VALUES (?, ?, ?, ?)`).run(tokenHash, user.id, body.email, Date.now() + 30 * 60 * 1000);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'That email address already has a pending verification');
    throw error;
  }
  const verifyUrl = `${config.origins[0]}/verify-profile-email?token=${encodeURIComponent(token)}`;
  try {
    await mailer.sendEmail({
      to: body.email,
      subject: 'Confirm your Villa Tjeozabel email address',
      text: `To add this email address to your account, open this link within 30 minutes:\n${verifyUrl}\nIf you did not request this change, you can ignore this message.`,
      html: `<p>Confirm this email address for your Villa Tjeozabel account within 30 minutes:</p><p><a href="${verifyUrl}">Confirm email address</a></p><p>If you did not request this change, you can ignore this message.</p>`,
    });
  } catch (error) {
    db.prepare('DELETE FROM profile_email_verifications WHERE token_hash = ?').run(tokenHash);
    console.error('Could not send additional profile email verification:', error.message);
    throw new HttpError(503, 'Could not send the verification email. Please try again later.');
  }
  audit(db, req, user.id, 'secondary_email_verification_requested', { pendingEmail: body.email });
  res.json({ message: 'A confirmation link has been sent to that email address.' });
});

router.post('/avatar', profileSensitiveLimiter, avatarUpload.single('profilePicture'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a JPEG, PNG, or WebP image');
  const extension = imageType(req.file.buffer);
  if (!extension) throw new HttpError(400, 'Only JPEG, PNG, and WebP images are accepted');
  const user = currentUser(req.user.id);
  verifyPassword(user, z.string().min(1).max(200).parse(req.body.currentPassword));
  const storedName = `${crypto.randomBytes(20).toString('hex')}.${extension}`;
  fs.writeFileSync(path.join(profileImageDirectory, storedName), req.file.buffer, { flag: 'wx' });
  try {
    db.prepare('UPDATE users SET profile_image = ? WHERE id = ?').run(storedName, user.id);
  } catch (error) {
    fs.rmSync(path.join(profileImageDirectory, storedName), { force: true });
    throw error;
  }
  if (user.profile_image) fs.rmSync(path.join(profileImageDirectory, user.profile_image), { force: true });
  audit(db, req, user.id, 'avatar_changed');
  res.json({ user: toUser(currentUser(user.id)) });
});

router.delete('/avatar', profileSensitiveLimiter, (req, res) => {
  const user = currentUser(req.user.id);
  verifyPassword(user, passwordBody.parse(req.body).currentPassword);
  if (!user.profile_image) return res.json({ user: toUser(user) });
  db.prepare('UPDATE users SET profile_image = NULL WHERE id = ?').run(user.id);
  fs.rmSync(path.join(profileImageDirectory, user.profile_image), { force: true });
  audit(db, req, user.id, 'avatar_removed');
  res.json({ user: toUser(currentUser(user.id)) });
});

router.put('/password', profileSensitiveLimiter, (req, res) => {
  const body = z.strictObject({
    currentPassword: z.string().min(1).max(200),
    password: passwordSchema,
  }).parse(req.body);
  const user = currentUser(req.user.id);
  verifyPassword(user, body.currentPassword);
  if (bcrypt.compareSync(body.password, user.password_hash)) {
    throw new HttpError(400, 'Choose a password you have not used before');
  }
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(body.password, 10), user.id);
    db.prepare(`UPDATE user_sessions SET revoked_at = datetime('now')
      WHERE user_id = ? AND id != ? AND revoked_at IS NULL`).run(user.id, req.user.sessionId || '');
    audit(db, req, user.id, 'password_changed');
  })();
  mailer.sendEmailInBackground(user.email, 'password_changed');
  res.json({ message: 'Your password has been updated. Other sessions have been logged out.' });
});

router.post('/two-factor/setup', profileSensitiveLimiter, (req, res) => {
  const { currentPassword } = passwordBody.parse(req.body);
  const user = currentUser(req.user.id);
  verifyPassword(user, currentPassword);
  const secret = createTotpSecret();
  db.prepare(`INSERT INTO two_factor_settings (user_id, pending_secret_encrypted)
    VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET pending_secret_encrypted = excluded.pending_secret_encrypted`)
    .run(user.id, encrypt(secret));
  audit(db, req, user.id, 'two_factor_setup_started');
  res.json({
    secret,
    otpauthUrl: `otpauth://totp/${encodeURIComponent(`Villa Tjeozabel:${user.email}`)}?secret=${secret}&issuer=Villa%20Tjeozabel&algorithm=SHA1&digits=6&period=30`,
  });
});

router.post('/two-factor/enable', twoFactorLimiter, (req, res) => {
  const { code } = z.strictObject({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const user = currentUser(req.user.id);
  const settings = db.prepare('SELECT * FROM two_factor_settings WHERE user_id = ?').get(user.id);
  if (!settings?.pending_secret_encrypted) throw new HttpError(409, 'Start two-factor setup before enabling it');
  if (!verifyTotp(decrypt(settings.pending_secret_encrypted), code)) throw new HttpError(400, 'The authenticator code is incorrect');
  const recovery = createRecoveryCodes(user.id);
  db.prepare(`UPDATE two_factor_settings SET secret_encrypted = ?, pending_secret_encrypted = '',
    recovery_code_hashes = ?, enabled_at = datetime('now'), updated_at = datetime('now') WHERE user_id = ?`)
    .run(settings.pending_secret_encrypted, recovery.hashes, user.id);
  audit(db, req, user.id, 'two_factor_enabled');
  res.json({ enabled: true, recoveryCodes: recovery.codes });
});

router.delete('/two-factor', twoFactorLimiter, (req, res) => {
  const body = z.strictObject({ currentPassword: z.string().min(1).max(200), code: z.string().min(1).max(32) }).parse(req.body);
  const user = currentUser(req.user.id);
  verifyPassword(user, body.currentPassword);
  const settings = db.prepare('SELECT * FROM two_factor_settings WHERE user_id = ? AND enabled_at IS NOT NULL').get(user.id);
  if (!settings) throw new HttpError(409, 'Two-factor authentication is not enabled');
  let valid = verifyTotp(decrypt(settings.secret_encrypted), body.code);
  let recoveryHashes = settings.recovery_code_hashes;
  if (!valid) {
    const recovery = verifyRecoveryCode(user.id, body.code, recoveryHashes);
    valid = recovery.valid;
    recoveryHashes = JSON.stringify(recovery.hashes);
  }
  if (!valid) throw new HttpError(401, 'The authenticator or recovery code is incorrect');
  db.prepare('DELETE FROM two_factor_settings WHERE user_id = ?').run(user.id);
  audit(db, req, user.id, 'two_factor_disabled');
  res.json({ enabled: false });
});

router.get('/sessions', (req, res) => {
  const sessions = db.prepare(`SELECT id, user_agent AS userAgent, ip_address AS ipAddress,
    created_at AS createdAt, last_active_at AS lastActiveAt, expires_at AS expiresAt
    FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
    ORDER BY last_active_at DESC`).all(req.user.id);
  res.json({ sessions: sessions.map((session) => ({ ...session, current: session.id === req.user.sessionId })) });
});

router.delete('/sessions/:id', profileSensitiveLimiter, (req, res) => {
  const { currentPassword } = passwordBody.parse(req.body);
  verifyPassword(currentUser(req.user.id), currentPassword);
  const result = db.prepare(`UPDATE user_sessions SET revoked_at = datetime('now')
    WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(req.params.id, req.user.id);
  if (!result.changes) throw new HttpError(404, 'Session not found');
  audit(db, req, req.user.id, 'session_logged_out', { sessionId: req.params.id });
  res.json({ current: req.params.id === req.user.sessionId });
});

router.post('/sessions/logout-others', profileSensitiveLimiter, (req, res) => {
  const { currentPassword } = passwordBody.parse(req.body);
  verifyPassword(currentUser(req.user.id), currentPassword);
  const result = db.prepare(`UPDATE user_sessions SET revoked_at = datetime('now')
    WHERE user_id = ? AND id != ? AND revoked_at IS NULL`).run(req.user.id, req.user.sessionId || '');
  audit(db, req, req.user.id, 'other_sessions_logged_out', { count: result.changes });
  res.json({ count: result.changes });
});

router.get('/login-activity', (req, res) => {
  const activity = db.prepare(`SELECT email, ip_address AS ipAddress, user_agent AS userAgent,
    success, created_at AS createdAt FROM login_activity WHERE user_id = ?
    ORDER BY id DESC LIMIT 50`).all(req.user.id);
  res.json({ activity: activity.map((item) => ({ ...item, success: Boolean(item.success) })) });
});

router.put('/consents', (req, res) => {
  const body = z.strictObject({
    email_notifications: z.boolean(),
    marketing: z.boolean(),
  }).parse(req.body);
  const user = currentUser(req.user.id);
  const update = db.prepare(`INSERT INTO profile_consents (user_id, consent_type, enabled, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, consent_type) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`);
  db.transaction(() => {
    for (const [type, enabled] of Object.entries(body)) {
      const current = db.prepare('SELECT enabled FROM profile_consents WHERE user_id = ? AND consent_type = ?').get(user.id, type);
      if (!current || Boolean(current.enabled) !== enabled) {
        update.run(user.id, type, enabled ? 1 : 0);
        audit(db, req, user.id, 'consent_updated', { type, enabled });
      }
    }
  })();
  res.json({ consents: Object.fromEntries(db.prepare('SELECT consent_type, enabled, updated_at FROM profile_consents WHERE user_id = ?')
    .all(user.id).map((item) => [item.consent_type, { enabled: Boolean(item.enabled), updatedAt: item.updated_at }])) });
});

router.post('/data-exports', profileSensitiveLimiter, (req, res) => {
  const { currentPassword } = passwordBody.parse(req.body);
  const user = currentUser(req.user.id);
  verifyPassword(user, currentPassword);
  const reservationRows = db.prepare(`${R.SELECT} WHERE r.user_id = ? ORDER BY r.created_at DESC`).all(user.id).map(R.toReservation);
  const conversations = db.prepare(`SELECT id, subject, created_at AS createdAt, updated_at AS updatedAt
    FROM conversations WHERE user_id = ? ORDER BY id`).all(user.id).map((conversation) => ({
    ...conversation,
    messages: db.prepare(`SELECT sender_role AS senderRole, body, created_at AS createdAt
      FROM conversation_messages WHERE conversation_id = ? ORDER BY id`).all(conversation.id),
  }));
  const exportData = {
    exportedAt: new Date().toISOString(),
    profile: toUser(user),
    additionalEmails: profileEmails(user).filter((item) => !item.primary),
    reservations: reservationRows,
    conversations,
    consents: db.prepare('SELECT consent_type, enabled, updated_at FROM profile_consents WHERE user_id = ?').all(user.id),
    loginActivity: db.prepare(`SELECT email, ip_address AS ipAddress, user_agent AS userAgent, success, created_at AS createdAt
      FROM login_activity WHERE user_id = ? ORDER BY id DESC`).all(user.id),
    profileActivity: db.prepare(`SELECT action, details, ip_address AS ipAddress, created_at AS createdAt
      FROM profile_audit_log WHERE user_id = ? ORDER BY id DESC`).all(user.id),
  };
  const storedName = `${crypto.randomBytes(24).toString('hex')}.json`;
  fs.writeFileSync(path.join(exportDirectory, storedName), JSON.stringify(exportData, null, 2), { flag: 'wx' });
  const requestId = db.prepare('INSERT INTO profile_export_requests (user_id, stored_name) VALUES (?, ?)')
    .run(user.id, storedName).lastInsertRowid;
  audit(db, req, user.id, 'data_export_requested', { requestId });
  res.status(201).json({ requestId, message: 'Your data export is ready to download.' });
});

router.get('/data-exports/:id/download', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Invalid export id');
  const exportRequest = db.prepare('SELECT * FROM profile_export_requests WHERE id = ? AND user_id = ?')
    .get(id, req.user.id);
  if (!exportRequest) throw new HttpError(404, 'Data export not found');
  const file = path.join(exportDirectory, exportRequest.stored_name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Data export is no longer available');
  res.download(file, 'villa-tjeozabel-personal-data.json');
});

router.post('/account-requests', profileSensitiveLimiter, (req, res) => {
  const body = z.strictObject({
    type: z.enum(['deactivation', 'deletion']),
    currentPassword: z.string().min(1).max(200),
  }).parse(req.body);
  const user = currentUser(req.user.id);
  verifyPassword(user, body.currentPassword);
  const existing = db.prepare(`SELECT id FROM account_requests
    WHERE user_id = ? AND status = 'Pending'`).get(user.id);
  if (existing) throw new HttpError(409, 'You already have a pending account request');
  const requestId = db.prepare('INSERT INTO account_requests (user_id, request_type) VALUES (?, ?)')
    .run(user.id, body.type).lastInsertRowid;
  audit(db, req, user.id, 'account_request_created', { type: body.type, requestId });
  res.status(201).json({ request: { id: requestId, type: body.type, status: 'Pending' } });
});

router.get('/account-requests', (req, res) => {
  res.json({ requests: db.prepare(`SELECT id, request_type AS type, status, created_at AS createdAt
    FROM account_requests WHERE user_id = ? ORDER BY id DESC`).all(req.user.id) });
});

router.get('/audit-log', (req, res) => {
  const entries = db.prepare(`SELECT action, details, ip_address AS ipAddress, created_at AS createdAt
    FROM profile_audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 100`).all(req.user.id);
  res.json({ entries: entries.map((entry) => ({ ...entry, details: JSON.parse(entry.details) })) });
});

module.exports = router;

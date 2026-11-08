const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { z } = require('zod');
const db = require('../db');
const { sign, signChallenge, authenticate } = require('../middleware/auth');
const { authLimiter, passwordResetRequestLimiter, passwordResetCodeLimiter, twoFactorLimiter } = require('../middleware/errors');
const { HttpError, emailSchema, passwordSchema } = require('../lib/util');
const { createUser, toUser } = require('../lib/users');
const mailer = require('../lib/mailer');
const config = require('../config');
const { decrypt, verifyTotp, verifyRecoveryCode, audit, requestIp, userAgent } = require('../lib/profile-security');

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps login timing the same for unknown emails
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const RESET_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_RESET_REQUESTS_PER_EMAIL = 5;
const MAX_RESET_ATTEMPTS = 5;
const RESET_RESPONSE_MIN_MS = 100;
const RESET_REQUEST_MESSAGE = 'If this email is registered, a code has been sent.';

function resetCodeHash(userId, code) {
  return crypto.createHmac('sha256', config.jwtSecret).update(`${userId}:${code}`).digest();
}

function resetTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function resetEmailHash(email) {
  return crypto.createHmac('sha256', config.jwtSecret).update(email).digest('hex');
}

const recordResetRequest = db.transaction((emailHash, now) => {
  const existing = db.prepare('SELECT * FROM password_reset_email_limits WHERE email_hash = ?').get(emailHash);
  if (existing && now - existing.last_requested_at < RESET_RESEND_COOLDOWN_MS) {
    throw new HttpError(429, 'Please wait 60 seconds before requesting another code.');
  }
  const withinWindow = existing && now - existing.window_started_at < RESET_REQUEST_WINDOW_MS;
  const requestCount = withinWindow ? existing.request_count : 0;
  if (requestCount >= MAX_RESET_REQUESTS_PER_EMAIL) {
    throw new HttpError(429, 'Too many password reset requests. Please try again in an hour.');
  }
  db.prepare(`INSERT INTO password_reset_email_limits
    (email_hash, window_started_at, request_count, last_requested_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(email_hash) DO UPDATE SET
      window_started_at = excluded.window_started_at,
      request_count = ?,
      last_requested_at = excluded.last_requested_at`)
    .run(emailHash, withinWindow ? existing.window_started_at : now, now, requestCount + 1);
});

function sendResetEmailInBackground(email, code, userId, codeHash, req) {
  setImmediate(async () => {
    try {
      await mailer.sendPasswordResetCode(email, code);
    } catch (error) {
      db.prepare('DELETE FROM password_reset_codes WHERE user_id = ? AND code_hash = ?').run(userId, codeHash);
      audit(db, req, userId, 'password_reset_email_failed');
      console.error('Password reset email delivery failed:', error.code || error.name || 'unknown error');
    }
  });
}

function sendPasswordChangedEmailInBackground(email) {
  setImmediate(async () => {
    try {
      await mailer.sendPasswordChangedConfirmation(email);
    } catch (error) {
      console.error('Password change confirmation email delivery failed:', error.code || error.name || 'unknown error');
    }
  });
}

function issueResetCode(email, user, now, req, action = 'password_reset_code_requested') {
  if (!user) return;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = resetCodeHash(user.id, code).toString('hex');
  db.prepare(`INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts, created_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`)
    .run(user.id, codeHash, now + RESET_CODE_TTL_MS, now);
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
  audit(db, req, user.id, action);
  sendResetEmailInBackground(email, code, user.id, codeHash, req);
}

async function handleResetCodeRequest(email, req, res, action) {
  const startedAt = Date.now();
  if (!mailer.isConfigured()) {
    throw new HttpError(503, 'Email delivery is not configured. Set MAIL_HOST, MAIL_FROM_ADDRESS, MAIL_USERNAME, and MAIL_PASSWORD in the project .env file. For Gmail, use smtp.gmail.com and a Google App Password. Then restart the backend.');
  }
  const now = Date.now();
  recordResetRequest(resetEmailHash(email), now);
  const user = db.prepare('SELECT id FROM users WHERE email = ? AND login_enabled = 1 AND active = 1').get(email);
  issueResetCode(email, user, now, req, action);
  const remainingDelay = RESET_RESPONSE_MIN_MS - (Date.now() - startedAt);
  if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  res.json({ message: RESET_REQUEST_MESSAGE });
}

router.post('/register', authLimiter, (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(100), email: emailSchema, password: passwordSchema }).parse(req.body);
  const user = createUser({ ...b, role: 'guest' }); // public sign-up can only ever create guests
  res.status(201).json({ token: sign(user, req), user });
});

router.post('/login', authLimiter, (req, res) => {
  const b = z.object({ email: emailSchema, password: z.string().min(1).max(200) }).parse(req.body);
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(b.email);
  const ok = bcrypt.compareSync(b.password, row?.login_enabled ? row.password_hash : DUMMY_HASH);
  if (!row || !row.login_enabled || !ok || !row.active) {
    db.prepare(`INSERT INTO login_activity (user_id, email, ip_address, user_agent, success)
      VALUES (?, ?, ?, ?, 0)`).run(row?.id ?? null, b.email, requestIp(req), userAgent(req));
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  const twoFactor = db.prepare('SELECT enabled_at FROM two_factor_settings WHERE user_id = ?').get(row.id);
  if (twoFactor?.enabled_at) {
    db.prepare(`INSERT INTO login_activity (user_id, email, ip_address, user_agent, success)
      VALUES (?, ?, ?, ?, 0)`).run(row.id, b.email, requestIp(req), userAgent(req));
    return res.json({ mfaRequired: true, challengeToken: signChallenge(row) });
  }
  db.prepare(`INSERT INTO login_activity (user_id, email, ip_address, user_agent, success)
    VALUES (?, ?, ?, ?, 1)`).run(row.id, b.email, requestIp(req), userAgent(req));
  res.json({ token: sign(row, req), user: toUser(row) });
});

router.post('/verify-two-factor', twoFactorLimiter, (req, res) => {
  const body = z.strictObject({
    challengeToken: z.string().min(1).max(2000),
    code: z.string().trim().min(1).max(32),
  }).parse(req.body);
  let challenge;
  try {
    challenge = require('jsonwebtoken').verify(body.challengeToken, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Your verification session expired. Please sign in again.');
  }
  if (challenge.scope !== 'two-factor') throw new HttpError(401, 'Invalid verification session');
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1 AND login_enabled = 1').get(challenge.sub);
  const settings = user && db.prepare('SELECT * FROM two_factor_settings WHERE user_id = ? AND enabled_at IS NOT NULL').get(user.id);
  if (!user || !settings || (challenge.av !== undefined && challenge.av !== user.auth_version)
    || (user.auth_version > 0 && challenge.av === undefined)) {
    throw new HttpError(401, 'Your verification session is no longer valid. Please sign in again.');
  }

  const secret = decrypt(settings.secret_encrypted);
  let verified = verifyTotp(secret, body.code);
  if (!verified) {
    const recovery = verifyRecoveryCode(user.id, body.code, settings.recovery_code_hashes);
    verified = recovery.valid;
    if (recovery.valid) {
      db.prepare('UPDATE two_factor_settings SET recovery_code_hashes = ? WHERE user_id = ?')
        .run(JSON.stringify(recovery.hashes), user.id);
      audit(db, req, user.id, 'two_factor_recovery_code_used');
    }
  }
  if (!verified) {
    db.prepare(`INSERT INTO login_activity (user_id, email, ip_address, user_agent, success)
      VALUES (?, ?, ?, ?, 0)`).run(user.id, user.email, requestIp(req), userAgent(req));
    throw new HttpError(401, 'The verification code is incorrect');
  }
  db.prepare(`INSERT INTO login_activity (user_id, email, ip_address, user_agent, success)
    VALUES (?, ?, ?, ?, 1)`).run(user.id, user.email, requestIp(req), userAgent(req));
  res.json({ token: sign(user, req), user: toUser(user) });
});

router.post('/forgot-password', passwordResetRequestLimiter, async (req, res) => {
  const { email } = z.object({ email: emailSchema }).parse(req.body);
  await handleResetCodeRequest(email, req, res);
});

router.post('/resend-reset-code', passwordResetRequestLimiter, async (req, res) => {
  const { email } = z.object({ email: emailSchema }).parse(req.body);
  await handleResetCodeRequest(email, req, res, 'password_reset_code_resent');
});

router.post('/verify-reset-code', passwordResetCodeLimiter, (req, res) => {
  const body = z.object({
    email: emailSchema,
    code: z.string().regex(/^\d{6}$/, 'Enter the six-digit verification code'),
  }).parse(req.body);
  const user = db.prepare('SELECT id FROM users WHERE email = ? AND login_enabled = 1 AND active = 1').get(body.email);
  const reset = user && db.prepare('SELECT * FROM password_reset_codes WHERE user_id = ?').get(user.id);
  const submitted = resetCodeHash(user?.id ?? 0, body.code);
  const expected = Buffer.from(reset?.code_hash || '', 'hex');
  const matches = expected.length === submitted.length && crypto.timingSafeEqual(expected, submitted);

  if (!user || !reset) {
    throw new HttpError(400, 'The verification code is incorrect. Check it and try again.');
  }
  if (reset.expires_at <= Date.now()) {
    db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(user.id);
    audit(db, req, user.id, 'password_reset_code_expired');
    throw new HttpError(400, 'This verification code has expired. Request a new code.');
  }
  if (reset.attempts >= MAX_RESET_ATTEMPTS) {
    db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(user.id);
    audit(db, req, user.id, 'password_reset_code_attempt_limit');
    throw new HttpError(429, 'Too many incorrect codes. Request a new code.');
  }
  if (!matches) {
    const attempts = reset.attempts + 1;
    if (attempts >= MAX_RESET_ATTEMPTS) {
      db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(user.id);
      audit(db, req, user.id, 'password_reset_code_attempt_limit');
      throw new HttpError(429, 'Too many incorrect codes. Request a new code.');
    }
    db.prepare('UPDATE password_reset_codes SET attempts = ? WHERE user_id = ?').run(attempts, user.id);
    audit(db, req, user.id, 'password_reset_code_failed', { attempts });
    throw new HttpError(400, 'The verification code is incorrect. Check it and try again.');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = resetTokenHash(token);
  const now = Date.now();
  db.transaction(() => {
    db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
    db.prepare(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?)`).run(user.id, tokenHash, now + RESET_TOKEN_TTL_MS, now);
    audit(db, req, user.id, 'password_reset_code_verified');
  })();
  res.json({ resetToken: token, expiresInSeconds: RESET_TOKEN_TTL_MS / 1000 });
});

router.post('/reset-password', passwordResetCodeLimiter, (req, res) => {
  const body = z.object({
    resetToken: z.string().min(1).max(200),
    password: passwordSchema,
    confirmPassword: z.string().min(1).max(200),
  }).refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  }).parse(req.body);
  const now = Date.now();
  const tokenHash = resetTokenHash(body.resetToken);
  const reset = db.prepare(`SELECT t.user_id, t.expires_at, t.used_at, u.email
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND u.active = 1 AND u.login_enabled = 1`).get(tokenHash);
  if (!reset) {
    throw new HttpError(400, 'This password reset session is invalid or expired. Verify a new code and try again.');
  }
  if (reset.used_at !== null) {
    audit(db, req, reset.user_id, 'password_reset_token_reused');
    throw new HttpError(400, 'This password reset session is invalid or expired. Verify a new code and try again.');
  }
  if (reset.expires_at <= now) {
    audit(db, req, reset.user_id, 'password_reset_token_expired');
    throw new HttpError(400, 'This password reset session is invalid or expired. Verify a new code and try again.');
  }
  const hashedPassword = bcrypt.hashSync(body.password, 10);
  db.transaction(() => {
    const consumed = db.prepare(`UPDATE password_reset_tokens SET used_at = ?
      WHERE user_id = ? AND token_hash = ? AND used_at IS NULL AND expires_at > ?`)
      .run(now, reset.user_id, tokenHash, now);
    if (consumed.changes !== 1) {
      throw new HttpError(400, 'This password reset session is invalid or expired. Verify a new code and try again.');
    }
    db.prepare('UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?')
      .run(hashedPassword, reset.user_id);
    db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL")
      .run(reset.user_id);
    db.prepare('DELETE FROM password_reset_codes WHERE user_id = ?').run(reset.user_id);
    audit(db, req, reset.user_id, 'password_reset');
  })();
  sendPasswordChangedEmailInBackground(reset.email);
  res.json({ message: 'Your password was changed successfully. You can now sign in.' });
});

router.get('/me', authenticate, (req, res) => res.json({ user: toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) }));

router.post('/logout', authenticate, (req, res) => {
  if (req.user.sessionId) {
    db.prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(req.user.sessionId, req.user.id);
  }
  res.json({ message: 'You have been logged out' });
});

router.get('/profile', authenticate, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const emails = [
    { email: user.email, addedAt: user.created_at, primary: true },
    ...db.prepare('SELECT email, added_at AS addedAt FROM user_emails WHERE user_id = ? ORDER BY id')
      .all(req.user.id)
      .map((email) => ({ ...email, primary: false })),
  ];
  res.json({ user: toUser(user), emails });
});

router.post('/profile/emails', authenticate, (req, res) => {
  throw new HttpError(410, 'Email changes now require confirmation. Use Profile Settings to verify the new address.');
});

module.exports = router;

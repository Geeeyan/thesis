// Exercises every module against a throwaway SQLite database and uploads folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'villa-test-'));
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_PATH: path.join(tmp, 'test.sqlite'), UPLOAD_DIR: path.join(tmp, 'uploads'),
  FRONTEND_BUILD_DIR: path.join(tmp, 'no-build'), JWT_SECRET: 'x'.repeat(40), AUTH_RATE_MAX: '40', PUBLIC_RATE_MAX: '1000', TRUST_PROXY: 'true',
  ADMIN_EMAIL: 'admin@test.com', ADMIN_PASSWORD: 'adminpass1', ADMIN_NAME: 'Admin',
  STAFF_EMAIL: 'staff@test.com', STAFF_PASSWORD: 'staffpass1', PAYMENT_INSTRUCTIONS_EWALLET: 'Send to 0900-000-0000',
  SMTP_HOST: 'smtp.test.local', SMTP_PORT: '587', SMTP_SECURE: 'false',
  SMTP_USER: 'mailer@test.com', SMTP_PASSWORD: 'test-smtp-password', SMTP_FROM: 'Villa Tjeozabel <noreply@test.com>',
  GMAIL_USER: 'noreply@test.com', GMAIL_APP_PASSWORD: 'test-app-password',
});

const db = require('../db');
const { createApp } = require('../app');
const { seedServices } = require('../seed');
const { today, addDays } = require('../lib/util');
const mailer = require('../lib/mailer');

let server, base;
test.before(async () => { server = createApp().listen(0); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, url, { token, body, form, headers: extraHeaders } = {}) {
  const headers = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
}
const login = async (email, password) => (await call('POST', '/api/auth/login', { body: { email, password } })).data.token;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const upload = (token, reservationId, buf, name = 'id.png') => {
  const f = new FormData(); f.append('reservationId', String(reservationId)); f.append('document', new Blob([buf]), name);
  return call('POST', '/api/documents', { token, form: f });
};
const uploadSiteAsset = (token, key, buf = PNG, name = 'image.png') => {
  const f = new FormData(); f.append('asset', new Blob([buf]), name);
  return call('POST', `/api/site-assets/${key}`, { token, form: f });
};
const uploadListingPhoto = (token, code, alt = '') => {
  const form = new FormData();
  for (const size of ['large', 'medium', 'thumbnail']) form.append(size, new Blob([PNG]), `${size}.png`);
  form.append('alt', alt);
  return call('POST', `/api/services/${code}/photos`, { token, form });
};
const profileForm = ({
  name = 'Admin', email = 'admin@test.com', phone = '', nickname, gender, country, language, timezone,
  currentPassword, password, picture,
} = {}) => {
  const form = new FormData();
  form.append('name', name);
  form.append('email', email);
  form.append('phone', phone);
  if (nickname !== undefined) form.append('nickname', nickname);
  if (gender !== undefined) form.append('gender', gender);
  if (country !== undefined) form.append('country', country);
  if (language !== undefined) form.append('language', language);
  if (timezone !== undefined) form.append('timezone', timezone);
  if (currentPassword) form.append('currentPassword', currentPassword);
  if (password) form.append('password', password);
  if (picture) form.append('profilePicture', new Blob([picture]), 'profile.png');
  return form;
};

const S = { in: addDays(today(), 10), out: addDays(today(), 13) }; // 3 nights
const state = {};

function currentTotp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

test('health and unknown routes', async () => {
  assert.equal((await call('GET', '/api/health')).data.ok, true);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('GET', '/')).status, 200); // API-only message when no frontend build exists
});

test('example SMTP placeholders are not treated as configured email', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const config = require('./server/config');
    const mailer = require('./server/lib/mailer');
    process.stdout.write(JSON.stringify({
      configured: mailer.isConfigured(),
      host: config.smtp.host,
      from: config.smtp.from,
    }));
  `], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'your-account@gmail.com',
      SMTP_PASSWORD: 'your-app-password',
      SMTP_FROM: 'Villa Tjeozabel <no-reply@example.com>',
      GMAIL_USER: 'your-account@gmail.com',
      GMAIL_APP_PASSWORD: 'your-app-password',
    },
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(JSON.parse(result.stdout.toString()), { configured: false, host: '', from: '' });
});

test('Gmail SMTP requires credentials even when host and sender are configured', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const mailer = require('./server/lib/mailer');
    process.stdout.write(JSON.stringify({ configured: mailer.isConfigured() }));
  `], {
    cwd: path.resolve(__dirname, '../..'),
    env: {
      ...process.env,
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'your-account@gmail.com',
      SMTP_PASSWORD: 'your-app-password',
      SMTP_FROM: 'Villa Tjeozabel <noreply@gmail.com>',
      GMAIL_USER: '',
      GMAIL_APP_PASSWORD: '',
    },
  });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.deepEqual(JSON.parse(result.stdout.toString()), { configured: false });
});

test('authentication', async () => {
  const bad = await call('POST', '/api/auth/register', { body: { name: 'A', email: 'a@test.com', password: 'short' } });
  assert.equal(bad.status, 400);
  const reg = await call('POST', '/api/auth/register', { body: { name: 'Ana', email: 'Ana@Test.com', password: 'password1' } });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.role, 'guest');
  assert.equal(reg.data.user.email, 'ana@test.com');
  assert.equal(reg.data.user.passwordHash, undefined);
  state.ana = reg.data.token;
  assert.equal((await call('POST', '/api/auth/register', { body: { name: 'Ana', email: 'ana@test.com', password: 'password1' } })).status, 409);
  const sneaky = await call('POST', '/api/auth/register', { body: { name: 'Eve', email: 'eve@test.com', password: 'password1', role: 'admin' } });
  assert.equal(sneaky.data.user.role, 'guest'); // cannot self-promote
  state.eve = sneaky.data.token;
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ana@test.com', password: 'wrongpass' } })).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { token: state.ana })).data.user.email, 'ana@test.com');
  assert.equal((await call('GET', '/api/auth/me')).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { token: 'garbage' })).status, 401);
  state.admin = await login('admin@test.com', 'adminpass1');
  state.staff = await login('staff@test.com', 'staffpass1');
  assert.ok(state.admin && state.staff);

  const sendPasswordResetCode = mailer.sendPasswordResetCode;
  const sendPasswordChangedConfirmation = mailer.sendPasswordChangedConfirmation;
  const isConfigured = mailer.isConfigured;
  const jwt = require('jsonwebtoken');
  const config = require('../config');
  let sentCode;
  let failResetDelivery = false;
  let changedConfirmationCount = 0;
  let resetIp = 1;
  const resetCall = (method, url, options = {}) => call(method, url, {
    ...options,
    headers: { 'X-Forwarded-For': `198.51.100.${resetIp++}`, ...options.headers },
  });
  const emailHash = (email) => crypto.createHmac('sha256', config.jwtSecret).update(email).digest('hex');
  const allowAnotherEmailRequest = (email) => {
    db.prepare('UPDATE password_reset_email_limits SET last_requested_at = ? WHERE email_hash = ?')
      .run(Date.now() - 61_000, emailHash(email));
  };
  const resetEmailRequestWindow = (email) => {
    const now = Date.now();
    db.prepare(`UPDATE password_reset_email_limits
      SET window_started_at = ?, request_count = 0, last_requested_at = ?
      WHERE email_hash = ?`).run(now - 60 * 60 * 1000 - 1, now - 61_000, emailHash(email));
  };
  const waitForCode = async () => {
    for (let i = 0; i < 20 && !sentCode; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(sentCode || '', /^\d{6}$/);
    return sentCode;
  };
  mailer.sendPasswordResetCode = async (email, code) => {
    assert.equal(email, 'ana@test.com');
    if (failResetDelivery) throw new Error('test SMTP failure');
    sentCode = code;
  };
  mailer.sendPasswordChangedConfirmation = async (email) => {
    assert.equal(email, 'ana@test.com');
    changedConfirmationCount++;
  };
  try {
    mailer.isConfigured = () => false;
    const notConfigured = await resetCall('POST', '/api/auth/forgot-password', { body: { email: 'ana@test.com' } });
    assert.equal(notConfigured.status, 503);
    assert.match(notConfigured.data.error, /Set MAIL_HOST, MAIL_FROM_ADDRESS/);
    mailer.isConfigured = isConfigured;

    const oldSession = state.ana;
    const userId = db.prepare('SELECT id FROM users WHERE email = ?').get('ana@test.com').id;
    const legacySession = jwt.sign({ sub: userId, role: 'guest' }, config.jwtSecret, { expiresIn: '1h' });
    failResetDelivery = true;
    await resetCall('POST', '/api/auth/forgot-password', { body: { email: 'ana@test.com' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM password_reset_codes WHERE user_id = ?').get(userId).count, 0);
    assert.ok(db.prepare(`SELECT id FROM profile_audit_log WHERE user_id = ? AND action = 'password_reset_email_failed'`).get(userId));
    failResetDelivery = false;
    allowAnotherEmailRequest('ana@test.com');
    sentCode = undefined;
    const requested = await resetCall('POST', '/api/auth/forgot-password', { body: { email: 'ANA@test.com' } });
    assert.equal(requested.status, 200);
    assert.equal(requested.data.message, 'If this email is registered, a code has been sent.');
    const firstCode = await waitForCode();
    const storedCode = db.prepare('SELECT code_hash FROM password_reset_codes WHERE user_id = ?').get(userId);
    assert.equal(storedCode.code_hash.length, 64);
    assert.notEqual(storedCode.code_hash, firstCode);

    const unknown = await resetCall('POST', '/api/auth/forgot-password', { body: { email: 'unknown@test.com' } });
    assert.deepEqual(unknown.data, requested.data);
    const earlyResend = await resetCall('POST', '/api/auth/resend-reset-code', { body: { email: 'ana@test.com' } });
    assert.equal(earlyResend.status, 429);

    allowAnotherEmailRequest('ana@test.com');
    sentCode = undefined;
    const resent = await resetCall('POST', '/api/auth/resend-reset-code', { body: { email: 'ana@test.com' } });
    assert.equal(resent.status, 200);
    const currentCode = await waitForCode();
    assert.notEqual(currentCode, firstCode);
    const oldCode = await resetCall('POST', '/api/auth/verify-reset-code', {
      body: { email: 'ana@test.com', code: firstCode },
    });
    assert.equal(oldCode.status, 400);
    assert.match(oldCode.data.error, /incorrect/i);

    const verified = await resetCall('POST', '/api/auth/verify-reset-code', {
      body: { email: 'ana@test.com', code: currentCode },
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.data.resetToken.length, 43);
    assert.equal((await resetCall('POST', '/api/auth/verify-reset-code', {
      body: { email: 'ana@test.com', code: currentCode },
    })).status, 400);
    const storedToken = db.prepare('SELECT token_hash FROM password_reset_tokens WHERE user_id = ?').get(userId);
    assert.notEqual(storedToken.token_hash, verified.data.resetToken);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM password_reset_codes WHERE user_id = ?').get(userId).count, 0);

    const bypass = await resetCall('POST', '/api/auth/reset-password', {
      body: { email: 'ana@test.com', code: currentCode, password: 'newpassword1', confirmPassword: 'newpassword1' },
    });
    assert.equal(bypass.status, 400);
    const mismatch = await resetCall('POST', '/api/auth/reset-password', {
      body: { resetToken: verified.data.resetToken, password: 'newpassword1', confirmPassword: 'different1' },
    });
    assert.equal(mismatch.status, 400);
    const reset = await resetCall('POST', '/api/auth/reset-password', {
      body: { resetToken: verified.data.resetToken, password: 'newpassword1', confirmPassword: 'newpassword1' },
    });
    assert.equal(reset.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(changedConfirmationCount, 1);
    assert.equal((await resetCall('POST', '/api/auth/reset-password', {
      body: { resetToken: verified.data.resetToken, password: 'newpassword2', confirmPassword: 'newpassword2' },
    })).status, 400);
    assert.ok(db.prepare(`SELECT id FROM profile_audit_log WHERE user_id = ? AND action = 'password_reset_token_reused'`).get(userId));
    assert.equal((await resetCall('GET', '/api/auth/me', { token: oldSession })).status, 401);
    assert.equal((await resetCall('GET', '/api/auth/me', { token: legacySession })).status, 401);
    assert.equal((await resetCall('POST', '/api/auth/login', {
      body: { email: 'ana@test.com', password: 'password1' },
    })).status, 401);
    const restoredLogin = await resetCall('POST', '/api/auth/login', {
      body: { email: 'ana@test.com', password: 'newpassword1' },
    });
    assert.equal(restoredLogin.status, 200);
    state.ana = restoredLogin.data.token;

    resetEmailRequestWindow('ana@test.com');
    sentCode = undefined;
    await resetCall('POST', '/api/auth/forgot-password', { body: { email: 'ana@test.com' } });
    const attemptCode = await waitForCode();
    const wrongCode = String((Number(attemptCode) + 1) % 1_000_000).padStart(6, '0');
    for (let attempt = 0; attempt < 4; attempt++) {
      const wrong = await resetCall('POST', '/api/auth/verify-reset-code', {
        body: { email: 'ana@test.com', code: wrongCode },
      });
      assert.equal(wrong.status, 400);
      assert.match(wrong.data.error, /incorrect/i);
    }
    const attemptLimit = await resetCall('POST', '/api/auth/verify-reset-code', {
      body: { email: 'ana@test.com', code: wrongCode },
    });
    assert.equal(attemptLimit.status, 429);
    assert.match(attemptLimit.data.error, /too many/i);
    assert.equal((await resetCall('POST', '/api/auth/verify-reset-code', {
      body: { email: 'ana@test.com', code: attemptCode },
    })).status, 400);

    allowAnotherEmailRequest('ana@test.com');
    sentCode = undefined;
    await resetCall('POST', '/api/auth/forgot-password', { body: { email: 'ana@test.com' } });
    const expiredCode = await waitForCode();
    db.prepare('UPDATE password_reset_codes SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1, userId);
    const expired = await resetCall('POST', '/api/auth/verify-reset-code', {
      body: { email: 'ana@test.com', code: expiredCode },
    });
    assert.equal(expired.status, 400);
    assert.match(expired.data.error, /expired/i);

    allowAnotherEmailRequest('ana@test.com');
    sentCode = undefined;
    await resetCall('POST', '/api/auth/forgot-password', { body: { email: 'ana@test.com' } });
    const tokenExpiryCode = await waitForCode();
    const tokenExpiryVerification = await resetCall('POST', '/api/auth/verify-reset-code', {
      body: { email: 'ana@test.com', code: tokenExpiryCode },
    });
    assert.equal(tokenExpiryVerification.status, 200);
    db.prepare('UPDATE password_reset_tokens SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1, userId);
    const expiredToken = await resetCall('POST', '/api/auth/reset-password', {
      body: { resetToken: tokenExpiryVerification.data.resetToken, password: 'newpassword2', confirmPassword: 'newpassword2' },
    });
    assert.equal(expiredToken.status, 400);
    assert.match(expiredToken.data.error, /expired/i);

    const rateEmail = 'rate@test.com';
    db.prepare('DELETE FROM password_reset_email_limits WHERE email_hash = ?').run(emailHash(rateEmail));
    for (let request = 0; request < 5; request++) {
      const rateResponse = await resetCall('POST', '/api/auth/forgot-password', { body: { email: rateEmail } });
      assert.equal(rateResponse.status, 200);
      allowAnotherEmailRequest(rateEmail);
    }
    const emailLimited = await resetCall('POST', '/api/auth/forgot-password', { body: { email: rateEmail } });
    assert.equal(emailLimited.status, 429);
    assert.match(emailLimited.data.error, /too many/i);

    const sharedIp = '203.0.113.250';
    for (let request = 0; request < 5; request++) {
      const ipResponse = await call('POST', '/api/auth/forgot-password', {
        body: { email: `ip-rate-${request}@test.com` },
        headers: { 'X-Forwarded-For': sharedIp },
      });
      assert.equal(ipResponse.status, 200);
    }
    const ipLimited = await call('POST', '/api/auth/forgot-password', {
      body: { email: 'ip-rate-final@test.com' },
      headers: { 'X-Forwarded-For': sharedIp },
    });
    assert.equal(ipLimited.status, 429);
  } finally {
    mailer.sendPasswordResetCode = sendPasswordResetCode;
    mailer.sendPasswordChangedConfirmation = sendPasswordChangedConfirmation;
    mailer.isConfigured = isConfigured;
  }
});

test('SMTP mailer sends generic email and password-reset messages', async () => {
  const nodemailer = require('nodemailer');
  const config = require('../config');
  const originalCreateTransport = nodemailer.createTransport;
  const originalRetryDelay = config.mailRetryDelayMs;
  let transportOptions;
  const sentMessages = [];
  let sendFailureCount = 0;
  nodemailer.createTransport = (options) => {
    transportOptions = options;
    return {
      sendMail: async (message) => {
        if (sendFailureCount > 0) {
          sendFailureCount -= 1;
          throw Object.assign(new Error('SMTP password must not be logged'), { code: 'ETIMEDOUT' });
        }
        sentMessages.push(message);
        return { messageId: `test-${sentMessages.length}` };
      },
    };
  };
  try {
    const result = await mailer.sendEmail({
      to: 'guest@test.com',
      subject: 'Test message',
      text: 'SMTP delivery works',
    });
    assert.equal(result.messageId, 'test-1');
    assert.deepEqual(transportOptions, {
      host: 'smtp.test.local',
      port: 587,
      secure: false,
      requireTLS: true,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      auth: { user: 'mailer@test.com', pass: 'test-smtp-password' },
    });
    assert.equal(sentMessages[0].from, 'Villa Tjeozabel <noreply@test.com>');
    assert.equal(sentMessages[0].to, 'guest@test.com');
    assert.match(sentMessages[0].html, /Villa Tjeozabel/);
    await assert.rejects(mailer.sendEmail({
      to: 'not-an-email',
      subject: 'Invalid address',
      text: 'Not sent',
    }), /valid email recipient/);

    await mailer.sendPasswordResetCode('guest@test.com', '123456');
    assert.equal(sentMessages[1].subject, 'Your password reset code');
    assert.match(sentMessages[1].text, /123456/);
    assert.match(sentMessages[1].html, /123456/);
    assert.match(sentMessages[1].text, /If you didn't request this, ignore this email/);
    await assert.rejects(mailer.sendEmail({ to: 'guest@test.com', subject: 'Missing content' }), /subject and message content/);
    await mailer.sendPasswordChangedConfirmation('guest@test.com');
    assert.equal(sentMessages[2].subject, 'Your password was changed');

    const booking = mailer.buildTemplate('booking_confirmation', {
      reference: 'VT-TEST',
      service: '<script>alert(1)</script>',
      date: 'Nov 9',
      startTime: '7:00 AM',
      endTime: '7:00 PM',
      duration: '12 hours',
      total: 'PHP 5,000',
    });
    assert.match(booking.subject, /VT-TEST/);
    assert.match(booking.text, /7:00 AM/);
    assert.match(booking.html, /&lt;script&gt;/);
    assert.doesNotMatch(booking.html, /<script>/);

    config.mailRetryDelayMs = 0;
    sendFailureCount = 2;
    const beforeRetry = sentMessages.length;
    await mailer.sendEmail({ to: 'guest@test.com', subject: 'Retry test', text: 'Retry safely' });
    assert.equal(sentMessages.length, beforeRetry + 1);

    const loggedErrors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => loggedErrors.push(args.join(' '));
    try {
      sendFailureCount = 3;
      await assert.rejects(
        mailer.sendEmail({ to: 'guest@test.com', subject: 'Failure test', text: 'No credentials here' }),
        /Email delivery failed/,
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.match(loggedErrors.join(' '), /ETIMEDOUT/);
    assert.doesNotMatch(loggedErrors.join(' '), /test-smtp-password|SMTP password must not be logged/);
  } finally {
    config.mailRetryDelayMs = originalRetryDelay;
    nodemailer.createTransport = originalCreateTransport;
  }
});

test.skip('legacy profile editor has been replaced by self-service profile settings routes', async () => {
  assert.equal((await call('PATCH', '/api/admin/profile', { form: profileForm() })).status, 401);

  const staffProfile = await call('PATCH', '/api/admin/profile', {
    token: state.staff,
    form: profileForm({ email: 'staff@test.com', picture: PNG }),
  });
  assert.equal(staffProfile.status, 200);
  assert.equal(staffProfile.data.user.role, 'staff');
  assert.match(staffProfile.data.user.profileImage, /^[a-f0-9]{40}\.png$/);

  const guestPictureAndProfile = await call('PATCH', '/api/admin/profile', {
    token: state.ana,
    form: profileForm({
      name: 'Ana Updated',
      email: 'ana-updated@test.com',
      currentPassword: 'wrong-password',
      password: 'guestpass2',
      picture: PNG,
    }),
  });
  assert.equal(guestPictureAndProfile.status, 400);
  assert.match(guestPictureAndProfile.data.error, /current password is incorrect/i);

  const guestProfile = await call('PATCH', '/api/admin/profile', {
    token: state.ana,
    form: profileForm({
      name: 'Ana Updated',
      email: 'ANA-UPDATED@test.com',
      nickname: 'Annie',
      gender: 'Woman',
      country: 'PH',
      language: 'fil',
      timezone: 'Asia/Manila',
      currentPassword: 'newpassword1',
      password: 'guestpass2',
      picture: PNG,
    }),
  });
  assert.equal(guestProfile.status, 200);
  assert.equal(guestProfile.data.user.role, 'guest');
  assert.equal(guestProfile.data.user.name, 'Ana Updated');
  assert.equal(guestProfile.data.user.email, 'ana-updated@test.com');
  assert.equal(guestProfile.data.user.nickname, 'Annie');
  assert.equal(guestProfile.data.user.gender, 'Woman');
  assert.equal(guestProfile.data.user.country, 'PH');
  assert.equal(guestProfile.data.user.language, 'fil');
  assert.equal(guestProfile.data.user.timezone, 'Asia/Manila');
  assert.match(guestProfile.data.user.profileImage, /^[a-f0-9]{40}\.png$/);
  assert.equal((await call('GET', `/api/admin/profile-picture/${guestProfile.data.user.profileImage}`)).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: state.ana })).data.user.email, 'ana-updated@test.com');
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ana@test.com', password: 'guestpass2' } })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ana-updated@test.com', password: 'guestpass2' } })).status, 200);

  const profileSettings = await call('GET', '/api/auth/profile', { token: state.ana });
  assert.equal(profileSettings.status, 200);
  assert.equal(profileSettings.data.user.nickname, 'Annie');
  assert.deepEqual(profileSettings.data.emails.map((item) => item.email), ['ana-updated@test.com']);
  const addedEmail = await call('POST', '/api/auth/profile/emails', {
    token: state.ana, body: { email: 'ANA+OTHER@test.com' },
  });
  assert.equal(addedEmail.status, 201);
  assert.equal(addedEmail.data.email.email, 'ana+other@test.com');
  assert.equal(addedEmail.data.email.primary, false);
  assert.equal((await call('POST', '/api/auth/profile/emails', {
    token: state.ana, body: { email: 'ana-updated@test.com' },
  })).status, 409);
  assert.equal((await call('POST', '/api/auth/profile/emails', {
    token: state.ana, body: { email: 'invalid-email' },
  })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/profile', {
    token: state.ana,
    form: profileForm({ email: 'ana+other@test.com', currentPassword: 'guestpass2' }),
  })).status, 409);
  const listedEmails = await call('GET', '/api/auth/profile', { token: state.ana });
  assert.deepEqual(listedEmails.data.emails.map((item) => item.email), ['ana-updated@test.com', 'ana+other@test.com']);

  const duplicateGuestEmail = await call('PATCH', '/api/admin/profile', {
    token: state.ana,
    form: profileForm({ email: 'admin@test.com', currentPassword: 'guestpass2' }),
  });
  assert.equal(duplicateGuestEmail.status, 409);

  const restoredGuest = await call('PATCH', '/api/admin/profile', {
    token: state.ana,
    form: profileForm({
      name: 'Ana',
      email: 'ana@test.com',
      currentPassword: 'guestpass2',
      password: 'newpassword1',
    }),
  });
  assert.equal(restoredGuest.status, 200);
  assert.equal(restoredGuest.data.user.profileImage, guestProfile.data.user.profileImage);

  const updated = await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    form: profileForm({ name: 'Updated Admin', email: 'UPDATED-ADMIN@test.com', phone: '+63 917-000-0000', currentPassword: 'adminpass1', picture: PNG }),
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.user.name, 'Updated Admin');
  assert.equal(updated.data.user.email, 'updated-admin@test.com');
  assert.equal(updated.data.user.phone, '+63 917-000-0000');
  assert.match(updated.data.user.profileImage, /^[a-f0-9]{40}\.png$/);

  const image = await call('GET', `/api/admin/profile-picture/${updated.data.user.profileImage}`);
  assert.equal(image.status, 200);
  assert.deepEqual(image.data, PNG);

  const replaced = await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    form: profileForm({ name: 'Updated Admin', email: 'updated-admin@test.com', phone: '+63 917-000-0000', currentPassword: 'adminpass1', picture: PNG }),
  });
  assert.equal(replaced.status, 200);
  assert.notEqual(replaced.data.user.profileImage, updated.data.user.profileImage);
  assert.equal((await call('GET', `/api/admin/profile-picture/${updated.data.user.profileImage}`)).status, 404);

  const duplicateEmail = await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    form: profileForm({ email: 'ana@test.com', currentPassword: 'adminpass1' }),
  });
  assert.equal(duplicateEmail.status, 409);

  const invalidMobile = await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    form: profileForm({ email: 'updated-admin@test.com', phone: 'not a number!' }),
  });
  assert.equal(invalidMobile.status, 400);

  const invalidPicture = await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    form: profileForm({ email: 'updated-admin@test.com', picture: Buffer.from('not an image') }),
  });
  assert.equal(invalidPicture.status, 400);
  const invalidPasswordChange = await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    form: profileForm({ currentPassword: 'wrong-password', password: 'adminpass2' }),
  });
  assert.equal(invalidPasswordChange.status, 400);
  assert.match(invalidPasswordChange.data.error, /current password is incorrect/i);
  const passwordChange = await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    form: profileForm({ email: 'updated-admin@test.com', currentPassword: 'adminpass1', password: 'adminpass2' }),
  });
  assert.equal(passwordChange.status, 200);
  assert.equal(passwordChange.data.user.email, 'updated-admin@test.com');
  assert.equal((await call('POST', '/api/auth/login', {
    body: { email: 'updated-admin@test.com', password: 'adminpass1' },
  })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', {
    body: { email: 'updated-admin@test.com', password: 'adminpass2' },
  })).status, 200);
  const restored = await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    form: profileForm({ name: 'Admin', email: 'admin@test.com', currentPassword: 'adminpass2' }),
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.user.profileImage, replaced.data.user.profileImage);
});

test('shared profile settings are self-scoped and verify sensitive changes', async () => {
  const registered = await call('POST', '/api/auth/register', {
    body: { name: 'Profile Guest', email: 'profile-guest@test.com', password: 'profilepass1' },
  });
  let guestToken = registered.data.token;
  const identities = [
    { role: 'guest', token: guestToken },
    { role: 'staff', token: state.staff },
    { role: 'admin', token: state.admin },
  ];
  const originals = {};
  for (const identity of identities) {
    const result = await call('GET', '/api/profile', { token: identity.token });
    assert.equal(result.status, 200);
    assert.equal(result.data.user.role, identity.role);
    originals[identity.role] = result.data.user;
  }
  assert.equal((await call('PUT', '/api/profile', {
    token: guestToken,
    body: { userId: originals.admin.id, name: 'Attempt to edit another account' },
  })).status, 400);
  const selfScoped = await call('GET', `/api/profile?userId=${originals.admin.id}`, { token: guestToken });
  assert.equal(selfScoped.data.user.id, originals.guest.id);

  for (const identity of identities) {
    const updated = await call('PUT', '/api/profile', {
      token: identity.token,
      body: {
        name: originals[identity.role].name,
        nickname: `${identity.role}-profile`,
        phone: '',
        address: '',
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.user.id, originals[identity.role].id);
    assert.equal(updated.data.user.role, identity.role);
  }

  const guestId = originals.guest.id;
  const invalidAvatar = new FormData();
  invalidAvatar.append('currentPassword', 'profilepass1');
  invalidAvatar.append('profilePicture', new Blob(['not an image']), 'avatar.jpg');
  assert.equal((await call('POST', '/api/profile/avatar', { token: guestToken, form: invalidAvatar })).status, 400);
  const avatar = new FormData();
  avatar.append('currentPassword', 'profilepass1');
  avatar.append('profilePicture', new Blob([PNG]), 'avatar.png');
  const uploadedAvatar = await call('POST', '/api/profile/avatar', { token: guestToken, form: avatar });
  assert.equal(uploadedAvatar.status, 200);
  assert.match(uploadedAvatar.data.user.profileImage, /^[a-f0-9]{40}\.png$/);

  const sendEmail = mailer.sendEmail;
  let verificationMessage;
  mailer.sendEmail = async (message) => { verificationMessage = message; return { messageId: 'profile-test' }; };
  let changedEmail;
  try {
    const requested = await call('POST', '/api/profile/email-verification', {
      token: guestToken,
      body: { email: 'profile-verified@test.com', currentPassword: 'profilepass1' },
    });
    assert.equal(requested.status, 200);
    const token = verificationMessage.text.match(/verify-profile-email\?token=([a-f0-9]{64})/i)?.[1];
    assert.ok(token);
    const confirmed = await call('POST', '/api/profile/email-verification/confirm', {
      body: { token },
    });
    assert.equal(confirmed.status, 200);
    assert.match(confirmed.data.message, /updated/i);
    const updatedProfile = await call('GET', '/api/profile', { token: guestToken });
    assert.equal(updatedProfile.data.user.email, 'profile-verified@test.com');
    changedEmail = updatedProfile.data.user.email;

    const additionalAddress = await call('POST', '/api/profile/secondary-emails', {
      token: guestToken,
      body: { email: 'profile-secondary@test.com', currentPassword: 'profilepass1' },
    });
    assert.equal(additionalAddress.status, 200);
    const secondaryToken = verificationMessage.text.match(/verify-profile-email\?token=([a-f0-9]{64})/i)?.[1];
    assert.ok(secondaryToken);
    const confirmedSecondary = await call('POST', '/api/profile/email-verification/confirm', {
      body: { token: secondaryToken },
    });
    assert.equal(confirmedSecondary.status, 200);
    const profileWithSecondary = await call('GET', '/api/profile', { token: guestToken });
    assert.deepEqual(profileWithSecondary.data.emails.map((item) => item.email), [
      'profile-verified@test.com',
      'profile-secondary@test.com',
    ]);
  } finally {
    mailer.sendEmail = sendEmail;
  }

  const additionalSession = await call('POST', '/api/auth/login', {
    body: { email: changedEmail, password: 'profilepass1' },
  });
  assert.equal(additionalSession.status, 200);
  state.additionalGuestSession = additionalSession.data.token;
  const sessions = await call('GET', '/api/profile/sessions', { token: guestToken });
  const otherSession = sessions.data.sessions.find((session) => !session.current);
  assert.ok(otherSession);
  const loggedOut = await call('DELETE', `/api/profile/sessions/${otherSession.id}`, {
    token: guestToken,
    body: { currentPassword: 'profilepass1' },
  });
  assert.equal(loggedOut.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: state.additionalGuestSession })).status, 401);

  const stillOtherSession = await call('POST', '/api/auth/login', {
    body: { email: changedEmail, password: 'profilepass1' },
  });
  state.additionalGuestSession = stillOtherSession.data.token;
  const changedPassword = await call('PUT', '/api/profile/password', {
    token: guestToken,
    body: { currentPassword: 'profilepass1', password: 'profilepass2' },
  });
  assert.equal(changedPassword.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: state.additionalGuestSession })).status, 401);
  const newLogin = await call('POST', '/api/auth/login', {
    body: { email: changedEmail, password: 'profilepass2' },
  });
  assert.equal(newLogin.status, 200);
  guestToken = newLogin.data.token;

  const preferences = await call('PUT', '/api/profile/consents', {
    token: guestToken,
    body: { email_notifications: true, marketing: false },
  });
  assert.equal(preferences.status, 200);
  assert.equal(preferences.data.consents.email_notifications.enabled, true);
  const activity = await call('GET', '/api/profile/audit-log', { token: guestToken });
  assert.ok(activity.data.entries.some((entry) => entry.action === 'consent_updated'));

  const exportRequest = await call('POST', '/api/profile/data-exports', {
    token: guestToken,
    body: { currentPassword: 'profilepass2' },
  });
  assert.equal(exportRequest.status, 201);
  const exported = await call('GET', `/api/profile/data-exports/${exportRequest.data.requestId}/download`, { token: guestToken });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /application\/json/);
  assert.equal(exported.data.profile.email, 'profile-verified@test.com');

  const accountRequest = await call('POST', '/api/profile/account-requests', {
    token: guestToken,
    body: { type: 'deletion', currentPassword: 'profilepass2' },
  });
  assert.equal(accountRequest.status, 201);
  assert.equal(accountRequest.data.request.status, 'Pending');
  assert.equal((await call('GET', '/api/auth/me', { token: guestToken })).status, 200);
  assert.equal(db.prepare('SELECT id FROM users WHERE id = ?').get(guestId).id, guestId);
});

test('legacy profile mutation routes cannot bypass verification', async () => {
  assert.equal((await call('PATCH', '/api/admin/profile', {
    token: state.admin,
    body: { email: 'unverified-change@test.com', password: 'changedpass1' },
  })).status, 404);
  assert.equal((await call('POST', '/api/auth/profile/emails', {
    token: state.admin,
    body: { email: 'unverified-secondary@test.com' },
  })).status, 410);
});

test('two-factor login requires a code and blocks challenge tokens from authenticated APIs', async () => {
  const registered = await call('POST', '/api/auth/register', {
    body: { name: 'MFA Guest', email: 'mfa-guest@test.com', password: 'mfapass1' },
  });
  const setup = await call('POST', '/api/profile/two-factor/setup', {
    token: registered.data.token,
    body: { currentPassword: 'mfapass1' },
  });
  assert.equal(setup.status, 200);
  const enabled = await call('POST', '/api/profile/two-factor/enable', {
    token: registered.data.token,
    body: { code: currentTotp(setup.data.secret) },
  });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.data.recoveryCodes.length, 10);

  const challenge = await call('POST', '/api/auth/login', {
    body: { email: 'mfa-guest@test.com', password: 'mfapass1' },
  });
  assert.equal(challenge.status, 200);
  assert.equal(challenge.data.mfaRequired, true);
  assert.equal((await call('GET', '/api/profile', { token: challenge.data.challengeToken })).status, 401);

  const verified = await call('POST', '/api/auth/verify-two-factor', {
    body: { challengeToken: challenge.data.challengeToken, code: currentTotp(setup.data.secret) },
  });
  assert.equal(verified.status, 200);
  assert.equal((await call('GET', '/api/profile', { token: verified.data.token })).status, 200);

  const recoveryChallenge = await call('POST', '/api/auth/login', {
    body: { email: 'mfa-guest@test.com', password: 'mfapass1' },
  });
  const recoveryLogin = await call('POST', '/api/auth/verify-two-factor', {
    body: { challengeToken: recoveryChallenge.data.challengeToken, code: enabled.data.recoveryCodes[0] },
  });
  assert.equal(recoveryLogin.status, 200);
  const disabled = await call('DELETE', '/api/profile/two-factor', {
    token: recoveryLogin.data.token,
    body: { currentPassword: 'mfapass1', code: currentTotp(setup.data.secret) },
  });
  assert.equal(disabled.status, 200);
  const ordinaryLogin = await call('POST', '/api/auth/login', {
    body: { email: 'mfa-guest@test.com', password: 'mfapass1' },
  });
  assert.ok(ordinaryLogin.data.token);
  assert.equal(ordinaryLogin.data.mfaRequired, undefined);
});

test('site images: admin upload, public display, and restore default', async () => {
  assert.deepEqual((await call('GET', '/api/site-assets')).data.assets, {});
  assert.equal((await call('GET', '/api/site-assets/payment-qr')).status, 404);
  assert.equal((await uploadSiteAsset(null, 'payment-qr')).status, 401);
  assert.equal((await uploadSiteAsset(state.staff, 'payment-qr')).status, 403);
  assert.equal((await uploadSiteAsset(state.admin, 'not-an-image-slot')).status, 404);
  assert.equal((await uploadSiteAsset(state.admin, 'payment-qr', Buffer.from('<svg/>'), 'qr.svg')).status, 400);

  const uploaded = await uploadSiteAsset(state.admin, 'payment-qr');
  assert.equal(uploaded.status, 201);
  assert.ok(uploaded.data.updatedAt);
  assert.ok((await call('GET', '/api/site-assets')).data.assets['payment-qr'].updatedAt);
  const image = await call('GET', '/api/site-assets/payment-qr');
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(image.data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  assert.equal((await call('DELETE', '/api/site-assets/payment-qr', { token: state.staff })).status, 403);
  assert.equal((await call('DELETE', '/api/site-assets/payment-qr', { token: state.admin })).status, 204);
  assert.deepEqual((await call('GET', '/api/site-assets')).data.assets, {});
  assert.equal((await call('GET', '/api/site-assets/payment-qr')).status, 404);
});

test('inquiries and private guest/staff conversations', async () => {
  assert.equal((await call('POST', '/api/messages/inquiries', { body: { name: 'Guest', email: 'guest@test.com', subject: 'Pricing', message: 'How much is a weekend stay?' } })).status, 201);
  const inquiry = await call('POST', '/api/messages/inquiries', { body: { name: 'Mia Guest', email: 'mia@test.com', phone: '09170000000', subject: 'Room Reservation', message: 'Is the family room available next month?' } });
  assert.equal(inquiry.status, 201);
  state.inquiry = inquiry.data;

  assert.equal((await call('GET', `/api/messages/${state.inquiry.conversationId}`)).status, 404);
  assert.equal((await call('GET', `/api/messages/${state.inquiry.conversationId}`, { headers: { 'X-Inquiry-Token': 'wrong' } })).status, 404);
  const initial = await call('GET', `/api/messages/${state.inquiry.conversationId}`, { headers: { 'X-Inquiry-Token': state.inquiry.accessToken } });
  assert.equal(initial.status, 200);
  assert.equal(initial.data.messages.length, 1);
  assert.equal(initial.data.messages[0].body, 'Is the family room available next month?');

  const staffInbox = await call('GET', '/api/messages', { token: state.staff });
  assert.ok(staffInbox.data.some((item) => item.id === state.inquiry.conversationId && item.guestEmail === 'mia@test.com'));
  assert.equal((await call('GET', '/api/messages', { token: state.ana })).data.some((item) => item.id === state.inquiry.conversationId), false);
  assert.equal(staffInbox.data.some((item) => Object.hasOwn(item, 'accessToken')), false);
  const notificationsBeforeReply = await call('GET', '/api/admin/notifications', { token: state.admin });
  assert.ok(notificationsBeforeReply.data.messages.some((item) => item.id === state.inquiry.conversationId));

  const reply = await call('POST', `/api/messages/${state.inquiry.conversationId}/replies`, {
    token: state.staff, body: { body: 'Yes, please share your preferred dates.' },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.data.senderRole, 'staff');
  const notificationsAfterReply = await call('GET', '/api/admin/notifications', { token: state.admin });
  assert.ok(!notificationsAfterReply.data.messages.some((item) => item.id === state.inquiry.conversationId));
  const updated = await call('GET', `/api/messages/${state.inquiry.conversationId}`, { headers: { 'X-Inquiry-Token': state.inquiry.accessToken } });
  assert.equal(updated.data.messages.length, 2);
  assert.equal(updated.data.messages[1].body, 'Yes, please share your preferred dates.');

  const guestReply = await call('POST', `/api/messages/${state.inquiry.conversationId}/replies`, {
    headers: { 'X-Inquiry-Token': state.inquiry.accessToken }, body: { body: 'We prefer Saturday.' },
  });
  assert.equal(guestReply.data.senderRole, 'guest');
  const notificationsAfterGuestReply = await call('GET', '/api/admin/notifications', { token: state.admin });
  assert.ok(notificationsAfterGuestReply.data.messages.some((item) => item.id === state.inquiry.conversationId));
  assert.equal((await call('POST', `/api/messages/${state.inquiry.conversationId}/replies`, { token: state.ana, body: { body: 'Not my inquiry' } })).status, 404);

  const registered = await call('POST', '/api/auth/register', { body: { name: 'Mia Account', email: 'mia@test.com', password: 'password1' } });
  assert.equal(registered.status, 201);
  const accountInbox = await call('GET', '/api/messages', { token: registered.data.token });
  assert.ok(accountInbox.data.some((item) => item.id === state.inquiry.conversationId));
  assert.equal(accountInbox.data.find((item) => item.id === state.inquiry.conversationId).unreadCount, 1);
  const accountView = await call('GET', `/api/messages/${state.inquiry.conversationId}`, { token: registered.data.token });
  assert.equal(accountView.data.messages.length, 3);
  const readInbox = await call('GET', '/api/messages', { token: registered.data.token });
  assert.equal(readInbox.data.find((item) => item.id === state.inquiry.conversationId).unreadCount, 0);
  assert.equal((await call('GET', `/api/messages/${state.inquiry.conversationId}`, { token: state.ana })).status, 404);
  assert.equal((await call('POST', '/api/messages/inquiries', { body: { name: 'Guest', email: 'bad-email', subject: 'Other', message: 'No' } })).status, 400);
  assert.equal((await call('POST', `/api/messages/${state.inquiry.conversationId}/replies`, { token: state.staff, body: { body: '   ' } })).status, 400);
});

test('services: public read, admin write', async () => {
  const list = await call('GET', '/api/services');
  assert.ok(list.data.length >= 4);
  assert.equal(list.data.find((service) => service.code === 'pool').pricingMode, 'guest');
  assert.ok(list.data.every((service) => service.category === 'room'));
  assert.ok(!list.data.some((service) => service.code === 'breakfast'));
  assert.ok(!list.data.some((service) => service.code === 'family'));

  assert.equal((await call('GET', '/api/services/management')).status, 401);
  assert.equal((await call('GET', '/api/services/management', { token: state.ana })).status, 403);
  const staffManagement = await call('GET', '/api/services/management', { token: state.staff });
  assert.equal(staffManagement.status, 200);
  assert.deepEqual(staffManagement.data.permissions, ['rooms.view', 'services.view']);
  assert.equal(staffManagement.data.services.find((service) => service.code === 'event').inventoryType, 'service');
  assert.equal(staffManagement.data.services.find((service) => service.code === 'regular').inventoryType, 'room');
  assert.equal((await call('GET', '/api/services/regular')).status, 401);
  assert.equal((await call('GET', '/api/services/regular', { token: state.ana })).status, 403);
  assert.equal((await call('GET', '/api/services/regular', { token: state.staff })).status, 200);
  const adminManagement = await call('GET', '/api/services/management', { token: state.admin });
  assert.deepEqual(adminManagement.data.permissions, [
    'rooms.view', 'rooms.create', 'rooms.update', 'rooms.delete',
    'services.view', 'services.create', 'services.update', 'services.delete',
  ]);
  const roomList = await call('GET', `/api/services/management?date=${today()}&type=room`, { token: state.admin });
  const serviceList = await call('GET', `/api/services/management?date=${today()}&type=service`, { token: state.admin });
  assert.ok(roomList.data.services.every((service) => service.inventoryType === 'room'));
  assert.ok(serviceList.data.services.every((service) => service.inventoryType === 'service'));
  assert.ok(serviceList.data.services.some((service) => service.code === 'pool'));
  assert.ok(staffManagement.data.services.some((service) => service.code === 'event'));
  assert.equal((await call('GET', `/api/services/management?date=${addDays(today(), -1)}`, { token: state.staff })).status, 400);
  assert.equal((await call('POST', '/api/services', {
    token: state.staff,
    body: { code: 'staff-room', name: 'Staff Room', category: 'room', price: 50 },
  })).status, 403);
  assert.equal((await call('PATCH', '/api/services/regular', { token: state.staff, body: { price: 1 } })).status, 403);
  assert.equal((await call('DELETE', '/api/services/regular', { token: state.staff })).status, 403);

  const occupiedDate = addDays(today(), 200);
  const occupiedBooking = await call('POST', '/api/reservations', {
    body: {
      guestName: 'Availability Test',
      guestEmail: 'availability-test@test.com',
      room: 'event',
      checkIn: occupiedDate,
      checkOut: occupiedDate,
      preferredTime: '07:00',
      guests: 20,
    },
  });
  assert.equal(occupiedBooking.status, 201);
  const statusCheck = await call('GET', `/api/services/management?date=${occupiedDate}`, { token: state.staff });
  const eventStatus = statusCheck.data.services.find((service) => service.code === 'event');
  assert.equal(eventStatus.availability.status, 'Fully booked');
  assert.equal(eventStatus.availability.slots.find((slot) => slot.value === '07:00').available, false);
  assert.equal(eventStatus.availability.slots.find((slot) => slot.value === '08:00').available, false);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(occupiedBooking.data.id);
  const partialBooking = await call('POST', '/api/reservations', {
    body: {
      guestName: 'Partial Availability Test',
      guestEmail: 'partial-availability-test@test.com',
      room: 'regular',
      checkIn: occupiedDate,
      checkOut: addDays(occupiedDate, 1),
      guests: 2,
    },
  });
  assert.equal(partialBooking.status, 201);
  const partialStatus = await call('GET', `/api/services/management?date=${occupiedDate}`, { token: state.staff });
  const regularStatus = partialStatus.data.services.find((service) => service.code === 'regular');
  assert.equal(regularStatus.availability.status, 'Partially booked');
  assert.equal(regularStatus.availability.availableUnits, 5);
  const blockedDelete = await call('DELETE', '/api/services/regular', { token: state.admin });
  assert.equal(blockedDelete.status, 409);
  assert.ok(blockedDelete.data.details.bookings.some((booking) => booking.reference === partialBooking.data.reference));
  assert.ok(db.prepare("SELECT 1 FROM services WHERE code = 'regular'").get());
  db.prepare('DELETE FROM reservations WHERE id = ?').run(partialBooking.data.id);

  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'permission_denied' AND details LIKE '%services.create%'`).get().count, 1);
  assert.equal((await call('POST', '/api/services', { token: state.ana, body: { code: 'spa', name: 'Spa', category: 'addon', price: 5 } })).status, 403);
  assert.equal((await call('POST', '/api/services', { token: state.admin, body: { code: 'spa', name: 'Spa', category: 'addon', price: 50, unit: 'stay', pricingMode: 'stay' } })).status, 400);
  assert.equal((await call('POST', '/api/services', { token: state.admin, body: { code: 'family', name: 'Family Room', category: 'room', price: 180 } })).status, 400);
  assert.equal((await call('POST', '/api/services', {
    token: state.admin,
    body: { code: 'duplicate-room', name: 'Regular Room', category: 'room', price: 100 },
  })).status, 409);
  assert.equal((await call('POST', '/api/services', {
    token: state.admin,
    body: { code: 'untimed-hourly', name: 'Untimed Hourly', category: 'room', price: 100, durationMinutes: 60 },
  })).status, 400);
  assert.equal((await call('PATCH', '/api/services/regular', {
    token: state.admin, body: { durationMinutes: 60 },
  })).status, 400);
  const staffWriteAuditBefore = db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'permission_denied'`).get().count;
  const made = await call('POST', '/api/services', { token: state.admin, body: { code: 'spa-room', name: 'Spa Room', category: 'room', inventoryType: 'service', price: 50, unit: 'stay', pricingMode: 'stay' } });
  assert.equal(made.status, 201);
  assert.equal(made.data.pricingMode, 'stay');
  assert.equal(made.data.inventoryType, 'service');
  const hourly = await call('POST', '/api/services', {
    token: state.admin,
    body: {
      code: 'hourly-service',
      name: 'Hourly Service',
      category: 'room',
      inventoryType: 'service',
      price: 100,
      unit: 'stay',
      pricingMode: 'stay',
      durationMinutes: 60,
      sameDayCheckout: true,
    },
  });
  assert.equal(hourly.status, 201);
  assert.ok((await call('GET', `/api/services/management?date=${addDays(today(), 180)}&type=service`, { token: state.admin }))
    .data.services.find((service) => service.code === 'hourly-service').availability.slots.length > 0);
  assert.equal((await call('GET', '/api/services/hourly-service', { token: state.staff })).status, 200);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'service_created' AND details LIKE '%spa-room%'`).get().count, 1);
  assert.equal((await call('POST', '/api/services', { token: state.admin, body: { code: 'spa-room', name: 'Spa Room', category: 'room', price: 50 } })).status, 409);
  const patched = await call('PATCH', '/api/services/spa-room', { token: state.admin, body: { price: 60, active: false } });
  assert.equal(patched.data.price, 60);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'service_updated' AND details LIKE '%spa-room%'`).get().count, 1);
  const priceModePatched = await call('PATCH', '/api/services/spa-room', { token: state.admin, body: { pricingMode: 'guest' } });
  assert.equal(priceModePatched.data.pricingMode, 'guest');
  assert.ok(!(await call('GET', '/api/services')).data.some((s) => s.code === 'spa-room'), 'inactive hidden from public');
  const adminServices = await call('GET', '/api/services?includeInactive=true', { token: state.admin });
  assert.ok(adminServices.data.some((s) => s.code === 'spa-room'));
  assert.ok(adminServices.data.every((service) => service.category === 'room'));
  assert.equal((await call('PATCH', '/api/services/spa-room', { token: state.admin, body: { category: 'room' } })).status, 400);
  assert.equal((await call('PATCH', '/api/services/spa-room', { token: state.admin, body: { name: 'Regular Room' } })).status, 409);
  assert.equal((await call('DELETE', '/api/services/spa-room', { token: state.admin })).status, 204);
  assert.equal(db.prepare("SELECT active FROM services WHERE code = 'spa-room'").get().active, 0);
  assert.ok((await call('GET', '/api/services?includeInactive=true', { token: state.admin })).data.some((service) => service.code === 'spa-room'));
  const deletedRow = (await call('GET', '/api/services/management?type=service', { token: state.admin })).data.services
    .find((service) => service.code === 'spa-room');
  assert.equal(deletedRow.availability.status, 'Inactive');
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'service_deleted' AND details LIKE '%spa-room%'`).get().count, 1);
  assert.equal((await call('DELETE', '/api/services/hourly-service', { token: state.admin })).status, 204);
  assert.equal((await call('PATCH', '/api/services/hourly-service', { token: state.admin, body: { active: true } })).data.active, true);
  assert.equal((await call('PATCH', '/api/services/hourly-service', { token: state.admin, body: { active: false } })).data.active, false);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'permission_denied'`).get().count, staffWriteAuditBefore);

  assert.deepEqual((await call('GET', '/api/services/luxury/photos')).data.photos, []);
  assert.equal((await call('POST', '/api/services/luxury/photos', { token: state.ana, form: new FormData() })).status, 403);
  const cover = await uploadListingPhoto(state.staff, 'luxury', 'Luxury room cover');
  const second = await uploadListingPhoto(state.admin, 'luxury', 'Luxury room detail');
  assert.equal(cover.status, 403);
  assert.equal(second.status, 201);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'service_photo_created' AND details LIKE '%luxury%'`).get().count, 1);
  const gallery = await call('GET', '/api/services/luxury/photos');
  assert.deepEqual(gallery.data.photos.map((photo) => photo.alt), ['Luxury room detail']);
  const publicLuxury = (await call('GET', '/api/services')).data.find((service) => service.code === 'luxury');
  assert.equal(publicLuxury.coverPhotoId, second.data.photo.id);
  assert.equal((await call('GET', gallery.data.photos[0].url)).status, 200);
  assert.equal((await call('PATCH', `/api/services/luxury/photos/${second.data.photo.id}`, {
    token: state.staff, body: { alt: 'Updated detail', sortOrder: 1 },
  })).status, 403);
  assert.equal((await call('DELETE', `/api/services/luxury/photos/${second.data.photo.id}`, { token: state.staff })).status, 403);
  const updatedPhoto = await call('PATCH', `/api/services/luxury/photos/${second.data.photo.id}`, {
    token: state.admin, body: { alt: 'Updated detail', sortOrder: 1 },
  });
  assert.equal(updatedPhoto.status, 200);
  assert.equal(updatedPhoto.data.photo.alt, 'Updated detail');
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'service_photo_updated' AND details LIKE '%luxury%'`).get().count, 1);
  assert.equal((await call('GET', `/api/services/luxury/photos/${second.data.photo.id}/image?size=thumbnail`)).status, 200);
  assert.equal((await call('DELETE', `/api/services/luxury/photos/${second.data.photo.id}`, { token: state.staff })).status, 403);
  assert.equal((await call('DELETE', `/api/services/luxury/photos/${second.data.photo.id}`, { token: state.admin })).status, 204);
  assert.deepEqual((await call('GET', '/api/services/luxury/photos')).data.photos, []);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM profile_audit_log
    WHERE action = 'service_photo_deleted' AND details LIKE '%luxury%'`).get().count, 1);

  assert.equal((await call('GET', '/api/profile/favorites', { token: state.ana })).status, 200);
  assert.deepEqual((await call('GET', '/api/profile/favorites', { token: state.ana })).data.favorites, []);
  assert.equal((await call('PUT', '/api/profile/favorites/luxury', { token: state.ana })).data.saved, true);
  assert.deepEqual((await call('GET', '/api/profile/favorites', { token: state.ana })).data.favorites, ['luxury']);
  assert.deepEqual((await call('GET', '/api/profile/favorites', { token: state.eve })).data.favorites, []);
  assert.equal((await call('DELETE', '/api/profile/favorites/luxury', { token: state.ana })).status, 204);
  db.prepare(`INSERT INTO services (code, name, category, price, capacity, quantity)
    VALUES ('old-addon', 'Old Add-on', 'addon', 10, 1, 1)`).run();
  seedServices();
  assert.equal(db.prepare("SELECT 1 FROM services WHERE code = 'old-addon'").get(), undefined);
});

test('availability and pricing', async () => {
  const rooms = (await call('GET', '/api/services')).data.filter((service) => ['regular', 'luxury'].includes(service.code));
  assert.equal(rooms.find((room) => room.code === 'regular').quantity, 6);
  assert.equal(rooms.find((room) => room.code === 'luxury').quantity, 6);

  const a = await call('GET', `/api/availability?room=regular&checkIn=${S.in}&checkOut=${S.out}`);
  assert.equal(a.status, 200);
  assert.equal(a.data[0].available, true);
  assert.equal(a.data[0].unitsLeft, 6);
  assert.equal(a.data[0].totalUnits, 6);
  assert.equal(a.data[0].roomTotal, 350);
  assert.equal((await call('GET', `/api/availability?room=regular&checkIn=${S.out}&checkOut=${S.in}`)).status, 400);
  assert.equal((await call('GET', '/api/availability?room=regular&checkIn=2020-01-01&checkOut=2020-01-03')).status, 400);
  assert.equal((await call('GET', `/api/availability?room=regular&checkIn=2026-02-30&checkOut=${S.out}`)).status, 400);
  assert.equal((await call('GET', `/api/availability?room=ghost&checkIn=${S.in}&checkOut=${S.out}`)).status, 404);
  assert.equal((await call('GET', '/api/availability/calendar?room=regular&month=2026-13')).status, 400);
  assert.equal((await call('GET', '/api/availability/calendar?room=ghost&month=2026-01')).status, 404);
  assert.equal((await call('GET', '/api/availability/calendar?room=regular&from=2026-01-02')).status, 400);
  assert.equal((await call('GET', '/api/availability/calendar?room=regular&from=2026-01-03&to=2026-01-02')).status, 400);
});

test('calendar availability observes occupied nights, turnover, and cancelled bookings', async () => {
  const checkIn = addDays(today(), 320);
  const checkOut = addDays(checkIn, 3);
  const reservation = await call('POST', '/api/reservations', {
    body: {
      guestName: 'Pool Availability Guest',
      guestEmail: 'pool-availability@test.com',
      room: 'pool',
      checkIn,
      checkOut,
      guests: 2,
    },
  });
  assert.equal(reservation.status, 201);

  const calendarUrl = `/api/availability/calendar?room=pool&from=${checkIn}&to=${checkOut}`;
  const calendar = await call('GET', calendarUrl);
  assert.equal(calendar.status, 200);
  assert.deepEqual(calendar.data.unavailableDates, [checkIn, addDays(checkIn, 1), addDays(checkIn, 2)]);

  for (const [arrival, departure] of [
    [checkIn, checkOut],
    [addDays(checkIn, -1), addDays(checkOut, -1)],
    [addDays(checkIn, 2), addDays(checkOut, 1)],
  ]) {
    const overlapping = await call('POST', '/api/reservations', {
      body: {
        guestName: 'Overlap Guest',
        guestEmail: `pool-overlap-${arrival}@test.com`,
        room: 'pool',
        checkIn: arrival,
        checkOut: departure,
        guests: 2,
      },
    });
    assert.equal(overlapping.status, 409);
  }

  const turnover = await call('POST', '/api/reservations', {
    body: {
      guestName: 'Turnover Guest',
      guestEmail: 'pool-turnover@test.com',
      room: 'pool',
      checkIn: checkOut,
      checkOut: addDays(checkOut, 2),
      guests: 2,
    },
  });
  assert.equal(turnover.status, 201);
  assert.ok((await call('GET', calendarUrl)).data.unavailableDates.includes(checkOut));

  for (const booking of [reservation.data, turnover.data]) {
    assert.equal((await call('PATCH', `/api/reservations/${booking.id}/status`, {
      token: state.staff, body: { status: 'Cancelled' },
    })).status, 200);
  }
  assert.deepEqual((await call('GET', calendarUrl)).data.unavailableDates, []);
  const datesFreed = await call('POST', '/api/reservations', {
    body: {
      guestName: 'After Cancellation Guest',
      guestEmail: 'pool-after-cancel@test.com',
      room: 'pool',
      checkIn,
      checkOut,
      guests: 2,
    },
  });
  assert.equal(datesFreed.status, 201);
});

test('concurrent reservation requests cannot overbook a single-unit room', async () => {
  const checkIn = addDays(today(), 340);
  const body = {
    room: 'pool',
    checkIn,
    checkOut: addDays(checkIn, 2),
    guests: 2,
  };
  const results = await Promise.all(['one', 'two'].map((suffix) => call('POST', '/api/reservations', {
    body: { ...body, guestName: `Concurrent ${suffix}`, guestEmail: `concurrent-${suffix}@test.com` },
  })));
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
});

test('regular and luxury room availability updates as bookings are made', async () => {
  const checkIn = addDays(today(), 60);
  const checkOut = addDays(checkIn, 2);
  for (const room of ['regular', 'luxury']) {
    for (let booked = 0; booked < 6; booked += 1) {
      const availability = await call('GET', `/api/availability?room=${room}&checkIn=${checkIn}&checkOut=${checkOut}`);
      assert.equal(availability.data[0].unitsLeft, 6 - booked);
      const booking = await call('POST', '/api/reservations', {
        body: {
          guestName: `Inventory Guest ${room} ${booked}`,
          guestEmail: `inventory-${room}-${booked}@test.com`,
          room,
          checkIn,
          checkOut,
          guests: 1,
        },
      });
      assert.equal(booking.status, 201);
    }
    const full = await call('GET', `/api/availability?room=${room}&checkIn=${checkIn}&checkOut=${checkOut}`);
    assert.equal(full.data[0].available, false);
    assert.equal(full.data[0].unitsLeft, 0);
    const calendar = await call('GET', `/api/availability/calendar?room=${room}&month=${checkIn.slice(0, 7)}`);
    assert.equal(calendar.status, 200);
    assert.ok(calendar.data.unavailableDates.includes(checkIn));
    assert.equal((await call('POST', '/api/reservations', {
      body: { guestName: 'Extra Guest', guestEmail: `extra-${room}@test.com`, room, checkIn, checkOut, guests: 1 },
    })).status, 409);
  }
});

test('villa, pool, and event availability respects whole-villa bookings', async () => {
  const checkIn = addDays(today(), 100);
  const checkOut = addDays(checkIn, 1);
  const poolCheckOut = addDays(checkIn, 3);
  const query = `/api/availability?checkIn=${checkIn}&checkOut=${checkOut}`;
  const catalog = (await call('GET', '/api/services')).data;
  for (const code of ['entire-villa', 'pool', 'event']) {
    assert.equal(catalog.find((service) => service.code === code)?.quantity, 1);
    const availability = await call('GET', `${query}&room=${code}`);
    assert.equal(availability.data[0].unitsLeft, 1);
  }

  const poolBooking = await call('POST', '/api/reservations', {
    body: { guestName: 'Pool Guest', guestEmail: 'pool@test.com', room: 'pool', checkIn, checkOut: poolCheckOut, guests: 2 },
  });
  assert.equal(poolBooking.status, 201);
  assert.equal(poolBooking.data.total, 600);
  assert.equal(poolBooking.data.roomTotal, 600);
  assert.equal(poolBooking.data.roomPrice, 300);
  assert.equal(poolBooking.data.nights, 3);
  assert.equal((await call('GET', `/api/availability?room=pool&checkIn=${checkIn}&checkOut=${poolCheckOut}`)).data[0].unitsLeft, 0);
  assert.equal((await call('GET', `${query}&room=regular`)).data[0].unitsLeft, 6);
  assert.equal((await call('GET', `${query}&room=entire-villa`)).data[0].unitsLeft, 0);

  const eventBooking = await call('POST', '/api/reservations', {
    body: { guestName: 'Event Guest', guestEmail: 'event@test.com', room: 'event', checkIn, checkOut: checkIn, preferredTime: '07:00', guests: 50 },
  });
  assert.equal(eventBooking.status, 201);
  assert.equal(eventBooking.data.total, 10000);
  assert.equal((await call('POST', '/api/reservations', {
    body: { guestName: 'Long Event Guest', guestEmail: 'long-event@test.com', room: 'event', checkIn, checkOut: addDays(checkIn, 2), guests: 50 },
  })).status, 400);
  assert.equal((await call('GET', `${query}&room=event`)).data[0].unitsLeft, 0);
  assert.equal((await call('POST', '/api/reservations', {
    body: { guestName: 'Villa Guest', guestEmail: 'villa-blocked@test.com', room: 'entire-villa', checkIn, checkOut: checkIn, preferredTime: '07:00', guests: 4 },
  })).status, 409);

  for (const booking of [poolBooking.data, eventBooking.data]) {
    assert.equal((await call('PATCH', `/api/reservations/${booking.id}/status`, {
      token: state.staff, body: { status: 'Cancelled' },
    })).status, 200);
  }
  assert.equal((await call('GET', `${query}&room=entire-villa`)).data[0].unitsLeft, 1);

  const villaBooking = await call('POST', '/api/reservations', {
    body: { guestName: 'Villa Guest', guestEmail: 'villa@test.com', room: 'entire-villa', checkIn, checkOut: checkIn, preferredTime: '07:00', guests: 4 },
  });
  assert.equal(villaBooking.status, 201);
  assert.equal(villaBooking.data.total, 15000);
  for (const code of ['entire-villa', 'pool', 'event', 'regular', 'luxury']) {
    assert.equal((await call('GET', `${query}&room=${code}`)).data[0].unitsLeft, 0);
  }
  assert.equal((await call('GET', `${query}&room=family`)).status, 404);
  assert.equal((await call('POST', '/api/reservations', {
    body: { guestName: 'Pool Guest', guestEmail: 'pool-blocked@test.com', room: 'pool', checkIn, checkOut, guests: 2 },
  })).status, 409);
});

test('reservations: create, price on the server, capacity, inventory', async () => {
  const body = { guestName: 'Ben', guestEmail: 'ben@test.com', room: 'regular', checkIn: S.in, preferredTime: '14:00', checkOut: S.out, guests: 2, total: 1 };
  const r = await call('POST', '/api/reservations', { body });
  assert.equal(r.status, 201);
  assert.equal(r.data.preferredTime, '14:00');
  assert.equal(r.data.total, 350); // client-sent "total" ignored
  assert.equal(r.data.roomPrice, 350);
  assert.equal(r.data.roomUnit, 'stay');
  assert.equal(r.data.roomTotal, 350);
  assert.equal(r.data.nights, 3);
  assert.deepEqual(r.data.addons, []);
  assert.equal(r.data.status, 'Pending');
  assert.match(r.data.reference, /^VT-[A-Z2-9]{10}$/);
  state.anon = r.data;

  const guestRecord = db.prepare('SELECT * FROM users WHERE email = ?').get('ben@test.com');
  assert.ok(guestRecord);
  assert.equal(guestRecord.role, 'guest');
  assert.equal(guestRecord.login_enabled, 0);
  assert.equal(db.prepare('SELECT user_id FROM reservations WHERE id = ?').get(r.data.id).user_id, null);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'ben@test.com', password: 'password1' } })).status, 401);
  const listedGuests = await call('GET', '/api/users?role=guest', { token: state.admin });
  assert.equal(listedGuests.data.find((user) => user.email === 'ben@test.com').loginEnabled, false);

  const registeredGuest = await call('POST', '/api/auth/register', { body: { name: 'Ben Guest', email: 'ben@test.com', password: 'password1' } });
  assert.equal(registeredGuest.status, 201);
  assert.equal(registeredGuest.data.user.loginEnabled, true);
  assert.equal((await call('GET', '/api/reservations', { token: registeredGuest.data.token })).data.length, 0);

  const mine = await call('POST', '/api/reservations', { token: state.ana, body: { room: 'regular', checkIn: S.in, checkOut: S.out, guests: 1 } });
  assert.equal(mine.status, 201);
  assert.equal(mine.data.guestEmail, 'ana@test.com'); // defaults from the account
  assert.equal(mine.data.guestName, 'Ana');
  assert.match(mine.data.reference, /^VT-[A-Z2-9]{10}$/);
  assert.equal(mine.data.paymentStatus, 'Unpaid');
  const duplicate = await call('POST', '/api/reservations', {
    token: state.ana,
    body: {
      guestName: 'Different Person',
      guestEmail: 'someone-else@test.com',
      room: 'luxury',
      checkIn: addDays(S.in, 1),
      checkOut: addDays(S.out, 1),
      guests: 1,
    },
  });
  assert.equal(duplicate.status, 409);
  const myBookings = await call('GET', '/api/reservations', { token: state.ana });
  assert.equal(myBookings.data.length, 1);
  assert.equal(myBookings.data[0].reference, mine.data.reference);
  assert.equal(myBookings.data[0].balance, mine.data.total);
  state.mine = mine.data;

  assert.equal((await call('POST', '/api/reservations', { body: { ...body, guests: 5 } })).status, 400);
  assert.equal((await call('POST', '/api/reservations', { body: { ...body, addons: [{ code: 'breakfast' }] } })).status, 400);
  assert.equal((await call('POST', '/api/reservations', { body: { ...body, checkIn: '2020-01-01', checkOut: '2020-01-02' } })).status, 400);
  assert.equal((await call('POST', '/api/reservations', { body: { ...body, guestEmail: 'not-an-email' } })).status, 400);
  assert.equal((await call('POST', '/api/reservations', { body: { ...body, preferredTime: '25:90' } })).status, 400);
  assert.equal((await call('POST', '/api/reservations', { body: { ...body, preferredTime: '14:30' } })).status, 400);
  assert.equal((await call('POST', '/api/reservations', { body: { room: 'regular', checkIn: S.in, checkOut: S.out, guests: 1 } })).status, 400); // no name/email
  assert.equal((await call('POST', '/api/reservations', { body: { ...body, room: 'family' } })).status, 404);
});

test('arrival time choices are whole hours and disable hours already passed today', async () => {
  const future = await call('GET', `/api/reservations/arrival-times?date=${addDays(today(), 1)}`);
  assert.equal(future.status, 200);
  assert.equal(future.data.options.length, 24);
  assert.equal(future.data.options[0].value, '00:00');
  assert.equal(future.data.options[0].label, '12:00 AM');
  assert.equal(future.data.options[23].value, '23:00');
  assert.equal(future.data.options[23].label, '11:00 PM');
  assert.ok(future.data.options.every((option) => /^\d{2}:00$/.test(option.value) && option.available));

  const currentDate = await call('GET', `/api/reservations/arrival-times?date=${today()}`);
  assert.equal(currentDate.status, 200);
  const currentHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: require('../config').timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date()));
  assert.ok(currentDate.data.options.filter((option) => Number(option.value.slice(0, 2)) < currentHour).every((option) => !option.available));
});

test('same-day services calculate 12-hour checkout, enforce the cutoff, and retain other service rules', async () => {
  const { dateInTimezone, timeInTimezone } = require('../lib/util');
  const { requestedSameDayInterval } = require('../lib/reservations');
  const [exampleStart, exampleEnd] = requestedSameDayInterval('2026-11-09', '07:00', 720);
  assert.equal(dateInTimezone(exampleStart), '2026-11-09');
  assert.equal(timeInTimezone(exampleStart), '07:00');
  assert.equal(dateInTimezone(exampleEnd), '2026-11-09');
  assert.equal(timeInTimezone(exampleEnd), '19:00');

  const services = (await call('GET', '/api/services')).data;
  for (const code of ['event', 'entire-villa']) {
    const service = services.find((item) => item.code === code);
    assert.equal(service.durationMinutes, 720);
    assert.equal(service.sameDayCheckout, true);
  }
  assert.equal(services.find((item) => item.code === 'regular').sameDayCheckout, false);

  const date = addDays(today(), 150);
  const options = await call('GET', `/api/reservations/arrival-times?date=${date}&room=event`);
  assert.equal(options.status, 200);
  assert.equal(options.data.options.at(-1).value, '11:00');
  assert.ok(!options.data.options.some((option) => option.value === '12:00'));

  const booking = await call('POST', '/api/reservations', {
    body: { guestName: 'Same Day Event', guestEmail: 'same-day-event@test.com', room: 'event', checkIn: date, checkOut: date, checkOutTime: '01:00', endDateTime: '2027-01-01T00:00:00Z', preferredTime: '07:00', guests: 20 },
  });
  assert.equal(booking.status, 201);
  assert.equal(booking.data.checkIn, date);
  assert.equal(booking.data.checkOut, date);
  assert.equal(booking.data.preferredTime, '07:00');
  assert.equal(booking.data.checkOutTime, '19:00');
  assert.equal(booking.data.durationMinutes, 720);
  const stored = db.prepare('SELECT start_datetime, end_datetime FROM reservations WHERE id = ?').get(booking.data.id);
  assert.equal(dateInTimezone(stored.start_datetime), date);
  assert.equal(timeInTimezone(stored.start_datetime), '07:00');
  assert.equal(dateInTimezone(stored.end_datetime), date);
  assert.equal(timeInTimezone(stored.end_datetime), '19:00');

  const villaDate = addDays(date, 8);
  const villa = await call('POST', '/api/reservations', {
    body: { guestName: 'Same Day Villa', guestEmail: 'same-day-villa@test.com', room: 'entire-villa', checkIn: villaDate, checkOut: villaDate, preferredTime: '07:00', guests: 4 },
  });
  assert.equal(villa.status, 201);
  assert.equal(villa.data.checkIn, villaDate);
  assert.equal(villa.data.checkOut, villaDate);
  assert.equal(villa.data.checkOutTime, '19:00');
  assert.equal(villa.data.durationMinutes, 720);

  const latestDate = addDays(date, 1);
  const latest = await call('POST', '/api/reservations', {
    body: { guestName: 'Latest Event', guestEmail: 'latest-event@test.com', room: 'event', checkIn: latestDate, checkOut: latestDate, preferredTime: '11:00', guests: 20 },
  });
  assert.equal(latest.status, 201);
  assert.equal(latest.data.checkOutTime, '23:00');
  assert.equal(dateInTimezone(latest.data.endDateTime), latestDate);
  assert.equal((await call('POST', '/api/reservations', {
    body: { guestName: 'Late Event', guestEmail: 'late-event@test.com', room: 'event', checkIn: addDays(date, 2), checkOut: addDays(date, 2), preferredTime: '12:00', guests: 20 },
  })).status, 400);
  assert.equal((await call('POST', '/api/reservations', {
    body: { guestName: 'Tampered Event', guestEmail: 'tampered-event@test.com', room: 'event', checkIn: addDays(date, 3), checkOut: addDays(date, 4), preferredTime: '07:00', guests: 20 },
  })).status, 400);

  const regularDate = addDays(date, 5);
  const regular = await call('POST', '/api/reservations', {
    body: { guestName: 'Other Service', guestEmail: 'other-service@test.com', room: 'regular', checkIn: regularDate, checkOut: addDays(regularDate, 1), guests: 2 },
  });
  assert.equal(regular.status, 201);
  assert.equal(regular.data.checkOut, addDays(regularDate, 1));
  assert.equal(regular.data.sameDayCheckout, false);

  const rescheduleDate = addDays(date, 10);
  const guestBooking = await call('POST', '/api/reservations', {
    token: state.ana,
    body: { room: 'event', checkIn: rescheduleDate, checkOut: rescheduleDate, preferredTime: '07:00', guests: 2 },
  });
  assert.equal(guestBooking.status, 201);
  const nextDate = addDays(rescheduleDate, 1);
  const tamperedReschedule = await call('POST', `/api/reservations/${guestBooking.data.id}/change-requests`, {
    token: state.ana,
    body: { type: 'reschedule', checkIn: nextDate, checkOut: addDays(nextDate, 1), preferredTime: '07:00' },
  });
  assert.equal(tamperedReschedule.status, 400);
  const availableDates = await call('GET', `/api/reservations/${guestBooking.data.id}/available-dates?from=${nextDate}&to=${nextDate}`, { token: state.ana });
  assert.equal(availableDates.status, 200);
  assert.ok(availableDates.data.availableDates[0].options.some((option) => option.value === '11:00' && option.available));
  const reschedule = await call('POST', `/api/reservations/${guestBooking.data.id}/change-requests`, {
    token: state.ana,
    body: { type: 'reschedule', checkIn: nextDate, checkOut: nextDate, preferredTime: '11:00' },
  });
  assert.equal(reschedule.status, 201);
  const approved = await call('PATCH', `/api/messages/${reschedule.data.conversationId}/change-request`, {
    token: state.staff, body: { decision: 'Approved' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.reservation.checkIn, nextDate);
  assert.equal(approved.data.reservation.checkOut, nextDate);
  assert.equal(approved.data.reservation.preferredTime, '11:00');
  assert.equal(approved.data.reservation.checkOutTime, '23:00');
  assert.match((await call('GET', `/api/messages/${reschedule.data.conversationId}`, { token: state.ana })).data.messages.at(-1).body, /23:00/);

  const concurrentDate = addDays(date, 20);
  const concurrentRequests = await Promise.all(['first', 'second'].map((suffix) => call('POST', '/api/reservations', {
    body: { guestName: suffix, guestEmail: `${suffix}-same-day@test.com`, room: 'event', checkIn: concurrentDate, checkOut: concurrentDate, preferredTime: '07:00', guests: 2 },
  })));
  assert.deepEqual(concurrentRequests.map((result) => result.status).sort(), [201, 409]);
  const calendar = await call('GET', `/api/availability/calendar?room=event&month=${concurrentDate.slice(0, 7)}`);
  assert.ok(calendar.data.unavailableDates.includes(concurrentDate));
});

test('staff can record a walk-in without linking it to the staff account', async () => {
  const checkIn = addDays(today(), 300);
  const result = await call('POST', '/api/reservations/walk-in', {
    token: state.staff,
    body: {
      guestName: 'Walk-in Customer',
      guestEmail: 'walk-in-customer@test.com',
      room: 'luxury',
      checkIn,
      checkOut: addDays(checkIn, 1),
      guests: 2,
    },
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.bookingType, 'Walk-in');
  assert.equal(result.data.status, 'Checked-in');
  assert.equal(db.prepare('SELECT user_id FROM reservations WHERE id = ?').get(result.data.id).user_id, null);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE email = ?').get('walk-in-customer@test.com'), undefined);
  assert.equal((await call('POST', '/api/reservations/walk-in', {
    token: state.ana,
    body: { guestName: 'Guest', guestEmail: 'guest@test.com', room: 'regular', checkIn, checkOut: addDays(checkIn, 1), guests: 1 },
  })).status, 403);
});

test('customer walk-in bookings do not require online payment', async () => {
  const checkIn = addDays(today(), 280);
  const created = await call('POST', '/api/reservations', {
    body: {
      guestName: 'Walk-in Online',
      guestEmail: 'walk-in-online@test.com',
      room: 'luxury',
      checkIn,
      checkOut: addDays(checkIn, 1),
      guests: 2,
      bookingType: 'Walk-in',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.bookingType, 'Walk-in');
  assert.equal(created.data.status, 'Pending');
  assert.equal(created.data.paymentDueAt, null);
  const holdAvailabilityUrl = `/api/availability?room=luxury&checkIn=${checkIn}&checkOut=${addDays(checkIn, 1)}`;
  assert.equal((await call('GET', holdAvailabilityUrl)).data[0].unitsLeft, 5);

  const paymentIntent = await call('POST', `/api/reservations/${created.data.reference}/payment-intent`, {
    body: { method: 'ewallet' },
  });
  assert.equal(paymentIntent.status, 409);
  const activeBooking = await call('GET', `/api/reservations/${created.data.reference}`);
  assert.equal(activeBooking.data.status, 'Pending');
  assert.equal((await call('GET', holdAvailabilityUrl)).data[0].unitsLeft, 5);
  assert.equal((await call('POST', `/api/reservations/${created.data.reference}/payment-intent`, {
    body: { method: 'ewallet' },
  })).status, 409);
});

test('retiring add-on services preserves saved reservation history', async () => {
  const savedAddons = [{ code: 'breakfast', name: 'Breakfast', lineTotal: 60 }];
  db.prepare('UPDATE reservations SET addons = ? WHERE id = ?').run(JSON.stringify(savedAddons), state.anon.id);
  db.prepare(`INSERT INTO services (code, name, category, price, capacity, quantity)
    VALUES ('legacy-breakfast', 'Breakfast', 'addon', 10, 1, 1)`).run();

  seedServices();

  assert.equal(db.prepare("SELECT 1 FROM services WHERE code = 'legacy-breakfast'").get(), undefined);
  assert.deepEqual(JSON.parse(db.prepare('SELECT addons FROM reservations WHERE id = ?').get(state.anon.id).addons), savedAddons);
  const reservations = await call('GET', `/api/reservations?q=${state.anon.reference}`, { token: state.staff });
  assert.deepEqual(reservations.data.find((reservation) => reservation.id === state.anon.id).addons, savedAddons);
});

test('retiring the family room preserves existing reservations', async () => {
  db.prepare(`INSERT INTO services (code, name, category, price, capacity, quantity)
    VALUES ('family', 'Family Room', 'room', 180, 6, 1)`).run();
  const checkIn = addDays(today(), 200);
  const checkOut = addDays(checkIn, 2);
  const result = db.prepare(`INSERT INTO reservations
    (reference, guest_name, guest_email, room_code, check_in, check_out, guests, total_price)
    VALUES ('VT-FAMILYHISTORY', 'Family Guest', 'family@test.com', 'family', ?, ?, 4, 360)`)
    .run(checkIn, checkOut);

  seedServices();

  assert.equal(db.prepare("SELECT active FROM services WHERE code = 'family'").get().active, 0);
  const services = await call('GET', '/api/services?includeInactive=true', { token: state.admin });
  assert.ok(!services.data.some((service) => service.code === 'family'));
  assert.equal((await call('GET', `/api/availability?room=family&checkIn=${checkIn}&checkOut=${checkOut}`)).status, 404);
  assert.equal((await call('POST', '/api/reservations', {
    body: { guestName: 'New Guest', guestEmail: 'new-family@test.com', room: 'family', checkIn, checkOut, guests: 4 },
  })).status, 404);
  const history = await call('GET', '/api/reservations/VT-FAMILYHISTORY', { token: state.staff });
  assert.equal(history.status, 200);
  assert.equal(history.data.roomName, 'Family Room');

  db.prepare('DELETE FROM reservations WHERE id = ?').run(result.lastInsertRowid);
  seedServices();
  assert.equal(db.prepare("SELECT 1 FROM services WHERE code = 'family'").get(), undefined);
});

test('reservations: lookup and listing respect privacy', async () => {
  const pub = await call('GET', `/api/reservations/${state.anon.reference.toLowerCase()}`);
  assert.equal(pub.status, 200);
  assert.match(pub.data.guestEmail, /^b\*\*\*@/);
  assert.equal(pub.data.guestPhone, undefined);
  const owner = await call('GET', `/api/reservations/${state.mine.reference}`, { token: state.ana });
  assert.equal(owner.data.guestEmail, 'ana@test.com');
  const stranger = await call('GET', `/api/reservations/${state.mine.reference}`, { token: state.eve });
  assert.equal(stranger.status, 404);
  assert.equal((await call('POST', `/api/reservations/${state.mine.reference}/payment-intent`, {
    token: state.eve, body: { method: 'ewallet' },
  })).status, 404);
  assert.equal((await call('GET', '/api/reservations/VT-DOESNOTEXIST')).status, 404);

  assert.equal((await call('GET', '/api/reservations')).status, 401);
  const anaList = await call('GET', '/api/reservations', { token: state.ana });
  assert.equal(anaList.data.length, 2);
  assert.equal((await call('GET', '/api/reservations', { token: state.eve })).data.length, 0);
  const all = await call('GET', '/api/reservations', { token: state.staff });
  assert.ok(all.data.length >= 4);
  assert.deepEqual(
    all.data.map((reservation) => reservation.checkIn),
    [...all.data.map((reservation) => reservation.checkIn)].sort(),
  );
  assert.equal((await call('GET', '/api/reservations?q=ben', { token: state.staff })).data.length, 1);
});

test('rescheduling exposes only available dates and change requests close 72 hours before arrival', async () => {
  const search = await call('GET', `/api/reservations/${state.mine.id}/available-dates?from=${S.in}&to=${S.in}`, { token: state.ana });
  assert.equal(search.status, 200);
  assert.deepEqual(search.data.availableDates, [{ checkIn: S.in, checkOut: S.out }]);

  db.prepare('UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?')
    .run(addDays(today(), 2), addDays(today(), 5), state.mine.id);
  try {
    const unavailable = await call('GET', `/api/reservations/${state.mine.id}/available-dates?from=${addDays(today(), 5)}&to=${addDays(today(), 10)}`, { token: state.ana });
    assert.equal(unavailable.status, 409);
    const request = await call('POST', `/api/reservations/${state.mine.id}/change-requests`, {
      token: state.ana,
      body: { type: 'cancellation', reason: 'Change of plans' },
    });
    assert.equal(request.status, 409);
  } finally {
    db.prepare('UPDATE reservations SET check_in = ?, check_out = ? WHERE id = ?').run(S.in, S.out, state.mine.id);
  }
});

test('guests can request booking changes for staff review', async () => {
  const cancellation = await call('POST', `/api/reservations/${state.mine.id}/change-requests`, {
    token: state.ana,
    body: { type: 'cancellation', reason: 'Change of plans', note: 'Plans changed.' },
  });
  assert.equal(cancellation.status, 201);
  assert.match(cancellation.data.subject, new RegExp(state.mine.reference));
  const cancelConversation = await call('GET', `/api/messages/${cancellation.data.conversationId}`, { token: state.admin });
  assert.equal(cancelConversation.status, 200);
  assert.match(cancelConversation.data.messages[0].body, /Request: Cancellation/);
  assert.match(cancelConversation.data.messages[0].body, /Reason: Change of plans/);
  assert.equal(cancelConversation.data.changeRequest.type, 'cancellation');
  assert.equal(cancelConversation.data.changeRequest.status, 'Pending');
  assert.equal((await call('GET', `/api/reservations/${state.mine.reference}`, { token: state.ana })).data.status, 'Pending');
  assert.equal((await call('PATCH', `/api/messages/${cancellation.data.conversationId}/change-request`, {
    token: state.ana, body: { decision: 'Approved' },
  })).status, 403);
  const declined = await call('PATCH', `/api/messages/${cancellation.data.conversationId}/change-request`, {
    token: state.staff, body: { decision: 'Declined', note: 'Please contact us to discuss other dates.' },
  });
  assert.equal(declined.data.changeRequest.status, 'Declined');
  assert.equal((await call('GET', `/api/reservations/${state.mine.reference}`, { token: state.ana })).data.status, 'Pending');
  assert.match((await call('GET', `/api/messages/${cancellation.data.conversationId}`, { token: state.ana })).data.messages.at(-1).body, /was not approved/);
  assert.equal((await call('PATCH', `/api/messages/${cancellation.data.conversationId}/change-request`, {
    token: state.staff, body: { decision: 'Approved' },
  })).status, 409);

  const intent = await call('POST', `/api/reservations/${state.mine.reference}/payment-intent`, { body: { method: 'bank' } });
  assert.equal(intent.status, 201);
  const reschedule = await call('POST', `/api/reservations/${state.mine.id}/change-requests`, {
    token: state.ana,
    body: { type: 'reschedule', checkIn: addDays(S.in, 5), checkOut: addDays(S.out, 5) },
  });
  assert.equal(reschedule.status, 201);
  const rescheduleConversation = await call('GET', `/api/messages/${reschedule.data.conversationId}`, { token: state.admin });
  assert.match(rescheduleConversation.data.messages[0].body, new RegExp(`Requested check-in: ${addDays(S.in, 5)}`));
  assert.equal(rescheduleConversation.data.changeRequest.requestedTotal, state.mine.total);
  const approvedReschedule = await call('PATCH', `/api/messages/${reschedule.data.conversationId}/change-request`, {
    token: state.admin, body: { decision: 'Approved' },
  });
  assert.equal(approvedReschedule.status, 200);
  assert.equal(approvedReschedule.data.changeRequest.status, 'Approved');
  assert.equal(approvedReschedule.data.reservation.checkIn, addDays(S.in, 5));
  assert.equal(approvedReschedule.data.reservation.checkOut, addDays(S.out, 5));
  assert.equal(db.prepare('SELECT status FROM payments WHERE id = ?').get(intent.data.payment.id).status, 'Failed');
  const replacementIntent = await call('POST', `/api/reservations/${state.mine.reference}/payment-intent`, { body: { method: 'bank' } });
  assert.equal(replacementIntent.status, 201);
  assert.notEqual(replacementIntent.data.payment.id, intent.data.payment.id);
  assert.equal((await call('PATCH', `/api/payments/${replacementIntent.data.payment.id}/status`, {
    token: state.admin, body: { status: 'Failed' },
  })).status, 200);
  assert.match((await call('GET', `/api/messages/${reschedule.data.conversationId}`, { token: state.ana })).data.messages.at(-1).body, /Your reschedule request was approved/);

  const pricedBooking = await call('POST', '/api/reservations', {
    token: state.ana,
    body: { room: 'luxury', checkIn: addDays(today(), 80), checkOut: addDays(today(), 81), guests: 1 },
  });
  const pricedRequest = await call('POST', `/api/reservations/${pricedBooking.data.id}/change-requests`, {
    token: state.ana,
    body: { type: 'reschedule', checkIn: addDays(today(), 84), checkOut: addDays(today(), 86) },
  });
  const pricedDecision = await call('PATCH', `/api/messages/${pricedRequest.data.conversationId}/change-request`, {
    token: state.admin, body: { decision: 'Approved' },
  });
  assert.equal(pricedDecision.data.reservation.total, 2400);

  const blockedBooking = await call('POST', '/api/reservations', {
    token: state.ana,
    body: { room: 'luxury', checkIn: addDays(today(), 59), checkOut: addDays(today(), 60), guests: 1 },
  });
  const blockedRequest = await call('POST', `/api/reservations/${blockedBooking.data.id}/change-requests`, {
    token: state.ana,
    body: { type: 'reschedule', checkIn: addDays(today(), 60), checkOut: addDays(today(), 61) },
  });
  assert.equal(blockedRequest.status, 409);
  assert.match(blockedRequest.data.error, /no longer available/);
  assert.equal((await call('GET', `/api/reservations/${blockedBooking.data.reference}`, { token: state.ana })).data.checkIn, addDays(today(), 59));

  const cancelIn = addDays(today(), 50);
  const cancelOut = addDays(cancelIn, 2);
  const cancellable = await call('POST', '/api/reservations', {
    token: state.ana, body: { room: 'regular', checkIn: cancelIn, checkOut: cancelOut, guests: 1 },
  });
  const cancellationIntent = await call('POST', `/api/reservations/${cancellable.data.reference}/payment-intent`, {
    body: { method: 'ewallet' },
  });
  const approvedCancellation = await call('POST', `/api/reservations/${cancellable.data.id}/change-requests`, {
    token: state.ana, body: { type: 'cancellation', reason: 'Other' },
  });
  const cancellationDecision = await call('PATCH', `/api/messages/${approvedCancellation.data.conversationId}/change-request`, {
    token: state.staff, body: { decision: 'Approved' },
  });
  assert.equal(cancellationDecision.status, 200);
  assert.equal(cancellationDecision.data.reservation.status, 'Cancelled');
  assert.equal(db.prepare('SELECT status FROM payments WHERE id = ?').get(cancellationIntent.data.payment.id).status, 'Failed');
  assert.match((await call('GET', `/api/messages/${approvedCancellation.data.conversationId}`, { token: state.ana })).data.messages.at(-1).body, /has been cancelled/);

  assert.equal((await call('POST', `/api/reservations/${state.mine.id}/change-requests`, {
    token: state.eve, body: { type: 'cancellation', reason: 'Other' },
  })).status, 404);
  assert.equal((await call('POST', `/api/reservations/${state.mine.id}/change-requests`, {
    token: state.admin, body: { type: 'cancellation', reason: 'Other' },
  })).status, 403);
  assert.equal((await call('POST', `/api/reservations/${state.mine.id}/change-requests`, {
    token: state.ana, body: { type: 'reschedule', checkIn: 'not-a-date', checkOut: addDays(S.out, 5) },
  })).status, 400);
  assert.equal((await call('POST', `/api/reservations/${state.mine.id}/change-requests`, {
    token: state.ana, body: { type: 'reschedule', checkIn: addDays(S.in, 5), checkOut: addDays(S.out, 5) },
  })).status, 400);
});

test('reservation status workflow', async () => {
  const id = state.anon.id;
  assert.equal((await call('PATCH', `/api/reservations/${id}/status`, { token: state.ana, body: { status: 'Confirmed' } })).status, 403);
  assert.equal((await call('PATCH', `/api/reservations/${id}/status`, { token: state.staff, body: { status: 'Completed' } })).status, 409);
  assert.equal((await call('PATCH', `/api/reservations/${id}/status`, { token: state.staff, body: { status: 'Bogus' } })).status, 400);
  assert.equal((await call('PATCH', `/api/reservations/${id}/status`, { token: state.staff, body: { status: 'Confirmed' } })).data.status, 'Confirmed');
  assert.equal((await call('PATCH', '/api/reservations/99999/status', { token: state.staff, body: { status: 'Confirmed' } })).status, 404);

});

test('payments: pending intents, admin reconciliation', async () => {
  const ref = state.anon.reference, total = state.anon.total;
  assert.equal((await call('POST', `/api/reservations/${ref}/payment-intent`, { body: { method: 'ewallet', cardNumber: '4242424242424242' } })).status, 400);
  assert.equal((await call('POST', `/api/reservations/${ref}/payment-intent`, { body: { method: 'bitcoin' } })).status, 400);
  const i1 = await call('POST', `/api/reservations/${ref}/payment-intent`, { body: { method: 'ewallet' } });
  assert.equal(i1.status, 201);
  assert.equal(i1.data.payment.status, 'Pending');
  assert.equal(i1.data.payment.amount, total);
  assert.equal(i1.data.instructions, 'Send to 0900-000-0000');
  assert.equal((await call('POST', `/api/reservations/${ref}/payment-intent`, { body: { method: 'ewallet' } })).status, 200); // repeat is idempotent
  const i2 = await call('POST', `/api/reservations/${ref}/payment-intent`, { body: { method: 'bank' } });
  assert.equal((await call('GET', `/api/reservations/${ref}`)).data.paymentStatus, 'Unpaid'); // an intent confirms nothing

  assert.equal((await call('GET', '/api/payments', { token: state.staff })).status, 403);
  assert.equal((await call('PATCH', `/api/payments/${i1.data.payment.id}/status`, { token: state.staff, body: { status: 'Paid' } })).status, 403);
  assert.equal((await call('GET', '/api/payments?status=Pending', { token: state.admin })).data.length, 2);
  const paid = await call('PATCH', `/api/payments/${i1.data.payment.id}/status`, { token: state.admin, body: { status: 'Paid' } });
  assert.equal(paid.data.status, 'Paid');
  assert.ok(paid.data.paidAt);
  assert.equal((await call('PATCH', `/api/payments/${i2.data.payment.id}/status`, { token: state.admin, body: { status: 'Paid' } })).status, 409); // would overpay
  const res = (await call('GET', `/api/reservations/${ref}`)).data;
  assert.equal(res.paymentStatus, 'Paid');
  assert.equal(res.balance, 0);
  assert.equal((await call('POST', `/api/reservations/${ref}/payment-intent`, { body: { method: 'bank' } })).status, 409); // fully paid
  assert.equal((await call('PATCH', `/api/payments/${i1.data.payment.id}/status`, { token: state.admin, body: { status: 'Pending' } })).status, 409);
});

test('documents: upload, access control, download, delete', async () => {
  const rid = state.mine.id;
  assert.equal((await upload(null, rid, PNG)).status, 401);
  const up = await upload(state.ana, rid, PNG);
  assert.equal(up.status, 201);
  assert.equal(up.data.mimeType, 'image/png');
  const intent = await call('POST', `/api/reservations/${state.mine.reference}/payment-intent`, { body: { method: 'ewallet' } });
  assert.equal(intent.status, 201);
  assert.equal((await call('POST', '/api/messages/payment-proof', {
    token: state.ana, body: { reservationId: rid, documentId: up.data.id, method: 'bank' },
  })).status, 409);
  assert.equal((await call('POST', '/api/messages/payment-proof', {
    token: state.ana, body: { reservationId: rid, documentId: up.data.id, method: 'ewallet', message: 'I sent the deposit.' },
  })).status, 201);
  const withProof = await call('GET', `/api/reservations/${state.mine.reference}`);
  assert.equal(withProof.data.paymentStatus, 'Unpaid');
  assert.equal(withProof.data.paymentProofSubmitted, true);
  const inbox = await call('GET', '/api/messages', { token: state.admin });
  const proofThread = inbox.data.find((thread) => thread.subject === `Payment proof: ${state.mine.reference}`);
  assert.ok(proofThread);
  const proofConversation = await call('GET', `/api/messages/${proofThread.id}`, { token: state.admin });
  const proofAttachment = proofConversation.data.messages[0].attachments[0];
  assert.equal(proofAttachment.id, up.data.id);
  assert.equal(proofAttachment.paymentStatus, 'Pending');
  const staffConversation = await call('GET', `/api/messages/${proofThread.id}`, { token: state.staff });
  assert.equal(staffConversation.data.messages[0].attachments[0].id, up.data.id);
  assert.equal((await call('GET', `/api/messages/${proofThread.id}`, { token: state.eve })).status, 404);
  assert.equal((await call('PATCH', `/api/payments/${proofAttachment.paymentId}/status`, { token: state.staff, body: { status: 'Paid' } })).status, 403);
  assert.equal((await call('PATCH', `/api/payments/${proofAttachment.paymentId}/status`, { token: state.admin, body: { status: 'Paid' } })).data.status, 'Paid');
  const paidReservation = await call('GET', `/api/reservations/${state.mine.reference}`);
  assert.equal(paidReservation.data.paymentStatus, 'Paid');
  assert.equal(paidReservation.data.paymentProofSubmitted, false);
  const confirmed = await call('GET', `/api/messages/${proofThread.id}`, { token: state.admin });
  assert.equal(confirmed.data.messages[0].attachments[0].paymentStatus, 'Paid');
  assert.equal((await call('POST', '/api/messages/payment-proof', {
    token: state.eve, body: { reservationId: rid, documentId: up.data.id, method: 'ewallet' },
  })).status, 404);
  const fake = await upload(state.ana, rid, Buffer.from('<script>alert(1)</script>'), 'evil.png');
  assert.equal(fake.status, 400); // wrong bytes despite the .png name
  assert.equal((await upload(state.ana, rid, Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]))).status, 413);
  assert.equal((await upload(state.eve, rid, PNG)).status, 404);
  assert.equal((await upload(state.ana, state.anon.id, PNG)).status, 404); // someone else's booking

  assert.equal((await call('GET', '/api/documents', { token: state.ana })).data.length, 1);
  assert.equal((await call('GET', '/api/documents', { token: state.eve })).data.length, 0);
  assert.equal((await call('GET', '/api/documents', { token: state.staff })).data.length, 1);
  const dl = await call('GET', `/api/documents/${up.data.id}/download`, { token: state.ana });
  assert.equal(dl.status, 200);
  assert.ok(Buffer.compare(dl.data, PNG) === 0);
  assert.match(dl.headers.get('content-disposition'), /attachment/);
  assert.equal((await call('GET', `/api/documents/${up.data.id}/download`, { token: state.eve })).status, 404);
  assert.equal((await call('GET', `/api/documents/${up.data.id}/download`)).status, 401);
  assert.equal((await call('GET', `/api/documents/${up.data.id}/download`, { token: state.staff })).status, 200);

  const stored = fs.readdirSync(process.env.UPLOAD_DIR, { withFileTypes: true });
  assert.equal(stored.filter((entry) => entry.isFile()).length, 1);
  assert.equal((await call('DELETE', `/api/documents/${up.data.id}`, { token: state.eve })).status, 404);
  assert.equal((await call('DELETE', `/api/documents/${up.data.id}`, { token: state.ana })).status, 204);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR, { withFileTypes: true }).filter((entry) => entry.isFile()).length, 0);
});

test('staff and user management', async () => {
  assert.equal((await call('GET', '/api/staff', { token: state.staff })).status, 403);
  const made = await call('POST', '/api/staff', { token: state.admin, body: { name: 'Nina', email: 'nina@test.com', password: 'ninapass1' } });
  assert.equal(made.status, 201);
  assert.equal(made.data.role, 'staff');
  const ninaToken = await login('nina@test.com', 'ninapass1');
  assert.equal((await call('GET', '/api/dashboard', { token: ninaToken })).status, 200);
  assert.equal((await call('PATCH', `/api/staff/${made.data.id}`, { token: state.admin, body: { active: false } })).data.active, false);
  assert.equal((await call('GET', '/api/dashboard', { token: ninaToken })).status, 401); // old token stops working at once
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'nina@test.com', password: 'ninapass1' } })).status, 401);
  assert.equal((await call('PATCH', `/api/staff/${state.anon.id}`, { token: state.admin, body: { active: false } })).status, 404);

  const users = await call('GET', '/api/users', { token: state.admin });
  assert.ok(users.data.length >= 5);
  assert.ok(users.data.every((u) => u.passwordHash === undefined && u.password_hash === undefined));
  const me = users.data.find((u) => u.email === 'admin@test.com');
  assert.equal((await call('PATCH', `/api/users/${me.id}`, { token: state.admin, body: { role: 'guest' } })).status, 400); // no self-demotion
  const ana = users.data.find((u) => u.email === 'ana@test.com');
  assert.equal((await call('PATCH', `/api/users/${ana.id}`, { token: state.admin, body: { role: 'staff' } })).data.role, 'staff');
  assert.equal((await call('GET', '/api/dashboard', { token: state.ana })).status, 200); // role is read fresh, so her old token gains staff rights at once
  assert.equal((await call('GET', '/api/users', { token: state.ana })).status, 403); // but staff still cannot use admin routes
});

test('dashboard, reports, admin overview', async () => {
  assert.equal((await call('GET', '/api/dashboard', { token: state.eve })).status, 403);
  const d = (await call('GET', '/api/dashboard', { token: state.staff })).data;
  assert.equal(d.date, today());
  assert.ok(Array.isArray(d.pendingReservations));
  assert.equal(typeof d.pendingPayments, 'number');
  assert.equal(d.totalReservations, db.prepare('SELECT COUNT(*) AS c FROM reservations').get().c);
  assert.equal(d.guestCount, db.prepare('SELECT COUNT(DISTINCT lower(guest_email)) AS c FROM reservations WHERE guest_email IS NOT NULL').get().c);
  assert.equal(d.registeredGuests, db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'guest'").get().c);
  assert.equal(d.reservationCountsByStatus.Pending, db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE status = 'Pending'").get().c);
  assert.equal(d.arrivalsTodayCount, db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE check_in = ? AND status IN ('Pending','Confirmed')").get(today()).c);
  assert.equal(d.departuresTodayCount, db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE check_out = ? AND status IN ('Confirmed','Checked-in')").get(today()).c);
  assert.equal(d.pendingReservationsCount, db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE status = 'Pending'").get().c);
  assert.equal(d.revenue.collected, db.prepare("SELECT ROUND(COALESCE(SUM(amount),0),2) AS c FROM payments WHERE status = 'Paid'").get().c);
  assert.equal(d.revenue.bookedValue, db.prepare("SELECT ROUND(COALESCE(SUM(total_price),0),2) AS c FROM reservations WHERE status != 'Cancelled'").get().c);
  const staffOutstanding = db.prepare(`SELECT total_price - COALESCE((
    SELECT SUM(amount) FROM payments WHERE reservation_id = reservations.id AND status = 'Paid'
  ), 0) AS balance FROM reservations WHERE status != 'Cancelled'`).all()
    .reduce((sum, row) => sum + Math.max(0, row.balance), 0);
  assert.equal(d.revenue.outstanding, Math.round(staffOutstanding * 100) / 100);
  assert.equal(d.reservationCountsByStatus.Confirmed, db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE status = 'Confirmed'").get().c);

  assert.equal((await call('GET', '/api/reports', { token: state.staff })).status, 403);
  const reportFrom = addDays(today(), -1); // payment timestamps are stored in UTC
  const reportTo = addDays(today(), 30);
  const r = (await call('GET', `/api/reports?from=${reportFrom}&to=${reportTo}`, { token: state.admin })).data;
  assert.equal(r.reservations, 2); // cancelled bookings are excluded
  assert.equal(r.collected, db.prepare(`SELECT ROUND(COALESCE(SUM(amount),0),2) AS c FROM payments
    WHERE status = 'Paid' AND date(paid_at) BETWEEN ? AND ?`).get(reportFrom, reportTo).c);
  assert.equal(r.nightsSold, 6); // two three-night bookings
  const roomUnits = (await call('GET', '/api/services')).data
    .filter((service) => service.category === 'room')
    .reduce((total, service) => total + service.quantity, 0);
  const reportDays = Math.round((Date.parse(`${reportTo}T00:00:00Z`) - Date.parse(`${reportFrom}T00:00:00Z`)) / 86400000) + 1;
  assert.equal(r.occupancyPercent, Math.round((6 / (roomUnits * reportDays)) * 10000) / 100);
  const regularService = r.byRoom.find((x) => x.room === 'regular');
  assert.ok(regularService);
  assert.ok(regularService.bookedValue > 0);
  assert.ok(r.topCustomers.some((customer) => customer.email === 'ben@test.com'));
  assert.equal(typeof r.newCustomers, 'number');
  assert.ok(Array.isArray(r.dailyReservations));
  assert.equal((await call('GET', '/api/reports?from=2026-13-01', { token: state.admin })).status, 400);
  assert.equal((await call('GET', `/api/reports?from=${addDays(today(), 5)}&to=${today()}`, { token: state.admin })).status, 400);

  const o = (await call('GET', '/api/admin/overview', { token: state.admin })).data;
  assert.equal(o.revenue.collected, db.prepare("SELECT ROUND(COALESCE(SUM(amount),0),2) AS c FROM payments WHERE status = 'Paid'").get().c);
  assert.equal(o.reservations.total, db.prepare('SELECT COUNT(*) AS c FROM reservations').get().c);
  assert.equal(o.users.total, db.prepare('SELECT COUNT(*) AS c FROM users').get().c);
  assert.equal(o.users.active, db.prepare('SELECT COUNT(*) AS c FROM users WHERE active = 1').get().c);
  assert.equal(o.users.guest, db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'guest'").get().c);
  assert.equal(o.revenue.bookedValue, db.prepare("SELECT ROUND(COALESCE(SUM(total_price),0),2) AS v FROM reservations WHERE status != 'Cancelled'").get().v);
  const expectedOutstanding = db.prepare(`SELECT total_price - COALESCE((
    SELECT SUM(amount) FROM payments WHERE reservation_id = reservations.id AND status = 'Paid'
  ), 0) AS balance FROM reservations WHERE status != 'Cancelled'`).all()
    .reduce((sum, row) => sum + Math.max(0, row.balance), 0);
  assert.equal(o.revenue.outstanding, Math.round(expectedOutstanding * 100) / 100);
  assert.equal((await call('GET', '/api/admin/notifications')).status, 401);
  assert.equal((await call('GET', '/api/admin/notifications', { token: state.eve })).status, 403);
  assert.equal((await call('GET', '/api/admin/notifications', { token: state.staff })).status, 403);
  const notifications = await call('GET', '/api/admin/notifications', { token: state.admin });
  assert.equal(notifications.status, 200);
  const pendingMessagesCount = db.prepare(`SELECT COUNT(*) AS c FROM conversations c
    WHERE (SELECT m.sender_role FROM conversation_messages m
      WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) = 'guest'`).get().c;
  assert.equal(notifications.data.pendingCount,
    db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE status = 'Pending'").get().c
      + db.prepare("SELECT COUNT(*) AS c FROM payments WHERE status = 'Pending'").get().c
      + pendingMessagesCount);
  assert.equal(notifications.data.pendingReservationsCount,
    db.prepare("SELECT COUNT(*) AS c FROM reservations WHERE status = 'Pending'").get().c);
  assert.equal(notifications.data.pendingPaymentsCount,
    db.prepare("SELECT COUNT(*) AS c FROM payments WHERE status = 'Pending'").get().c);
  assert.equal(notifications.data.pendingMessagesCount, pendingMessagesCount);
  assert.ok(notifications.data.messages.every((message) => message.id && message.guestName && message.subject && message.lastMessage));
  assert.ok(notifications.data.reservations.every((reservation) => reservation.status === 'Pending'));
  assert.ok(notifications.data.payments.every((payment) => payment.id && payment.reservation && payment.guestName));
  const m = (await call('GET', '/api/admin/management', { token: state.admin })).data;
  assert.ok(Array.isArray(m.staff) && Array.isArray(m.services) && Array.isArray(m.pendingPayments));
  assert.equal((await call('GET', '/api/admin/overview', { token: state.staff })).status, 403);
});

test('weekly reports group valid bookings, fill empty weeks, and forecast only with enough history', async () => {
  assert.equal((await call('GET', '/api/reports/weekly?from=2026-01-05&to=2026-02-08', { token: state.staff })).status, 403);
  assert.equal((await call('GET', '/api/reports/weekly?from=2026-01-05&to=2026-02-08', { token: state.eve })).status, 403);

  const fixtures = [
    { reference: 'VT-WEEKLY-ROOM', room: 'regular', checkIn: '2001-01-09', status: 'Confirmed', price: 100 },
    { reference: 'VT-WEEKLY-EVENT', room: 'event', checkIn: '2001-01-10', status: 'Completed', price: 300 },
    { reference: 'VT-WEEKLY-CANCELLED', room: 'entire-villa', checkIn: '2001-01-24', status: 'Cancelled', price: 9999 },
    { reference: 'VT-WEEKLY-VILLA', room: 'entire-villa', checkIn: '2001-01-31', status: 'Confirmed', price: 500 },
    { reference: 'VT-WEEKLY-POOL', room: 'pool', checkIn: '2001-02-07', status: 'Completed', price: 200 },
  ];
  const insert = db.prepare(`INSERT INTO reservations
    (reference, guest_name, guest_email, room_code, check_in, check_out, guests, total_price, status)
    VALUES (?, 'Weekly Report Guest', 'weekly-report@test.com', ?, ?, ?, 1, ?, ?)`);
  const deleteFixtures = db.prepare("DELETE FROM reservations WHERE reference LIKE 'VT-WEEKLY-%'");
  try {
    fixtures.forEach((fixture) => insert.run(
      fixture.reference, fixture.room, fixture.checkIn, addDays(fixture.checkIn, 1), fixture.price, fixture.status,
    ));

    const url = '/api/reports/weekly?from=2001-01-08&to=2001-02-11&groupBy=category';
    const weekly = await call('GET', url, { token: state.admin });
    assert.equal(weekly.status, 200);
    assert.deepEqual(weekly.data.weeks.map((week) => week.week_start), [
      '2001-01-08', '2001-01-15', '2001-01-22', '2001-01-29', '2001-02-05',
    ]);
    assert.deepEqual(weekly.data.weeks.map((week) => week.total), [2, 0, 0, 1, 1]);
    assert.equal(weekly.data.weeks[0].categories["Regular Room"], 1);
    assert.equal(weekly.data.weeks[0].categories["Event Space"], 1);
    assert.equal(weekly.data.weeks[0].categories['Event Space'], 1);
    assert.equal(weekly.data.weeks[2].total, 0); // cancelled booking is excluded
    assert.equal(weekly.data.forecastAvailable, true);
    assert.equal(weekly.data.forecast.length, 8);
    assert.equal(weekly.data.forecast[0].total, 1);

    const revenue = await call('GET', `${url}&metric=revenue`, { token: state.admin });
    assert.equal(revenue.data.weeks[0].total, 400);
    assert.equal(revenue.data.weeks[3].categories['Entire Villa'], 500);

    const singleWeek = await call('GET', '/api/reports/weekly?from=2001-01-15&to=2001-01-21', { token: state.admin });
    assert.equal(singleWeek.data.weeks.length, 1);
    assert.equal(singleWeek.data.forecastAvailable, false);
    assert.deepEqual(singleWeek.data.forecast, []);

    const emptyWeek = await call('GET', '/api/reports/weekly?from=2001-01-15&to=2001-01-21', { token: state.admin });
    assert.equal(emptyWeek.data.weeks[0].total, 0);

    const longRange = await call('GET', '/api/reports/weekly?from=2025-01-06&to=2025-12-29', { token: state.admin });
    assert.equal(longRange.data.weeks.length, 52);
    assert.equal(longRange.data.weeks[0].total, 0);
    assert.equal(longRange.data.weeks[51].total, 0);
    assert.equal((await call('GET', '/api/reports/weekly?from=2026-02-08&to=2026-01-05', { token: state.admin })).status, 400);
    assert.equal((await call('GET', '/api/reports/weekly?from=2026-01-05&to=2026-02-08&metric=profit', { token: state.admin })).status, 400);
  } finally {
    deleteFixtures.run();
  }
});

test('malformed input does not crash the server', async () => {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: ['x'], password: {} } })).status, 400);
  assert.equal((await call('GET', '/api/reservations/%00')).status, 404);
  assert.equal((await call('PATCH', '/api/reservations/abc/status', { token: state.staff, body: { status: 'Confirmed' } })).status, 400);
});

test('auth endpoints are rate limited', async () => {
  let blocked = 0;
  for (let i = 0; i < 60; i++) if ((await call('POST', '/api/auth/login', { body: { email: 'x@test.com', password: 'wrongwrong' } })).status === 429) blocked++;
  assert.ok(blocked > 0, 'expected 429 after too many attempts');
});

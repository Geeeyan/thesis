const crypto = require('node:crypto');
const config = require('../config');

const encryptionKey = crypto.createHash('sha256').update(config.jwtSecret).digest();
const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hashRecoveryCode = (userId, code) => crypto.createHmac('sha256', config.jwtSecret).update(`${userId}:${code}`).digest('hex');

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decrypt(value) {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of text.toUpperCase().replace(/=+$/, '')) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 1_000_000).padStart(6, '0');
}

function verifyTotp(secret, code, timestamp = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  for (const offset of [-30000, 0, 30000]) {
    const expected = Buffer.from(totp(secret, timestamp + offset));
    const actual = Buffer.from(code);
    if (crypto.timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

function createTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function createRecoveryCodes(userId) {
  const codes = Array.from({ length: 10 }, () => crypto.randomBytes(5).toString('hex').toUpperCase());
  return {
    codes,
    hashes: JSON.stringify(codes.map((code) => hashRecoveryCode(userId, code))),
  };
}

function verifyRecoveryCode(userId, code, hashes) {
  const candidate = Buffer.from(hashRecoveryCode(userId, code.trim().toUpperCase()), 'hex');
  const stored = JSON.parse(hashes || '[]');
  const index = stored.findIndex((value) => {
    const expected = Buffer.from(value, 'hex');
    return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
  });
  if (index < 0) return { valid: false, hashes: stored };
  stored.splice(index, 1);
  return { valid: true, hashes: stored };
}

function requestIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 100);
}

function userAgent(req) {
  return String(req.get('user-agent') || '').slice(0, 500);
}

function audit(db, req, userId, action, details = {}) {
  db.prepare(`INSERT INTO profile_audit_log (user_id, action, details, ip_address)
    VALUES (?, ?, ?, ?)`).run(userId, action, JSON.stringify(details), requestIp(req));
}

module.exports = {
  hashToken, encrypt, decrypt, createTotpSecret, verifyTotp, createRecoveryCodes,
  verifyRecoveryCode, requestIp, userAgent, audit,
};

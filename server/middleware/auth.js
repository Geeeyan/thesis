const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const { can } = require('../lib/permissions');
const { audit } = require('../lib/profile-security');

function sign(user, req) {
  const id = crypto.randomUUID();
  const authVersion = db.prepare('SELECT auth_version FROM users WHERE id = ?').get(user.id)?.auth_version ?? 0;
  const token = jwt.sign({ sub: user.id, role: user.role, jti: id, av: authVersion }, config.jwtSecret, { expiresIn: config.tokenTtl, algorithm: 'HS256' });
  const payload = jwt.decode(token);
  const expiresAt = new Date(payload.exp * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`INSERT INTO user_sessions (id, user_id, user_agent, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?)`).run(id, user.id, String(req?.get('user-agent') || '').slice(0, 500), String(req?.ip || '').slice(0, 100), expiresAt);
  return token;
}

const signChallenge = (user) => jwt.sign({
  sub: user.id,
  scope: 'two-factor',
  av: db.prepare('SELECT auth_version FROM users WHERE id = ?').get(user.id)?.auth_version ?? 0,
}, config.jwtSecret, { expiresIn: '5m', algorithm: 'HS256' });

// Returns the user, null (no header), or false (bad/expired token / deactivated account).
// The user is re-read from the database every request, so deactivating or demoting
// someone takes effect immediately instead of when their token expires.
function readUser(req) {
  const h = req.headers.authorization || '';
  if (!h) return null;
  if (!h.startsWith('Bearer ')) return false;
  try {
    const p = jwt.verify(h.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
    if (p.scope || (p.jti && typeof p.jti !== 'string')) return false;
    const u = db.prepare('SELECT id, name, email, role, active, login_enabled, auth_version FROM users WHERE id = ?').get(p.sub);
    if (!u || !u.active || !u.login_enabled) return false;
    if (p.av !== undefined && p.av !== u.auth_version) return false;
    if (u.auth_version > 0 && p.av === undefined) return false;
    if (p.jti) {
      const session = db.prepare(`SELECT id FROM user_sessions
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')`).get(p.jti, u.id);
      if (!session) return false;
      db.prepare(`UPDATE user_sessions SET last_active_at = datetime('now')
        WHERE id = ? AND last_active_at < datetime('now', '-5 minutes')`).run(p.jti);
      return { ...u, sessionId: p.jti };
    }
    return u;
  } catch { return false; }
}

function authenticate(req, res, next) {
  const u = readUser(req);
  if (!u) return res.status(401).json({ error: 'Please log in again' });
  req.user = u;
  next();
}

// For public endpoints that behave better when the caller is known.
function optionalAuth(req, res, next) {
  const u = readUser(req);
  if (u === false) return res.status(401).json({ error: 'Your session has expired. Please log in again' });
  req.user = u || null;
  next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'You do not have permission to do that' });

function requirePermission(permission) {
  return (req, res, next) => {
    if (can(req.user?.role, permission)) return next();
    if (req.user?.id) {
      audit(db, req, req.user.id, 'permission_denied', {
        permission,
        method: req.method,
        path: req.path,
      });
    }
    return res.status(403).json({ error: 'You do not have permission to do that' });
  };
}

module.exports = {
  sign, signChallenge, authenticate, optionalAuth, requireRole, requirePermission,
  staffOnly: requireRole('staff', 'admin'), adminOnly: requireRole('admin'),
};

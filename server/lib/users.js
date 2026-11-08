const bcrypt = require('bcryptjs');
const db = require('../db');
const { HttpError } = require('./util');
const { audit } = require('./profile-security');

const toUser = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone || '',
  address: r.address || '',
  nickname: r.nickname || '',
  gender: r.gender || '',
  country: r.country || '',
  language: r.language || '',
  timezone: r.timezone || '',
  profileImage: r.profile_image || null,
  role: r.role,
  active: !!r.active,
  loginEnabled: !!r.login_enabled,
  createdAt: r.created_at,
});

function createUser({ name, email, password, role }) {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.login_enabled) throw new HttpError(409, 'That email is already registered');
    db.prepare('UPDATE users SET name = ?, password_hash = ?, role = ?, active = 1, login_enabled = 1 WHERE id = ?')
      .run(name, bcrypt.hashSync(password, 10), role, existing.id);
    return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id));
  }
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run(name, email, bcrypt.hashSync(password, 10), role);
  return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
}

function recordGuest({ name, email }) {
  const existing = db.prepare('SELECT id, login_enabled FROM users WHERE email = ?').get(email);
  if (existing) {
    if (!existing.login_enabled) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, existing.id);
    return existing.id;
  }
  return db.prepare("INSERT INTO users (name, email, password_hash, role, login_enabled) VALUES (?,?,'','guest',0)").run(name, email).lastInsertRowid;
}

// Shared by /api/users and /api/staff. `actor` is the admin making the change.
function updateUser(target, patch, actor, req) {
  if (actor.id === target.id && patch.password !== undefined) {
    throw new HttpError(400, 'Use Profile Settings to change your own password');
  }
  const demoting = (patch.role !== undefined && patch.role !== target.role) || patch.active === false;
  if (actor.id === target.id && demoting) throw new HttpError(400, 'You cannot change your own role or deactivate yourself');
  if (target.role === 'admin' && demoting) {
    const others = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(target.id).c;
    if (others < 1) throw new HttpError(409, 'There must be at least one active admin');
  }
  const sets = [], vals = [];
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
  if (patch.role !== undefined) { sets.push('role = ?'); vals.push(patch.role); }
  if (patch.active !== undefined) { sets.push('active = ?'); vals.push(patch.active ? 1 : 0); }
  if (patch.password !== undefined) {
    sets.push('password_hash = ?', 'login_enabled = 1');
    vals.push(bcrypt.hashSync(patch.password, 10));
  }
  if (sets.length) {
    db.transaction(() => {
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, target.id);
      if (patch.password !== undefined) {
        db.prepare(`UPDATE user_sessions SET revoked_at = datetime('now')
          WHERE user_id = ? AND revoked_at IS NULL`).run(target.id);
        audit(db, req, target.id, 'password_changed_by_admin', { actorId: actor.id });
      }
    })();
  }
  return toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id));
}

module.exports = { toUser, createUser, recordGuest, updateUser };

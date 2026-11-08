const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');
const { emailSchema, passwordSchema, parseId, HttpError } = require('../lib/util');
const { createUser, updateUser, toUser } = require('../lib/users');

router.use(authenticate, adminOnly);
const role = z.enum(['guest', 'staff', 'admin']);

router.get('/', (req, res) => {
  const where = [], vals = [];
  if (req.query.role) { where.push('role = ?'); vals.push(role.parse(req.query.role)); }
  if (req.query.q) { where.push('(name LIKE ? OR email LIKE ?)'); vals.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const rows = db.prepare(`SELECT * FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id`).all(...vals);
  res.json(rows.map(toUser));
});

router.post('/', (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(100), email: emailSchema, password: passwordSchema, role }).parse(req.body);
  res.status(201).json(createUser(b));
});

router.patch('/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(parseId(req.params.id));
  if (!target) throw new HttpError(404, 'User not found');
  const patch = z.strictObject({ name: z.string().trim().min(1).max(100), role, active: z.boolean(), password: passwordSchema }).partial().parse(req.body);
  res.json(updateUser(target, patch, req.user, req));
});

module.exports = router;

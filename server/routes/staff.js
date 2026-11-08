const router = require('express').Router();
const { z } = require('zod');
const db = require('../db');
const { authenticate, adminOnly } = require('../middleware/auth');
const { emailSchema, passwordSchema, parseId, HttpError } = require('../lib/util');
const { createUser, updateUser, toUser } = require('../lib/users');

router.use(authenticate, adminOnly);

router.get('/', (_req, res) => res.json(db.prepare("SELECT * FROM users WHERE role = 'staff' ORDER BY name").all().map(toUser)));

router.post('/', (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(100), email: emailSchema, password: passwordSchema }).parse(req.body);
  res.status(201).json(createUser({ ...b, role: 'staff' }));
});

router.patch('/:id', (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'staff'").get(parseId(req.params.id));
  if (!target) throw new HttpError(404, 'Staff member not found');
  const patch = z.strictObject({ name: z.string().trim().min(1).max(100), active: z.boolean(), password: passwordSchema }).partial().parse(req.body);
  res.json(updateUser(target, patch, req.user, req));
});

module.exports = router;

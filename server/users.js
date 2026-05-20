const express = require('express');
const bcrypt  = require('bcryptjs');
const { randomUUID } = require('crypto');
const { findAll, findOne, findById, insert, remove, update } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();
router.use(authenticate);

const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE   = /^.{2,100}$/;

router.get('/', authorize('users.read'), (req, res) => {
  const users = findAll('users').map(({ password_hash, ...u }) => ({
    ...u,
    roles: findAll('user_roles', ur => ur.user_id === u.id).map(ur => findById('roles', ur.role_id)?.name).filter(Boolean),
  }));
  res.json(users);
});

router.post('/', authorize('users.create'), (req, res) => {
  const { name, email, password, role } = req.body || {};
  // Server-side validation
  if (!name || !NAME_RE.test(name.trim())) return res.status(400).json({ message: 'Name must be 2–100 characters.' });
  if (!email || !EMAIL_RE.test(email))     return res.status(400).json({ message: 'Valid email required.' });
  if (!password || password.length < 6 || password.length > 128) return res.status(400).json({ message: 'Password must be 6–128 characters.' });
  const VALID_ROLES = ['admin','manager','sales_rep','viewer'];
  if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role.' });
  if (findOne('users', u => u.email === email.toLowerCase())) return res.status(409).json({ message: 'Email already in use.' });
  const id = randomUUID();
  insert('users', { id, name: name.trim(), email: email.toLowerCase(), password_hash: bcrypt.hashSync(password, 12), is_active: 1, created_at: new Date().toISOString() });
  const roleRow = findOne('roles', r => r.name === (role || 'viewer'));
  if (roleRow) insert('user_roles', { user_id: id, role_id: roleRow.id });
  res.status(201).json({ id, name: name.trim(), email: email.toLowerCase(), role: role || 'viewer' });
});

router.put('/:id/roles', authorize('users.update'), (req, res) => {
  const { roles } = req.body || {};
  if (!Array.isArray(roles)) return res.status(400).json({ message: 'roles must be an array.' });
  if (!findById('users', req.params.id)) return res.status(404).json({ message: 'User not found.' });
  // Prevent removing last admin
  const admins = findAll('user_roles', ur => {
    const role = findById('roles', ur.role_id);
    return role?.name === 'admin';
  });
  const isCurrentlyAdmin = admins.some(ur => ur.user_id === req.params.id);
  const wouldLoseAdmin   = isCurrentlyAdmin && !roles.includes('admin');
  const otherAdmins      = admins.filter(ur => ur.user_id !== req.params.id).length;
  if (wouldLoseAdmin && otherAdmins === 0) return res.status(400).json({ message: 'Cannot remove the last admin.' });

  remove('user_roles', ur => ur.user_id === req.params.id);
  roles.forEach(name => { const r = findOne('roles', r => r.name === name); if (r) insert('user_roles', { user_id: req.params.id, role_id: r.id }); });
  res.json({ message: 'Roles updated.' });
});

router.delete('/:id', authorize('users.delete'), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ message: 'Cannot delete your own account.' });
  const user = findById('users', req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  remove('users', u => u.id === req.params.id);
  remove('user_roles', ur => ur.user_id === req.params.id);
  remove('refresh_tokens', t => t.user_id === req.params.id);
  res.json({ message: 'User deleted.' });
});

router.get('/roles', authorize('users.read'), (req, res) => {
  const roles = findAll('roles').map(r => ({
    ...r,
    permissions: findAll('role_permissions', rp => rp.role_id === r.id).map(rp => findById('permissions', rp.permission_id)?.key).filter(Boolean),
  }));
  res.json(roles);
});

module.exports = router;

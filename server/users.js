const express = require('express');
const bcrypt  = require('bcryptjs');
const { randomUUID } = require('crypto');
const { findAll, findOne, findById, insert, remove } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();
router.use(authenticate);

router.get('/', authorize('users.read'), (req, res) => {
  const users = findAll('users').map(({ password_hash, ...u }) => ({
    ...u,
    roles: findAll('user_roles', ur => ur.user_id===u.id).map(ur => findById('roles', ur.role_id)?.name).filter(Boolean),
  }));
  res.json(users);
});

router.post('/', authorize('users.create'), (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name||!email||!password) return res.status(400).json({ message:'name, email, password required.' });
  if (findOne('users', u => u.email===email.toLowerCase())) return res.status(409).json({ message:'Email already in use.' });
  const id = randomUUID();
  insert('users', { id, name:name.trim(), email:email.toLowerCase(), password_hash:bcrypt.hashSync(password,12), is_active:1, created_at:new Date().toISOString() });
  const roleRow = findOne('roles', r => r.name===(role||'viewer'));
  if (roleRow) insert('user_roles', { user_id:id, role_id:roleRow.id });
  res.status(201).json({ id, name, email, role:role||'viewer' });
});

router.put('/:id/roles', authorize('users.update'), (req, res) => {
  const { roles } = req.body || {};
  if (!Array.isArray(roles)) return res.status(400).json({ message:'roles must be array.' });
  if (!findById('users', req.params.id)) return res.status(404).json({ message:'User not found.' });
  remove('user_roles', ur => ur.user_id===req.params.id);
  roles.forEach(name => { const r=findOne('roles',r=>r.name===name); if(r) insert('user_roles',{user_id:req.params.id,role_id:r.id}); });
  res.json({ message:'Roles updated.' });
});

router.get('/roles', authorize('users.read'), (req, res) => {
  const roles = findAll('roles').map(r => ({
    ...r,
    permissions: findAll('role_permissions', rp=>rp.role_id===r.id).map(rp=>findById('permissions',rp.permission_id)?.key).filter(Boolean),
  }));
  res.json(roles);
});

module.exports = router;


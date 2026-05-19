const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { findOne, insert, remove, getUserPermissions } = require('./db');
const { authenticate, JWT_SECRET } = require('./middleware');

const router = express.Router();
const ACCESS_TTL   = '15m';
const REFRESH_SECS = 7 * 24 * 60 * 60;

function makeAccess(user) {
  return jwt.sign({ id:user.id, email:user.email, name:user.name }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Email and password required.' });
  const user = findOne('users', u => u.email === String(email).trim().toLowerCase() && u.is_active);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ message: 'Invalid credentials.' });
  const refreshToken = randomUUID();
  insert('refresh_tokens', { token:refreshToken, user_id:user.id, expires_at:new Date(Date.now()+REFRESH_SECS*1000).toISOString() });
  res.json({ accessToken:makeAccess(user), refreshToken, user:{id:user.id,name:user.name,email:user.email}, permissions:[...getUserPermissions(user.id)] });
});

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ message: 'Refresh token required.' });
  const row = findOne('refresh_tokens', t => t.token === refreshToken);
  if (!row || new Date(row.expires_at) < new Date()) return res.status(401).json({ message: 'Invalid or expired token.' });
  const user = findOne('users', u => u.id === row.user_id && u.is_active);
  if (!user) return res.status(401).json({ message: 'User not found.' });
  remove('refresh_tokens', t => t.token === refreshToken);
  const newRefresh = randomUUID();
  insert('refresh_tokens', { token:newRefresh, user_id:user.id, expires_at:new Date(Date.now()+REFRESH_SECS*1000).toISOString() });
  res.json({ accessToken:makeAccess(user), refreshToken:newRefresh });
});

router.post('/logout', (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) remove('refresh_tokens', t => t.token === refreshToken);
  res.json({ message: 'Logged out.' });
});

router.get('/me', authenticate, (req, res) => {
  const user = findOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const { password_hash, ...safe } = user;
  res.json({ user:safe, permissions:[...getUserPermissions(user.id)] });
});

module.exports = router;


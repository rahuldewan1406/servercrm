const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { findOne, insert, remove, findAll, getUserPermissions } = require('./db');
const { authenticate, JWT_SECRET } = require('./middleware');

const router      = express.Router();
const ACCESS_TTL  = '15m';
const REFRESH_SECS = 7 * 24 * 60 * 60;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES    = 15;

// In-memory login attempt tracker (per IP)
const loginAttempts = {};

function checkRateLimit(ip) {
  const now = Date.now();
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, resetAt: now + LOCKOUT_MINUTES * 60000 };
  if (now > loginAttempts[ip].resetAt) { loginAttempts[ip] = { count: 0, resetAt: now + LOCKOUT_MINUTES * 60000 }; }
  if (loginAttempts[ip].count >= MAX_LOGIN_ATTEMPTS) {
    const waitMins = Math.ceil((loginAttempts[ip].resetAt - now) / 60000);
    return { locked: true, waitMins };
  }
  return { locked: false };
}

function recordFailedLogin(ip) {
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, resetAt: Date.now() + LOCKOUT_MINUTES * 60000 };
  loginAttempts[ip].count++;
}
function clearLoginAttempts(ip) { delete loginAttempts[ip]; }

// Purge expired refresh tokens (run on each login)
function purgeExpiredTokens() {
  remove('refresh_tokens', t => new Date(t.expires_at) < new Date());
}

function makeAccess(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

// ── Server-side input validation ────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmail(e) { return typeof e === 'string' && EMAIL_RE.test(e.trim()) && e.length <= 254; }
function validatePassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 128; }

router.post('/login', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const rl  = checkRateLimit(ip);
  if (rl.locked) return res.status(429).json({ message: `Too many failed attempts. Try again in ${rl.waitMins} minute(s).` });

  const { email, password } = req.body || {};
  if (!validateEmail(email))    return res.status(400).json({ message: 'Invalid email address.' });
  if (!validatePassword(password)) return res.status(400).json({ message: 'Password must be 6–128 characters.' });

  const user = findOne('users', u => u.email === email.trim().toLowerCase() && u.is_active !== 0);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailedLogin(ip);
    // Constant-time response to prevent user enumeration
    return res.status(401).json({ message: 'Invalid credentials.' });
  }

  clearLoginAttempts(ip);
  purgeExpiredTokens();
  const refreshToken = randomUUID();
  insert('refresh_tokens', { token: refreshToken, user_id: user.id, expires_at: new Date(Date.now() + REFRESH_SECS * 1000).toISOString() });
  res.json({
    accessToken: makeAccess(user), refreshToken,
    user: { id: user.id, name: user.name, email: user.email },
    permissions: [...getUserPermissions(user.id)],
  });
});

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken || typeof refreshToken !== 'string') return res.status(400).json({ message: 'Refresh token required.' });
  const row = findOne('refresh_tokens', t => t.token === refreshToken);
  if (!row || new Date(row.expires_at) < new Date()) return res.status(401).json({ message: 'Invalid or expired token.' });
  const user = findOne('users', u => u.id === row.user_id && u.is_active !== 0);
  if (!user) return res.status(401).json({ message: 'User not found or suspended.' });
  remove('refresh_tokens', t => t.token === refreshToken);
  const newRefresh = randomUUID();
  insert('refresh_tokens', { token: newRefresh, user_id: user.id, expires_at: new Date(Date.now() + REFRESH_SECS * 1000).toISOString() });
  res.json({ accessToken: makeAccess(user), refreshToken: newRefresh });
});

router.post('/logout', (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken && typeof refreshToken === 'string') remove('refresh_tokens', t => t.token === refreshToken);
  res.json({ message: 'Logged out.' });
});

router.get('/me', authenticate, (req, res) => {
  const user = findOne('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const { password_hash, ...safe } = user;
  res.json({ user: safe, permissions: [...getUserPermissions(user.id)] });
});

module.exports = router;

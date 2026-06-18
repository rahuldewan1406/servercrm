const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { findOne, insert, remove, query, getUserPermissions } = require('./db');
const { authenticate, JWT_SECRET } = require('./middleware');

const router      = express.Router();
const ACCESS_TTL  = '15m';
const REFRESH_SECS = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000;

const loginAttempts = {};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkRL(ip) {
  const now = Date.now();
  const rec = loginAttempts[ip];
  if (!rec || now > rec.resetAt) {
    loginAttempts[ip] = { count: 0, resetAt: now + LOCKOUT_MS };
    return { locked: false };
  }
  if (rec.count >= MAX_ATTEMPTS) {
    return { locked: true, waitMins: Math.ceil((rec.resetAt - now) / 60000) };
  }
  return { locked: false };
}

async function purgeExpiredTokens() {
  await query(`DELETE FROM refresh_tokens WHERE expires_at < NOW()`);
}

function makeAccess(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

router.post('/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  const rl = checkRL(ip);
  if (rl.locked) return res.status(429).json({ message: `Too many attempts. Wait ${rl.waitMins} min.` });

  const { email, password } = req.body || {};
  if (!email || !EMAIL_RE.test(email.trim()) || email.length > 254)
    return res.status(400).json({ message: 'Invalid email.' });
  if (!password || password.length < 6 || password.length > 128)
    return res.status(400).json({ message: 'Password must be 6–128 chars.' });

  try {
    const user = await findOne('users', { email: email.trim().toLowerCase() });
    if (!user || user.is_active === 0 || !bcrypt.compareSync(password, user.password_hash)) {
      loginAttempts[ip] = loginAttempts[ip] || { count: 0, resetAt: Date.now() + LOCKOUT_MS };
      loginAttempts[ip].count++;
      return res.status(401).json({ message: 'Invalid credentials.' });
    }
    delete loginAttempts[ip];
    purgeExpiredTokens().catch(() => {});
    const refreshToken = randomUUID();
    await insert('refresh_tokens', {
      token: refreshToken, user_id: user.id,
      expires_at: new Date(Date.now() + REFRESH_SECS * 1000).toISOString(),
    });
    const perms = await getUserPermissions(user.id);
    res.json({
      accessToken: makeAccess(user), refreshToken,
      user: { id: user.id, name: user.name, email: user.email },
      permissions: [...perms],
    });
  } catch(e) {
    console.error('[auth/login]', e.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken || typeof refreshToken !== 'string')
    return res.status(400).json({ message: 'Refresh token required.' });
  try {
    const row = await findOne('refresh_tokens', { token: refreshToken });
    if (!row || new Date(row.expires_at) < new Date())
      return res.status(401).json({ message: 'Invalid or expired token.' });
    const user = await findOne('users', { id: row.user_id });
    if (!user || user.is_active === 0)
      return res.status(401).json({ message: 'User not found or suspended.' });
    await remove('refresh_tokens', { token: refreshToken });
    const newToken = randomUUID();
    await insert('refresh_tokens', { token: newToken, user_id: user.id, expires_at: new Date(Date.now() + REFRESH_SECS * 1000).toISOString() });
    res.json({ accessToken: makeAccess(user), refreshToken: newToken });
  } catch(e) {
    console.error('[auth/refresh]', e.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) await remove('refresh_tokens', { token: refreshToken }).catch(() => {});
  res.json({ message: 'Logged out.' });
});

router.get('/me', authenticate, async (req, res) => {
  const user = await findOne('users', { id: req.user.id });
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const { password_hash, ...safe } = user;
  const perms = await getUserPermissions(user.id);
  res.json({ user: safe, permissions: [...perms] });
});

module.exports = router;

// ── Forgot Password ───────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const { rows: [user] } = await require('./db').query(
      'SELECT id, name, email FROM users WHERE email = $1', [email.toLowerCase().trim()]
    );

    // Always return success (don't reveal if email exists)
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent.' });

    // Generate token
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token
    await require('./db').query(
      'INSERT INTO password_reset_tokens(user_id, token, expires_at) VALUES($1,$2,$3)',
      [user.id, token, expires]
    );

    // Send email via SES
    const resetUrl = `${process.env.ALLOWED_ORIGIN}/CRM/?reset=${token}`;
    const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
    const ses = new SESClient({ region: process.env.SES_REGION || 'ap-south-1' });
    const fromEmail = process.env.SES_FROM_EMAIL || 'noreply@dic.org.in';
    const fromName  = process.env.SES_FROM_NAME  || 'DIC-NHAI CRM';

    await ses.send(new SendEmailCommand({
      Source: `${fromName} <${fromEmail}>`,
      Destination: { ToAddresses: [user.email] },
      Message: {
        Subject: { Data: 'DIC-NHAI CRM — Password Reset Request' },
        Body: {
          Html: { Data: `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
              <div style="background:#1E3A6E;padding:16px 24px;border-radius:8px 8px 0 0">
                <h2 style="color:#fff;margin:0;font-size:18px">DIC — NHAI CRM</h2>
                <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:12px">Digital India Corporation</p>
              </div>
              <div style="background:#F4F6FB;padding:24px;border:1px solid #D0DAF0;border-radius:0 0 8px 8px">
                <p style="color:#1A1F2E;font-size:15px">Hi <strong>${user.name}</strong>,</p>
                <p style="color:#4A5568;font-size:14px">We received a request to reset your password for the NHAI CRM system.</p>
                <p style="color:#4A5568;font-size:14px">Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
                <div style="text-align:center;margin:24px 0">
                  <a href="${resetUrl}" style="background:#1E3A6E;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Reset Password</a>
                </div>
                <p style="color:#8899BB;font-size:12px">If you didn't request this, ignore this email. Your password will remain unchanged.</p>
                <p style="color:#8899BB;font-size:12px">Link: <a href="${resetUrl}" style="color:#1E3A6E">${resetUrl}</a></p>
              </div>
            </div>
          `}
        }
      }
    }));

    console.log(`[Auth] Password reset email sent to ${user.email}`);
    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch(e) {
    console.error('[Auth] Forgot password error:', e.message);
    res.status(500).json({ message: 'Failed to send reset email. Please contact admin.' });
  }
});

// ── Reset Password ────────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and password required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });

    const db = require('./db');
    const { rows: [reset] } = await db.query(
      'SELECT * FROM password_reset_tokens WHERE token=$1 AND used=FALSE AND expires_at > NOW()',
      [token]
    );
    if (!reset) return res.status(400).json({ message: 'Invalid or expired reset link.' });

    // Hash new password
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 12);

    // Update password
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, reset.user_id]);

    // Mark token used
    await db.query('UPDATE password_reset_tokens SET used=TRUE WHERE id=$1', [reset.id]);

    // Get user name for response
    const { rows: [user] } = await db.query('SELECT name FROM users WHERE id=$1', [reset.user_id]);

    console.log(`[Auth] Password reset successful for user ${reset.user_id}`);
    res.json({ message: `Password updated successfully. You can now sign in, ${user?.name||''}.` });
  } catch(e) {
    console.error('[Auth] Reset password error:', e.message);
    res.status(500).json({ message: 'Failed to reset password.' });
  }
});

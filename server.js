const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── Email validation ──────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(addr) { return typeof addr === 'string' && EMAIL_RE.test(addr.trim()); }

// ── In-memory rate limiter ────────────────────────────────────────────────────
// Max RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_MS per IP
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10;              // max 10 send requests per minute per IP
const rateLimitMap = new Map();

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  entry.count += 1;
  rateLimitMap.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000);
    res.set('Retry-After', retryAfter);
    return res.status(429).json({ message: `Too many requests. Please wait ${retryAfter}s before sending again.` });
  }
  next();
}

// Periodically clean up old entries to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// ── SMTP setup ────────────────────────────────────────────────────────────────
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || 'false') === 'true';
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser;
const requiredEnv = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined
});

const smtpConfigured = missingEnv.length === 0;
if (!smtpConfigured) {
  console.warn(`WARNING: SMTP is not fully configured. Missing: ${missingEnv.join(', ')}.`);
  console.warn('Create a .env file from .env.example and set SMTP_HOST, SMTP_USER, and SMTP_PASS.');
} else {
  transporter.verify((err) => {
    if (err) console.warn('SMTP verification failed:', err.message);
    else console.log('SMTP transport is configured and ready.');
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.post('/api/send-email', rateLimiter, async (req, res) => {
  const { recipients, subject, body } = req.body;

  // Structural validation
  if (!Array.isArray(recipients) || !recipients.length || !subject || !body) {
    return res.status(400).json({ message: 'Invalid payload.' });
  }

  // Email address validation — reject any invalid address
  const invalidAddrs = recipients.filter((r) => !isValidEmail(r));
  if (invalidAddrs.length) {
    return res.status(400).json({
      message: `Invalid email address${invalidAddrs.length > 1 ? 'es' : ''}: ${invalidAddrs.join(', ')}`
    });
  }

  // Cap recipients to prevent accidental spam
  const MAX_RECIPIENTS = 100;
  if (recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({ message: `Too many recipients. Maximum is ${MAX_RECIPIENTS}.` });
  }

  if (!smtpConfigured) {
    return res.status(500).json({ message: 'SMTP is not configured. Create a .env file from .env.example and restart the backend.' });
  }

  try {
    await transporter.sendMail({ from: smtpFrom, to: recipients.join(','), subject, text: body });
    res.json({ message: `Email sent to ${recipients.length} recipient(s).` });
  } catch (error) {
    console.error('SMTP send failed:', error);
    res.status(500).json({ message: `SMTP send failed: ${error.message}` });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: smtpConfigured ? 'ok' : 'smtp-missing' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error.' });
});

process.on('unhandledRejection', (reason) => { console.error('Unhandled Rejection at:', reason); });
process.on('uncaughtException', (error) => { console.error('Uncaught Exception:', error); process.exit(1); });

app.listen(6001, () => console.log('SMTP API running on http://localhost:6001'));

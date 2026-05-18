const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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

app.post('/api/send-email', async (req, res) => {
  const { recipients, subject, body } = req.body;
  if (!Array.isArray(recipients) || !recipients.length || !subject || !body) return res.status(400).json({ message: 'Invalid payload.' });
  if (!smtpConfigured) return res.status(500).json({ message: 'SMTP is not configured. Create a .env file from .env.example and restart the backend.' });
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

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection at:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

app.listen(3001, () => console.log('SMTP API running on http://localhost:3001'));

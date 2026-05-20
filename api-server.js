'use strict';
const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const authRouter      = require('./server/auth');
const usersRouter     = require('./server/users');
const resourcesRouter = require('./server/resources');
const { securityHeaders } = require('./server/middleware');

const PORT           = process.env.PORT || 3002;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:8000';

const app = express();

// ── Security headers on every response ─────────────────────────────
app.use(securityHeaders);

// ── CORS — explicit origin whitelist ───────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin || origin === ALLOWED_ORIGIN) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type'],
}));

// ── Body parser — strict limits ─────────────────────────────────────
app.use(express.json({ limit: '512kb', strict: true }));

// ── Health check (public, no auth) ─────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Routes ──────────────────────────────────────────────────────────
app.use('/auth',  authRouter);
app.use('/users', usersRouter);
app.use('/',      resourcesRouter);

// ── 404 handler ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ message: 'Not found.' }));

// ── Global error handler (never leak stack traces) ──────────────────
app.use((err, req, res, next) => {
  const status = err.status || 500;
  // Log internally but never expose stack to client
  if (status >= 500) console.error('[ERROR]', err.message, err.stack);
  res.status(status).json({ message: status >= 500 ? 'Internal server error.' : err.message });
});

// ── Uncaught exception guard ────────────────────────────────────────
process.on('uncaughtException',  err => { console.error('[UNCAUGHT]', err); });
process.on('unhandledRejection', err => { console.error('[UNHANDLED]', err); });

app.listen(PORT, () => console.log(`API server on port ${PORT}`));

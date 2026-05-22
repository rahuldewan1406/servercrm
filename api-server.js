'use strict';
require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { init } = require('./server/db');
const { migrateChatTables } = require('./server/chat-migrate');
const { securityHeaders } = require('./server/middleware');
const { initSocket } = require('./server/socket');

const PORT = process.env.PORT || 6002;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:8000';
const app = express();
const httpServer = http.createServer(app);

app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(cors({
  origin: (origin, cb) => (!origin || origin === ALLOWED_ORIGIN) ? cb(null, true) : cb(new Error('CORS blocked')),
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Authorization','Content-Type'],
}));
app.use(express.json({ limit: '512kb', strict: true }));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/auth',  require('./server/auth'));
app.use('/users', require('./server/users'));
app.use('/chat',  require('./server/chat'));
app.use('/video', require('./server/video'));
app.use('/',      require('./server/resources'));

app.use((req, res) => res.status(404).json({ message: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err.status >= 500 || !err.status) console.error('[API ERROR]', err.message);
  res.status(err.status || 500).json({ message: err.status < 500 ? err.message : 'Internal server error.' });
});

process.on('uncaughtException',  e => console.error('[UNCAUGHT]',  e));
process.on('unhandledRejection', e => console.error('[UNHANDLED]', e));

init()
  .then(() => migrateChatTables())
  .then(() => {
    initSocket(httpServer, ALLOWED_ORIGIN);
    httpServer.listen(PORT, '127.0.0.1', () => console.log(`[API] Listening on 127.0.0.1:${PORT}`));
  })
  .catch(err => { console.error('[FATAL] DB init failed:', err.message); process.exit(1); });

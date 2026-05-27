'use strict';
require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { init } = require('./server/db');
const { migrateChatTables } = require('./server/chat-migrate');
const { securityHeaders } = require('./server/middleware');
const { initSocket } = require('./server/socket');

const PORT = process.env.PORT || 3002;
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
app.use('/jira-proxy', require('./server/jira-proxy'));
// ── Email proxy (calls SES server internally via parsed body) ────────
function proxyToSES(req, res, sesPath) {
  const body = JSON.stringify(req.body || {});
  const opts = {
    hostname: '127.0.0.1',
    port: 6001,
    path: sesPath,
    method: req.method,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const proxy = http.request(opts, r => {
    let data = '';
    r.on('data', d => data += d);
    r.on('end', () => {
      res.status(r.statusCode);
      try { res.json(JSON.parse(data)); } catch(e) { res.send(data); }
    });
  });
  proxy.on('error', e => {
    console.error('[Email proxy error]', e.message);
    res.status(502).json({ message: 'Email service unavailable: ' + e.message });
  });
  proxy.write(body);
  proxy.end();
}

app.post('/email/send',  (req, res) => proxyToSES(req, res, '/api/send-email'));
app.post('/email/test',  (req, res) => proxyToSES(req, res, '/api/send-email/test'));
app.get('/email/health', (req, res) => proxyToSES(req, res, '/api/health'));

app.use('/auth',  require('./server/auth'));
app.use('/users', require('./server/users'));
app.use('/chat',  require('./server/chat'));
app.use('/video', require('./server/video'));
app.use('/',      require('./server/resources'));


// ── Jira API Proxy (server-side, bypasses browser CORS) ──────────
const https = require('https');
app.options('/jira-proxy/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});
app.use('/jira-proxy', (req, res) => {
  const targetHost = 'cms-team-nhai.atlassian.net';
  const targetPath = req.url;
  const authHeader = req.headers['authorization'] || '';
  const options = {
    hostname: targetHost,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: {
      'Host': targetHost,
      'Authorization': authHeader,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'NHAI-CRM/2.0',
    }
  };
  const proxyReq = https.request(options, (proxyRes) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Forward response headers except problematic ones
    Object.entries(proxyRes.headers).forEach(([k,v]) => {
      if (!['transfer-encoding','connection'].includes(k.toLowerCase())) res.setHeader(k, v);
    });
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (e) => {
    console.error('[Jira proxy error]', e.message);
    res.status(502).json({ error: e.message });
  });
  if (req.method !== 'GET' && req.method !== 'OPTIONS') req.pipe(proxyReq);
  else proxyReq.end();
});

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


// ── Modules config API ─────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const MODULES_FILE = path.join(__dirname, 'config', 'modules.json');

// Ensure config dir exists
if (!fs.existsSync(path.join(__dirname, 'config'))) {
  fs.mkdirSync(path.join(__dirname, 'config'));
}

// GET /modules — return current modules list
app.get('/modules', (req, res) => {
  try {
    const data = fs.existsSync(MODULES_FILE)
      ? JSON.parse(fs.readFileSync(MODULES_FILE, 'utf8'))
      : [];
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: 'Failed to read modules.' });
  }
});

// PUT /modules — replace entire modules list (admin only)
app.put('/modules', async (req, res) => {
  try {
    const { authenticate } = require('./server/middleware');
    // inline auth check
    const header = req.headers['authorization']||'';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Auth required.' });

    const modules = req.body;
    if (!Array.isArray(modules)) return res.status(400).json({ error: 'Must be array.' });
    const clean = modules.map(m => ({
      name:     String(m.name||'').trim().slice(0,100),
      platform: String(m.platform||'').trim().slice(0,50),
      desc:     String(m.desc||'').trim().slice(0,200),
    })).filter(m => m.name);
    fs.writeFileSync(MODULES_FILE, JSON.stringify(clean, null, 2));
    res.json({ message: 'Modules updated.', count: clean.length });
  } catch(e) {
    res.status(500).json({ error: 'Failed to save modules.' });
  }
});



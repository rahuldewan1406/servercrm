const https   = require('https');
const express = require('express');
const router  = express.Router();

router.use((req, res) => {
  // Host is passed as X-Jira-Host header from the frontend
  // Falls back to any configured env variable
  const targetHost = req.headers['x-jira-host'] ||
                     process.env.JIRA_HOST ||
                     '';

  if (!targetHost) {
    return res.status(400).json({ error: 'Jira host not specified. Pass X-Jira-Host header.' });
  }

  const authHeader = req.headers['authorization'] || '';
  console.log('[Jira Proxy]', req.method, targetHost, req.url,
    'Auth:', authHeader ? 'present' : 'MISSING');

  const options = {
    hostname: targetHost,
    port:     443,
    path:     req.url,
    method:   req.method,
    headers: {
      'Host':          targetHost,
      'Authorization': authHeader,
      'Accept':        'application/json',
      'Content-Type':  'application/json',
      'User-Agent':    'NHAI-CRM/2.0',
    }
  };

  res.setHeader('Access-Control-Allow-Origin',      req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers',
    'Authorization, Content-Type, Accept, X-Jira-Host');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods',     'GET, POST, PUT, OPTIONS');

  if (req.method === 'OPTIONS') return res.sendStatus(204);

  const proxyReq = https.request(options, (proxyRes) => {
    console.log('[Jira Proxy] Response:', proxyRes.statusCode, targetHost);
    Object.entries(proxyRes.headers).forEach(([k, v]) => {
      if (!['transfer-encoding', 'connection', 'content-encoding'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error('[Jira Proxy Error]', e.message);
    res.status(502).json({ error: e.message });
  });

  req.pipe(proxyReq);
});

module.exports = router;

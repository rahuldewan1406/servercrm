'use strict';
const { Router } = require('express');
const { authenticate } = require('./middleware');

const router = Router();
const DAILY_API_KEY = process.env.DAILY_API_KEY || '';
const DAILY_API = 'https://api.daily.co/v1';

// ── Create a video room ───────────────────────────────────────────
router.post('/rooms', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    if (!DAILY_API_KEY) {
      // Return a placeholder until Daily.co key is configured
      return res.json({
        url: null,
        name: name || 'room-' + Date.now(),
        message: 'Daily.co API key not configured. Add DAILY_API_KEY to .env'
      });
    }
    const response = await fetch(`${DAILY_API}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DAILY_API_KEY}` },
      body: JSON.stringify({
        name: name || `crm-${Date.now()}`,
        properties: {
          max_participants: 50,
          exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
          enable_chat: true,
          enable_screenshare: true,
        }
      })
    });
    const room = await response.json();
    res.json(room);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ── Get meeting token for a user ──────────────────────────────────
router.post('/token', authenticate, async (req, res) => {
  try {
    const { room_name } = req.body;
    if (!DAILY_API_KEY) return res.json({ token: null });
    const response = await fetch(`${DAILY_API}/meeting-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DAILY_API_KEY}` },
      body: JSON.stringify({
        properties: {
          room_name,
          user_name: req.user.name,
          user_id: req.user.id,
          is_owner: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }
      })
    });
    const data = await response.json();
    res.json(data);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;

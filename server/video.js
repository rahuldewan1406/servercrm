'use strict';
const { Router } = require('express');
const { authenticate } = require('./middleware');
const router = Router();

router.post('/rooms', authenticate, async (req, res) => {
  const roomName = 'nhai-crm-' + Date.now();
  res.json({
    url: 'https://meet.jit.si/' + roomName,
    name: roomName
  });
});

module.exports = router;

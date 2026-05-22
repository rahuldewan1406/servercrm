'use strict';
const { Router } = require('express');
const { authenticate } = require('./middleware');
const router = Router();

router.post('/rooms', authenticate, async (req, res) => {
  const roomName = 'nhai-crm-' + Math.random().toString(36).substr(2, 9);
  // Use jaas.8x8.vc free tier or meet.jit.si with guest access
  res.json({
    url: 'https://meet.jit.si/' + roomName + '#config.prejoinPageEnabled=false&userInfo.displayName=' + encodeURIComponent(req.user.name),
    name: roomName
  });
});

module.exports = router;

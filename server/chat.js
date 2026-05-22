'use strict';
const { Router } = require('express');
const { randomUUID } = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const { query } = require('./db');
const { authenticate } = require('./middleware');

const router = Router();
const S3_BUCKET = 'nhai-dl3-py-script-temp-bucket';
const S3_PREFIX = 'CHAT/';
const S3_REGION = 'ap-south-1';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MSG_RETENTION_DAYS = 30;

const s3 = new S3Client({ region: S3_REGION });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

// ── Get all rooms for current user ────────────────────────────────
router.get('/rooms', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT r.*, 
        (SELECT content FROM chat_messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM chat_messages WHERE room_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT COUNT(*) FROM chat_messages WHERE room_id = r.id AND NOT (read_by @> $2::jsonb)) as unread_count
      FROM chat_rooms r
      JOIN chat_members m ON m.room_id = r.id
      WHERE m.user_id = $1
      ORDER BY last_message_at DESC NULLS LAST
    `, [req.user.id, JSON.stringify([req.user.id])]);
    res.json(rows);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ── Create a new room ─────────────────────────────────────────────
router.post('/rooms', authenticate, async (req, res) => {
  try {
    const { name, type = 'direct', member_ids = [], contact_ids = [] } = req.body;
    const id = randomUUID();
    await query(`INSERT INTO chat_rooms(id, name, type, created_by) VALUES($1,$2,$3,$4)`,
      [id, name, type, req.user.id]);
    // Add creator
    await query(`INSERT INTO chat_members(room_id, user_id) VALUES($1,$2)`, [id, req.user.id]);
    // Add members
    for (const uid of member_ids) {
      if (uid !== req.user.id)
        await query(`INSERT INTO chat_members(room_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, uid]);
    }
    // Add contacts
    for (const cid of contact_ids) {
      await query(`INSERT INTO chat_members(room_id, contact_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, cid]);
    }
    res.json({ id, name, type });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ── Get messages for a room ───────────────────────────────────────
router.get('/rooms/:roomId/messages', authenticate, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { before, limit = 50 } = req.query;
    // Verify membership
    const { rows: [member] } = await query(
      `SELECT 1 FROM chat_members WHERE room_id=$1 AND user_id=$2`, [roomId, req.user.id]);
    if (!member) return res.status(403).json({ message: 'Not a member.' });

    let q = `SELECT m.*, u.name as sender_name FROM chat_messages m
             LEFT JOIN users u ON u.id = m.sender_id
             WHERE m.room_id = $1`;
    const params = [roomId];
    if (before) { q += ` AND m.created_at < $${params.length+1}`; params.push(before); }
    q += ` ORDER BY m.created_at DESC LIMIT $${params.length+1}`;
    params.push(parseInt(limit));

    const { rows } = await query(q, params);
    res.json(rows.reverse());
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ── Upload file ───────────────────────────────────────────────────
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file.' });
    const key = `${S3_PREFIX}${randomUUID()}-${req.file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET, Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    }));
    // Generate presigned URL valid for 7 days
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: 604800 });
    const fileUrl = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
    res.json({ url: fileUrl, key, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ── Get room members ──────────────────────────────────────────────
router.get('/rooms/:roomId/members', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT m.user_id, m.contact_id, u.name, u.email
      FROM chat_members m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.room_id = $1
    `, [req.params.roomId]);
    res.json(rows);
  } catch(e) { res.status(500).json({ message: e.message }); }
});

// ── Delete old messages (retention) ──────────────────────────────
async function purgeOldMessages() {
  await query(`DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '${MSG_RETENTION_DAYS} days'`);
}
setInterval(purgeOldMessages, 24 * 60 * 60 * 1000);

module.exports = router;

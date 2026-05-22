'use strict';
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { query } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const onlineUsers = new Map(); // userId -> socketId

function initSocket(httpServer, allowedOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigin, credentials: true },
    maxHttpBufferSize: 50 * 1024 * 1024 // 50MB for file transfers
  });

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token'));
    try {
      const user = jwt.verify(token, JWT_SECRET);
      socket.user = user;
      next();
    } catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    onlineUsers.set(userId, socket.id);

    // Broadcast online status
    io.emit('user:online', { userId, online: true });

    // Join all user's rooms
    query(`SELECT room_id FROM chat_members WHERE user_id = $1`, [userId])
      .then(({ rows }) => rows.forEach(r => socket.join(r.room_id)))
      .catch(() => {});

    // ── Send message ─────────────────────────────────────────────
    socket.on('message:send', async (data, ack) => {
      try {
        const { room_id, content, type = 'text', file_url, file_name, file_size } = data;
        // Verify membership
        const { rows: [member] } = await query(
          `SELECT 1 FROM chat_members WHERE room_id=$1 AND user_id=$2`, [room_id, userId]);
        if (!member) return ack?.({ error: 'Not a member' });

        const id = randomUUID();
        await query(`
          INSERT INTO chat_messages(id, room_id, sender_id, type, content, file_url, file_name, file_size, read_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [id, room_id, userId, type, content, file_url, file_name, file_size, JSON.stringify([userId])]);

        // Update room updated_at
        await query(`UPDATE chat_rooms SET updated_at=NOW() WHERE id=$1`, [room_id]);

        const message = { id, room_id, sender_id: userId, sender_name: socket.user.name,
          type, content, file_url, file_name, file_size, read_by: [userId], created_at: new Date() };

        io.to(room_id).emit('message:new', message);
        ack?.({ ok: true, message });
      } catch(e) { ack?.({ error: e.message }); }
    });

    // ── Mark messages as read ─────────────────────────────────────
    socket.on('message:read', async ({ room_id }) => {
      try {
        await query(`
          UPDATE chat_messages SET read_by = read_by || $1::jsonb
          WHERE room_id = $2 AND NOT (read_by @> $1::jsonb)
        `, [JSON.stringify([userId]), room_id]);
        io.to(room_id).emit('message:read', { room_id, user_id: userId });
      } catch {}
    });

    // ── Typing indicator ──────────────────────────────────────────
    socket.on('typing:start', ({ room_id }) => {
      socket.to(room_id).emit('typing:start', { room_id, user_id: userId, name: socket.user.name });
    });
    socket.on('typing:stop', ({ room_id }) => {
      socket.to(room_id).emit('typing:stop', { room_id, user_id: userId });
    });

    // ── Video call signaling ──────────────────────────────────────
    socket.on('call:start', ({ room_id, daily_room_url }) => {
      socket.to(room_id).emit('call:incoming', {
        room_id, daily_room_url,
        caller_id: userId, caller_name: socket.user.name
      });
    });
    socket.on('call:end', ({ room_id }) => {
      io.to(room_id).emit('call:ended', { room_id });
    });

    // ── Get online users ──────────────────────────────────────────
    socket.on('users:online', (ack) => {
      ack?.([...onlineUsers.keys()]);
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      io.emit('user:online', { userId, online: false });
    });
  });

  return io;
}

module.exports = { initSocket };

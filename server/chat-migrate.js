'use strict';
const { query } = require('./db');

async function migrateChatTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT NOT NULL DEFAULT 'direct',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS chat_members (
      id SERIAL PRIMARY KEY,
      room_id TEXT REFERENCES chat_rooms(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      contact_id TEXT,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(room_id, user_id),
      UNIQUE(room_id, contact_id)
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT REFERENCES chat_rooms(id) ON DELETE CASCADE,
      sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      type TEXT DEFAULT 'text',
      content TEXT,
      file_url TEXT,
      file_name TEXT,
      file_size INTEGER,
      read_by JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id)`);
  console.log('[DB] Chat tables migrated');
}

module.exports = { migrateChatTables };

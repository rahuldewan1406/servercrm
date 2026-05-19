/**
 * db.js — JSON file database via lowdb (pure JS, works on Node 18/20/22).
 * Data stored in crm-data.json next to the project root.
 */
const { LowSync } = require('lowdb');
const { JSONFileSync } = require('lowdb/node');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const path = require('path');

const DATA_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'crm-data.json');

const defaultData = {
  users: [], roles: [], permissions: [], user_roles: [],
  role_permissions: [], refresh_tokens: [], contacts: [], leads: [], tickets: [],
};

const db = new LowSync(new JSONFileSync(DATA_PATH), defaultData);
db.read();

function save() { db.write(); }
function col(name) { return db.data[name]; }
function findById(table, id)    { return col(table).find(r => r.id === id); }
function findOne(table, predFn) { return col(table).find(predFn); }
function findAll(table, predFn) { return predFn ? col(table).filter(predFn) : [...col(table)]; }
function insert(table, record)  { col(table).push(record); save(); return record; }
function update(table, id, changes) {
  const idx = col(table).findIndex(r => r.id === id);
  if (idx === -1) return false;
  Object.assign(col(table)[idx], changes, { updated_at: new Date().toISOString() });
  save(); return true;
}
function remove(table, predFn) { db.data[table] = col(table).filter(r => !predFn(r)); save(); }

// ── Seed roles & permissions ──────────────────────────────────────────────────
const ROLES = [
  { id:'role_admin', name:'admin' }, { id:'role_manager', name:'manager' },
  { id:'role_sales', name:'sales_rep' }, { id:'role_viewer', name:'viewer' },
];
const PERMS = ['contacts','leads','tickets','users'].flatMap(r =>
  ['read','create','update','delete'].map(a => ({ id:`perm_${r}_${a}`, key:`${r}.${a}` }))
);

ROLES.forEach(r => { if (!findById('roles', r.id)) insert('roles', r); });
PERMS.forEach(p => { if (!findById('permissions', p.id)) insert('permissions', p); });

const ROLE_PERMS = {
  role_admin:   PERMS.map(p => p.id),
  role_manager: PERMS.filter(p => !p.key.startsWith('users.')).map(p => p.id),
  role_sales:   PERMS.filter(p => (p.key.startsWith('contacts.')||p.key.startsWith('leads.')||p.key.startsWith('tickets.')) && !p.key.endsWith('.delete')).map(p => p.id),
  role_viewer:  PERMS.filter(p => p.key.endsWith('.read')).map(p => p.id),
};
Object.entries(ROLE_PERMS).forEach(([roleId, permIds]) => {
  permIds.forEach(pid => {
    if (!findOne('role_permissions', rp => rp.role_id===roleId && rp.permission_id===pid))
      insert('role_permissions', { role_id: roleId, permission_id: pid });
  });
});

// ── Seed admin user ───────────────────────────────────────────────────────────
if (!findOne('users', u => u.email === 'admin@crm.local')) {
  const adminId = randomUUID();
  insert('users', { id:adminId, name:'CRM Admin', email:'admin@crm.local', password_hash:bcrypt.hashSync('admin123',12), is_active:1, created_at:new Date().toISOString() });
  insert('user_roles', { user_id:adminId, role_id:'role_admin' });
  console.log('Seeded default admin: admin@crm.local / admin123');
}

// ── getUserPermissions ────────────────────────────────────────────────────────
function getUserPermissions(userId) {
  const roleIds = findAll('user_roles', ur => ur.user_id === userId).map(ur => ur.role_id);
  const permIds = findAll('role_permissions', rp => roleIds.includes(rp.role_id)).map(rp => rp.permission_id);
  const keys    = findAll('permissions', p => permIds.includes(p.id)).map(p => p.key);
  return new Set(keys);
}

module.exports = { col, findById, findOne, findAll, insert, update, remove, save, getUserPermissions };


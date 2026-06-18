const express = require('express');
const { randomUUID } = require('crypto');
const { query, findById, findOne, insert, update, remove, getUserPermissions } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();
router.use(authenticate);

async function canEditAll(userId) {
  const p = await getUserPermissions(userId);
  return p.has('users.read');
}

function sanitize(val, maxLen = 500) {
  if (val === null || val === undefined) return null;
  return String(val).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

function makeRouter(table, rP, cP, uP, dP, fields) {
  const r = express.Router();

  r.get('/', authorize(rP), async (req, res) => {
    try {
      const isAdmin = await canEditAll(req.user.id);
      const rows = isAdmin
        ? (await query(`SELECT * FROM ${table} ORDER BY created_at DESC`)).rows
        : (await query(`SELECT * FROM ${table} WHERE owner_user_id=$1 ORDER BY created_at DESC`, [req.user.id])).rows;
      res.json(rows);
    } catch(e) { console.error(e); res.status(500).json({ message: 'Server error.' }); }
  });

  r.get('/:id', authorize(rP), async (req, res) => {
    try {
      const row = await findById(table, req.params.id);
      const isAdmin = await canEditAll(req.user.id);
      if (!row || (!isAdmin && row.owner_user_id !== req.user.id))
        return res.status(404).json({ message: 'Not found.' });
      res.json(row);
    } catch(e) { res.status(500).json({ message: 'Server error.' }); }
  });

  r.post('/', authorize(cP), async (req, res) => {
    try {
      const now    = new Date().toISOString();
      const record = { id: randomUUID(), owner_user_id: req.user.id, created_at: now, updated_at: now };
      for (const f of fields) {
        const raw = req.body[f.key];
        record[f.col] = (raw !== undefined && raw !== null) ? sanitize(raw, f.maxLen || 500) : (f.default ?? null);
        if (f.required && !record[f.col])
          return res.status(400).json({ message: `${f.key} is required.` });
      }
      await insert(table, record);
      res.status(201).json(record);
    } catch(e) { console.error(e); res.status(500).json({ message: 'Server error.' }); }
  });

  r.put('/:id', authorize(uP), async (req, res) => {
    try {
      const row = await findById(table, req.params.id);
      const isAdmin = await canEditAll(req.user.id);
      if (!row || (!isAdmin && row.owner_user_id !== req.user.id))
        return res.status(404).json({ message: 'Not found or forbidden.' });
      const changes = {};
      for (const f of fields) {
        if (req.body[f.key] !== undefined)
          changes[f.col] = sanitize(req.body[f.key], f.maxLen || 500);
      }
      if (Object.keys(changes).length) await update(table, req.params.id, changes);
      res.json({ message: 'Updated.' });
    } catch(e) { res.status(500).json({ message: 'Server error.' }); }
  });

  r.delete('/:id', authorize(dP), async (req, res) => {
    try {
      const row = await findById(table, req.params.id);
      const isAdmin = await canEditAll(req.user.id);
      if (!row || (!isAdmin && row.owner_user_id !== req.user.id))
        return res.status(404).json({ message: 'Not found or forbidden.' });
      await remove(table, { id: req.params.id });
      res.json({ message: 'Deleted.' });
    } catch(e) { res.status(500).json({ message: 'Server error.' }); }
  });

  return r;
}

router.use('/contacts', makeRouter('contacts', 'contacts.read', 'contacts.create', 'contacts.update', 'contacts.delete', [
  { col:'name',           key:'name',           required:true, maxLen:100 },
  { col:'email',          key:'email',          required:true, maxLen:254 },
  { col:'secondary_email',key:'secondaryEmail', maxLen:254 },
  { col:'phone',          key:'phone',          maxLen:20  },
  { col:'company',        key:'company',        maxLen:200 },
  { col:'gender',         key:'gender',         maxLen:20  },
  { col:'age',            key:'age'  },
  { col:'location',       key:'location',       maxLen:200 },
  { col:'qualification',  key:'qualification',  maxLen:100 },
  { col:'specialization', key:'specialization', maxLen:200 },
  { col:'university',     key:'university',     maxLen:200 },
  { col:'designation',    key:'designation',    maxLen:200 },
]));

router.use('/leads', makeRouter('leads', 'leads.read', 'leads.create', 'leads.update', 'leads.delete', [
  { col:'contact_id', key:'contactId' },
  { col:'title',      key:'title',    required:true, maxLen:200 },
  { col:'stage',      key:'stage',    default:'New', maxLen:50  },
  { col:'value',      key:'value',    default:0 },
]));

router.use('/tickets', makeRouter('tickets', 'tickets.read', 'tickets.create', 'tickets.update', 'tickets.delete', [
  { col:'contact_id', key:'contactId' },
  { col:'title',      key:'title',    required:true, maxLen:200 },
  { col:'priority',   key:'priority', default:'Medium', maxLen:20 },
  { col:'status',     key:'status',   default:'Open',   maxLen:50 },
]));

module.exports = router;

// ── Permission Matrix API ─────────────────────────────────────────────────────
router.get('/admin/permissions', authenticate, async (req, res) => {
  try {
    const roles = await query('SELECT * FROM roles ORDER BY id');
    const perms = await query('SELECT * FROM permissions ORDER BY key');
    const matrix = await query('SELECT * FROM role_permissions');
    res.json({ roles: roles.rows, permissions: perms.rows, matrix: matrix.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/permissions/toggle', authenticate, async (req, res) => {
  try {
    const { role_id, permission_id, granted } = req.body;
    if (!role_id || !permission_id) return res.status(400).json({ error: 'role_id and permission_id required' });
    if (granted) {
      await query('INSERT INTO role_permissions(role_id, permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [role_id, permission_id]);
    } else {
      await query('DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=$2', [role_id, permission_id]);
    }
    res.json({ ok: true, role_id, permission_id, granted });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Projects API ──────────────────────────────────────────────────────────────
router.get('/projects', authenticate, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM projects ORDER BY updated_at DESC');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/projects', authenticate, async (req, res) => {
  try {
    const { name, description, status='planning', priority='medium', start_date, end_date, budget, tags } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows: [project] } = await query(
      'INSERT INTO projects(name,description,status,priority,start_date,end_date,budget,tags,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [name, description, status, priority, start_date||null, end_date||null, budget||null, tags||[], req.user?.id]
    );
    res.status(201).json(project);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.put('/projects/:id', authenticate, async (req, res) => {
  try {
    const { name, description, status, priority, start_date, end_date, budget, tags } = req.body;
    const { rows: [p] } = await query(
      'UPDATE projects SET name=$1,description=$2,status=$3,priority=$4,start_date=$5,end_date=$6,budget=$7,tags=$8,updated_at=NOW() WHERE id=$9 RETURNING *',
      [name, description, status, priority, start_date||null, end_date||null, budget||null, tags||[], req.params.id]
    );
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/projects/:id', authenticate, async (req, res) => {
  try {
    await query('DELETE FROM projects WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

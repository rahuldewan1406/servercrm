const express = require('express');
const { randomUUID } = require('crypto');
const { findAll, findById, insert, update, remove, getUserPermissions } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();
router.use(authenticate);

function canEditAll(userId) { return getUserPermissions(userId).has('users.read'); }

// Sanitize string inputs — strip HTML tags, limit length
function sanitize(val, maxLen = 500) {
  if (val === null || val === undefined) return null;
  return String(val).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

function makeRouter(table, rP, cP, uP, dP, fields) {
  const r = express.Router();

  r.get('/', authorize(rP), (req, res) => {
    const rows = canEditAll(req.user.id) ? findAll(table) : findAll(table, row => row.owner_user_id === req.user.id);
    res.json(rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
  });

  r.get('/:id', authorize(rP), (req, res) => {
    const row = findById(table, req.params.id);
    if (!row || (!canEditAll(req.user.id) && row.owner_user_id !== req.user.id)) return res.status(404).json({ message: 'Not found.' });
    res.json(row);
  });

  r.post('/', authorize(cP), (req, res) => {
    const now    = new Date().toISOString();
    const record = { id: randomUUID(), owner_user_id: req.user.id, created_at: now, updated_at: now };
    fields.forEach(f => {
      const raw = req.body[f.key];
      record[f.col] = (raw !== undefined && raw !== null) ? sanitize(raw, f.maxLen || 500) : (f.default ?? null);
    });
    // Required field check
    const required = fields.filter(f => f.required);
    for (const f of required) {
      if (!record[f.col]) return res.status(400).json({ message: `${f.key} is required.` });
    }
    insert(table, record);
    res.status(201).json(record);
  });

  r.put('/:id', authorize(uP), (req, res) => {
    const row = findById(table, req.params.id);
    if (!row || (!canEditAll(req.user.id) && row.owner_user_id !== req.user.id)) return res.status(404).json({ message: 'Not found or forbidden.' });
    const changes = {};
    fields.forEach(f => { if (req.body[f.key] !== undefined) changes[f.col] = sanitize(req.body[f.key], f.maxLen || 500); });
    update(table, req.params.id, changes);
    res.json({ message: 'Updated.' });
  });

  r.delete('/:id', authorize(dP), (req, res) => {
    const row = findById(table, req.params.id);
    if (!row || (!canEditAll(req.user.id) && row.owner_user_id !== req.user.id)) return res.status(404).json({ message: 'Not found or forbidden.' });
    remove(table, r => r.id === req.params.id);
    res.json({ message: 'Deleted.' });
  });

  return r;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.use('/contacts', makeRouter('contacts', 'contacts.read', 'contacts.create', 'contacts.update', 'contacts.delete', [
  { col: 'name',            key: 'name',           required: true,  maxLen: 100 },
  { col: 'email',           key: 'email',          required: true,  maxLen: 254 },
  { col: 'secondary_email', key: 'secondaryEmail', maxLen: 254 },
  { col: 'phone',           key: 'phone',          maxLen: 20  },
  { col: 'company',         key: 'company',        maxLen: 200 },
  { col: 'gender',          key: 'gender',         maxLen: 20  },
  { col: 'age',             key: 'age',            maxLen: 3   },
  { col: 'location',        key: 'location',       maxLen: 200 },
  { col: 'qualification',   key: 'qualification',  maxLen: 100 },
  { col: 'specialization',  key: 'specialization', maxLen: 200 },
  { col: 'university',      key: 'university',     maxLen: 200 },
  { col: 'designation',     key: 'designation',    maxLen: 200 },
]));

router.use('/leads', makeRouter('leads', 'leads.read', 'leads.create', 'leads.update', 'leads.delete', [
  { col: 'contact_id', key: 'contactId' },
  { col: 'title',      key: 'title',    required: true, maxLen: 200 },
  { col: 'stage',      key: 'stage',    default: 'New', maxLen: 50  },
  { col: 'value',      key: 'value',    default: 0 },
]));

router.use('/tickets', makeRouter('tickets', 'tickets.read', 'tickets.create', 'tickets.update', 'tickets.delete', [
  { col: 'contact_id', key: 'contactId' },
  { col: 'title',      key: 'title',    required: true, maxLen: 200 },
  { col: 'priority',   key: 'priority', default: 'Medium', maxLen: 20 },
  { col: 'status',     key: 'status',   default: 'Open',   maxLen: 50 },
]));

module.exports = router;

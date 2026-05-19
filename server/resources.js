const express = require('express');
const { randomUUID } = require('crypto');
const { findAll, findById, insert, update, remove, getUserPermissions } = require('./db');
const { authenticate, authorize } = require('./middleware');

const router = express.Router();
router.use(authenticate);

function canEditAll(userId) { return getUserPermissions(userId).has('users.read'); }

function makeRouter(table, rP, cP, uP, dP, fields) {
  const r = express.Router();

  r.get('/', authorize(rP), (req, res) => {
    const rows = canEditAll(req.user.id) ? findAll(table) : findAll(table, row => row.owner_user_id===req.user.id);
    res.json(rows.sort((a,b) => (b.created_at||'').localeCompare(a.created_at||'')));
  });

  r.get('/:id', authorize(rP), (req, res) => {
    const row = findById(table, req.params.id);
    if (!row || (!canEditAll(req.user.id) && row.owner_user_id!==req.user.id)) return res.status(404).json({ message:'Not found.' });
    res.json(row);
  });

  r.post('/', authorize(cP), (req, res) => {
    const now = new Date().toISOString();
    const record = { id:randomUUID(), owner_user_id:req.user.id, created_at:now, updated_at:now };
    fields.forEach(f => { record[f.col] = req.body[f.key] ?? f.default ?? null; });
    insert(table, record);
    res.status(201).json(record);
  });

  r.put('/:id', authorize(uP), (req, res) => {
    const row = findById(table, req.params.id);
    if (!row || (!canEditAll(req.user.id) && row.owner_user_id!==req.user.id)) return res.status(404).json({ message:'Not found or forbidden.' });
    const changes = {};
    fields.forEach(f => { if (req.body[f.key] !== undefined) changes[f.col] = req.body[f.key]; });
    update(table, req.params.id, changes);
    res.json({ message:'Updated.' });
  });

  r.delete('/:id', authorize(dP), (req, res) => {
    const row = findById(table, req.params.id);
    if (!row || (!canEditAll(req.user.id) && row.owner_user_id!==req.user.id)) return res.status(404).json({ message:'Not found or forbidden.' });
    remove(table, r => r.id===req.params.id);
    res.json({ message:'Deleted.' });
  });

  return r;
}

router.use('/contacts', makeRouter('contacts','contacts.read','contacts.create','contacts.update','contacts.delete',[
  {col:'name',key:'name'},{col:'email',key:'email'},{col:'secondary_email',key:'secondaryEmail'},
  {col:'phone',key:'phone'},{col:'company',key:'company'},{col:'gender',key:'gender'},
  {col:'age',key:'age'},{col:'location',key:'location'},
]));
router.use('/leads', makeRouter('leads','leads.read','leads.create','leads.update','leads.delete',[
  {col:'contact_id',key:'contactId'},{col:'title',key:'title'},{col:'stage',key:'stage',default:'New'},{col:'value',key:'value',default:0},
]));
router.use('/tickets', makeRouter('tickets','tickets.read','tickets.create','tickets.update','tickets.delete',[
  {col:'contact_id',key:'contactId'},{col:'title',key:'title'},{col:'priority',key:'priority',default:'Medium'},{col:'status',key:'status',default:'Open'},
]));

module.exports = router;


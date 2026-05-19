const jwt = require('jsonwebtoken');
const { getUserPermissions } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'crm-dev-secret-change-in-production';

function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: 'Invalid or expired token.' }); }
}

function authorize(permission) {
  return (req, res, next) => {
    if (!getUserPermissions(req.user.id).has(permission))
      return res.status(403).json({ message: `Forbidden: need '${permission}'.` });
    next();
  };
}

module.exports = { authenticate, authorize, JWT_SECRET };


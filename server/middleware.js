const jwt  = require('jsonwebtoken');
const { getUserPermissions, findById } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET env variable not set in production');
  process.exit(1);
}
const EFFECTIVE_SECRET = JWT_SECRET || 'crm-dev-secret-change-in-production-min-32-chars';

function authenticate(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const decoded = jwt.verify(token, EFFECTIVE_SECRET);
    // Re-check is_active on every request (catch suspended users mid-session)
    const user = findById('users', decoded.id);
    if (!user || user.is_active === 0) return res.status(401).json({ message: 'Account suspended or not found.' });
    req.user = decoded;
    next();
  } catch(e) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

function authorize(permission) {
  return (req, res, next) => {
    const perms = getUserPermissions(req.user.id);
    if (!perms.has(permission)) return res.status(403).json({ message: `Forbidden: need '${permission}'.` });
    next();
  };
}

// Security headers middleware
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

module.exports = { authenticate, authorize, JWT_SECRET: EFFECTIVE_SECRET, securityHeaders };

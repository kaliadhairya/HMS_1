const { validateToken } = require('../utils/identityClient');
const { readTrustedContext } = require('./trustedContext');

function resolveBearerToken(req) {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  if (typeof req.query.token === 'string' && process.env.ALLOW_QUERY_TOKEN === 'true') return req.query.token;
  return null;
}

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Permission = require('../models/Permission');

const protect = async (req, res, next) => {
  try {
    const trusted = readTrustedContext(req);
    if (trusted) {
      req.user = trusted;
      return next();
    }
    const token = resolveBearerToken(req);
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });

    // 1. Try remote Identity Service if configured
    if (process.env.INTERNAL_SERVICE_SECRET && process.env.IDENTITY_URL) {
      try {
        const context = await validateToken(token, req.headers['x-request-id']);
        if (context) {
          req.user = context;
          return next();
        }
      } catch (err) {
        // Fall through to local validation
      }
    }

    // 2. Resilient Local JWT + Database validation fallback
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_super_secret_jwt_key');
      if (!decoded || !decoded.id) {
        return res.status(401).json({ success: false, message: 'Invalid token.' });
      }

      const user = await User.findByPk(decoded.id);
      if (!user || user.isActive === 0) {
        return res.status(401).json({ success: false, message: 'User not found or deactivated.' });
      }

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(423).json({ success: false, message: 'Account is temporarily locked.' });
      }

      let permissions = [];
      try {
        const dbPerms = await Permission.findAll({ where: { role: user.role } });
        permissions = dbPerms.map((p) => ({
          module: p.module,
          read: p.can_read === 'Y',
          write: p.can_write === 'Y',
          edit: p.can_edit === 'Y',
          delete: p.can_delete === 'Y',
        }));
      } catch {
        permissions = [];
      }

      req.user = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        department_id: user.department_id,
        first_login: user.first_login,
        permissions,
      };
      return next();
    } catch (jwtErr) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
  } catch (error) {
    console.error('Identity validation error:', error.message);
    return res.status(503).json({ success: false, message: 'Authentication service is temporarily unavailable.' });
  }
};

const restrictTo = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
  }
  return next();
};

const checkPermission = (module, action) => (req, res, next) => {
  const role = req.user?.role;
  if (!role) return res.status(403).json({ success: false, message: 'Access denied.' });
  if (role === 'super_admin' || role === 'admin') return next();
  if (!['read', 'write', 'edit', 'delete'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid permission action.' });
  }
  const permission = req.user.permissions?.find((entry) => entry.module === module);
  if (!permission?.[action]) {
    return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' });
  }
  return next();
};

module.exports = { protect, restrictTo, checkPermission };

const { validateToken } = require('../utils/identityClient');
const { readTrustedContext } = require('./trustedContext');

const { verifySessionToken } = require('../utils/authTokens');
const { COOKIE_NAME, checkSession, readCookie } = require('../utils/sessions');

// Browsers send the session in an HttpOnly cookie; scripts and services send
// a bearer token.
function resolveToken(req) {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return { token: authorization.slice(7), source: 'bearer' };
  const cookie = readCookie(req.headers.cookie, COOKIE_NAME);
  if (cookie) return { token: cookie, source: 'cookie' };
  if (typeof req.query.token === 'string' && process.env.ALLOW_QUERY_TOKEN === 'true') return { token: req.query.token, source: 'query' };
  return { token: null, source: null };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// A cookie is sent automatically, so a state-changing request authenticated
// by one must also carry a header a cross-site form cannot set.
function failsCsrfCheck(req, source) {
  return source === 'cookie' && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest';
}

const User = require('../models/User');
const Permission = require('../models/Permission');

const identityServiceEnabled = () => Boolean(process.env.INTERNAL_SERVICE_SECRET && process.env.IDENTITY_URL);

// Signed auth-context headers are only honoured behind an explicitly enabled gateway.
const trustedGatewayEnabled = () => process.env.TRUST_GATEWAY_AUTH_CONTEXT === 'true';

const protect = async (req, res, next) => {
  try {
    const trusted = trustedGatewayEnabled() ? readTrustedContext(req) : null;
    if (trusted) {
      req.user = trusted;
      return next();
    }
    const { token, source } = resolveToken(req);
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    if (failsCsrfCheck(req, source)) {
      return res.status(403).json({ success: false, message: 'Request blocked: missing X-Requested-With header.' });
    }

    // When an Identity Service is configured it is the only authority: a
    // rejected or unverifiable token never falls back to local validation.
    if (identityServiceEnabled()) {
      let context;
      try {
        context = await validateToken(token, req.headers['x-request-id']);
      } catch (err) {
        console.error('Identity service unavailable:', err.message);
        return res.status(503).json({ success: false, message: 'Authentication service is temporarily unavailable.' });
      }
      if (!context) return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
      req.user = context;
      return next();
    }

    let decoded;
    try {
      decoded = verifySessionToken(token);
    } catch (tokenErr) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
    {
      const user = await User.findByPk(decoded.id);
      if (!user || user.isActive === 0) {
        return res.status(401).json({ success: false, message: 'User not found or deactivated.' });
      }

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(423).json({ success: false, message: 'Account is temporarily locked.' });
      }

      const sessionProblem = await checkSession(decoded.sid, user.id, user.role);
      if (sessionProblem) return res.status(401).json({ success: false, message: sessionProblem });

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
        sessionId: decoded.sid,
        permissions,
      };
      return next();
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

// Verify a token without an HTTP request (used by socket.io). Returns the user or null.
const resolveTokenUser = async (token) => {
  try {
    const decoded = verifySessionToken(token);
    const user = await User.findByPk(decoded.id);
    if (!user || user.isActive === 0) return null;
    if (user.locked_until && new Date(user.locked_until) > new Date()) return null;
    if (await checkSession(decoded.sid, user.id, user.role)) return null;
    return { id: user.id, username: user.username, name: user.name, role: user.role, sessionId: decoded.sid };
  } catch {
    return null;
  }
};

// The session token a socket handshake carries: explicit auth, bearer header, or the session cookie.
function socketToken(handshake) {
  const authorization = handshake.headers.authorization;
  return handshake.auth?.token
    || (authorization?.startsWith('Bearer ') ? authorization.slice(7) : null)
    || readCookie(handshake.headers.cookie, COOKIE_NAME);
}

module.exports = { protect, restrictTo, checkPermission, resolveTokenUser, socketToken, identityServiceEnabled };

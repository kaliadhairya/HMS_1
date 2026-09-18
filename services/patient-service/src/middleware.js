const crypto = require('crypto');
function requireContext(config) {
  return (req, res, next) => {
    const context = req.headers['x-auth-context']; const signature = req.headers['x-auth-context-signature']; const timestamp = req.headers['x-auth-context-timestamp'];
    if (!context || !signature || !timestamp || req.headers['x-internal-service'] !== 'api-gateway') return res.status(401).json({ success: false, message: 'Trusted authentication context required.' });
    if (!/^\d+$/.test(String(timestamp)) || Math.abs(Date.now() - Number(timestamp)) > 30000) return res.status(401).json({ success: false, message: 'Authentication context expired.' });
    const expected = crypto.createHmac('sha256', config.internalServiceSecret).update(`${req.headers['x-request-id']}.${timestamp}.${context}`).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))) return res.status(401).json({ success: false, message: 'Invalid authentication context.' });
    try { req.user = JSON.parse(Buffer.from(context, 'base64url').toString('utf8')); } catch { return res.status(401).json({ success: false, message: 'Invalid authentication context.' }); }
    next();
  };
}
function requireInternal(config) { return (req, res, next) => req.headers['x-internal-service-token'] === config.internalServiceSecret ? next() : res.status(401).json({ success: false, message: 'Trusted service identity required.' }); }
function requireRole(...roles) { return (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ success: false, message: 'Insufficient role.' }); }
module.exports = { requireContext, requireInternal, requireRole };

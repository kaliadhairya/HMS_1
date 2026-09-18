function bearerToken(req) {
  const value = req.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}

function createAuthMiddleware(authService) {
  async function protect(req, res, next) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    try {
      const decoded = authService.verifyAccessToken(token);
      const context = await authService.buildContext(decoded.id);
      if (!context) return res.status(401).json({ success: false, message: 'User not found, deactivated, or session terminated.' });
      req.user = context;
      return next();
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
  }

  function restrictTo(...roles) {
    return (req, res, next) => roles.includes(req.user?.role)
      ? next()
      : res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
  }

  function requireInternal(req, res, next) {
    const supplied = req.headers['x-internal-service-token'];
    if (!supplied || supplied !== authService.config.internalServiceSecret) {
      return res.status(401).json({ success: false, error: { code: 'INVALID_SERVICE_IDENTITY', message: 'Trusted service identity required.' } });
    }
    return next();
  }

  return { protect, restrictTo, requireInternal };
}

module.exports = { createAuthMiddleware };

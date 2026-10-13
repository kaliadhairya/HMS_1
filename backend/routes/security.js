const express = require('express');
const router = express.Router();
const os = require('os');
const { QueryTypes, Op } = require('sequelize');
const { protect, restrictTo } = require('../middleware/auth');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { sequelize } = require('../models/db');
const { logAction } = require('../utils/auditLogger');
const { revokeUserSessions } = require('../utils/sessions');

// Shared settings store
const securitySettings = require('../utils/settings');

// ── IP allow/block lists ─────────────────────────────────────────────────────
// Rules are single IPv4/IPv6 addresses or IPv4 CIDR ranges ("10.0.0.0/8"). Sign-in (routes/auth.js) checks them.
const net = require('net');
const LOOPBACK = ['127.0.0.1', '::1'];
const normalizeIp = (ip) => {
  let v = String(ip || '').trim();
  if (v.toLowerCase().startsWith('::ffff:') && net.isIPv4(v.slice(7))) v = v.slice(7);
  return v.toLowerCase();
};
const ipv4ToInt = (ip) => ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
function parseIpRule(rule) {
  const text = String(rule || '').trim();
  const parts = text.split('/');
  if (!text || parts.length > 2) return null;
  const addr = normalizeIp(parts[0]);
  if (net.isIPv4(addr)) {
    if (parts.length === 2 && !/^\d{1,2}$/.test(parts[1])) return null;
    const bits = parts.length === 2 ? Number(parts[1]) : 32;
    if (bits < 1 || bits > 32) return null;
    return { v: 4, base: ipv4ToInt(addr), bits, text };
  }
  if (net.isIPv6(addr) && parts.length === 1) return { v: 6, addr, text };
  return null;
}
function ipRuleMatches(rule, ip) {
  const parsed = parseIpRule(rule);
  const addr = normalizeIp(ip);
  if (!parsed || !addr) return false;
  if (parsed.v === 6) return parsed.addr === addr;
  if (!net.isIPv4(addr)) return false;
  const size = 2 ** (32 - parsed.bits);
  return Math.floor(ipv4ToInt(addr) / size) === Math.floor(parsed.base / size);
}
const ipAccess = {
  normalizeIp,
  parseRule: parseIpRule,
  matches: ipRuleMatches,
  isAllowed(ip, settings) {
    const block = settings.ip_blacklist || [];
    const allow = settings.ip_whitelist || [];
    if (block.some((rule) => ipRuleMatches(rule, ip))) return false;
    if (allow.length > 0 && !allow.some((rule) => ipRuleMatches(rule, ip))) return false;
    return true;
  },
};

const serverStartTime = Date.now();
const errorLogs = []; // In-memory error log buffer

// Capture console.error for error logs
const originalError = console.error;
console.error = function (...args) {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  errorLogs.push({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    message: msg.substring(0, 500),
    module: 'server',
  });
  if (errorLogs.length > 500) errorLogs.shift(); // Keep last 500
  originalError.apply(console, args);
};

// ═══════════════════════════════════════════════════════
// 1. SECURITY CENTER — /api/security/center
// ═══════════════════════════════════════════════════════
router.get('/center', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    // Failed logins today
    const failedToday = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM HMS_AUDIT_LOGS WHERE ACTION = 'LOGIN_FAILED' AND CREATED_AT >= :today`,
      { replacements: { today }, type: sequelize.QueryTypes.SELECT }
    );

    // Failed logins this week
    const failedWeek = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM HMS_AUDIT_LOGS WHERE ACTION = 'LOGIN_FAILED' AND CREATED_AT >= :weekAgo`,
      { replacements: { weekAgo }, type: sequelize.QueryTypes.SELECT }
    );

    // Locked accounts
    const lockedAccounts = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM HMS_USERS WHERE LOCKED_UNTIL IS NOT NULL AND LOCKED_UNTIL > :now`,
      { replacements: { now }, type: sequelize.QueryTypes.SELECT }
    );

    // Recent failed login attempts (last 20)
    const recentFailed = await sequelize.query(
      `SELECT a.*, u.USERNAME, u.NAME as USER_NAME 
       FROM HMS_AUDIT_LOGS a 
       LEFT JOIN HMS_USERS u ON a.USER_ID = u.ID 
       WHERE a.ACTION = 'LOGIN_FAILED' 
       ORDER BY a.CREATED_AT DESC
       LIMIT 20`,
      { type: sequelize.QueryTypes.SELECT }
    );

    // Suspicious IPs (3+ failed attempts from same IP today)
    const suspiciousIPs = await sequelize.query(
      `SELECT IP_ADDRESS, COUNT(*) AS ATTEMPTS 
       FROM HMS_AUDIT_LOGS 
       WHERE ACTION = 'LOGIN_FAILED' AND CREATED_AT >= :today AND IP_ADDRESS IS NOT NULL
       GROUP BY IP_ADDRESS 
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC`,
      { replacements: { today }, type: sequelize.QueryTypes.SELECT }
    );

    // Total logins today
    const loginsToday = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM HMS_AUDIT_LOGS WHERE ACTION = 'LOGIN' AND CREATED_AT >= :today`,
      { replacements: { today }, type: sequelize.QueryTypes.SELECT }
    );

    res.json({
      success: true,
      data: {
        failed_logins_today: Number(failedToday[0]?.CNT || failedToday[0]?.cnt || 0),
        failed_logins_week: Number(failedWeek[0]?.CNT || failedWeek[0]?.cnt || 0),
        locked_accounts: Number(lockedAccounts[0]?.CNT || lockedAccounts[0]?.cnt || 0),
        logins_today: Number(loginsToday[0]?.CNT || loginsToday[0]?.cnt || 0),
        recent_failed: recentFailed.slice(0, 20),
        suspicious_ips: suspiciousIPs,
        blocked_ips: securitySettings.ip_blacklist,
      },
    });
  } catch (err) {
    console.error('Security center error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load security center.' });
  }
});

// ═══════════════════════════════════════════════════════
// 2. SESSION MANAGER — /api/security/sessions
// ═══════════════════════════════════════════════════════
router.get('/sessions', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    // Get recently active users (logged in within last 24 hours)
    const activeSessions = await sequelize.query(
      `SELECT u.ID as "ID", u.USERNAME as "USERNAME", u.NAME as "NAME", u.ROLE as "ROLE", u.LAST_LOGIN as "LAST_LOGIN",
              u.FAILED_ATTEMPTS as "FAILED_ATTEMPTS", u.LOCKED_UNTIL as "LOCKED_UNTIL", u.IS_ACTIVE as "IS_ACTIVE",
              COUNT(s.id)::int as "ACTIVE_SESSIONS", MAX(s.last_seen_at) as "LAST_SEEN"
       FROM HMS_USERS u
       LEFT JOIN hms_sessions s ON s.user_id = u.ID AND s.revoked_at IS NULL AND s.expires_at > now()
       WHERE u.LAST_LOGIN IS NOT NULL
       GROUP BY u.ID
       ORDER BY u.LAST_LOGIN DESC`,
      { type: sequelize.QueryTypes.SELECT }
    );

    res.json({
      success: true,
      data: {
        sessions: activeSessions,
        timeout_settings: securitySettings.session_timeout,
      },
    });
  } catch (err) {
    console.error('Session manager error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load sessions.' });
  }
});

// Force logout a user (temporary lock)
router.post('/sessions/:userId/force-logout', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid user.' });
    }
    if (userId === Number(req.user.id)) {
      return res.status(400).json({ success: false, message: 'You cannot end your own session here. Sign out instead.' });
    }
    const target = await User.findByPk(userId);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });
    const ended = await revokeUserSessions(userId, `forced logout by user ${req.user.id}`, { io: req.app.get('io') });
    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'FORCE_LOGOUT', 'security', userId, null, { target_user: userId, sessions_ended: ended }, ip);
    res.json({ success: true, message: ended ? `Ended ${ended} session(s).` : 'The user had no active sessions.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to force logout.' });
  }
});

// Update session timeout settings
router.put('/sessions/timeout', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const updated = await securitySettings.saveSetting('session_timeout', (current) => ({ ...current, ...req.body }), req.user.id);
    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'security', null, null, { action: 'session_timeout_updated', settings: updated }, ip);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update timeout.' });
  }
});

// ═══════════════════════════════════════════════════════
// 3. 2FA MANAGEMENT — /api/security/2fa
// ═══════════════════════════════════════════════════════
router.get('/2fa', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const totalUsers = await sequelize.query(`SELECT COUNT(*) AS cnt FROM HMS_USERS WHERE IS_ACTIVE = 1`, { type: sequelize.QueryTypes.SELECT });
    const roleBreakdown = await sequelize.query(
      `SELECT ROLE, COUNT(*) AS cnt FROM HMS_USERS WHERE IS_ACTIVE = 1 GROUP BY ROLE`,
      { type: sequelize.QueryTypes.SELECT }
    );

    res.json({
      success: true,
      data: {
        enforced_roles: securitySettings.twofa_enforced_roles,
        total_users: Number(totalUsers[0]?.CNT || totalUsers[0]?.cnt || 0),
        role_breakdown: roleBreakdown,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load 2FA settings.' });
  }
});

router.put('/2fa', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const updated = await securitySettings.saveSetting('twofa_enforced_roles', req.body.enforced_roles || [], req.user.id);
    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'security', null, null, { action: '2fa_config_updated', roles: updated }, ip);
    res.json({ success: true, data: { enforced_roles: updated } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update 2FA.' });
  }
});

// ═══════════════════════════════════════════════════════
// 4. IP WHITELIST / BLACKLIST — /api/security/ip-rules
// ═══════════════════════════════════════════════════════
router.get('/ip-rules', protect, restrictTo('super_admin'), (req, res) => {
  res.json({
    success: true,
    data: {
      whitelist: securitySettings.ip_whitelist,
      blacklist: securitySettings.ip_blacklist,
    },
  });
});

router.put('/ip-rules', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || null;
    const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map((r) => String(r || '').trim()).filter(Boolean))];
    const invalidInput = [...clean(req.body.whitelist), ...clean(req.body.blacklist)].filter((rule) => !parseIpRule(rule));
    if (invalidInput.length) return res.status(400).json({ success: false, message: `Not a valid IP address or IPv4 range: ${invalidInput.join(', ')}.` });
    const reject = (message) => { const error = new Error(message); error.status = 400; throw error; };
    const { whitelist, blacklist } = await sequelize.transaction(async (transaction) => {
      const whitelist = await securitySettings.saveSetting('ip_whitelist', (current) => {
        const value = req.body.whitelist === undefined ? current : clean(req.body.whitelist);
        if (value.length && !value.some((rule) => ipRuleMatches(rule, ip))) reject(`The allow list does not include your own address (${normalizeIp(ip)}).`);
        return value;
      }, req.user.id, { transaction });
      const blacklist = await securitySettings.saveSetting('ip_blacklist', (current) => {
        const value = req.body.blacklist === undefined ? current : clean(req.body.blacklist);
        const protectedIps = [...new Set([...LOOPBACK, normalizeIp(ip)].filter(Boolean))];
        if (value.some((rule) => protectedIps.some((address) => ipRuleMatches(rule, address)))) reject('This rule would block this server or your own address.');
        return value;
      }, req.user.id, { transaction });
      return { whitelist, blacklist };
    });
    await logAction(req.user.id, 'UPDATE', 'security', null, null, { action: 'ip_rules_updated' }, ip);
    res.json({ success: true, data: { whitelist, blacklist } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Failed to update IP rules.' });
  }
});

// ═══════════════════════════════════════════════════════
// 5. AUDIT TRAIL — /api/security/audit-trail
// ═══════════════════════════════════════════════════════
router.get('/audit-trail', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const { action, module, user_id, from_date, to_date, page = 1 } = req.query;
    const pageSize = 50;

    let whereClause = '1=1';
    const replacements = {};

    if (action) { whereClause += ` AND a.ACTION = :action`; replacements.action = action; }
    if (module) { whereClause += ` AND a.MODULE = :module`; replacements.module = module; }
    if (user_id) { whereClause += ` AND a.USER_ID = :user_id`; replacements.user_id = user_id; }
    if (from_date) { whereClause += ` AND a.CREATED_AT >= :from_date`; replacements.from_date = new Date(from_date); }
    if (to_date) { whereClause += ` AND a.CREATED_AT <= :to_date`; replacements.to_date = new Date(to_date + 'T23:59:59'); }

    const countResult = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM HMS_AUDIT_LOGS a WHERE ${whereClause}`,
      { replacements, type: QueryTypes.SELECT }
    );
    const total = Number(countResult[0]?.cnt || countResult[0]?.CNT || 0);

    const pageNum = Math.max(1, Number(page) || 1);
    const offset = (pageNum - 1) * pageSize;
    const paginatedReplacements = { ...replacements, limit: pageSize, offset };

    const logs = await sequelize.query(
      `SELECT a.*, u.USERNAME, u.NAME as USER_NAME 
       FROM HMS_AUDIT_LOGS a 
       LEFT JOIN HMS_USERS u ON a.USER_ID = u.ID 
       WHERE ${whereClause} 
       ORDER BY a.CREATED_AT DESC
       LIMIT :limit OFFSET :offset`,
      { replacements: paginatedReplacements, type: QueryTypes.SELECT }
    );

    // Get distinct actions and modules for filter dropdowns
    const actions = await sequelize.query(`SELECT DISTINCT ACTION FROM HMS_AUDIT_LOGS ORDER BY ACTION`, { type: QueryTypes.SELECT });
    const modules = await sequelize.query(`SELECT DISTINCT MODULE FROM HMS_AUDIT_LOGS WHERE MODULE IS NOT NULL ORDER BY MODULE`, { type: QueryTypes.SELECT });

    res.json({
      success: true,
      data: {
        logs,
        total,
        page: pageNum,
        pages: Math.ceil(total / pageSize) || 1,
        filters: {
          actions: actions.map(a => a.ACTION || a.action),
          modules: modules.map(m => m.MODULE || m.module),
        },
      },
    });
  } catch (err) {
    console.error('Audit trail error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load audit trail.' });
  }
});

// ═══════════════════════════════════════════════════════
// 6. SYSTEM HEALTH — /api/security/system-health
// ═══════════════════════════════════════════════════════
router.get('/system-health', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const uptime = Date.now() - serverStartTime;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    // DB check
    const dbStart = Date.now();
    await sequelize.query('SELECT 1+1 AS result');
    const dbResponseTime = Date.now() - dbStart;

    // DB table counts
    const userCount = await sequelize.query(`SELECT COUNT(*) AS cnt FROM HMS_USERS`, { type: sequelize.QueryTypes.SELECT });
    const auditCount = await sequelize.query(`SELECT COUNT(*) AS cnt FROM HMS_AUDIT_LOGS`, { type: sequelize.QueryTypes.SELECT });

    res.json({
      success: true,
      data: {
        server: {
          uptime_ms: uptime,
          uptime_human: formatUptime(uptime),
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          node_version: process.version,
        },
        memory: {
          total_gb: (totalMem / (1024 ** 3)).toFixed(2),
          used_gb: (usedMem / (1024 ** 3)).toFixed(2),
          free_gb: (freeMem / (1024 ** 3)).toFixed(2),
          usage_percent: ((usedMem / totalMem) * 100).toFixed(1),
        },
        cpu: {
          cores: cpus.length,
          model: cpus[0]?.model || 'Unknown',
          load_avg_1m: loadAvg[0]?.toFixed(2) || '0',
          load_avg_5m: loadAvg[1]?.toFixed(2) || '0',
          load_avg_15m: loadAvg[2]?.toFixed(2) || '0',
        },
        database: {
          status: 'connected',
          response_time_ms: dbResponseTime,
          total_users: Number(userCount[0]?.CNT || userCount[0]?.cnt || 0),
          total_audit_logs: Number(auditCount[0]?.CNT || auditCount[0]?.cnt || 0),
        },
        services: [
          { name: 'API Server', status: 'running', uptime: formatUptime(uptime) },
          { name: 'PostgreSQL Database', status: dbResponseTime < 1000 ? 'healthy' : 'slow', response: `${dbResponseTime}ms` },
          { name: 'Authentication', status: 'active' },
          { name: 'Rate Limiter', status: 'active' },
        ],
      },
    });
  } catch (err) {
    console.error('System health error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to get system health.' });
  }
});

// ═══════════════════════════════════════════════════════
// 7. BACKUP & RECOVERY — /api/security/backups
// ═══════════════════════════════════════════════════════
// The application does not take database backups. These endpoints used to
// record a "Completed" backup without writing anything (blueprint F13).
// Backups run on the server with scripts/backup-db.sh, and each one is proven
// restorable with scripts/restore-check.sh.
const BACKUP_GUIDANCE = 'Backups are not run by the application. On the server, run scripts/backup-db.sh and prove each backup with scripts/restore-check.sh.';

router.get('/backups', protect, restrictTo('super_admin'), (req, res) => {
  res.json({ success: true, data: { managed_by_app: false, message: BACKUP_GUIDANCE } });
});

router.post('/backups/trigger', protect, restrictTo('super_admin'), (req, res) => {
  res.status(501).json({ success: false, message: BACKUP_GUIDANCE });
});

// ═══════════════════════════════════════════════════════
// 8. MAINTENANCE MODE — /api/security/maintenance
// ═══════════════════════════════════════════════════════
router.get('/maintenance', protect, restrictTo('super_admin'), (req, res) => {
  res.json({
    success: true,
    data: {
      enabled: securitySettings.maintenance_mode,
      message: securitySettings.maintenance_message,
    },
  });
});

router.put('/maintenance', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const enabled = await securitySettings.saveSetting('maintenance_mode', req.body.enabled ?? false, req.user.id);
    const message = await securitySettings.saveSetting('maintenance_message', (current) => req.body.message || current, req.user.id);
    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'security', null, null, {
      action: enabled ? 'maintenance_enabled' : 'maintenance_disabled',
    }, ip);
    res.json({ success: true, data: { enabled, message } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update maintenance mode.' });
  }
});

// ═══════════════════════════════════════════════════════
// 9. ANNOUNCEMENTS — /api/security/announcements
// ═══════════════════════════════════════════════════════
router.get('/announcements', protect, restrictTo('super_admin'), (req, res) => {
  res.json({ success: true, data: securitySettings.announcements });
});

router.post('/announcements', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const { title, message, severity, target_roles } = req.body;
    const announcement = {
      id: Date.now(),
      title, message, severity: severity || 'info',
      target_roles: target_roles || ['all'],
      created_by: req.user.name,
      created_at: new Date().toISOString(),
      active: true,
    };
    await securitySettings.saveSetting('announcements', (current) => { while (current.some((entry) => entry.id === announcement.id)) announcement.id++; return [announcement, ...current]; }, req.user.id);
    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'CREATE', 'announcements', null, null, { title }, ip);
    res.json({ success: true, data: announcement });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create announcement.' });
  }
});

router.delete('/announcements/:id', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    await securitySettings.saveSetting('announcements', (current) => current.filter(a => String(a.id) !== req.params.id), req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete.' });
  }
});

// ═══════════════════════════════════════════════════════
// 10. ERROR LOGS — /api/security/error-logs
// ═══════════════════════════════════════════════════════
router.get('/error-logs', protect, restrictTo('super_admin'), (req, res) => {
  res.json({ success: true, data: errorLogs.slice().reverse().slice(0, 100) });
});

// ═══════════════════════════════════════════════════════
// 11. API KEYS — /api/security/api-keys
// ═══════════════════════════════════════════════════════
router.get('/api-keys', protect, restrictTo('super_admin'), (req, res) => {
  // Stored keys are hashes; the list shows only each key's prefix.
  res.json({ success: true, data: securitySettings.api_keys.map(({ key_hash: _hash, ...k }) => k) });
});

router.post('/api-keys', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const { name, permissions } = req.body;
    const key = 'hms_' + require('crypto').randomBytes(24).toString('hex');
    const stored = {
      id: Date.now(),
      name, permissions: permissions || ['read'],
      key_prefix: key.slice(0, 10),
      key_hash: securitySettings.hashApiKey(key),
      created_at: new Date().toISOString(),
      last_used: null,
      requests: 0,
      active: true,
    };
    await securitySettings.saveSetting('api_keys', (current) => { while (current.some((entry) => entry.id === stored.id)) stored.id++; return [...current, stored]; }, req.user.id);
    // The full key is returned this once and never stored.
    const { key_hash: _hash, ...shown } = stored;
    const apiKey = { ...shown, key };
    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'CREATE', 'api_keys', null, null, { name }, ip);
    res.json({ success: true, data: apiKey });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create API key.' });
  }
});

router.delete('/api-keys/:id', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    await securitySettings.saveSetting('api_keys', (current) => current.filter(k => String(k.id) !== req.params.id), req.user.id);
    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'DELETE', 'api_keys', null, null, { id: req.params.id }, ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to revoke API key.' });
  }
});

// ═══════════════════════════════════════════════════════
// 12. INTEGRATION HUB — /api/security/integrations
// ═══════════════════════════════════════════════════════

router.get('/integrations', protect, restrictTo('super_admin'), (req, res) => {
  res.json({ success: true, data: securitySettings.integrations });
});

router.put('/integrations/:id/toggle', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    let intg;
    await securitySettings.saveSetting('integrations', (current) => current.map((entry) => {
      if (entry.id !== Number(req.params.id)) return entry;
      intg = { ...entry, status: entry.status === 'active' ? 'inactive' : 'active' };
      return intg;
    }), req.user.id);
    if (!intg) return res.status(404).json({ success: false, message: 'Not found' });
    await logAction(req.user.id, 'UPDATE', 'integrations', intg.id, null, { name: intg.name, status: intg.status }, req.ip);
    res.json({ success: true, data: intg });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to update integration.' }); }
});

// ═══════════════════════════════════════════════════════
// 13. NOTIFICATION CONFIG — /api/security/notifications
// ═══════════════════════════════════════════════════════

router.get('/notifications', protect, restrictTo('super_admin'), (req, res) => {
  res.json({ success: true, data: securitySettings.notification_rules });
});

router.put('/notifications/:id/toggle', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    let rule;
    await securitySettings.saveSetting('notification_rules', (current) => current.map((entry) => {
      if (entry.id !== Number(req.params.id)) return entry;
      rule = { ...entry, active: !entry.active };
      return rule;
    }), req.user.id);
    if (!rule) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: rule });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to update notification rule.' }); }
});

router.post('/notifications', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const { event, channel, recipients, threshold } = req.body;
    const rule = { id: Date.now(), event, channel, recipients, threshold: threshold || 1, active: true };
    await securitySettings.saveSetting('notification_rules', (current) => { while (current.some((entry) => entry.id === rule.id)) rule.id++; return [...current, rule]; }, req.user.id);
    res.json({ success: true, data: rule });
  } catch (err) {
    console.error('Notification rule save failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save notification rule.' });
  }
});

// ═══════════════════════════════════════════════════════
// 14. COMPLIANCE CENTER — /api/security/compliance
// ═══════════════════════════════════════════════════════
router.get('/compliance', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const totalUsers = await sequelize.query(`SELECT COUNT(*) AS cnt FROM HMS_USERS`, { type: sequelize.QueryTypes.SELECT });
    const activeUsers = await sequelize.query(`SELECT COUNT(*) AS cnt FROM HMS_USERS WHERE IS_ACTIVE = 1`, { type: sequelize.QueryTypes.SELECT });
    const totalAudit = await sequelize.query(`SELECT COUNT(*) AS cnt FROM HMS_AUDIT_LOGS`, { type: sequelize.QueryTypes.SELECT });
    const passwordChanges = await sequelize.query(
      `SELECT COUNT(*) AS cnt FROM HMS_AUDIT_LOGS WHERE ACTION = 'UPDATE' AND NEW_VALUE LIKE '%password%'`,
      { type: sequelize.QueryTypes.SELECT }
    );

    res.json({
      success: true,
      data: {
        // No overall score: these are engineering checks, not an audit or
        // certification result (the old figure was a hard-coded 72%).
        note: 'Engineering checks of what the software enforces today. This is not an audit or certification result.',
        checks: [
          { name: 'Password Policy', status: 'pass', detail: 'Min 8 chars, uppercase, number, special char enforced', category: 'Authentication' },
          { name: 'Account Lockout', status: 'pass', detail: '5 failed attempts = 15 min lock', category: 'Authentication' },
          { name: 'Session Timeout', status: 'pass', detail: 'Per-role idle timeouts are enforced; sign-out, password changes and deactivation end sessions at once', category: 'Authentication' },
          { name: 'Audit Logging', status: 'pass', detail: `Every row change is recorded in the same transaction; ${Number(totalAudit[0]?.CNT || totalAudit[0]?.cnt || 0)} activity entries; append-only, hash-chained and checkpointed`, category: 'Audit' },
          { name: 'Role-Based Access', status: 'warn', detail: 'Every endpoint checks the role; access is not yet limited to the patients in a clinician\'s care', category: 'Access Control' },
          { name: 'Two-Factor Auth', status: 'fail', detail: 'Roles can be marked for 2FA, but login never asks for a second factor', category: 'Authentication' },
          { name: 'Data Encryption (at rest)', status: 'warn', detail: 'PostgreSQL pgcrypto/TDE not configured', category: 'Data Protection' },
          { name: 'Data Encryption (transit)', status: 'warn', detail: 'The app serves plain HTTP; HTTPS depends on a reverse proxy in front of it', category: 'Data Protection' },
          { name: 'Backups', status: 'warn', detail: 'Not run by the application; see Backup and recovery', category: 'Resilience' },
          { name: 'Consent Management', status: 'fail', detail: 'No patient consent tracking implemented', category: 'Privacy' },
          { name: 'Data Retention Policy', status: 'warn', detail: 'No automated purge schedule', category: 'Privacy' },
          { name: 'Breach Notification', status: 'fail', detail: 'No automated breach detection', category: 'Incident Response' },
          { name: 'Input Sanitization', status: 'warn', detail: 'Helmet CSP is active; request validation covers only some routes', category: 'Security' },
        ],
        stats: {
          total_users: Number(totalUsers[0]?.CNT || totalUsers[0]?.cnt || 0),
          active_users: Number(activeUsers[0]?.CNT || activeUsers[0]?.cnt || 0),
          audit_entries: Number(totalAudit[0]?.CNT || totalAudit[0]?.cnt || 0),
          password_changes: Number(passwordChanges[0]?.CNT || passwordChanges[0]?.cnt || 0),
        },
      },
    });
  } catch (err) {
    console.error('Compliance error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load compliance.' });
  }
});

// ═══════════════════════════════════════════════════════
// 15. DATA GOVERNANCE — /api/security/data-governance
// ═══════════════════════════════════════════════════════

router.get('/data-governance', protect, restrictTo('super_admin'), (req, res) => {
  res.json({ success: true, data: securitySettings.data_governance });
});

router.put('/data-governance/pii/:index/toggle', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const idx = Number(req.params.index);
    const updated = await securitySettings.saveSetting('data_governance', (current) => ({ ...current,
      pii_fields: current.pii_fields.map((field, i) => i === idx ? { ...field, masked: !field.masked } : field),
    }), req.user.id);
    res.json({ success: true, data: updated });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to update governance.' }); }
});

// ═══════════════════════════════════════════════════════
// 16. LICENSE MANAGER — /api/security/licenses
// ═══════════════════════════════════════════════════════

router.get('/licenses', protect, restrictTo('super_admin'), (req, res) => {
  res.json({ success: true, data: securitySettings.licenses });
});

router.post('/licenses', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const { name, vendor, type, expiry, seats } = req.body;
    const lic = { id: Date.now(), name, vendor, type, expiry, status: 'active', seats: seats || '1' };
    await securitySettings.saveSetting('licenses', (current) => { while (current.some((entry) => entry.id === lic.id)) lic.id++; return [...current, lic]; }, req.user.id);
    res.json({ success: true, data: lic });
  } catch (err) {
    console.error('License save failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save license.' });
  }
});

// ═══════════════════════════════════════════════════════
// 17. ROLE TEMPLATES — /api/security/role-templates
// ═══════════════════════════════════════════════════════

const allPermissions = [
  'view_patients', 'register_patients', 'edit_patients', 'delete_patients',
  'generate_tokens', 'book_appointments', 'record_vitals',
  'view_consultations', 'edit_consultations', 'write_prescriptions',
  'order_labs', 'view_lab_orders', 'enter_results', 'generate_reports',
  'view_prescriptions', 'dispense_medicine', 'manage_stock', 'otc_sales',
  'manage_users', 'view_reports', 'system_settings', 'view_audit_logs',
  'security_settings', 'system_config', 'compliance', 'full_access',
];

router.get('/role-templates', protect, restrictTo('super_admin'), (req, res) => {
  res.json({ success: true, data: { templates: securitySettings.role_templates, all_permissions: allPermissions } });
});

router.put('/role-templates/:id', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    let tmpl;
    await securitySettings.saveSetting('role_templates', (current) => current.map((entry) => {
      if (entry.id !== Number(req.params.id)) return entry;
      tmpl = { ...entry, permissions: req.body.permissions || entry.permissions };
      return tmpl;
    }), req.user.id);
    if (!tmpl) return res.status(404).json({ success: false, message: 'Not found' });
    await logAction(req.user.id, 'UPDATE', 'role_templates', tmpl.id, null, { role: tmpl.role, permissions: tmpl.permissions }, req.ip);
    res.json({ success: true, data: tmpl });
  } catch (error) { res.status(500).json({ success: false, message: 'Failed to update role template.' }); }
});

// ═══════════════════════════════════════════════════════
// UNLOCK USER — /api/security/users/:id/unlock
// ═══════════════════════════════════════════════════════
router.post('/users/:id/unlock', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const target = await User.findByPk(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });
    await User.update(
      { locked_until: null, failed_attempts: 0 },
      { where: { id: req.params.id } }
    );
    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'security', req.params.id, null, { action: 'account_unlocked' }, ip);
    res.json({ success: true, message: 'Account unlocked.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to unlock.' });
  }
});

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

module.exports = router;
module.exports.ipAccess = ipAccess;

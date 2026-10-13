const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const securitySettings = require('./settings');
const { storage } = require('./auditContext');

const COOKIE_NAME = 'hms_session';
const LAST_SEEN_RESOLUTION_MS = 60 * 1000;

// "8h", "30m", "45s", "2d" or a number of seconds, as JWT_EXPIRES_IN accepts.
function sessionLengthMs() {
  const raw = String(process.env.JWT_EXPIRES_IN || '8h').trim();
  const match = /^(\d+)\s*([smhd]?)$/.exec(raw);
  if (!match) return 8 * 3600 * 1000;
  const unit = { '': 1000, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return Number(match[1]) * unit;
}

async function createSession(userId, req) {
  const [row] = await sequelize.query(
    `INSERT INTO hms_sessions (user_id, expires_at, ip, user_agent)
     VALUES (:userId, now() + (:ms || ' milliseconds')::interval, :ip, :userAgent)
     RETURNING id, expires_at`,
    {
      replacements: {
        userId,
        ms: String(sessionLengthMs()),
        ip: req.ip || null,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
      },
      type: QueryTypes.SELECT,
    }
  );
  return { id: row.id || row.ID, expiresAt: row.expires_at || row.EXPIRES_AT };
}

function idleLimitMinutes(role) {
  const minutes = Number(securitySettings.session_timeout?.[role]);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

// Returns null when the session is usable, otherwise why it is not.
// An idle session is revoked here, so it cannot come back.
async function checkSession(sessionId, userId, role) {
  const rows = await sequelize.query(
    `SELECT revoked_at, revoked_reason, expires_at <= now() AS expired,
            EXTRACT(EPOCH FROM (now() - last_seen_at)) * 1000 AS idle_ms
       FROM hms_sessions WHERE id = :sessionId AND user_id = :userId`,
    { replacements: { sessionId, userId }, type: QueryTypes.SELECT }
  );
  const s = rows[0];
  if (!s) return 'Session not found. Please sign in.';
  if (s.revoked_at || s.REVOKED_AT) return 'Your session has ended. Please sign in again.';
  if (s.expired || s.EXPIRED) return 'Your session has expired. Please sign in again.';
  const idleMs = Number(s.idle_ms ?? s.IDLE_MS);
  const limit = idleLimitMinutes(role);
  if (limit && idleMs > limit * 60000) {
    await revokeSession(sessionId, 'idle timeout');
    return `You were signed out after ${limit} minutes without activity.`;
  }
  if (idleMs > LAST_SEEN_RESOLUTION_MS) {
    await sequelize.query('UPDATE hms_sessions SET last_seen_at = now() WHERE id = :sessionId', { replacements: { sessionId } });
  }
  return null;
}

async function revokeSession(sessionId, reason) {
  await sequelize.query(
    `UPDATE hms_sessions SET revoked_at = now(), revoked_reason = :reason
      WHERE id = :sessionId AND revoked_at IS NULL`,
    { replacements: { sessionId, reason } }
  );
}

// Ends every live session of a user (optionally keeping one) and drops their sockets.
async function revokeUserSessions(userId, reason, { io = null, exceptSessionId = null, transaction = null } = {}) {
  const rows = await sequelize.query(
    `UPDATE hms_sessions SET revoked_at = now(), revoked_reason = :reason
      WHERE user_id = :userId AND revoked_at IS NULL
        AND (CAST(:exceptSessionId AS uuid) IS NULL OR id <> CAST(:exceptSessionId AS uuid))
      RETURNING id`,
    { replacements: { userId, reason, exceptSessionId }, type: QueryTypes.SELECT, transaction: transaction || undefined }
  );
  if (io) {
    const disconnect = () => { for (const row of rows) io.in(`session:${row.id || row.ID}`).disconnectSockets(true); };
    let owner = transaction || storage.getStore()?.command?.transaction;
    if (owner) { while (owner.parent) owner = owner.parent; owner.afterCommit(disconnect); } else disconnect();
  }
  return rows.length;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true' || Boolean(req.secure),
    path: '/',
  };
}

function setSessionCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: sessionLengthMs() });
}

function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

module.exports = {
  COOKIE_NAME,
  sessionLengthMs,
  createSession,
  checkSession,
  revokeSession,
  revokeUserSessions,
  setSessionCookie,
  clearSessionCookie,
  readCookie,
};

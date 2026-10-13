const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const settings = require('./settings');
const { identityServiceEnabled } = require('../middleware/auth');
const { validateToken } = require('./identityClient');

// Revocation in any application instance must stop every other instance's
// outbound clinical notifications. Background checks never renew idle leases.
async function validateSocketSessions(io) {
  const sockets = [...(io.sockets?.sockets?.values() || [])];
  if (!sockets.length) return;
  if (identityServiceEnabled()) {
    for (const socket of sockets) {
      const user = await validateToken(socket.hmsAccessToken);
      if (!user || String(user.id) !== String(socket.user.id) || user.role !== socket.user.role) socket.disconnect(true);
    }
    return;
  }
  const ids = [...new Set(sockets.map((socket) => socket.user?.sessionId).filter(Boolean))];
  if (!ids.length) { sockets.forEach((socket) => socket.disconnect(true)); return; }
  const rows = await sequelize.query(`SELECT s.id, s.user_id, s.revoked_at, s.expires_at <= now() AS expired,
    EXTRACT(EPOCH FROM (now()-s.last_seen_at))/60 AS idle_minutes,
    u.role, u.is_active, u.locked_until > now() AS locked
    FROM hms_sessions s JOIN hms_users u ON u.id=s.user_id WHERE s.id IN (:ids)`, {
    replacements: { ids }, type: QueryTypes.SELECT,
  });
  const sessions = new Map(rows.map((row) => [row.id, row]));
  const idle = new Set();
  for (const socket of sockets) {
    const row = sessions.get(socket.user?.sessionId);
    const limit = Number(settings.session_timeout?.[row?.role]);
    const timedOut = row && limit > 0 && Number(row.idle_minutes) > limit;
    if (timedOut) idle.add(row.id);
    if (!row || row.revoked_at || row.expired || row.locked || !row.is_active || row.role !== socket.user.role || String(row.user_id) !== String(socket.user.id) || timedOut) socket.disconnect(true);
  }
  if (idle.size) await sequelize.query("UPDATE hms_sessions SET revoked_at=now(), revoked_reason='idle timeout' WHERE id IN (:ids) AND revoked_at IS NULL", { replacements: { ids: [...idle] } });
}
function startSocketSessionGuard(io) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await validateSocketSessions(io); }
    catch { for (const socket of io.sockets.sockets.values()) socket.disconnect(true); }
    finally { running = false; }
  }, 500);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { validateSocketSessions, startSocketSessionGuard };

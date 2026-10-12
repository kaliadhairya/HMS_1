const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

// Who is acting in the current request. The database audit triggers read it
// from connection settings (migration 0006), so every row change is
// attributed to the user, session and request that caused it.
const storage = new AsyncLocalStorage();

// First middleware: gives every request an ID and an audit context.
function requestContext(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && /^[\w.:-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  storage.run({ requestId: req.id, userId: null, sessionId: null }, next);
}

// Called by protect() once the caller is known.
function setActor(user) {
  const store = storage.getStore();
  if (!store) return;
  store.userId = user?.id ?? null;
  store.sessionId = user?.sessionId ?? null;
}

// Before a pooled connection runs a query, make its hms.* settings match the
// current context (or clear them outside a request). A connection only gets
// the extra round trip when the context differs from what it last carried.
function bindAuditActor(sequelize) {
  const manager = sequelize.connectionManager;
  const getConnection = manager.getConnection.bind(manager);
  manager.getConnection = async function getConnectionWithActor(options) {
    const connection = await getConnection(options);
    const store = storage.getStore() || {};
    const values = [store.userId == null ? '' : String(store.userId), store.sessionId || '', store.requestId || ''];
    const key = values.join('|');
    if (connection.hmsAuditKey !== key) {
      await connection.query(
        "SELECT set_config('hms.actor_user_id', $1, false), set_config('hms.session_id', $2, false), set_config('hms.request_id', $3, false)",
        values
      );
      connection.hmsAuditKey = key;
    }
    return connection;
  };
}

module.exports = { storage, requestContext, setActor, bindAuditActor };

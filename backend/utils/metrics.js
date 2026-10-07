const client = require('prom-client');

// Initialize default system metrics (CPU, RAM, event loop lag, GC)
client.collectDefaultMetrics({
  prefix: 'hms_',
  timeout: 5000,
});

// Histogram measuring duration of HTTP requests across endpoints
const httpRequestDurationSeconds = new client.Histogram({
  name: 'hms_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Total count of HTTP requests
const httpRequestsTotal = new client.Counter({
  name: 'hms_http_requests_total',
  help: 'Total number of HTTP requests handled',
  labelNames: ['method', 'route', 'code'],
});

// Gauge measuring concurrent authenticated socket connections per role
const activeSocketConnections = new client.Gauge({
  name: 'hms_active_socket_connections',
  help: 'Number of active authenticated WebSocket connections by role',
  labelNames: ['role'],
});

module.exports = {
  client,
  httpRequestDurationSeconds,
  httpRequestsTotal,
  activeSocketConnections,
};

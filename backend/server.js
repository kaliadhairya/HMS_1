require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { sequelize } = require('./models');
const { validateToken } = require('./utils/identityClient');
const app = express();
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  const numericTrustProxy = Number(trustProxy);
  app.set('trust proxy', Number.isInteger(numericTrustProxy) && numericTrustProxy >= 0 ? numericTrustProxy : trustProxy);
}

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin || allowedOrigins.length === 0) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

// ── Security Headers ────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── Core Middleware ──────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ───────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  skip: (req) => req.path.startsWith('/api/pdf'),
});
app.use('/api', apiLimiter);

// ── Static Files ────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// -- Global Audit Logger -----------------------------------------
const auditLogger = require('./middleware/auditLogger');
app.use('/api', auditLogger);

// ── Routes ──────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/internal/compat', require('./routes/internalCompat'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/security', require('./routes/security'));

// Pharmacy APIs
app.use('/api/medicines', require('./routes/hms/medicines'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/pharmacy', require('./routes/pharmacy'));

// ── HMS Specific Routes ─────────────────────────────────────────
app.use('/api/hms/tokens', require('./routes/hms/tokens'));
app.use('/api/hms/appointments', require('./routes/hms/appointments'));
app.use('/api/hms/vitals', require('./routes/hms/vitals'));
app.use('/api/hms/departments', require('./routes/hms/departments'));
app.use('/api/hms/doctors', require('./routes/hms/doctors'));

// Sprint 3 APIs
app.use('/api/hms/encounters', require('./routes/hms/encounters'));
app.use('/api/hms/diagnoses', require('./routes/hms/diagnoses'));
app.use('/api/hms/prescriptions', require('./routes/hms/prescriptions'));
app.use('/api/hms/rest-forms', require('./routes/hms/restForms'));
app.use('/api/hms/investigation-orders', require('./routes/hms/investigationOrders'));
app.use('/api/hms/medicines', require('./routes/hms/medicines'));
app.use('/api/hms/icd10', require('./routes/hms/icd10'));

// Part B - IPD & Billing APIs
app.use('/api/ipd', require('./routes/ipd'));
app.use('/api/billing', require('./routes/billing'));

// Part C - Admin Settings & PDF APIs
app.use('/api/admin', require('./routes/admin'));
app.use('/api/pdf', require('./routes/pdfRoutes'));

// Doctor API
app.use('/api/doctor', require('./middleware/auth').protect, require('./routes/doctor'));

// Receptionist API
app.use('/api/receptionist', require('./middleware/auth').protect, require('./routes/receptionist'));

// LIMS / Lab Tech API
app.use('/api/lab', require('./middleware/auth').protect, require('./routes/lab'));

// Legacy pharmacist namespace retained for frontend compatibility
app.use(
  '/api/pharmacist_lms',
  require('./middleware/auth').protect,
  require('./middleware/auth').restrictTo('pharmacist', 'admin', 'super_admin'),
  require('./routes/pharmacist_lms')
);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ── Database + Start ────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    credentials: true,
  }
});

// Attach socket.io to app for use in routes
app.set('io', io);

io.use(async (socket, next) => {
  try {
    const authorization = socket.handshake.headers.authorization;
    const token = socket.handshake.auth?.token || (authorization?.startsWith('Bearer ') ? authorization.slice(7) : null);
    if (!token) return next(new Error('Authentication required'));
    const context = await validateToken(token, socket.handshake.headers['x-request-id']);
    if (!context) return next(new Error('Invalid or inactive session'));
    socket.user = context;
    return next();
  } catch (error) {
    console.warn('Socket authentication failed:', error.message);
    return next(new Error('Authentication service unavailable'));
  }
});

io.on('connection', (socket) => {
  socket.join(socket.user.role);
  console.log(`🔌 Authenticated client ${socket.id} joined ${socket.user.role}`);
  socket.on('join_role', () => {
    // Compatibility no-op: room membership is derived from authenticated identity.
  });
  socket.on('disconnect', () => console.log('🔌 Client disconnected:', socket.id));
});

sequelize
  .authenticate()
  .then(async () => {
    console.log('✅ PostgreSQL DB connected');

    // ── Auto-migrations (safe, idempotent) ──────────────────────
    try {
      const [cols] = await sequelize.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'hms_rest_forms' AND column_name = 'extended_date'`
      );
      if (cols.length === 0) {
        await sequelize.query(`ALTER TABLE HMS_REST_FORMS ADD COLUMN EXTENDED_DATE TIMESTAMP`);
        console.log('➕ Added EXTENDED_DATE column to HMS_REST_FORMS');
      }
    } catch (migErr) {
      console.warn('⚠️ Migration check skipped:', migErr.message);
    }

    server.listen(PORT, process.env.BACKEND_HOST || '0.0.0.0', () => {
      console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.warn('⚠️ PostgreSQL connection failed:', err.message);
    console.warn('⚠️ Starting server WITHOUT database — mock data will be used.');
    server.listen(PORT, process.env.BACKEND_HOST || '0.0.0.0', () => {
      console.log(`🚀 Server running on http://0.0.0.0:${PORT} (NO DB — mock mode)`);
    });
  });

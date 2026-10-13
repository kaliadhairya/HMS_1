const crypto = require('crypto');

// Security settings and the configuration lists on the Security screen.
// Reads stay synchronous (this object), but the values live in
// hms_app_settings (migration 0008): loadSettings() fills the object at
// startup, saveSetting() writes through, and a refresh every few seconds picks
// up changes made by another server instance. A restart no longer resets them.
const DEFAULTS = {
  maintenance_mode: false,
  maintenance_message: 'System is under maintenance. Please try again later.',
  ip_whitelist: [],
  ip_blacklist: [],
  session_timeout: { super_admin: 30, admin: 30, doctor: 60, nurse: 60, receptionist: 60, pharmacist: 60, lab_technician: 60 },
  twofa_enforced_roles: [],
  announcements: [],
  // Only a SHA-256 of each key is kept; the key itself is shown once, at creation.
  api_keys: [],
  // Configured integrations. Nothing connects to them yet, so there are no
  // sync times or request counts to show (those used to be invented).
  integrations: [
    { id: 1, name: 'HL7 FHIR Gateway', category: 'EHR', status: 'inactive', endpoint: 'https://fhir.hospital.local/api', last_sync: null, requests_today: null },
    { id: 2, name: 'Insurance Portal (NHCX)', category: 'Insurance', status: 'inactive', endpoint: 'https://nhcx.nha.gov.in', last_sync: null, requests_today: null },
    { id: 3, name: 'SMS Gateway (MSG91)', category: 'Communication', status: 'inactive', endpoint: 'https://api.msg91.com/v5', last_sync: null, requests_today: null },
    { id: 4, name: 'Email Service (SMTP)', category: 'Communication', status: 'inactive', endpoint: 'smtp://mail.hospital.local:587', last_sync: null, requests_today: null },
    { id: 5, name: 'Lab Machine Interface', category: 'Lab', status: 'inactive', endpoint: 'tcp://192.168.1.50:9100', last_sync: null, requests_today: null },
    { id: 6, name: 'Payment Gateway (Razorpay)', category: 'Billing', status: 'inactive', endpoint: 'https://api.razorpay.com/v1', last_sync: null, requests_today: null },
  ],
  notification_rules: [
    { id: 1, event: 'Login Failed (5+ attempts)', channel: 'SMS + Email', recipients: 'super_admin', threshold: 5, active: true },
    { id: 2, event: 'System Downtime', channel: 'SMS + Email', recipients: 'all_admins', threshold: 1, active: true },
    { id: 3, event: 'Low Medicine Stock', channel: 'Email', recipients: 'pharmacist', threshold: 10, active: true },
    { id: 4, event: 'Critical Lab Result', channel: 'SMS', recipients: 'doctor', threshold: 1, active: false },
    { id: 5, event: 'Backup Failure', channel: 'Email', recipients: 'super_admin', threshold: 1, active: true },
    { id: 6, event: 'New User Registration', channel: 'Email', recipients: 'super_admin', threshold: 1, active: false },
  ],
  // Retention policy as configured; no purge job runs yet, so nothing has a last purge.
  data_governance: {
    retention_policies: [
      { id: 1, entity: 'Audit Logs', retention: '7 years', auto_purge: false, last_purge: null, records: 0 },
      { id: 2, entity: 'Patient Records', retention: 'Permanent', auto_purge: false, last_purge: null, records: 0 },
      { id: 3, entity: 'Prescription Data', retention: '10 years', auto_purge: false, last_purge: null, records: 0 },
      { id: 4, entity: 'Lab Reports', retention: '10 years', auto_purge: false, last_purge: null, records: 0 },
      { id: 5, entity: 'Session Logs', retention: '90 days', auto_purge: false, last_purge: null, records: 0 },
      { id: 6, entity: 'Error Logs', retention: '30 days', auto_purge: false, last_purge: null, records: 0 },
    ],
    pii_fields: [
      { table: 'HMS_PATIENTS', field: 'AADHAAR', masked: true, masking_rule: 'Show last 4 digits' },
      { table: 'HMS_PATIENTS', field: 'PHONE', masked: false, masking_rule: 'None' },
      { table: 'HMS_PATIENTS', field: 'ADDRESS', masked: false, masking_rule: 'None' },
      { table: 'HMS_USERS', field: 'PASSWORD', masked: true, masking_rule: 'bcrypt hash' },
      { table: 'HMS_USERS', field: 'PHONE', masked: false, masking_rule: 'None' },
    ],
  },
  licenses: [
    { id: 1, name: 'PostgreSQL Database', vendor: 'PostgreSQL Global Development Group', type: 'Open Source', expiry: 'Perpetual', status: 'active', seats: 'Unlimited' },
    { id: 2, name: 'HMS Core Platform', vendor: 'Hospital IT Department', type: 'Internal', expiry: 'Perpetual', status: 'active', seats: 'Unlimited' },
  ],
  role_templates: [
    { id: 1, role: 'doctor', label: 'Doctor', permissions: ['view_patients', 'edit_consultations', 'write_prescriptions', 'order_labs', 'view_reports'], color: '#3b82f6' },
    { id: 2, role: 'nurse', label: 'Nurse', permissions: ['view_patients', 'record_vitals', 'view_consultations'], color: '#8b5cf6' },
    { id: 3, role: 'receptionist', label: 'Receptionist', permissions: ['register_patients', 'generate_tokens', 'book_appointments', 'view_patients'], color: '#10b981' },
    { id: 4, role: 'pharmacist', label: 'Pharmacist', permissions: ['view_prescriptions', 'dispense_medicine', 'manage_stock', 'otc_sales'], color: '#f59e0b' },
    { id: 5, role: 'lab_technician', label: 'Lab Technician', permissions: ['view_lab_orders', 'enter_results', 'generate_reports'], color: '#ef4444' },
    { id: 6, role: 'admin', label: 'Admin', permissions: ['manage_users', 'view_reports', 'system_settings', 'view_audit_logs'], color: '#6366f1' },
    { id: 7, role: 'super_admin', label: 'Super Admin', permissions: ['full_access', 'manage_users', 'security_settings', 'system_config', 'compliance', 'view_audit_logs'], color: '#dc2626' },
  ],
};

const settings = structuredClone(DEFAULTS);
const REFRESH_EVERY_MS = Number(process.env.SETTINGS_REFRESH_INTERVAL_MS || 5000);

function sequelize() {
  return require('../models/db').sequelize; // late: models load after this module
}

const revisions = new Map();
function apply(rows) {
  for (const row of rows) {
    const key = row.key ?? row.KEY;
    const revision = BigInt(row.revision ?? row.REVISION ?? 1);
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key) && revision >= (revisions.get(key) || 0n)) {
      settings[key] = structuredClone(row.value ?? row.VALUE);
      revisions.set(key, revision);
    }
  }
}
async function loadSettings() {
  const [rows] = await sequelize().query('SELECT key, value, revision FROM hms_app_settings');
  apply(rows);
}
// Read-modify-write transforms run under a row lock, using the database value.
// Cache publication waits for the outer command commit. Revisions prevent an
// older refresh response from replacing a newly committed setting.
async function saveSetting(key, change, userId = null, { transaction } = {}) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) throw new Error(`Unknown setting ${key}`);
  return sequelize().transaction(transaction ? { transaction } : {}, async (tx) => {
    await sequelize().query('SELECT pg_advisory_xact_lock(727277, hashtext(:key))', { replacements: { key }, transaction: tx });
    const [rows] = await sequelize().query('SELECT value, revision FROM hms_app_settings WHERE key = :key FOR UPDATE', { replacements: { key }, transaction: tx });
    const current = rows.length ? (rows[0].value ?? rows[0].VALUE) : DEFAULTS[key];
    const value = typeof change === 'function' ? await change(structuredClone(current)) : structuredClone(change);
    const [saved] = await sequelize().query(`INSERT INTO hms_app_settings (key, value, updated_by, revision) VALUES (:key, CAST(:value AS jsonb), :userId, 1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now(), revision = hms_app_settings.revision + 1 RETURNING key, value, revision`, {
      replacements: { key, value: JSON.stringify(value), userId }, transaction: tx,
    });
    let owner = tx;
    while (owner.parent) owner = owner.parent;
    owner.afterCommit(() => apply(saved));
    return value;
  });
}

function startSettingsRefresh() {
  const timer = setInterval(() => {
    loadSettings().catch((err) => console.error('Settings refresh failed:', err.message));
  }, REFRESH_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}

const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

// The module is the settings object itself, so existing synchronous reads
// (settings.maintenance_mode, settings.session_timeout[role]) keep working.
Object.defineProperties(settings, {
  loadSettings: { value: loadSettings },
  saveSetting: { value: saveSetting },
  startSettingsRefresh: { value: startSettingsRefresh },
  hashApiKey: { value: hashApiKey },
  DEFAULTS: { value: DEFAULTS },
});

module.exports = settings;

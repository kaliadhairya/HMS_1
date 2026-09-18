/**
 * Seed HMS_PERMISSIONS table with the full role×module permission matrix.
 * Run: node utils/seedPermissions.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Permission = require('../models/Permission');
const { sequelize } = require('../models/db');

const MODULES = ['auth', 'dashboard', 'patient', 'consultation', 'lab', 'radiology', 'pharmacy', 'ipd', 'billing', 'reports', 'admin'];

// Permission matrix: role -> { module: [can_read, can_write, can_edit, can_delete] }
const MATRIX = {
  super_admin: Object.fromEntries(MODULES.map(m => [m, ['Y','Y','Y','Y']])),
  admin:       Object.fromEntries(MODULES.map(m => [m, ['Y','Y','Y','Y']])),
  doctor: {
    auth:         ['Y','Y','Y','N'],
    dashboard:    ['Y','N','N','N'],
    patient:      ['Y','N','N','N'],
    consultation: ['Y','Y','Y','N'],
    lab:          ['Y','N','N','N'],
    radiology:    ['Y','N','N','N'],
    ipd:          ['Y','Y','Y','N'],
  },
  lab_technician: {
    auth:      ['Y','Y','Y','N'],
    dashboard: ['Y','N','N','N'],
    lab:       ['Y','Y','Y','N'],
  },
  receptionist: {
    auth:      ['Y','Y','Y','N'],
    dashboard: ['Y','N','N','N'],
    patient:   ['Y','Y','Y','N'],
    billing:   ['Y','Y','N','N'],
  },
  pharmacist: {
    auth:      ['Y','Y','Y','N'],
    dashboard: ['Y','N','N','N'],
    pharmacy:  ['Y','Y','Y','N'],
    billing:   ['Y','Y','N','N'],
  },
  nurse: {
    auth:      ['Y','Y','Y','N'],
    dashboard: ['Y','N','N','N'],
    ipd:       ['Y','Y','Y','N'],
    patient:   ['Y','N','N','N'],
  },
};

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB connected for seeding permissions');

    // Clear existing permissions
    await sequelize.query('DELETE FROM HMS_PERMISSIONS');
    console.log('🗑️  Cleared existing permissions');

    const rows = [];
    for (const [role, modules] of Object.entries(MATRIX)) {
      for (const [mod, perms] of Object.entries(modules)) {
        rows.push({
          role,
          module: mod,
          can_read: perms[0],
          can_write: perms[1],
          can_edit: perms[2],
          can_delete: perms[3],
        });
      }
    }

    // Insert permission definitions
    for (const row of rows) {
      await Permission.create(row);
    }

    console.log(`✅ Seeded ${rows.length} permission entries`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err.message);
    process.exit(1);
  }
}

seed();

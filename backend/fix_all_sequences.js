require('dotenv').config();
const { sequelize } = require('./models/db');

// Map of: SEQUENCE_NAME -> TABLE_NAME
const SEQUENCE_TABLE_MAP = {
  'HMS_PATIENTS_SEQ':         'HMS_PATIENTS',
  'HMS_ENCOUNTERS_SEQ':       'HMS_ENCOUNTERS',
  'HMS_PRESCRIPTIONS_SEQ':    'HMS_PRESCRIPTIONS',
  'HMS_PRESC_ITEMS_SEQ':      'HMS_PRESCRIPTION_ITEMS',
  'HMS_DIAGNOSES_SEQ':        'HMS_DIAGNOSES',
  'HMS_INVESTIGATION_ORDERS_SEQ': 'HMS_INVESTIGATION_ORDERS',
  'HMS_INVEST_ORDER_ITEMS_SEQ':   'HMS_INVESTIGATION_ORDER_ITEMS',
  'HMS_TOKENS_SEQ':           'HMS_TOKENS',
  'HMS_APPOINTMENTS_SEQ':     'HMS_APPOINTMENTS',
  'HMS_REFERRALS_SEQ':        'HMS_REFERRALS',
  'HMS_ADMISSIONS_SEQ':       'HMS_ADMISSIONS',
  'HMS_IPD_REQ_SEQ':          'HMS_IPD_REQUESTS',
  'HMS_VITALS_SEQ':           'HMS_VITALS',
  'HMS_MEDICINES_SEQ':        'HMS_MEDICINES',
  'HMS_MEDICINE_BATCHES_SEQ': 'HMS_MEDICINE_BATCHES',
  'HMS_STOCK_LEDGER_SEQ':     'HMS_STOCK_LEDGER',
  'HMS_DISPENSING_RECORDS_SEQ': 'HMS_DISPENSING_RECORDS',
  'HMS_DISPENSING_ITEMS_SEQ': 'HMS_DISPENSING_ITEMS',
  'HMS_OTC_SALES_SEQ':        'HMS_OTC_SALES',
  'HMS_OTC_ITEMS_SEQ':        'HMS_OTC_ITEMS',
  'HMS_BILLS_SEQ':            'HMS_BILLS',
  'HMS_BILL_ITEMS_SEQ':       'HMS_BILL_ITEMS',
  'HMS_USERS_SEQ':            'HMS_USERS',
  'HMS_DEPARTMENTS_SEQ':      'HMS_DEPARTMENTS',
  'HMS_DOCTORS_SEQ':          'HMS_DOCTORS',
  'HMS_TEST_REPORTS_SEQ':     'HMS_TEST_REPORTS',
  'HMS_ALLERGIES_SEQ':        'HMS_ALLERGIES',
  'HMS_CHRONIC_CONDITIONS_SEQ': 'HMS_CHRONIC_CONDITIONS',
  'HMS_AUDIT_LOGS_SEQ':       'HMS_AUDIT_LOGS',
};

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  try {
    console.log(DRY_RUN ? '\n=== DRY RUN MODE (no changes will be made) ===\n' : '\n=== FIXING OUT-OF-SYNC SEQUENCES ===\n');
    console.log('NOTE: This ONLY resets ID counters. ZERO data rows are touched.\n');

    let fixedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const [seqName, tableName] of Object.entries(SEQUENCE_TABLE_MAP)) {
      try {
        // Step 1: Get MAX(ID) from the table
        let maxId = 0;
        try {
          const [rows] = await sequelize.query(`SELECT MAX(ID) AS MAX_ID FROM ${tableName}`);
          maxId = rows[0]?.MAX_ID || 0;
        } catch (tableErr) {
          // Table might not exist
          console.log(`  SKIP  ${seqName.padEnd(35)} — table ${tableName} not found`);
          skippedCount++;
          continue;
        }

        // Step 2: Get current sequence value or create sequence in PostgreSQL
        const seqLower = seqName.toLowerCase();
        let lastVal = 0;
        try {
          const [rows] = await sequelize.query(`SELECT last_value FROM ${seqLower}`);
          lastVal = Number(rows[0]?.last_value || 0);
        } catch (seqErr) {
          // Sequence doesn't exist — create it
          if (!DRY_RUN) {
            await sequelize.query(`CREATE SEQUENCE IF NOT EXISTS ${seqLower} START WITH ${Math.max(1, maxId + 1)} INCREMENT BY 1`);
            console.log(`  NEW   ${seqName.padEnd(35)} — created starting at ${maxId + 1}`);
          } else {
            console.log(`  NEW   ${seqName.padEnd(35)} — would create starting at ${maxId + 1}`);
          }
          fixedCount++;
          continue;
        }

        // Step 3: Compare and adjust
        if (lastVal > maxId) {
          console.log(`  OK    ${seqName.padEnd(35)} — seq=${lastVal}, max=${maxId} ✓`);
          skippedCount++;
        } else {
          const newStart = Math.max(1, maxId + 1);
          if (!DRY_RUN) {
            await sequelize.query(`SELECT setval('${seqLower}', ${newStart}, false)`);
            console.log(`  FIXED ${seqName.padEnd(35)} — was ${lastVal}, max=${maxId}, now set to ${newStart} ✓`);
          } else {
            console.log(`  FIX!  ${seqName.padEnd(35)} — seq=${lastVal}, max=${maxId} → needs ${newStart}`);
          }
          fixedCount++;
        }
      } catch (err) {
        console.log(`  ERR   ${seqName.padEnd(35)} — ${err.message.slice(0, 80)}`);
        errorCount++;
      }
    }

    console.log(`\n--- Summary ---`);
    console.log(`Fixed/Created: ${fixedCount}`);
    console.log(`Already OK:    ${skippedCount}`);
    console.log(`Errors:        ${errorCount}`);
    if (DRY_RUN) console.log('\nRe-run WITHOUT --dry-run to apply fixes.');
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    process.exit(0);
  }
}

run();

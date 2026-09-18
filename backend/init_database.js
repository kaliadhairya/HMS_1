/**
 * HMS Database Initializer (PostgreSQL)
 * Creates all tables, sequences, functions and seeds data.
 * Safe to run multiple times — skips existing objects.
 */
require('dotenv').config();
const { sequelize } = require('./models/db');
const bcrypt = require('bcryptjs');

async function execSafe(q, label) {
  try {
    await sequelize.query(q);
    console.log(`  ✅ ${label}`);
  } catch (e) {
    console.log(`  ❌ ${label}: ${e.original?.message || e.message}`);
  }
}

async function initDB() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL DB\n');

    // ── Compatibility Functions ──
    console.log('📦 Creating compatibility functions...');
    await execSafe(`
      CREATE OR REPLACE FUNCTION nvl(anyelement, anyelement) RETURNS anyelement AS $$
        SELECT COALESCE($1, $2);
      $$ LANGUAGE SQL IMMUTABLE;
    `, 'Function: NVL');

    await execSafe(`
      CREATE OR REPLACE FUNCTION trunc(t timestamp WITH time zone) RETURNS date AS $$
        SELECT t::date;
      $$ LANGUAGE SQL IMMUTABLE;
    `, 'Function: TRUNC(timestamptz)');

    await execSafe(`
      CREATE OR REPLACE FUNCTION trunc(t timestamp without time zone) RETURNS date AS $$
        SELECT t::date;
      $$ LANGUAGE SQL IMMUTABLE;
    `, 'Function: TRUNC(timestamp)');

    await execSafe(`
      CREATE OR REPLACE FUNCTION trunc(d date) RETURNS date AS $$
        SELECT d;
      $$ LANGUAGE SQL IMMUTABLE;
    `, 'Function: TRUNC(date)');

    // ── SEQUENCES ──
    console.log('\n📦 Creating sequences...');
    const sequences = [
      ['hms_users_seq', 100],
      ['hms_patients_seq', 1],
      ['hms_test_reports_seq', 1],
      ['hms_permissions_seq', 1],
      ['hms_audit_seq', 1],
      ['hms_dept_seq', 1],
      ['hms_doctor_seq', 1],
      ['hms_appt_seq', 1],
      ['hms_token_seq', 1],
      ['hms_vitals_seq', 1],
      ['hms_doc_seq', 1],
      ['hms_allergy_seq', 1],
      ['hms_chronic_seq', 1],
      ['hms_encounters_seq', 1],
      ['hms_diagnoses_seq', 1],
      ['hms_prescriptions_seq', 1],
      ['hms_presc_items_seq', 1],
      ['hms_inv_orders_seq', 1],
      ['hms_inv_items_seq', 1],
      ['hms_medicines_seq', 1],
      ['hms_referrals_seq', 1],
      ['hms_local_ref_seq', 1],
      ['hms_suppliers_seq', 1],
      ['hms_med_batch_seq', 1],
      ['hms_stock_led_seq', 1],
      ['hms_po_seq', 1],
      ['hms_pi_seq', 1],
      ['hms_disp_rec_seq', 1],
      ['hms_disp_item_seq', 1],
      ['hms_otc_sale_seq', 1],
      ['hms_otc_item_seq', 1],
      ['hms_wards_seq', 1],
      ['hms_beds_seq', 1],
      ['hms_admissions_seq', 1],
      ['hms_ipd_req_seq', 1],
      ['hms_progress_seq', 1],
      ['hms_nursing_seq', 1],
      ['hms_ipd_vitals_seq', 1],
      ['hms_mar_seq', 1],
      ['hms_bills_seq', 1],
      ['hms_bill_items_seq', 1],
      ['hms_payments_seq', 1],
      ['hms_advances_seq', 1],
      ['hms_patient_advances_seq', 1],
      ['hms_hosp_profile_seq', 1],
      ['hms_tariff_seq', 1],
      ['hms_rcpt_num_seq', 1],
      ['hms_rest_forms_seq', 1],
    ];

    for (const [s, start] of sequences) {
      await execSafe(`CREATE SEQUENCE IF NOT EXISTS ${s} START WITH ${start} INCREMENT BY 1`, s);
    }

    // ── TABLES ──
    console.log('\n📦 Creating tables...');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_USERS (
      ID INTEGER DEFAULT nextval('hms_users_seq') PRIMARY KEY,
      USERNAME VARCHAR(50) NOT NULL UNIQUE,
      PASSWORD VARCHAR(255) NOT NULL,
      NAME VARCHAR(100) NOT NULL,
      FIRST_NAME VARCHAR(100),
      LAST_NAME VARCHAR(100),
      PHONE VARCHAR(20),
      ROLE VARCHAR(20) DEFAULT 'lab_technician',
      DEPARTMENT_ID INTEGER,
      IS_ACTIVE INTEGER DEFAULT 1,
      FIRST_LOGIN CHAR(1) DEFAULT 'Y',
      FAILED_ATTEMPTS INTEGER DEFAULT 0,
      LOCKED_UNTIL TIMESTAMP,
      LAST_LOGIN TIMESTAMP,
      OTP_CODE VARCHAR(10),
      OTP_EXPIRES TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`, 'HMS_USERS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PATIENTS (
      ID INTEGER DEFAULT nextval('hms_patients_seq') PRIMARY KEY,
      PATIENTTYPE VARCHAR(20) NOT NULL,
      NAME VARCHAR(100) NOT NULL,
      AGE INTEGER NOT NULL,
      GENDER VARCHAR(10) NOT NULL,
      OPDINDOOR VARCHAR(10) NOT NULL,
      WARD VARCHAR(20) DEFAULT 'N/A',
      TESTDATE DATE NOT NULL,
      PROVDIAGNOSIS VARCHAR(255),
      EMPNUMBER VARCHAR(50),
      RELATIONSHIP VARCHAR(20),
      PHONENUMBER VARCHAR(10),
      UHID VARCHAR(20) UNIQUE,
      FIRST_NAME VARCHAR(100),
      LAST_NAME VARCHAR(100),
      DOB DATE,
      BLOOD_GROUP VARCHAR(5),
      ALT_PHONE VARCHAR(20),
      EMAIL VARCHAR(100),
      HOUSE_NO VARCHAR(50),
      STREET VARCHAR(200),
      CITY VARCHAR(100),
      STATE VARCHAR(100),
      PIN VARCHAR(10),
      COUNTRY VARCHAR(100) DEFAULT 'India',
      EMERGENCY_CONTACT_NAME VARCHAR(100),
      EMERGENCY_CONTACT_RELATION VARCHAR(50),
      EMERGENCY_CONTACT_PHONE VARCHAR(20),
      AADHAAR VARCHAR(255),
      PHOTO_URL VARCHAR(500),
      IS_ACTIVE INTEGER DEFAULT 1,
      REGISTEREDBY INTEGER,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`, 'HMS_PATIENTS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_TEST_REPORTS (
      ID INTEGER DEFAULT nextval('hms_test_reports_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      HAEMATOLOGY TEXT,
      BIOCHEMISTRY TEXT,
      SEROLOGY TEXT,
      URINE TEXT,
      OTHER TEXT,
      REMARKS TEXT,
      SUGGESTIONS TEXT,
      REPORTED_BY INTEGER,
      REPORT_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      STATUS VARCHAR(20) DEFAULT 'Draft',
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`, 'HMS_TEST_REPORTS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PERMISSIONS (
      ID INTEGER DEFAULT nextval('hms_permissions_seq') PRIMARY KEY,
      ROLE VARCHAR(50) NOT NULL,
      MODULE VARCHAR(50) NOT NULL,
      CAN_READ CHAR(1) DEFAULT 'N',
      CAN_WRITE CHAR(1) DEFAULT 'N',
      CAN_EDIT CHAR(1) DEFAULT 'N',
      CAN_DELETE CHAR(1) DEFAULT 'N')`, 'HMS_PERMISSIONS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_AUDIT_LOGS (
      ID INTEGER DEFAULT nextval('hms_audit_seq') PRIMARY KEY,
      USER_ID INTEGER,
      ACTION VARCHAR(50),
      MODULE VARCHAR(50),
      RECORD_ID INTEGER,
      OLD_VALUE TEXT,
      NEW_VALUE TEXT,
      IP_ADDRESS VARCHAR(50),
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_AUDIT_LOGS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_DEPARTMENTS (
      ID INTEGER DEFAULT nextval('hms_dept_seq') PRIMARY KEY,
      NAME VARCHAR(100) NOT NULL,
      SHORT_CODE VARCHAR(10),
      HEAD_DOCTOR_ID INTEGER,
      FLOOR_LOCATION VARCHAR(50),
      IS_ACTIVE CHAR(1) DEFAULT 'Y',
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_DEPARTMENTS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_DOCTORS (
      ID INTEGER DEFAULT nextval('hms_doctor_seq') PRIMARY KEY,
      USER_ID INTEGER NOT NULL,
      DEPARTMENT_ID INTEGER,
      SPECIALITY VARCHAR(100),
      REGISTRATION_NUMBER VARCHAR(50),
      QUALIFICATIONS VARCHAR(500),
      CONSULTING_DAYS VARCHAR(200),
      SLOT_START_TIME VARCHAR(10),
      SLOT_END_TIME VARCHAR(10),
      SLOT_DURATION_MINS INTEGER DEFAULT 15,
      FEE NUMERIC(10,2) DEFAULT 0,
      PHOTO_URL VARCHAR(500),
      SIGNATURE_URL VARCHAR(500),
      IS_ACTIVE CHAR(1) DEFAULT 'Y',
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_DOCTORS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_APPOINTMENTS (
      ID INTEGER DEFAULT nextval('hms_appt_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      DOCTOR_ID INTEGER NOT NULL,
      DEPARTMENT_ID INTEGER NOT NULL,
      APPOINTMENT_DATE DATE NOT NULL,
      SLOT_START VARCHAR(10),
      SLOT_END VARCHAR(10),
      APPT_TYPE VARCHAR(20) DEFAULT 'walk-in',
      STATUS VARCHAR(20) DEFAULT 'Scheduled',
      CANCELLATION_REASON VARCHAR(500),
      BOOKED_BY INTEGER,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_APPOINTMENTS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_TOKENS (
      ID INTEGER DEFAULT nextval('hms_token_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      DOCTOR_ID INTEGER NOT NULL,
      DEPARTMENT_ID INTEGER NOT NULL,
      TOKEN_NUMBER INTEGER NOT NULL,
      TOKEN_DATE DATE NOT NULL,
      STATUS VARCHAR(20) DEFAULT 'Waiting',
      GENERATED_BY INTEGER,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_TOKENS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_VITALS (
      ID INTEGER DEFAULT nextval('hms_vitals_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      ENCOUNTER_TYPE VARCHAR(10) DEFAULT 'OPD',
      REFERENCE_ID INTEGER,
      BP_SYSTOLIC INTEGER,
      BP_DIASTOLIC INTEGER,
      TEMPERATURE NUMERIC(5,2),
      TEMP_UNIT CHAR(1) DEFAULT 'F',
      WEIGHT_KG NUMERIC(6,2),
      HEIGHT_CM NUMERIC(6,2),
      BMI NUMERIC(5,2),
      SPO2 INTEGER,
      PULSE INTEGER,
      RESPIRATORY_RATE INTEGER,
      ALERTS TEXT,
      RECORDED_BY INTEGER,
      RECORDED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_VITALS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PATIENT_DOCUMENTS (
      ID INTEGER DEFAULT nextval('hms_doc_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      FILE_NAME VARCHAR(255),
      FILE_URL VARCHAR(500),
      DOC_TYPE VARCHAR(50),
      UPLOADED_BY INTEGER,
      UPLOADED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_PATIENT_DOCUMENTS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_ALLERGIES (
      ID INTEGER DEFAULT nextval('hms_allergy_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      ALLERGEN VARCHAR(200),
      REACTION VARCHAR(200),
      SEVERITY VARCHAR(20),
      NOTED_BY INTEGER,
      NOTED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_ALLERGIES');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_CHRONIC_CONDITIONS (
      ID INTEGER DEFAULT nextval('hms_chronic_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      CONDITION_NAME VARCHAR(200),
      SINCE_WHEN VARCHAR(100),
      NOTES VARCHAR(500),
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_CHRONIC_CONDITIONS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_ENCOUNTERS (
      ID INTEGER DEFAULT nextval('hms_encounters_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      DOCTOR_ID INTEGER NOT NULL,
      DEPARTMENT_ID INTEGER,
      TOKEN_ID INTEGER,
      APPOINTMENT_ID INTEGER,
      CHIEF_COMPLAINT TEXT,
      HOPI TEXT,
      PAST_MEDICAL_HISTORY TEXT,
      SURGICAL_HISTORY TEXT,
      FAMILY_HISTORY TEXT,
      SOCIAL_HISTORY TEXT,
      CURRENT_MEDICATIONS TEXT,
      GENERAL_EXAMINATION TEXT,
      CVS_FINDINGS TEXT,
      RS_FINDINGS TEXT,
      ABDOMEN_FINDINGS TEXT,
      CNS_FINDINGS TEXT,
      ENCOUNTER_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ENCOUNTER_TYPE VARCHAR(50) DEFAULT 'OPD',
      STATUS VARCHAR(50) DEFAULT 'Draft',
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_ENCOUNTERS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_DIAGNOSES (
      ID INTEGER DEFAULT nextval('hms_diagnoses_seq') PRIMARY KEY,
      ENCOUNTER_ID INTEGER NOT NULL,
      ICD10_CODE VARCHAR(50),
      ICD10_DESCRIPTION VARCHAR(500),
      DIAGNOSIS_TYPE VARCHAR(50) DEFAULT 'Primary',
      STATUS VARCHAR(50) DEFAULT 'Provisional',
      CLINICAL_NOTES TEXT,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_DIAGNOSES');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_REFERRALS (
      ID INTEGER DEFAULT nextval('hms_referrals_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      FROM_DOCTOR_ID INTEGER NOT NULL,
      LOCAL_REF_NO INTEGER,
      TO_SPECIALTY VARCHAR(100),
      REASON TEXT,
      HOSPITAL VARCHAR(150),
      CLINICAL_NOTES TEXT,
      STATUS VARCHAR(50) DEFAULT 'Pending',
      REFERRAL_TYPE VARCHAR(50) DEFAULT 'Outside',
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_REFERRALS');

    // Create trigger for local reference number auto-generation
    await sequelize.query(`
      CREATE OR REPLACE FUNCTION trg_hms_referrals_local_ref_fn()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.referral_type = 'Local' AND NEW.local_ref_no IS NULL THEN
          NEW.local_ref_no := nextval('hms_local_ref_seq');
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await sequelize.query(`
      DROP TRIGGER IF EXISTS trg_hms_referrals_local_ref ON hms_referrals;
    `);
    await sequelize.query(`
      CREATE TRIGGER trg_hms_referrals_local_ref
      BEFORE INSERT ON hms_referrals
      FOR EACH ROW
      EXECUTE FUNCTION trg_hms_referrals_local_ref_fn();
    `);

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PRESCRIPTIONS (
      ID INTEGER DEFAULT nextval('hms_prescriptions_seq') PRIMARY KEY,
      ENCOUNTER_ID INTEGER NOT NULL,
      PATIENT_ID INTEGER NOT NULL,
      DOCTOR_ID INTEGER NOT NULL,
      TYPE VARCHAR(50) DEFAULT 'OPD',
      STATUS VARCHAR(50) DEFAULT 'Draft',
      QR_DATA TEXT,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_PRESCRIPTIONS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PRESCRIPTION_ITEMS (
      ID INTEGER DEFAULT nextval('hms_presc_items_seq') PRIMARY KEY,
      PRESCRIPTION_ID INTEGER NOT NULL,
      MEDICINE_NAME VARCHAR(255) NOT NULL,
      GENERIC_NAME VARCHAR(255),
      DOSE VARCHAR(100),
      DOSE_UNIT VARCHAR(50),
      ROUTE VARCHAR(100),
      FREQUENCY VARCHAR(100),
      DURATION_DAYS INTEGER,
      INSTRUCTIONS VARCHAR(500),
      IS_IV_FLUID INTEGER DEFAULT 0,
      IV_RATE VARCHAR(100),
      IV_DURATION VARCHAR(100),
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_PRESCRIPTION_ITEMS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_INVESTIGATION_ORDERS (
      ID INTEGER DEFAULT nextval('hms_inv_orders_seq') PRIMARY KEY,
      ENCOUNTER_ID INTEGER NOT NULL,
      PATIENT_ID INTEGER NOT NULL,
      DOCTOR_ID INTEGER NOT NULL,
      ORDER_TYPE VARCHAR(50) DEFAULT 'Lab',
      URGENCY VARCHAR(50) DEFAULT 'Routine',
      CLINICAL_NOTES VARCHAR(1000),
      STATUS VARCHAR(50) DEFAULT 'Ordered',
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_INVESTIGATION_ORDERS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_INVESTIGATION_ORDER_ITEMS (
      ID INTEGER DEFAULT nextval('hms_inv_items_seq') PRIMARY KEY,
      ORDER_ID INTEGER NOT NULL,
      ITEM_TYPE VARCHAR(50) DEFAULT 'test',
      ITEM_NAME VARCHAR(255) NOT NULL,
      TEST_CATEGORY VARCHAR(100),
      STATUS VARCHAR(50) DEFAULT 'Pending',
      RESULT_VALUE VARCHAR(500),
      REFERENCE_RANGE VARCHAR(500),
      REMARKS TEXT,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_INVESTIGATION_ORDER_ITEMS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_MEDICINES (
      ID INTEGER DEFAULT nextval('hms_medicines_seq') PRIMARY KEY,
      GENERIC_NAME VARCHAR(500) NOT NULL,
      BRAND_NAMES TEXT,
      CATEGORY VARCHAR(100),
      FORMULATION VARCHAR(100),
      STRENGTH VARCHAR(100),
      STRENGTH_UNIT VARCHAR(50),
      UNIT_OF_SALE VARCHAR(50),
      HSN_CODE VARCHAR(50),
      GST_RATE INTEGER DEFAULT 0,
      IS_CONTROLLED INTEGER DEFAULT 0,
      IS_ACTIVE INTEGER DEFAULT 1,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_MEDICINES');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_SUPPLIERS (
      ID INTEGER DEFAULT nextval('hms_suppliers_seq') PRIMARY KEY,
      NAME VARCHAR(200) NOT NULL,
      CONTACT_PERSON VARCHAR(100),
      PHONE VARCHAR(15),
      EMAIL VARCHAR(100),
      ADDRESS TEXT,
      GSTIN VARCHAR(20),
      IS_ACTIVE INTEGER DEFAULT 1)`, 'HMS_SUPPLIERS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_MEDICINE_BATCHES (
      ID INTEGER DEFAULT nextval('hms_med_batch_seq') PRIMARY KEY,
      MEDICINE_ID INTEGER NOT NULL,
      SUPPLIER_ID INTEGER,
      BATCH_NUMBER VARCHAR(100) NOT NULL,
      EXPIRY_DATE DATE NOT NULL,
      QUANTITY INTEGER DEFAULT 0,
      PURCHASE_RATE NUMERIC(10,2),
      MRP NUMERIC(10,2),
      GST_AMOUNT NUMERIC(10,2) DEFAULT 0)`, 'HMS_MEDICINE_BATCHES');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_STOCK_LEDGER (
      ID INTEGER DEFAULT nextval('hms_stock_led_seq') PRIMARY KEY,
      MEDICINE_ID INTEGER NOT NULL,
      BATCH_ID INTEGER NOT NULL,
      TRANSACTION_TYPE VARCHAR(20) NOT NULL,
      QUANTITY INTEGER NOT NULL,
      REFERENCE_TYPE VARCHAR(30),
      REFERENCE_ID INTEGER,
      TRANSACTION_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PERFORMED_BY INTEGER)`, 'HMS_STOCK_LEDGER');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PURCHASE_ORDERS (
      ID INTEGER DEFAULT nextval('hms_po_seq') PRIMARY KEY,
      SUPPLIER_ID INTEGER,
      INVOICE_NUMBER VARCHAR(100),
      INVOICE_DATE DATE,
      TOTAL_AMOUNT NUMERIC(12,2) DEFAULT 0,
      GST_AMOUNT NUMERIC(12,2) DEFAULT 0,
      STATUS VARCHAR(20) DEFAULT 'Received',
      CREATED_BY INTEGER,
      EXPECTED_DELIVERY DATE,
      REMARKS VARCHAR(1000),
      ORDER_DATE TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_PURCHASE_ORDERS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PURCHASE_ITEMS (
      ID INTEGER DEFAULT nextval('hms_pi_seq') PRIMARY KEY,
      PURCHASE_ORDER_ID INTEGER NOT NULL,
      MEDICINE_ID INTEGER NOT NULL,
      BATCH_NUMBER VARCHAR(100),
      EXPIRY_DATE DATE,
      QUANTITY INTEGER,
      PURCHASE_RATE NUMERIC(10,2),
      MRP NUMERIC(10,2),
      GST_RATE NUMERIC(5,2) DEFAULT 0,
      GST_AMOUNT NUMERIC(10,2) DEFAULT 0,
      AMOUNT NUMERIC(10,2))`, 'HMS_PURCHASE_ITEMS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_DISPENSING_RECORDS (
      ID INTEGER DEFAULT nextval('hms_disp_rec_seq') PRIMARY KEY,
      PRESCRIPTION_ID INTEGER,
      PATIENT_ID INTEGER NOT NULL,
      DISPENSED_BY INTEGER,
      DISPENSED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      TOTAL_AMOUNT NUMERIC(12,2) DEFAULT 0,
      BILL_ID INTEGER)`, 'HMS_DISPENSING_RECORDS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_DISPENSING_ITEMS (
      ID INTEGER DEFAULT nextval('hms_disp_item_seq') PRIMARY KEY,
      DISPENSING_RECORD_ID INTEGER NOT NULL,
      MEDICINE_ID INTEGER NOT NULL,
      BATCH_ID INTEGER NOT NULL,
      QUANTITY INTEGER NOT NULL,
      RATE NUMERIC(10,2),
      AMOUNT NUMERIC(10,2))`, 'HMS_DISPENSING_ITEMS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_OTC_SALES (
      ID INTEGER DEFAULT nextval('hms_otc_sale_seq') PRIMARY KEY,
      PATIENT_ID INTEGER,
      SOLD_BY INTEGER,
      SOLD_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      TOTAL_AMOUNT NUMERIC(12,2) DEFAULT 0,
      PAYMENT_MODE VARCHAR(20),
      BILL_NUMBER VARCHAR(30))`, 'HMS_OTC_SALES');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_OTC_ITEMS (
      ID INTEGER DEFAULT nextval('hms_otc_item_seq') PRIMARY KEY,
      OTC_SALE_ID INTEGER NOT NULL,
      MEDICINE_ID INTEGER NOT NULL,
      BATCH_ID INTEGER NOT NULL,
      QUANTITY INTEGER NOT NULL,
      RATE NUMERIC(10,2),
      GST_AMOUNT NUMERIC(10,2) DEFAULT 0,
      AMOUNT NUMERIC(10,2))`, 'HMS_OTC_ITEMS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_WARDS (
      ID INTEGER DEFAULT nextval('hms_wards_seq') PRIMARY KEY,
      NAME VARCHAR(100) NOT NULL,
      TYPE VARCHAR(30),
      FLOOR VARCHAR(20),
      TOTAL_BEDS INTEGER DEFAULT 0,
      IS_ACTIVE INTEGER DEFAULT 1,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_WARDS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_BEDS (
      ID INTEGER DEFAULT nextval('hms_beds_seq') PRIMARY KEY,
      WARD_ID INTEGER NOT NULL,
      ROOM_NUMBER VARCHAR(20),
      BED_NUMBER VARCHAR(20) NOT NULL,
      STATUS VARCHAR(20) DEFAULT 'Available',
      IS_ACTIVE INTEGER DEFAULT 1)`, 'HMS_BEDS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_ADMISSIONS (
      ID INTEGER DEFAULT nextval('hms_admissions_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      ADMITTING_DOCTOR_ID INTEGER,
      DEPARTMENT VARCHAR(100),
      BED_ID INTEGER,
      ADMISSION_TYPE VARCHAR(20),
      ADMISSION_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      EXPECTED_DISCHARGE_DATE TIMESTAMP,
      DISCHARGE_DATE TIMESTAMP,
      STATUS VARCHAR(20) DEFAULT 'Active',
      ADMISSION_ID_FORMATTED VARCHAR(20) UNIQUE,
      CREATED_BY INTEGER,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_ADMISSIONS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_IPD_REQUESTS (
      ID INTEGER DEFAULT nextval('hms_ipd_req_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      DOCTOR_ID INTEGER NOT NULL,
      REASON_FOR_ADMISSION VARCHAR(1000),
      PRIMARY_DIAGNOSIS VARCHAR(500),
      ICD10_CODE VARCHAR(50),
      WARD_PREFERENCE VARCHAR(100),
      URGENCY_LEVEL VARCHAR(50),
      ESTIMATED_DURATION INTEGER,
      DURATION_UNIT VARCHAR(20),
      SPECIAL_REQUIREMENTS VARCHAR(1000),
      INITIAL_ORDERS TEXT,
      STATUS VARCHAR(50) DEFAULT 'Pending',
      REQUEST_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADMISSION_ID INTEGER,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_IPD_REQUESTS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PROGRESS_NOTES (
      ID INTEGER DEFAULT nextval('hms_progress_seq') PRIMARY KEY,
      ADMISSION_ID INTEGER NOT NULL,
      PATIENT_ID INTEGER NOT NULL,
      DOCTOR_ID INTEGER,
      NOTE_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      SUBJECTIVE TEXT,
      OBJECTIVE TEXT,
      ASSESSMENT TEXT,
      PLAN TEXT,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_PROGRESS_NOTES');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_NURSING_NOTES (
      ID INTEGER DEFAULT nextval('hms_nursing_seq') PRIMARY KEY,
      ADMISSION_ID INTEGER NOT NULL,
      NURSE_ID INTEGER,
      NOTE_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONDITION_NOTES TEXT,
      COMPLAINTS TEXT,
      ACTIONS_TAKEN TEXT,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_NURSING_NOTES');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_IPD_VITALS (
      ID INTEGER DEFAULT nextval('hms_ipd_vitals_seq') PRIMARY KEY,
      ADMISSION_ID INTEGER NOT NULL,
      PATIENT_ID INTEGER NOT NULL,
      RECORDED_BY INTEGER,
      RECORDED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      BP_SYSTOLIC INTEGER,
      BP_DIASTOLIC INTEGER,
      TEMPERATURE INTEGER,
      SPO2 INTEGER,
      PULSE INTEGER,
      RESPIRATORY_RATE INTEGER,
      PAIN_SCORE INTEGER,
      INTAKE_ORAL_ML INTEGER DEFAULT 0,
      INTAKE_IV_ML INTEGER DEFAULT 0,
      OUTPUT_URINE_ML INTEGER DEFAULT 0,
      OUTPUT_DRAIN_ML INTEGER DEFAULT 0,
      SHIFT VARCHAR(20))`, 'HMS_IPD_VITALS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_MAR_RECORDS (
      ID INTEGER DEFAULT nextval('hms_mar_seq') PRIMARY KEY,
      ADMISSION_ID INTEGER NOT NULL,
      PRESCRIPTION_ITEM_ID INTEGER,
      MEDICINE_NAME VARCHAR(200),
      DOSE VARCHAR(50),
      ROUTE VARCHAR(30),
      SCHEDULED_TIME TIMESTAMP,
      STATUS VARCHAR(20) DEFAULT 'Pending',
      ADMINISTERED_BY INTEGER,
      ADMINISTERED_AT TIMESTAMP,
      HOLD_REASON VARCHAR(500),
      NOTES VARCHAR(500))`, 'HMS_MAR_RECORDS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_BILLS (
      ID INTEGER DEFAULT nextval('hms_bills_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      ADMISSION_ID INTEGER,
      ENCOUNTER_ID INTEGER,
      BILL_TYPE VARCHAR(20) NOT NULL,
      BILL_NUMBER VARCHAR(30) UNIQUE,
      STATUS VARCHAR(30) DEFAULT 'Pending',
      TOTAL_AMOUNT NUMERIC(12,2) DEFAULT 0,
      DISCOUNT_AMOUNT NUMERIC(12,2) DEFAULT 0,
      DISCOUNT_APPROVED_BY INTEGER,
      GST_AMOUNT NUMERIC(12,2) DEFAULT 0,
      NET_PAYABLE NUMERIC(12,2) DEFAULT 0,
      ADVANCE_ADJUSTED NUMERIC(12,2) DEFAULT 0,
      CREATED_BY INTEGER,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_BILLS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_BILL_ITEMS (
      ID INTEGER DEFAULT nextval('hms_bill_items_seq') PRIMARY KEY,
      BILL_ID INTEGER NOT NULL,
      ITEM_TYPE VARCHAR(30),
      ITEM_NAME VARCHAR(200),
      QUANTITY INTEGER DEFAULT 1,
      RATE NUMERIC(10,2),
      GST_RATE NUMERIC(5,2) DEFAULT 0,
      GST_AMOUNT NUMERIC(10,2) DEFAULT 0,
      AMOUNT NUMERIC(10,2),
      SERVICE_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_BILL_ITEMS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PAYMENTS (
      ID INTEGER DEFAULT nextval('hms_payments_seq') PRIMARY KEY,
      BILL_ID INTEGER NOT NULL,
      PATIENT_ID INTEGER NOT NULL,
      PAYMENT_MODE VARCHAR(20),
      AMOUNT NUMERIC(12,2),
      REFERENCE_NUMBER VARCHAR(100),
      RECEIVED_BY INTEGER,
      RECEIPT_NUMBER VARCHAR(30) UNIQUE,
      PAYMENT_DATE TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      NOTES VARCHAR(500))`, 'HMS_PAYMENTS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_PATIENT_ADVANCES (
      ID INTEGER DEFAULT nextval('hms_advances_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      ADMISSION_ID INTEGER,
      AMOUNT NUMERIC(12,2),
      PAYMENT_MODE VARCHAR(20),
      RECEIVED_BY INTEGER,
      RECEIVED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADJUSTED_BILL_ID INTEGER,
      IS_REFUNDED INTEGER DEFAULT 0,
      NOTES VARCHAR(500))`, 'HMS_PATIENT_ADVANCES');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_HOSPITAL_PROFILE (
      ID INTEGER DEFAULT nextval('hms_hosp_profile_seq') PRIMARY KEY,
      NAME VARCHAR(200) NOT NULL,
      TAGLINE VARCHAR(300),
      LOGO_URL VARCHAR(500),
      ADDRESS VARCHAR(500),
      CITY VARCHAR(100),
      STATE VARCHAR(100),
      PIN VARCHAR(10),
      PHONE VARCHAR(20),
      EMAIL VARCHAR(100),
      WEBSITE VARCHAR(200),
      GSTIN VARCHAR(20),
      REG_NUMBER VARCHAR(100),
      NABH_STATUS INTEGER DEFAULT 0,
      CGHS_EMPANELLED INTEGER DEFAULT 0,
      LETTERHEAD_CONFIG TEXT,
      UPDATED_BY INTEGER,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_HOSPITAL_PROFILE');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_TARIFFS (
      ID INTEGER DEFAULT nextval('hms_tariff_seq') PRIMARY KEY,
      CATEGORY VARCHAR(50) NOT NULL,
      NAME VARCHAR(200) NOT NULL,
      RATE NUMERIC(10,2) NOT NULL,
      GST_RATE NUMERIC(5,2) DEFAULT 0,
      PER_UNIT VARCHAR(30),
      WARD_TYPE VARCHAR(30),
      DOCTOR_ID INTEGER,
      IS_ACTIVE INTEGER DEFAULT 1,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`, 'HMS_TARIFFS');

    await execSafe(`CREATE TABLE IF NOT EXISTS HMS_REST_FORMS (
      ID INTEGER DEFAULT nextval('hms_rest_forms_seq') PRIMARY KEY,
      PATIENT_ID INTEGER NOT NULL,
      DOCTOR_ID INTEGER NOT NULL,
      ENCOUNTER_ID INTEGER,
      BOOK_NO VARCHAR(20),
      SR_NO VARCHAR(20),
      ATTENDED_DATE TIMESTAMP,
      ADVISED_DAYS VARCHAR(50),
      FROM_DATE TIMESTAMP,
      TO_DATE TIMESTAMP,
      DISEASE VARCHAR(255),
      FIT_DATE TIMESTAMP,
      WORKING_AS VARCHAR(100),
      DEPARTMENT VARCHAR(100),
      EXTENDED_DATE TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`, 'HMS_REST_FORMS');

    // ── PERFORMANCE INDEXES & EXTENSIONS ──
    console.log('\n⚡ Creating database performance indexes & extensions...');

    // Enable pg_trgm extension for fast patient autocomplete
    await execSafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`, 'EXTENSION pg_trgm');

    const performanceIndexes = [
      // Patients table
      `CREATE INDEX IF NOT EXISTS idx_patients_uhid ON HMS_PATIENTS(UHID)`,
      `CREATE INDEX IF NOT EXISTS idx_patients_phone ON HMS_PATIENTS(PHONENUMBER)`,
      `CREATE INDEX IF NOT EXISTS idx_patients_empnumber ON HMS_PATIENTS(EMPNUMBER)`,
      `CREATE INDEX IF NOT EXISTS idx_patients_created_at ON HMS_PATIENTS(CREATED_AT DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_patients_name_trgm ON HMS_PATIENTS USING gin (NAME gin_trgm_ops)`,

      // Encounters table
      `CREATE INDEX IF NOT EXISTS idx_encounters_patient ON HMS_ENCOUNTERS(PATIENT_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_encounters_doctor ON HMS_ENCOUNTERS(DOCTOR_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_encounters_date ON HMS_ENCOUNTERS(ENCOUNTER_DATE DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_encounters_token ON HMS_ENCOUNTERS(TOKEN_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_encounters_status ON HMS_ENCOUNTERS(STATUS)`,

      // Appointments & Tokens
      `CREATE INDEX IF NOT EXISTS idx_appointments_doc_date ON HMS_APPOINTMENTS(DOCTOR_ID, APPOINTMENT_DATE, STATUS)`,
      `CREATE INDEX IF NOT EXISTS idx_appointments_patient ON HMS_APPOINTMENTS(PATIENT_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_tokens_date_status ON HMS_TOKENS(TOKEN_DATE, STATUS)`,
      `CREATE INDEX IF NOT EXISTS idx_tokens_patient ON HMS_TOKENS(PATIENT_ID)`,

      // Prescriptions
      `CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON HMS_PRESCRIPTIONS(PATIENT_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor ON HMS_PRESCRIPTIONS(DOCTOR_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_prescriptions_encounter ON HMS_PRESCRIPTIONS(ENCOUNTER_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_presc_items_presc ON HMS_PRESCRIPTION_ITEMS(PRESCRIPTION_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_presc_items_med ON HMS_PRESCRIPTION_ITEMS(MEDICINE_ID)`,

      // Investigation & Labs
      `CREATE INDEX IF NOT EXISTS idx_invest_orders_patient ON HMS_INVESTIGATION_ORDERS(PATIENT_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_invest_orders_doctor ON HMS_INVESTIGATION_ORDERS(DOCTOR_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_invest_order_items_order ON HMS_INVESTIGATION_ORDER_ITEMS(ORDER_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_invest_order_items_status ON HMS_INVESTIGATION_ORDER_ITEMS(STATUS)`,
      `CREATE INDEX IF NOT EXISTS idx_test_reports_patient ON HMS_TEST_REPORTS(PATIENT_ID, REPORT_DATE DESC)`,

      // IPD & Nursing
      `CREATE INDEX IF NOT EXISTS idx_admissions_patient ON HMS_ADMISSIONS(PATIENT_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_admissions_doctor ON HMS_ADMISSIONS(ADMITTING_DOCTOR_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_admissions_status ON HMS_ADMISSIONS(STATUS)`,
      `CREATE INDEX IF NOT EXISTS idx_nursing_notes_adm_date ON HMS_NURSING_NOTES(ADMISSION_ID, NOTE_DATE DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_vitals_adm_date ON HMS_IPD_VITALS(ADMISSION_ID, RECORDED_AT DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_vitals_pat_date ON HMS_IPD_VITALS(PATIENT_ID, RECORDED_AT DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_mar_adm_time ON HMS_MAR_RECORDS(ADMISSION_ID, SCHEDULED_TIME)`,

      // Billing & Advances
      `CREATE INDEX IF NOT EXISTS idx_bills_patient ON HMS_BILLS(PATIENT_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_encounter ON HMS_BILLS(ENCOUNTER_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_admission ON HMS_BILLS(ADMISSION_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON HMS_BILL_ITEMS(BILL_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_advances_patient ON HMS_PATIENT_ADVANCES(PATIENT_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_payments_bill ON HMS_PAYMENTS(BILL_ID)`,

      // Audit Logs
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON HMS_AUDIT_LOGS(USER_ID)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_module_action ON HMS_AUDIT_LOGS(MODULE, ACTION)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON HMS_AUDIT_LOGS(CREATED_AT DESC)`,
    ];

    for (const idxSql of performanceIndexes) {
      const parts = idxSql.split(' ');
      const idxName = parts[5] || parts[4] || 'INDEX';
      await execSafe(idxSql, idxName);
    }
    console.log('  ✅ Database performance indexes applied');

    // ── SEED DATA ──
    console.log('\n📦 Seeding reference data...');
    const SEL = sequelize.constructor.QueryTypes.SELECT;

    // Check if departments already seeded
    const depts = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_DEPARTMENTS', { type: SEL });
    if (parseInt(depts[0].CNT || depts[0].cnt || 0) === 0) {
      const deptData = [
        ['General Medicine','MED','Ground Floor'], ['Surgery','SUR','First Floor'],
        ['Orthopaedics','ORT','First Floor'], ['Gynaecology','GYN','Second Floor'],
        ['Paediatrics','PED','Ground Floor'], ['ENT','ENT','Second Floor'],
        ['Pathology / Lab','LAB','Ground Floor'], ['Pharmacy','PHR','Ground Floor'],
        ['Emergency','EMR','Ground Floor'],
      ];
      for (const [n,s,f] of deptData) {
        await sequelize.query(`INSERT INTO HMS_DEPARTMENTS (NAME,SHORT_CODE,FLOOR_LOCATION) VALUES (:n,:s,:f)`,
          { replacements: { n, s, f } });
      }
      console.log('  ✅ Departments seeded');
    } else {
      console.log('  ⏭️  Departments already exist');
    }

    // Wards + Beds
    const wards = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_WARDS', { type: SEL });
    if (parseInt(wards[0].CNT || wards[0].cnt || 0) === 0) {
      await sequelize.query(`INSERT INTO HMS_WARDS (NAME,TYPE,FLOOR,TOTAL_BEDS) VALUES ('General Ward','General','Ground',20)`);
      await sequelize.query(`INSERT INTO HMS_WARDS (NAME,TYPE,FLOOR,TOTAL_BEDS) VALUES ('Semi-Private','Semi-Private','First',10)`);
      await sequelize.query(`INSERT INTO HMS_WARDS (NAME,TYPE,FLOOR,TOTAL_BEDS) VALUES ('Private Ward','Private','Second',8)`);
      await sequelize.query(`INSERT INTO HMS_WARDS (NAME,TYPE,FLOOR,TOTAL_BEDS) VALUES ('ICU','ICU','Third',6)`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (1,'G-01','G-01-A','Available')`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (1,'G-01','G-01-B','Available')`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (2,'S-01','S-01-A','Available')`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (3,'P-01','P-01-A','Available')`);
      await sequelize.query(`INSERT INTO HMS_BEDS (WARD_ID,ROOM_NUMBER,BED_NUMBER,STATUS) VALUES (4,'ICU-01','ICU-01','Available')`);
      console.log('  ✅ Wards & Beds seeded');
    } else {
      console.log('  ⏭️  Wards already exist');
    }

    // Hospital Profile
    const hp = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_HOSPITAL_PROFILE', { type: SEL });
    if (parseInt(hp[0].CNT || hp[0].cnt || 0) === 0) {
      await sequelize.query(`INSERT INTO HMS_HOSPITAL_PROFILE (NAME,TAGLINE,ADDRESS,CITY,STATE,PIN,PHONE,REG_NUMBER)
        VALUES ('City General Hospital','Excellence in Healthcare','100 Medical Center Blvd','Metropolis','State','100001','011-23456789','HOSP-2024-001')`);
      console.log('  ✅ Hospital Profile seeded');
    }

    // Permissions
    const perms = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_PERMISSIONS', { type: SEL });
    if (parseInt(perms[0].CNT || perms[0].cnt || 0) === 0) {
      const roles = ['super_admin','admin'];
      const modules = ['auth','dashboard','patient','consultation','lab','pharmacy','ipd','billing','reports','admin'];
      for (const r of roles) {
        for (const m of modules) {
          await sequelize.query(`INSERT INTO HMS_PERMISSIONS (ROLE,MODULE,CAN_READ,CAN_WRITE,CAN_EDIT,CAN_DELETE) VALUES (:r,:m,'Y','Y','Y','Y')`,
            { replacements: { r, m } });
        }
      }
      // Specific role permissions
      const specific = [
        ['doctor','auth','Y','Y','Y','N'], ['doctor','dashboard','Y','N','N','N'],
        ['doctor','patient','Y','N','N','N'], ['doctor','consultation','Y','Y','Y','N'],
        ['doctor','lab','Y','N','N','N'], ['doctor','ipd','Y','Y','Y','N'],
        ['lab_technician','auth','Y','Y','Y','N'], ['lab_technician','dashboard','Y','N','N','N'],
        ['lab_technician','lab','Y','Y','Y','N'],
        ['receptionist','auth','Y','Y','Y','N'], ['receptionist','dashboard','Y','N','N','N'],
        ['receptionist','patient','Y','Y','Y','N'], ['receptionist','billing','Y','Y','N','N'],
        ['pharmacist','auth','Y','Y','Y','N'], ['pharmacist','dashboard','Y','N','N','N'],
        ['pharmacist','pharmacy','Y','Y','Y','N'], ['pharmacist','billing','Y','Y','N','N'],
        ['nurse','auth','Y','Y','Y','N'], ['nurse','dashboard','Y','N','N','N'],
        ['nurse','ipd','Y','Y','Y','N'], ['nurse','patient','Y','N','N','N'],
      ];
      for (const [r,m,cr,cw,ce,cd] of specific) {
        await sequelize.query(`INSERT INTO HMS_PERMISSIONS (ROLE,MODULE,CAN_READ,CAN_WRITE,CAN_EDIT,CAN_DELETE) VALUES (:r,:m,:cr,:cw,:ce,:cd)`,
          { replacements: { r, m, cr, cw, ce, cd } });
      }
      console.log('  ✅ Permissions seeded');
    }

    // Seeding Users for all clinical & administrative roles
    const usersCount = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_USERS', { type: SEL });
    if (parseInt(usersCount[0].CNT || usersCount[0].cnt || 0) === 0) {
      console.log('📦 Seeding users for clinical and administrative roles...');

      const defaultUsers = [
        { username: 'superadmin', name: 'Super Administrator', role: 'super_admin', password: 'Superadmin@123' },
        { username: 'admin', name: 'System Administrator', role: 'admin', password: 'Admin@123' },
        { username: 'doctor', name: 'Dr. Ramesh Kumar', role: 'doctor', password: 'Doctor@123' },
        { username: 'receptionist', name: 'Raman Sharma', role: 'receptionist', password: 'Receptionist@123' },
        { username: 'pharmacist', name: 'Suresh Gupta', role: 'pharmacist', password: 'Pharmacist@123' },
        { username: 'nurse', name: 'Sister Mary', role: 'nurse', password: 'Nurse@123' },
        { username: 'labtech', name: 'Amit Verma', role: 'lab_technician', password: 'Labtech@123' },
      ];

      for (const u of defaultUsers) {
        const hashedPassword = await bcrypt.hash(u.password, 12);
        // Find general medicine department for doctor and others
        let departmentId = null;
        if (u.role === 'doctor') departmentId = 1; // General Medicine
        if (u.role === 'lab_technician') departmentId = 7; // Pathology / Lab
        if (u.role === 'pharmacist') departmentId = 8; // Pharmacy

        await sequelize.query(`
          INSERT INTO HMS_USERS (USERNAME, PASSWORD, NAME, ROLE, DEPARTMENT_ID, IS_ACTIVE, FIRST_LOGIN)
          VALUES (:username, :password, :name, :role, :departmentId, 1, 'N')
        `, {
          replacements: {
            username: u.username,
            password: hashedPassword,
            name: u.name,
            role: u.role,
            departmentId: departmentId
          }
        });
      }

      console.log('  ✅ Default users seeded.');

      // Link the seeded doctor to HMS_DOCTORS if not already linked
      const docCount = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_DOCTORS', { type: SEL });
      if (parseInt(docCount[0].CNT || docCount[0].cnt || 0) === 0) {
        const [[doctorUser]] = await sequelize.query(`SELECT ID FROM HMS_USERS WHERE ROLE = 'doctor' LIMIT 1`);
        if (doctorUser) {
          await sequelize.query(`
            INSERT INTO HMS_DOCTORS (USER_ID, DEPARTMENT_ID, SPECIALITY, REGISTRATION_NUMBER, QUALIFICATIONS, IS_ACTIVE)
            VALUES (:userId, 1, 'General Medicine', 'REG-12345', 'MBBS, MD', 'Y')
          `, {
            replacements: { userId: doctorUser.id || doctorUser.ID }
          });
          console.log('  ✅ Doctor linked to General Medicine department in HMS_DOCTORS.');
        }
      }
    } else {
      console.log('  ⏭️  Users already exist');
    }

    // Seed default supplier
    const supps = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_SUPPLIERS', { type: SEL });
    if (parseInt(supps[0].CNT || supps[0].cnt || 0) === 0) {
      await sequelize.query(`
        INSERT INTO HMS_SUPPLIERS (NAME, CONTACT_PERSON, PHONE, EMAIL, ADDRESS, GSTIN, IS_ACTIVE)
        VALUES ('Generic Pharma Distributors', 'Rajesh Khanna', '9876543210', 'info@genericpharma.com', 'Phase 1, Industrial Area, Central Zone', '03AAAAA1111A1Z1', 1)
      `);
      console.log('  ✅ Default supplier seeded');
    }

    // Seed standard medicines
    const meds = await sequelize.query('SELECT COUNT(*) AS CNT FROM HMS_MEDICINES', { type: SEL });
    if (parseInt(meds[0].CNT || meds[0].cnt || 0) === 0) {
      const medicineData = [
        ['Paracetamol', 'Crocin, Calpol', 'Tablet', '500', 'mg', 'Strip of 10', 12.00],
        ['Ibuprofen', 'Brufen', 'Tablet', '400', 'mg', 'Strip of 15', 12.00],
        ['Amoxicillin', 'Novamox', 'Capsule', '500', 'mg', 'Strip of 10', 12.00],
        ['Metformin', 'Glycomet', 'Tablet', '500', 'mg', 'Strip of 20', 12.00],
        ['Atorvastatin', 'Lipivas', 'Tablet', '10', 'mg', 'Strip of 10', 12.00],
      ];
      for (const [gen, brand, form, str, unit, sale, gst] of medicineData) {
        await sequelize.query(`
          INSERT INTO HMS_MEDICINES (GENERIC_NAME, BRAND_NAMES, FORMULATION, STRENGTH, STRENGTH_UNIT, UNIT_OF_SALE, GST_RATE, IS_ACTIVE)
          VALUES (:gen, :brand, :form, :str, :unit, :sale, :gst, 1)
        `, {
          replacements: { gen, brand, form, str, unit, sale, gst }
        });
      }
      console.log('  ✅ Standard medicines seeded');
    }

    console.log('\n🎉 Database initialization complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ DB init failed:', err.message);
    process.exit(1);
  }
}

initDB();

-- 0003: enforce the relationships between records (blueprint F03, F16).
--
-- Until now no table had a single foreign key, so records could point at
-- patients, encounters or bills that no longer exist (the old patient delete
-- left many such rows behind). This migration:
--   1. gives "doctor" one meaning: every *DOCTOR_ID column except referrals
--      and department heads holds the doctor's user ID. Older appointments and
--      tokens held the HMS_DOCTORS profile ID and are converted;
--   2. moves rows whose references are broken into the quarantine schema,
--      with the reason, instead of deleting them or guessing a repair;
--   3. adds a foreign key, and an index where none exists, for every
--      relationship below.

CREATE TEMP TABLE fk_plan (child text, col text, parent text) ON COMMIT DROP;
INSERT INTO fk_plan VALUES
  ('hms_admissions', 'admitting_doctor_id', 'hms_users'),
  ('hms_admissions', 'bed_id', 'hms_beds'),
  ('hms_admissions', 'created_by', 'hms_users'),
  ('hms_admissions', 'patient_id', 'hms_patients'),
  ('hms_allergies', 'noted_by', 'hms_users'),
  ('hms_allergies', 'patient_id', 'hms_patients'),
  ('hms_appointments', 'booked_by', 'hms_users'),
  ('hms_appointments', 'department_id', 'hms_departments'),
  ('hms_appointments', 'doctor_id', 'hms_users'),
  ('hms_appointments', 'patient_id', 'hms_patients'),
  ('hms_beds', 'ward_id', 'hms_wards'),
  ('hms_bill_items', 'bill_id', 'hms_bills'),
  ('hms_bills', 'admission_id', 'hms_admissions'),
  ('hms_bills', 'created_by', 'hms_users'),
  ('hms_bills', 'discount_approved_by', 'hms_users'),
  ('hms_bills', 'encounter_id', 'hms_encounters'),
  ('hms_bills', 'patient_id', 'hms_patients'),
  ('hms_chronic_conditions', 'patient_id', 'hms_patients'),
  ('hms_departments', 'head_doctor_id', 'hms_doctors'),
  ('hms_diagnoses', 'encounter_id', 'hms_encounters'),
  ('hms_discharge_summaries', 'admission_id', 'hms_admissions'),
  ('hms_discharge_summaries', 'created_by', 'hms_users'),
  ('hms_dispensing_items', 'batch_id', 'hms_medicine_batches'),
  ('hms_dispensing_items', 'dispensing_record_id', 'hms_dispensing_records'),
  ('hms_dispensing_items', 'medicine_id', 'hms_medicines'),
  ('hms_dispensing_records', 'bill_id', 'hms_bills'),
  ('hms_dispensing_records', 'dispensed_by', 'hms_users'),
  ('hms_dispensing_records', 'patient_id', 'hms_patients'),
  ('hms_dispensing_records', 'prescription_id', 'hms_prescriptions'),
  ('hms_doctors', 'department_id', 'hms_departments'),
  ('hms_doctors', 'user_id', 'hms_users'),
  ('hms_encounters', 'appointment_id', 'hms_appointments'),
  ('hms_encounters', 'department_id', 'hms_departments'),
  ('hms_encounters', 'doctor_id', 'hms_users'),
  ('hms_encounters', 'patient_id', 'hms_patients'),
  ('hms_encounters', 'token_id', 'hms_tokens'),
  ('hms_hospital_profile', 'updated_by', 'hms_users'),
  ('hms_investigation_order_items', 'order_id', 'hms_investigation_orders'),
  ('hms_investigation_orders', 'doctor_id', 'hms_users'),
  ('hms_investigation_orders', 'encounter_id', 'hms_encounters'),
  ('hms_investigation_orders', 'patient_id', 'hms_patients'),
  ('hms_ipd_requests', 'admission_id', 'hms_admissions'),
  ('hms_ipd_requests', 'doctor_id', 'hms_users'),
  ('hms_ipd_requests', 'patient_id', 'hms_patients'),
  ('hms_ipd_vitals', 'admission_id', 'hms_admissions'),
  ('hms_ipd_vitals', 'patient_id', 'hms_patients'),
  ('hms_ipd_vitals', 'recorded_by', 'hms_users'),
  ('hms_mar_records', 'administered_by', 'hms_users'),
  ('hms_mar_records', 'admission_id', 'hms_admissions'),
  ('hms_mar_records', 'prescription_item_id', 'hms_prescription_items'),
  ('hms_medicine_batches', 'medicine_id', 'hms_medicines'),
  ('hms_medicine_batches', 'supplier_id', 'hms_suppliers'),
  ('hms_nursing_notes', 'admission_id', 'hms_admissions'),
  ('hms_nursing_notes', 'nurse_id', 'hms_users'),
  ('hms_otc_items', 'batch_id', 'hms_medicine_batches'),
  ('hms_otc_items', 'medicine_id', 'hms_medicines'),
  ('hms_otc_items', 'otc_sale_id', 'hms_otc_sales'),
  ('hms_otc_sales', 'patient_id', 'hms_patients'),
  ('hms_otc_sales', 'sold_by', 'hms_users'),
  ('hms_patient_advances', 'adjusted_bill_id', 'hms_bills'),
  ('hms_patient_advances', 'admission_id', 'hms_admissions'),
  ('hms_patient_advances', 'patient_id', 'hms_patients'),
  ('hms_patient_advances', 'received_by', 'hms_users'),
  ('hms_patient_documents', 'patient_id', 'hms_patients'),
  ('hms_patient_documents', 'uploaded_by', 'hms_users'),
  ('hms_payments', 'bill_id', 'hms_bills'),
  ('hms_payments', 'patient_id', 'hms_patients'),
  ('hms_payments', 'received_by', 'hms_users'),
  ('hms_prescription_items', 'prescription_id', 'hms_prescriptions'),
  ('hms_prescriptions', 'doctor_id', 'hms_users'),
  ('hms_prescriptions', 'encounter_id', 'hms_encounters'),
  ('hms_prescriptions', 'patient_id', 'hms_patients'),
  ('hms_progress_notes', 'admission_id', 'hms_admissions'),
  ('hms_progress_notes', 'doctor_id', 'hms_users'),
  ('hms_progress_notes', 'patient_id', 'hms_patients'),
  ('hms_purchase_items', 'medicine_id', 'hms_medicines'),
  ('hms_purchase_items', 'purchase_order_id', 'hms_purchase_orders'),
  ('hms_purchase_orders', 'created_by', 'hms_users'),
  ('hms_purchase_orders', 'supplier_id', 'hms_suppliers'),
  ('hms_referrals', 'from_doctor_id', 'hms_doctors'),
  ('hms_referrals', 'patient_id', 'hms_patients'),
  ('hms_rest_forms', 'doctor_id', 'hms_users'),
  ('hms_rest_forms', 'encounter_id', 'hms_encounters'),
  ('hms_rest_forms', 'patient_id', 'hms_patients'),
  ('hms_stock_ledger', 'batch_id', 'hms_medicine_batches'),
  ('hms_stock_ledger', 'medicine_id', 'hms_medicines'),
  ('hms_stock_ledger', 'performed_by', 'hms_users'),
  ('hms_tariffs', 'doctor_id', 'hms_users'),
  ('hms_test_reports', 'patient_id', 'hms_patients'),
  ('hms_test_reports', 'reported_by', 'hms_users'),
  ('hms_tokens', 'department_id', 'hms_departments'),
  ('hms_tokens', 'doctor_id', 'hms_users'),
  ('hms_tokens', 'generated_by', 'hms_users'),
  ('hms_tokens', 'patient_id', 'hms_patients'),
  ('hms_users', 'department_id', 'hms_departments'),
  ('hms_vitals', 'patient_id', 'hms_patients'),
  ('hms_vitals', 'recorded_by', 'hms_users');

-- 1. One meaning for "doctor" in appointments and tokens.
DO $$
DECLARE
  ambiguous integer;
BEGIN
  -- A value that is both a doctor's user ID and a different doctor's
  -- profile ID cannot be resolved safely; stop and ask for a manual review.
  SELECT count(*) INTO ambiguous
  FROM (SELECT doctor_id FROM hms_appointments UNION ALL SELECT doctor_id FROM hms_tokens) r
  JOIN hms_users u ON u.id = r.doctor_id AND u.role = 'doctor'
  JOIN hms_doctors d ON d.id = r.doctor_id AND d.user_id <> r.doctor_id;
  IF ambiguous > 0 THEN
    RAISE EXCEPTION '% appointment/token rows have a DOCTOR_ID that is both a doctor user ID and another doctor''s profile ID; resolve them by hand', ambiguous;
  END IF;

  UPDATE hms_appointments a SET doctor_id = d.user_id
  FROM hms_doctors d
  WHERE a.doctor_id = d.id
    AND NOT EXISTS (SELECT 1 FROM hms_users u WHERE u.id = a.doctor_id AND u.role = 'doctor');

  UPDATE hms_tokens t SET doctor_id = d.user_id
  FROM hms_doctors d
  WHERE t.doctor_id = d.id
    AND NOT EXISTS (SELECT 1 FROM hms_users u WHERE u.id = t.doctor_id AND u.role = 'doctor');
END $$;

-- 2. Quarantine rows with broken references. Moving a row can break rows
-- that point at it (an encounter's prescriptions), so repeat until stable.
CREATE SCHEMA IF NOT EXISTS quarantine;
CREATE TABLE IF NOT EXISTS quarantine.log (
  id             BIGSERIAL PRIMARY KEY,
  table_name     TEXT NOT NULL,
  rows_moved     INTEGER NOT NULL,
  reason         TEXT NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  r record;
  broken integer;
  moved integer;
  pass integer := 0;
BEGIN
  LOOP
    pass := pass + 1;
    moved := 0;
    FOR r IN SELECT * FROM fk_plan LOOP
      EXECUTE format('SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I p WHERE p.id = c.%I)',
                     r.child, r.col, r.parent, r.col) INTO broken;
      CONTINUE WHEN broken = 0;
      EXECUTE format('CREATE TABLE IF NOT EXISTS quarantine.%I (LIKE public.%I)', r.child, r.child);
      EXECUTE format('ALTER TABLE quarantine.%I ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(), ADD COLUMN IF NOT EXISTS quarantine_reason TEXT', r.child);
      EXECUTE format('WITH moved AS (DELETE FROM public.%1$I c WHERE c.%2$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%3$I p WHERE p.id = c.%2$I) RETURNING c.*)
                      INSERT INTO quarantine.%1$I SELECT m.*, now(), %4$L || m.%2$I FROM moved m',
                     r.child, r.col, r.parent, format('%s.%s points at a missing %s row: ', r.child, r.col, r.parent));
      INSERT INTO quarantine.log (table_name, rows_moved, reason)
      VALUES (r.child, broken, format('%s references missing %s rows', r.col, r.parent));
      RAISE NOTICE 'Quarantined % row(s) of % (% -> missing %)', broken, r.child, r.col, r.parent;
      moved := moved + broken;
    END LOOP;
    EXIT WHEN moved = 0;
    IF pass >= 20 THEN
      RAISE EXCEPTION 'Quarantine did not settle after 20 passes';
    END IF;
  END LOOP;
END $$;

-- 3. Foreign keys, plus an index on each referencing column that lacks one
-- (they keep parent deletes and joins from scanning the child table).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM fk_plan LOOP
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I (id)',
                   r.child, 'fk_' || r.child || '_' || r.col, r.col, r.parent);
    IF NOT EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = format('public.%I', r.child)::regclass AND a.attname = r.col
    ) THEN
      EXECUTE format('CREATE INDEX %I ON public.%I (%I)', 'ix_' || r.child || '_' || r.col, r.child, r.col);
    END IF;
  END LOOP;
END $$;

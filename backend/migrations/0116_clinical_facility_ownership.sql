CREATE FUNCTION hms_current_facility() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('hms.facility_id',true),'')::uuid,hms_initial_facility())
$$;
CREATE TABLE hms_facility_backfills (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facility_id uuid NOT NULL REFERENCES hms_facilities(id),
 table_name text NOT NULL UNIQUE,row_count bigint NOT NULL CHECK(row_count>=0),
 basis text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_facility_backfill_facility ON hms_facility_backfills(facility_id);
CREATE TRIGGER trg_audit_hms_facility_backfills AFTER INSERT OR UPDATE OR DELETE ON hms_facility_backfills
 FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
-- Explicit initial-facility conversion, never demographic or name matching.
-- Shared patient identity, safety facts, terminology and product identities
-- are deliberately not assigned to one facility.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY[
 'hms_encounters','hms_admissions','hms_wards','hms_beds','hms_appointments','hms_tokens',
 'hms_med_locations','hms_medicine_batches','hms_prescriptions','hms_prescription_items',
 'hms_investigation_orders','hms_investigation_order_items','hms_lab_specimens','hms_lab_custody',
 'hms_lab_recollections','hms_lab_specimen_links','hms_lab_result_versions','hms_lab_reports',
 'hms_lab_report_versions','hms_lab_report_results','hms_lab_critical_tasks','hms_lab_review_tasks',
 'hms_clinical_documents','hms_document_signatures','hms_billing_accounts','hms_bills','hms_bill_items',
 'hms_care_team_assignments','hms_break_glass_access','hms_vitals','hms_ipd_vitals','hms_nursing_notes',
 'hms_progress_notes','hms_referrals','hms_rest_forms','hms_ipd_requests','hms_bed_occupancies',
 'hms_discharge_plans','hms_discharge_summaries','hms_ipd_draft_charges','hms_dispensing_records',
 'hms_dispensing_items','hms_otc_sales','hms_otc_items','hms_patient_advances','hms_patient_documents',
 'hms_med_orders','hms_med_order_versions','hms_med_assessments','hms_med_verifications','hms_med_overrides',
 'hms_med_transitions','hms_med_balances','hms_med_movements','hms_med_receipts','hms_med_receipt_lines',
 'hms_med_substitutions','hms_med_dispenses','hms_med_dispense_lines','hms_med_charges','hms_med_returns',
 'hms_med_requisitions','hms_med_transfer_lines','hms_med_schedules','hms_med_administrations','hms_med_corrections',
 'hms_med_tasks','hms_med_controlled_register','hms_med_shift_counts','hms_med_discrepancies',
 'hms_med_handovers','hms_med_nursing_responsibility','hms_downtime_entries','hms_emergency_arrivals',
 'hms_worklist_items','hms_interface_messages','hms_abdm_care_contexts','hms_abdm_consents','hms_abdm_imports',
 'hms_abdm_profile_shares','hms_abdm_link_requests','hms_abdm_consent_requests','hms_abha_verifications'
 ] LOOP
  IF to_regclass('public.'||tab) IS NULL THEN RAISE EXCEPTION 'Required clinical ownership table % is missing',tab; END IF;
  EXECUTE format('ALTER TABLE %I ADD COLUMN facility_id uuid NOT NULL DEFAULT hms_initial_facility() REFERENCES hms_facilities(id)',tab);
  EXECUTE format('INSERT INTO hms_facility_backfills(facility_id,table_name,row_count,basis) SELECT hms_initial_facility(),%L,count(*),%L FROM %I',
    tab,'Explicit ownership assignment of the pre-conversion single-hospital records to the initial facility',tab);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN facility_id SET DEFAULT hms_current_facility()',tab);
  EXECUTE format('CREATE INDEX %I ON %I(facility_id)','ix_fac_'||tab,tab);
 END LOOP;
END $$;
-- All relationships between facility-owned clinical records must agree on
-- ownership; deferred constraints preserve reviewed patient merges.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.oid,c.conrelid::regclass child,c.confrelid::regclass parent,
  ca.attname child_key,pa.attname parent_key
 FROM pg_constraint c JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=c.conkey[1]
 JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=c.confkey[1]
 WHERE c.contype='f' AND array_length(c.conkey,1)=1 AND ca.attname<>'facility_id'
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attname='facility_id' AND NOT a.attisdropped)
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='facility_id' AND NOT a.attisdropped)
 LOOP
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s(%I,facility_id)','ux_fac_'||substr(md5(r.parent::text||r.parent_key),1,24),r.parent,r.parent_key);
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(%I,facility_id) REFERENCES %s(%I,facility_id) DEFERRABLE INITIALLY DEFERRED',
   r.child,'fk_fac_'||r.oid,r.child_key,r.parent,r.parent_key);
 END LOOP;
END $$;
DROP INDEX ux_care_current;
CREATE UNIQUE INDEX ux_care_current ON hms_care_team_assignments(facility_id,patient_id,practitioner_user_id) WHERE valid_to IS NULL;
ALTER TABLE hms_med_locations DROP CONSTRAINT hms_med_locations_code_key;
ALTER TABLE hms_med_locations ADD CONSTRAINT ux_location_facility_code UNIQUE(facility_id,code);
CREATE OR REPLACE FUNCTION patient_in_care(login_user_id integer,the_patient_id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM hms_care_team_assignments c WHERE c.facility_id=hms_current_facility()
   AND c.practitioner_user_id=login_user_id AND c.patient_id=the_patient_id AND c.valid_from<=now() AND (c.valid_to IS NULL OR c.valid_to>now()))
 OR EXISTS(SELECT 1 FROM hms_admissions a WHERE a.facility_id=hms_current_facility() AND a.patient_id=the_patient_id
   AND a.admitting_doctor_id=login_user_id AND a.status='Active')
 OR EXISTS(SELECT 1 FROM hms_break_glass_access b WHERE b.facility_id=hms_current_facility() AND b.user_id=login_user_id
   AND b.patient_id=the_patient_id AND b.expires_at>now())
$$;

-- Integrated upgrade: preserve facility ownership already added by 0156 on the parallel branch.
-- Continue the explicit single-hospital conversion for operational children.
-- Patient identity, longitudinal allergy facts, insurance policy identities,
-- medicine/terminology identities and governed hospital reference content
-- remain shared. Their clinical use still requires action and care authority.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY[
  'hms_diagnoses','hms_med_reconciliation','hms_med_witnesses','hms_med_witness_requests',
  'hms_med_late_documentation_reviews','hms_med_late_documentation_requests','hms_med_documentation_intents','hms_med_handover_tasks',
  'hms_lab_reconciliation','hms_lab_privileges','hms_lab_analyzer_runs','hms_lab_qc_records','hms_lab_technical_reviews','hms_lab_delivery_attempts',
  'hms_account_packages','hms_charge_events','hms_invoices','hms_invoice_lines','hms_invoice_notes','hms_invoice_note_lines',
  'hms_journal_entries','hms_journal_lines','hms_payment_intents','hms_receipts','hms_patient_funds','hms_allocations','hms_refunds',
  'hms_eligibility_checks','hms_preauthorizations','hms_preauth_revisions','hms_account_payers','hms_claims','hms_claim_lines','hms_remittances','hms_denials',
  'hms_cash_sessions','hms_settlements','hms_recon_exceptions','hms_payments','hms_test_reports','hms_mar_records',
  'hms_triage_assessments','hms_triage_escalations','hms_device_contracts','hms_downtime_snapshots','hms_downtime_episodes',
  'hms_abdm_hi_transfers','hms_abdm_hi_documents','hms_abdm_hiu_keys','hms_abdm_import_items'
 ] LOOP
  IF to_regclass('public.'||tab) IS NULL THEN RAISE EXCEPTION 'Required ownership table % is missing',tab; END IF;
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS facility_id uuid NOT NULL DEFAULT hms_initial_facility() REFERENCES hms_facilities(id)',tab);
  EXECUTE format('INSERT INTO hms_facility_backfills(facility_id,table_name,row_count,basis) SELECT hms_initial_facility(),%L,count(*),%L FROM %I WHERE facility_id=hms_initial_facility()',
   tab,'Explicit initial-facility assignment of pre-conversion single-hospital operational records',tab);
  EXECUTE format('ALTER TABLE %I ALTER COLUMN facility_id SET DEFAULT hms_current_facility()',tab);
  EXECUTE format('CREATE INDEX %I ON %I(facility_id)','ix_fac_'||tab,tab);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY facility_scope ON %I USING(hms_authorized_facility(facility_id)) WITH CHECK(hms_authorized_facility(facility_id))',tab);
  EXECUTE format('CREATE TRIGGER trg_facility_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hms_guard_facility_write()',tab);
 END LOOP;
END $$;
DO $$ DECLARE r record; stable_name text; BEGIN
 FOR r IN SELECT c.conrelid::regclass child,c.confrelid::regclass parent,ca.attname child_key,pa.attname parent_key
 FROM pg_constraint c JOIN pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=c.conkey[1]
 JOIN pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=c.confkey[1]
 WHERE c.contype='f' AND cardinality(c.conkey)=1 AND ca.attname<>'facility_id'
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attname='facility_id' AND NOT a.attisdropped)
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='facility_id' AND NOT a.attisdropped)
 LOOP
  stable_name:='fk_fac_'||substr(md5(r.child::text||':'||r.parent::text||':'||r.child_key||',facility_id'),1,24);
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=r.child AND c.conname=stable_name) THEN
   EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s(%I,facility_id)','ux_fac_'||substr(md5(r.parent::text||r.parent_key),1,24),r.parent,r.parent_key);
   EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(%I,facility_id) REFERENCES %s(%I,facility_id) DEFERRABLE INITIALLY DEFERRED',r.child,stable_name,r.child_key,r.parent,r.parent_key);
  END IF;
 END LOOP;
END $$;

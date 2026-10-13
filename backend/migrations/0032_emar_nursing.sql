CREATE TABLE hms_med_witnesses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), action TEXT NOT NULL
 CHECK(action IN ('SUPPLY','ADMINISTRATION','RETURN','WASTAGE','TRANSFER','COUNT')),
 subject_id TEXT NOT NULL, details_hash TEXT NOT NULL CHECK(length(details_hash)=64),
 witness_user_id INTEGER NOT NULL REFERENCES hms_users(id), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(expires_at>created_at)
);
CREATE TABLE hms_med_schedules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), version_id UUID NOT NULL REFERENCES hms_med_order_versions(id),
 patient_id INTEGER NOT NULL REFERENCES hms_patients(id), scheduled_at TIMESTAMPTZ NOT NULL,
 prn BOOLEAN NOT NULL DEFAULT false, indication TEXT,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','GIVEN','HELD','REFUSED','OMITTED','CANCELLED')),
 created_by_user_id INTEGER NOT NULL REFERENCES hms_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(version_id,scheduled_at), CHECK(NOT prn OR (indication IS NOT NULL AND length(trim(indication))>0))
);
CREATE TABLE hms_med_administrations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id UUID NOT NULL UNIQUE REFERENCES hms_med_schedules(id),
 version_id UUID NOT NULL REFERENCES hms_med_order_versions(id), patient_id INTEGER NOT NULL REFERENCES hms_patients(id),
 product_id UUID NOT NULL REFERENCES hms_med_products(id), dispense_line_id UUID REFERENCES hms_med_dispense_lines(id),
 outcome TEXT NOT NULL CHECK(outcome IN ('GIVEN','HELD','REFUSED','OMITTED')),
 dose NUMERIC(18,6) NOT NULL CHECK(dose>0), dose_unit TEXT NOT NULL, route TEXT NOT NULL,
 actual_at TIMESTAMPTZ NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 performer_user_id INTEGER NOT NULL REFERENCES hms_users(id), scan_evidence JSONB NOT NULL,
 reason TEXT, witness_id UUID UNIQUE REFERENCES hms_med_witnesses(id),
 CHECK(outcome='GIVEN' OR (reason IS NOT NULL AND length(trim(reason))>0)),
 CHECK(outcome<>'GIVEN' OR dispense_line_id IS NOT NULL)
);
CREATE TRIGGER trg_med_admin_immutable BEFORE UPDATE OR DELETE ON hms_med_administrations FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE TABLE hms_med_corrections (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), administration_id UUID NOT NULL REFERENCES hms_med_administrations(id),
 corrected_fields JSONB NOT NULL CHECK(jsonb_typeof(corrected_fields)='object'), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 author_user_id INTEGER NOT NULL REFERENCES hms_users(id), recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_med_correction_immutable BEFORE UPDATE OR DELETE ON hms_med_corrections FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE TABLE hms_med_tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), patient_id INTEGER NOT NULL REFERENCES hms_patients(id),
 order_id UUID REFERENCES hms_med_orders(id), administration_id UUID REFERENCES hms_med_administrations(id),
 kind TEXT NOT NULL CHECK(kind IN ('DOSE_EXCEPTION','PRN_REASSESSMENT','CLARIFICATION')),
 assigned_user_id INTEGER NOT NULL REFERENCES hms_users(id), created_by_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','ACKNOWLEDGED','CLOSED')), detail TEXT NOT NULL,
 acknowledged_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, closure_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(state<>'CLOSED' OR (closure_reason IS NOT NULL AND length(trim(closure_reason))>0))
);
CREATE TABLE hms_med_controlled_register (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES hms_med_products(id),
 batch_id INTEGER NOT NULL REFERENCES hms_medicine_batches(id), location_id UUID REFERENCES hms_med_locations(id),
 action TEXT NOT NULL CHECK(action IN ('SUPPLY','ADMINISTRATION','RETURN','WASTAGE','TRANSFER')),
 quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0), unit TEXT NOT NULL,
 source_id TEXT NOT NULL, performer_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 witness_id UUID NOT NULL UNIQUE REFERENCES hms_med_witnesses(id), recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(action,source_id)
);
CREATE TRIGGER trg_med_register_immutable BEFORE UPDATE OR DELETE ON hms_med_controlled_register FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE TABLE hms_med_shift_counts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES hms_med_products(id),
 batch_id INTEGER NOT NULL REFERENCES hms_medicine_batches(id), location_id UUID NOT NULL REFERENCES hms_med_locations(id),
 expected_quantity NUMERIC(18,6) NOT NULL CHECK(expected_quantity>=0), counted_quantity NUMERIC(18,6) NOT NULL CHECK(counted_quantity>=0),
 performer_user_id INTEGER NOT NULL REFERENCES hms_users(id), witness_id UUID NOT NULL UNIQUE REFERENCES hms_med_witnesses(id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), shift_ref TEXT NOT NULL CHECK(length(trim(shift_ref))>0),
 UNIQUE(batch_id,location_id,shift_ref)
);
CREATE TABLE hms_med_discrepancies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), count_id UUID NOT NULL UNIQUE REFERENCES hms_med_shift_counts(id),
 state TEXT NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','INVESTIGATING','CLOSED')),
 investigator_user_id INTEGER REFERENCES hms_users(id), investigation TEXT, closure_reason TEXT,
 closed_by_user_id INTEGER REFERENCES hms_users(id), closed_at TIMESTAMPTZ,
 CHECK(state<>'CLOSED' OR (investigation IS NOT NULL AND length(trim(investigation))>0 AND
 closure_reason IS NOT NULL AND length(trim(closure_reason))>0 AND closed_by_user_id IS NOT NULL AND closed_at IS NOT NULL))
);
CREATE TABLE hms_med_handovers (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), patient_id INTEGER NOT NULL REFERENCES hms_patients(id),
 admission_id INTEGER REFERENCES hms_admissions(id), sender_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 receiver_user_id INTEGER NOT NULL REFERENCES hms_users(id), sbar JSONB NOT NULL CHECK(jsonb_typeof(sbar)='object'),
 outstanding_task_ids UUID[] NOT NULL DEFAULT '{}', state TEXT NOT NULL DEFAULT 'SENT' CHECK(state IN ('SENT','ACKNOWLEDGED')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), sent_at TIMESTAMPTZ NOT NULL DEFAULT now(), acknowledged_at TIMESTAMPTZ,
 CHECK(sender_user_id<>receiver_user_id), CHECK(state<>'ACKNOWLEDGED' OR acknowledged_at IS NOT NULL)
);
CREATE TABLE hms_med_nursing_responsibility (
 patient_id INTEGER PRIMARY KEY REFERENCES hms_patients(id), responsible_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 handover_id UUID UNIQUE REFERENCES hms_med_handovers(id), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_audit_hms_med_witnesses AFTER INSERT OR UPDATE OR DELETE ON hms_med_witnesses FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_schedules AFTER INSERT OR UPDATE OR DELETE ON hms_med_schedules FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_administrations AFTER INSERT OR UPDATE OR DELETE ON hms_med_administrations FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_corrections AFTER INSERT OR UPDATE OR DELETE ON hms_med_corrections FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_tasks AFTER INSERT OR UPDATE OR DELETE ON hms_med_tasks FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_controlled_register AFTER INSERT OR UPDATE OR DELETE ON hms_med_controlled_register FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_shift_counts AFTER INSERT OR UPDATE OR DELETE ON hms_med_shift_counts FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_discrepancies AFTER INSERT OR UPDATE OR DELETE ON hms_med_discrepancies FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_handovers AFTER INSERT OR UPDATE OR DELETE ON hms_med_handovers FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_nursing_responsibility AFTER INSERT OR UPDATE OR DELETE ON hms_med_nursing_responsibility FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conrelid::regclass AS tab, conname, conkey FROM pg_constraint WHERE contype='f'
 AND conrelid IN (SELECT oid FROM pg_class WHERE relname LIKE 'hms_med_%') LOOP
 EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', 'ix_med_'||substr(md5(r.tab::text||r.conname),1,24),r.tab,
 (SELECT string_agg(quote_ident(attname),',') FROM pg_attribute WHERE attrelid=r.tab AND attnum=ANY(r.conkey)));
 END LOOP; END $$;

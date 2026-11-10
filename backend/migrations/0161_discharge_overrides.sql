-- Explicit, facility-scoped evidence of clinical discharge overrides.
CREATE TABLE hms_discharge_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 facility_id uuid NOT NULL REFERENCES hms_facilities(id),
 admission_id integer NOT NULL REFERENCES hms_admissions(id),
 patient_id integer NOT NULL REFERENCES hms_patients(id),
 doctor_user_id integer NOT NULL REFERENCES hms_users(id),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 1000),
 blockers jsonb NOT NULL CHECK (jsonb_typeof(blockers)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_discharge_override_admission ON hms_discharge_overrides(admission_id);
ALTER TABLE hms_discharge_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_scope ON hms_discharge_overrides USING (facility_id = hms_current_facility()) WITH CHECK (facility_id = hms_current_facility());
CREATE FUNCTION discharge_override_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Discharge override evidence is immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER trg_discharge_override_immutable BEFORE UPDATE OR DELETE ON hms_discharge_overrides FOR EACH ROW EXECUTE FUNCTION discharge_override_immutable();
CREATE TRIGGER trg_audit_hms_discharge_overrides AFTER INSERT OR UPDATE OR DELETE ON hms_discharge_overrides FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

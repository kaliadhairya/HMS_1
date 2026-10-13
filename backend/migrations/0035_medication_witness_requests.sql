CREATE TABLE hms_med_witness_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), action TEXT NOT NULL CHECK(action IN ('SUPPLY','ADMINISTRATION','RETURN','WASTAGE','TRANSFER','COUNT')),
 subject_id TEXT NOT NULL, details JSONB NOT NULL CHECK(jsonb_typeof(details)='object'),
 performer_user_id INTEGER NOT NULL REFERENCES hms_users(id), requested_witness_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ATTESTED')),
 witness_id UUID UNIQUE REFERENCES hms_med_witnesses(id), requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(performer_user_id<>requested_witness_user_id), CHECK(state<>'ATTESTED' OR witness_id IS NOT NULL)
);
CREATE INDEX ix_med_witness_request_performer ON hms_med_witness_requests(performer_user_id);
CREATE INDEX ix_med_witness_request_recipient ON hms_med_witness_requests(requested_witness_user_id);
CREATE TRIGGER trg_audit_hms_med_witness_requests AFTER INSERT OR UPDATE OR DELETE ON hms_med_witness_requests FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

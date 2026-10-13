CREATE TABLE hms_med_late_documentation_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id UUID NOT NULL REFERENCES hms_med_schedules(id),
 performer_user_id INTEGER NOT NULL REFERENCES hms_users(id), details JSONB NOT NULL CHECK(jsonb_typeof(details)='object'),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 review_id UUID UNIQUE REFERENCES hms_med_late_documentation_reviews(id), requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(schedule_id,request_hash)
);
CREATE INDEX ix_med_late_request_performer ON hms_med_late_documentation_requests(performer_user_id);
CREATE INDEX ix_med_late_request_schedule ON hms_med_late_documentation_requests(schedule_id);
CREATE TRIGGER trg_audit_hms_med_late_documentation_requests AFTER INSERT OR UPDATE OR DELETE ON hms_med_late_documentation_requests FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

-- A bedside documentation claim is confirmed before the physical action.
-- It survives an uncertain HTTP response and visibly blocks a second dose.
CREATE TABLE hms_med_documentation_intents (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id UUID NOT NULL UNIQUE REFERENCES hms_med_schedules(id),
 performer_user_id INTEGER NOT NULL REFERENCES hms_users(id), scan_evidence JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING_DOCUMENTATION' CHECK(state IN ('PENDING_DOCUMENTATION','DOCUMENTED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), documented_at TIMESTAMPTZ,
 CHECK(state<>'DOCUMENTED' OR documented_at IS NOT NULL)
);
CREATE TABLE hms_med_handover_tasks (
 handover_id UUID NOT NULL REFERENCES hms_med_handovers(id), task_id UUID NOT NULL REFERENCES hms_med_tasks(id),
 PRIMARY KEY(handover_id,task_id), CHECK(handover_id<>task_id)
);
CREATE INDEX ix_med_intent_performer ON hms_med_documentation_intents(performer_user_id);
CREATE INDEX ix_med_handover_task ON hms_med_handover_tasks(task_id);
CREATE TRIGGER trg_audit_hms_med_documentation_intents AFTER INSERT OR UPDATE OR DELETE ON hms_med_documentation_intents FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_handover_tasks AFTER INSERT OR UPDATE OR DELETE ON hms_med_handover_tasks FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

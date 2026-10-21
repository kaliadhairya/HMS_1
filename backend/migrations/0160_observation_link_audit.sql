-- Completion A5 follow-up: the observation links of migration 0159 are clinical records, so every
-- insert is in the audit trail like the other clinical tables (the migration verifier requires an
-- audit trigger on every application table). Changes and removals are already refused.
CREATE TRIGGER trg_audit_hms_observation_links AFTER INSERT OR UPDATE OR DELETE ON hms_observation_links
 FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

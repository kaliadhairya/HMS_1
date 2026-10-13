ALTER TABLE hms_lab_reconciliation ADD COLUMN result_version_id uuid REFERENCES hms_lab_result_versions(id);
CREATE INDEX ix_lab_reconciliation_result ON hms_lab_reconciliation(result_version_id);
ALTER TABLE hms_lab_result_versions ADD CONSTRAINT ck_lab_analyzer_run_required CHECK(source<>'ANALYZER' OR analyzer_run_id IS NOT NULL);

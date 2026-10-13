-- xmin can be a PostgreSQL subtransaction ID. Record the top-level creation
-- transaction explicitly so nested command savepoints remain compatible.
ALTER TABLE hms_lab_test_versions ADD COLUMN creation_transaction bigint NOT NULL DEFAULT txid_current() CHECK(creation_transaction>0);
ALTER TABLE hms_lab_report_versions ADD COLUMN creation_transaction bigint NOT NULL DEFAULT txid_current() CHECK(creation_transaction>0);
ALTER TABLE hms_lab_escalation_policies ADD COLUMN creation_transaction bigint NOT NULL DEFAULT txid_current() CHECK(creation_transaction>0);
CREATE OR REPLACE FUNCTION lab_version_children_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_transaction bigint;
BEGIN
 IF TG_TABLE_NAME='hms_lab_requirements' THEN SELECT creation_transaction INTO parent_transaction FROM hms_lab_test_versions WHERE id=NEW.test_version_id;
 ELSIF TG_TABLE_NAME='hms_lab_panel_members' THEN SELECT creation_transaction INTO parent_transaction FROM hms_lab_test_versions WHERE id=NEW.panel_version_id;
 ELSIF TG_TABLE_NAME='hms_lab_report_results' THEN SELECT creation_transaction INTO parent_transaction FROM hms_lab_report_versions WHERE id=NEW.report_version_id;
 ELSE SELECT creation_transaction INTO parent_transaction FROM hms_lab_escalation_policies WHERE id=NEW.policy_id; END IF;
 IF parent_transaction IS DISTINCT FROM txid_current() THEN
 RAISE EXCEPTION 'An approved version cannot acquire new children after its creation transaction' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

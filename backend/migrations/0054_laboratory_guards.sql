-- Released clinical evidence and approved policy revisions are append-only.
CREATE FUNCTION lab_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Laboratory evidence is immutable; append a new version' USING ERRCODE='23514'; END $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['hms_lab_tests','hms_lab_test_versions','hms_lab_requirements','hms_lab_panel_members','hms_lab_custody','hms_lab_qc_rules','hms_lab_analyzer_runs','hms_lab_qc_records','hms_lab_reference_intervals','hms_lab_conversions','hms_lab_result_versions','hms_lab_technical_reviews','hms_lab_report_versions','hms_lab_report_results','hms_lab_escalation_policies','hms_lab_escalation_steps','hms_lab_critical_policies','hms_lab_delivery_attempts']
 LOOP EXECUTE format('CREATE TRIGGER trg_lab_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION lab_immutable_record()',name); END LOOP;
END $$;
CREATE FUNCTION lab_specimen_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p hms_lab_specimens;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.patient_id,NEW.accession,NEW.parent_id,NEW.specimen_type,NEW.container) IS DISTINCT FROM (OLD.patient_id,OLD.accession,OLD.parent_id,OLD.specimen_type,OLD.container)
 THEN RAISE EXCEPTION 'Specimen identity cannot change' USING ERRCODE='23514'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
 SELECT * INTO p FROM hms_lab_specimens WHERE id=NEW.parent_id;
 IF p.patient_id<>NEW.patient_id OR p.specimen_type<>NEW.specimen_type THEN
 RAISE EXCEPTION 'Aliquot must retain parent patient and specimen type' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lab_specimen_identity BEFORE INSERT OR UPDATE ON hms_lab_specimens FOR EACH ROW EXECUTE FUNCTION lab_specimen_identity();
CREATE FUNCTION lab_specimen_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hms_lab_specimens s JOIN hms_investigation_order_items i ON i.id=NEW.item_id
 JOIN hms_investigation_orders o ON o.id=i.order_id JOIN hms_lab_requirements r ON r.id=NEW.requirement_id
 WHERE s.id=NEW.specimen_id AND s.patient_id=o.patient_id AND r.test_version_id=i.lab_test_version_id
 AND s.specimen_type=r.specimen_type AND s.container=r.container)
 THEN RAISE EXCEPTION 'Specimen, patient and ordered requirement must agree' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lab_link_guard BEFORE INSERT ON hms_lab_specimen_links FOR EACH ROW EXECUTE FUNCTION lab_specimen_link_guard();
CREATE TRIGGER trg_lab_immutable BEFORE UPDATE OR DELETE ON hms_lab_specimen_links FOR EACH ROW EXECUTE FUNCTION lab_immutable_record();
CREATE FUNCTION lab_result_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hms_lab_specimen_links l JOIN hms_lab_specimens s ON s.id=l.specimen_id
 JOIN hms_investigation_order_items i ON i.id=l.item_id JOIN hms_lab_test_versions t ON t.id=i.lab_test_version_id
 WHERE l.specimen_id=NEW.specimen_id AND l.item_id=NEW.item_id AND s.state IN ('RECEIVED','STORED') AND t.method=NEW.method AND t.unit=NEW.normalized_unit)
 THEN RAISE EXCEPTION 'Result must use the received specimen and ordered method/unit' USING ERRCODE='23514'; END IF;
 IF NEW.correction_of_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hms_lab_result_versions r WHERE r.id=NEW.correction_of_id AND r.item_id=NEW.item_id AND r.version<NEW.version)
 THEN RAISE EXCEPTION 'Correction must retain test identity and increase its version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lab_result_identity BEFORE INSERT ON hms_lab_result_versions FOR EACH ROW EXECUTE FUNCTION lab_result_identity_guard();
CREATE FUNCTION lab_report_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hms_lab_report_versions v JOIN hms_lab_reports p ON p.id=v.report_id
 JOIN hms_investigation_order_items i ON i.order_id=p.order_id JOIN hms_lab_result_versions r ON r.item_id=i.id
 JOIN hms_lab_technical_reviews t ON t.result_version_id=r.id AND t.decision='VERIFIED'
 WHERE v.id=NEW.report_version_id AND r.id=NEW.result_version_id)
 THEN RAISE EXCEPTION 'Reports must contain verified results from their own order' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lab_report_link BEFORE INSERT ON hms_lab_report_results FOR EACH ROW EXECUTE FUNCTION lab_report_link_guard();

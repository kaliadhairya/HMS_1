ALTER TABLE hms_lab_reference_intervals ADD CONSTRAINT uq_lab_reference_context UNIQUE NULLS NOT DISTINCT(test_version_id,version,method,unit,sex,min_age_years,max_age_years);
ALTER TABLE hms_lab_critical_policies ADD CONSTRAINT uq_lab_critical_context UNIQUE NULLS NOT DISTINCT(test_version_id,version,method,unit,sex,min_age_years,max_age_years);
CREATE FUNCTION lab_version_children_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_xmin text;
BEGIN
 IF TG_TABLE_NAME='hms_lab_requirements' THEN SELECT xmin::text INTO parent_xmin FROM hms_lab_test_versions WHERE id=NEW.test_version_id;
 ELSIF TG_TABLE_NAME='hms_lab_panel_members' THEN SELECT xmin::text INTO parent_xmin FROM hms_lab_test_versions WHERE id=NEW.panel_version_id;
 ELSIF TG_TABLE_NAME='hms_lab_report_results' THEN SELECT xmin::text INTO parent_xmin FROM hms_lab_report_versions WHERE id=NEW.report_version_id;
 ELSE SELECT xmin::text INTO parent_xmin FROM hms_lab_escalation_policies WHERE id=NEW.policy_id; END IF;
 IF parent_xmin IS DISTINCT FROM (txid_current()%4294967296)::text THEN
 RAISE EXCEPTION 'An approved version cannot acquire new children after its creation transaction' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lab_version_children BEFORE INSERT ON hms_lab_requirements FOR EACH ROW EXECUTE FUNCTION lab_version_children_guard();
CREATE TRIGGER trg_lab_version_children BEFORE INSERT ON hms_lab_panel_members FOR EACH ROW EXECUTE FUNCTION lab_version_children_guard();
CREATE TRIGGER trg_lab_version_children BEFORE INSERT ON hms_lab_report_results FOR EACH ROW EXECUTE FUNCTION lab_version_children_guard();
CREATE TRIGGER trg_lab_version_children BEFORE INSERT ON hms_lab_escalation_steps FOR EACH ROW EXECUTE FUNCTION lab_version_children_guard();
CREATE FUNCTION lab_order_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.lab_test_version_id IS NOT NULL AND NEW.lab_test_version_id IS DISTINCT FROM OLD.lab_test_version_id
 THEN RAISE EXCEPTION 'An ordered test version cannot be replaced' USING ERRCODE='23514'; END IF;
 IF OLD.lab_test_version_id IS NOT NULL AND (NEW.order_id,NEW.item_name) IS DISTINCT FROM (OLD.order_id,OLD.item_name)
 THEN RAISE EXCEPTION 'An ordered test cannot move to another order or identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lab_order_binding BEFORE UPDATE ON hms_investigation_order_items FOR EACH ROW EXECUTE FUNCTION lab_order_binding_guard();

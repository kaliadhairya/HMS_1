-- Fulfillment content is append-only. Patient identity projections may follow
-- an approved merge, but must still match the exact order at transaction commit.
ALTER TABLE hms_med_dispenses ADD COLUMN api_version integer NOT NULL DEFAULT 1 CHECK(api_version>0);
ALTER TABLE hms_med_schedules ADD COLUMN api_version integer NOT NULL DEFAULT 1 CHECK(api_version>0);
CREATE TRIGGER trg_zz_api_version BEFORE UPDATE ON hms_med_dispenses
 FOR EACH ROW EXECUTE FUNCTION hms_bump_api_version();
CREATE TRIGGER trg_zz_api_version BEFORE UPDATE ON hms_med_schedules
 FOR EACH ROW EXECUTE FUNCTION hms_bump_api_version();
CREATE FUNCTION hms_med_dispense_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Dispense history is append-only'; END IF;
 IF (to_jsonb(NEW)-'patient_id'-'api_version') IS DISTINCT FROM (to_jsonb(OLD)-'patient_id'-'api_version') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Dispense fulfillment and attribution are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_med_dispense_projection_guard BEFORE UPDATE OR DELETE ON hms_med_dispenses
 FOR EACH ROW EXECUTE FUNCTION hms_med_dispense_projection_guard();
CREATE TRIGGER trg_med_dispense_line_immutable BEFORE UPDATE OR DELETE ON hms_med_dispense_lines
 FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE TRIGGER trg_med_return_immutable BEFORE UPDATE OR DELETE ON hms_med_returns
 FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE FUNCTION hms_med_fulfillment_patient_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invalid boolean;
BEGIN
 IF TG_TABLE_NAME='hms_med_orders' THEN
  SELECT EXISTS(SELECT 1 FROM hms_med_dispenses d JOIN hms_med_order_versions v ON v.id=d.version_id
    JOIN hms_med_orders o ON o.id=v.order_id WHERE o.id=NEW.id AND d.patient_id<>o.patient_id) INTO invalid;
 ELSE
  SELECT EXISTS(SELECT 1 FROM hms_med_dispenses d JOIN hms_med_order_versions v ON v.id=d.version_id
    JOIN hms_med_orders o ON o.id=v.order_id WHERE d.id=NEW.id AND d.patient_id<>o.patient_id) INTO invalid;
 END IF;
 IF invalid THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dispense patient must match its exact medication order'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_med_dispense_patient_context AFTER INSERT OR UPDATE ON hms_med_dispenses
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hms_med_fulfillment_patient_guard();
CREATE CONSTRAINT TRIGGER trg_med_order_fulfillment_context AFTER UPDATE ON hms_med_orders
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(OLD.patient_id IS DISTINCT FROM NEW.patient_id)
 EXECUTE FUNCTION hms_med_fulfillment_patient_guard();

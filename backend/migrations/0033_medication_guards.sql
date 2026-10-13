-- Additional command evidence and database guards; earlier migrations stay unchanged.
ALTER TABLE hms_med_witnesses ADD COLUMN performer_user_id INTEGER NOT NULL REFERENCES hms_users(id);
ALTER TABLE hms_med_witnesses ADD CONSTRAINT ck_med_witness_independent CHECK(performer_user_id<>witness_user_id);
ALTER TABLE hms_med_controlled_register DROP CONSTRAINT hms_med_controlled_register_witness_id_key;
ALTER TABLE hms_med_administrations ADD COLUMN base_quantity NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK(base_quantity>=0);
CREATE INDEX ix_med_witness_performer ON hms_med_witnesses(performer_user_id);
CREATE INDEX ix_med_register_witness ON hms_med_controlled_register(witness_id);
CREATE INDEX ix_med_schedule_patient_time ON hms_med_schedules(patient_id,scheduled_at);
CREATE INDEX ix_med_admin_version_actual ON hms_med_administrations(version_id,actual_at);
CREATE FUNCTION med_immutable_configuration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Approved clinical configuration is versioned and immutable'; END $$;
CREATE TRIGGER trg_med_rules_immutable BEFORE UPDATE OR DELETE ON hms_med_rule_packs FOR EACH ROW EXECUTE FUNCTION med_immutable_configuration();
CREATE TRIGGER trg_med_formulary_immutable BEFORE UPDATE OR DELETE ON hms_med_formulary FOR EACH ROW EXECUTE FUNCTION med_immutable_configuration();
CREATE FUNCTION med_product_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'Approved medication identity cannot be overwritten; create a new product'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_med_product_immutable BEFORE UPDATE OR DELETE ON hms_med_products FOR EACH ROW EXECUTE FUNCTION med_product_guard();
CREATE FUNCTION med_composition_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM hms_med_order_versions WHERE product_id=COALESCE(NEW.product_id,OLD.product_id)) THEN
 RAISE EXCEPTION 'Composition used by an order is immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $$;
CREATE TRIGGER trg_med_composition_immutable BEFORE INSERT OR UPDATE OR DELETE ON hms_med_product_ingredients FOR EACH ROW EXECUTE FUNCTION med_composition_guard();
CREATE FUNCTION med_assert_order_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM hms_encounters WHERE id=NEW.encounter_id AND patient_id=NEW.patient_id) OR
 (NEW.admission_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hms_admissions WHERE id=NEW.admission_id AND patient_id=NEW.patient_id)) THEN
 RAISE EXCEPTION 'Medication patient and care context mismatch'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_med_order_context BEFORE INSERT OR UPDATE ON hms_med_orders FOR EACH ROW EXECUTE FUNCTION med_assert_order_context();
